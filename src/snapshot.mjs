import valueParser from 'postcss-value-parser';

export const FRAME_CSP = "default-src 'none'; script-src 'none'; connect-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

// Runs in the live page. No keys, input events, cookies or response bodies are recorded.
export function installObserver() {
  if (window.__wfa) return;
  let sequence = 0;
  const prefix = Math.random().toString(36).slice(2);
  const ids = new WeakMap();
  window.__wfa = {
    armed: false,
    id(node) {
      if (!ids.has(node)) ids.set(node, `${prefix}-${++sequence}`);
      return ids.get(node);
    },
  };
  window.addEventListener('click', (event) => {
    if (!window.__wfa.armed) return;
    const el = event.target instanceof Element ? event.target : event.target.parentElement;
    if (el?.closest('input:not([type="button"]):not([type="submit"]):not([type="reset"]), textarea, select, [contenteditable="true"]')) return;
    const ids = [];
    for (let node = el; node && node !== document.body; node = node.parentElement) ids.push(window.__wfa.id(node));
    const source = window.__wfa.source;
    const action = ids.find(id => source?.actions.includes(id));
    window.__wfaClick({ source: source?.id, action }).catch(() => {});
  }, true);
}

// The serialization function deliberately does not copy arbitrary attributes or source JS.
// Computed styles preserve the real DOM appearance without depending on original CSS/JS.
export function serializePage({ redactSelectors, includeFormValues }) {
  const state = window.__wfa;
  const doc = document.implementation.createHTMLDocument('Captured WebFig');
  doc.body.replaceChildren();
  const warnings = new Set();
  const blocked = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'BASE', 'IFRAME', 'FRAME', 'FRAMESET', 'OBJECT', 'EMBED', 'APPLET', 'AUDIO', 'VIDEO', 'SOURCE', 'TRACK', 'TEMPLATE', 'NOSCRIPT']);
  const safeTags = new Set('body a abbr address article aside b bdi bdo blockquote br button caption center code col colgroup dd del details dfn div dl dt em fieldset figcaption figure font footer form h1 h2 h3 h4 h5 h6 header hr i img input ins kbd label legend li main mark menu nav ol optgroup option p pre progress q s samp section select small span strong sub summary sup table tbody td textarea tfoot th thead time tr u ul var wbr'.split(' '));
  const selected = new Set();
  for (const selector of redactSelectors) {
    // Invalid privacy selectors must fail closed, not silently capture secrets.
    for (const el of document.querySelectorAll(selector)) selected.add(el);
  }
  const sensitive = /password|passwd|passphrase|secret|private.?key|preshared|pre.shared|psk|community|token|credential/i;
  for (const table of document.querySelectorAll('table')) {
    const rows = [...table.rows];
    for (const row of rows) {
      if (row.cells.length === 2 && sensitive.test(row.cells[0].innerText)) selected.add(row.cells[1]);
      for (const cell of row.cells) {
        if ((cell.tagName === 'TH' || row === rows[0]) && sensitive.test(cell.innerText)) {
          const index = cell.cellIndex;
          for (const other of rows) if (other !== row && other.cells[index]) selected.add(other.cells[index]);
        }
      }
    }
  }
  const styles = (source, dest) => {
    const computed = getComputedStyle(source);
    for (const property of computed) {
      // Do not preserve image-set(), custom properties, cursor URLs or executable legacy CSS.
      if (property.startsWith('--') || /^(cursor|animation|transition|behavior|-moz-binding)/.test(property)) continue;
      const value = computed.getPropertyValue(property);
      if (/image-set\(|expression\(/i.test(value)) continue;
      dest.style.setProperty(property, value);
    }
  };
  const actions = [];
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return doc.createTextNode(node.textContent);
    if (!(node instanceof Element) || blocked.has(node.tagName)) {
      if (node instanceof Element && /^(IFRAME|FRAME|OBJECT|EMBED)$/.test(node.tagName)) warnings.add('Embedded content omitted; capture that page separately.');
      return null;
    }
    const rendered = getComputedStyle(node);
    // Hidden app state often contains credentials or a not-yet-open dialog. Capture it
    // only once an operator actually reveals it in a later state.
    if (node.tagName !== 'BODY' && (node.hasAttribute('hidden') || rendered.display === 'none' || rendered.visibility === 'hidden' || rendered.visibility === 'collapse' || rendered.opacity === '0')) return null;
    const tag = node.tagName.toLowerCase();
    const dest = doc.createElement(safeTags.has(tag) ? (tag === 'form' ? 'div' : tag) : 'span');
    styles(node, dest);
    dest.setAttribute('data-wfa-id', state.id(node));
    // No original IDs/classes/data attributes: WebFig can keep credentials in arbitrary attributes.
    for (const attr of ['colspan', 'rowspan', 'span', 'dir', 'lang', 'role', 'aria-label']) {
      if (node.hasAttribute(attr)) dest.setAttribute(attr, node.getAttribute(attr));
    }
    const identity = `${node.id} ${node.getAttribute('name') || ''} ${node.getAttribute('autocomplete') || ''} ${node.getAttribute('aria-label') || ''}`;
    const labels = node.labels ? [...node.labels].map(label => label.textContent).join(' ') : '';
    const siblingLabel = node.previousElementSibling?.matches('label') ? node.previousElementSibling.textContent : '';
    const privateNode = selected.has(node) || sensitive.test(`${identity} ${labels} ${siblingLabel}`) || node.matches('[contenteditable="true"], input[type="password"], input[type="hidden"]');
    if (privateNode) {
      dest.removeAttribute('aria-label');
      dest.textContent = '[redacted]';
      if (tag === 'input') { dest.type = 'text'; dest.value = ''; dest.setAttribute('placeholder', '[redacted]'); }
      return dest;
    }
    if (tag === 'input') {
      const type = node.type;
      dest.type = ['button', 'submit', 'reset'].includes(type) ? 'button' : (['checkbox', 'radio', 'number', 'text', 'email', 'search', 'tel', 'url', 'range', 'date'].includes(type) ? type : 'text');
      if (dest.type === 'button') dest.setAttribute('value', node.value);
      else if (includeFormValues) {
        dest.setAttribute('value', node.value);
        if (node.checked) dest.setAttribute('checked', '');
      } else dest.setAttribute('placeholder', '[value omitted]');
    } else if (tag === 'textarea') {
      dest.textContent = includeFormValues ? node.value : '[value omitted]';
    } else if (tag === 'select' && !includeFormValues) {
      const option = doc.createElement('option'); option.textContent = '[value omitted]'; dest.append(option);
    } else if (tag === 'img') {
      dest.setAttribute('data-wfa-image', node.currentSrc || node.src);
      dest.setAttribute('alt', node.alt || 'Captured image');
    } else if (tag === 'canvas' || tag === 'svg' || node.shadowRoot) {
      dest.textContent = '[unsupported graphic/component]';
      warnings.add('Canvas, SVG or shadow DOM content omitted; not a complete visual capture.');
    } else {
      for (const child of node.childNodes) { const copy = walk(child); if (copy) dest.append(copy); }
    }
    if (tag === 'option' && includeFormValues && node.selected) dest.setAttribute('selected', '');
    if (tag === 'details' && node.open) dest.setAttribute('open', '');
    const computed = getComputedStyle(node);
    const visible = !!node.getClientRects().length && computed.visibility !== 'hidden' && computed.display !== 'none';
    if (visible && (node.matches('a,button,input[type="button"],input[type="submit"],input[type="reset"],summary,[role="button"],[role="tab"],[role="menuitem"],[onclick]') || computed.cursor === 'pointer')) {
      const label = (dest.textContent || dest.getAttribute('aria-label') || (dest.type === 'button' ? dest.value : '') || tag).trim().replace(/\s+/g, ' ').slice(0, 120);
      actions.push({ id: state.id(node), label });
      dest.setAttribute('data-wfa-action', '');
      dest.tabIndex = 0;
      // No href, even '#': browser context menus must not navigate the frame.
    }
    // Pseudo-element text is part of many WebFig menu icons/labels.
    for (const pseudo of ['::before', '::after']) {
      const css = getComputedStyle(node, pseudo);
      const content = css.content;
      if (content && /^".*"$/.test(content) && content !== '""') {
        const extra = doc.createElement('span');
        extra.textContent = content.slice(1, -1);
        extra.style.cssText = `color:${css.color};font-family:${css.fontFamily};font-size:${css.fontSize}`;
        if (pseudo === '::before') dest.prepend(extra); else dest.append(extra);
      }
    }
    return dest;
  };
  const body = walk(document.body);
  doc.body.replaceWith(body);
  styles(document.documentElement, doc.documentElement);
  return { html: doc.documentElement.outerHTML, actions, warnings: [...warnings] };
}

