// Interactive demo for the Sports Team Balancing page.
// Clusters come from the project's fitted K-Means model (assets/teams/data.js);
// drafting and placement run live in assets/teams/balancer.js.
(function () {
  'use strict';
  const D = window.TEAM_DATA;
  const B = window.TeamBalancer;
  const $ = (id) => document.getElementById(id);
  if (!D || !B || !$('tb-demo')) return;

  const SVG = 'http://www.w3.org/2000/svg';
  const FEATURE_NAMES = ['Shooting', 'Passing', 'Defense', 'Rebounding', 'Fitness', 'Availability'];
  const state = { k: 4, teams: 4, refine: true };
  const baselineCache = {};

  const perimeter = (f) => (f[0] + f[1]) / 2;
  const interior = (f) => (f[2] + f[3]) / 2;
  // Small fixed jitter so players with identical scores don't hide each other.
  const jitter = (i, salt) => ((Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453) % 1) * 0.22;

  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(SVG, tag);
    for (const [a, v] of Object.entries(attrs)) n.setAttribute(a, v);
    if (parent) parent.appendChild(n);
    return n;
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- Facets: one panel per group ----------
  const facets = $('tb-facets');
  const tip = $('tb-tip');
  let newPlayer = null; // { f, cluster }

  function showTip(evt, html) {
    tip.innerHTML = html;
    tip.hidden = false;
    const box = facets.getBoundingClientRect();
    let x = evt.clientX - box.left + 14;
    let y = evt.clientY - box.top + 14;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    if (x + w > box.width) x = evt.clientX - box.left - w - 14;
    if (y + h > box.height) y = evt.clientY - box.top - h - 14;
    tip.style.left = `${Math.max(0, x)}px`;
    tip.style.top = `${Math.max(0, y)}px`;
  }
  const hideTip = () => (tip.hidden = true);

  function drawFacets() {
    const model = D.k[state.k];
    facets.querySelectorAll('.tb-panel').forEach((n) => n.remove());
    const W = 260, H = 210, L = 34, R = 10, T = 10, Bm = 34;
    const sx = (v) => L + ((v - 1) / 9) * (W - L - R);
    const sy = (v) => T + (1 - (v - 1) / 9) * (H - T - Bm);

    for (let c = 0; c < state.k; c++) {
      const members = D.players.filter((_, i) => model.labels[i] === c);
      const avgSkill = members.reduce((a, p) => a + B.overallSkill(p.f), 0) / members.length;
      const avgAvail = members.reduce((a, p) => a + p.f[5], 0) / members.length;

      const panel = document.createElement('figure');
      panel.className = 'tb-panel';
      panel.innerHTML = `<figcaption><span class="tb-panel-id mono">C${c + 1}</span><span class="tb-panel-name">${esc(model.names[c])}</span>
        <span class="tb-panel-meta">${members.length} players · avg skill ${avgSkill.toFixed(1)} · ${Math.round(avgAvail)}% available</span></figcaption>`;
      const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Group C${c + 1}, ${model.names[c]}: ${members.length} players plotted by perimeter skill and interior skill` });
      panel.appendChild(svg);

      // grid + axes
      for (const v of [2, 4, 6, 8, 10]) {
        el('line', { x1: sx(v), x2: sx(v), y1: T, y2: H - Bm, class: 'tb-grid' }, svg);
        el('line', { x1: L, x2: W - R, y1: sy(v), y2: sy(v), class: 'tb-grid' }, svg);
        el('text', { x: sx(v), y: H - Bm + 14, class: 'tb-tick', 'text-anchor': 'middle' }, svg).textContent = v;
        el('text', { x: L - 8, y: sy(v) + 4, class: 'tb-tick', 'text-anchor': 'end' }, svg).textContent = v;
      }
      el('text', { x: (L + W - R) / 2, y: H - 4, class: 'tb-axis', 'text-anchor': 'middle' }, svg).textContent = 'Perimeter skill →';
      el('text', { x: 10, y: (T + H - Bm) / 2, class: 'tb-axis', 'text-anchor': 'middle', transform: `rotate(-90 10 ${(T + H - Bm) / 2})` }, svg).textContent = 'Interior skill →';

      // context: everyone else
      D.players.forEach((p, i) => {
        if (model.labels[i] === c) return;
        el('circle', { cx: sx(perimeter(p.f) + jitter(i, 1)), cy: sy(interior(p.f) + jitter(i, 2)), r: 2.6, class: 'tb-ctx' }, svg);
      });
      // this group, with a hover target larger than the mark
      D.players.forEach((p, i) => {
        if (model.labels[i] !== c) return;
        const cx = sx(perimeter(p.f) + jitter(i, 1)), cy = sy(interior(p.f) + jitter(i, 2));
        const dot = el('circle', { cx, cy, r: 4.2, class: 'tb-dot' }, svg);
        const hit = el('circle', { cx, cy, r: 10, class: 'tb-hit' }, svg);
        const html = `<b>${esc(p.name)}</b> · ${esc(p.pos)}<br>Shoot ${p.f[0]} · Pass ${p.f[1]} · Def ${p.f[2]} · Reb ${p.f[3]}<br>Fitness ${p.f[4]} · ${p.f[5]}% available${p.imp ? '<br><i>Had a missing value (imputed)</i>' : ''}`;
        hit.addEventListener('pointerenter', (e) => { dot.classList.add('is-hover'); showTip(e, html); });
        hit.addEventListener('pointermove', (e) => showTip(e, html));
        hit.addEventListener('pointerleave', () => { dot.classList.remove('is-hover'); hideTip(); });
      });
      // the player being placed
      if (newPlayer && newPlayer.cluster === c) {
        const x = sx(perimeter(newPlayer.f)), y = sy(interior(newPlayer.f));
        el('path', { d: `M${x} ${y - 8}L${x + 8} ${y}L${x} ${y + 8}L${x - 8} ${y}Z`, class: 'tb-new' }, svg);
      }
      facets.appendChild(panel);
    }
  }

  // ---------- Teams ----------
  let summary = [];
  function drawTeams() {
    const model = D.k[state.k];
    const rows = B.buildTeams(D.players, model.labels, state.teams, state.refine);
    summary = B.teamSummary(rows, state.teams, state.k);
    const gap = B.skillGap(summary);
    if (!(state.teams in baselineCache)) baselineCache[state.teams] = B.randomBaseline(D.players, state.teams);
    const random = baselineCache[state.teams];

    $('tb-sil').textContent = model.silhouette.toFixed(3);
    $('tb-sil-h').textContent = `Hierarchical clustering: ${model.hierSilhouette.toFixed(3)}`;
    $('tb-gap').textContent = gap.toFixed(2);
    $('tb-gap-s').textContent = state.refine ? 'After the draft and swaps' : 'Draft only, no swaps';
    $('tb-rand').textContent = random.toFixed(2);
    $('tb-better').textContent = gap > 0 ? `${Math.round(random / gap)}×` : '—';

    const head = $('tb-thead');
    head.innerHTML = `<tr><th>Team</th><th>Players</th><th>Avg skill</th><th>Fitness</th><th>Available</th><th>G / F / C</th>${model.names.map((_, c) => `<th title="${esc(model.names[c])}">C${c + 1}</th>`).join('')}</tr>`;
    const body = $('tb-tbody');
    body.innerHTML = summary
      .map((t) => `<tr><td>Team ${t.team + 1}</td><td>${t.players}</td><td>${t.skill.toFixed(2)}</td><td>${t.fitness.toFixed(2)}</td><td>${t.availability.toFixed(1)}%</td><td>${t.positions.join(' / ')}</td>${t.clusters.map((n) => `<td>${n}</td>`).join('')}</tr>`)
      .join('');
    $('tb-legend').textContent = model.names.map((n, c) => `C${c + 1} ${n}`).join(' · ');
  }

  // ---------- Place a new player ----------
  const pInputs = [0, 1, 2, 3, 4, 5].map((j) => $(`tb-p-${j}`));
  function placePlayer() {
    const f = pInputs.map((inp) => +inp.value);
    pInputs.forEach((inp, j) => ($(`tb-p-${j}-out`).textContent = j === 5 ? `${inp.value}%` : inp.value));
    const pos = $('tb-p-pos').value;
    const r = B.placePlayer(f, D, state.k);
    const model = D.k[state.k];
    const team = B.suggestTeam(summary, r.cluster, pos);
    newPlayer = { f, cluster: r.cluster };
    $('tb-p-group').textContent = `C${r.cluster + 1} ${model.names[r.cluster]}`;
    $('tb-p-margin').textContent = `Margin ${r.margin.toFixed(2)}${r.uncertain ? ` — uncertain, close to C${r.runnerUp + 1} ${model.names[r.runnerUp]}` : ' — a clear fit'}`;
    $('tb-p-team').textContent = `Team ${team + 1}`;
    $('tb-p-team-s').textContent = `It has the fewest C${r.cluster + 1} players, then the fewest ${pos.toLowerCase()}s.`;
  }

  // ---------- Roster table (table view of the chart) ----------
  function drawRoster() {
    const model = D.k[state.k];
    $('tb-roster').innerHTML = D.players
      .map((p, i) => ({ p, c: model.labels[i] }))
      .sort((a, b) => a.c - b.c || B.overallSkill(b.p.f) - B.overallSkill(a.p.f))
      .map(({ p, c }) => `<tr><td>${esc(p.name)}</td><td>${esc(p.pos)}</td><td>C${c + 1}</td>${p.f.map((v, j) => `<td>${j === 5 ? v + '%' : v}</td>`).join('')}</tr>`)
      .join('');
  }

  function update() {
    drawTeams();
    placePlayer();
    drawFacets();
    drawRoster();
  }

  // ---------- Controls ----------
  document.querySelectorAll('#tb-k button').forEach((b) =>
    b.addEventListener('click', () => {
      state.k = +b.dataset.k;
      document.querySelectorAll('#tb-k button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      update();
    })
  );
  const teamsInput = $('tb-teams');
  teamsInput.max = B.maxTeams(D.players.length);
  teamsInput.addEventListener('input', () => {
    state.teams = +teamsInput.value;
    $('tb-teams-out').textContent = `${state.teams} teams of ${Math.floor(60 / state.teams)}${60 % state.teams ? '–' + Math.ceil(60 / state.teams) : ''}`;
    drawTeams();
    placePlayer();
    drawFacets();
  });
  $('tb-refine').addEventListener('change', (e) => {
    state.refine = e.target.checked;
    drawTeams();
    placePlayer();
  });
  pInputs.concat($('tb-p-pos')).forEach((inp) =>
    inp.addEventListener('input', () => {
      placePlayer();
      drawFacets();
    })
  );
  facets.addEventListener('pointerleave', hideTip);

  $('tb-features').textContent = FEATURE_NAMES.join(', ');
  update();
})();
