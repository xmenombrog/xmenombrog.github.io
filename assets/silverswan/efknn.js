// Silver Swan: the Enhanced Fuzzy k-NN hydration classifier, ported from the
// iOS app's EFKNNClassifier.swift (screen(), steps 1-7 and 10). Constants,
// prototypes, fuzzy ranges, weights and messages are the app's own.
// Not ported: the camera colour fusion and the history-based trend checks,
// since this demo takes a single hand-set reading.
(function (root) {
  'use strict';

  const SG_MIN = 1.001, SG_MAX = 1.040, HUE_MIN = 0, HUE_MAX = 360, EC_MIN = 0, EC_MAX = 5000;
  const W_FUZZY_SG = 0.65, W_FUZZY_HUE = 0.35;
  const W_KNN = [0.55, 0.30, 0.15];
  const EPSILON = 1e-8;

  const LEVELS = [
    { level: 1, label: 'Overhydration', sg: 1.0020, hue: 57.5 },
    { level: 2, label: 'Well hydrated', sg: 1.0075, hue: 52.5 },
    { level: 3, label: 'Well hydrated', sg: 1.0125, hue: 47.5 },
    { level: 4, label: 'Minimal dehydration', sg: 1.0175, hue: 42.5 },
    { level: 5, label: 'Significant dehydration', sg: 1.0225, hue: 37.5 },
    { level: 6, label: 'Significant dehydration', sg: 1.0275, hue: 32.5 },
    { level: 7, label: 'Serious dehydration', sg: 1.0325, hue: 27.5 },
    { level: 8, label: 'Serious dehydration', sg: 1.0370, hue: 22.5 },
  ];

  // (left, centre, right, trapLeft, trapRight)
  const SG_RANGES = [
    [1.001, 1.0020, 1.005, true, false],
    [1.005, 1.0075, 1.010, false, false],
    [1.010, 1.0125, 1.015, false, false],
    [1.015, 1.0175, 1.020, false, false],
    [1.020, 1.0225, 1.025, false, false],
    [1.025, 1.0275, 1.030, false, false],
    [1.030, 1.0325, 1.035, false, false],
    [1.035, 1.0370, 1.040, false, true],
  ];
  const HUE_RANGES = [
    [55, 57.5, 60, false, false],
    [50, 52.5, 55, false, false],
    [45, 47.5, 50, false, false],
    [40, 42.5, 45, false, false],
    [35, 37.5, 40, false, false],
    [30, 32.5, 35, false, false],
    [25, 27.5, 30, false, false],
    [20, 22.5, 25, false, false],
  ];

  const LEAD_IN = {
    1: 'Your sensor readings indicate very diluted urine. Avoid excessive water intake.',
    2: 'Your sensor readings suggest good hydration. Maintain your current fluid intake.',
    4: 'Your sensor readings suggest you may benefit from increasing your water intake. Aim for 8–10 glasses of water today.',
    6: 'Your sensor readings indicate significantly concentrated urine. Increase fluid intake promptly.',
  };
  const leadIn = (lv) => (lv === 1 ? LEAD_IN[1] : lv <= 3 ? LEAD_IN[2] : lv <= 5 ? LEAD_IN[4] : LEAD_IN[6]);

  const STATUS = {
    NORMAL: 'Normal',
    MILD: 'Mild dehydration',
    DEHYDRATED: 'Dehydrated',
    OVERHYDRATED: 'Overhydrated',
    ATTENTION: 'Readings require attention',
  };

  const normalize = (v, lo, hi) => {
    const span = hi - lo;
    if (span <= EPSILON) return 0;
    const n = (v - lo) / span;
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
  };

  function fuzzyMembership(value, [left, center, right, trapLeft, trapRight]) {
    if (trapLeft && value <= center) return 1;
    if (trapRight && value >= center) return 1;
    if (value <= left || value >= right) return 0;
    if (Math.abs(value - center) < EPSILON) return 1;
    return value < center ? (value - left) / (center - left) : (right - value) / (right - center);
  }

  function distance(a, b) {
    let sum = 0;
    for (let i = 0; i < 3; i++) sum += W_KNN[i] * (a[i] - b[i]) ** 2;
    return Math.sqrt(Math.max(0, sum));
  }

  // UrinalysisReading.sgFromTDS
  const sgFromTDS = (tds) => 1.001 + Math.max(0, tds) * 0.000036;

  // Each prototype: [normSG, normHue, normEC], EC ≈ 2 × TDS at the level's SG centre.
  const PROTOTYPES = LEVELS.map((d) => [
    normalize(d.sg, SG_MIN, SG_MAX),
    normalize(d.hue, HUE_MIN, HUE_MAX),
    normalize(2 * ((d.sg - 1.001) / 0.000036), EC_MIN, EC_MAX),
  ]);

  /**
   * @param {{tds:number, hue:number, ph:number, ec?:number, k?:number}} r
   */
  function screen(r) {
    const k = Math.max(1, Math.min(8, r.k || 7));
    const sg = sgFromTDS(r.tds);
    const ec = r.ec != null ? r.ec : 2 * r.tds;
    const hue = r.hue;
    const ph = r.ph;

    // Step 1: normalise
    const features = [normalize(sg, SG_MIN, SG_MAX), normalize(hue, HUE_MIN, HUE_MAX), normalize(ec, EC_MIN, EC_MAX)];

    // Step 2: fuzzy memberships
    const muSG = SG_RANGES.map((rg) => fuzzyMembership(sg, rg));
    const muHue = HUE_RANGES.map((rg) => fuzzyMembership(hue, rg));
    let mu = muSG.map((m, i) => W_FUZZY_SG * m + W_FUZZY_HUE * muHue[i]);
    const muSum = mu.reduce((a, b) => a + b, 0);
    mu = muSum > EPSILON ? mu.map((m) => m / muSum) : mu.map(() => 1 / 8);

    // Steps 3-4: weighted distance, k nearest prototypes
    const neighbors = PROTOTYPES.map((p, i) => ({ index: i, distance: distance(features, p) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, k);

    // Step 5: fuzzy weighted votes, membership / distance²
    let votes = neighbors.map((n) => ({ index: n.index, weight: mu[n.index] / (n.distance * n.distance + EPSILON) }));
    const voteSum = votes.reduce((a, v) => a + v.weight, 0);
    votes = votes.map((v) => ({ index: v.index, weight: voteSum > EPSILON ? v.weight / voteSum : 1 / votes.length }));
    const winner = votes.reduce((best, v) => (v.weight > best.weight ? v : best), votes[0]);
    const level = winner.index + 1;

    // Step 6: confidence
    const triple = [muSG[winner.index], muHue[winner.index], features[2]];
    const mean = triple.reduce((a, b) => a + b, 0) / 3;
    const std = Math.sqrt(Math.max(0, triple.reduce((a, b) => a + (b - mean) ** 2, 0) / 3));
    const confidence = Math.max(60, Math.min(97, 75 + winner.weight * 20 - std * 5));

    // Step 7: flags, independent of the k-NN result
    const flagA = hue < 20 || hue > 65;
    const flagB = ph > 8.0;
    const flagC = ph < 4.5;
    const expectedHue = 60 - ((sg - 1.001) / 0.034) * 40;
    const hueMismatch = Math.abs(hue - expectedHue) > 15;
    const activeFlags = (flagA ? 1 : 0) + (flagB ? 1 : 0) + (flagC ? 1 : 0);

    // Step 10: status
    let status;
    if (activeFlags > 0) status = STATUS.ATTENTION;
    else if (level === 1) status = STATUS.OVERHYDRATED;
    else if (level <= 3) status = STATUS.NORMAL;
    else if (level <= 5) status = STATUS.MILD;
    else status = STATUS.DEHYDRATED;

    // Per-level vote share (%), level 1 first
    const levelVotes = new Array(8).fill(0);
    votes.forEach((v) => (levelVotes[v.index] += v.weight * 100));

    const messages = [];
    messages.push(activeFlags > 0 ? 'Your sensor readings show parameter values outside expected ranges.' : leadIn(level));
    if (flagA) messages.push('Your color sensor readings show a pattern outside the typical yellow range.');
    if (flagB) messages.push('pH sensor readings are elevated above the typical range.');
    if (flagC) messages.push('pH sensor readings are below the typical range.');
    if (hueMismatch) messages.push('Color sensor readings do not closely correspond to concentration readings. Results should be verified by a healthcare professional.');
    messages.push(status === STATUS.NORMAL ? 'Maintain your healthy hydration habits.' : 'Please consult a qualified healthcare professional for proper evaluation.');

    return {
      sg, ec, level, label: LEVELS[level - 1].label, confidence, status, levelVotes,
      flags: { A: flagA, B: flagB, C: flagC }, hueMismatch, messages, neighbors: neighbors.map((n) => n.index + 1),
    };
  }

  const api = { screen, sgFromTDS, LEVELS, STATUS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EFKNN = api;
})(typeof window !== 'undefined' ? window : globalThis);

// ---------- Page UI ----------
(function () {
  'use strict';
  if (typeof document === 'undefined') return;
  const $ = (id) => document.getElementById(id);
  const form = $('ss-demo');
  if (!form) return;
  const { screen, sgFromTDS, LEVELS, STATUS } = window.EFKNN;

  const tds = $('ss-tds'), hue = $('ss-hue'), ph = $('ss-ph');
  let k = 7;

  // Approximate sample colour for the swatch (display only): paler and lighter
  // toward the top of the yellow band, deeper amber toward the bottom.
  function swatch(h) {
    const t = Math.max(0, Math.min(1, (60 - h) / 40));
    const s = 0.12 + 0.68 * t;
    const v = 1 - 0.38 * t;
    const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
    let r, g, b;
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else [r, g, b] = [0, c, x];
    const to = (n) => Math.round((n + m) * 255);
    return `rgb(${to(r)}, ${to(g)}, ${to(b)})`;
  }

  const TONE = {
    [STATUS.NORMAL]: ['good', '✓'],
    [STATUS.MILD]: ['warning', '!'],
    [STATUS.OVERHYDRATED]: ['warning', '!'],
    [STATUS.DEHYDRATED]: ['serious', '!'],
    [STATUS.ATTENTION]: ['critical', '!'],
  };

  // Vote bars
  const bars = $('ss-bars');
  const barEls = LEVELS.map((d) => {
    const col = document.createElement('div');
    col.className = 'ss-bar';
    col.innerHTML = `<span class="ss-bar-val mono"></span><span class="ss-bar-track"><span class="ss-bar-fill"></span></span><span class="ss-bar-lv mono">${d.level}</span>`;
    bars.appendChild(col);
    return col;
  });

  function render() {
    const reading = { tds: +tds.value, hue: +hue.value, ph: +ph.value, k };
    const r = screen(reading);
    $('ss-tds-out').textContent = `${reading.tds} ppm`;
    $('ss-sg-out').textContent = r.sg.toFixed(4);
    $('ss-hue-out').textContent = `${(+hue.value).toFixed(1)}°`;
    $('ss-ph-out').textContent = (+ph.value).toFixed(1);
    $('ss-swatch').style.background = swatch(+hue.value);

    const [tone, icon] = TONE[r.status];
    const st = $('ss-status');
    st.dataset.tone = tone;
    st.querySelector('.status-icon').textContent = icon;
    st.querySelector('.status-text').textContent = r.status;
    $('ss-level').textContent = `Level ${r.level}`;
    $('ss-label').textContent = r.label;
    $('ss-conf').textContent = `${r.confidence.toFixed(1)}%`;
    $('ss-neighbors').textContent = r.neighbors.join(', ');

    const max = Math.max(...r.levelVotes, 1);
    r.levelVotes.forEach((v, i) => {
      const el = barEls[i];
      el.querySelector('.ss-bar-fill').style.height = `${(v / max) * 100}%`;
      el.querySelector('.ss-bar-val').textContent = v >= 0.5 ? `${Math.round(v)}%` : '';
      el.classList.toggle('is-win', i + 1 === r.level);
      el.title = `Level ${i + 1}: ${v.toFixed(1)}% of the vote`;
    });
    $('ss-bars').setAttribute('aria-label', 'Vote share by hydration level: ' +
      r.levelVotes.map((v, i) => `level ${i + 1} ${v.toFixed(0)}%`).join(', '));

    const list = $('ss-messages');
    list.innerHTML = '';
    r.messages.forEach((m) => {
      const li = document.createElement('li');
      li.textContent = m;
      list.appendChild(li);
    });
    const flags = [];
    if (r.flags.A) flags.push('Flag A · color');
    if (r.flags.B) flags.push('Flag B · high pH');
    if (r.flags.C) flags.push('Flag C · low pH');
    $('ss-flags').textContent = flags.length ? flags.join('  ·  ') : 'None';
  }

  function setPreset(btn) {
    const p = btn.dataset;
    if (p.level) {
      const d = LEVELS[+p.level - 1];
      tds.value = Math.round((d.sg - 1.001) / 0.000036 / 5) * 5;
      hue.value = d.hue;
      ph.value = 6.0;
    } else if (p.preset === 'highph') {
      ph.value = 8.6;
    } else if (p.preset === 'lowph') {
      ph.value = 4.0;
    }
    document.querySelectorAll('#ss-presets .chip').forEach((c) => c.setAttribute('aria-pressed', String(c === btn)));
    render();
  }

  document.querySelectorAll('#ss-presets .chip').forEach((c) => {
    if (c.dataset.level) c.querySelector('.dot').style.background = swatch(LEVELS[+c.dataset.level - 1].hue);
    c.addEventListener('click', () => setPreset(c));
  });
  [tds, hue, ph].forEach((el) =>
    el.addEventListener('input', () => {
      document.querySelectorAll('#ss-presets .chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
      render();
    })
  );
  document.querySelectorAll('#ss-k button').forEach((b) =>
    b.addEventListener('click', () => {
      k = +b.dataset.k;
      document.querySelectorAll('#ss-k button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      render();
    })
  );
  render();
})();
