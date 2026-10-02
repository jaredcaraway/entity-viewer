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
  - dates and durations that aren't ISO 8601, relative URLs, prices containing currency symbols, `priceCurrency` values that aren't ISO 4217, and ratings out of range.
- **Raw:** every extracted block, with a copy button.
- **Export menu:** download the merged graph as `.jsonld`, or open the page in the Schema Markup Validator or Google's Rich Results Test.
- **Toolbar badge:** shows the entity count for each tab, and turns red when a block fails to parse.
- **Live updates:** the sidebar re-scans when you switch tabs or a page finishes loading. Use the refresh button for schema that a single-page app injects later.

## Develop

```bash
npm install
npm run build      # outputs the loadable extension to dist/
npm run dev        # rebuilds on change; click "Reload" in about:debugging
npm test           # runs the extractor and graph builder against test/fixture.html
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
| `src/lib/validate.ts` | SEO rules. Add types to `RULES` and subtypes to `PARENT` |
| `src/components/*` | Graph, Tree, Issues, Raw and EntityDetail views |

## Limits

- It doesn't validate against the full schema.org vocabulary (unknown types or properties). Use the Schema Markup Validator link for that.
- RDFa support covers RDFa Lite (`vocab`, `typeof`, `property`, `resource`, `prefix`), not all of RDFa 1.1.
- Before publishing, change the Gecko ID in the manifest if you won't use `jaredcaraway.com`.
