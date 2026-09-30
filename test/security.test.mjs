import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Recorder } from '../src/recorder.mjs';

const browserOptions = { headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) };

test('hostile source content stays inert and hidden/sensitive content is omitted', async t => {
  const browser = await chromium.launch(browserOptions); t.after(() => browser.close());
  const page = await browser.newPage();
  const recorder = await new Recorder(page, { includeFormValues: true, requiredPaths: ['Security fixture'] }).init();
  await page.setContent(`<html><body style="font-family:Arial;background:rgb(230,240,250)">
    <div hidden>HIDDEN-TEXT-CANARY</div><div style="display:none">DISPLAY-NONE-CANARY</div>
    <label for="safeid">Private key</label><textarea id="safeid">LABELLED-SECRET-CANARY</textarea>
    <input name="comment" value="allowed lab comment">
    <img src="https://invalid.test/no-image" onerror="window.injected=1">
    <div style="background-image:url('https://invalid.test/track')">No external assets</div>
    <a href="javascript:window.injected=2" onclick="window.injected=3">Run code</a>
    <iframe srcdoc="<script>parent.injected=4</script>"></iframe>
    <svg onload="window.injected=5"><text>svg</text></svg>
    <form action="https://invalid.test/post"><input type="submit" value="Apply"></form>
    <button onclick="location.href='https://invalid.test'">Leave</button>
    <table><tr><th>Feature</th><th>Value</th></tr><tr><td>Test</td><td>42</td></tr></table>
  </body></html>`);
  await recorder.arm();
  const { state } = await recorder.capture('Security fixture', '</script><script>window.injected=6</script>');
  for (const canary of ['HIDDEN-TEXT-CANARY', 'DISPLAY-NONE-CANARY', 'LABELLED-SECRET-CANARY']) assert.ok(!state.html.includes(canary));
  assert.ok(state.html.includes('allowed lab comment'));
  assert.ok(state.warnings.some(w => w.includes('Embedded content omitted')));
  assert.ok(state.warnings.some(w => w.includes('Canvas, SVG')));
  assert.ok(state.warnings.some(w => w.includes('image assets')));
  const dir = await mkdtemp(join(tmpdir(), 'webfig-security-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const output = join(dir, 'security.html');
  await recorder.export(output, { strict: true });
  await page.close();
  const context = await browser.newContext({ offline: true });
  const replay = await context.newPage();
  const requests = [];
  replay.on('request', req => { if (/^https?:/.test(req.url())) requests.push(req.url()); });
  await replay.goto(pathToFileURL(output).href);
  await replay.locator('#app').waitFor({ state: 'visible' });
  const frame = replay.frameLocator('#screen');
  await frame.getByText('Run code').click();
  await frame.getByRole('button', { name: 'Apply' }).click();
  await frame.getByRole('button', { name: 'Leave' }).click();
  assert.equal(await replay.evaluate(() => window.injected), undefined);
  assert.equal(await replay.locator('#screen').evaluate(el => el.contentWindow.injected), undefined);
  assert.equal(await frame.locator('iframe,script,svg,form,[onclick],[onerror],[onload],[href]').count(), 0);
  assert.equal(await frame.locator('body').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(230, 240, 250)');
  assert.equal(await frame.locator('td').last().innerText(), '42');
  assert.deepEqual(requests, []);
  assert.match(await replay.locator('#note').innerText(), /<script>/); // displayed as text, never executed
});

test('observed navigation survives real document replacement and input buttons', async t => {
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(req.url === '/next' ? '<h1>Next document</h1><input type="button" value="Details" onclick="document.querySelector(\'h1\').textContent=\'Details\'">' : '<a href="/next">Next document</a>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await chromium.launch(browserOptions); t.after(() => browser.close());
  const page = await browser.newPage();
  const recorder = await new Recorder(page).init();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await recorder.arm(); await recorder.capture('First');
  await Promise.all([page.waitForURL('**/next'), page.getByRole('link').click()]);
  assert.equal((await recorder.capture('Next document')).edge, true);
  await page.getByRole('button', { name: 'Details' }).click();
  assert.equal((await recorder.capture('Details')).edge, true);
  assert.equal(recorder.archive.transitions.length, 2);
});
