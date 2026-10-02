export type Source = 'json-ld' | 'microdata' | 'rdfa';

/** Where a JSON-LD block came from relative to the HTML the server sent. */
export type Origin = 'static' | 'modified' | 'injected';

/** Markup around a JSON-LD script that can identify the plugin or app that wrote it. */
export interface BlockHints {
  /** id, class and data-* attributes of the script element. */
  attrs?: Record<string, string>;
  /** The nearest HTML comment before the script in the same parent, e.g. "This site is optimized with the Yoast SEO plugin". */
  comment?: string;
  /** The nearest HTML comment after it, e.g. "/ Yoast SEO plugin.". */
  commentAfter?: string;
  /** The id of the nearest ancestor element that has one, e.g. "shopify-section-main-product". */
  container?: string;
}

export interface Block {
  source: Source;
  index: number;
  data?: unknown;
  raw?: string;
  error?: string;
  warning?: string;
  hints?: BlockHints;
  /** Set once the page's original HTML has been fetched and compared (JSON-LD only). */
  origin?: Origin;
}

export interface Generator {
  /** The plugin, app or platform, e.g. "Yoast SEO". */
  name: string;
  /** The evidence, e.g. 'class "yoast-schema-graph"'. */
  via: string;
  /** Inferred from the content alone rather than markup the generator adds. */
  likely?: boolean;
}

export interface PageData {
  url: string;
  title: string;
  blocks: Block[];
  /** The page's rendered text plus alt and aria-label values, for the mismatch check. */
  visibleText?: string;
  /** JSON-LD blocks in the HTML the server sent that are no longer in the live page. */
  removedBlocks?: number;
}

export type PropValue = (
  | { kind: 'literal'; value: string | number | boolean | null }
  | { kind: 'ref'; id: string }
) & {
  /** Keys of the blocks that gave this value. */
  from?: string[];
};

export interface Entity {
  id: string;
  blank: boolean;
  /** Referenced by @id but never defined on the page. */
  stub: boolean;
  types: string[];
  props: Record<string, PropValue[]>;
  /** Blocks that mention this entity, including bare @id references. */
  sources: string[];
  /** Blocks that give it a type or properties. */
  definedIn: string[];
  label: string;
}

export interface Edge {
  id: string;
  source: string;
  target: string;
  prop: string;
}

export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  severity: Severity;
  message: string;
  entityId?: string;
  blockKey?: string;
}

export interface Graph {
  entities: Map<string, Entity>;
  edges: Edge[];
  roots: string[];
  issues: Issue[];
  /** The detected generator of each block, by block key. */
  generators: Map<string, Generator>;
}
