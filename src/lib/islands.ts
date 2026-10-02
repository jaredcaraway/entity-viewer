import type { Block, Edge, Entity, Generator, Issue } from './types';
import { ancestors } from './vocab';
import { blockLabel } from './provenance';
import { SINGLETONS, sourceIdentity } from './competing';
import { clip } from './util';

/** Links a page's graphs normally have, as [from type, property, target types]. Earlier rules win. */
const BRIDGES: [string, string, string[]][] = [
  ['WebPage', 'isPartOf', ['WebSite']],
  ['WebPage', 'breadcrumb', ['BreadcrumbList']],
  ['WebPage', 'mainEntity', ['Product', 'Article', 'Recipe', 'Event', 'JobPosting', 'Course', 'SoftwareApplication']],
  ['WebPage', 'primaryImageOfPage', ['ImageObject']],
  ['WebSite', 'publisher', ['Organization', 'Person']],
  ['Article', 'publisher', ['Organization']],
  ['Article', 'author', ['Person', 'Organization']],
];

interface Unit {
  ids: string[];
  top: Entity;
  /** Several islands with the same shape from one source, e.g. one Product block per listing item. */
  repeated: number;
}

class UnionFind<T> {
  private parent = new Map<T, T>();
  find(x: T): T {
    let p = this.parent.get(x) ?? x;
    if (p !== x) {
      p = this.find(p);
      this.parent.set(x, p);
    }
    return p;
  }
  union(a: T, b: T) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

const is = (e: Entity, types: string[]) => e.types.some((t) => ancestors(t).some((a) => types.includes(a)));
const literals = (e: Entity, prop: string) =>
  (e.props[prop] ?? []).flatMap((v) => (v.kind === 'literal' && typeof v.value === 'string' && v.value.trim() ? [v.value] : []));
const normUrl = (s: string) => s.trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '');
const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Whether one entity's type is the other's, or an ancestor of it (Organization ~ LocalBusiness). */
function sameKind(a: Entity, b: Entity): boolean {
  return a.types.some((t) =>
    b.types.some((u) => t !== 'Thing' && u !== 'Thing' && (ancestors(t).includes(u) || ancestors(u).includes(t))),
  );
}

/** Whether two entities from different graphs look like the same thing, by url, sameAs or name. */
function looksSame(a: Entity, b: Entity): boolean {
  if (!sameKind(a, b)) return false;
  const urls = (e: Entity) => [...literals(e, 'url'), ...literals(e, 'sameAs')].map(normUrl);
  const ua = new Set(urls(a));
  if (urls(b).some((u) => ua.has(u))) return true;
  // Same name, unless their urls say they're different things.
  if (literals(a, 'url').length && literals(b, 'url').length) return false;
  const na = new Set(literals(a, 'name').map(normName));
  return literals(b, 'name').some((n) => na.has(normName(n)));
}

/**
 * Flags structured data that forms separate graphs (islands) instead of one connected graph:
 * - the same thing defined in two islands without a shared @id (warning);
 * - islands missing a link pages normally have, such as WebPage.isPartOf → WebSite (warning);
 * - any other island not connected to the main graph (info).
 * Islands of the same shape from one source (a listing page's items) are reported once.
 */