export function redactText(text, literals) {
  for (const literal of [...literals].sort((a, b) => b.length - a.length)) {
    if (!literal) continue;
    text = text.split(literal).join('[redacted]');
    const escapedText = literal.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    const escapedAttribute = escapedText.replaceAll('"', '&quot;');
    text = text.split(escapedAttribute).join('[redacted]').split(escapedText).join('[redacted]');
  }
  return text;
}

// Only raster image responses are retained in memory. Never cache /jsproxy, scripts,
// XHR, fonts, SVG or authentication traffic. No additional requests are made by export.
export function collectAssets(page, maxAssetBytes = 2_000_000) {
  const assets = new Map();
  const pending = new Set();
  let total = 0;
  page.on('response', response => {
    const task = (async () => {
      if (response.request().resourceType() !== 'image') return;
      const type = (response.headers()['content-type'] || '').split(';')[0];
      if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/x-icon'].includes(type)) return;
      if (Number(response.headers()['content-length']) > maxAssetBytes || total >= 12_000_000) return;
      const data = await response.body();
      if (data.length > maxAssetBytes || total + data.length > 12_000_000) return;
      total += data.length;
      assets.set(response.url(), `data:${type};base64,${data.toString('base64')}`);
    })().catch(() => {});
    pending.add(task); task.finally(() => pending.delete(task));
  });
  return { assets, flush: () => Promise.all([...pending]) };
}

