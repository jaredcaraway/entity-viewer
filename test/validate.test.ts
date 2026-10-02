import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../src/lib/graph';
import type { Block, Issue } from '../src/lib/types';

const CTX = 'https://schema.org';

/** Builds the graph for one JSON-LD block per object and returns its issues. */
function run(objs: object | object[], visibleText?: string, extra: Block[] = []): Issue[] {
  const blocks: Block[] = (Array.isArray(objs) ? objs : [objs]).map((data, index) => ({
    source: 'json-ld',
    index,
    data: { '@context': CTX, ...data },
  }));
  return buildGraph({ url: 'https://ex.com/', title: '', blocks: [...blocks, ...extra], visibleText }).issues;
}
const messages = (objs: object | object[], visibleText?: string) => run(objs, visibleText).map((i) => i.message);
const has = (objs: object | object[], re: RegExp, visibleText?: string) =>
  assert.ok(messages(objs, visibleText).some((m) => re.test(m)), `expected ${re} in:\n${messages(objs, visibleText).join('\n')}`);
const lacks = (objs: object | object[], re: RegExp, visibleText?: string) =>
  assert.ok(!messages(objs, visibleText).some((m) => re.test(m)), `unexpected ${re} in:\n${messages(objs, visibleText).join('\n')}`);

/* ---------------- 1.1 vocabulary ---------------- */

test('unknown type', () => {
  has({ '@type': 'Prodcut', name: 'x' }, /^Unknown type "Prodcut"\. Did you mean "Product"\?$/);
  has({ '@type': 'Zzqxv', name: 'x' }, /^Unknown type "Zzqxv"\.$/);
  lacks({ '@type': 'Product', name: 'x' }, /Unknown type/);
});

test('unknown property', () => {
  has({ '@type': 'Product', name: 'x', adress: 'y' }, /^Product\.adress is not a schema\.org property\. Did you mean "address"\?$/);
  lacks({ '@type': 'Product', name: 'x', sku: 'y' }, /is not a schema\.org property/);
  lacks({ '@type': 'SearchAction', target: 'https://ex.com/?q={q}', 'query-input': 'required name=q' }, /query-input/);
  has({ '@type': 'SearchAction', 'qurey-input': 'required name=q' }, /qurey-input is not a schema\.org property/);
});

test('wrong domain', () => {
  has({ '@type': 'Product', name: 'x', price: '5' }, /^price is not a property of Product \(it belongs on .*Offer.*\)\.$/);
  lacks({ '@type': 'Offer', price: '5', priceCurrency: 'USD' }, /is not a property of/);
  lacks({ '@type': ['Product', 'Offer'], name: 'x', price: '5' }, /is not a property of/);
  lacks({ '@type': 'Zzqxv', price: '5' }, /is not a property of/); // unknown type: skip
});

test('ref of the wrong type', () => {
  has({ '@type': 'Article', author: { '@type': 'Product', name: 'x' } }, /^author points to a Product; expected Organization or Person\.$/);
  lacks({ '@type': 'Article', author: { '@type': 'Person', name: 'x' } }, /points to a/);
  lacks({ '@type': 'Article', author: { '@type': 'Zzqxv', name: 'x' } }, /points to a/);
  lacks({ '@type': 'Article', publisher: { '@type': 'NewsMediaOrganization', name: 'x' } }, /points to a/);
});

test('ref where only a datatype is allowed', () => {
  has({ '@type': 'Product', name: { '@type': 'Thing', name: 'x' } }, /^name should be text, not an entity\.$/);
  lacks({ '@type': 'Product', name: 'x', url: { '@id': 'https://ex.com/p' } }, /not an entity/); // bare IRI for a URL
  lacks({ '@type': 'Product', name: 'x', image: { '@type': 'ImageObject', url: 'https://ex.com/i.png' } }, /not an entity/);
});

