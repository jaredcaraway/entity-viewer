import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText, numberAppears, pageNumbers, textAppears } from '../src/lib/visible';

const values = (text: string) => pageNumbers(text).map((n) => n.value).sort((a, b) => a - b);
const appears = (v: number, page: string) => numberAppears(v, pageNumbers(page), normalizeText(page));

test('normalization', () => {
  assert.equal(normalizeText('  Ｗidget  “Pro”  —  Ben’s\n&amp; Co  '), 'widget "pro" - ben\'s & co');
  assert.equal(normalizeText('a&#39;b&#x2013;c&nbsp;d'), "a'b-c d");
});

test('US and EU number formats', () => {
  assert.deepEqual(values('$1,299.00'), [1299]);
  assert.deepEqual(values('1.299,00 €'), [1299]);
  assert.deepEqual(values('19,99'), [19.99]);
  assert.deepEqual(values('$19.99'), [19.99]);
  assert.deepEqual(values('1,299'), [1.299, 1299]);
  assert.deepEqual(values('1,299,000'), [1299000]);
  assert.deepEqual(values('4.5 stars from 120 reviews'), [4.5, 120]);
});

test('decimals are recorded', () => {
  assert.deepEqual(pageNumbers('4.70'), [{ value: 4.7, decimals: 2 }]);
});

test('exact and rounded number matches', () => {
  assert.ok(appears(19.99, 'Now only $19.99!'));
  assert.ok(appears(1299, 'Price: 1.299,00 €'));
  assert.ok(appears(20, 'Price 20.00'));
  assert.ok(appears(4.67, 'Rated 4.7 out of 5'));
  assert.ok(!appears(4.67, 'Rated 5 out of 5'));
  assert.ok(!appears(4.67, 'Rated 4.6'));
  assert.ok(!appears(24.99, 'Now only $19.99!'));
  assert.ok(!appears(19, 'Now only $19.99!'));
});

test('"free" matches a price of 0', () => {
  assert.ok(appears(0, 'Download it for FREE today'));
  assert.ok(!appears(0, 'Freedom costs $5'));
  assert.ok(!appears(5, 'Free shipping'));
});

test('text: full substring after normalization', () => {
  const page = normalizeText('Shop the Acme  Widget—Pro today');
  assert.ok(textAppears('Acme Widget–Pro', page));
  assert.ok(textAppears('acme widget pro', page));
  assert.ok(!textAppears('Acme Gadget', page));
});

test('text: 80% in-order run for values of 4+ words', () => {
  const page = normalizeText('Best Trail Running Shoes for Women. Free returns.');
  assert.ok(textAppears('Best Trail Running Shoes for Women | Acme', page)); // 6 of 7 words
  assert.ok(!textAppears('Best Trail Running Shoes for Men | Acme', page)); // 5 of 7 words
  assert.ok(!textAppears('Trail Shoes Running Best', page)); // words out of order
});

test('text: short values need the full match', () => {
  const page = normalizeText('Acme Widget is great');
  assert.ok(!textAppears('Acme Widget Pro', page));
  assert.ok(textAppears('Acme Widget', page));
});

test('text: HTML tags in values are ignored', () => {
  const page = normalizeText('Yes. Returns are accepted within 30 days.');
  assert.ok(textAppears('<p>Yes. Returns are <b>accepted</b> within 30 days.</p>', page));
});
