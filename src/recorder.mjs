import { randomUUID } from 'node:crypto';
import { installObserver, collectAssets, snapshot, redactText } from './snapshot.mjs';
import { exportHTML } from './export.mjs';

export function validateTarget(input) {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP(S) router URL without embedded credentials.');
  if (url.hostname === 'webfig.do' || url.hostname.endsWith('.webfig.do')) throw new Error('webfig.do is not your lab router. Use its actual private IP or QEMU loopback forward.');
  if (url.search) throw new Error('Query strings are not accepted: they may contain credentials.');
  return url;
}

export class Recorder {
  constructor(page, options = {}) {
    this.page = page;
    this.options = {
      redactSelectors: [], literals: [], includeFormValues: false, maxStates: 250,
      requiredPaths: [], routerOSVersion: '', ...options,
    };
    this.assets = collectAssets(page);
    this.archive = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      routerOSVersion: this.options.routerOSVersion,
      includeFormValues: this.options.includeFormValues,
      requiredPaths: this.options.requiredPaths,
      viewport: page.viewportSize() || { width: 1440, height: 960 },
      states: [], transitions: [],
    };
    this.armed = false; this.pending = []; this.current = null; this.busy = false;
  }

  async init() {
    await this.page.exposeBinding('__wfaClick', ({ frame }, event) => {
      if (frame !== this.page.mainFrame() || !this.armed || !this.current) return;
      // Unmatched clicks still count. Never invent a direct edge over intermediate interactions.
      this.pending.push({ ...event, duringCapture: this.busy });
    });
    await this.page.addInitScript(installObserver);
    await this.page.evaluate(installObserver);
    this.page.on('domcontentloaded', () => this.sync().catch(() => {}));
    return this;
  }

  async sync() {
    await this.page.evaluate(({ armed, current }) => {
      if (!window.__wfa) return;
      window.__wfa.armed = armed;
      window.__wfa.source = current ? { id: current.id, actions: current.actions.map(a => a.id) } : null;
    }, { armed: this.armed, current: this.current ? { id: this.current.id, actions: this.current.actions } : null });
  }

  async arm() {
    this.armed = true; this.pending = []; this.current = null; await this.sync();
  }

  async pause() {
    this.armed = false; this.pending = []; this.current = null; await this.sync();
  }

  async capture(path, note = '') {
    if (!this.armed) throw new Error('Recorder is paused. Finish private login/password entry, then arm.');
    if (this.busy) throw new Error('Capture already in progress.');
    if (!path?.trim()) throw new Error('A page path is required, for example IP / Firewall / Filter Rules.');
    if (this.archive.states.length >= this.options.maxStates) throw new Error(`State limit (${this.options.maxStates}) reached. Export this session first.`);
    this.busy = true;
    try {
      const captured = await snapshot(this.page, this.options, this.assets);
      const state = {
        id: randomUUID(), path: redactText(path.trim(), this.options.literals),
        note: redactText(note, this.options.literals), capturedAt: new Date().toISOString(), ...captured,
      };
      let edge = false;
      if (this.current && this.pending.length === 1) {
        const event = this.pending[0];
        if (!event.duringCapture && event.source === this.current.id && event.action && this.current.actions.some(a => a.id === event.action)) {
          this.archive.transitions.push({ from: this.current.id, to: state.id, ids: [event.action] }); edge = true;
        }
      }
      if (this.current && !edge) state.warnings.push('No replay edge: capture immediately after exactly one observed control click to record navigation.');
      this.archive.states.push(state); this.current = state; this.pending = [];
      await this.sync();
      return { state, edge };
    } finally { this.busy = false; }
  }

  async dropLast() {
    const removed = this.archive.states.pop();
    if (!removed) return false;
    this.archive.transitions = this.archive.transitions.filter(t => t.from !== removed.id && t.to !== removed.id);
    this.current = null; this.pending = [];
    await this.sync();
    return true;
  }

  async export(output, { strict = false } = {}) {
    const missing = this.archive.requiredPaths.filter(path => !this.archive.states.some(s => s.path === path));
    if (strict && !this.archive.requiredPaths.length) throw new Error('Strict export requires a nonempty requiredPaths manifest.');
    if (strict && missing.length) throw new Error(`Missing required paths (${missing.length}): ${missing.join(', ')}`);
    return exportHTML(this.archive, output);
  }
}
