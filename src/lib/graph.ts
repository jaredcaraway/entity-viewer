import type { Edge, Entity, Generator, Graph, Issue, PageData, PropValue } from './types';
import { validate } from './validate';
import { blockLabel, detectGenerator } from './provenance';
import { competingIssues } from './competing';
import { blockKey, isObj, toArray } from './util';

const SCHEMA_PREFIX = /^(https?:\/\/schema\.org\/|schema:)/i;
export const shortName = (s: string) => s.replace(SCHEMA_PREFIX, '');
export { blockKey };

const LABEL_KEYS = ['name', 'headline', 'title', 'alternateName', 'legalName', 'text'];

export function buildGraph(page: PageData): Graph {
  const entities = new Map<string, Entity>();
  const edges: Edge[] = [];
  const issues: Issue[] = [];
  const blockRoots: string[][] = [];
  const rootsByBlock = new Map<string, string[]>();
  const nonSchemaBlocks = new Set<string>();
  /** Which block first gave each entity each of its types. */
  const typeFrom = new Map<string, Map<string, string>>();
  let blank = 0;

  const generators = new Map<string, Generator>();
  for (const b of page.blocks) {
    const g = detectGenerator(b);
    if (g) generators.set(blockKey(b), g);
  }
  const label = (bk: string) => blockLabel(bk, generators);

  const getEntity = (id: string, isBlank: boolean): Entity => {
    let e = entities.get(id);
    if (!e) {
      e = { id, blank: isBlank, stub: true, types: [], props: {}, sources: [], definedIn: [], label: '' };
      entities.set(id, e);
    }
    return e;
  };

  const valueKey = (v: PropValue) => (v.kind === 'ref' ? `ref:${v.id}` : `lit:${JSON.stringify(v.value)}`);
  const addValue = (e: Entity, prop: string, v: PropValue, bk: string) => {
    const list = (e.props[prop] ??= []);
    const key = valueKey(v);
    const same = list.find((x) => valueKey(x) === key);
    if (!same) list.push({ ...v, from: [bk] });
    else if (!same.from!.includes(bk)) same.from!.push(bk);
  };

  const addEdge = (source: string, target: string, prop: string) => {
    const id = `${source}|${prop}|${target}`;
    if (!edges.some((e) => e.id === id)) edges.push({ id, source, target, prop });
  };

  function ingest(obj: Record<string, unknown>, bk: string): string {
    const rawId = typeof obj['@id'] === 'string' ? (obj['@id'] as string) : undefined;
    const id = rawId ?? `_:b${++blank}`;
    const e = getEntity(id, !rawId);
    const keys = Object.keys(obj).filter((k) => k !== '@id');
    // An object with only @id is a reference, not a definition.
    if (keys.length) {
      e.stub = false;
      if (!e.definedIn.includes(bk)) e.definedIn.push(bk);
    }
    if (!e.sources.includes(bk)) e.sources.push(bk);

    const types = toArray(obj['@type'] as string | string[]).map((t) => shortName(String(t)));
    const from = typeFrom.get(id) ?? new Map<string, string>();
    typeFrom.set(id, from);
    if (types.length && e.types.length && !types.some((t) => e.types.includes(t))) {
      const was = e.types.map((t) => `${t} (${label(from.get(t)!)})`).join(', ');
      issues.push({
        severity: 'warning',
        entityId: id,
        message: `@id is defined with conflicting types: ${was} vs ${types.join(', ')} (${label(bk)})`,
      });
    }
    for (const t of types) {
      if (e.types.includes(t)) continue;
      e.types.push(t);
      from.set(t, bk);
    }

    for (const [k, v] of Object.entries(obj)) {
      if (k === '@context' || k === '@id' || k === '@type') continue;
      if (k === '@graph') {
        for (const g of toArray(v)) if (isObj(g)) addEdge(id, ingest(g, bk), '@graph');
        continue;
      }
      const prop = shortName(k);
      const items = toArray(v).flatMap((x) => (isObj(x) && Array.isArray(x['@list']) ? x['@list'] : [x]));
      for (const item of items) {
        if (isObj(item)) {
          if ('@value' in item) {
            addValue(e, prop, { kind: 'literal', value: item['@value'] as string | number | boolean | null }, bk);
          } else {
            const childId = ingest(item, bk);
            addValue(e, prop, { kind: 'ref', id: childId }, bk);
            addEdge(id, childId, prop);
          }
        } else if (Array.isArray(item)) {
          addValue(e, prop, { kind: 'literal', value: JSON.stringify(item) }, bk);
        } else {
          addValue(e, prop, { kind: 'literal', value: item as string | number | boolean | null }, bk);
        }
      }
    }
    return id;
  }

  for (const block of page.blocks) {
    const bk = blockKey(block);
    if (block.error) {
      issues.push({ severity: 'error', blockKey: bk, message: `${bk}: ${block.error}` });
      blockRoots.push([]);
      continue;
    }
    if (block.warning) issues.push({ severity: 'warning', blockKey: bk, message: `${bk}: ${block.warning}` });
    if (block.origin === 'injected') {
      issues.push({
        severity: 'info',
        blockKey: bk,
        message: `${label(bk)} is added by JavaScript. Google renders it, but crawlers that don't run scripts (including most AI crawlers) won't see it.`,
      });
    }

    const tops = toArray(block.data as unknown);
    const roots: string[] = [];
    if (!tops.length) issues.push({ severity: 'warning', blockKey: bk, message: `${bk} is empty.` });
    for (const top of tops) {
      if (!isObj(top)) {
        issues.push({ severity: 'error', blockKey: bk, message: `${bk} contains a non-object top-level value.` });
        continue;
      }
      const ctx = top['@context'];
      if (ctx !== undefined && !isSchemaContext(ctx)) nonSchemaBlocks.add(bk);
      if (block.source === 'json-ld') {
        if (ctx === undefined) {
          issues.push({ severity: 'warning', blockKey: bk, message: `${bk} has no @context; types won't resolve to schema.org.` });
        } else if (typeof ctx === 'string' && !/schema\.org/i.test(ctx)) {
          issues.push({ severity: 'info', blockKey: bk, message: `${bk} uses a non-schema.org @context: ${ctx}` });
        } else if (typeof ctx === 'string' && /^http:\/\//i.test(ctx)) {
          issues.push({ severity: 'info', blockKey: bk, message: `${bk} uses http:// in @context; https://schema.org is preferred.` });
        }
      }
      if (Array.isArray(top['@graph']) && !top['@type']) {
        for (const g of top['@graph']) if (isObj(g)) roots.push(ingest(g, bk));
      } else {
        roots.push(ingest(top, bk));
      }
    }
    blockRoots.push(roots);
    rootsByBlock.set(bk, roots);
  }

  for (const e of entities.values()) {
    e.label = labelFor(e);
    if (e.stub) {
      issues.push({
        severity: 'warning',
        entityId: e.id,
        message: `Referenced @id is never defined on this page: ${e.id}`,
      });
    }
  }

  const targeted = new Set(edges.filter((e) => e.source !== e.target).map((e) => e.target));
  let roots = [...entities.keys()].filter((id) => !targeted.has(id) && !entities.get(id)!.stub);
  if (!roots.length) roots = [...new Set(blockRoots.flat())];

  if (page.removedBlocks) {
    const n = page.removedBlocks;
    issues.push({
      severity: 'info',
      message: `${n} JSON-LD block${n > 1 ? 's' : ''} in the HTML the server sent ${n > 1 ? 'are' : 'is'} missing from the live page (removed or rewritten by JavaScript).`,
    });
  }

  issues.push(...competingIssues(entities, rootsByBlock, page.blocks, generators));
  issues.push(...validate(entities, { visibleText: page.visibleText, nonSchemaBlocks }));
  return { entities, edges, roots, issues, generators };
}

