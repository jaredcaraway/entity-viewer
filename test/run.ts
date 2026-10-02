import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { buildGraph } from '../src/lib/graph';

const dom = new JSDOM(readFileSync(new URL('./fixture.html', import.meta.url), 'utf8'), {
  url: 'https://ex.com/p', runScripts: 'outside-only',
});
const page = dom.window.eval(readFileSync(new URL('../public/extract.js', import.meta.url), 'utf8'));
console.log('blocks:', page.blocks.map((b: any) => `${b.source}#${b.index}${b.error ? ' ERR' : ''}`).join(', '));
console.log('microdata:', JSON.stringify(page.blocks.find((b: any) => b.source === 'microdata').data));
console.log('rdfa:', JSON.stringify(page.blocks.find((b: any) => b.source === 'rdfa').data));
const g = buildGraph(page);
console.log('entities:', [...g.entities.values()].map((e) => `${e.types.join('/') || '?'}:${e.label}${e.stub ? '(stub)' : ''}`).join(' | '));
console.log('edges:', g.edges.length, 'roots:', g.roots.map((r) => g.entities.get(r)!.types[0]).join(','));
for (const i of g.issues) console.log(`  [${i.severity}] ${i.message}`);
