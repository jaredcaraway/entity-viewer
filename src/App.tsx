import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionIcon, Badge, Box, Button, Center, Drawer, Group, Loader, Menu, ScrollArea, Stack, Tabs, Text, ThemeIcon,
  Tooltip, useMantineColorScheme, useComputedColorScheme,
} from '@mantine/core';
import {
  IconAlertTriangle, IconBinaryTree2, IconBraces, IconDownload, IconExternalLink, IconGraph, IconLock, IconMoon,
  IconRefresh, IconSun, IconWorldOff,
} from '@tabler/icons-react';
import { buildGraph, toJsonLd } from './lib/graph';
import type { PageData, Severity } from './lib/types';
import { activeTab, download, extractFrom, hasHostPermission, onActivePageChange, openTab, originalFrom, requestHostPermission } from './lib/browser';
import { classifyOrigins } from './lib/provenance';
import { GraphView } from './components/GraphView';
import { TreeView } from './components/TreeView';
import { IssuesView } from './components/IssuesView';
import { RawView } from './components/RawView';
import { EntityDetail, TypeBadges } from './components/EntityDetail';
import { DEMO_PAGE } from './demo';

type Status = 'loading' | 'ready' | 'permission' | 'restricted' | 'error';
const IN_EXTENSION = typeof browser !== 'undefined' && !!browser?.scripting;
const RANK: Record<Severity, number> = { error: 3, warning: 2, info: 1 };

