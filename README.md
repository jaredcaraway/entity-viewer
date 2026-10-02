# Entity Viewer for Firefox

A Firefox sidebar extension that finds the structured data on a page and shows it as an entity graph. It reads JSON-LD, Microdata and RDFa, merges nodes that share an `@id` across blocks, and flags SEO problems.

## Install for testing

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and select `entity-viewer-firefox.zip`, or `dist/manifest.json` if you built from source.
3. Click the toolbar icon or press **Alt+Shift+E** to open the sidebar.
4. The first time, click **Grant access to websites**. Firefox treats host access as opt-in for Manifest V3 extensions.

Temporary add-ons are removed when Firefox restarts. To install it permanently, sign it through AMO. Unlisted self-distribution works fine for personal use: `npx web-ext sign --channel=unlisted`.

## Features

- **Graph:** a Cytoscape view with four layouts (Force, Tree, Rings, Circle).
  - Root entities are drawn bold; `@id`s that are referenced but never defined are drawn dashed.
  - Entities with issues get a red or amber outline.
  - Click a node to open its details and highlight its neighbours.
  - Export the graph as a PNG.
- **Tree:** a collapsible hierarchy starting from the root entities. Cycles are detected and not expanded again.
- **Issues:** problems grouped by severity. Click one to jump to the entity it belongs to. Checks include:
  - JSON parse errors;
  - missing or non-schema.org `@context`;
  - `@id` references that are never defined on the page, and `@id`s defined with conflicting types;
  - properties Google expects for rich results, for about 25 types plus common subtypes (MedicalClinic, Physician, HVACBusiness, and so on);
  - dates and durations that aren't ISO 8601, relative URLs, prices containing currency symbols, `priceCurrency` values that aren't ISO 4217, and ratings out of range;
  - **schema.org vocabulary:** unknown types and properties (with "did you mean" suggestions), properties used on the wrong type, references to the wrong kind of entity, entities where only text, numbers or dates are allowed, invalid enumeration values (`"InStok"`), and retired or superseded terms. Checks are lenient: plain text where an entity is expected is always allowed;
  - **competing sources:** the same `@id` given different values by different blocks (e.g. Yoast and Rank Math disagreeing on the Organization's `name`), separate entities of a once-per-page type (Product, Organization, WebPage, BreadcrumbList, Article…) from different plugins or templates, and entities assembled from several sources;
  - **JavaScript-injected blocks:** JSON-LD that isn't in the HTML the server sent, which crawlers that don't run scripts won't see, and server-sent blocks that scripts removed;
  - **markup vs. visible content:** prices, ratings and review counts, product, recipe, event and course names, article headlines, job titles, author and reviewer names, and FAQ questions and answers that don't appear in the page's visible text, which Google treats as a spam signal. Number matching accepts US and European formats and the page's displayed rounding.
- **Raw:** every extracted block, with a copy button. JSON-LD blocks show:
  - the plugin, app or platform that wrote them, detected from the script's `id`/`class`/`data-*` attributes (`yoast-schema-graph`, `rank-math-schema`, `aioseo-schema`…), Shopify section and app-block wrappers, the opening and closing comments a plugin wraps around its script ("optimized with the Yoast SEO plugin") and `@id` patterns (Yoast's `#/schema/person/`). Block labels read e.g. "json-ld#2 · Rank Math" throughout;
  - whether the block was in the HTML the server sent, changed by JavaScript or added by JavaScript. The sidebar reads the page's HTML from the HTTP cache, inside the tab, to compare. If it isn't cached, a **Request page** button fetches it again; this never happens automatically, so one-time links (logins, unsubscribes) aren't repeated.
- **Entity detail:** when several blocks define one entity, each value shows the block it came from.
- **Export menu:** download the merged graph as `.jsonld`, or open the page in the Schema Markup Validator or Google's Rich Results Test.
- **Toolbar badge:** shows the entity count for each tab, and turns red when a block fails to parse.
- **Live updates:** the sidebar re-scans when you switch tabs or a page finishes loading. Use the refresh button for schema that a single-page app injects later.

## Develop

```bash
npm install
npm run build      # outputs the loadable extension to dist/
npm run dev        # rebuilds on change; click "Reload" in about:debugging
npm test           # unit tests (test/*.test.ts), then the extractor smoke run on test/fixture.html
npx vite           # runs the sidebar UI in a normal browser with demo data
npm run zip        # packages dist/ as entity-viewer-firefox.zip
```

Built with React, Mantine 9 (custom "lagoon" teal theme with navy-tinted dark mode), Tabler icons and Cytoscape.js. All libraries are bundled into the extension, which AMO requires: no code is loaded remotely.

### Layout

| Path | Role |
|---|---|
| `public/manifest.json` | MV3 manifest with `sidebar_action` and the Gecko ID |
| `public/extract.js` | Injected on demand. Plain JS that returns `{url, title, blocks[]}` |
| `public/background.js` | Toggles the sidebar from the toolbar button and keeps the badge count updated |
| `src/lib/graph.ts` | Normalizes blocks into entities and edges, and merges nodes by `@id` |
| `src/lib/provenance.ts` | Generator detection, and the comparison with the HTML the server sent |
| `src/lib/competing.ts` | Checks for blocks that compete to define the same entity |
| `src/lib/validate.ts` | SEO rules, vocabulary checks and the visible-content check. Add types to `RULES`; subtypes inherit rules through the vocabulary |
| `src/lib/vocab.ts` | Lookups over the bundled schema.org vocabulary |
| `src/lib/visible.ts` | Text and number matching against the page's visible text |
| `vocab/schemaorg-all-https.jsonld` | The pinned schema.org vocabulary. `scripts/build-vocab.ts` turns it into `src/lib/vocab.json` before every build, dev and test run |

### Updating the schema.org vocabulary

Download the latest `schemaorg-all-https.jsonld` from [schema.org/docs/developers.html](https://schema.org/docs/developers.html), replace `vocab/schemaorg-all-https.jsonld`, and rebuild. Use the "all" file, not "current": it includes the attic terms, which the extension reports as retired. The build fails if the file is missing or malformed.
| `src/components/*` | Graph, Tree, Issues, Raw and EntityDetail views |

## License

[MIT](LICENSE)

## Limits

- The visible-content check reads the page's rendered text. It can't see text inside iframes or shadow DOM, doesn't parse compact counts ("1.2K"), and content hidden in collapsed accordions or tabs counts as not visible.
- Generator detection relies on markup that plugins add. Blocks a plugin writes without markers, or that a tag manager injects, show no generator. The origin check marks those as added by JavaScript but can't name the script that added them.
- The server-vs-live comparison re-requests the page. Pages that vary per request (nonces, timestamps inside JSON-LD) may show as "changed by JS".
- RDFa support covers RDFa Lite (`vocab`, `typeof`, `property`, `resource`, `prefix`), not all of RDFa 1.1.
- Vocabulary checks cover schema.org (core, pending and the hosted extensions). Terms from other vocabularies are skipped.
- Before publishing, change the Gecko ID in the manifest if you won't use `jaredcaraway.com`.
