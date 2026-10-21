/* The live poll takeover, one script for every audience page (/app, /watch, /maisie, /start).
   When Aran opens a poll (state.liveQ is set), the whole phone shows the question on a white screen with a thin orange
   bar on top and big white answer cards with an orange outline, whatever page the person is on. The tap is the vote (no Send button): the option is selected at once, and
   "Counted" with a check follows as soon as the server has it. The screen then shows "Your answer" with Change and the
   room's live bars (Flux's rule: results after the vote). When the poll closes (Aran closes it, or moves off its
   slide) the phone goes straight back to the page underneath; the final bars stay in the Polls list.

   API: window.LivePoll = { feed(state), tallies(map), ... }. A host page that already holds a socket (app.html,
   shell.js) calls config({fed:true}) at once, then feed() with every state frame and tallies() with every poll frame,
   and refresh() after a reconnect or a return to the screen. If nothing feeds it within 2 seconds, this script opens
   its own /api/ws socket; if that is not open within 3 seconds it asks GET /api/state every 2 seconds until it is.

   Votes: every tap is written to this phone (localStorage, with a client id per vote) before it is sent, and anything
   unsent goes again on reconnect. The server keeps one answer per person per poll, so a resend replaces and never
   double counts. Re-tapping the same answer does nothing, a tap while a send is in flight is ignored, the second tap
   of a double tap is swallowed. A vote is never dropped silently: if Aran closed the poll first, the phone says so.

   Design principles applied: options are role=radio inside a radiogroup named by the question, full width, 56 px
   tall, 8 px apart, 20 px text, in the vertical middle of the screen; nothing tappable in the top corners while a poll
   is open; status in plain words in a bottom bar; a screen wake lock is asked for inside the first tap.

   Colours are the v4 light tokens from /ui.css, copied as literals and scoped to #lp so they never touch the host
   page: page #f3f5f9, cards #fff, navy ink #0f1a2e, orange #c44a06 for outlines, the selected answer and the buttons
   (white on it 4.85 to 1), #a93f05 for orange text, green #1a6e36 only for "Counted". No full orange fill. */
