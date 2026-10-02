import type { PageData } from './types';
import { originalJsonLd } from './provenance';

export const ALL_URLS = { origins: ['<all_urls>'] };

let windowId: number | undefined;

async function myWindowId(): Promise<number> {
  if (windowId === undefined) windowId = (await browser.windows.getCurrent()).id;
  return windowId!;
}

export async function activeTab(): Promise<{ id: number; url?: string; title?: string } | undefined> {
  const [tab] = await browser.tabs.query({ active: true, windowId: await myWindowId() });
  return tab;
}

export const hasHostPermission = (): Promise<boolean> => browser.permissions.contains(ALL_URLS);

/** Must be called synchronously from a click handler (user gesture). */
export const requestHostPermission = (): Promise<boolean> => browser.permissions.request(ALL_URLS);

export async function extractFrom(tabId: number): Promise<PageData> {
  const [res] = await browser.scripting.executeScript({ target: { tabId }, files: ['extract.js'] });
  if (!res || !res.result) throw new Error('The page returned no data.');
  return res.result as PageData;
}

/** The JSON-LD scripts in the HTML the server sends for the tab's URL. */
export async function originalFrom(tabId: number): Promise<string[]> {
  const [res] = await browser.scripting.executeScript({ target: { tabId }, func: originalJsonLd });
  const out = res?.result as Awaited<ReturnType<typeof originalJsonLd>> | undefined;
  if (!out) throw new Error('The page returned no data.');
  if (!Array.isArray(out)) throw new Error(out.error);
  return out;
}

/** Calls `cb` whenever the active tab in this sidebar's window changes or finishes loading. */
export function onActivePageChange(cb: () => void): () => void {
  const onActivated = async (info: { windowId: number }) => {
    if (info.windowId === (await myWindowId())) cb();
  };
  const onUpdated = async (_id: number, change: { status?: string; url?: string }, tab: { active: boolean; windowId: number }) => {
    if (tab.active && tab.windowId === (await myWindowId()) && (change.status === 'complete')) cb();
  };
  browser.tabs.onActivated.addListener(onActivated);
  browser.tabs.onUpdated.addListener(onUpdated);
  return () => {
    browser.tabs.onActivated.removeListener(onActivated);
    browser.tabs.onUpdated.removeListener(onUpdated);
  };
}

export function download(filename: string, data: Blob | string, type = 'application/json') {
  const blob = typeof data === 'string' ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const openTab = (url: string) => browser.tabs.create({ url });
