import { Anchor, Badge, Code, CopyButton, Group, ActionIcon, Stack, Table, Text } from '@mantine/core';
import { IconCheck, IconCopy } from '@tabler/icons-react';
import type { Entity, Graph, Issue } from '../lib/types';
import { colorForType } from '../theme';
import { openTab } from '../lib/browser';
import { SeverityIcon } from './IssuesView';

export function TypeBadges({ types, stub }: { types: string[]; stub?: boolean }) {
  if (!types.length) return <Badge color="gray">{stub ? 'external ref' : 'untyped'}</Badge>;
  return (
    <>
      {types.map((t) => (
        <Badge key={t} color={colorForType(t)} style={{ textTransform: 'none' }}>
          {t}
        </Badge>
      ))}
    </>
  );
}

interface Props {
  entity: Entity;
  graph: Graph;
  issues: Issue[];
  onSelect: (id: string) => void;
}

export function EntityDetail({ entity, graph, issues, onSelect }: Props) {
  const incoming = graph.edges.filter((e) => e.target === entity.id && e.source !== entity.id);

  return (
    <Stack gap="sm">
      <Group gap={6}>
        <Text size="xs" c="dimmed">Found in</Text>
        {entity.sources.map((s) => (
          <Badge key={s} color="gray" variant="outline">
            {s}
          </Badge>
        ))}
      </Group>

      {!entity.blank && (
        <Group gap={4} wrap="nowrap">
          <Code style={{ wordBreak: 'break-all', flex: 1 }}>{entity.id}</Code>
          <CopyButton value={entity.id}>
            {({ copied, copy }) => (
              <ActionIcon aria-label="Copy @id" onClick={copy} color={copied ? 'lagoon' : 'gray'}>
                {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
              </ActionIcon>
            )}
          </CopyButton>
        </Group>
      )}

      {issues.length > 0 && (
        <Stack gap={4}>
          {issues.map((i, n) => (
            <Group key={n} gap={6} wrap="nowrap" align="flex-start">
              <SeverityIcon severity={i.severity} />
              <Text size="sm">{i.message}</Text>
            </Group>
          ))}
        </Stack>
      )}

      {entity.stub ? (
        <Text size="sm" c="dimmed">
          This entity is referenced by @id but not defined anywhere on the page. Search engines will only connect it if
          the definition is on this page (or they already know the node).
        </Text>
      ) : (
        <Table striped withRowBorders={false} verticalSpacing={4} horizontalSpacing={6} fz="sm" layout="fixed">
          <Table.Tbody>
            {Object.entries(entity.props).map(([k, vals]) => (
              <Table.Tr key={k}>
                <Table.Td w="34%" style={{ verticalAlign: 'top' }}>
                  <Text size="sm" ff="monospace" c="dimmed" style={{ wordBreak: 'break-word' }}>
                    {k}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Stack gap={2}>
                    {vals.map((v, i) =>
                      v.kind === 'ref' ? (
                        <Anchor key={i} size="sm" component="button" onClick={() => onSelect(v.id)} ta="left">
                          → {refLabel(graph, v.id)}
                        </Anchor>
                      ) : typeof v.value === 'string' && /^https?:\/\//.test(v.value) ? (
                        <Anchor key={i} size="sm" component="button" ta="left" onClick={() => openTab(v.value as string)} style={{ wordBreak: 'break-all' }}>
                          {v.value}
                        </Anchor>
                      ) : (
                        <Text key={i} size="sm" style={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                          {v.value === null ? <i>null</i> : String(v.value).slice(0, 600)}
                        </Text>
                      ),
                    )}
                  </Stack>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      {incoming.length > 0 && (
        <Stack gap={2}>
          <Text size="xs" tt="uppercase" fw={600} c="dimmed">
            Referenced by
          </Text>
          {incoming.map((e) => (
            <Anchor key={e.id} size="sm" component="button" ta="left" onClick={() => onSelect(e.source)}>
              ← {refLabel(graph, e.source)} <Text span size="xs" c="dimmed" ff="monospace">.{e.prop}</Text>
            </Anchor>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

export function refLabel(graph: Graph, id: string): string {
  const e = graph.entities.get(id);
  if (!e) return id;
  const t = e.types[0] ?? (e.stub ? 'external' : 'entity');
  return e.label ? `${t}: ${e.label}` : t;
}
