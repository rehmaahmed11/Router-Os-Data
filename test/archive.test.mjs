import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { chromium } from 'playwright';
import { Recorder, validateTarget } from '../src/recorder.mjs';
import { redactText, inlineCSSValue } from '../src/snapshot.mjs';
import { coverage, exportHTML } from '../src/export.mjs';

const browserOptions = { headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) };
function decode(html) { return JSON.parse(gunzipSync(Buffer.from(html.match(/id="archive"[^>]*>([^<]+)/)[1], 'base64'))); }

test('target validation rejects credentials, third-party webfig.do and query secrets', () => {
  for (const url of ['file:///tmp/a', 'http://admin:pw@localhost/', 'http://webfig.do/', 'https://www.webfig.do/', 'http://localhost/?password=x']) assert.throws(() => validateTarget(url));
  assert.equal(validateTarget('http://127.0.0.1:8080/webfig/#IP').origin, 'http://127.0.0.1:8080');
});

test('literal redaction and CSS URL embedding', () => {
  assert.equal(redactText('a&lt;&quot; a<"', ['a<"']), '[redacted] [redacted]');
  const warnings = new Set();
  assert.equal(inlineCSSValue('url("http://router/img")', new Map([['http://router/img', 'data:image/png;base64,AA==']]), warnings), 'url("data:image/png;base64,AA==")');
  assert.equal(inlineCSSValue('url(https://evil.invalid/a)', new Map(), warnings), 'url("")');
  assert.equal(warnings.size, 1);
});

test('refuses empty fabricated exports', async () => {
  await assert.rejects(exportHTML({ states: [] }, '/tmp/not-created.html'), /No real pages/);
});

test('captures DOM, replays nested clicks offline, redacts secrets and reports missing coverage', async t => {
  const fixture = await readFile(new URL('./fixtures/webfig.html', import.meta.url));
  let liveRequests = 0;
  const server = createServer((req, res) => {
    liveRequests++;
    if (req.url === '/pixel.png') { res.setHeader('Content-Type', 'image/png'); res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8r8AAAAASUVORK5CYII=', 'base64')); }
    else { res.setHeader('Content-Type', 'text/html'); res.end(fixture); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await chromium.launch(browserOptions);
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const recorder = await new Recorder(page, {
    redactSelectors: ['#private'], literals: ['MY-LITERAL-SECRET'],
    requiredPaths: ['Home', 'IP', 'IP / Details', 'System / Missing'], routerOSVersion: 'TEST FIXTURE ONLY',
  }).init();
  await page.goto(`http://127.0.0.1:${server.address().port}/webfig/`);
  await assert.rejects(recorder.capture('private login'), /paused/);
  await recorder.arm();
  await recorder.capture('Home', 'A real DOM capture of a test fixture, not a router.');
  await page.locator('#ip span').click();
  assert.equal((await recorder.capture('IP')).edge, true);
  await page.getByRole('button', { name: 'Open details' }).click();
  assert.equal((await recorder.capture('IP / Details')).edge, true);
  assert.equal(recorder.archive.transitions.length, 2);
  assert.equal(coverage(recorder.archive).required.at(-1).captured, false);
  const dir = await mkdtemp(join(tmpdir(), 'webfig-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const output = join(dir, 'archive.html');
  await assert.rejects(recorder.export(output, { strict: true }), /Missing required/);
  await recorder.export(output);
  const html = await readFile(output, 'utf8');
  const data = decode(html);
  assert.equal(data.states.length, 3);
  const serialized = JSON.stringify(data);
  for (const secret of ['PASSWORD-NEVER-EXPORT', 'HIDDEN-NEVER-EXPORT', 'SELECTOR-NEVER-EXPORT', 'MY-LITERAL-SECRET', 'CELL-NEVER-EXPORT', 'ATTR-NEVER-EXPORT', 'SCRIPT-NEVER-EXPORT', '10.2.3.4']) assert.equal(serialized.includes(secret), false, secret);
  assert.ok(data.states[0].html.includes('data:image/png;base64,'));
  assert.ok(!data.states[0].html.includes('onclick='));
  assert.ok(!data.states[0].html.includes('<script'));
  assert.ok(!data.states[0].html.includes('https://example.invalid'));
  assert.equal((await stat(output)).mode & 0o777, 0o600);
  await page.close();
  const requestBaseline = liveRequests;
  // file://, offline mode and a fresh browser context: no captured cookies or storage.
  const context = await browser.newContext({ offline: true });
  const replay = await context.newPage();
  const networkAttempts = [], failures = [];
  replay.on('request', req => { if (/^https?:/.test(req.url())) networkAttempts.push(req.url()); });
  replay.on('pageerror', error => failures.push(error.message));
  await replay.goto(pathToFileURL(output).href);
  await replay.locator('#app').waitFor({ state: 'visible' });
  const frame = replay.frameLocator('#screen');
  await frame.getByRole('button', { name: 'IP', exact: false }).first().click();
  await assert.doesNotReject(() => replay.locator('#path').filter({ hasText: /^IP$/ }).waitFor());
  await frame.getByRole('button', { name: 'Open details' }).click();
  await replay.locator('#path').filter({ hasText: 'IP / Details' }).waitFor();
  await frame.getByRole('button', { name: 'Apply unrecorded' }).click();
  assert.match(await replay.locator('#notice').innerText(), /Not recorded/);
  assert.equal(await replay.locator('#screen').evaluate(el => el.contentWindow.realWrites), undefined);
  await replay.locator('#back').click();
  assert.equal(await replay.locator('#path').innerText(), 'IP');
  await replay.locator('#search').fill('Details');
  assert.equal(await replay.locator('#states button').count(), 1);
  await replay.locator('#coverage-toggle').click();
  assert.match(await replay.locator('#required').innerText(), /MISSING — System \/ Missing/);
  assert.deepEqual(networkAttempts, []);
  assert.deepEqual(failures, []);
  assert.equal(liveRequests, requestBaseline);
});

test('multiple clicks, pause boundaries and invalid redaction selectors fail safely', async t => {
  const browser = await chromium.launch(browserOptions); t.after(() => browser.close());
  const page = await browser.newPage();
  const recorder = await new Recorder(page).init();
  await page.setContent('<button onclick="this.textContent=\'Clicked\'">A</button><input value="PUBLIC"><p>Other</p>');
  await recorder.arm(); await recorder.capture('Start');
  await page.locator('button').click(); await page.locator('p').click();
  assert.equal((await recorder.capture('After two clicks')).edge, false);
  await recorder.pause(); await page.locator('button').click(); await recorder.arm();
  assert.equal((await recorder.capture('After pause')).edge, false);
  assert.equal(recorder.archive.transitions.length, 0);
  recorder.options.redactSelectors = ['[[invalid'];
  await assert.rejects(recorder.capture('Must fail'));
  recorder.options.redactSelectors = [];
  recorder.options.includeFormValues = true;
  const { state } = await recorder.capture('Public value');
  assert.ok(state.html.includes('PUBLIC'));
  await recorder.dropLast(); assert.equal(recorder.current, null);
  recorder.options.maxStates = recorder.archive.states.length;
  await assert.rejects(recorder.capture('Over limit'), /State limit/);
});
