import type { Entity, Issue, PropValue } from './types';
import {
  ancestors, deprecation, domains, enumMembers, isEnumeration, isProperty, isType, propertyAllowedOn,
  propertyNames, ranges, suggest, typeNames,
} from './vocab';
import { normalizeText, numberAppears, pageNumbers, textAppears } from './visible';

/**
 * Expected properties per type, loosely following Google's rich-result docs.
 * A string[] entry means "at least one of". These are SEO expectations, not
 * schema.org conformance rules.
 */
type Rule = (string | string[])[];

const RULES: Record<string, Rule> = {
  Organization: ['name', 'url'],
  LocalBusiness: ['name', 'address'],
  Person: ['name'],
  WebSite: ['name', 'url'],
  Article: ['headline', 'image', 'datePublished', 'author'],
  Product: ['name', ['offers', 'review', 'aggregateRating']],
  Offer: ['price', 'priceCurrency'],
  AggregateOffer: ['lowPrice', 'priceCurrency'],
  AggregateRating: ['ratingValue', ['ratingCount', 'reviewCount']],
  Review: ['author', 'reviewRating'],
  Rating: ['ratingValue'],
  Event: ['name', 'startDate', 'location'],
  FAQPage: ['mainEntity'],
  Question: ['name', 'acceptedAnswer'],
  Answer: ['text'],
  BreadcrumbList: ['itemListElement'],
  ListItem: ['position'],
  Recipe: ['name', 'image'],
  JobPosting: ['title', 'description', 'datePosted', 'hiringOrganization', 'jobLocation'],
  VideoObject: ['name', 'thumbnailUrl', 'uploadDate'],
  PostalAddress: [['streetAddress', 'addressLocality']],
  ImageObject: [['url', 'contentUrl']],
  SoftwareApplication: ['name', ['offers', 'aggregateRating', 'review']],
  Course: ['name', 'description', 'provider'],
};