test('literal of the wrong datatype', () => {
  has({ '@type': 'Event', maximumAttendeeCapacity: 'lots' }, /^Event\.maximumAttendeeCapacity should be a number: "lots"$/);
  lacks({ '@type': 'Event', maximumAttendeeCapacity: '100' }, /maximumAttendeeCapacity should be/);
  lacks({ '@type': 'Event', maximumAttendeeCapacity: 100 }, /maximumAttendeeCapacity should be/);

  has({ '@type': 'Event', isAccessibleForFree: 'yes' }, /^Event\.isAccessibleForFree should be true or false: "yes"$/);
  for (const ok of [true, 'False', 'https://schema.org/True', 'http://schema.org/False']) {
    lacks({ '@type': 'Event', isAccessibleForFree: ok }, /isAccessibleForFree should be/);
  }

  has({ '@type': 'Event', doorTime: 'evening' }, /^Event\.doorTime should be an ISO 8601 date or time: "evening"$/);
  lacks({ '@type': 'Event', doorTime: '19:30' }, /doorTime should be/);
  lacks({ '@type': 'Event', doorTime: '2026-11-01T19:30' }, /doorTime should be/);
});

test('datatype check defers to the existing format checks', () => {
  const ms = messages({ '@type': 'Event', name: 'x', startDate: 'May 3' });
  assert.equal(ms.filter((m) => m.includes('startDate')).length, 1);
});

test('bad enumeration member', () => {
  const offer = (availability: unknown) => ({ '@type': 'Offer', price: '5', priceCurrency: 'USD', availability });
  has(offer('InStok'), /^"InStok" is not a valid ItemAvailability\. Did you mean "InStock"\?$/);
  has(offer('https://schema.org/InStok'), /^"https:\/\/schema\.org\/InStok" is not a valid ItemAvailability\. Did you mean "InStock"\?$/);
  for (const ok of ['InStock', 'https://schema.org/InStock', 'http://schema.org/InStock']) lacks(offer(ok), /is not a valid/);
  lacks(offer({ '@id': 'https://schema.org/InStock' }), /is not a valid|points to|not an entity/);
  lacks({ '@type': 'Person', name: 'x', gender: 'male' }, /is not a valid/); // Text is also allowed
});

test('retired or superseded terms', () => {
  const sup = run({ '@type': 'Code', name: 'x' }).find((i) => /superseded/.test(i.message));
  assert.equal(sup?.message, '"Code" is superseded by "SoftwareSourceCode".');
  assert.equal(sup?.severity, 'info');
  has({ '@type': 'Product', name: 'x', reviews: { '@type': 'Review', author: 'a', reviewRating: { '@type': 'Rating', ratingValue: 4 } } }, /^"reviews" is superseded by "review"\.$/);
  has({ '@type': 'StupidType', name: 'x' }, /^"StupidType" is retired \(attic\)\.$/);
  lacks({ '@type': 'Product', name: 'x', review: 'great' }, /superseded|retired/);
});

test('plain text where an entity is expected is allowed', () => {
  lacks({ '@type': 'Article', headline: 'h', author: 'Jane Doe' }, /author/);
});

test('NewsArticle still gets the Article rules', () => {
  has({ '@type': 'NewsArticle', image: 'https://ex.com/i.png' }, /^NewsArticle is missing "headline"\.$/);
  has({ '@type': 'MedicalClinic', name: 'x' }, /^MedicalClinic is missing "address"\.$/);
});

test('each entity/property/check produces at most one issue', () => {
  const ms = messages({ '@type': 'Product', name: 'x', adress: ['a', 'b'], price: ['1', '2'] });
  assert.equal(ms.filter((m) => m.includes('adress')).length, 1);
  assert.equal(ms.filter((m) => m.includes('price is not a property')).length, 1);
  const twice = messages({ '@type': ['Code', 'Code'], name: 'x' });
  assert.equal(twice.filter((m) => m.includes('superseded')).length, 1);
});

