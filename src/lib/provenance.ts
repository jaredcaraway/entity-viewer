import type { Block, Generator, Origin } from './types';
import { isObj } from './util';

/** Matches a plugin slug as a whole word or hyphenated segment, so "schema-pro" doesn't match "schema-product". */
const slug = (s: string) => new RegExp(`(^|[^a-z0-9])(${s})($|[^a-z0-9])`, 'i');

/** Plugin or app slugs that show up in a script's id, class or data-* attributes. */
const ATTR_RULES: [RegExp, string][] = [
  [slug('yoast'), 'Yoast SEO'],
  [slug('rank-?math'), 'Rank Math'],
  [slug('aioseo'), 'All in One SEO'],
  [slug('seopress'), 'SEOPress'],
  [slug('saswp'), 'Schema & Structured Data for WP'],
  [slug('(wp-)?schema-?pro'), 'Schema Pro'],
  [slug('wpsso'), 'WPSSO'],
  [slug('slim-?seo'), 'Slim SEO'],
  [slug('schema-?app'), 'Schema App'],
];

/** Text of the comments plugins wrap around their output. */
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
];

/** @id fragments particular to one plugin's graph. */
const ID_RULES: [RegExp, string, string][] = [
  [/#\/schema\/(person|logo|image)\//, 'Yoast SEO', '#/schema/'],
  [/#richSnippet$/, 'Rank Math', '#richSnippet'],
  [/#breadcrumblist$/, 'All in One SEO', '#breadcrumblist'],
];

/** The @ids a block defines (nodes with more than an @id), not ones it only references. */
function definedIds(data: unknown, out: string[] = []): string[] {
  if (Array.isArray(data)) for (const d of data) definedIds(d, out);
  else if (isObj(data)) {
    if (typeof data['@id'] === 'string' && Object.keys(data).some((k) => k !== '@id')) out.push(data['@id']);
    for (const [k, v] of Object.entries(data)) if (k !== '@context') definedIds(v, out);
  }
  return out;
}

/** Names the plugin, app or platform that most likely wrote a block, from the markup around it and its @id patterns. */
export function detectGenerator(block: Block): Generator | undefined {
  const { attrs, comment, commentAfter, container } = block.hints ?? {};
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
  // Only a script between a plugin's opening and closing comments is its own; one after the closing comment isn't.
  if (comment && commentAfter) {
    const hit = COMMENT_RULES.find(([re]) => re.test(comment) && re.test(commentAfter));
    if (hit) return { name: hit[1], via: `comments "${comment}" … "${commentAfter}"` };
  }
  const ids = definedIds(block.data);
  const id = ID_RULES.find(([re]) => ids.some((i) => re.test(i)));
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

/** Parses like extract.js does, accepting HTML comment and CDATA wrappers and a trailing semicolon. */
function parseLenient(raw: string): unknown {
  for (const text of [raw, raw.replace(/^\s*<!--/, '').replace(/-->\s*$/, '').replace(/\/\/\s*<!\[CDATA\[/, '').replace(/\/\/\s*\]\]>/, '').replace(/;\s*$/, '')]) {
    try {
      return JSON.parse(text);
    } catch {
      // try the next form
    }
  }
  return undefined;
}

/** Compares parsed JSON, so formatting differences don't matter; falls back to the text for invalid JSON. */
const contentKey = (data: unknown, raw: string) =>
  data === undefined ? `raw:${squashed(raw)}` : `json:${JSON.stringify(data)}`;

/** The @type and @id of each top-level node, so a block can be recognized after small edits. */
function signature(data: unknown): string | undefined {
  if (data === undefined) return undefined;
  const tops = (Array.isArray(data) ? data : [data]).flatMap((t) =>
    isObj(t) && Array.isArray(t['@graph']) && !t['@type'] ? t['@graph'] : [t],
  );
  const parts = tops.filter(isObj).map((n) => `${JSON.stringify(n['@type'] ?? '')}|${n['@id'] ?? ''}`);
  return parts.length ? parts.sort().join(',') : undefined;
}

/**
 * Compares the live page's JSON-LD blocks with the scripts in the HTML the server sent.
 * A block is "static" if the server sent it unchanged, "modified" if the server sent a block
 * with the same top-level types and @ids but different content, and "injected" otherwise.
 * Empty scripts in the server's HTML are placeholders for scripts to fill, not removed blocks.
 */
export function classifyOrigins(blocks: Block[], originalRaws: string[]): { blocks: Block[]; removed: number } {
  const left = originalRaws
    .filter((raw) => raw.trim())
    .map((raw) => {
      const data = parseLenient(raw);
      return { key: contentKey(data, raw), sig: signature(data), used: false };
    });
  const origins = new Map<Block, Origin>();
  const jsonLd = blocks.filter((b) => b.source === 'json-ld');

  for (const b of jsonLd) {
    const key = contentKey(b.data, b.raw ?? '');
    const match = left.find((o) => !o.used && o.key === key);
    if (match) {
      match.used = true;
      origins.set(b, 'static');
    }
  }
  for (const b of jsonLd) {
    if (origins.has(b)) continue;
    const sig = signature(b.data);
    const match = sig && left.find((o) => !o.used && o.sig === sig);
    if (match) match.used = true;
    origins.set(b, match ? 'modified' : 'injected');
  }
  return {
    blocks: blocks.map((b) => (origins.has(b) ? { ...b, origin: origins.get(b) } : b)),
    removed: left.filter((o) => !o.used).length,
  };
}

export type OriginalResult = string[] | { error: string; notCached?: boolean };

/**
 * Runs in the page (via scripting.executeScript): gets the page's HTML again and returns the text of
 * its JSON-LD scripts. Without `network` it only reads the HTTP cache, so it never repeats a request
 * that could have side effects (one-time links); with it, it may fetch. Must stay self-contained.
 */
export async function originalJsonLd(url: string, network: boolean): Promise<OriginalResult> {
  // A single-page app may have navigated since the scan.
  if (location.href !== url) return { error: 'the page changed since the scan' };
  // Firefox's content.fetch makes the request as the page (its cookies, cache and origin); plain fetch doesn't.
  const pageFetch: typeof fetch = (globalThis as { content?: { fetch?: typeof fetch } }).content?.fetch ?? fetch;
  let res: Response;
  try {
    res = await pageFetch(url, network
      ? { credentials: 'include', cache: 'force-cache' }
      : { credentials: 'include', cache: 'only-if-cached', mode: 'same-origin' });
  } catch (e) {
    if (!network) return { error: 'not in the cache', notCached: true };
    return { error: e instanceof Error ? e.message : String(e) };
  }
  try {
    if (!network && res.status === 504) return { error: 'not in the cache', notCached: true };
    if (!res.ok) return { error: `HTTP ${res.status}` };
    if (!/html/i.test(res.headers.get('content-type') ?? '')) return { error: 'not an HTML response' };
    // DOMParser parses <noscript> contents as markup (and in <head>, a script ends the noscript early),
    // but the live page, with scripting on, treats them as text. Drop them before parsing.
    const html = (await res.text()).replace(/<noscript\b[\s\S]*?<\/noscript\s*>/gi, '');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return [...doc.querySelectorAll('script[type="application/ld+json" i]')].map((s) => s.textContent ?? '');
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
