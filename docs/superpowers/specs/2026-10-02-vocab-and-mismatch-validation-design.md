# Vocabulary validation and visible-content mismatch: design

Date: 2026-10-02
Roadmap items: FEATURES.md 1.1 (full schema.org vocabulary validation) and 1.3 (markup vs. visible-content mismatch).

## Goal

Make Entity Viewer's validation trustworthy enough to rely on without a second tool:

- **1.1:** flag unknown types, unknown or misspelled properties (with "did you mean"), properties used on the wrong type, values of the wrong kind, invalid enumeration members, and retired or superseded terms.
- **1.3:** flag schema values (prices, ratings, names, headlines, FAQ text) that don't appear in the page's visible text, which Google treats as a spam signal.

Success means the new checks catch real mistakes on real pages without crying wolf. Where schema.org or Google is permissive, the checks are permissive too.

## Decisions

| Question | Decision |
|---|---|
| Value-type strictness | **Lenient.** Flag clear mistakes only. Plain text where an entity is expected is always allowed. |
| Vocabulary layers | Core, pending and the hosted extensions (health-lifesci, bib, auto, meta) are known. Attic terms and terms with `supersededBy` produce an `info`. Anything else is unknown. |
| Vocabulary source | `schemaorg-all-https.jsonld` (the "current" file omits attic), pinned in `vocab/`. |
| Delivery | Preprocessed at build time into compact JSON, imported directly into the sidebar bundle. Validation stays synchronous. |
| Text matching (1.3) | **Forgiving.** Normalized substring match, or an in-order run covering at least 80% of the value's words (values of 4 or more words). |
| Number matching (1.3) | US and European formats, plus rounding to the page's displayed precision (at least 1 decimal place). |

## Architecture

### Files

- `vocab/schemaorg-all-https.jsonld`: the pinned vocabulary. To update schema.org, replace this file and rebuild.
- `scripts/build-vocab.ts`: reads the pinned file and writes `src/lib/vocab.json`. It runs from the `prebuild`, `predev` and `pretest` npm scripts. It fails loudly (non-zero exit) if the file is missing or malformed, then logs the type count, property count and output size.
- `src/lib/vocab.json` (generated) maps:
  - types → `{ parents: string[], layer?: 'pending' | 'attic' | ..., supersededBy?: string, enumeration?: true }`
  - properties → `{ domains: string[], ranges: string[], layer?, supersededBy? }`
  - enumeration types → member names
  - Inherited properties are **not** flattened into this file.
- `src/lib/vocab.ts`: lookups built on `vocab.json`, with results cached:
  - `isType(name)`, `isProperty(name)`
  - `ancestors(type)`: the type itself plus its transitive parent types
  - `propertyAllowedOn(prop, types)`: whether any of the types, or any of their ancestors, is in the property's domains
  - `ranges(prop)`, `enumMembers(type)`
  - `deprecation(term)`: `{ supersededBy?: string; attic?: boolean } | null`
  - `suggest(name, candidates)`: Levenshtein distance, compared case-insensitively. It returns the closest candidate within distance 2, or within 1 for names of 4 characters or fewer, and otherwise returns nothing. An exact case-insensitive match always wins.
- `src/lib/visible.ts`: 1.3 matching.
  - `normalizeText(s)`: NFKC, lowercase, curly quotes to straight, all dashes to `-`, HTML entities decoded, whitespace collapsed.
  - `pageNumbers(text)`: every number token, read in both US and EU formats.
  - `numberAppears(value, numbers)`, `textAppears(value, normalizedPage)`.
- `src/lib/validate.ts`: becomes `validate(entities, opts?: { visibleText?: string; nonSchemaBlocks?: Set<string> })`.
  - `RULES` and the existing format checks stay.
  - `PARENT` is removed. The rule type is found by walking `ancestors(t)` until a type with an entry in `RULES` is reached.
- `src/lib/graph.ts`: collects the keys of JSON-LD blocks whose `@context` is not schema.org, and passes them along with `page.visibleText` to `validate`.
- `src/lib/types.ts`: `PageData` gains `visibleText?: string`.
- `public/extract.js`: adds `visibleText`:
  - `document.body.innerText`, falling back to `textContent` when `innerText` is undefined (jsdom) or throws
  - plus the `alt` and `aria-label` values of elements that are not hidden
  - capped at 2 MB
  - collected inside its own `try`, so a failure only drops `visibleText`
- `src/demo.ts`: unchanged. The demo has no `visibleText`, so the mismatch check skips.

### Data flow

`extract.js` → `PageData { blocks, visibleText }` → `buildGraph` → `validate(entities, { visibleText, nonSchemaBlocks })` → `Issue[]` → the existing Issues view and EntityDetail panel. No UI changes.

## Check rules

### Scope (both features)

These are skipped:

- stub entities (an `@id` that is referenced but never defined)
- terms starting with `@`
- terms that are IRIs or prefixed names (containing `:` or `/`), since they come from other vocabularies
- entities whose every source block is a JSON-LD block with a non-schema.org `@context`

### 1.1 Vocabulary