test('non-schema.org terms and contexts are skipped', () => {
  lacks({ '@type': 'Product', name: 'x', 'og:title': 'y', 'https://example.org/foo': 'z' }, /not a schema\.org property/);
  lacks({ '@type': 'https://example.org/Thingy', name: 'x' }, /Unknown type/);
  const foreign = buildGraph({
    url: '', title: '',
    blocks: [{ source: 'json-ld', index: 0, data: { '@context': 'https://example.org/', '@type': 'Foo', bar: 1, name: 'Nope' } }],
    visibleText: 'nothing',
  }).issues;
  assert.ok(!foreign.some((i) => /Unknown type|not a schema\.org property|doesn't appear/.test(i.message)));
});

/* ---------------- 1.3 visible-content mismatch ---------------- */

const MISMATCH = /doesn't appear in the page's visible text/;

test('mismatch check is skipped without visibleText', () => {
  lacks({ '@type': 'Product', name: 'Acme Widget' }, MISMATCH);
});

test('numeric properties', () => {
  const offer = { '@type': 'Offer', price: '19.99', priceCurrency: 'USD' };
  lacks(offer, MISMATCH, 'Now $19.99');
  has(offer, /^Offer\.price "19\.99" doesn't appear in the page's visible text\.$/, 'Now $24.99');
  const agg = { '@type': 'AggregateRating', ratingValue: '4.67', reviewCount: '1299' };
  lacks(agg, MISMATCH, 'Rated 4.7 from 1,299 reviews');
  has(agg, /AggregateRating\.ratingValue "4\.67"/, 'Rated 5 from 1,299 reviews');
  has(agg, /AggregateRating\.reviewCount "1299"/, 'Rated 4.7 from 12 reviews');
  lacks({ '@type': 'Offer', price: '0', priceCurrency: 'USD' }, MISMATCH, 'Free download');
  lacks({ '@type': 'Offer', price: '$5', priceCurrency: 'USD' }, MISMATCH, 'nothing here'); // non-numeric: skipped
});

test('names of products, recipes, events and courses', () => {
  for (const t of ['Product', 'Recipe', 'MusicEvent', 'Course']) {
    lacks({ '@type': t, name: 'Acme Thing' }, MISMATCH, 'Welcome to Acme Thing');
    has({ '@type': t, name: 'Acme Thing' }, new RegExp(`^${t}\\.name "Acme Thing" doesn't appear`), 'Welcome');
  }
  lacks({ '@type': 'Organization', name: 'Acme Thing' }, MISMATCH, 'Welcome');
});

test('article headlines and job titles', () => {
  lacks({ '@type': 'BlogPosting', headline: 'How to Pick the Best Trail Shoes | Acme' }, MISMATCH, 'How to pick the best trail shoes. By Jane');
  has({ '@type': 'BlogPosting', headline: 'Ten Tips' }, /BlogPosting\.headline "Ten Tips"/, 'Eleven tips');
  lacks({ '@type': 'JobPosting', title: 'Line Cook' }, MISMATCH, 'Hiring: Line Cook');
  has({ '@type': 'JobPosting', title: 'Line Cook' }, /JobPosting\.title "Line Cook"/, 'Hiring: Sous Chef');
});

test('author and reviewer names', () => {
  const article = { '@type': 'Article', headline: 'Hi', author: { '@type': 'Person', name: 'Jane Doe' } };
  lacks(article, MISMATCH, 'Hi, by Jane Doe');
  has(article, /^Person\.name "Jane Doe" doesn't appear/, 'Hi, by John');
  const review = { '@type': 'Review', reviewer: { '@type': 'Organization', name: 'Acme Labs' } };
  has(review, /^Organization\.name "Acme Labs" doesn't appear/, 'A review');
  lacks({ '@type': 'Article', headline: 'Hi', publisher: { '@type': 'Person', name: 'Jane Doe' } }, MISMATCH, 'Hi');
});

test('FAQ questions and answers', () => {
  const faq = {
    '@type': 'FAQPage',
    mainEntity: { '@type': 'Question', name: 'Do you ship?', acceptedAnswer: { '@type': 'Answer', text: '<p>Yes, worldwide.</p>' } },
  };
  lacks(faq, MISMATCH, 'FAQ Do you ship? Yes, worldwide.');
  has(faq, /^Question\.name "Do you ship\?"/, 'FAQ Yes, worldwide.');
  has(faq, /^Answer\.text "<p>Yes, worldwide\.<\/p>"/, 'FAQ Do you ship? No.');
});

test('mismatch only runs on entities with a JSON-LD source', () => {
  const md: Block = { source: 'microdata', index: 0, data: { '@context': CTX, '@type': 'Product', name: 'Acme Widget', offers: { '@type': 'Offer', price: '5', priceCurrency: 'USD' } } };
  const issues = buildGraph({ url: '', title: '', blocks: [md], visibleText: 'nothing' }).issues;
  assert.ok(!issues.some((i) => MISMATCH.test(i.message)));
});
