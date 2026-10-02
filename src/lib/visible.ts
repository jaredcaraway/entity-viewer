/** Matching schema values against the page's visible text (markup vs. content mismatch). */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function normalizeText(s: string): string {
  return s
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m;
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    })
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−﹘﹣－]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface PageNumber {
  value: number;
  /** Decimal places as displayed, used for rounding matches. */
  decimals: number;
}

/** Candidate readings of a number token, in US and European formats. */
function readToken(tok: string): PageNumber[] {
  const num = (intPart: string, frac = ''): PageNumber => ({ value: Number(`${intPart}.${frac || '0'}`), decimals: frac.length });
  const groups = /^\d{1,3}$/;
  const lastComma = tok.lastIndexOf(',');
  const lastDot = tok.lastIndexOf('.');
  if (lastComma < 0 && lastDot < 0) return [num(tok)];

  if (lastComma >= 0 && lastDot >= 0) {
    // Both separators: the later one is the decimal mark.
    const dec = lastComma > lastDot ? ',' : '.';
    const thou = dec === ',' ? '.' : ',';
    const [int, frac] = [tok.slice(0, Math.max(lastComma, lastDot)), tok.slice(Math.max(lastComma, lastDot) + 1)];
    const parts = int.split(thou);
    if (int.includes(dec) || !parts.slice(1).every((p) => /^\d{3}$/.test(p)) || !groups.test(parts[0])) return [];
    return [num(parts.join(''), frac)];
  }

  const sep = lastComma >= 0 ? ',' : '.';
  const parts = tok.split(sep);
  if (parts.length === 2) {
    const out = [num(parts[0], parts[1])];
    // "1,299" or "1.299": also a thousands separator.
    if (parts[1].length === 3 && groups.test(parts[0])) out.push(num(parts.join('')));
    return out;
  }
  if (groups.test(parts[0]) && parts.slice(1).every((p) => /^\d{3}$/.test(p))) return [num(parts.join(''))];
  return [];
}

/** Every number token on the page, read in both US and European formats. */
export function pageNumbers(text: string): PageNumber[] {
  const out: PageNumber[] = [];
  for (const [tok] of text.matchAll(/\d+(?:[.,]\d+)*/g)) {
    const read = readToken(tok);
    // Not a valid number format (e.g. "1,2,3" or a version "1.2.3"): take each run of digits.
    out.push(...(read.length ? read : tok.split(/[.,]/).map((p) => ({ value: Number(p), decimals: 0 }))));
  }
  return out;
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/**
 * True if some page number equals the value, or shows it rounded to its own
 * precision (at least 1 decimal place). A value of 0 also matches "free".
 */
export function numberAppears(value: number, numbers: PageNumber[], normalizedPage = ''): boolean {
  if (value === 0 && /\bfree\b/.test(normalizedPage)) return true;
  return numbers.some((p) => same(p.value, value) || (p.decimals >= 1 && same(round(value, p.decimals), p.value)));
}

const words = (s: string) => s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const pageWordCache = new Map<string, string>();
const wordString = (normalizedPage: string) => {
  let w = pageWordCache.get(normalizedPage);
  if (w === undefined) {
    w = ` ${words(normalizedPage).join(' ')} `;
    pageWordCache.clear();
    pageWordCache.set(normalizedPage, w);
  }
  return w;
};

/**
 * True if the value appears in the page as a normalized substring, or (for
 * values of 4+ words) an in-order run of its words covering 80% of them does.
 */
export function textAppears(value: string, normalizedPage: string): boolean {
  const v = normalizeText(value.replace(/<[^>]*>/g, ' '));
  if (!v || normalizedPage.includes(v)) return true;
  const vw = words(v);
  if (!vw.length) return true;
  const page = wordString(normalizedPage);
  if (page.includes(` ${vw.join(' ')} `)) return true;
  if (vw.length < 4) return false;
  const need = Math.ceil((vw.length * 4) / 5);
  for (let i = 0; i + need <= vw.length; i++) {
    if (page.includes(` ${vw.slice(i, i + need).join(' ')} `)) return true;
  }
  return false;
}
