// ServerV2 in the browser: a simulation of index.js + routes/search.js.
// The middleware order, status codes, response bodies, rate-limit headers
// (express-rate-limit v7 defaults: 100 per 60 s window, legacy X-RateLimit-*)
// and console messages follow the real server. The database is a small set of
// made-up sample documents in the project's schema, and no AI model is called.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  if (!$('sv-demo')) return;

  const LIMIT = 100;
  const WINDOW_MS = 60 * 1000;

  const oid = (n) => `6650a1f2c4e1b2a3d4e5${n.toString(16).padStart(4, '0')}`;
  let seq = 1;
  const answer = (text, qid, type, correct) => ({
    Answer_Text: text, Answer_ID: `A-${qid}-${seq}`, Question_ID: qid, Question_Type: type, Correct: correct, _id: oid(seq++),
  });
  const DB = [
    {
      _id: oid(100), Title: 'Sample set · Data structures',
      Question: 'Which data structure processes items in first-in, first-out order?',
      Answer: [answer('Queue', '1001', 'multiple_choice', true)], __v: 0,
    },
    {
      _id: oid(101), Title: 'Sample set · Web',
      Question: 'What does the HTTP status code 404 mean?',
      Answer: [answer('Not Found', '1002', 'multiple_choice', true)], __v: 0,
    },
    {
      _id: oid(102), Title: 'Sample set · JavaScript',
      Question: 'Which keywords declare block-scoped variables in JavaScript?',
      Answer: [answer('let', '1003', 'multiple_answer', true), answer('const', '1003', 'multiple_answer', true)], __v: 0,
    },
  ];

  let windowStart = null;
  let hits = 0;
  let busy = false;

  // ---------- Console ----------
  const consoleEl = $('sv-console');
  function log(...parts) {
    const line = document.createElement('div');
    line.innerHTML = parts.map(fmtLogPart).join(' ');
    consoleEl.appendChild(line);
    while (consoleEl.childNodes.length > 200) consoleEl.removeChild(consoleEl.firstChild);
    consoleEl.scrollTop = consoleEl.scrollHeight;
  }
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  function fmtLogPart(p) {
    if (typeof p === 'string') return esc(p);
    if (p && p.__raw) return p.__raw;
    return highlight(JSON.stringify(p, null, 2).replace(/"([^"]+)":/g, "'$1':").replace(/"/g, "'"), true);
  }
  const raw = (html) => ({ __raw: html });

  // ---------- JSON highlighting ----------
  function highlight(json, loose) {
    return esc(json).replace(
      loose
        ? /('(?:[^'\\]|\\.)*'(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?)/g
        : /("(?:[^"\\]|\\.)*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?)/g,
      (m, str, colon) => {
        if (str && colon) return `<span class="t-key">${m}</span>`;
        if (str) return `<span class="t-str">${m}</span>`;
        if (/true|false|null/.test(m)) return `<span class="t-num">${m}</span>`;
        return `<span class="t-num">${m}</span>`;
      }
    );
  }

  // ---------- The server ----------
  function rateLimit(now) {
    if (windowStart === null || now - windowStart >= WINDOW_MS) {
      windowStart = now;
      hits = 0;
    }
    hits += 1;
    const remaining = Math.max(0, LIMIT - hits);
    const headers = {
      'X-RateLimit-Limit': String(LIMIT),
      'X-RateLimit-Remaining': String(remaining),
      'X-RateLimit-Reset': String(Math.ceil((windowStart + WINDOW_MS) / 1000)),
    };
    return { blocked: hits > LIMIT, headers };
  }

  function prompt(question, answerChoice) {
    let p = `You will answer the question only in the given choices of answers. If you think there is no correct answer, you will guess the best answer from the given choices. If asked to choose more than one answer, separate them by a newline\nQuestion: ${question}`;
    if (answerChoice) p += `\nAnswer Choices: ${answerChoice}`;
    return p;
  }

  // routes/search.js, GET /
  function search(query, provider, quiet) {
    const say = quiet ? () => {} : log;
    const { questionText, questionId, answerChoice } = query;
    if (!questionText && !questionId) {
      say('Search request missing parameters');
      return { status: 400, body: { error: 'Provide questionText or questionId' } };
    }
    let result = null;
    let searchMethod = null;
    if (questionId) {
      say('Searching by questionId:', { 'Answer.Question_ID': questionId });
      result = DB.find((d) => d.Answer.some((a) => a.Question_ID === questionId)) || null;
      if (result) searchMethod = 'questionId';
    }
    if (!result && questionText) {
      say('Searching by questionText:', { Question: questionText });
      result = DB.find((d) => d.Question === questionText) || null;
      if (result) searchMethod = 'questionText';
    }
    if (!result) {
      say('No result found for provided parameters.');
      if (provider === 'none') {
        say('AI provider is set to none. Returning no results.');
        return { status: 200, body: [] };
      }
      if (provider === 'ollama') {
        say('Calling Ollama for questionText:', questionText || 'undefined', 'and answerChoice:', answerChoice || 'undefined');
        say(raw('<span class="t-muted">connect ECONNREFUSED 127.0.0.1:11434</span>'));
        say('Ollama is not running or not installed. Returning no results.');
        return { status: 200, body: [] };
      }
      say('Calling Gemini for questionText:', questionText || 'undefined', 'and answerChoice:', answerChoice || 'undefined');
      say('Calling Gemini with prompt:', prompt(questionText, answerChoice));
      say(raw('<span class="t-muted">[simulation] No model is called here; the reply below is a placeholder in the real response shape.</span>'));
      return {
        status: 200,
        body: [{
          answer_text: null, answer_id: null, question_id: questionId || null, question_text: questionText || null,
          question_type: null, searchMethod: 'ai', correct: null,
          aiAnswer: { answers: ["(Gemini's reply, split into one answer per line)"] },
        }],
      };
    }
    for (const a of result.Answer) {
      say('Search result:', a.Answer_Text);
      say('Question ID:', a.Question_ID);
    }
    return { status: 200, body: { ...result, searchMethod: searchMethod || 'unknown' } };
  }

  // index.js: cors() -> rateLimit() -> /search
  function handle(query, provider, quiet) {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json; charset=utf-8' };
    const rl = rateLimit(Date.now());
    Object.assign(headers, rl.headers);
    if (rl.blocked) {
      headers['Content-Type'] = 'text/html; charset=utf-8';
      return { status: 429, headers, body: 'Too many requests, please try again later.' };
    }
    const res = search(query, provider, quiet);
    return { status: res.status, headers, body: res.body };
  }

  // ---------- UI ----------
  const REASON = { 200: 'OK', 400: 'Bad Request', 429: 'Too Many Requests' };
  const inputs = { questionId: $('sv-qid'), questionText: $('sv-qtext'), answerChoice: $('sv-choices') };
  const providerEl = $('sv-provider');

  function currentQuery() {
    const q = {};
    for (const [k, inp] of Object.entries(inputs)) if (inp.value.trim()) q[k] = inp.value.trim();
    return q;
  }
  function urlFor(q) {
    const qs = new URLSearchParams(q).toString();
    return `/search${qs ? '?' + qs : ''}`;
  }
  function updateUrl() {
    $('sv-url').textContent = `GET ${urlFor(currentQuery())}`;
  }

  function showResponse(res, ms) {
    const ok = res.status < 400;
    $('sv-status').innerHTML = `<span class="${ok ? 't-ok' : 't-err'}">HTTP/1.1 ${res.status} ${REASON[res.status]}</span>  <span class="t-muted">${ms} ms</span>`;
    $('sv-headers').innerHTML = Object.entries(res.headers).map(([k, v]) => `<span class="t-key">${esc(k)}</span>: ${esc(v)}`).join('\n');
    $('sv-body').innerHTML = typeof res.body === 'string' ? esc(res.body) : highlight(JSON.stringify(res.body, null, 2));
    updateMeter();
  }

  function updateMeter() {
    const fresh = windowStart === null || Date.now() - windowStart >= WINDOW_MS;
    const used = fresh ? 0 : Math.min(hits, LIMIT);
    $('sv-meter-fill').style.width = `${(used / LIMIT) * 100}%`;
    $('sv-meter-text').textContent = fresh ? `${LIMIT} of ${LIMIT} requests left this minute` : `${Math.max(0, LIMIT - hits)} of ${LIMIT} requests left · window resets in ${Math.ceil((windowStart + WINDOW_MS - Date.now()) / 1000)} s`;
  }
  setInterval(updateMeter, 1000);

  const delay = () => new Promise((r) => setTimeout(r, 40 + Math.random() * 90));

  async function send() {
    if (busy) return;
    busy = true;
    const q = currentQuery();
    log(raw(`<span class="t-muted">→ GET ${esc(urlFor(q))}</span>`));
    const t0 = performance.now();
    await delay();
    const res = handle(q, providerEl.value, false);
    if (res.status === 429) log(raw('<span class="t-err">429 Too many requests (rate limit reached)</span>'));
    showResponse(res, Math.round(performance.now() - t0));
    busy = false;
  }

  async function burst() {
    if (busy) return;
    busy = true;
    const btn = $('sv-burst');
    btn.disabled = true;
    const q = currentQuery();
    const n = 110;
    log(raw(`<span class="t-muted">→ ${n} × GET ${esc(urlFor(q))} (logs for these are hidden)</span>`));
    let first429 = null, last;
    for (let i = 0; i < n; i++) {
      last = handle(q, providerEl.value, true);
      if (last.status === 429 && first429 === null) first429 = { n: i + 1, total: hits };
      if (i % 10 === 9) {
        btn.textContent = `Sending… ${i + 1}/${n}`;
        updateMeter();
        await new Promise((r) => setTimeout(r, 16));
      }
    }
    log(raw(first429
      ? `<span class="t-err">Request ${first429.n} of this burst (the ${first429.total}th this minute) and every one after it got 429 Too Many Requests.</span>`
      : `<span class="t-ok">All ${n} requests were answered.</span>`));
    showResponse(last, 0);
    btn.textContent = `Send ${n} requests`;
    btn.disabled = false;
    busy = false;
  }

  $('sv-send').addEventListener('click', send);
  $('sv-burst').addEventListener('click', burst);
  $('sv-reset').addEventListener('click', () => {
    windowStart = null;
    hits = 0;
    updateMeter();
    log(raw('<span class="t-muted">[simulation] Rate-limit window cleared.</span>'));
  });
  Object.values(inputs).forEach((inp) => {
    inp.addEventListener('input', updateUrl);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  });

  // Sample database list
  const list = $('sv-db');
  DB.forEach((doc) => {
    const li = document.createElement('li');
    const qid = doc.Answer[0].Question_ID;
    li.innerHTML = `<span class="mono sv-db-id">${qid}</span><span class="sv-db-q">${esc(doc.Question)}</span>`;
    const actions = document.createElement('span');
    actions.className = 'sv-db-actions';
    const byId = document.createElement('button');
    byId.type = 'button';
    byId.className = 'chip';
    byId.textContent = 'Use ID';
    byId.addEventListener('click', () => { inputs.questionId.value = qid; inputs.questionText.value = ''; updateUrl(); send(); });
    const byText = document.createElement('button');
    byText.type = 'button';
    byText.className = 'chip';
    byText.textContent = 'Use text';
    byText.addEventListener('click', () => { inputs.questionId.value = ''; inputs.questionText.value = doc.Question; updateUrl(); send(); });
    actions.append(byId, byText);
    li.appendChild(actions);
    list.appendChild(li);
  });

  // Startup lines, like `npm start`
  log(raw('<span class="t-muted">$ node index.js</span>'));
  log("Today's Bible Verse:");
  log(raw('<span class="t-muted">(fetched from beta.ourmanna.com at startup)</span>'));
  log('Server running on port 3000');
  updateUrl();
  updateMeter();
  send(); // one example request so both panels start filled in
})();
