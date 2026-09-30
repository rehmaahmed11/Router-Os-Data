#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, access } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { chromium } from 'playwright';
import { Recorder, validateTarget } from '../src/recorder.mjs';
import { coverage } from '../src/export.mjs';

const HELP = `WebFig Archive — record the real interface, not a simulation

  node bin/webfig-archive.mjs --url http://127.0.0.1:8080/webfig/ --output captures/router.html

Options:
  --url URL                  Actual authorized lab router (required)
  --output FILE              Single offline HTML (default captures/webfig.html)
  --config FILE              JSON privacy selectors, requiredPaths, routerOSVersion
  --redact-file FILE         Private UTF-8 file, one literal secret per line (never commit)
  --include-form-values      Include non-secret displayed form values; default omit
  --executable-path FILE     Use an already-installed Chromium
  --strict                   Export only if every manifest path was captured
  --overwrite                Allow replacing an existing output
  --help                     Show this help

The browser opens visibly on your workstation. Log in/change password privately
while recording is paused. The tool does not ask for or store credentials.
Do not use an Internet-exposed production router. No automatic menu clicking.

Recorder commands:
  arm                        Start/resume; no capture until 'capture'
  pause                      Stop observing clicks; use before any private entry
  capture PATH | NOTE        Capture current real DOM, e.g. IP / Addresses | Explain addresses
  status                     Captured states and missing required paths
  drop                       Remove last captured state and its edges
  export                     Write/rewrite your single offline HTML
  quit                       Close browser (export first)

To record an edge: capture a page, click ONE menu/tab/dialog control in WebFig,
wait until it settles, then capture again. Repeat at each depth, including back,
tabs, rows, popups and pagination. Uncaptured actions are explicitly unavailable.
`;

async function main() {
  const { values } = parseArgs({ options: {
    url: { type: 'string' }, output: { type: 'string', default: 'captures/webfig.html' },
    config: { type: 'string' }, 'redact-file': { type: 'string' },
    'include-form-values': { type: 'boolean' }, 'executable-path': { type: 'string' },
    strict: { type: 'boolean' }, overwrite: { type: 'boolean' }, help: { type: 'boolean' },
  }, strict: true });
  if (values.help) { console.log(HELP); return; }
  if (!values.url) throw new Error('Missing --url. Run with --help.');
  if (!process.stdin.isTTY) throw new Error('Use an interactive terminal on a workstation with a graphical display.');
  const target = validateTarget(values.url);
  if (!values.overwrite) {
    let exists = false;
    try { await access(values.output); exists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (exists) throw new Error('Output already exists. Use another name or --overwrite.');
  }
  let config = values.config ? JSON.parse(await readFile(values.config, 'utf8')) : {};
  const allowed = new Set(['redactSelectors', 'requiredPaths', 'routerOSVersion', 'maxStates']);
  for (const key of Object.keys(config)) if (!allowed.has(key)) throw new Error(`Unknown config key: ${key}`);
  for (const key of ['redactSelectors', 'requiredPaths']) {
    if (config[key] !== undefined && (!Array.isArray(config[key]) || config[key].some(v => typeof v !== 'string' || !v.trim()))) throw new Error(`${key} must be an array of nonempty strings.`);
  }
  if (config.routerOSVersion !== undefined && typeof config.routerOSVersion !== 'string') throw new Error('routerOSVersion must be a string.');
  if (config.maxStates !== undefined && (!Number.isInteger(config.maxStates) || config.maxStates < 1 || config.maxStates > 1000)) throw new Error('maxStates must be between 1 and 1000.');
  const literals = values['redact-file'] ? (await readFile(values['redact-file'], 'utf8')).split(/\r?\n/).filter(Boolean) : [];
  const browser = await chromium.launch({ headless: false, executablePath: values['executable-path'] });
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, serviceWorkers: 'block', acceptDownloads: false });
    // Isolate the authorized router. Never contact third-party scripts, assets or redirects.
    await context.route('**/*', route => {
      let origin;
      try { origin = new URL(route.request().url()).origin; } catch { return route.abort(); }
      return origin === target.origin ? route.continue() : route.abort();
    });
    await context.routeWebSocket('**/*', ws => {
      const url = new URL(ws.url()); url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
      if (url.origin === target.origin) ws.connectToServer(); else ws.close();
    });
    const page = await context.newPage();
    context.on('page', other => { if (other !== page) other.close().catch(() => {}); });
    const recorder = await new Recorder(page, { ...config, literals, includeFormValues: !!values['include-form-values'] }).init();
    await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log('PAUSED. Log in and change the password privately in the browser. Run arm when ready.');
    console.log('Use only a disposable lab router. Actions you click in this browser ARE LIVE. Type help for commands.');
    for (;;) {
      const line = (await rl.question('webfig-archive> ')).trim();
      const [command, ...rest] = line.split(/\s+/);
      try {
        if (command === 'quit') break;
        if (command === 'help') console.log(HELP);
        else if (command === 'arm') { await recorder.arm(); console.log('ARMED. Capture an initial page before clicking.'); }
        else if (command === 'pause') { await recorder.pause(); console.log('PAUSED. No clicks or pages are being saved.'); }
        else if (command === 'capture') {
          const [path, ...note] = rest.join(' ').split('|');
          const result = await recorder.capture(path, note.join('|').trim());
          console.log(`Captured state ${recorder.archive.states.length}. ${result.edge ? 'Replay edge recorded.' : 'No replay edge.'}`);
          for (const warning of result.state.warnings) console.log(`Warning: ${warning}`);
        } else if (command === 'drop') console.log(await recorder.dropLast() ? 'Last state removed. Capture the current page to continue.' : 'No state to remove.');
        else if (command === 'status') {
          const report = coverage(recorder.archive);
          console.log(`${recorder.armed ? 'ARMED' : 'PAUSED'} · ${recorder.archive.states.length} states · ${recorder.archive.transitions.length} edges`);
          console.log(`Observed controls without an outcome: ${report.controls.filter(c => !c.recorded).length}`);
          for (const row of report.required) console.log(`${row.captured ? 'CAPTURED' : 'MISSING'}: ${row.path}`);
        } else if (command === 'export') {
          const result = await recorder.export(values.output, { strict: values.strict });
          console.log(`Wrote ${result.path} (${result.bytes} bytes). Open locally and review before sharing.`);
        } else if (command) console.log('Unknown command. Type help.');
      } catch (error) { console.error(`Not completed: ${error.message}`); }
    }
  } finally { rl.close(); await browser.close(); }
}

main().catch(error => { console.error(`WebFig Archive: ${error.message}`); process.exitCode = 1; });
