import { ActionIcon, Alert, Badge, Button, Code, CopyButton, Group, Paper, ScrollArea, Stack, Text, Tooltip } from '@mantine/core';
import { IconCheck, IconCopy } from '@tabler/icons-react';
import type { Block, BlockHints, Generator, Origin, Source } from '../lib/types';
import { blockKey } from '../lib/graph';
import { generatorName } from '../lib/provenance';

export const SOURCE_COLOR = { 'json-ld': 'lagoon', microdata: 'ember', rdfa: 'grape' } as const;

const ORIGIN: Record<Origin, { label: string; color: string; tip: string }> = {
  static: { label: 'server HTML', color: 'gray', tip: 'In the HTML the server sent, unchanged.' },
  modified: { label: 'changed by JS', color: 'yellow', tip: "The server sent a block with the same types and @ids, but its content differs on the live page." },
  injected: { label: 'added by JS', color: 'orange', tip: "Not in the HTML the server sent; a script added it after load. Crawlers that don't run JavaScript won't see it." },
};

function hintText(h: BlockHints): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(h.attrs ?? {})) parts.push(`${k}="${v}"`);
  if (h.container) parts.push(`inside #${h.container}`);
  if (h.comment) parts.push(`after <!-- ${h.comment} -->`);
  if (h.commentAfter) parts.push(`before <!-- ${h.commentAfter} -->`);
  return parts.join(' · ');
}

interface Props {
  blocks: Block[];
  generators: Map<string, Generator>;
  /** Status of the comparison with the server's HTML. */
  note?: string;
  /** Set when that comparison needs the page requested again, which the user confirms by clicking. */
  onFetchOriginal?: () => void;
  /** Show only blocks of this syntax. */
  source?: Source;
  onClearSource?: () => void;
}

export function RawView({ blocks, generators, note, onFetchOriginal, source, onClearSource }: Props) {
  const shown = source ? blocks.filter((b) => b.source === source) : blocks;
  return (
    <Stack gap="sm" p="xs">
      {source && (
        <Group gap="xs" wrap="nowrap" align="center">
          <Text size="xs" c="dimmed" style={{ flex: 1 }}>
            Showing {shown.length} {source} block{shown.length === 1 ? '' : 's'} of {blocks.length}.
          </Text>
          <Button size="compact-xs" variant="subtle" onClick={onClearSource}>
            Show all
          </Button>
        </Group>
      )}
      {note && (
        <Group gap="xs" wrap="nowrap" align="center">
          <Text size="xs" c="dimmed" style={{ flex: 1 }}>
            {note}
          </Text>
          {onFetchOriginal && (
            <Button size="compact-xs" variant="light" onClick={onFetchOriginal}>
              Request page
            </Button>
          )}
        </Group>
      )}
      {shown.map((b) => {
        const text = b.raw && b.error ? b.raw : JSON.stringify(b.data, null, 2);
        const gen = generators.get(blockKey(b));
        const origin = b.origin && ORIGIN[b.origin];
        const hints = b.hints && hintText(b.hints);
        return (
          <Paper key={blockKey(b)} withBorder radius="sm" p={0}>
            <Group justify="space-between" px={8} py={4} wrap="nowrap">
              <Group gap={6} style={{ minWidth: 0 }}>
                <Badge color={SOURCE_COLOR[b.source]}>{b.source}</Badge>
                <Text size="xs" c="dimmed">
                  block {b.index + 1}
                </Text>
                {gen && (
                  <Tooltip label={`Detected from ${gen.via}`} multiline maw={260}>
                    <Badge color="gray" variant="outline" style={{ textTransform: 'none' }}>
                      {generatorName(gen)}
                    </Badge>
                  </Tooltip>
                )}
                {origin && (
                  <Tooltip label={origin.tip} multiline maw={260}>
                    <Badge color={origin.color} variant="light" style={{ textTransform: 'none' }}>
                      {origin.label}
                    </Badge>
                  </Tooltip>
                )}
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
            {hints && (
              <Text size="xs" c="dimmed" ff="monospace" px={8} pb={4} style={{ wordBreak: 'break-all' }}>
                {hints}
              </Text>
            )}
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