/** Whether an @context (string, array or object with @vocab) points at schema.org. */
function isSchemaContext(ctx: unknown): boolean {
  if (typeof ctx === 'string') return /schema\.org/i.test(ctx);
  if (Array.isArray(ctx)) return ctx.some(isSchemaContext);
  if (isObj(ctx)) return typeof ctx['@vocab'] === 'string' && isSchemaContext(ctx['@vocab']);
  return false;
}

export function labelFor(e: Entity): string {
  for (const k of LABEL_KEYS) {
    const v = e.props[k]?.find((x) => x.kind === 'literal');
    if (v && v.kind === 'literal' && v.value !== null && String(v.value).trim()) {
      const s = String(v.value).trim();
      return s.length > 48 ? s.slice(0, 46) + '…' : s;
    }
  }
  if (!e.blank) {
    const hash = e.id.split('#')[1];
    if (hash) return '#' + hash;
    return e.id.replace(/^https?:\/\//, '').slice(0, 48);
  }
  return '';
}

/** Re-serialize the merged graph as a single JSON-LD document. */
export function toJsonLd(g: Graph): object {
  const nodes = [...g.entities.values()]
    .filter((e) => !e.stub)
    .map((e) => {
      const out: Record<string, unknown> = {};
      out['@id'] = e.id;
      if (e.types.length) out['@type'] = e.types.length === 1 ? e.types[0] : e.types;
      for (const [k, vals] of Object.entries(e.props)) {
        const mapped = vals.map((v) => (v.kind === 'ref' ? { '@id': v.id } : v.value));
        out[k] = mapped.length === 1 ? mapped[0] : mapped;
      }
      return out;
    });
  return { '@context': 'https://schema.org', '@graph': nodes };
}
