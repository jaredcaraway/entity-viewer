import type { Block, Edge, Entity, Graph, Issue, PageData, PropValue } from './types';
import { validate } from './validate';

const SCHEMA_PREFIX = /^(https?:\/\/schema\.org\/|schema:)/i;
export const shortName = (s: string) => s.replace(SCHEMA_PREFIX, '');
export const blockKey = (b: Pick<Block, 'source' | 'index'>) => `${b.source}#${b.index + 1}`;

const toArray = <T,>(v: T | T[] | undefined | null): T[] =>
  v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const LABEL_KEYS = ['name', 'headline', 'title', 'alternateName', 'legalName', 'text'];

export function buildGraph(page: PageData): Graph {
  const entities = new Map<string, Entity>();
  const edges: Edge[] = [];
  const issues: Issue[] = [];
  const blockRoots: string[][] = [];
  let blank = 0;

  const getEntity = (id: string, isBlank: boolean): Entity => {
    let e = entities.get(id);
    if (!e) {
      e = { id, blank: isBlank, stub: true, types: [], props: {}, sources: [], label: '' };
      entities.set(id, e);
    }
    return e;
  };

  const addValue = (e: Entity, prop: string, v: PropValue) => {
    const list = (e.props[prop] ??= []);
    const key = JSON.stringify(v);
    if (!list.some((x) => JSON.stringify(x) === key)) list.push(v);
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
    if (keys.length) e.stub = false;
    if (!e.sources.includes(bk)) e.sources.push(bk);

    const types = toArray(obj['@type'] as string | string[]).map((t) => shortName(String(t)));
    if (types.length && e.types.length && !types.some((t) => e.types.includes(t))) {
      issues.push({
        severity: 'warning',
        entityId: id,
        message: `@id is defined with conflicting types: ${e.types.join(', ')} vs ${types.join(', ')}`,
      });
    }
    for (const t of types) if (!e.types.includes(t)) e.types.push(t);

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
            addValue(e, prop, { kind: 'literal', value: item['@value'] as string | number | boolean | null });
          } else {
            const childId = ingest(item, bk);
            addValue(e, prop, { kind: 'ref', id: childId });
            addEdge(id, childId, prop);
          }
        } else if (Array.isArray(item)) {
          addValue(e, prop, { kind: 'literal', value: JSON.stringify(item) });
        } else {
          addValue(e, prop, { kind: 'literal', value: item as string | number | boolean | null });
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

    const tops = toArray(block.data as unknown);
    const roots: string[] = [];
    if (!tops.length) issues.push({ severity: 'warning', blockKey: bk, message: `${bk} is empty.` });
    for (const top of tops) {
      if (!isObj(top)) {
        issues.push({ severity: 'error', blockKey: bk, message: `${bk} contains a non-object top-level value.` });
        continue;
      }
      if (block.source === 'json-ld') {
        const ctx = top['@context'];
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

  issues.push(...validate(entities));
  return { entities, edges, roots, issues };
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
