import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../src/lib/graph';
import type { Block } from '../src/lib/types';

const CTX = 'https://schema.org';
const block = (index: number, data: object, extra: Partial<Block> = {}): Block => ({
  source: 'json-ld', index, data: { '@context': CTX, ...data }, ...extra,
});
const ISLAND = /separate graphs|unconnected graphs|isn't connected to the rest|each stand alone/;
const islandMessages = (blocks: Block[]) =>
  buildGraph({ url: 'https://ex.com/', title: '', blocks }).issues.map((i) => i.message).filter((m) => ISLAND.test(m));
const yoast = { hints: { attrs: { class: 'yoast-schema-graph' } } };

test('one connected graph has no island issues', () => {
  assert.deepEqual(islandMessages([block(0, { '@graph': [
    { '@type': 'WebSite', '@id': 'https://ex.com/#site', name: 'Ex', url: 'https://ex.com/' },
    { '@type': 'WebPage', '@id': 'https://ex.com/#page', name: 'P', isPartOf: { '@id': 'https://ex.com/#site' } },
  ] })]), []);
});

test('blocks joined by an @id reference are one graph, even if the @id is never defined', () => {
  assert.deepEqual(islandMessages([
    block(0, { '@type': 'WebPage', '@id': 'https://ex.com/#page', name: 'P', isPartOf: { '@id': 'https://ex.com/#site' } }),
    block(1, { '@type': 'WebSite', '@id': 'https://ex.com/#site', name: 'Ex' }),
  ]), []);
  assert.deepEqual(islandMessages([
    block(0, { '@type': 'WebPage', name: 'P', publisher: { '@id': 'https://ex.com/#org' } }),
    block(1, { '@type': 'Product', name: 'W', brand: { '@id': 'https://ex.com/#org' } }),
  ]), []);
});

test('sharing a @graph array does not connect nodes', () => {
  const msgs = islandMessages([block(0, { '@graph': [
    { '@type': 'WebSite', '@id': 'https://ex.com/#site', name: 'Ex' },
    { '@type': 'WebPage', '@id': 'https://ex.com/#page', name: 'P' },
  ] })]);
  assert.deepEqual(msgs, [
    'WebPage "P" (json-ld#1) isn\'t linked to WebSite "Ex" (json-ld#1); they form separate graphs. Add "isPartOf": { "@id": "https://ex.com/#site" } to the WebPage.',
  ]);
});

test('the same thing in two graphs without a shared @id', () => {
  const msgs = islandMessages([
    block(0, { '@graph': [
      { '@type': 'Organization', '@id': 'https://ex.com/#org', name: 'Acme', url: 'https://ex.com/' },
      { '@type': 'WebSite', '@id': 'https://ex.com/#site', name: 'Acme', publisher: { '@id': 'https://ex.com/#org' } },
    ] }, yoast),
    block(1, { '@type': 'Product', name: 'Widget', offers: { '@type': 'Offer', price: '5', priceCurrency: 'USD' },
      brand: { '@type': 'Organization', name: 'ACME ', url: 'http://www.ex.com' } }),
  ]);
  assert.equal(msgs.length, 1, msgs.join('\n'));
  assert.match(msgs[0], /^Organization "Acme" \(json-ld#1 · Yoast SEO\) and Organization "ACME" \(json-ld#2\) look like the same thing/);
  assert.match(msgs[0], /Use "@id": "https:\/\/ex\.com\/#org" for the one in json-ld#2/);
});

test('subtypes match, but different urls rule out a name match', () => {
  const pair = (b: object) => islandMessages([
    block(0, { '@type': 'Organization', '@id': 'https://ex.com/#org', name: 'Acme', url: 'https://ex.com/' }),
    block(1, { '@type': 'Event', name: 'E', organizer: { '@type': 'LocalBusiness', name: 'Acme', ...b } }),
  ]);
  assert.match(pair({}).join('\n'), /look like the same thing/);
  assert.doesNotMatch(pair({ url: 'https://other.com/' }).join('\n'), /look like the same thing/);
  assert.match(pair({ name: 'Other', sameAs: 'https://ex.com' }).join('\n'), /look like the same thing/, 'sameAs matches url');
});

test('competing top-level definitions are left to the competing-sources check', () => {
  const issues = buildGraph({ url: 'https://ex.com/', title: '', blocks: [
    block(0, { '@type': 'Organization', '@id': 'https://ex.com/#org', name: 'Acme' }, yoast),
    block(1, { '@type': 'Organization', name: 'Acme' }),
  ] }).issues.map((i) => i.message);
  assert.ok(issues.some((m) => /^2 separate Organization entities/.test(m)));
  assert.ok(!issues.some((m) => ISLAND.test(m)), issues.join('\n'));
});

test('missing links pages normally have are suggested, once per property', () => {
  const msgs = islandMessages([
    block(0, { '@type': 'WebPage', '@id': 'https://ex.com/p#page', name: 'P' }),
    block(1, { '@type': 'WebSite', '@id': 'https://ex.com/#site', name: 'Ex' }),
    block(2, { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home' }] }),
    block(3, { '@type': 'Recipe', name: 'Soup' }),
    block(4, { '@type': 'Article', headline: 'News' }),
  ]);
  assert.deepEqual(msgs, [
    'WebPage "P" (json-ld#1) isn\'t linked to WebSite "Ex" (json-ld#2); they form separate graphs. Add "isPartOf": { "@id": "https://ex.com/#site" } to the WebPage.',
    'WebPage "P" (json-ld#1) isn\'t linked to BreadcrumbList (json-ld#3); they form separate graphs. Give the BreadcrumbList an @id and reference it from WebPage.breadcrumb.',
    'WebPage "P" (json-ld#1) isn\'t linked to Recipe "Soup" (json-ld#4); they form separate graphs. Give the Recipe an @id and reference it from WebPage.mainEntity.',
    'Article "News" (json-ld#5) isn\'t connected to the rest of the page\'s structured data (WebPage "P"). If it\'s about this page, reference it by @id from the main graph.',
  ]);
});

test('a listing of same-shaped items from one source is reported once', () => {
  const msgs = islandMessages([
    block(0, { '@type': 'WebPage', '@id': 'https://ex.com/c#page', name: 'Category' }),
    ...[1, 2, 3].map((i) => block(i, { '@type': 'Product', name: `P${i}` })),
  ]);
  assert.deepEqual(msgs, [
    '3 Product entities from json-ld each stand alone, not connected to each other or the rest of the page. That\'s normal for a listing; an ItemList (e.g. as the WebPage\'s mainEntity) would tie them to the page.',
  ]);
});

test('blocks with a non-schema.org context are ignored', () => {
  assert.deepEqual(islandMessages([
    block(0, { '@type': 'WebPage', name: 'P' }),
    { source: 'json-ld', index: 1, data: { '@context': 'https://example.org/vocab', '@type': 'Thing', name: 'x' } },
  ]), []);
});
