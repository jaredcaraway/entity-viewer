import type { Entity, Issue } from './types';

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

/** Minimal subtype → rule-type mapping for common types. */
const PARENT: Record<string, string> = {
  NewsArticle: 'Article', BlogPosting: 'Article', TechArticle: 'Article', ScholarlyArticle: 'Article', Report: 'Article',
  Corporation: 'Organization', NGO: 'Organization', EducationalOrganization: 'Organization', MedicalOrganization: 'Organization',
  NewsMediaOrganization: 'Organization', OnlineStore: 'Organization',
  MedicalClinic: 'LocalBusiness', Hospital: 'LocalBusiness', Physician: 'LocalBusiness', Dentist: 'LocalBusiness',
  Pharmacy: 'LocalBusiness', Optician: 'LocalBusiness', Restaurant: 'LocalBusiness', CafeOrCoffeeShop: 'LocalBusiness',
  BarOrPub: 'LocalBusiness', FoodEstablishment: 'LocalBusiness', Store: 'LocalBusiness', AutoDealer: 'LocalBusiness',
  AutoRepair: 'LocalBusiness', HomeAndConstructionBusiness: 'LocalBusiness', HVACBusiness: 'LocalBusiness',
  Plumber: 'LocalBusiness', Electrician: 'LocalBusiness', RoofingContractor: 'LocalBusiness', LegalService: 'LocalBusiness',
  Attorney: 'LocalBusiness', FinancialService: 'LocalBusiness', RealEstateAgent: 'LocalBusiness', HealthAndBeautyBusiness: 'LocalBusiness',
  ProfessionalService: 'LocalBusiness', LodgingBusiness: 'LocalBusiness', Hotel: 'LocalBusiness', SportsActivityLocation: 'LocalBusiness',
  ProductGroup: 'Product', IndividualProduct: 'Product', ProductModel: 'Product',
  EmployerAggregateRating: 'AggregateRating', CriticReview: 'Review',
  BusinessEvent: 'Event', MusicEvent: 'Event', SportsEvent: 'Event', EducationEvent: 'Event', Festival: 'Event',
  MobileApplication: 'SoftwareApplication', WebApplication: 'SoftwareApplication', VideoGame: 'SoftwareApplication',
};

const DATE_PROPS = new Set([
  'datePublished', 'dateModified', 'dateCreated', 'startDate', 'endDate', 'uploadDate',
  'datePosted', 'validThrough', 'validFrom', 'priceValidUntil', 'birthDate', 'foundingDate',
]);
const URL_PROPS = new Set(['url', 'image', 'logo', 'sameAs', 'thumbnailUrl', 'contentUrl', 'embedUrl', 'item']);
const NUMERIC_PROPS = new Set(['ratingValue', 'ratingCount', 'reviewCount', 'bestRating', 'worstRating', 'position', 'lowPrice', 'highPrice']);
const ISO_DATE = /^\d{4}(-\d{2}(-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?)?)?$/;
const ISO_DURATION = /^P/;

const literals = (e: Entity, prop: string) =>
  (e.props[prop] ?? []).flatMap((v) => (v.kind === 'literal' ? [v.value] : []));

export function validate(entities: Map<string, Entity>): Issue[] {
  const issues: Issue[] = [];
  for (const e of entities.values()) {
    if (e.stub) continue;
    const typeLabel = e.types.join(', ') || 'Entity';

    if (!e.types.length) {
      issues.push({ severity: 'warning', entityId: e.id, message: `Entity has no @type (${e.label || e.id}).` });
    }

    // Expected properties
    const checked = new Set<string>();
    for (const t of e.types) {
      const ruleType = RULES[t] ? t : PARENT[t];
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
  }
  return issues;
}
