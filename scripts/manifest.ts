import { readFileSync } from 'node:fs';

export const TARGETS = ['firefox', 'chrome'] as const;
export type Target = (typeof TARGETS)[number];

const read = (name: string) => JSON.parse(readFileSync(new URL(`../manifest/${name}.json`, import.meta.url), 'utf8'));
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Objects merge key by key, arrays are joined without duplicates, anything else is replaced. */
function merge(a: unknown, b: unknown): unknown {
  if (Array.isArray(a) && Array.isArray(b)) return [...new Set([...a, ...b])];
  if (isObj(a) && isObj(b)) {
    const out: Record<string, unknown> = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = k in a ? merge(a[k], v) : v;
    return out;
  }
  return b;
}

/** The manifest for one browser: manifest/base.json plus that browser's overrides, with the package version. */
export function buildManifest(target: Target, version: string): Record<string, unknown> {
  return { ...(merge(read('base'), read(target)) as Record<string, unknown>), version };
}
