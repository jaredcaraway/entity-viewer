import type { Block } from './types';

export const blockKey = (b: Pick<Block, 'source' | 'index'>) => `${b.source}#${b.index + 1}`;

export const toArray = <T,>(v: T | T[] | undefined | null): T[] =>
  v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];

export const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
