import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export function coverage(archive) {
  const recorded = new Set(archive.states.map(s => s.path));
  return {
    required: archive.requiredPaths.map(path => ({ path, captured: recorded.has(path) })),
    controls: archive.states.flatMap(state => state.actions.map(action => ({
      state: state.id, path: state.path, label: action.label,
      recorded: archive.transitions.some(t => t.from === state.id && t.ids.includes(action.id)),
    }))),
  };
}

export async function exportHTML(archive, output) {
  if (!archive.states.length) throw new Error('No real pages captured. Refusing to export an empty or fabricated walkthrough.');
  const payload = JSON.stringify({ ...archive, coverage: coverage(archive) });
  if (Buffer.byteLength(payload) > 128 * 1024 * 1024) throw new Error('Archive exceeds the 128 MiB safety limit. Remove redundant states and retry.');
  const encoded = gzipSync(payload).toString('base64');
  const script = await readFile(new URL('./viewer.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('./viewer.css', import.meta.url), 'utf8');
  const hash = createHash('sha256').update(script).digest('base64');
  const csp = `default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WebFig · Recorded interface</title><style>${css}</style></head>
<body>
<header><div><strong>WebFig archive</strong><span class="badge">OFFLINE · RECORDED</span></div><p>Real captured interface. Only recorded navigation works. This file cannot configure a router.</p></header>
<div id="loading" role="status">Opening embedded capture… JavaScript and a modern browser with DecompressionStream are required.</div>
<div id="app" hidden>
<aside><label for="search">Find a captured page</label><input id="search" type="search" placeholder="IP / Firewall…"><nav id="states" aria-label="Captured pages"></nav><button id="coverage-toggle">Coverage &amp; limitations</button><p id="summary"></p></aside>
<main><div class="toolbar"><button id="back" aria-label="Previous page">← Back</button><button id="next" aria-label="Next recorded step">Next step →</button><h1 id="path"></h1></div><p id="note"></p><div id="notice" role="status" aria-live="polite"></div><div id="choices" hidden></div><div class="viewport"><iframe id="screen" title="Captured WebFig page" sandbox="allow-same-origin" referrerpolicy="no-referrer"></iframe></div><section id="coverage" hidden><h2>Coverage &amp; limitations</h2><p>This inventory contains controls found in captured pages, not a certified list of every RouterOS menu. Hidden menus, unvisited dialogs, hardware-specific features and pagination may still be missing. A control is recorded only when a real click from that exact state was followed by a capture.</p><div id="metadata"></div><h3>Required page checklist</h3><div id="required"></div><h3>Observed controls</h3><input id="control-search" type="search" aria-label="Filter observed controls" placeholder="Filter controls…"><div id="controls"></div></section></main>
</div><script id="archive" type="application/octet-stream">${encoded}</script><script>${script}</script></body></html>`;
  const path = resolve(output);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, html, { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
  return { path, bytes: Buffer.byteLength(html), coverage: coverage(archive) };
}
