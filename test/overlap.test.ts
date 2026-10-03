import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overlaps, separate, type Box } from '../src/lib/overlap';

const apply = (boxes: Box[], pos: { x: number; y: number }[]) => boxes.map((b, i) => ({ ...b, ...pos[i] }));

test('boxes that already have room stay put', () => {
  const boxes = [{ x: 0, y: 0, w: 100, h: 30 }, { x: 200, y: 0, w: 100, h: 30 }];
  assert.deepEqual(separate(boxes), [{ x: 0, y: 0 }, { x: 200, y: 0 }]);
});

test('two wide labels on top of each other are pushed apart along the shorter overlap', () => {
  // Like two OpeningHoursSpecification nodes offset sideways: they overlap far more in x than in y.
  const boxes = [{ x: 0, y: 0, w: 220, h: 30 }, { x: 80, y: 4, w: 220, h: 30 }];
  const out = apply(boxes, separate(boxes, { gap: 10 }));
  assert.ok(!overlaps(out, 10), JSON.stringify(out));
  assert.equal(out[0].x, 0, 'pushed vertically, not sideways');
  assert.equal(out[1].x, 80);
});

test('identical positions are split deterministically', () => {
  const boxes = [{ x: 5, y: 5, w: 50, h: 20 }, { x: 5, y: 5, w: 50, h: 20 }, { x: 5, y: 5, w: 50, h: 20 }];
  const a = separate(boxes);
  assert.ok(!overlaps(apply(boxes, a), 10));
  assert.deepEqual(a, separate(boxes));
});

test('a crowded hub is fully untangled', () => {
  // Eight wide children scattered close around one hub, as cose leaves them.
  const boxes: Box[] = [{ x: 0, y: 0, w: 180, h: 60 }];
  for (let i = 0; i < 8; i++) boxes.push({ x: Math.cos(i) * 60, y: Math.sin(i) * 60, w: 220, h: 30 });
  assert.ok(overlaps(boxes));
  assert.ok(!overlaps(apply(boxes, separate(boxes, { gap: 10 })), 10));
});