export function App() {
  const [status, setStatus] = useState<Status>('loading');
  const [page, setPage] = useState<PageData | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [tab, setTab] = useState<string | null>('graph');
  const [selected, setSelected] = useState<string | undefined>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [originNote, setOriginNote] = useState<string | undefined>();
  /** Set when the page's HTML isn't cached; fetching it again needs a click. */
  const [originFetch, setOriginFetch] = useState<(() => void) | undefined>();
  const loads = useRef(0);

  /** Compares the scanned blocks with the HTML the server sent, to tell server-rendered blocks from injected ones. */
  const compareOrigins = useCallback(async (seq: number, tabId: number, data: PageData, network: boolean) => {
    setOriginFetch(undefined);
    setOriginNote('Comparing with the HTML the server sent…');
    let out;
    try {
      out = await originalFrom(tabId, data.url, network);
    } catch (e) {
      out = { error: e instanceof Error ? e.message : String(e) };
    }
    if (seq !== loads.current) return;
    if (Array.isArray(out)) {
      const { blocks, removed } = classifyOrigins(data.blocks, out);
      setPage({ ...data, blocks, removedBlocks: removed });
      setOriginNote(undefined);
    } else if (out.notCached) {
      setOriginNote("The page's HTML isn't cached. Requesting it again tells server-rendered blocks from ones added by JavaScript.");
      setOriginFetch(() => () => compareOrigins(seq, tabId, data, true));
    } else {
      setOriginNote(`Couldn't get the server's HTML to tell server-rendered blocks from injected ones (${out.error}).`);
    }
  }, []);

  const load = useCallback(async () => {
    const seq = ++loads.current;
    setSelected(undefined);
    setDrawerOpen(false);
    setOriginNote(undefined);
    setOriginFetch(undefined);
    if (!IN_EXTENSION) {
      setPage(DEMO_PAGE);
      setStatus('ready');
      return;
    }
    setStatus('loading');
    const t = await activeTab();
    if (!t || !/^https?:/i.test(t.url ?? '')) {
      setPage(null);
      setStatus('restricted');
      return;
    }
    if (!(await hasHostPermission())) {
      setStatus('permission');
      return;
    }
    let data: PageData;
    try {
      data = await extractFrom(t.id);
      // A newer load (tab switch, page load) may have finished first.
      if (seq !== loads.current) return;
      setPage(data);
      setStatus('ready');
    } catch (e) {
      if (seq !== loads.current) return;
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStatus(/Missing host permission|cannot be scripted|privileged/i.test(String(e)) ? 'restricted' : 'error');
      return;
    }
    if (data.blocks.some((b) => b.source === 'json-ld')) await compareOrigins(seq, t.id, data, false);
  }, [compareOrigins]);

  useEffect(() => {
    load();
    if (!IN_EXTENSION) return;
    return onActivePageChange(load);
  }, [load]);

  const graph = useMemo(() => (page ? buildGraph(page) : null), [page]);

  const worstByEntity = useMemo(() => {
    const m = new Map<string, Severity>();
    for (const i of graph?.issues ?? []) {
      if (!i.entityId) continue;
      const cur = m.get(i.entityId);
      if (!cur || RANK[i.severity] > RANK[cur]) m.set(i.entityId, i.severity);
    }
    return m;
  }, [graph]);

  const select = useCallback((id: string | undefined) => {
    setSelected(id);
    setDrawerOpen(!!id);
  }, []);

  const fileStem = useMemo(() => {
    try {
      const u = new URL(page?.url ?? '');
      return (u.hostname + u.pathname).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60) || 'page';
    } catch {
      return 'page';
    }
  }, [page]);

  const counts = useMemo(() => {
    const c = { error: 0, warning: 0, info: 0 };
    for (const i of graph?.issues ?? []) c[i.severity]++;
    return c;
  }, [graph]);

  const entity = selected ? graph?.entities.get(selected) : undefined;

  return (
    <Stack gap={0} h="100vh">
      <Header page={page} onRefresh={load} graphReady={!!graph} onExportJson={() => graph && download(`${fileStem}-entities.jsonld`, JSON.stringify(toJsonLd(graph), null, 2))} />

      {status === 'loading' && (
        <Center flex={1}>
          <Loader size="sm" />
        </Center>
      )}

      {status === 'permission' && (
        <Empty icon={<IconLock size={22} />} title="Allow page access">
          <Text size="sm" c="dimmed" ta="center">
            Entity Viewer reads structured data from the pages you view. Firefox needs your OK first. Nothing leaves your browser.
          </Text>
          <Button
            size="xs"
            onClick={() => {
              // Must be called synchronously in the click handler.
              requestHostPermission().then((ok: boolean) => {
                if (ok) load();
              });
            }}
          >
            Grant access to websites
          </Button>
        </Empty>
      )}

      {status === 'restricted' && (
        <Empty icon={<IconWorldOff size={22} />} title="Nothing to read here">
          <Text size="sm" c="dimmed" ta="center">
            Firefox doesn't let extensions read this page (internal pages, add-on store, PDF viewer). Switch to a regular website.
          </Text>
        </Empty>
      )}

      {status === 'error' && (
        <Empty icon={<IconAlertTriangle size={22} />} title="Couldn't read the page" color="red">
          <Text size="sm" c="dimmed" ta="center">
            {errorMsg}
          </Text>
          <Button size="xs" variant="light" onClick={load}>
            Try again
          </Button>
        </Empty>
      )}

      {status === 'ready' && graph && graph.entities.size === 0 && !graph.issues.length && (
        <Empty icon={<IconBraces size={22} />} title="No structured data found">
          <Text size="sm" c="dimmed" ta="center">
            This page has no JSON-LD, Microdata or RDFa. If it renders schema with JavaScript after load, try refreshing.
          </Text>
        </Empty>
      )}

      {status === 'ready' && graph && (graph.entities.size > 0 || graph.issues.length > 0) && (
        <>
          <Group gap={6} px="xs" pb={6}>
            <Badge color="gray" variant="outline">
              {[...graph.entities.values()].filter((e) => !e.stub).length} entities
            </Badge>
            {(['json-ld', 'microdata', 'rdfa'] as const).map((s) => {
              const n = page!.blocks.filter((b) => b.source === s).length;
              return n ? (
                <Badge key={s} color="gray">
                  {s} ×{n}
                </Badge>
              ) : null;
            })}
            {counts.error > 0 && <Badge color="red">{counts.error} error{counts.error > 1 ? "s" : ""}</Badge>}
            {counts.warning > 0 && <Badge color="yellow">{counts.warning} warning{counts.warning > 1 ? "s" : ""}</Badge>}
          </Group>

          <Tabs value={tab} onChange={setTab} keepMounted={false} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <Tabs.List grow px="xs" pb={6} style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
              <Tabs.Tab value="graph" leftSection={<IconGraph size={14} />}>Graph</Tabs.Tab>
              <Tabs.Tab value="tree" leftSection={<IconBinaryTree2 size={14} />}>Tree</Tabs.Tab>
              <Tabs.Tab
                value="issues"
                leftSection={<IconAlertTriangle size={14} />}
                rightSection={graph.issues.length ? <Badge size="xs" circle color={counts.error ? 'red' : 'yellow'}>{graph.issues.length}</Badge> : null}
              >
                Issues
              </Tabs.Tab>
              <Tabs.Tab value="raw" leftSection={<IconBraces size={14} />}>Raw</Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="graph" style={{ flex: 1, minHeight: 0 }}>
              <GraphView graph={graph} selected={selected} onSelect={select} issueIds={worstByEntity} fileStem={fileStem} />
            </Tabs.Panel>
            <Tabs.Panel value="tree" style={{ flex: 1, minHeight: 0 }}>
              <ScrollArea h="100%">
                <TreeView graph={graph} selected={selected} onSelect={select} />
              </ScrollArea>
            </Tabs.Panel>
            <Tabs.Panel value="issues" style={{ flex: 1, minHeight: 0 }}>
              <ScrollArea h="100%">
                <IssuesView graph={graph} onSelect={select} />
              </ScrollArea>
            </Tabs.Panel>
            <Tabs.Panel value="raw" style={{ flex: 1, minHeight: 0 }}>
              <ScrollArea h="100%">
                <RawView blocks={page!.blocks} generators={graph.generators} note={originNote} onFetchOriginal={originFetch} />
              </ScrollArea>
            </Tabs.Panel>
          </Tabs>

          <Drawer
            opened={drawerOpen && !!entity}
            onClose={() => setDrawerOpen(false)}
            position="bottom"
            size="62%"
            withOverlay={false}
            lockScroll={false}
            trapFocus={false}
            shadow="xl"
            padding="sm"
            title={
              entity && (
                <Group gap={6}>
                  <TypeBadges types={entity.types} stub={entity.stub} />
                  <Text fw={600} size="sm" truncate maw={200}>
                    {entity.label}
                  </Text>
                </Group>
              )
            }
          >
            {entity && (
              <EntityDetail
                entity={entity}
                graph={graph}
                issues={graph.issues.filter((i) => i.entityId === entity.id)}
                onSelect={select}
              />
            )}
          </Drawer>
        </>
      )}
    </Stack>
  );
}