export function inlineCSSValue(value, assets, warnings) {
  const parsed = valueParser(value);
  parsed.walk(node => {
    if (node.type === 'function' && node.value.toLowerCase() === 'url') {
      const url = node.nodes?.[0]?.value || '';
      const data = assets.get(url) || (/^data:image\/(png|jpeg|gif|webp|x-icon);base64,[a-z0-9+/=]+$/i.test(url) ? url : '');
      if (!data) warnings.add('Some image assets were unavailable and omitted.');
      node.nodes = [{ type: 'string', quote: '"', value: data }];
      return false;
    }
  });
  return parsed.toString();
}

export async function snapshot(page, options, assetStore) {
  await page.evaluate(installObserver);
  const raw = await page.evaluate(serializePage, options);
  await assetStore.flush();
  const warnings = new Set(raw.warnings);
  // Operate on the isolated clone, never mutate the live router DOM.
  const cloned = await page.evaluate(({ html, assets, csp }) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const meta = doc.createElement('meta'); meta.httpEquiv = 'Content-Security-Policy'; meta.content = csp; doc.head.prepend(meta);
    let missingImages = 0;
    for (const img of doc.querySelectorAll('[data-wfa-image]')) {
      const url = img.getAttribute('data-wfa-image');
      const data = assets[url] || (/^data:image\/(png|jpeg|gif|webp|x-icon);base64,[a-z0-9+/=]+$/i.test(url) ? url : '');
      if (data) img.setAttribute('src', data); else missingImages++;
      img.removeAttribute('data-wfa-image');
    }
    // Prevent local form edits masquerading as configuration changes in replay.
    for (const input of doc.querySelectorAll('input:not([type="button"]),textarea,select')) {
      input.setAttribute('disabled', ''); input.setAttribute('aria-label', 'Recorded value, read only');
    }
    return { html: doc.documentElement.outerHTML, missingImages };
  }, { html: raw.html, assets: Object.fromEntries(assetStore.assets), csp: FRAME_CSP });
  if (cloned.missingImages) warnings.add(`${cloned.missingImages} image assets were unavailable and omitted.`);
  // Serialized inline styles escape quotes, so decode CSS attributes before rewriting URLs.
  const embedded = cloned.html.replace(/style="([^"]*)"/g, (_, css) => {
    const decoded = css.replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
    const safe = inlineCSSValue(decoded, assetStore.assets, warnings);
    return `style="${safe.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}"`;
  });
  return {
    html: redactText(embedded, options.literals),
    actions: raw.actions.map(action => ({ ...action, label: redactText(action.label, options.literals) })),
    warnings: [...warnings],
  };
}
