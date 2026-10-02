import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { buildGraph } from '../src/lib/graph';
import { classifyOrigins, detectGenerator, originalJsonLd } from '../src/lib/provenance';
import type { Block, PageData } from '../src/lib/types';

const CTX = 'https://schema.org';
const extract = readFileSync(new URL('../public/extract.js', import.meta.url), 'utf8');
const scan = (html: string): PageData =>
  new JSDOM(html, { url: 'https://ex.com/p', runScripts: 'outside-only' }).window.eval(extract);
const ld = (obj: object, attrs = '') => `<script type="application/ld+json"${attrs}>${JSON.stringify({ '@context': CTX, ...obj })}</script>`;
const block = (index: number, data: object, extra: Partial<Block> = {}): Block => ({
  source: 'json-ld', index, data: { '@context': CTX, ...data }, raw: JSON.stringify({ '@context': CTX, ...data }), ...extra,
});
const graphOf = (blocks: Block[], extra: Partial<PageData> = {}) => buildGraph({ url: 'https://ex.com/', title: '', blocks, ...extra });
const messages = (blocks: Block[], extra: Partial<PageData> = {}) => graphOf(blocks, extra).issues.map((i) => i.message);

/* ---------------- extraction hints ---------------- */

test('extract.js records attributes, the nearest comment and the container id', () => {
  const page = scan(`<html><head>
    <!-- This site is optimized with the Yoast SEO plugin v22.1 - https://yoast.com/wordpress/plugins/seo/ -->
    <title>x</title><meta name="description" content="d">
    ${ld({ '@type': 'WebSite', name: 'x' }, ' class="yoast-schema-graph" data-foo="bar" nonce="n"')}
    <!-- / Yoast SEO plugin. -->
    ${ld({ '@type': 'Product', name: 'p' })}
    </head><body><div id="shopify-section-main-product"><div>${ld({ '@type': 'Product', name: 'q' })}</div></div></body></html>`);
  const [yoast, after, shopify] = page.blocks;
  assert.deepEqual({ ...yoast.hints?.attrs }, { class: 'yoast-schema-graph', 'data-foo': 'bar' });
  assert.match(yoast.hints?.comment ?? '', /^This site is optimized with the Yoast SEO plugin/);
  assert.equal(after.hints, undefined, 'a closing comment ends the search');
  assert.equal(shopify.hints?.container, 'shopify-section-main-product');
});

test("a plugin's comment isn't credited to a later JSON-LD script", () => {
  const page = scan(`<html><head><!-- Yoast SEO plugin -->${ld({ '@type': 'WebSite' })}<meta name="x">${ld({ '@type': 'Product' })}</head></html>`);
  assert.equal(page.blocks[0].hints?.comment, 'Yoast SEO plugin');
  assert.equal(page.blocks[1].hints, undefined);
});

/* ---------------- generator detection ---------------- */