export function islandIssues(
  entities: Map<string, Entity>,
  edges: Edge[],
  rootsByBlock: Map<string, string[]>,
  blocks: Block[],
  generators: Map<string, Generator>,
  nonSchemaBlocks: Set<string>,
): Issue[] {
  const label = (bk: string) => blockLabel(bk, generators);
  const identity = sourceIdentity(blocks, generators);
  const describe = (e: Entity) => `${e.types[0] ?? 'Entity'}${e.label ? ` "${clip(e.label, 40)}"` : ''}`;
  const from = (e: Entity) => label(e.definedIn[0]);

  // @graph membership groups nodes in a document; it doesn't link them.
  const links = edges.filter((e) => e.prop !== '@graph' && e.source !== e.target);
  const uf = new UnionFind<string>();
  for (const e of links) uf.union(e.source, e.target);
  const comps = new Map<string, string[]>();
  for (const id of entities.keys()) {
    const r = uf.find(id);
    comps.set(r, [...(comps.get(r) ?? []), id]);
  }

  const targeted = new Set(links.map((e) => e.target));
  const islands: { ids: string[]; top: Entity; shape: string }[] = [];
  for (const ids of comps.values()) {
    const defined = ids.map((id) => entities.get(id)!).filter((e) => !e.stub);
    if (!defined.some((e) => e.definedIn.some((bk) => !nonSchemaBlocks.has(bk)))) continue;
    const heads = defined.filter((e) => !targeted.has(e.id));
    const top = heads.find((e) => !e.blank) ?? heads[0] ?? defined.find((e) => !e.blank) ?? defined[0];
    islands.push({ ids, top, shape: `${identity(top.definedIn[0])}|${[...top.types].sort().join(',')}` });
  }
  if (islands.length < 2) return [];

  const issues: Issue[] = [];
  const units: Unit[] = [];
  const byShape = new Map<string, typeof islands>();
  for (const isl of islands) byShape.set(isl.shape, [...(byShape.get(isl.shape) ?? []), isl]);
  for (const group of byShape.values()) {
    const top = group[0].top;
    units.push({ ids: group.flatMap((g) => g.ids), top, repeated: group.length > 1 && top.types.length ? group.length : 0 });
    if (group.length > 1 && !top.types.length) units.push(...group.slice(1).map((g) => ({ ids: g.ids, top: g.top, repeated: 0 })));
  }
  if (units.length < 2) return [];

  const meta = new UnionFind<number>();
  const pairs = units.flatMap((_, i) => units.slice(i + 1).map((__, k) => [i, i + 1 + k] as const));
  const single = (i: number) => !units[i].repeated;
  const defs = (u: Unit) => u.ids.map((id) => entities.get(id)!).filter((e) => !e.stub);

  for (const u of units) {
    if (!u.repeated) continue;
    issues.push({
      severity: 'info',
      entityId: u.top.id,
      message: `${u.repeated} ${u.top.types[0]} entities from ${identity(u.top.definedIn[0])} each stand alone, not connected to each other or the rest of the page. That's normal for a listing; an ItemList (e.g. as the WebPage's mainEntity) would tie them to the page.`,
    });
  }

  // The same thing defined in two islands: a shared @id merges the entities and joins the graphs.
  const blockRoots = new Set([...rootsByBlock.values()].flat());
  const competing = (a: Entity, b: Entity) =>
    blockRoots.has(a.id) && blockRoots.has(b.id) &&
    identity(a.definedIn[0]) !== identity(b.definedIn[0]) &&
    [...SINGLETONS].some((t) => is(a, [t]) && is(b, [t]));
  for (const [i, j] of pairs) {
    if (!single(i) || !single(j) || meta.find(i) === meta.find(j)) continue;
    let pair: [Entity, Entity] | undefined;
    for (const a of defs(units[i])) {
      const b = defs(units[j]).find((b) => looksSame(a, b));
      if (b) {
        pair = [a, b];
        break;
      }
    }
    if (!pair) continue;
    meta.union(i, j);
    const [a, b] = pair;
    // Two top-level singletons from different sources are already reported as competing definitions.
    if (competing(a, b)) continue;
    const named = !a.blank ? a : !b.blank ? b : undefined;
    const other = named === a ? b : a;
    const fix = named
      ? `Use "@id": "${named.id}" for the one in ${from(other)} so they merge into one entity and the graphs connect.`
      : 'Give both the same @id so they merge into one entity and the graphs connect.';
    issues.push({
      severity: 'warning',
      entityId: a.id,
      message: `${describe(a)} (${from(a)}) and ${describe(b)} (${from(b)}) look like the same thing but are separate entities in unconnected graphs. ${fix}`,
    });
  }

  // Islands missing a link that pages normally have. Each property is suggested once per entity.
  const suggested = new Set<string>();
  for (const [fromType, prop, toTypes] of BRIDGES) {
    for (const [i, j] of pairs) {
      if (!single(i) || !single(j) || meta.find(i) === meta.find(j)) continue;
      let found: [Entity, Entity] | undefined;
      for (const [x, y] of [[i, j], [j, i]]) {
        const a = defs(units[x]).find((e) => is(e, [fromType]) && !e.props[prop] && !suggested.has(`${e.id}|${prop}`));
        const b = a && defs(units[y]).find((e) => is(e, toTypes));
        if (a && b) {
          found = [a, b];
          break;
        }
      }
      if (!found) continue;
      meta.union(i, j);
      const [a, b] = found;
      suggested.add(`${a.id}|${prop}`);
      const fix = b.blank
        ? `Give the ${b.types[0]} an @id and reference it from ${a.types[0]}.${prop}.`
        : `Add "${prop}": { "@id": "${b.id}" } to the ${a.types[0]}.`;
      issues.push({
        severity: 'warning',
        entityId: a.id,
        message: `${describe(a)} (${from(a)}) isn't linked to ${describe(b)} (${from(b)}); they form separate graphs. ${fix}`,
      });
    }
  }

  // Whatever is still apart from the largest graph.
  const groups = new Map<number, number[]>();
  units.forEach((_, i) => groups.set(meta.find(i), [...(groups.get(meta.find(i)) ?? []), i]));
  // A listing's items don't make it the main graph.
  const size = (g: number[]) => g.reduce((n, i) => n + (single(i) ? units[i].ids.length : 0), 0);
  const ranked = [...groups.values()].sort((a, b) => size(b) - size(a) || a[0] - b[0]);
  const main = units[ranked[0].find(single) ?? ranked[0][0]].top;
  for (const g of ranked.slice(1)) {
    const u = units[g.find(single) ?? -1];
    if (!u) continue;
    issues.push({
      severity: 'info',
      entityId: u.top.id,
      message: `${describe(u.top)} (${from(u.top)}) isn't connected to the rest of the page's structured data (${describe(main)}). If it's about this page, reference it by @id from the main graph.`,
    });
  }
  return issues;
}
