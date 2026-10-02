// Reads the pinned schema.org vocabulary and writes the compact lookup tables
// in src/lib/vocab.json. Runs before build, dev and test. To update schema.org,
// replace vocab/schemaorg-all-https.jsonld and rebuild.
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = new URL('../vocab/schemaorg-all-https.jsonld', import.meta.url);
const OUT = new URL('../src/lib/vocab.json', import.meta.url);

interface TypeInfo { parents: string[]; layer?: string; supersededBy?: string; enumeration?: true }
interface PropInfo { domains: string[]; ranges: string[]; layer?: string; supersededBy?: string }

const fail = (msg: string): never => {
  console.error(`build-vocab: ${msg}`);
  process.exit(1);
};

let graph: Record<string, unknown>[] = [];
try {
  const doc = JSON.parse(readFileSync(SRC, 'utf8'));
  graph = doc['@graph'];
} catch (e) {
  fail(`cannot read ${SRC.pathname}: ${(e as Error).message}`);
}
if (!Array.isArray(graph) || !graph.length) fail('vocabulary has no @graph');

const ids = (v: unknown): string[] =>
  (Array.isArray(v) ? v : v === undefined ? [] : [v]).flatMap((x) => {
    const id = typeof x === 'string' ? x : (x as { '@id'?: string })?.['@id'];
    return typeof id === 'string' && id.startsWith('schema:') ? [id.slice(7)] : [];
  });
const strings = (v: unknown): string[] => (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === 'string');
const layerOf = (n: Record<string, unknown>) => {
  const part = (n['schema:isPartOf'] as { '@id'?: string } | undefined)?.['@id'];
  return part ? part.replace(/^https:\/\//, '').replace(/\.schema\.org$/, '') : undefined;
};

const types: Record<string, TypeInfo> = {};
const properties: Record<string, PropInfo> = {};
const members: Record<string, string[]> = {};

for (const n of graph) {
  const id = n['@id'];
  if (typeof id !== 'string' || !id.startsWith('schema:')) continue;
  const name = id.slice(7);
  const kinds = strings(n['@type']);
  const layer = layerOf(n);
  const supersededBy = ids(n['schema:supersededBy'])[0];

  if (kinds.includes('rdfs:Class') || kinds.includes('schema:DataType')) {
    const t: TypeInfo = { parents: ids(n['rdfs:subClassOf']) };
    if (layer) t.layer = layer;
    if (supersededBy) t.supersededBy = supersededBy;
    types[name] = t;
  }
  if (kinds.includes('rdf:Property')) {
    const p: PropInfo = { domains: ids(n['schema:domainIncludes']), ranges: ids(n['schema:rangeIncludes']) };
    if (layer) p.layer = layer;
    if (supersededBy) p.supersededBy = supersededBy;
    properties[name] = p;
  }
  // Anything typed with a schema.org class is a member of that enumeration.
  for (const k of kinds) if (k.startsWith('schema:') && k !== 'schema:DataType') (members[k.slice(7)] ??= []).push(name);
}

const isEnum = (t: string, seen = new Set<string>()): boolean => {
  if (t === 'Enumeration') return true;
  if (seen.has(t)) return false;
  seen.add(t);
  return (types[t]?.parents ?? []).some((p) => isEnum(p, seen));
};
for (const [name, t] of Object.entries(types)) if (isEnum(name)) t.enumeration = true;

const typeCount = Object.keys(types).length;
const propCount = Object.keys(properties).length;
if (typeCount < 500 || propCount < 1000 || !types.Thing || !properties.name) {
  fail(`vocabulary looks malformed (${typeCount} types, ${propCount} properties)`);
}

const json = JSON.stringify({ types, properties, members });
writeFileSync(OUT, json);
console.log(`build-vocab: ${typeCount} types, ${propCount} properties, ${(json.length / 1024).toFixed(0)} KB`);
