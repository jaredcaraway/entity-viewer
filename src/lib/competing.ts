import type { Block, Entity, Generator, Issue, PropValue } from './types';
import { ancestors } from './vocab';
import { blockLabel } from './provenance';
import { blockKey, clip } from './util';

/** Types a page normally defines once. Two of them from different sources are probably competing. */
export const SINGLETONS = new Set([
  'WebSite', 'WebPage', 'Organization', 'Product', 'BreadcrumbList', 'Article', 'FAQPage', 'Recipe', 'Event',
  'JobPosting', 'Course', 'SoftwareApplication',
]);

/**
 * What counts as one source: blocks from one generator, or unattributed blocks of one syntax.
 * A listing page that writes one JSON-LD block per item isn't competing with itself.
 */
export function sourceIdentity(blocks: Block[], generators: Map<string, Generator>): (bk: string) => string {
  const kind = new Map(blocks.map((b) => [blockKey(b), b.source]));
  return (bk) => generators.get(bk)?.name ?? kind.get(bk) ?? bk;
}

const compareKey = (v: PropValue) => (v.kind === 'ref' ? `ref:${v.id}` : `lit:${String(v.value ?? '').trim()}`);

/**
 * Flags blocks that compete to define the same thing:
 * - the same @id given different values for a property by different blocks;
 * - separate entities of a type a page normally has once (Product, Organization…), from different sources;
 * - entities pieced together from several sources (info).
 */
export function competingIssues(
  entities: Map<string, Entity>,
  rootsByBlock: Map<string, string[]>,
  blocks: Block[],
  generators: Map<string, Generator>,
): Issue[] {
  const issues: Issue[] = [];
  const label = (bk: string) => blockLabel(bk, generators);
  const identity = sourceIdentity(blocks, generators);
  const show = (v: PropValue) => {
    if (v.kind === 'literal') return `"${clip(String(v.value), 40)}"`;
    const t = entities.get(v.id);
    return t?.label ? `→ ${clip(t.label, 40)}` : `→ ${clip(v.id, 40)}`;
  };

  for (const e of entities.values()) {
    if (e.stub || e.definedIn.length < 2) continue;
    const typeLabel = e.types.join(', ') || 'Entity';
    let conflicted = false;

    for (const [prop, vals] of Object.entries(e.props)) {
      // Nested blank nodes get a new id per occurrence, so they can't be compared.
      if (vals.some((v) => v.kind === 'ref' && entities.get(v.id)?.blank)) continue;
      const byBlock = new Map<string, PropValue[]>();
      for (const v of vals) for (const bk of v.from ?? []) byBlock.set(bk, [...(byBlock.get(bk) ?? []), v]);
      if (byBlock.size < 2) continue;
      const sets = [...byBlock.values()].map((vs) => [...new Set(vs.map(compareKey))].sort().join('\u0000'));
      if (new Set(sets).size < 2) continue;
      conflicted = true;
      if ([...byBlock.values()].every((vs) => vs.length === 1)) {
        const pairs = [...byBlock].map(([bk, [v]]) => `${show(v)} (${label(bk)})`);
        issues.push({ severity: 'warning', entityId: e.id, message: `${typeLabel}.${prop} differs between sources: ${pairs.join(' vs ')}.` });
      } else {
        const from = [...byBlock.keys()].map(label).join(', ');
        issues.push({ severity: 'info', entityId: e.id, message: `${typeLabel}.${prop} combines different values from ${from}.` });
      }
    }

    const sources = new Set(e.definedIn.map(identity));
    if (!conflicted && sources.size > 1) {
      issues.push({
        severity: 'info',
        entityId: e.id,
        message: `${typeLabel} is assembled from several sources: ${e.definedIn.map(label).join(', ')}.`,
      });
    }
  }

  const byType = new Map<string, { id: string; bk: string }[]>();
  for (const [bk, roots] of rootsByBlock) {
    for (const id of new Set(roots)) {
      const e = entities.get(id);
      if (!e || e.stub || !e.definedIn.includes(bk)) continue;
      const type = e.types.flatMap(ancestors).find((t) => SINGLETONS.has(t));
      if (type) byType.set(type, [...(byType.get(type) ?? []), { id, bk }]);
    }
  }
  for (const [type, found] of byType) {
    const ids = new Set(found.map((f) => f.id));
    if (ids.size < 2 || new Set(found.map((f) => identity(f.bk))).size < 2) continue;
    const from = [...new Set(found.map((f) => f.bk))].map(label).join(', ');
    issues.push({
      severity: 'warning',
      entityId: found[0].id,
      message: `${ids.size} separate ${type} entities come from different sources: ${from}. Search engines may read them as competing definitions; keep one, or merge them with a shared @id.`,
    });
  }
  return issues;
}
