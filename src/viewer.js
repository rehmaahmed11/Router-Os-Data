(async () => {
  'use strict';
  const $ = id => document.getElementById(id);
  try {
    const bytes = Uint8Array.from(atob($('archive').textContent.trim()), c => c.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const archive = JSON.parse(await new Response(stream).text());
    const states = new Map(archive.states.map(state => [state.id, state]));
    const history = [];
    let current;
    const say = text => { $('notice').textContent = text; };
    function nav() {
      $('states').replaceChildren();
      const query = $('search').value.toLowerCase();
      for (const [index, state] of archive.states.entries()) {
        if (!`${state.path} ${state.note}`.toLowerCase().includes(query)) continue;
        const button = document.createElement('button');
        button.textContent = `${index + 1}. ${state.path}`;
        button.setAttribute('aria-current', String(current?.id === state.id));
        button.onclick = () => show(state.id);
        $('states').append(button);
      }
    }
    function show(id, addHistory = true) {
      const state = states.get(id);
      if (!state) return;
      if (current && addHistory && current.id !== id) history.push(current.id);
      current = state;
      $('path').textContent = state.path;
      $('note').textContent = state.note;
      $('choices').replaceChildren(); $('choices').hidden = true;
      $('coverage').hidden = true;
      $('screen').srcdoc = state.html;
      $('back').disabled = !history.length;
      $('next').disabled = archive.states.at(-1).id === id;
      say(state.warnings.length ? state.warnings.join(' ') : 'Select a recorded menu, tab or control to explore.');
      nav();
    }
    function activate(target) {
      const ids = [];
      for (let el = target; el; el = el.parentElement) {
        if (el.hasAttribute?.('data-wfa-id')) ids.push(el.getAttribute('data-wfa-id'));
      }
      // Use the closest observed target. Broad ancestor matches could route an unrelated click.
      let links = [];
      for (const id of ids) {
        links = archive.transitions.filter(t => t.from === current.id && t.ids.includes(id));
        if (links.length) break;
      }
      const destinations = [...new Set(links.map(t => t.to))];
      if (destinations.length === 1) return show(destinations[0]);
      if (destinations.length > 1) {
        $('choices').replaceChildren(); $('choices').hidden = false;
        say('Multiple outcomes were recorded. Choose a captured state:');
        for (const id of destinations) {
          const button = document.createElement('button'); button.textContent = states.get(id).path;
          button.onclick = () => show(id); $('choices').append(button);
        }
        return;
      }
      say('Not recorded from this state. No live action was run. Use the page list to inspect other captured states.');
    }
    $('screen').addEventListener('load', () => {
      const doc = $('screen').contentDocument;
      if (!doc) return;
      const currentEdges = archive.transitions.filter(t => t.from === current.id);
      for (const el of doc.querySelectorAll('[data-wfa-action]')) {
        const exists = currentEdges.some(t => t.ids.includes(el.getAttribute('data-wfa-id')));
        el.title = exists ? 'Open recorded state' : 'No recorded outcome';
      }
      doc.addEventListener('click', event => {
        event.preventDefault(); event.stopImmediatePropagation(); activate(event.target);
      }, true);
      doc.addEventListener('submit', event => event.preventDefault(), true);
      doc.addEventListener('keydown', event => {
        if (['Enter', ' '].includes(event.key) && event.target.closest('[data-wfa-action]')) {
          event.preventDefault(); activate(event.target);
        }
      }, true);
    });
    $('search').oninput = nav;
    $('back').onclick = () => { if (history.length) show(history.pop(), false); };
    $('next').onclick = () => show(archive.states[archive.states.findIndex(s => s.id === current.id) + 1]?.id);
    $('coverage-toggle').onclick = () => { $('coverage').hidden = !$('coverage').hidden; if (!$('coverage').hidden) $('coverage').scrollIntoView(); };
    const missing = archive.coverage.required.filter(item => !item.captured).length;
    $('summary').textContent = `${archive.states.length} captured states · ${archive.transitions.length} recorded transitions · ${missing} required paths missing. No exhaustive-coverage claim.`;
    const metadata = document.createElement('p');
    metadata.textContent = `Captured ${archive.createdAt}. Operator-supplied RouterOS version: ${archive.routerOSVersion || 'not specified'}. Viewport: ${archive.viewport.width} × ${archive.viewport.height}. Form values ${archive.includeFormValues ? 'included (sensitive fields redacted)' : 'omitted'}.`;
    $('metadata').append(metadata);
    if (!archive.coverage.required.length) $('required').textContent = 'No required-path manifest supplied. Completeness cannot be assessed.';
    for (const item of archive.coverage.required) {
      const row = document.createElement('p'); row.textContent = `${item.captured ? 'CAPTURED' : 'MISSING'} — ${item.path}`; $('required').append(row);
    }
    function controls() {
      $('controls').replaceChildren();
      const query = $('control-search').value.toLowerCase();
      for (const control of archive.coverage.controls) {
        if (!`${control.path} ${control.label}`.toLowerCase().includes(query)) continue;
        const row = document.createElement('p');
        row.textContent = `${control.recorded ? 'RECORDED' : 'UNRECORDED'} · ${control.path} → ${control.label}`;
        $('controls').append(row);
      }
    }
    $('control-search').oninput = controls;
    controls(); $('loading').hidden = true; $('app').hidden = false; show(archive.states[0].id);
  } catch (error) {
    $('loading').textContent = 'Unable to open this archive. Use a current Chromium or Firefox browser. ' + error.message;
  }
})();
