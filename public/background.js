/* global browser */
const api = globalThis.browser;
const ALL = { origins: ['<all_urls>'] };

api.action.onClicked.addListener(() => {
  api.sidebarAction.toggle();
});

api.action.setBadgeBackgroundColor({ color: '#19a4a2' });
if (api.action.setBadgeTextColor) api.action.setBadgeTextColor({ color: '#ffffff' });

function countEntities(page) {
  const ids = new Set();
  let blanks = 0;
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== 'object') return;
    if (v['@type']) {
      if (v['@id']) ids.add(v['@id']);
      else blanks++;
    }
    for (const [k, child] of Object.entries(v)) if (k !== '@context') walk(child);
  };
  for (const b of page.blocks || []) if (!b.error) walk(b.data);
  return ids.size + blanks;
}

async function updateBadge(tabId, url) {
  if (!/^https?:/i.test(url || '')) {
    api.action.setBadgeText({ tabId, text: '' });
    return;
  }
  if (!(await api.permissions.contains(ALL))) return;
  try {
    const [res] = await api.scripting.executeScript({ target: { tabId }, files: ['extract.js'] });
    const page = res && res.result;
    if (!page) return;
    const n = countEntities(page);
    const hasError = page.blocks.some((b) => b.error);
    api.action.setBadgeBackgroundColor({ tabId, color: hasError ? '#e03131' : '#19a4a2' });
    api.action.setBadgeText({ tabId, text: n ? String(n) : '' });
  } catch {
    // Restricted pages (about:, AMO, PDF viewer) reject injection; leave the badge blank.
  }
}

api.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete') updateBadge(tabId, tab.url);
});
