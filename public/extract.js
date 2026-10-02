// Injected into the page via scripting.executeScript. The value of the final
// expression is returned to the caller, so this file must end with the IIFE.
(() => {
  const SCHEMA_RE = /^https?:\/\/schema\.org\//i;

  const shortType = (t) => (SCHEMA_RE.test(t) ? t.replace(SCHEMA_RE, '') : t);
  const contextOf = (t) => {
    if (SCHEMA_RE.test(t)) return 'https://schema.org';
    const i = Math.max(t.lastIndexOf('/'), t.lastIndexOf('#'));
    return i > 0 ? t.slice(0, i + 1) : t;
  };
  const squash = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const addProp = (item, key, val) => {
    if (key in item) item[key] = [].concat(item[key], val);
    else item[key] = val;
  };

  /* ---------------- JSON-LD ---------------- */
  function jsonLdBlocks() {
    const out = [];
    document.querySelectorAll('script[type="application/ld+json" i]').forEach((s, index) => {
      const raw = s.textContent || '';
      const block = { source: 'json-ld', index, raw };
      try {
        block.data = JSON.parse(raw);
      } catch (e1) {
        // Common real-world wrappers: HTML comments, CDATA, trailing semicolons.
        const cleaned = raw
          .replace(/^\s*<!--/, '')
          .replace(/-->\s*$/, '')
          .replace(/\/\/\s*<!\[CDATA\[/, '')
          .replace(/\/\/\s*\]\]>/, '')
          .replace(/;\s*$/, '');
        try {
          block.data = JSON.parse(cleaned);
          block.warning = 'Parsed only after stripping comment/CDATA wrappers.';
        } catch (e2) {
          block.error = String(e1 && e1.message ? e1.message : e1);
        }
      }
      out.push(block);
    });
    return out;
  }

  /* ---------------- Microdata ---------------- */
  function mdValue(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'meta') return el.getAttribute('content') ?? '';
    if (['audio', 'embed', 'iframe', 'img', 'source', 'track', 'video'].includes(tag))
      return el.src || el.getAttribute('src') || '';
    if (['a', 'area', 'link'].includes(tag)) return el.href || el.getAttribute('href') || '';
    if (tag === 'object') return el.data || el.getAttribute('data') || '';
    if (tag === 'data' || tag === 'meter') return el.getAttribute('value') ?? '';
    if (tag === 'time') return el.getAttribute('datetime') || squash(el.textContent);
    if (el.hasAttribute('content')) return el.getAttribute('content');
    return squash(el.textContent);
  }

  function mdPropElements(root) {
    const found = [];
    const pending = [...root.children];
    for (const id of (root.getAttribute('itemref') || '').split(/\s+/).filter(Boolean)) {
      const r = document.getElementById(id);
      if (r) pending.push(r);
    }
    const seen = new Set();
    while (pending.length) {
      const el = pending.shift();
      if (seen.has(el)) continue;
      seen.add(el);
      if (el.hasAttribute('itemprop')) found.push(el);
      if (!el.hasAttribute('itemscope')) pending.push(...el.children);
    }
    return found;
  }

  function mdItem(el, top, stack) {
    if (stack.has(el) || stack.size > 25) return { '@type': '(cycle)' };
    stack.add(el);
    const item = {};
    const types = (el.getAttribute('itemtype') || '').trim().split(/\s+/).filter(Boolean);
    if (types.length) {
      if (top) item['@context'] = contextOf(types[0]);
      item['@type'] = types.length === 1 ? shortType(types[0]) : types.map(shortType);
    }
    const id = el.getAttribute('itemid');
    if (id) item['@id'] = id;
    for (const p of mdPropElements(el)) {
      const val = p.hasAttribute('itemscope') ? mdItem(p, false, stack) : mdValue(p);
      for (const name of p.getAttribute('itemprop').trim().split(/\s+/)) {
        addProp(item, shortType(name), val);
      }
    }
    stack.delete(el);
    return item;
  }

  function microdataBlocks() {
    return [...document.querySelectorAll('[itemscope]:not([itemprop])')].map((el, index) => ({
      source: 'microdata',
      index,
      data: mdItem(el, true, new Set()),
    }));
  }

  /* ---------------- RDFa (Lite) ---------------- */
  function rdfaPrefixes(el) {
    const map = { schema: 'https://schema.org/' };
    const chain = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) chain.unshift(n);
    for (const n of chain) {
      const p = n.getAttribute('prefix');
      if (!p) continue;
      const parts = p.trim().split(/\s+/);
      for (let i = 0; i + 1 < parts.length; i += 2) map[parts[i].replace(/:$/, '')] = parts[i + 1];
    }
    return map;
  }

  function rdfaExpand(term, el) {
    if (/^https?:\/\//i.test(term)) return term;
    const m = term.match(/^([\w-]+):(.+)$/);
    if (m) {
      const pre = rdfaPrefixes(el)[m[1]];
      if (pre) return pre + m[2];
    }
    const vocabEl = el.closest('[vocab]');
    return (vocabEl ? vocabEl.getAttribute('vocab') : '') + term;
  }

  function rdfaValue(el) {
    if (el.hasAttribute('content')) return el.getAttribute('content');
    for (const a of ['resource', 'href', 'src']) {
      if (el.hasAttribute(a)) return a === 'resource' ? el.getAttribute(a) : el[a] || el.getAttribute(a);
    }
    if (el.tagName.toLowerCase() === 'time' && el.hasAttribute('datetime')) return el.getAttribute('datetime');
    return squash(el.textContent);
  }

  function rdfaItem(el, top, stack) {
    if (stack.has(el) || stack.size > 25) return { '@type': '(cycle)' };
    stack.add(el);
    const item = {};
    const types = (el.getAttribute('typeof') || '').trim().split(/\s+/).filter(Boolean).map((t) => rdfaExpand(t, el));
    if (types.length) {
      if (top) item['@context'] = contextOf(types[0]);
      item['@type'] = types.length === 1 ? shortType(types[0]) : types.map(shortType);
    }
    const id = el.getAttribute('resource') || el.getAttribute('about');
    if (id) item['@id'] = id;

    const pending = [...el.children];
    while (pending.length) {
      const c = pending.shift();
      const isItem = c.hasAttribute('typeof');
      if (c.hasAttribute('property')) {
        const val = isItem ? rdfaItem(c, false, stack) : rdfaValue(c);
        for (const name of c.getAttribute('property').trim().split(/\s+/)) {
          addProp(item, shortType(rdfaExpand(name, c)), val);
        }
      }
      if (!isItem) pending.push(...c.children);
    }
    stack.delete(el);
    return item;
  }

  function rdfaBlocks() {
    return [...document.querySelectorAll('[typeof]')]
      .filter((el) => !(el.hasAttribute('property') && el.parentElement && el.parentElement.closest('[typeof]')))
      .map((el, index) => ({ source: 'rdfa', index, data: rdfaItem(el, true, new Set()) }));
  }

  const safe = (fn, source) => {
    try {
      return fn();
    } catch (e) {
      return [{ source, index: 0, error: 'Extractor failed: ' + (e && e.message ? e.message : e) }];
    }
  };

  /* ---------------- Visible text (for the markup vs. content check) ---------------- */
  const MAX_TEXT = 2 * 1024 * 1024;

  function visibleText() {
    const body = document.body;
    if (!body) return undefined;
    let text;
    try {
      text = body.innerText;
    } catch (e) {
      text = undefined;
    }
    if (typeof text !== 'string') {
      // No layout (jsdom): fall back to textContent without scripts and styles.
      const clone = body.cloneNode(true);
      clone.querySelectorAll('script, style, noscript, template').forEach((el) => el.remove());
      text = clone.textContent || '';
    }
    const extras = [];
    body.querySelectorAll('[alt], [aria-label]').forEach((el) => {
      if (el.closest('[hidden], [aria-hidden="true"]')) return;
      for (const a of ['alt', 'aria-label']) {
        const v = el.getAttribute(a);
        if (v && v.trim()) extras.push(v.trim());
      }
    });
    return (text + '\n' + extras.join('\n')).slice(0, MAX_TEXT);
  }

  const page = {
    url: location.href,
    title: document.title,
    blocks: [
      ...safe(jsonLdBlocks, 'json-ld'),
      ...safe(microdataBlocks, 'microdata'),
      ...safe(rdfaBlocks, 'rdfa'),
    ],
  };
  try {
    const text = visibleText();
    if (text !== undefined) page.visibleText = text;
  } catch (e) {
    // Only the mismatch check needs this; leave it out.
  }
  return page;
})();
