import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leftToRightTree, type TreeEdge, type TreeNode } from '../src/lib/tree';
import { overlaps } from '../src/lib/overlap';

const node = (id: string, w = 100, h = 30): TreeNode => ({ id, w, h });
const boxes = (nodes: TreeNode[], pos: Map<string, { x: number; y: number }>) => nodes.map((n) => ({ ...pos.get(n.id)!, w: n.w, h: n.h }));

test('a hub with many children becomes a column to its right, with the hub centered on it', () => {
  const nodes = [node('hub', 160, 60), ...Array.from({ length: 8 }, (_, i) => node(`c${i}`, 200))];
  const edges = nodes.slice(1).map((n) => ({ source: 'hub', target: n.id, label: 'openingHoursSpecification' }));
  const pos = leftToRightTree(nodes, edges, ['hub'], { labelWidth: (l) => l.length * 4.6 });
  const kids = nodes.slice(1).map((n) => pos.get(n.id)!);
  assert.ok(kids.every((k) => k.x === kids[0].x), 'children share a column');
  assert.ok(kids.every((k, i) => i === 0 || k.y > kids[i - 1].y), 'children keep their order downward');
  const hub = pos.get('hub')!;
  assert.equal(hub.y, (kids[0].y + kids[7].y) / 2);
  assert.ok(kids[0].x - 100 - (hub.x + 80) >= 25 * 4.6, 'the gap fits the edge label');
  assert.ok(!overlaps(boxes(nodes, pos)));
});

test('deeper levels, a tall parent and separate trees never overlap', () => {
  const nodes = [node('a', 120, 90), node('b'), node('c', 140), node('d'), node('e'), node('f', 200, 50), node('g')];
  const edges: TreeEdge[] = [
    { source: 'a', target: 'b' }, { source: 'b', target: 'c' }, { source: 'c', target: 'd' },
    { source: 'a', target: 'e' }, { source: 'f', target: 'g' },
  ];
  const pos = leftToRightTree(nodes, edges, ['a', 'f']);
  assert.ok(!overlaps(boxes(nodes, pos), 1), JSON.stringify([...pos]));
  assert.ok(pos.get('d')!.x > pos.get('c')!.x && pos.get('c')!.x > pos.get('b')!.x);
  assert.ok(pos.get('f')!.y > pos.get('a')!.y, 'the second tree goes below the first');
});

test('cycles, shared children and unreached nodes are each placed once', () => {
  const nodes = ['a', 'b', 'c', 'x', 'y'].map((id) => node(id));
  const edges: TreeEdge[] = [
    { source: 'a', target: 'b' }, { source: 'b', target: 'a' }, { source: 'a', target: 'c' }, { source: 'b', target: 'c' },
    { source: 'x', target: 'y' }, { source: 'y', target: 'x' }, { source: 'a', target: 'a' },
  ];
  const pos = leftToRightTree(nodes, edges, ['a']);
  assert.equal(pos.size, 5);
  assert.equal(pos.get('b')!.x, pos.get('c')!.x, 'c sits under its nearest parent, a');
  assert.ok(!overlaps(boxes(nodes, pos), 1));
});

test('columns are left-aligned', () => {
  const nodes = [node('r'), node('short', 60), node('long', 220)];
  const pos = leftToRightTree(nodes, [{ source: 'r', target: 'short' }, { source: 'r', target: 'long' }], ['r']);
  assert.equal(pos.get('short')!.x - 30, pos.get('long')!.x - 110);
});
