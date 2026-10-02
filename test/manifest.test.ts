import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildManifest } from '../scripts/manifest';

test('Firefox gets a sidebar, a background script and the Gecko settings', () => {
  const m = buildManifest('firefox', '1.2.3') as any;
  assert.equal(m.version, '1.2.3');
  assert.equal(m.manifest_version, 3);
  assert.deepEqual(m.background, { scripts: ['background.js'] });
  assert.equal(m.sidebar_action.default_panel, 'sidebar.html');
  assert.ok(m.commands._execute_sidebar_action);
  assert.ok(m.browser_specific_settings.gecko.id);
  assert.equal(m.side_panel, undefined);
  assert.deepEqual(m.permissions, ['scripting', 'tabs', 'activeTab']);
});

test('Chrome gets a side panel, a service worker and PNG icons, and nothing Gecko-only', () => {
  const m = buildManifest('chrome', '1.2.3') as any;
  assert.equal(m.version, '1.2.3');
  assert.deepEqual(m.background, { service_worker: 'background.js' });
  assert.equal(m.side_panel.default_path, 'sidebar.html');
  assert.ok(m.commands._execute_action);
  assert.deepEqual(m.permissions, ['scripting', 'tabs', 'activeTab', 'sidePanel']);
  assert.equal(m.action.default_title, 'Toggle Entity Viewer', 'base keys survive the merge');
  for (const key of ['sidebar_action', 'browser_specific_settings']) assert.equal(m[key], undefined, key);
  for (const path of [...Object.values(m.icons), ...Object.values(m.action.default_icon)]) assert.match(String(path), /\.png$/);
});
