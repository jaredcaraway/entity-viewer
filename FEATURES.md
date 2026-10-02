# Feature Roadmap

Candidate features to make Entity Viewer useful to SEOs and developers beyond personal use. Ordered by priority. Current state: v0.1.1, signed unlisted on AMO (see README for what exists today).

**Start here:** the top two items, full vocabulary validation (1.1) and the page-content mismatch check (1.3). The first gets the extension to parity with competitors; the second is a differentiator almost no other tool has.

## 1. Trustworthy validation

### 1.1 Full schema.org vocabulary validation — TOP PRIORITY
- Bundle the schema.org vocabulary (`schemaorg-current-https.jsonld`, about 1 MB; bundling is fine and AMO forbids remote code anyway). Preprocess it at build time into a compact map of types → allowed properties (including inherited ones) and properties → expected value types.
- Flag unknown types, unknown or misspelled properties with "did you mean" suggestions (`adress` → `address`, via edit distance), and values whose type doesn't match the property's range.
- Where it plugs in: `src/lib/validate.ts`. The existing `PARENT` subtype map could come from the vocabulary instead of being maintained by hand.
- Afterwards, update the "Limits" section of the README.

### 1.2 Rich-result eligibility verdict per entity
- For example: "Product: eligible for merchant listing" or "Missing `offers` → not eligible".
- Builds on the existing `RULES` in `validate.ts` (about 25 types). Split each type's rules into required and recommended, and show a verdict badge in `EntityDetail` and the Issues view.

### 1.3 Markup vs. visible-content mismatch — TOP PRIORITY
- Flag schema values that don't appear in the page's visible text: `price`, `ratingValue`, `reviewCount`, `name`, `headline`, `author` name, and so on. Google treats this mismatch as a spam signal.
- Implementation: in `public/extract.js`, also return the page's normalized visible text (`document.body.innerText`, or a trimmed or hashed version). Compare with normalization: strip whitespace and case, and accept number formats like `19.99` vs. `$19.99` vs. `19,99`.
- Severity: a warning rather than an error, since some values legitimately aren't visible (`sku`, `gtin`, ISO dates).

## 2. Lean into the graph (the differentiator)

### 2.1 Graph coverage hints
- "Organization has no `logo`", "WebPage not linked to WebSite via `isPartOf`", "Article `author` isn't a Person entity", "3 disconnected subgraphs; consider linking them with `@id`".
- Graph analysis belongs in `src/lib/graph.ts`, and its output can appear as `info`-level issues.

### 2.2 Compare two pages or versions
- Diff the entity graph of the current scan against the previous scan of the same URL, or against another URL (staging vs. production). Show added, removed and changed entities and properties.
- Storing previous scans requires adding the `storage` permission to the manifest.

## 3. Fix, don't just report

### 3.1 Quick-fix snippets
- For each issue, show a corrected JSON-LD fragment with a copy button (for example, with the missing `priceCurrency` added or the date converted to ISO 8601).

### 3.2 Edit and re-test in place
- An editable JSON-LD pane in the sidebar that re-validates as you type. Optionally, inject the edited block into the page to preview it.

## 4. Agency workflow

### 4.1 Client-ready report export
- HTML (and/or printable PDF) containing the page URL, eligibility verdicts, issues by severity, a PNG of the graph (PNG export already exists) and the raw JSON-LD.

### 4.2 Batch scan
- Crawl the first N internal links (or URLs from `sitemap.xml`) and show a summary table of which pages or templates are missing which schema and which issues repeat across them.

## 5. Reach

- **List publicly on AMO** instead of unlisted. Needs listing copy, screenshots and a demo GIF that leads with the graph view.
- **Chrome port.** Most SEOs use Chrome. MV3 `side_panel` replaces `sidebar_action`, and the `browser.*` calls in `src/lib/browser.ts` and `public/background.js` need a `chrome.*` shim. The React UI carries over unchanged.
- Remember to bump `version` in both `public/manifest.json` and `package.json` before each AMO submission (AMO rejects duplicate versions).
