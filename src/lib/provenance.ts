import type { Block, Generator, Origin } from './types';

/** Plugin or app slugs that show up in a script's id, class or data-* attributes. */
const ATTR_RULES: [RegExp, string][] = [
  [/yoast/i, 'Yoast SEO'],
  [/rank-?math/i, 'Rank Math'],
  [/aioseo/i, 'All in One SEO'],
  [/seopress/i, 'SEOPress'],
  [/saswp/i, 'Schema & Structured Data for WP'],
  [/schema-?pro/i, 'Schema Pro'],
  [/wpsso/i, 'WPSSO'],
  [/slim-?seo/i, 'Slim SEO'],
  [/schemaapp|schema-app/i, 'Schema App'],
];

/** Text of the comment plugins print before their output. */
const COMMENT_RULES: [RegExp, string][] = [
  [/Yoast SEO/i, 'Yoast SEO'],
  [/Rank ?Math/i, 'Rank Math'],
  [/All in One SEO|aioseo/i, 'All in One SEO'],
  [/SEOPress/i, 'SEOPress'],
  [/The SEO Framework/i, 'The SEO Framework'],
  [/Squirrly/i, 'Squirrly SEO'],
  [/Slim SEO/i, 'Slim SEO'],
  [/WPSSO/i, 'WPSSO'],
  [/Schema App/i, 'Schema App'],
  [/JSON-LD for SEO/i, 'JSON-LD for SEO'],
  [/This is Squarespace/i, 'Squarespace'],
];

/** @id fragments particular to one plugin's graph. */
const ID_RULES: [RegExp, string, string][] = [
  [/#\/schema\/(person|logo|image)\//, 'Yoast SEO', '#/schema/'],
  [/#richSnippet"/, 'Rank Math', '#richSnippet'],
  [/#breadcrumblist"/, 'All in One SEO', '#breadcrumblist'],
];

/** Names the plugin, app or platform that most likely wrote a block, from the markup around it and its @id patterns. */
export function detectGenerator(block: Block): Generator | undefined {
  const { attrs, comment, container } = block.hints ?? {};
  for (const [name, value] of Object.entries(attrs ?? {})) {
    const hay = name.startsWith('data-') ? `${name} ${value}` : value;
    const hit = ATTR_RULES.find(([re]) => re.test(hay));
    if (hit) return { name: hit[1], via: `${name} "${value}"` };
  }
  if (container) {
    const section = container.match(/^shopify-section-(.+)$/);
    if (section) return { name: 'Shopify theme', via: `section "${section[1]}"` };
    if (/^shopify-block-/.test(container)) return { name: 'Shopify app', via: `app block "${container}"` };
  }
  if (comment) {
    const hit = COMMENT_RULES.find(([re]) => re.test(comment));
    if (hit) return { name: hit[1], via: `comment "${comment}"` };
  }
  const data = block.data === undefined ? '' : JSON.stringify(block.data);
  const id = ID_RULES.find(([re]) => re.test(data));
  if (id) return { name: id[1], via: `@id pattern ${id[2]}`, likely: true };
  // WooCommerce writes its context with wp_json_encode, which escapes the slashes.
  if (block.raw?.includes('"@context":"https:\\/\\/schema.org\\/"')) {
    return { name: 'WooCommerce', via: 'its escaped "https:\\/\\/schema.org\\/" @context', likely: true };
  }
  return undefined;
}

export const generatorName = (g: Generator) => (g.likely ? `${g.name} (likely)` : g.name);

/** A block key with its generator, e.g. "json-ld#2 · Rank Math". */
export function blockLabel(key: string, generators: Map<string, Generator>): string {
  const g = generators.get(key);
  return g ? `${key} · ${generatorName(g)}` : key;
}

const squashed = (s: string) => s.replace(/\s+/g, ' ').trim();

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The @type and @id of each top-level node, so a block can be recognized after small edits. */
function signature(data: unknown): string | undefined {
  if (data === undefined) return undefined;
  const tops = (Array.isArray(data) ? data : [data]).flatMap((t) =>
    isObj(t) && Array.isArray(t['@graph']) && !t['@type'] ? t['@graph'] : [t],
  );
  const parts = tops.filter(isObj).map((n) => `${JSON.stringify(n['@type'] ?? '')}|${n['@id'] ?? ''}`);
  return parts.length ? parts.sort().join(',') : undefined;
}

function parse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Compares parsed JSON, so formatting differences don't matter; falls back to the text for invalid JSON. */
const contentKey = (raw: string) => {
  const data = parse(raw);
  return data === undefined ? `raw:${squashed(raw)}` : `json:${JSON.stringify(data)}`;
};

/**
 * Compares the live page's JSON-LD blocks with the scripts in the HTML the server sent.
 * A block is "static" if the server sent it unchanged, "modified" if the server sent a block
 * with the same top-level types and @ids but different content, and "injected" otherwise.
 */
export function classifyOrigins(blocks: Block[], originalRaws: string[]): { blocks: Block[]; removed: number } {
  const left = originalRaws.map((raw) => ({ key: contentKey(raw), sig: signature(parse(raw)), used: false }));
  const origins = new Map<Block, Origin>();
  const jsonLd = blocks.filter((b) => b.source === 'json-ld');

  for (const b of jsonLd) {
    const key = contentKey(b.raw ?? '');
    const match = left.find((o) => !o.used && o.key === key);
    if (match) {
      match.used = true;
      origins.set(b, 'static');
    }
  }
  for (const b of jsonLd) {
    if (origins.has(b)) continue;
    const sig = b.data === undefined ? undefined : signature(b.data);
    const match = sig && left.find((o) => !o.used && o.sig === sig);
    if (match) match.used = true;
    origins.set(b, match ? 'modified' : 'injected');
  }
  return {
    blocks: blocks.map((b) => (origins.has(b) ? { ...b, origin: origins.get(b) } : b)),
    removed: left.filter((o) => !o.used).length,
  };
}

/**
 * Runs in the page (via scripting.executeScript): re-fetches the page's HTML, ideally from the
 * HTTP cache, and returns the text of its JSON-LD scripts. Must stay self-contained.
 */
export async function originalJsonLd(): Promise<string[] | { error: string }> {
  try {
    const res = await fetch(location.href, { credentials: 'include', cache: 'force-cache' });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    if (!/html/i.test(res.headers.get('content-type') ?? '')) return { error: 'not an HTML response' };
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    return [...doc.querySelectorAll('script[type="application/ld+json" i]')].map((s) => s.textContent ?? '');
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