| Check | Severity | Condition | Message shape |
|---|---|---|---|
| Unknown type | warning | `!isType(t)` | `Unknown type "Prodcut". Did you mean "Product"?` (the suggestion is omitted when there is none) |
| Unknown property | warning | `!isProperty(p)` | `Product.adress is not a schema.org property. Did you mean "address"?` |
| Wrong domain | warning | property known, all entity types known, `!propertyAllowedOn(p, types)` | `price is not a property of Product (it belongs on Offer, …).` (up to 3 domains listed) |
| Ref of wrong type | warning | value is a ref, the target's types are all known, and no ancestor of any target type is in `ranges(p)` | `author points to a Product; expected Person or Organization.` |
| Ref where only a datatype is allowed | warning | value is a ref, and every range is a DataType (Text, URL, Number, Integer, Float, Date, DateTime, Time, Boolean) | `name should be text, not an entity.` (wording follows the range) |
| Literal of the wrong datatype | warning | every range is in one numeric, date or boolean family, the property is not already covered by `DATE_PROPS`, `NUMERIC_PROPS` or the `price` check, and the literal doesn't parse | `Event.maximumAttendeeCapacity should be a number: "lots"` |
| Bad enumeration member | warning | some range is an enumeration, and the literal is a bare name or a `schema.org/` URL that isn't a member of any enumeration range | `"InStok" is not a valid ItemAvailability. Did you mean "InStock"?` |
| Retired or superseded | info | `deprecation(term)` is non-null, for both types and properties | `"X" is superseded by "Y".` / `"X" is retired (attic).` |
| Plain text where an entity is expected | none | allowed (lenient rule) | n/a |

- Boolean literals accept `true`/`false` (case-insensitive) and the `schema.org/True` and `schema.org/False` URLs.
- Each (entity, property, check) pair produces **at most one issue**, regardless of how many values it has.
- Unknown-type and deprecation issues are reported once per entity per type.

### 1.3 Visible-content mismatch

- **Runs only** when `visibleText` is present and the entity has at least one `json-ld` source.
- **Severity:** warning.
- **Message:** `Product.price "19.99" doesn't appear in the page's visible text.`

**Numeric properties:** `price`, `lowPrice`, `highPrice`, `ratingValue`, `ratingCount`, `reviewCount`.

- Page numbers are read in both formats: `1,299.00`, `1.299,00`, `19,99` and `$19.99` all produce the candidate values. Ambiguous `1,299` produces both 1299 and 1.299.
- A value `v` matches if some page number `p` equals it, or if `p` has `d ≥ 1` decimal places and `round(v, d) == p`. So 4.67 matches "4.7" but not "5".
- A price of `0` also matches the word "free".
- A non-numeric value is skipped here, because the existing format checks already flag it.

**Text properties:**

- `name` on Product, Recipe, Event and Course
- `headline` on the Article family (Article and its subtypes)
- `title` on JobPosting
- `name` of a Person or Organization linked from `author` or `reviewer`
- `name` on Question and `text` on Answer

**Text matching:**

- Both sides are normalized.
- A match is either a full substring match, or, when the value has 4 or more words, the longest in-order run of consecutive value words appearing contiguously in the page covers at least 80% of the value's words.
- Values shorter than 4 words need the full substring match.

## Failure handling

- **Build:** a missing or invalid vocabulary file makes the build fail. A build never ships without a vocabulary.
- **Runtime:** a failure while collecting visible text leaves out `visibleText`, and only the mismatch check is skipped.
- **Missing data:** if `vocab.json` lacks a term (for example after a partial edit), the term is treated as unknown. Nothing throws.

## Testing

The tests are written before the code, using `node:test` and `node:assert` run through `tsx`. `npm test` runs every `test/*.test.ts` and then the existing `test/run.ts` smoke script.

- `test/vocab.test.ts`
  - ancestors and inherited properties: `NewsArticle` reaches `Article`, `CreativeWork` and `Thing`, and `name` is allowed on `Product`
  - known vs. unknown terms
  - pending terms count as known
  - superseded and attic flags
  - suggestion thresholds, and case-only mismatches
- `test/visible.test.ts`
  - normalization
  - number formats
  - rounding (positive and negative cases)
  - "free" for a price of 0
  - the 80% run rule, including a suffix like " | Brand", and a short-value full-match requirement
- `test/validate.test.ts`: a positive and a negative fixture for every row of the 1.1 table and every 1.3 property group. Also:
  - the lenient author-string case passes
  - `NewsArticle` still gets the Article `RULES`
  - no duplicate issues
  - non-schema.org terms and contexts are skipped
  - the mismatch check is skipped without `visibleText`
- `test/extract.test.ts`: runs `extract.js` in jsdom on the fixture and checks that `visibleText` exists and includes `aria-label` and `alt` text.

## Documentation

- **README:**
  - Update **Limits**: remove the "doesn't validate against the full vocabulary" line, and add that the mismatch check can't see iframes or shadow DOM and doesn't parse compact counts ("1.2K").
  - Add a **Features** entry for both checks.
  - Add a note on updating the vocabulary file.
- **FEATURES.md:** mark 1.1 and 1.3 as done.

## Out of scope

- The 1.2 eligibility verdicts
- UI changes
- The version bump (do it before the next AMO submission)
- Flattened inherited-property tables
- Compact-number parsing ("1.2K")
