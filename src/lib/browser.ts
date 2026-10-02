import type { PageData } from './types';
import { originalJsonLd, type OriginalResult } from './provenance';

/** The WebExtension API: `browser` in Firefox, `chrome` in Chrome (whose MV3 calls also return promises). */
const api = typeof browser !== 'undefined' ? browser : typeof chrome !== 'undefined' ? chrome : undefined;

/** Running as an extension, not as the demo page (`npx vite`). */
export const IN_EXTENSION = !!api?.scripting;

export const BROWSER_NAME = __BROWSER__ === 'chrome' ? 'Chrome' : 'Firefox';

export const ALL_URLS = { origins: ['<all_urls>'] };

let windowId: number | undefined;

async function myWindowId(): Promise<number> {
  if (windowId === undefined) windowId = (await api.windows.getCurrent()).id;
  return windowId!;
}

export async function activeTab(): Promise<{ id: number; url?: string; title?: string } | undefined> {
  const [tab] = await api.tabs.query({ active: true, windowId: await myWindowId() });
  return tab;
}

export const hasHostPermission = (): Promise<boolean> => api.permissions.contains(ALL_URLS);

/** Must be called synchronously from a click handler (user gesture). */
export const requestHostPermission = (): Promise<boolean> => api.permissions.request(ALL_URLS);

export async function extractFrom(tabId: number): Promise<PageData> {
  const [res] = await api.scripting.executeScript({ target: { tabId }, files: ['extract.js'] });
  if (!res || !res.result) throw new Error('The page returned no data.');
  return res.result as PageData;
}

/** The JSON-LD scripts in the HTML the server sends for `url`, read in the tab (from the HTTP cache unless `network`). */
export async function originalFrom(tabId: number, url: string, network: boolean): Promise<OriginalResult> {
  const [res] = await api.scripting.executeScript({ target: { tabId }, func: originalJsonLd, args: [url, network] });
  return (res?.result as OriginalResult | undefined) ?? { error: 'the page returned no data' };
}

/** Calls `cb` whenever the active tab in this sidebar's window changes or finishes loading. */
export function onActivePageChange(cb: () => void): () => void {
  const onActivated = async (info: { windowId: number }) => {
    if (info.windowId === (await myWindowId())) cb();
  };
  const onUpdated = async (_id: number, change: { status?: string; url?: string }, tab: { active: boolean; windowId: number }) => {
    if (tab.active && tab.windowId === (await myWindowId()) && (change.status === 'complete')) cb();
  };
  api.tabs.onActivated.addListener(onActivated);
  api.tabs.onUpdated.addListener(onUpdated);
  return () => {
    api.tabs.onActivated.removeListener(onActivated);
    api.tabs.onUpdated.removeListener(onUpdated);
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

export const openTab = (url: string) => api.tabs.create({ url });