(function () {
  "use strict";
  if (window.LivePoll) return;
  const D = document;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* private mode or blocked */ } };
  const jget = (k, d) => { try { const v = JSON.parse(lsGet(k) || "null"); return v && typeof v === "object" && !Array.isArray(v) ? v : d; } catch (_) { return d; } };
  const uuid = () => { try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (_) { /* old browser */ } return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); };
  const K_OUT = "pl:pout", K_MINE = "pl:pmine";
  // a "rows" poll (readiness) is two rows of the same choices sent in one submit; its answer is {today: i, month: i}
  const isRows = (q) => !!(q && q.type === "rows" && Array.isArray(q.rows) && q.rows.length);
  const okA = (a) => Number.isInteger(a) || (!!a && typeof a === "object" && !Array.isArray(a) && Object.keys(a).length > 0 && Object.keys(a).every((k) => Number.isInteger(a[k])));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const validA = (q, a) => isRows(q) ? !!a && typeof a === "object" && q.rows.every((r) => Number.isInteger(a[r.key]) && a[r.key] >= 0 && a[r.key] < q.options.length)
    : Number.isInteger(a) && a >= 0 && a < q.options.length;

  // ---------- state
  const cfg = { host: "", fed: false, audience: null, onChange: null, questions: false, back: "" };
  const Q = {};                 // id -> {id, text, options, slide, n}
  let liveQ = null, closed = [], viewers = 0, qv = null, fedAt = 0;
  let mine = jget(K_MINE, {});  // id -> option index, as this phone knows it (optimistic)
  let conf = {};                // id -> option index the server has confirmed
  let out = jget(K_OUT, {});    // id -> {a, id: client vote id, t} waiting to be sent
  Object.keys(out).forEach((k) => { const o = out[k]; if (typeof o === "number") out[k] = { a: o, id: uuid(), t: Date.now() }; if (out[k] && okA(out[k].a)) mine[k] = out[k].a; else delete out[k]; });
  Object.keys(mine).forEach((k) => { if (!okA(mine[k])) delete mine[k]; });
  const tallies = {};           // id -> {q,total,counts,options,closed}
  let inflight = null, netDown = false, closingQ = null, closeTimer = 0, retryAt = 0;
  const hidden = {}, changing = {}, late = {}, seen = {}, tapAt = {}, draft = {};
  let opened = null;            // an open poll that is not live, shown because the person asked (LivePoll.open)
  let lockUntil = 0, lastSig = "";

  const save = () => { lsSet(K_OUT, JSON.stringify(out)); lsSet(K_MINE, JSON.stringify(mine)); };
  const isClosed = (id) => closed.indexOf(id) >= 0;
  const emit = () => {
    try { if (typeof cfg.onChange === "function") cfg.onChange(); } catch (_) { /* host error stays in the host */ }
    try { D.dispatchEvent(new CustomEvent("livepoll")); } catch (_) { /* old browser */ }
  };

  // ---------- styles, scoped to #lp and #lp-back so the host page is never touched
  const CSS = `
#lp,#lp-back{--lp-btn:#c44a06;--lp-btn-2:#a93f05;--lp-ink:#0f1a2e;--lp-navy:#15233b;--lp-bg:#f3f5f9;--lp-panel:#fff;--lp-line:#d3dae8;--lp-line2:#c3ccdc;
  --lp-edge:#7d8aa3;--lp-press:#e4eaf4;--lp-soft:#34415a;--lp-steel:#4b5872;--lp-ok:#1a6e36;--lp-white:#fff;
  --lp-serif:'Fraunces',Georgia,'Times New Roman',serif;--lp-sans:'Public Sans',system-ui,-apple-system,'Segoe UI',sans-serif}
#lp{position:fixed;inset:0;z-index:2147482000;display:none;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;
  background:var(--lp-bg);color:var(--lp-ink);font:400 17px/1.45 var(--lp-sans);-webkit-font-smoothing:antialiased;text-align:left;letter-spacing:normal;text-transform:none}
#lp.on{display:block}
#lp::before{content:"";position:fixed;left:0;right:0;top:0;height:6px;background:var(--lp-btn);z-index:3}   /* the thin orange bar: a poll is open */
#lp.closed::before{background:var(--lp-steel)}
#lp *{box-sizing:border-box;margin:0;padding:0;font-family:inherit;letter-spacing:normal;text-transform:none}
#lp button{-webkit-tap-highlight-color:transparent;touch-action:manipulation;cursor:pointer;border:0;font-family:inherit;color:inherit;background:none;text-align:left}
#lp button:focus-visible,#lp-back:focus-visible{outline:3px solid var(--lp-ink);outline-offset:3px}
#lp .lp-in{max-width:560px;margin:0 auto;min-height:100%;display:flex;flex-direction:column;
  padding:calc(16px + env(safe-area-inset-top)) max(12px,env(safe-area-inset-right)) calc(84px + env(safe-area-inset-bottom)) max(12px,env(safe-area-inset-left))}
#lp .lp-pill{flex:none;min-height:62px;border-radius:31px;display:flex;align-items:center;gap:12px;padding:8px 20px;
  background:var(--lp-panel);color:var(--lp-ink);border:1px solid var(--lp-line);box-shadow:0 1px 2px rgba(15,26,46,.06),0 6px 18px rgba(15,26,46,.07)}
#lp .lp-dot{flex:none;width:10px;height:10px;border-radius:50%;background:var(--lp-btn);box-shadow:0 0 0 5px rgba(196,74,6,.18)}
#lp.closed .lp-dot{background:var(--lp-edge);box-shadow:none}
#lp .lp-where{flex:1;min-width:0;line-height:1.22}
#lp .lp-where b{display:block;font-size:16px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#lp .lp-where span{display:block;font-size:14px;color:var(--lp-steel);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#lp .lp-body{flex:1;display:flex;flex-direction:column;padding:18px 8px 0}
#lp .lp-mid{margin:auto 0;padding:12px 0}
#lp .lp-meta{display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:16px;font-weight:600;color:var(--lp-soft)}
#lp .lp-count{display:inline-flex;align-items:center;gap:8px;white-space:nowrap}
#lp .lp-count i{width:8px;height:8px;border-radius:50%;background:var(--lp-btn)}
#lp .lp-q{font-family:var(--lp-serif);font-weight:600;font-size:32px;line-height:1.12;letter-spacing:-.01em;margin:12px 0 22px;color:var(--lp-ink);overflow-wrap:break-word}
#lp .lp-q.long{font-size:28px}
#lp .lp-q.xlong{font-size:24px}
#lp .lp-q.small{font-size:24px;margin:10px 0 16px}
#lp .lp-opts{display:grid;gap:8px}
#lp .lp-opt{width:100%;min-height:56px;border-radius:16px;background:var(--lp-panel);color:var(--lp-ink);display:flex;align-items:center;justify-content:space-between;gap:14px;
  padding:10px 16px 10px 20px;font-size:20px;font-weight:600;line-height:1.25;box-shadow:inset 0 0 0 2px var(--lp-btn)}
#lp .lp-opt>span{min-width:0;text-align:left;overflow-wrap:break-word}
#lp .lp-opt:active{transform:scale(.985);background:var(--lp-press)}
#lp .lp-ring{flex:none;width:28px;height:28px;border-radius:50%;box-shadow:inset 0 0 0 2px var(--lp-edge);display:grid;place-items:center}
#lp .lp-opt[aria-checked=true]{background:var(--lp-btn);color:var(--lp-white);box-shadow:none}
#lp .lp-opt[aria-checked=true] .lp-ring{background:var(--lp-white);box-shadow:none}
#lp .lp-ring svg{width:16px;height:16px;stroke:var(--lp-btn);fill:none;stroke-width:3.2;stroke-linecap:round;stroke-linejoin:round;display:none}
#lp .lp-opt[aria-checked=true] .lp-ring svg{display:block}
#lp .lp-opt[aria-disabled=true]{cursor:default}
#lp .lp-note{padding-top:18px;font-size:16px;line-height:1.45;color:var(--lp-soft);display:flex;gap:10px;align-items:flex-start}
#lp .lp-note i{flex:none;width:9px;height:9px;border-radius:50%;margin-top:7px;background:var(--lp-btn)}
#lp .lp-mine{background:var(--lp-panel);color:var(--lp-ink);border:1px solid var(--lp-line);border-radius:20px;padding:10px 8px 10px 14px;display:flex;align-items:center;gap:14px;box-shadow:0 1px 2px rgba(15,26,46,.06),0 6px 18px rgba(15,26,46,.07)}
#lp .lp-tick{flex:none;width:40px;height:40px;border-radius:50%;background:var(--lp-ok);display:grid;place-items:center}
#lp .lp-tick svg{width:22px;height:22px;stroke:var(--lp-white);fill:none;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
#lp .lp-tick.wait{background:transparent;box-shadow:inset 0 0 0 2px var(--lp-edge)}
#lp .lp-tick.wait svg{display:none}
#lp .lp-mine div{flex:1;min-width:0;line-height:1.25}
#lp .lp-mine small{display:block;font-size:15px;font-weight:700;color:var(--lp-steel)}
#lp .lp-mine b{display:block;font-size:18px;font-weight:600;overflow-wrap:break-word}
#lp .lp-chip{flex:none;min-height:56px;min-width:56px;padding:0 18px;border-radius:28px;display:inline-flex;align-items:center;justify-content:center;
  font-size:16px;font-weight:700;background:var(--lp-panel);color:var(--lp-btn-2);box-shadow:inset 0 0 0 2px var(--lp-btn);text-align:center}
#lp .lp-chip[aria-disabled=true]{opacity:.7;cursor:default}
#lp .lp-room{margin-top:22px;display:grid;gap:14px}
#lp .lp-room h3{font-size:16px;font-weight:700;display:flex;justify-content:space-between;gap:12px;color:var(--lp-ink)}
#lp .lp-room h3 span{font-weight:500;color:var(--lp-steel)}
#lp .lp-lab{display:flex;justify-content:space-between;align-items:baseline;gap:12px;font-size:16px;font-weight:600;margin-bottom:6px;color:var(--lp-ink)}
#lp .lp-lab>span:first-child{min-width:0;overflow-wrap:break-word}
#lp .lp-lab b{font-family:var(--lp-serif);font-weight:600;font-size:20px}
#lp .lp-lab small{font-weight:500;font-size:15px;margin-left:6px;color:var(--lp-steel)}
#lp .lp-num{flex:none;white-space:nowrap}
#lp .lp-track{height:14px;border-radius:7px;background:var(--lp-line);overflow:hidden}
#lp .lp-fill{height:100%;width:0;border-radius:7px;background:var(--lp-steel);transition:width .8s cubic-bezier(.2,.8,.2,1)}
#lp .lp-bar.me .lp-fill{background:var(--lp-btn)}
#lp .lp-you{display:inline-block;font-size:13px;font-style:normal;font-weight:700;color:var(--lp-white);background:var(--lp-navy);border-radius:10px;padding:2px 9px;margin-left:8px;vertical-align:2px}
#lp .lp-rowh{font-size:18px;font-weight:700;color:var(--lp-ink);margin:18px 0 8px}
#lp .lp-rowh:first-child{margin-top:0}
#lp .lp-opts.lp-rows{grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}
#lp .lp-rows .lp-opt{min-height:56px;min-width:0;padding:0;justify-content:center;text-align:center;font:600 22px/1 var(--lp-serif)}
#lp .lp-rows .lp-opt span{flex:none}
#lp .lp-rows .lp-ring{display:none}
#lp .lp-ends{display:flex;justify-content:space-between;gap:16px;margin-top:8px;font-size:16px;line-height:1.25;color:var(--lp-soft)}
#lp .lp-ends span:last-child{text-align:right}
#lp .lp-send{width:100%;min-height:60px;margin-top:20px;border-radius:16px;display:flex;align-items:center;justify-content:center;font-size:19px;font-weight:700;
  background:var(--lp-btn);color:var(--lp-white);text-align:center}
#lp .lp-send[aria-disabled=true]{background:var(--lp-panel);color:var(--lp-steel);box-shadow:inset 0 0 0 2px var(--lp-line2)}
#lp .lp-mine b+b{margin-top:2px}
#lp .lp-late{margin:0 0 12px;padding:14px 16px;border-radius:16px;background:rgba(196,74,6,.1);box-shadow:inset 0 0 0 1.5px var(--lp-btn);color:var(--lp-ink);font-size:16px;line-height:1.4}
#lp .lp-leave{width:100%;min-height:56px;margin-top:18px;border-radius:16px;display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:700;
  background:var(--lp-panel);color:var(--lp-ink);box-shadow:inset 0 0 0 2px var(--lp-line2);text-align:center}
#lp .lp-status{position:fixed;left:0;right:0;bottom:0;z-index:2;display:none;align-items:center;gap:12px;
  padding:14px max(18px,env(safe-area-inset-right)) calc(14px + env(safe-area-inset-bottom)) max(18px,env(safe-area-inset-left));
  background:var(--lp-navy);color:#fff;font-size:16px;font-weight:600;line-height:1.3}
#lp .lp-status.on{display:flex}
#lp .lp-status i{flex:none;width:10px;height:10px;border-radius:50%;background:#e7a23c}
#lp-back{position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:2147481999;display:none;align-items:center;justify-content:space-between;gap:12px;
  min-height:64px;padding:8px 8px 8px 20px;border:0;border-radius:32px;background:var(--lp-panel);color:var(--lp-ink);font:700 17px/1.2 var(--lp-sans);box-shadow:inset 0 0 0 2px var(--lp-btn),0 12px 30px rgba(15,26,46,.2);
  text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;max-width:560px;margin:0 auto}
#lp-back.on{display:flex}
#lp-back span{display:flex;align-items:center;gap:12px;min-width:0}
#lp-back span i{flex:none;width:10px;height:10px;border-radius:50%;background:var(--lp-btn);box-shadow:0 0 0 5px rgba(196,74,6,.18)}
#lp-back b{flex:none;min-height:48px;padding:0 16px;border-radius:24px;background:var(--lp-btn);color:var(--lp-white);display:inline-flex;align-items:center;font-size:16px}
@media (max-width:360px){#lp-back span{font-size:15px}#lp-back b{padding:0 12px;font-size:15px}}
@media (min-width:700px){#lp .lp-q{font-size:42px}#lp .lp-q.long{font-size:36px}#lp .lp-q.xlong{font-size:30px}#lp .lp-q.small{font-size:30px}#lp .lp-opt{min-height:64px;font-size:21px}}
@media (max-height:520px){#lp .lp-body{padding-top:10px}#lp .lp-q,#lp .lp-q.long,#lp .lp-q.xlong{font-size:22px;margin:6px 0 12px}}
@media (prefers-reduced-motion:reduce){#lp *,#lp-back{transition:none!important;animation:none!important}#lp .lp-opt:active{transform:none}}`;

  let root = null, back = null, said = null, statusEl = null;
  function mount() {
    if (root || !D.body) return;
    const st = D.createElement("style"); st.id = "lp-style"; st.textContent = CSS; (D.head || D.documentElement).appendChild(st);
    root = D.createElement("div"); root.id = "lp"; root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true"); root.setAttribute("aria-labelledby", "lp-q");
    root.innerHTML = '<div class="lp-in"></div><div class="lp-status" role="status"><i></i><span></span></div>';
    statusEl = root.querySelector(".lp-status");
    back = D.createElement("button"); back.id = "lp-back"; back.type = "button";
    back.innerHTML = "<span><i></i>A poll is open</span><b>Go to the current poll</b>";
    said = D.createElement("div"); said.id = "lp-said"; said.setAttribute("aria-live", "polite");
    said.style.cssText = "position:fixed;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;left:0;top:0";
    D.body.appendChild(root); D.body.appendChild(back); D.body.appendChild(said);
    root.addEventListener("click", onTap);
    back.addEventListener("click", () => { if (liveQ) { hidden[liveQ] = false; render(); emit(); } });
  }
  const say = (t) => { if (said) { said.textContent = ""; setTimeout(() => { said.textContent = t; }, 30); } };

  // ---------- questions: inline on /app, from the thread (reached slides only) everywhere else
  let qBusy = false;
  async function ensureQ(id) {
    if (!id || Q[id] || qBusy) return;
    qBusy = true;
    try {
      const t = await getJson("/api/poll/thread");
      Object.keys(t.slides || {}).forEach((k) => (t.slides[k].questions || []).forEach((q) => { if (q && q.id && Array.isArray(q.options)) Q[q.id] = q; }));
      if (!Q[id]) {   // Aran opened a poll from a slide the room has not reached yet: it is public now
        const j = await getJson("/api/poll/questions");
        (j.questions || []).forEach((q) => { if (q.id === id) Q[q.id] = q; });
      }
    } catch (_) { /* tried again on the next state frame */ }
    qBusy = false;
    render(); emit();
  }

  // ---------- network
  async function getJson(p) {
    const r = await fetch(p, { cache: "no-store", credentials: "same-origin" });
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  }
  const pickT = (j) => ({ q: j.q, total: j.total || 0, counts: Array.isArray(j.counts) ? j.counts : [], options: j.options, closed: !!j.closed,
    rows: Array.isArray(j.rows) ? j.rows.map((r) => ({ key: r.key, label: r.label, total: r.total || 0, counts: Array.isArray(r.counts) ? r.counts : [] })) : null });
  async function loadTally(id) {
    if (!id) return;
    try { tallies[id] = pickT(await getJson("/api/poll/tally?q=" + encodeURIComponent(id))); paintBars(); emit(); } catch (_) { /* not reached yet, or no signal */ }
  }
  async function loadMine() {
    try {
      const j = await getJson("/api/poll/mine");
      conf = {};
      Object.keys(j.answers || {}).forEach((k) => {
        const v = j.answers[k];
        if (okA(v)) conf[k] = v;
        else if (v && typeof v === "object") { const d = {}; Object.keys(v).forEach((r) => { if (Number.isInteger(v[r])) d[r] = v[r]; }); if (!draft[k]) draft[k] = d; }   // one row came from an older phone
      });
      mine = Object.assign({}, conf);
      Object.keys(out).forEach((k) => { mine[k] = out[k].a; });
      save(); render(); emit();
    } catch (_) { /* no signal: keep what the phone holds */ }
  }
  async function checkAudience() {
    if (cfg.audience !== null) return;
    try {
      const r = await fetch("/api/me", { cache: "no-store", credentials: "same-origin" });
      if (r.status === 200) cfg.audience = true;
      else if (r.status === 401 || r.status === 403) cfg.audience = false;
      if (cfg.audience !== null) lsSet("pl:prole", cfg.audience ? "aud" : "other");
    } catch (_) { if (lsGet("pl:prole") === "other") cfg.audience = false; }
    render();
  }
  function setNet(ok) {
    const d = !ok;
    if (d === netDown) return;
    netDown = d; render(); emit();
    if (ok) { retryAt = 0; flush(); }               // back online: send what waited
  }
  // a full snapshot: the room state (own link only), my answers and the live tally. Never deltas.
  function refresh() {
    if (ownStarted) pollState(true);
    loadMine(); if (liveQ) loadTally(liveQ); retryAt = 0; flush();
  }

  // ---------- wake lock, asked for inside the first tap
  let wake = null, wantWake = false;
  function wakeUp() {
    wantWake = true;
    try { if (navigator.wakeLock && !wake) navigator.wakeLock.request("screen").then((w) => { wake = w; w.addEventListener("release", () => { wake = null; }); }).catch(() => {}); } catch (_) { /* not offered */ }
  }

  // ---------- votes
  function vote(id, a) {
    const q = Q[id];
    if (!q || cfg.audience === false || !validA(q, a)) return false;
    if (isRows(q)) a = Object.fromEntries(q.rows.map((r) => [r.key, a[r.key]]));
    if (isClosed(id)) { render(); return false; }
    if (inflight === id) return false;                                       // locked while the send is in flight
    if (has(mine, id) && same(mine[id], a)) { changing[id] = false; render(); return false; }   // the same answer again: nothing to send
    mine[id] = a; out[id] = { a, id: uuid(), t: Date.now() }; changing[id] = false; delete late[id]; delete draft[id]; tapAt[id] = Date.now();
    save();                                                                  // on the phone first, then sent
    const btn = !isRows(q) && root && root.querySelector('.lp-opt[data-a="' + a + '"]');   // selected at once, before anything else
    if (btn) { root.querySelectorAll(".lp-opt").forEach((b) => { b.setAttribute("aria-checked", String(b === btn)); b.setAttribute("aria-disabled", "true"); }); }
    setTimeout(() => { render(); }, 1050);                                   // a slow server: show the saved state within about a second
    emit(); flush();
    return true;
  }
  async function flush() {
    if (inflight || cfg.audience === false || Date.now() < retryAt) return;
    const ids = Object.keys(out); if (!ids.length) return;
    const id = ids[0], o = out[id];
    inflight = id;
    let r = null, j = null;
    try {
      r = await fetch("/api/poll/answer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ q: id, a: o.a }), cache: "no-store", credentials: "same-origin" });
      j = await r.json().catch(() => null);
    } catch (_) { r = null; }
    inflight = null;
    if (!r) { netDown = true; save(); render(); emit(); setTimeout(() => { if (navigator.onLine !== false) flush(); }, 1500); return; }   // stays on the phone; tried again soon, not only on the 4 s tick
    if (netDown && (!ownStarted || wsOk || !window.WebSocket)) netDown = false;
    const same = out[id] && out[id].id === o.id;
    if (r.ok) {
      if (same) delete out[id];
      conf[id] = o.a;
      if (j) tallies[id] = pickT(j);
    } else if (r.status === 409) {                                           // Aran closed it before this vote arrived
      delete out[id];
      if (j) tallies[id] = pickT(Object.assign({}, j, { closed: true }));
      if (!isClosed(id)) closed = closed.concat(id);
      late[id] = has(conf, id) ? "kept" : "lost";
      say(late[id] === "kept" ? "Aran closed this poll before your change was sent. Your earlier answer counts." : "Aran closed this poll before your answer was sent, so it was not counted.");
      if (has(conf, id)) mine[id] = conf[id]; else delete mine[id];
    } else if (r.status === 429) { retryAt = Date.now() + 4000; setTimeout(flush, 4100); }
    else if (r.status === 401) { retryAt = Date.now() + 15000; }            // signed out: kept, the host page asks for sign in
    else if (r.status === 403 && j && j.error === "audience only") { cfg.audience = false; out = {}; }
    else if (r.status === 400 || r.status === 403) { delete out[id]; if (has(conf, id)) mine[id] = conf[id]; else delete mine[id]; }
    else { retryAt = Date.now() + 3000; setTimeout(flush, 3100); }
    save(); render(); emit();
    if (r.ok && Object.keys(out).length) flush();
  }
  setInterval(() => { if (Object.keys(out).length && navigator.onLine !== false) flush(); }, 4000);
  addEventListener("online", () => { retryAt = 0; flush(); if (ownStarted) { pollState(true); reconnect(); } });
  addEventListener("offline", () => { netDown = true; render(); emit(); });

  // ---------- state from the room
  function feed(s) {
    if (!s || typeof s !== "object") return;
    fedAt = Date.now();
    const prev = liveQ;
    liveQ = has(s, "liveQ") ? (s.liveQ || null) : (s.roomQ || null);
    closed = Array.isArray(s.closed) ? s.closed.slice() : [];
    if (typeof s.viewers === "number") viewers = s.viewers;
    if (typeof s.qv === "string") { if (qv !== null && s.qv !== qv && !cfg.questions) Object.keys(Q).forEach((k) => delete Q[k]); qv = s.qv; }
    if (prev && prev !== liveQ && isClosed(prev) && seen[prev] && !hidden[prev]) startClosing(prev);
    if (liveQ && liveQ !== prev) { hidden[liveQ] = false; changing[liveQ] = false; loadTally(liveQ); }
    if (liveQ && !Q[liveQ]) ensureQ(liveQ);
    render(); emit();
  }
  function startClosing(id) {
    // round 2 (Flux): the phone goes back to the slide the moment a poll closes; the final bars stay in the Polls list
    closingQ = null; clearTimeout(closeTimer);
    if (opened === id) opened = null;
    say("Poll closed. Back to the slide. The results are in Polls.");
  }
  function setTallies(map) {
    if (!map || typeof map !== "object") return;
    Object.keys(map).forEach((k) => { if (map[k]) tallies[k] = pickT(map[k]); });
    paintBars(); emit();
  }

  // ---------- drawing
  const tickSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const usable = () => cfg.audience !== false;
  function shownId() { return closingQ || (opened && Q[opened] && usable() ? opened : null) || (liveQ && Q[liveQ] && usable() ? liveQ : null); }
  function ansText(q, v) {
    if (!q || v == null) return "";
    if (isRows(q)) return q.rows.map((r) => r.label + ": " + (q.options[v[r.key]] != null ? q.options[v[r.key]] : "no answer")).join(". ");
    return q.options[v] != null ? q.options[v] : "";
  }
  function mineHtml(q, v) { return isRows(q) ? q.rows.map((r) => `<b>${esc(r.label)}: ${esc(q.options[v[r.key]])}</b>`).join("") : `<b>${esc(q.options[v])}</b>`; }
  function mode(id) {
    if (closingQ === id || isClosed(id)) return "closed";
    if (!has(mine, id) || changing[id]) return "vote";
    // just tapped and the server has not answered yet: stay on the options (selected) for up to a second
    if (has(out, id) && !isRows(Q[id]) && Date.now() - (tapAt[id] || 0) < 1000) return "vote";
    return "result";
  }
  function countLine(id) {
    const t = tallies[id]; if (!t) return "";
    const n = t.total;
    return viewers && viewers >= n ? n + " of " + viewers + " voted" : n + (n === 1 ? " vote" : " votes");
  }
  function barsHtml(q, id) {
    const one = (pick, k) => q.options.map((o, i) => `<div class="lp-bar${i === pick ? " me" : ""}" data-i="${i}"${k != null ? ` data-row="${k}"` : ""}><div class="lp-lab"><span>${esc(o)}${i === pick ? '<i class="lp-you">you</i>' : ""}</span>` +
      `<span class="lp-num"><b data-pc>0%</b><small data-n>0</small></span></div><div class="lp-track"><div class="lp-fill"></div></div></div>`).join("");
    if (!isRows(q)) return one(mine[id], null);
    const v = has(mine, id) ? mine[id] : {};
    return q.rows.map((r, k) => `<p class="lp-rowh">${esc(r.label)}</p>` + one(v[r.key], k)).join("");
  }
  function statusText(id) {
    const off = netDown || navigator.onLine === false;
    if (id && has(out, id) && off) return "Vote saved, sending when connected";
    if (off) return "Reconnecting to the room";
    return "";
  }
  function render() {
    mount(); if (!root) return;
    const id = shownId(), q = id ? Q[id] : null;
    const on = !!(q && (closingQ === id || !hidden[id]));
    const backOn = !!(!on && liveQ && Q[liveQ] && hidden[liveQ] && usable());
    if (on) seen[id] = true;
    root.classList.toggle("on", on);
    back.classList.toggle("on", backOn);
    D.documentElement.classList.toggle("lp-open", on);
    D.documentElement.classList.toggle("lp-min", backOn);
    const stt = on ? statusText(id) : "";
    statusEl.classList.toggle("on", !!stt); statusEl.lastChild.textContent = stt;
    if (!on) { if (lastSig) { lastSig = ""; root.firstChild.innerHTML = ""; } return; }
    const m = mode(id), pend = has(out, id), sending = inflight === id;
    const counted2 = !pend && has(mine, id) && has(conf, id) && same(conf[id], mine[id]);
    const sig = JSON.stringify([id, m, mine[id], pend, sending, counted2, late[id] || "", cfg.host, cfg.back, q.text, q.options, draft[id] || null, opened]);
    if (sig !== lastSig) {
      const was = lastSig ? JSON.parse(lastSig) : null, fresh = !was || was[0] !== id || was[1] !== m;
      const fa = D.activeElement && root.contains(D.activeElement) ? D.activeElement : null;
      const focusKey = fa ? (fa.hasAttribute("data-r") ? '[data-r="' + fa.getAttribute("data-r") + '"][data-a="' + fa.getAttribute("data-a") + '"]' : fa.getAttribute("data-a") !== null ? '[data-a="' + fa.getAttribute("data-a") + '"]'
        : fa.hasAttribute("data-send") ? "[data-send]" : fa.hasAttribute("data-change") ? "[data-change]" : "") : "";
      const counted = counted2;
      lastSig = sig;
      root.classList.toggle("closed", m === "closed");
      let label, sub;
      if (m === "closed") { label = "Poll closed"; sub = "Final results"; }
      else if (m === "result") { label = counted ? "You voted" : "Vote saved"; sub = counted ? "The room is still voting" : "Sending when connected"; }
      else { label = "A poll is open"; sub = isRows(q) ? "Pick one answer in each row" : has(mine, id) && !pend ? "Tap a different answer to change it" : "Tap one answer below"; }
      const leave = cfg.back || (cfg.host === "app" ? "Back to the slide" : "Back to the page");
      let h = `<div class="lp-pill"><i class="lp-dot"></i><div class="lp-where"><b>${label}</b><span>${sub}</span></div></div><div class="lp-body"><div class="lp-mid">`;
      h += `<div class="lp-meta"><span>${m === "closed" ? "Closed poll" : "Live poll"}</span><span class="lp-count"><i></i><span data-count>${esc(countLine(id))}</span></span></div>`;
      const len = q.text.length, cls = len > 80 ? " xlong" : len > 48 ? " long" : "";
      if (m === "vote" && isRows(q)) {   // readiness: one answer per row, then one Send
        if (!draft[id] && !has(mine, id)) {   // Today starts from this phone's answer to the same question at sign-up; still changeable
          const pre = {}; q.rows.forEach((r) => { if (r.q && Number.isInteger(mine[r.q]) && mine[r.q] < q.options.length) pre[r.key] = mine[r.q]; });
          if (Object.keys(pre).length) draft[id] = pre;
        }
        const d = draft[id] || {}, full = validA(q, d);
        h += `<h2 class="lp-q${cls}" id="lp-q">${esc(q.text)}</h2>`;
        h += q.rows.map((r) => `<p class="lp-rowh" id="lp-r-${esc(r.key)}">${esc(r.label)}</p><div class="lp-opts lp-rows" role="radiogroup" aria-labelledby="lp-r-${esc(r.key)}">` +
          q.options.map((o, i) => `<button class="lp-opt" type="button" role="radio" data-r="${esc(r.key)}" data-a="${i}" aria-label="${esc(o)}" aria-checked="${d[r.key] === i}"${sending ? ' aria-disabled="true"' : ""}><span>${i + 1}</span><i class="lp-ring">${tickSvg}</i></button>`).join("") + `</div>` +
          `<div class="lp-ends" aria-hidden="true"><span>1 ${esc(q.options[0])}</span><span>${q.options.length} ${esc(q.options[q.options.length - 1])}</span></div>`).join("");
        h += `<button class="lp-send" type="button" data-send${full && !sending ? "" : ' aria-disabled="true"'}>${full ? "Send my answers" : "Pick one answer in each row"}</button>`;
        h += `<p class="lp-note"><i></i>You can change your answers until Aran closes the poll.</p>`;
      } else if (m === "vote") {
        h += `<h2 class="lp-q${cls}" id="lp-q">${esc(q.text)}</h2><div class="lp-opts" role="radiogroup" aria-labelledby="lp-q">`;
        h += q.options.map((o, i) => `<button class="lp-opt" type="button" role="radio" data-a="${i}" aria-checked="${mine[id] === i}"${pend && !changing[id] ? ' aria-disabled="true"' : ""}><span>${esc(o)}</span><i class="lp-ring">${tickSvg}</i></button>`).join("");
        h += `</div><p class="lp-note"><i></i>Tap to vote. You can change your answer until Aran closes the poll.</p>`;
      } else if (m === "result") {
        h += `<h2 class="lp-q small" id="lp-q">${esc(q.text)}</h2>`;
        h += `<div class="lp-mine" data-counted="${counted}"><span class="lp-tick${counted ? "" : " wait"}">${tickSvg}</span><div><small>${counted ? "Counted" : "Saved on your phone"}</small>${mineHtml(q, mine[id])}</div>` +
          `<button class="lp-chip" type="button" data-change${sending ? ' aria-disabled="true"' : ""}>Change</button></div>`;
        h += `<div class="lp-room"><h3>The room so far <span>live</span></h3>${barsHtml(q, id)}</div>`;
        h += `<button class="lp-leave" type="button" data-hide>${esc(leave)}</button>`;
      } else {
        h += `<h2 class="lp-q small" id="lp-q">${esc(q.text)}</h2>`;
        if (late[id] === "lost") h += `<p class="lp-late">Aran closed this poll before your answer was sent, so it was not counted.</p>`;
        else if (late[id] === "kept") h += `<p class="lp-late">Aran closed this poll before your change was sent. Your earlier answer counts.</p>`;
        if (has(mine, id) && ansText(q, mine[id])) h += `<div class="lp-mine"><span class="lp-tick">${tickSvg}</span><div><small>${isRows(q) ? "Your answers" : "Your answer"}</small>${mineHtml(q, mine[id])}</div></div>`;
        h += `<div class="lp-room"><h3>Final results <span>closed</span></h3>${barsHtml(q, id)}</div>`;
        h += `<p class="lp-note"><i></i>Back in a moment. The result stays in your polls.</p>`;
      }
      h += `</div></div>`;
      root.firstChild.innerHTML = h;
      if (fresh) root.scrollTop = 0;
      if (m === "result" && counted && (!was || !was[5] || fresh)) say("Counted. " + ansText(q, mine[id]));
      else if (fresh) say(label + ". " + q.text);
      if (focusKey) {
        const f = root.querySelector(focusKey) || root.querySelector("[data-change]");
        if (f) { try { f.focus({ preventScroll: true }); } catch (_) { /* old browser */ } }
      }
    }
    paintBars();
  }
  function paintBars() {
    if (!root || !root.classList.contains("on")) return;
    const id = shownId(), t = id && tallies[id];
    const c = root.querySelector("[data-count]"); if (c && id) c.textContent = countLine(id);
    if (!t) return;
    const tot = t.total || 0;
    root.querySelectorAll(".lp-bar").forEach((b) => {
      const row = b.dataset.row != null && t.rows ? t.rows[+b.dataset.row] : null, cs = row ? row.counts : t.counts, tt = row ? row.total : tot;
      const i = +b.dataset.i, n = cs[i] || 0, v = tt ? Math.round((n / tt) * 100) : 0;
      b.querySelector("[data-pc]").textContent = v + "%"; b.querySelector("[data-n]").textContent = String(n);
      b.querySelector(".lp-fill").style.width = v + "%";
    });
  }
  function onTap(e) {
    const t = e.target.closest && e.target.closest("button"); if (!t || t.getAttribute("aria-disabled") === "true") return;
    const id = shownId(); if (!id) return;
    if (!wantWake) wakeUp();
    if (Date.now() < lockUntil) return;                                     // the second tap of a double tap
    if (t.dataset.r !== undefined && t.dataset.a !== undefined) {   // readiness: picking a row is not yet a vote
      if (inflight === id || isClosed(id)) return;
      draft[id] = Object.assign({}, draft[id] || {}, { [t.dataset.r]: +t.dataset.a }); render(); return;
    }
    if (t.hasAttribute("data-send")) { if (vote(id, draft[id] || {})) lockUntil = Date.now() + 650; return; }
    if (t.dataset.a !== undefined) { if (vote(id, +t.dataset.a)) lockUntil = Date.now() + 650; return; }
    if (t.hasAttribute("data-change")) {
      if (isRows(Q[id])) draft[id] = Object.assign({}, mine[id] || {});
      changing[id] = true; lockUntil = Date.now() + 350; render();
      const f = root.querySelector('.lp-opt[aria-checked="true"]') || root.querySelector(".lp-opt"); if (f) { try { f.focus({ preventScroll: true }); } catch (_) { /* old browser */ } }
      return;
    }
    if (t.hasAttribute("data-hide")) { if (id === opened) opened = null; else hidden[id] = true; render(); emit(); }
  }

  // ---------- its own live link, only when no host page feeds it
  let ws = null, wsOk = false, wsAt = 0, wsTry = 0, ownStarted = false, rt = 0;
  const backoff = () => Math.round(Math.min(30000, 1000 * Math.pow(2, wsTry)) * (0.5 + Math.random() * 0.5));
  function connect() {
    clearTimeout(rt);
    if (!window.WebSocket || ws) return;
    let w; try { w = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/api/ws"); } catch (_) { return; }
    ws = w;
    w.onopen = () => { if (ws !== w) return; wsOk = true; wsAt = Date.now(); wsTry = 0; setNet(true); loadMine(); if (liveQ) loadTally(liveQ); };
    w.onmessage = (e) => { wsAt = Date.now(); try { const m = JSON.parse(e.data); if (m && m.t === "state") feed(m.s); else if (m && m.t === "poll") setTallies(m.tallies); } catch (_) { /* bad frame */ } };
    const gone = () => { if (ws !== w) return; wsOk = false; ws = null; try { w.close(); } catch (_) { /* closed */ } netDown = true; render(); rt = setTimeout(connect, backoff()); wsTry++; };
    w.onclose = gone; w.onerror = gone;
  }
  function reconnect() { clearTimeout(rt); const old = ws; ws = null; wsOk = false; wsTry = 0; if (old) { try { old.close(); } catch (_) { /* closed */ } } connect(); }
  async function pollState(force) {
    if (!force && wsOk && Date.now() - wsAt < 35000) return;
    try {
      const r = await fetch("/api/state", { cache: "no-store", credentials: "same-origin" });
      if (r.ok) { feed(await r.json()); if (!window.WebSocket || !wsOk) setNet(true); }
    } catch (_) { if (!netDown) { netDown = true; render(); } }
  }
  function selfStart() {
    if (ownStarted || cfg.fed) return;
    ownStarted = true;
    checkAudience(); connect(); pollState(true);
    // the socket is not open within 3 s: ask for the state every 2 s until it is
    setTimeout(() => { setInterval(() => { if (!wsOk || Date.now() - wsAt > 35000) pollState(true); }, 2000); }, 3000);
    setInterval(() => { if (wsOk) { try { ws.send("ping"); } catch (_) { /* gone */ } } }, 20000);
    D.addEventListener("visibilitychange", () => {
      if (D.visibilityState !== "visible") return;
      reconnect(); refresh();                         // a phone that slept: treat the socket as dead and take a full snapshot
    });
  }
  D.addEventListener("visibilitychange", () => { if (D.visibilityState === "visible" && wantWake && !wake) wakeUp(); });

  window.LivePoll = {
    feed, tallies: setTallies, refresh,
    net: (ok) => setNet(!!ok),                         // a host page says whether its own socket is up
    config(o) {
      o = o || {};
      if (o.fed) cfg.fed = true;
      if (typeof o.host === "string") cfg.host = o.host;
      if (typeof o.back === "string") cfg.back = o.back;
      if (typeof o.audience === "boolean") cfg.audience = o.audience;
      if (typeof o.onChange === "function") cfg.onChange = o.onChange;
      if (Array.isArray(o.questions)) {
        cfg.questions = true; Object.keys(Q).forEach((k) => delete Q[k]);
        o.questions.forEach((q) => { if (q && q.id && Array.isArray(q.options)) Q[q.id] = q; });
      }
      lastSig = ""; render();
    },
    vote, flush, loadTally, loadMine,
    mine: () => Object.assign({}, mine),
    confirmed: () => Object.assign({}, conf),
    pending: () => { const r = {}; Object.keys(out).forEach((k) => { r[k] = out[k].a; }); return r; },
    sending: () => inflight,
    tally: (id) => tallies[id] || null,
    live: () => liveQ,
    closedList: () => closed.slice(),
    isClosed,
    late: (id) => late[id] || "",
    question: (id) => Q[id] || null,
    viewers: () => viewers,
    offline: () => netDown || navigator.onLine === false,
    show() { if (liveQ) { hidden[liveQ] = false; opened = null; render(); emit(); } },
    open(id) {                                      // show an open poll that is not live (a readiness screen after Aran moved on)
      if (id === liveQ) { this.show(); return true; }
      if (!Q[id] || isClosed(id)) return false;
      opened = id; changing[id] = !has(mine, id) ? false : changing[id]; render(); emit(); return true;
    },
    answerText: (id, v) => ansText(Q[id], v === undefined ? mine[id] : v),
    isRows: (id) => isRows(Q[id]),
    showing: () => !!(root && root.classList.contains("on")),
    minimized: () => !!(back && back.classList.contains("on")),
    own: () => ownStarted,
    wake: () => { if (!wantWake) wakeUp(); },        // a host page asks for the wake lock inside its own first tap
  };

  if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", () => { mount(); render(); }); else mount();
  loadMine();
  setTimeout(() => { if (!cfg.fed && !fedAt) selfStart(); }, 2000);
})();
