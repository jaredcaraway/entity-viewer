export type Source = 'json-ld' | 'microdata' | 'rdfa';

export interface Block {
  source: Source;
  index: number;
  data?: unknown;
  raw?: string;
  error?: string;
  warning?: string;
}

export interface PageData {
  url: string;
  title: string;
  blocks: Block[];
  /** The page's rendered text plus alt and aria-label values, for the mismatch check. */
  visibleText?: string;
}

export type PropValue =
  | { kind: 'literal'; value: string | number | boolean | null }
  | { kind: 'ref'; id: string };

export interface Entity {
  id: string;
  blank: boolean;
  /** Referenced by @id but never defined on the page. */
  stub: boolean;
  types: string[];
  props: Record<string, PropValue[]>;
  sources: string[];
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
}
