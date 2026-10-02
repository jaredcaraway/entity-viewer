import { Badge, Group, Paper, Stack, Text, ThemeIcon, UnstyledButton } from '@mantine/core';
import { IconAlertTriangle, IconCircleCheck, IconCircleX, IconInfoCircle } from '@tabler/icons-react';
import type { Graph, Issue, Severity } from '../lib/types';
import { refLabel } from './EntityDetail';

const META: Record<Severity, { color: string; label: string; Icon: typeof IconCircleX }> = {
  error: { color: 'red', label: 'Errors', Icon: IconCircleX },
  warning: { color: 'yellow', label: 'Warnings', Icon: IconAlertTriangle },
  info: { color: 'blue', label: 'Notes', Icon: IconInfoCircle },
};

export function SeverityIcon({ severity }: { severity: Severity }) {
  const { color, Icon } = META[severity];
  return (
    <ThemeIcon size={18} radius="xl" variant="light" color={color} style={{ flexShrink: 0 }}>
      <Icon size={12} />
    </ThemeIcon>
  );
}

export function IssuesView({ graph, onSelect }: { graph: Graph; onSelect: (id: string) => void }) {
  if (!graph.issues.length) {
    return (
      <Stack align="center" py="xl" gap="xs">
        <ThemeIcon size={42} radius="xl" variant="light">
          <IconCircleCheck size={26} />
        </ThemeIcon>
        <Text size="sm" c="dimmed">
          No issues found.
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="md" p="xs">
      {(['error', 'warning', 'info'] as Severity[]).map((sev) => {
        const list = graph.issues.filter((i) => i.severity === sev);
        if (!list.length) return null;
        return (
          <Stack key={sev} gap={6}>
            <Group gap={6}>
              <Text size="xs" tt="uppercase" fw={700} c="dimmed">
                {META[sev].label}
              </Text>
              <Badge size="xs" color={META[sev].color}>
                {list.length}
              </Badge>
            </Group>
            {list.map((i, n) => (
              <IssueRow key={n} issue={i} graph={graph} onSelect={onSelect} />
            ))}
          </Stack>
        );
      })}
    </Stack>
  );
}

function IssueRow({ issue, graph, onSelect }: { issue: Issue; graph: Graph; onSelect: (id: string) => void }) {
  const body = (
    <Paper withBorder p={8} radius="sm">
      <Group gap={8} wrap="nowrap" align="flex-start">
        <SeverityIcon severity={issue.severity} />
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Text size="sm" style={{ wordBreak: 'break-word' }}>
            {issue.message}
          </Text>
          {issue.entityId && (
            <Text size="xs" c="dimmed" truncate>
              {refLabel(graph, issue.entityId)}
            </Text>
          )}
        </Stack>
      </Group>
    </Paper>
  );
  return issue.entityId ? (
    <UnstyledButton onClick={() => onSelect(issue.entityId!)}>{body}</UnstyledButton>
  ) : (
    body
  );
}