const DATE_PROPS = new Set([
  'datePublished', 'dateModified', 'dateCreated', 'startDate', 'endDate', 'uploadDate',
  'datePosted', 'validThrough', 'validFrom', 'priceValidUntil', 'birthDate', 'foundingDate',
]);
const URL_PROPS = new Set(['url', 'image', 'logo', 'sameAs', 'thumbnailUrl', 'contentUrl', 'embedUrl', 'item']);
const NUMERIC_PROPS = new Set(['ratingValue', 'ratingCount', 'reviewCount', 'bestRating', 'worstRating', 'position', 'lowPrice', 'highPrice']);
const ISO_DATE = /^\d{4}(-\d{2}(-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?)?)?$/;
const ISO_DURATION = /^P/;
const ISO_TIME = /^\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const BOOLEAN = /^(true|false|https?:\/\/schema\.org\/(true|false))$/i;
const SCHEMA_URL = /^https?:\/\/schema\.org\/([^/?#]+)$/i;

/** Properties compared with the page's visible text as numbers. */
const VISIBLE_NUMERIC = ['price', 'lowPrice', 'highPrice', 'ratingValue', 'ratingCount', 'reviewCount'];
/** Text properties compared with the visible text, by the type (or ancestor type) that carries them. */
const VISIBLE_TEXT: [string, string][] = [
  ['Product', 'name'], ['Recipe', 'name'], ['Event', 'name'], ['Course', 'name'],
  ['Article', 'headline'], ['JobPosting', 'title'], ['Question', 'name'], ['Answer', 'text'],
];

export interface ValidateOptions {
  /** The page's visible text. Without it the mismatch check is skipped. */
  visibleText?: string;
  /** Keys of blocks whose @context isn't schema.org. Entities only from these are not vocabulary-checked. */
  nonSchemaBlocks?: Set<string>;
}

type Family = 'text' | 'number' | 'date' | 'boolean';
const FAMILY_ROOTS: [string, Family][] = [
  ['Text', 'text'], ['Number', 'number'], ['Date', 'date'], ['DateTime', 'date'], ['Time', 'date'], ['Boolean', 'boolean'],
];
const familyOf = (type: string): Family | undefined => {
  const anc = ancestors(type);
  return FAMILY_ROOTS.find(([root]) => anc.includes(root))?.[1];
};
const isDataType = (type: string) => type === 'DataType' || familyOf(type) !== undefined;

/** Terms from other vocabularies (IRIs, prefixed names) and JSON-LD keywords. */
const foreign = (term: string) => term.startsWith('@') || /[:/]/.test(term) || term === '(cycle)';
/** Action annotations like "query-input" (schema.org's "-input"/"-output" convention). */
const ACTION_IO = /^(.+)-(input|output)$/;

const orList = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`);
const aOrAn = (s: string) => (/^[AEIOU]/i.test(s) ? `an ${s}` : `a ${s}`);
const didYouMean = (s: string | undefined) => (s ? ` Did you mean "${s}"?` : '');
const literalString = (v: PropValue) => (v.kind === 'literal' && v.value !== null ? String(v.value).trim() : '');

function datatypePhrase(rs: string[]): string {
  const fam = familyOf(rs[0]);
  if (fam === 'number') return 'a number';
  if (fam === 'boolean') return 'true or false';
  if (fam === 'date') return 'a date';
  return rs.some((r) => ancestors(r).includes('URL')) ? 'a URL' : 'text';
}

function datePhrase(rs: string[]): string {
  const hasTime = rs.some((r) => ancestors(r).includes('Time'));
  const hasDate = rs.some((r) => !ancestors(r).includes('Time'));
  return hasDate && hasTime ? 'an ISO 8601 date or time' : hasTime ? 'an ISO 8601 time' : 'an ISO 8601 date';
}

/** The single datatype family every range belongs to, if there is one (and it's checkable). */
function literalFamily(rs: string[]): Exclude<Family, 'text'> | undefined {
  const fams = new Set(rs.map(familyOf));
  if (fams.size !== 1) return undefined;
  const [fam] = fams;
  return fam === 'text' ? undefined : fam;
}

function literalOk(fam: Exclude<Family, 'text'>, v: PropValue & { kind: 'literal' }, s: string): boolean {
  if (fam === 'number') return typeof v.value === 'number' || NUMBER.test(s);
  if (fam === 'boolean') return typeof v.value === 'boolean' || BOOLEAN.test(s);
  return ISO_DATE.test(s) || ISO_TIME.test(s);
}

const literals = (e: Entity, prop: string) =>
  (e.props[prop] ?? []).flatMap((v) => (v.kind === 'literal' ? [v.value] : []));

export function validate(entities: Map<string, Entity>, opts: ValidateOptions = {}): Issue[] {
  const issues: Issue[] = [];
  const nonSchema = opts.nonSchemaBlocks ?? new Set<string>();
  const visible = opts.visibleText === undefined ? undefined : {
    text: normalizeText(opts.visibleText),
    numbers: pageNumbers(opts.visibleText),
  };

  // Entities named as an author or reviewer get their name checked against the page.
  const credited = new Set<string>();
  for (const e of entities.values()) {
    for (const p of ['author', 'reviewer']) for (const v of e.props[p] ?? []) if (v.kind === 'ref') credited.add(v.id);
  }

  for (const e of entities.values()) {
    if (e.stub) continue;
    const typeLabel = e.types.join(', ') || 'Entity';

    if (!e.types.length) {
      issues.push({ severity: 'warning', entityId: e.id, message: `Entity has no @type (${e.label || e.id}).` });
    }

    // Expected properties
    const checked = new Set<string>();
    for (const t of e.types) {
      const ruleType = ancestors(t).find((a) => RULES[a]);
      if (!ruleType || checked.has(ruleType)) continue;
      checked.add(ruleType);
      for (const req of RULES[ruleType]) {
        const opts = Array.isArray(req) ? req : [req];
        if (!opts.some((p) => (e.props[p] ?? []).length)) {
          issues.push({
            severity: 'warning',
            entityId: e.id,
            message: `${t} is missing ${opts.map((p) => `"${p}"`).join(' or ')}.`,
          });
        }
      }
    }

    for (const [prop, vals] of Object.entries(e.props)) {
      for (const v of vals) {
        if (v.kind !== 'literal') continue;
        const s = v.value === null ? '' : String(v.value).trim();
        if (!s) {
          issues.push({ severity: 'info', entityId: e.id, message: `${typeLabel}.${prop} is empty.` });
          continue;
        }
        if (DATE_PROPS.has(prop) && !ISO_DATE.test(s)) {
          issues.push({ severity: 'warning', entityId: e.id, message: `${typeLabel}.${prop} is not ISO 8601: "${s}"` });
        }
        if (URL_PROPS.has(prop) && typeof v.value === 'string' && !/^https?:\/\//i.test(s) && !(prop === 'item' && s.startsWith('#'))) {
          issues.push({ severity: 'warning', entityId: e.id, message: `${typeLabel}.${prop} is not an absolute URL: "${s}"` });
        }
        if (NUMERIC_PROPS.has(prop) && Number.isNaN(Number(s))) {
          issues.push({ severity: 'warning', entityId: e.id, message: `${typeLabel}.${prop} should be numeric: "${s}"` });
        }
        if (prop === 'price' && !/^\d+(\.\d+)?$/.test(s)) {
          issues.push({
            severity: 'warning',
            entityId: e.id,
            message: `${typeLabel}.price should be a plain number (no currency symbol or thousands separator): "${s}"`,
          });
        }
        if (prop === 'priceCurrency' && !/^[A-Z]{3}$/.test(s)) {
          issues.push({ severity: 'warning', entityId: e.id, message: `${typeLabel}.priceCurrency should be an ISO 4217 code: "${s}"` });
        }
        if ((prop === 'duration' || prop === 'cookTime' || prop === 'prepTime' || prop === 'totalTime') && !ISO_DURATION.test(s)) {
          issues.push({ severity: 'warning', entityId: e.id, message: `${typeLabel}.${prop} should be an ISO 8601 duration (e.g. PT30M): "${s}"` });
        }
      }
    }

    // Rating sanity
    const rv = Number(literals(e, 'ratingValue')[0]);
    const best = Number(literals(e, 'bestRating')[0] ?? 5);
    const worst = Number(literals(e, 'worstRating')[0] ?? 1);
    if (!Number.isNaN(rv) && literals(e, 'ratingValue').length && (rv > best || rv < worst)) {
      issues.push({ severity: 'warning', entityId: e.id, message: `ratingValue ${rv} is outside ${worst}–${best}.` });
    }

    if (e.sources.length && e.sources.every((s) => nonSchema.has(s))) continue;
    issues.push(...vocabIssues(e, entities, typeLabel));
    if (visible && e.sources.some((s) => s.startsWith('json-ld'))) {
      issues.push(...visibleIssues(e, typeLabel, visible, credited.has(e.id)));
    }
  }
  return issues;
}

/** Collects issues for one entity, at most one per key. */
function reporter(e: Entity) {
  const issues: Issue[] = [];
  const seen = new Set<string>();
  const report = (key: string, severity: Issue['severity'], message: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    issues.push({ severity, entityId: e.id, message });
  };
  return { issues, report };
}

function deprecationMessage(term: string): string | undefined {
  const d = deprecation(term);
  if (!d) return undefined;
  return d.supersededBy ? `"${term}" is superseded by "${d.supersededBy}".` : `"${term}" is retired (attic).`;
}

/** 1.1: checks against the full schema.org vocabulary. */
function vocabIssues(e: Entity, entities: Map<string, Entity>, typeLabel: string): Issue[] {
  const { issues, report } = reporter(e);

  for (const t of e.types) {
    if (foreign(t)) continue;
    if (!isType(t)) {
      report(`type:${t}`, 'warning', `Unknown type "${t}".${didYouMean(suggest(t, typeNames()))}`);
      continue;
    }
    const dep = deprecationMessage(t);
    if (dep) report(`type-dep:${t}`, 'info', dep);
  }
  const typesKnown = e.types.length > 0 && e.types.every(isType);

  for (const [prop, vals] of Object.entries(e.props)) {
    if (foreign(prop)) continue;
    const io = prop.match(ACTION_IO);
    if (io && isProperty(io[1])) continue;
    if (!isProperty(prop)) {
      report(`${prop}|unknown`, 'warning', `${typeLabel}.${prop} is not a schema.org property.${didYouMean(suggest(prop, propertyNames()))}`);
      continue;
    }
    const dep = deprecationMessage(prop);
    if (dep) report(`${prop}|dep`, 'info', dep);

    const ds = domains(prop);
    if (typesKnown && ds.length && !propertyAllowedOn(prop, e.types)) {
      const where = ds.slice(0, 3).join(', ') + (ds.length > 3 ? ', …' : '');
      report(`${prop}|domain`, 'warning', `${prop} is not a property of ${typeLabel} (it belongs on ${where}).`);
    }

    const rs = ranges(prop);
    if (!rs.length) continue;
    const onlyData = rs.every(isDataType);
    const fam = literalFamily(rs);
    const enums = rs.filter(isEnumeration);
    const textAllowed = rs.some((r) => familyOf(r) === 'text');

    for (const v of vals) {
      if (v.kind === 'ref') {
        const target = entities.get(v.id);
        if (onlyData) {
          // A bare IRI ({"@id": ...}) is a fine value for a URL.
          if (target?.stub && rs.some((r) => ancestors(r).includes('URL'))) continue;
          report(`${prop}|dataref`, 'warning', `${prop} should be ${datatypePhrase(rs)}, not an entity.`);
        } else if (target && !target.stub && target.types.length && target.types.every(isType)) {
          const fits = target.types.some((t) => ancestors(t).some((a) => rs.includes(a)));
          if (!fits) {
            const expected = orList(rs.filter((r) => !isDataType(r)));
            report(`${prop}|reftype`, 'warning', `${prop} points to ${aOrAn(target.types.join(', '))}; expected ${expected}.`);
          }
        }
        continue;
      }

      const s = literalString(v);
      if (!s) continue;
      if (fam && !DATE_PROPS.has(prop) && !NUMERIC_PROPS.has(prop) && prop !== 'price' && !literalOk(fam, v, s)) {
        const want = fam === 'number' ? 'a number' : fam === 'boolean' ? 'true or false' : datePhrase(rs);
        report(`${prop}|datatype`, 'warning', `${typeLabel}.${prop} should be ${want}: "${s}"`);
      }
      if (enums.length && typeof v.value === 'string') {
        const url = s.match(SCHEMA_URL);
        const name = url ? url[1] : !textAllowed && /^[A-Za-z]\w*$/.test(s) ? s : undefined;
        const members = enums.flatMap(enumMembers);
        if (name && !members.includes(name)) {
          report(`${prop}|enum`, 'warning', `"${s}" is not a valid ${orList(enums)}.${didYouMean(suggest(name, members))}`);
        }
      }
    }
  }
  return issues;
}

/** 1.3: schema values that don't appear in the page's visible text. */
function visibleIssues(
  e: Entity,
  typeLabel: string,
  page: { text: string; numbers: ReturnType<typeof pageNumbers> },
  isCredited: boolean,
): Issue[] {
  const { issues, report } = reporter(e);
  const missing = (prop: string, s: string) =>
    report(`${prop}|visible`, 'warning', `${typeLabel}.${prop} "${s}" doesn't appear in the page's visible text.`);

  for (const prop of VISIBLE_NUMERIC) {
    for (const v of e.props[prop] ?? []) {
      if (v.kind !== 'literal') continue;
      const s = literalString(v);
      const n = typeof v.value === 'number' ? v.value : NUMBER.test(s) ? Number(s) : NaN;
      if (Number.isNaN(n)) continue; // non-numeric values are flagged by the format checks
      if (!numberAppears(n, page.numbers, page.text)) missing(prop, s);
    }
  }

  const anc = new Set(e.types.flatMap(ancestors));
  const props = new Set(VISIBLE_TEXT.filter(([t]) => anc.has(t)).map(([, p]) => p));
  if (isCredited && (anc.has('Person') || anc.has('Organization'))) props.add('name');
  for (const prop of props) {
    for (const v of e.props[prop] ?? []) {
      if (v.kind !== 'literal' || typeof v.value !== 'string') continue;
      const s = v.value.trim();
      if (s && !textAppears(s, page.text)) missing(prop, s);
    }
  }
  return issues;
}
