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
 * layout's overall shape survives.
 * Returns new centers in the same order; sizes don't change.
 */
export function separate(boxes: Box[], { gap = 10, maxRounds = 200 }: { gap?: number; maxRounds?: number } = {}): { x: number; y: number }[] {
  const pos = boxes.map((b) => ({ x: b.x, y: b.y }));
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
