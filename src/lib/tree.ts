export interface TreeNode {
  id: string;
  w: number;
  h: number;
}

export interface TreeEdge {
  source: string;
  target: string;
  /** The edge's label; the gap before a column is wide enough to show the labels of the edges into it. */
  label?: string;
}

export interface TreeOptions {
  /** Vertical space between siblings. */
  gap?: number;
  /** Minimum horizontal space between columns. */
  levelGap?: number;
  /** Width of an edge label, for sizing the gaps between columns. */
  labelWidth?: (label: string) => number;
}

/**
 * Lays a graph out as a left-to-right tree: each depth is a column, children stack downward and
 * each parent is centered on its children. Nodes are walked breadth-first from `roots`, so a node
 * reachable from several parents sits under the nearest one; nodes no root reaches start trees of
 * their own. Columns are left-aligned. Returns node centers by id; no two boxes overlap.
 */
export function leftToRightTree(nodes: TreeNode[], edges: TreeEdge[], roots: string[], opts: TreeOptions = {}): Map<string, { x: number; y: number }> {
  const { gap = 12, levelGap = 60, labelWidth = () => 0 } = opts;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<string, TreeEdge[]>();
  for (const e of edges) {
    if (e.source === e.target || !byId.has(e.source) || !byId.has(e.target)) continue;
    out.set(e.source, [...(out.get(e.source) ?? []), e]);
  }

  // Breadth-first spanning forest.
  const depth = new Map<string, number>();
  const children = new Map<string, string[]>();
  const into = new Map<string, TreeEdge>();
  const trees: string[] = [];
  const grow = (root: string) => {
    if (depth.has(root)) return;
    trees.push(root);
    depth.set(root, 0);
    const queue = [root];
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i];
      for (const e of out.get(id) ?? []) {
        if (depth.has(e.target)) continue;
        depth.set(e.target, depth.get(id)! + 1);
        children.set(id, [...(children.get(id) ?? []), e.target]);
        into.set(e.target, e);
        queue.push(e.target);
      }
    }
  };
  for (const r of roots) if (byId.has(r)) grow(r);
  for (const n of nodes) grow(n.id);

  // Columns: left edges, each far enough from the widest node before it to fit the edge labels between.
  const levels = Math.max(...depth.values()) + 1;
  const colWidth = Array<number>(levels).fill(0);
  const colGap = Array<number>(levels).fill(levelGap);
  for (const n of nodes) {
    const d = depth.get(n.id)!;
    colWidth[d] = Math.max(colWidth[d], n.w);
    const e = into.get(n.id);
    if (e?.label) colGap[d] = Math.max(colGap[d], labelWidth(e.label) + 24);
  }
  const left = [0];
  for (let d = 1; d < levels; d++) left[d] = left[d - 1] + colWidth[d - 1] + colGap[d];

  // Rows: leaves take the next free slot; a parent is centered on its children but never above its subtree.
  const pos = new Map<string, { x: number; y: number }>();
  let cursor = 0;
  const place = (id: string) => {
    const n = byId.get(id)!;
    const top = cursor;
    const kids = children.get(id) ?? [];
    let y: number;
    if (!kids.length) {
      y = top + n.h / 2;
    } else {
      kids.forEach(place);
      y = Math.max((pos.get(kids[0])!.y + pos.get(kids[kids.length - 1])!.y) / 2, top + n.h / 2);
    }
    pos.set(id, { x: left[depth.get(id)!] + n.w / 2, y });
    cursor = Math.max(cursor, y + n.h / 2 + gap);
  };
  for (const t of trees) {
    place(t);
    cursor += gap * 2;
  }
  return pos;
}