function Header({ page, onRefresh, graphReady, onExportJson }: { page: PageData | null; onRefresh: () => void; graphReady: boolean; onExportJson: () => void }) {
  const { setColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme('light');
  const enc = encodeURIComponent(page?.url ?? '');

  return (
    <Group justify="space-between" wrap="nowrap" px="xs" py={8} gap={6}>
      <Box style={{ minWidth: 0 }}>
        <Text size="sm" fw={650} truncate>
          {page?.title || 'Entity Viewer'}
        </Text>
        <Text size="xs" c="dimmed" truncate>
          {page?.url ?? ''}
        </Text>
      </Box>
      <Group gap={0} wrap="nowrap">
        <Tooltip label="Re-scan page">
          <ActionIcon aria-label="Re-scan page" onClick={onRefresh}>
            <IconRefresh size={16} />
          </ActionIcon>
        </Tooltip>
        <Menu position="bottom-end" withinPortal shadow="md">
          <Menu.Target>
            <ActionIcon aria-label="Export and validators" disabled={!page}>
              <IconDownload size={16} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Label>Export</Menu.Label>
            <Menu.Item disabled={!graphReady} onClick={onExportJson}>
              Merged graph (.jsonld)
            </Menu.Item>
            <Menu.Divider />
            <Menu.Label>Validate this URL</Menu.Label>
            <Menu.Item rightSection={<IconExternalLink size={12} />} onClick={() => openTab(`https://validator.schema.org/#url=${enc}`)}>
              Schema Markup Validator
            </Menu.Item>
            <Menu.Item rightSection={<IconExternalLink size={12} />} onClick={() => openTab(`https://search.google.com/test/rich-results?url=${enc}`)}>
              Rich Results Test
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
        <Tooltip label="Toggle theme">
          <ActionIcon aria-label="Toggle theme" onClick={() => setColorScheme(scheme === 'dark' ? 'light' : 'dark')}>
            {scheme === 'dark' ? <IconSun size={16} /> : <IconMoon size={16} />}
          </ActionIcon>
        </Tooltip>
      </Group>
    </Group>
  );
}

function Empty({ icon, title, children, color }: { icon: React.ReactNode; title: string; children: React.ReactNode; color?: string }) {
  return (
    <Center flex={1} p="lg">
      <Stack align="center" gap="sm" maw={280}>
        <ThemeIcon size={44} radius="xl" variant="light" color={color}>
          {icon}
        </ThemeIcon>
        <Text fw={600}>{title}</Text>
        {children}
      </Stack>
    </Center>
  );
}