test('generators are detected from attributes, containers, comments and @id patterns', () => {
  const gen = (extra: Partial<Block>, data: object = { '@type': 'Thing' }) => detectGenerator(block(0, data, extra));
  assert.deepEqual(gen({ hints: { attrs: { class: 'yoast-schema-graph' } } }), { name: 'Yoast SEO', via: 'class "yoast-schema-graph"' });
  assert.equal(gen({ hints: { attrs: { class: 'rank-math-schema-pro' } } })?.name, 'Rank Math');
  assert.equal(gen({ hints: { attrs: { class: 'aioseo-schema' } } })?.name, 'All in One SEO');
  assert.equal(gen({ hints: { attrs: { 'data-generator': 'seopress' } } })?.name, 'SEOPress');
  assert.equal(gen({ hints: { attrs: { id: 'product-json' } } }), undefined);
  assert.deepEqual(gen({ hints: { container: 'shopify-section-template--123__main' } }), { name: 'Shopify theme', via: 'section "template--123__main"' });
  assert.equal(gen({ hints: { container: 'shopify-block-AbC123' } })?.name, 'Shopify app');
  assert.equal(gen({ hints: { comment: 'Search Engine Optimization by Rank Math PRO - https://rankmath.com/' } })?.name, 'Rank Math');
  assert.equal(gen({ hints: { comment: 'Google tag (gtag.js)' } }), undefined);
  const yoastId = gen({}, { '@graph': [{ '@type': 'Person', '@id': 'https://ex.com/#/schema/person/abc' }] });
  assert.deepEqual(yoastId, { name: 'Yoast SEO', via: '@id pattern #/schema/', likely: true });
  const woo = detectGenerator({ source: 'json-ld', index: 0, raw: '{"@context":"https:\\/\\/schema.org\\/","@type":"Product"}', data: {} });
  assert.equal(woo?.name, 'WooCommerce');
  assert.equal(woo?.likely, true);
  // Attributes win over weaker evidence.
  assert.equal(gen({ hints: { attrs: { class: 'aioseo-schema' }, comment: 'Yoast SEO' } })?.name, 'All in One SEO');
});

test('block labels carry the generator', () => {
  const g = graphOf([block(0, { '@type': 'Thing', name: 'x' }, { hints: { attrs: { class: 'rank-math-schema' } } })]);
  assert.equal(g.generators.get('json-ld#1')?.name, 'Rank Math');
});

/* ---------------- server-rendered vs. injected ---------------- */

test('classifyOrigins tells static, modified and injected blocks apart', () => {
  const a = block(0, { '@type': 'Organization', '@id': '#org', name: 'A' });
  const b = block(1, { '@type': 'Product', name: 'Widget', offers: { '@type': 'Offer', price: '5' } });
  const c = block(2, { '@type': 'FAQPage', mainEntity: [] });
  const original = [
    `\n  ${a.raw!.replace(/,/g, ',\n ')}  `, // whitespace differences don't matter
    JSON.stringify({ '@context': CTX, '@type': 'Product', name: 'Widget', offers: { '@type': 'Offer', price: '7' } }),
    JSON.stringify({ '@context': CTX, '@type': 'BreadcrumbList' }),
  ];
  const md: Block = { source: 'microdata', index: 0, data: {} };
  const { blocks, removed } = classifyOrigins([a, b, c, md], original);
  assert.deepEqual(blocks.map((x) => x.origin), ['static', 'modified', 'injected', undefined]);
  assert.equal(removed, 1);
});

test('identical blocks each need their own original', () => {
  const a = block(0, { '@type': 'Thing', name: 'x' });
  const b = block(1, { '@type': 'Thing', name: 'x' });
  const { blocks } = classifyOrigins([a, b], [a.raw!]);
  assert.deepEqual(blocks.map((x) => x.origin), ['static', 'injected']);
});

