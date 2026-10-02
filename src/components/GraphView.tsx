import { useEffect, useMemo, useRef, useState } from 'react';
import cytoscape, { type Core } from 'cytoscape';
import { ActionIcon, Group, SegmentedControl, Tooltip, useComputedColorScheme } from '@mantine/core';
import { IconFocusCentered, IconPhotoDown } from '@tabler/icons-react';
import type { Graph } from '../lib/types';
import { colorForType } from '../theme';
import { download } from '../lib/browser';

type LayoutName = 'cose' | 'breadthfirst' | 'concentric' | 'circle';

interface Props {
  graph: Graph;
  selected?: string;
  onSelect: (id: string | undefined) => void;
  issueIds: Map<string, 'error' | 'warning' | 'info'>;
  fileStem: string;
}

const SEVERITY_BORDER = { error: '#e03131', warning: '#f59f00', info: '#74c0fc' } as const;

export function GraphView({ graph, selected, onSelect, issueIds, fileStem }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [layout, setLayout] = useState<LayoutName>('cose');
  const scheme = useComputedColorScheme('light');
  const dark = scheme === 'dark';

  const fresh = useMemo(() => {
    const nodes = [...graph.entities.values()].map((e) => ({
      data: {
        id: e.id,
        label: `${e.types.join(', ') || (e.stub ? '↗ external' : '?')}${e.label ? '\n' + e.label : ''}`,
        color: colorForType(e.types[0]),
        border: SEVERITY_BORDER[issueIds.get(e.id) as keyof typeof SEVERITY_BORDER] ?? 'transparent',
        stub: e.stub ? 1 : 0,
        root: graph.roots.includes(e.id) ? 1 : 0,
      },
    }));
    const edges = graph.edges
      .filter((e) => graph.entities.has(e.source) && graph.entities.has(e.target))
      .map((e) => ({ data: { id: e.id, source: e.source, target: e.target, label: e.prop } }));
    return [...nodes, ...edges];
  }, [graph, issueIds]);
  // Rebuilding the graph (e.g. once origins are known) shouldn't redo the layout unless what's drawn changed.
  const freshKey = JSON.stringify(fresh);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const elements = useMemo(() => fresh, [freshKey]);
  const rootsKey = graph.roots.join('\n');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const roots = useMemo(() => graph.roots, [rootsKey]);

  useEffect(() => {
    if (!host.current) return;
    const fg = dark ? '#c9d1dc' : '#1f2737';
    const edgeColor = dark ? '#3a4456' : '#ced4da';
    const cy = cytoscape({
      container: host.current,
      elements,
      wheelSensitivity: 0.25,
      minZoom: 0.15,
      maxZoom: 3,
      style: [
        {
          selector: 'node',
          style: {
            shape: 'round-rectangle',
            'background-color': 'data(color)',
            'background-opacity': 0.16,
            'border-width': 1.5,
            'border-color': 'data(color)',
            label: 'data(label)',
            color: fg,
            'font-size': 10,
            'font-family': 'system-ui, sans-serif',
            'text-wrap': 'wrap',
            'text-max-width': '130px',
            'text-valign': 'center',
            'text-halign': 'center',
            width: 'label',
            height: 'label',
            padding: '8px',
          },
        },
        { selector: 'node[root = 1]', style: { 'background-opacity': 0.32, 'border-width': 2.5, 'font-weight': 'bold' } },
        { selector: 'node[stub = 1]', style: { 'border-style': 'dashed', 'background-opacity': 0.04 } },
        {
          selector: 'node[border != "transparent"]',
          style: { 'outline-width': 2, 'outline-color': 'data(border)', 'outline-offset': 2 } as cytoscape.Css.Node,
        },
        {
          selector: 'edge',
          style: {
            width: 1.2,
            'line-color': edgeColor,
            'target-arrow-color': edgeColor,
            'target-arrow-shape': 'triangle',
            'arrow-scale': 0.8,
            'curve-style': 'bezier',
            label: 'data(label)',
            'font-size': 8,
            color: dark ? '#7d8899' : '#868e96',
            'text-rotation': 'autorotate',
            'text-background-color': dark ? '#111723' : '#ffffff',
            'text-background-opacity': 1,
            'text-background-padding': '1px',
          },
        },
        { selector: 'node:selected', style: { 'background-opacity': 0.55, 'border-width': 3 } },
        { selector: 'edge.hl', style: { 'line-color': '#19a4a2', 'target-arrow-color': '#19a4a2', width: 2 } },
        { selector: '.faded', style: { opacity: 0.25 } },
      ],
    });
    cy.on('tap', 'node', (evt) => onSelect(evt.target.id()));
    cy.on('tap', (evt) => {
      if (evt.target === cy) onSelect(undefined);
    });
    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
    // onSelect is stable from the parent (setState)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements, dark]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const opts: cytoscape.LayoutOptions =
      layout === 'breadthfirst'
        ? ({ name: 'breadthfirst', directed: true, roots: roots.map((r) => cy.getElementById(r)), spacingFactor: 1.1, animate: false } as cytoscape.LayoutOptions)
        : layout === 'concentric'
          ? ({ name: 'concentric', minNodeSpacing: 20, animate: false } as cytoscape.LayoutOptions)
          : layout === 'circle'
            ? { name: 'circle', animate: false }
            : ({ name: 'cose', animate: false, nodeRepulsion: () => 9000, idealEdgeLength: () => 70, padding: 20 } as cytoscape.LayoutOptions);
    cy.layout(opts).run();
    cy.fit(undefined, 20);
  }, [layout, elements, dark, roots]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().removeClass('faded hl').unselect();
    if (!selected) return;
    const n = cy.getElementById(selected);
    if (!n.nonempty()) return;
    n.select();
    const hood = n.closedNeighborhood();
    cy.elements().not(hood).addClass('faded');
    n.connectedEdges().addClass('hl');
    cy.animate({ center: { eles: n }, duration: 200 });
  }, [selected, elements]);

  const exportPng = () => {
    const cy = cyRef.current;
    if (!cy) return;
    const blob = cy.png({ output: 'blob', full: true, scale: 2, bg: dark ? '#111723' : '#ffffff' }) as unknown as Blob;
    download(`${fileStem}-graph.png`, blob);
  };

  return (
    <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Group justify="space-between" px="xs" py={6} gap={6} wrap="nowrap">
        <SegmentedControl
          size="xs"
          value={layout}
          onChange={(v) => setLayout(v as LayoutName)}
          data={[
            { value: 'cose', label: 'Force' },
            { value: 'breadthfirst', label: 'Tree' },
            { value: 'concentric', label: 'Rings' },
            { value: 'circle', label: 'Circle' },
          ]}
        />
        <Group gap={2} wrap="nowrap">
          <Tooltip label="Fit to view">
            <ActionIcon aria-label="Fit to view" onClick={() => cyRef.current?.fit(undefined, 20)}>
              <IconFocusCentered size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Export PNG">
            <ActionIcon aria-label="Export PNG" onClick={exportPng}>
              <IconPhotoDown size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
      <div ref={host} style={{ flex: 1, minHeight: 0 }} />
    </div>
  );
}
