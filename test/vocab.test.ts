import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ancestors, deprecation, enumMembers, isProperty, isType, propertyAllowedOn, ranges, suggest } from '../src/lib/vocab';

test('ancestors walk the full subclass chain', () => {
  const a = ancestors('NewsArticle');
  assert.equal(a[0], 'NewsArticle');
  for (const t of ['Article', 'CreativeWork', 'Thing']) assert.ok(a.includes(t), t);
});

test('ancestors are breadth-first, nearest first', () => {
  const a = ancestors('MedicalClinic');
  assert.ok(a.indexOf('LocalBusiness') < a.indexOf('Organization'));
});

test('inherited properties are allowed', () => {
  assert.ok(propertyAllowedOn('name', ['Product']));
  assert.ok(propertyAllowedOn('headline', ['NewsArticle']));
  assert.ok(propertyAllowedOn('address', ['MedicalClinic']));
  assert.ok(!propertyAllowedOn('price', ['Product']));
  assert.ok(propertyAllowedOn('price', ['Product', 'Offer']));
});

test('known vs unknown terms', () => {
  assert.ok(isType('Product'));
  assert.ok(!isType('Prodcut'));
  assert.ok(!isType('product'));
  assert.ok(isProperty('address'));
  assert.ok(!isProperty('adress'));
  assert.ok(!isType('address'));
  assert.ok(!isProperty('Product'));
  assert.ok(!isType('InStock'), 'enumeration members are not types');
});

test('pending and extension terms count as known', () => {
  const pending = ['ConferenceEvent', 'AmpStory', 'MedicalClinic'];
  for (const t of pending) assert.ok(isType(t), t);
  assert.ok(isProperty('hasMerchantReturnPolicy'));
});

test('ranges and enumeration members', () => {
  assert.deepEqual(ranges('availability'), ['ItemAvailability']);
  assert.deepEqual(ranges('notAProperty'), []);
  assert.ok(enumMembers('ItemAvailability').includes('InStock'));
  assert.deepEqual(enumMembers('Product'), []);
});

test('superseded and attic flags', () => {
  assert.deepEqual(deprecation('Code'), { supersededBy: 'SoftwareSourceCode' });
  assert.deepEqual(deprecation('StupidType'), { attic: true });
  assert.equal(deprecation('Product'), null);
  assert.equal(deprecation('name'), null);
  assert.equal(deprecation('nope'), null);
});

test('suggestion thresholds', () => {
  const props = ['address', 'name', 'image', 'url'];
  assert.equal(suggest('adress', props), 'address');
  assert.equal(suggest('addrses', props), 'address'); // distance 2
  assert.equal(suggest('xyzzy', props), undefined);
  assert.equal(suggest('nmae', props), undefined); // short name: distance 2 is too far
  assert.equal(suggest('nam', props), 'name');
  assert.equal(suggest('ulr', ['url']), undefined); // transposition counts as 2 for a 3-letter name
});

test('case-only mismatch always wins', () => {
  assert.equal(suggest('product', ['Products', 'Product']), 'Product');
  assert.equal(suggest('URL', ['url', 'uri']), 'url');
});