test('injected and removed blocks are reported', () => {
  const ms = messages([block(0, { '@type': 'Thing', name: 'x' }, { origin: 'injected', hints: { attrs: { class: 'aioseo-schema' } } })], { removedBlocks: 2 });
  assert.ok(ms.some((m) => /^json-ld#1 · All in One SEO is added by JavaScript\./.test(m)), ms.join('\n'));
  assert.ok(ms.includes('2 JSON-LD blocks in the HTML the server sent are missing from the live page (removed or rewritten by JavaScript).'));
  assert.ok(!messages([block(0, { '@type': 'Thing', name: 'x' }, { origin: 'static' })]).some((m) => /JavaScript/.test(m)));
});

test('originalJsonLd fetches the page and returns its JSON-LD scripts', async () => {
  const { window } = new JSDOM('', { url: 'https://ex.com/p' });
  const g = globalThis as Record<string, unknown>;
  const saved = { fetch: g.fetch, DOMParser: g.DOMParser, location: g.location };
  try {
    g.DOMParser = window.DOMParser;
    g.location = window.location;
    let asked: [string, RequestInit?] | undefined;
    g.fetch = async (url: string, init?: RequestInit) => {
      asked = [url, init];
      return new Response(`<html><head>${ld({ '@type': 'Thing' })}<script>var x</script></head></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    };
    const out = await originalJsonLd();
    assert.equal(asked?.[0], 'https://ex.com/p');
    assert.equal(asked?.[1]?.cache, 'force-cache');
    assert.deepEqual(out, [JSON.stringify({ '@context': CTX, '@type': 'Thing' })]);

    g.fetch = async () => new Response('nope', { status: 404 });
    assert.deepEqual(await originalJsonLd(), { error: 'HTTP 404' });
    g.fetch = async () => new Response('{}', { headers: { 'content-type': 'application/json' } });
    assert.deepEqual(await originalJsonLd(), { error: 'not an HTML response' });
  } finally {
    Object.assign(g, saved);
  }
});

/* ---------------- competing sources ---------------- */

const YOAST = { hints: { attrs: { class: 'yoast-schema-graph' } } };
const RANKMATH = { hints: { attrs: { class: 'rank-math-schema' } } };

test('values are traced to the blocks that gave them', () => {
  const g = graphOf([
    block(0, { '@type': 'Organization', '@id': '#org', name: 'Acme', url: 'https://ex.com/' }),
    block(1, { '@type': 'Organization', '@id': '#org', name: 'Acme', logo: 'https://ex.com/l.png' }),
  ]);
  const org = g.entities.get('#org')!;
  assert.deepEqual(org.definedIn, ['json-ld#1', 'json-ld#2']);
  assert.deepEqual(org.props.name[0].from, ['json-ld#1', 'json-ld#2']);
  assert.deepEqual(org.props.logo[0].from, ['json-ld#2']);
});

test('the same @id with different values from different blocks', () => {
  const ms = messages([
    block(0, { '@type': 'Organization', '@id': '#org', name: 'Acme', url: 'https://ex.com/' }, YOAST),
    block(1, { '@type': 'Organization', '@id': '#org', name: 'Acme Inc', url: 'https://ex.com/' }, RANKMATH),
  ]);
  assert.ok(ms.includes('Organization.name differs between sources: "Acme" (json-ld#1 · Yoast SEO) vs "Acme Inc" (json-ld#2 · Rank Math).'), ms.join('\n'));
  assert.ok(!ms.some((m) => /url differs/.test(m)));
  assert.ok(!ms.some((m) => /assembled/.test(m)), 'conflicts replace the assembled note');
});

test('numbers and numeric strings are the same value', () => {
  const ms = messages([
    block(0, { '@type': 'Product', '@id': '#p', name: 'W', sku: 5 }),
    block(1, { '@type': 'Product', '@id': '#p', name: 'W', sku: '5' }),
  ]);
  assert.ok(!ms.some((m) => /differs|combines/.test(m)), ms.join('\n'));
});

test('multi-valued conflicts are notes', () => {
  const issues = graphOf([
    block(0, { '@type': 'Organization', '@id': '#org', name: 'A', sameAs: ['https://fb.com/a', 'https://x.com/a'] }),
    block(1, { '@type': 'Organization', '@id': '#org', name: 'A', sameAs: 'https://fb.com/a' }),
  ]).issues;
  const i = issues.find((x) => /sameAs/.test(x.message));
  assert.equal(i?.severity, 'info');
  assert.equal(i?.message, 'Organization.sameAs combines different values from json-ld#1, json-ld#2.');
});

test('nested blank nodes are not compared', () => {
  const ms = messages([
    block(0, { '@type': 'Organization', '@id': '#org', name: 'A', address: { '@type': 'PostalAddress', addressLocality: 'X' } }),
    block(1, { '@type': 'Organization', '@id': '#org', name: 'A', address: { '@type': 'PostalAddress', addressLocality: 'X' } }),
  ]);
  assert.ok(!ms.some((m) => /address (differs|combines)/.test(m)), ms.join('\n'));
});

test('entities assembled from several sources get a note', () => {
  const issues = graphOf([
    block(0, { '@type': 'Organization', '@id': '#org', name: 'A' }, YOAST),
    block(1, { '@type': 'Organization', '@id': '#org', logo: 'https://ex.com/l.png' }, RANKMATH),
  ]).issues;
  const i = issues.find((x) => /assembled/.test(x.message));
  assert.equal(i?.severity, 'info');
  assert.equal(i?.message, 'Organization is assembled from several sources: json-ld#1 · Yoast SEO, json-ld#2 · Rank Math.');
  // Two blocks from the same plugin are one source.
  assert.ok(!messages([
    block(0, { '@type': 'Organization', '@id': '#org', name: 'A' }, YOAST),
    block(1, { '@type': 'Organization', '@id': '#org', logo: 'https://ex.com/l.png' }, YOAST),
  ]).some((m) => /assembled/.test(m)));
  // A bare @id reference doesn't count as defining the entity.
  assert.ok(!messages([
    block(0, { '@type': 'Organization', '@id': '#org', name: 'A' }, YOAST),
    block(1, { '@type': 'WebPage', name: 'p', publisher: { '@id': '#org' } }, RANKMATH),
  ]).some((m) => /assembled/.test(m)));
});

test('separate entities of a once-per-page type from different sources', () => {
  const issues = graphOf([
    block(0, { '@graph': [{ '@type': 'Organization', '@id': '#org', name: 'A' }, { '@type': 'WebSite', '@id': '#site', name: 'A' }] }, YOAST),
    block(1, { '@type': 'Product', name: 'W', offers: { '@type': 'Offer', price: '5', priceCurrency: 'USD' } }, RANKMATH),
    block(2, { '@type': 'Product', name: 'W', offers: { '@type': 'Offer', price: '5', priceCurrency: 'USD' } }, { raw: '{"@context":"https:\\/\\/schema.org\\/"}' }),
    block(3, { '@type': 'MedicalClinic', name: 'A Clinic', address: 'x' }),
  ]).issues;
  const product = issues.find((i) => /Product entities/.test(i.message));
  assert.equal(product?.severity, 'warning');
  assert.match(product!.message, /^2 separate Product entities come from different sources: json-ld#2 · Rank Math, json-ld#3 · WooCommerce \(likely\)\./);
  assert.ok(issues.some((i) => /^2 separate Organization entities come from different sources: json-ld#1 · Yoast SEO, json-ld#4\./.test(i.message)));
  assert.ok(!issues.some((i) => /WebSite entities/.test(i.message)));
});

test('repeated entities from one source are not competing', () => {
  const md = (index: number): Block => ({ source: 'microdata', index, data: { '@context': CTX, '@type': 'Product', name: `P${index}` } });
  assert.ok(!messages([md(0), md(1), md(2)]).some((m) => /separate Product/.test(m)));
  assert.ok(!messages([
    block(0, { '@type': 'Product', name: 'A' }, YOAST),
    block(1, { '@type': 'Product', name: 'B' }, YOAST),
  ]).some((m) => /separate Product/.test(m)));
  // Several Products in one block (a listing) aren't flagged either.
  assert.ok(!messages([block(0, { '@graph': [{ '@type': 'Product', name: 'A' }, { '@type': 'Product', name: 'B' }] })]).some((m) => /separate/.test(m)));
});

test('conflicting types name the blocks', () => {
  const ms = messages([
    block(0, { '@type': 'Organization', '@id': '#x', name: 'A' }, YOAST),
    block(1, { '@type': 'Product', '@id': '#x', name: 'A' }),
  ]);
  assert.ok(ms.includes('@id is defined with conflicting types: Organization (json-ld#1 · Yoast SEO) vs Product (json-ld#2)'), ms.join('\n'));
});
