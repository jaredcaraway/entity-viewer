/** A node's box: its center and size. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Moves boxes apart until none overlap (with `gap` between them), or `maxRounds` passes run out.
 * Each overlapping pair is pushed apart along the axis where it overlaps least, half each way, so a
 * layout's overall shape survives. `axis: 'x'` only moves boxes sideways (keeps a tree's rows).
 * Returns new centers in the same order; sizes don't change.
 */
export function separate(boxes: Box[], { gap = 10, axis = 'both', maxRounds = 200 }: { gap?: number; axis?: 'both' | 'x'; maxRounds?: number } = {}): { x: number; y: number }[] {
  const pos = boxes.map((b) => ({ x: b.x, y: b.y }));
  if (axis === 'x') return packRows(boxes, pos, gap);
  for (let round = 0; round < maxRounds; round++) {
    let moved = false;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = pos[i];
        const b = pos[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const ox = (boxes[i].w + boxes[j].w) / 2 + gap - Math.abs(dx);
        const oy = (boxes[i].h + boxes[j].h) / 2 + gap - Math.abs(dy);
        if (ox <= 0.5 || oy <= 0.5) continue;
        moved = true;
        // Coincident boxes have no direction to push in; split them by index so the result is stable.
        const sx = dx > 0 || (dx === 0 && i < j) ? 1 : -1;
        const sy = dy > 0 || (dy === 0 && i < j) ? 1 : -1;
        if (ox <= oy) {
          a.x -= (sx * ox) / 2;
          b.x += (sx * ox) / 2;
        } else {
          a.y -= (sy * oy) / 2;
          b.y += (sy * oy) / 2;
        }
      }
    }
    if (!moved) break;
  }
  return pos;
}

/**
 * For layouts in rows (a tree's levels): boxes whose vertical extents overlap share a row. Each row
 * is packed left to right in its current order, then shifted back to its original center.
 */
function packRows(boxes: Box[], pos: { x: number; y: number }[], gap: number) {
  const order = boxes.map((_, i) => i).sort((a, b) => boxes[a].y - boxes[b].y);
  const rows: number[][] = [];
  for (const i of order) {
    const row = rows.at(-1);
    const last = row && boxes[row[row.length - 1]];
    if (row && last && Math.abs(boxes[i].y - last.y) < (boxes[i].h + last.h) / 2) row.push(i);
    else rows.push([i]);
  }
  for (const row of rows) {
    row.sort((a, b) => boxes[a].x - boxes[b].x || a - b);
    const before = row.reduce((n, i) => n + boxes[i].x, 0) / row.length;
    for (let k = 1; k < row.length; k++) {
      const prev = row[k - 1];
      const cur = row[k];
      pos[cur].x = Math.max(pos[cur].x, pos[prev].x + (boxes[prev].w + boxes[cur].w) / 2 + gap);
    }
    const shift = before - row.reduce((n, i) => n + pos[i].x, 0) / row.length;
    for (const i of row) pos[i].x += shift;
  }
  return pos;
}

/** Whether any two boxes overlap (ignoring `gap`-sized slivers). */
export function overlaps(boxes: Box[], gap = 0): boolean {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 + gap - 0.5 && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + gap - 0.5) return true;
    }
  }
  return false;
}
