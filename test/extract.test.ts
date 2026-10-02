import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const extract = readFileSync(new URL('../public/extract.js', import.meta.url), 'utf8');
const scan = (html: string) =>
  new JSDOM(html, { url: 'https://ex.com/p', runScripts: 'outside-only' }).window.eval(extract);

test('visibleText includes body text, alt and aria-label', () => {
  const page = scan(readFileSync(new URL('./fixture.html', import.meta.url), 'utf8'));
  assert.equal(typeof page.visibleText, 'string');
  assert.ok(page.visibleText.includes('Jane Doe'));
  assert.ok(page.visibleText.includes('Widget photo'), 'alt text');
  assert.ok(page.visibleText.includes('Price: $1,299'), 'aria-label');
  assert.ok(!page.visibleText.includes('Hidden label'), 'hidden aria-label');
  assert.ok(!page.visibleText.includes('@context'), 'script contents');
  assert.ok(page.blocks.length > 0);
});

test('a failure while reading text only drops visibleText', () => {
  const dom = new JSDOM('<p>Hi</p><script type="application/ld+json">{"@type":"Thing"}</script>', {
    url: 'https://ex.com/', runScripts: 'outside-only',
  });
  Object.defineProperty(dom.window.document, 'body', { get() { throw new Error('boom'); } });
  const page = dom.window.eval(extract);
  assert.equal(page.visibleText, undefined);
  assert.equal(page.blocks.length, 1);
});
