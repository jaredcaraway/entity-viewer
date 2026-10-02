import { ActionIcon, Alert, Badge, Code, CopyButton, Group, Paper, ScrollArea, Stack, Text, Tooltip } from '@mantine/core';
import { IconCheck, IconCopy } from '@tabler/icons-react';
import type { Block } from '../lib/types';
import { blockKey } from '../lib/graph';

const SOURCE_COLOR = { 'json-ld': 'lagoon', microdata: 'ember', rdfa: 'grape' } as const;

export function RawView({ blocks }: { blocks: Block[] }) {
  return (
    <Stack gap="sm" p="xs">
      {blocks.map((b) => {
        const text = b.raw && b.error ? b.raw : JSON.stringify(b.data, null, 2);
        return (
          <Paper key={blockKey(b)} withBorder radius="sm" p={0}>
            <Group justify="space-between" px={8} py={4}>
              <Group gap={6}>
                <Badge color={SOURCE_COLOR[b.source]}>{b.source}</Badge>
                <Text size="xs" c="dimmed">
                  block {b.index + 1}
                </Text>
              </Group>
              <CopyButton value={text ?? ''}>
                {({ copied, copy }) => (
                  <Tooltip label={copied ? 'Copied' : 'Copy'}>
                    <ActionIcon aria-label="Copy block" onClick={copy} color={copied ? 'lagoon' : 'gray'}>
                      {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                    </ActionIcon>
                  </Tooltip>
                )}
              </CopyButton>
            </Group>
            {b.error && (
              <Alert color="red" variant="light" radius={0} py={6} px={8}>
                <Text size="sm">{b.error}</Text>
              </Alert>
            )}
            <ScrollArea.Autosize mah={360} type="auto">
              <Code block style={{ fontSize: 11, borderRadius: 0, background: 'transparent' }}>
                {text}
              </Code>
            </ScrollArea.Autosize>
          </Paper>
        );
      })}
    </Stack>
  );
}
