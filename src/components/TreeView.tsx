import { useState } from 'react';
import { Box, Collapse, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconChevronRight, IconCornerDownRight } from '@tabler/icons-react';
import type { Graph } from '../lib/types';
import { colorForType } from '../theme';

interface Props {
  graph: Graph;
  selected?: string;
  onSelect: (id: string) => void;
}

export function TreeView({ graph, selected, onSelect }: Props) {
  return (
    <Stack gap={2} p="xs">
      {graph.roots.map((id) => (
        <Node key={id} id={id} graph={graph} depth={0} path={new Set()} selected={selected} onSelect={onSelect} defaultOpen />
      ))}
    </Stack>
  );
}

function Node({
  id, graph, depth, path, selected, onSelect, prop, defaultOpen = false,
}: Props & { id: string; depth: number; path: Set<string>; prop?: string; defaultOpen?: boolean }) {
  const e = graph.entities.get(id);
  const [open, setOpen] = useState(defaultOpen || depth < 1);
  if (!e) return null;

  const cyclic = path.has(id);
  const children = cyclic ? [] : graph.edges.filter((x) => x.source === id && x.target !== id);
  const literalCount = Object.values(e.props).flat().filter((v) => v.kind === 'literal').length;
  const nextPath = new Set(path).add(id);
  const isSel = selected === id;

  return (
    <Box style={{ paddingLeft: depth ? 12 : 0, borderLeft: depth ? '1px solid var(--mantine-color-default-border)' : undefined }}>
      <Group gap={4} wrap="nowrap">
        <UnstyledButton
          aria-label={open ? 'Collapse' : 'Expand'}
          onClick={() => setOpen((o) => !o)}
          style={{ visibility: children.length ? 'visible' : 'hidden', display: 'flex' }}
        >
          <IconChevronRight size={14} style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 120ms' }} />
        </UnstyledButton>
        <UnstyledButton
          onClick={() => onSelect(id)}
          style={{
            flex: 1,
            minWidth: 0,
            borderRadius: 4,
            padding: '2px 6px',
            background: isSel ? 'var(--mantine-primary-color-light)' : undefined,
          }}
        >
          <Group gap={6} wrap="nowrap">
            {prop && (
              <Text size="xs" ff="monospace" c="dimmed" style={{ flexShrink: 0 }}>
                {prop}
              </Text>
            )}
            <span style={{ width: 8, height: 8, borderRadius: 2, background: colorForType(e.types[0]), flexShrink: 0 }} />
            <Text size="sm" fw={depth === 0 ? 600 : 500} style={{ flexShrink: 0 }}>
              {e.types.join(', ') || (e.stub ? 'external' : 'untyped')}
            </Text>
            <Text size="sm" c="dimmed" truncate>
              {e.label}
            </Text>
            {cyclic && <IconCornerDownRight size={12} title="Already shown above" />}
            {!cyclic && literalCount > 0 && (
              <Text size="xs" c="dimmed" ml="auto" style={{ flexShrink: 0 }}>
                {literalCount}
              </Text>
            )}
          </Group>
        </UnstyledButton>
      </Group>
      {children.length > 0 && (
        <Collapse expanded={open}>
          <Stack gap={1} mt={1}>
            {open &&
              children.map((c) => (
                <Node key={c.id} id={c.target} prop={c.prop} graph={graph} depth={depth + 1} path={nextPath} selected={selected} onSelect={onSelect} />
              ))}
          </Stack>
        </Collapse>
      )}
    </Box>
  );
}
