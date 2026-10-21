// The Event Durable Object: one instance for the whole event. It owns the room state (current
// slide, beat, effects level, blackout, ticks, which scenes have been reached), the
// WebSocket fan-out, the bounded Maisie log, sign-ups, and the login rate limiter.
// It only ever sees requests the Worker has already authenticated: the Worker sets x-role,
// x-sid and x-ip on an internal request. Nothing here is reachable from the internet directly.
import { DurableObject } from "cloudflare:workers";
import { SCENES, CONTENT, DECK, N, audienceContent, presenterContent, indexOfId } from "./deckdata.js";
import { QUESTIONS, QBY } from "./questions.js";
import { cleanQuestions, effQuestions, qVersion, TYPE_NAMES } from "./qedit.js";   // ---- v4 a17 q
import { shiftOf } from "./finale.js";
// round 2 readiness: the option index the middle voter picked, or null with no votes
const medianOf = (c) => { const n = c.reduce((a, b) => a + b, 0); if (!n) return null; let run = 0; for (let i = 0; i < c.length; i++) { run += c[i]; if (run * 2 >= n) return i; } return null; };
import { CARDS } from "./cards.js";
import { Maisie, clean } from "./maisie.js";
import { Accounts } from "./accounts.js";
import { Wall } from "./wall.js";   // v3 wall
import { setupState, setupCtl, slidesLive, liveQuestion, isClosed, closeOnLeave } from "./setup.js";
import { cleanPlan, effective, neighbour } from "./plan.js";   // ---- v4 c
import { rehearsalReset } from "./rehearsal.js";   // ---- v4 a19 admin
import { Copy } from "./copy.js";   // G9 editable copy

const ID_RE = /^[A-Za-z]{1,3}\d{1,3}$/;
const ALL_REQ = new Set(CONTENT.chapters.flatMap((c) => c.reqs.map((r) => r.id)));
const MAX_SOCKETS = 4000, PER_PERSON = 4, FX_LEVELS = ["calm", "standard", "full"];

const blankCore = () => ({ slide: null, beat: 0, fx: "standard", pace: "auto", qr: false, blackout: false,   // ---- v4 a17 ctl: pace and qr
  done: [], reached: [],
  epoch: 1, rev: 0, cver: 0, visit: 0, plan: null, questions: null, qver: 0,   // questions, qver: v4 a17 q
  auto: {},
  closed: [] });   // round 2 polls: ids of polls Aran closed (no new answers, final bars on phones)   // ---- v4 a23 step: per-slide autoplay overrides, scene id -> true or false; a slide with no entry uses its default

// ---- v4 a23 step: a slide has pieces (builds, or a sequence of its own) when its scene pins a builds pace; autoplay defaults on only where the scene says so
// The cover pins the pace but has nothing to build, so it gets no switch.
const PIECE_IDS = SCENES.filter((s) => (s.builds === "click" || s.builds === "auto") && s.id !== "cover").map((s) => s.id);
const autoDefault = (id) => { const s = SCENES.find((x) => x.id === id); return !!(s && s.autoplay); };
const autoMap = (c) => { const m = {}; for (const id of PIECE_IDS) m[id] = typeof c.auto[id] === "boolean" ? c.auto[id] : autoDefault(id); return m; };

const J = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const num = (v, lo, hi) => (typeof v === "number" && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null);

export class Event extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.core = blankCore();
    this.rl = {};
    this.pollers = new Map();
    this.pc = {};              // poll counters: question id -> [n per option], kept up to date on every answer
    this.shift = { up: 0, same: 0, down: 0 };   // v3 today: accounts that answered both Today (cover) and a month from now (close), by direction. Counts only.
    this.pa = new Map();       // answers per session id (cache; the source of truth is storage "pa:<sid>")
    this.pollRl = new Map(); this.pollDirty = new Set(); this.pollTimer = null; this.pollLast = 0;
    this.maisie = new Maisie({
      env, storage: ctx.storage,
      slide: () => this.core.slide, reached: () => this.core.reached, hidden: () => effective(this.core.plan).hidden, visit: () => this.core.visit,
      // "board" changes matter only to the presenter's own screens; everything else goes to the room
      notify: async (scope) => (scope === "board" ? this.broadcast("", ["presenter"]) : this.broadcast("")),
      control: (c) => this.control(c),
      eff: (s) => (this.copy && s ? this.copy.scene(s.id) : null),   // round 2: Maisie reads the edited wording, so she never edits blind
    });
    this.acct = new Accounts(this);   // accounts, private notes, finale numbers (src/accounts.js)
    this.wall = new Wall(this);       // v3 wall: the experiment wall (src/wall.js)
    this.copy = new Copy(this);       // G9 editable copy: overrides and their history (src/copy.js)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    ctx.blockConcurrencyWhile(async () => {
      const g = await ctx.storage.get(["core", "rl", "pc", "shift"]);
      if (g.get("shift")) this.shift = { up: 0, same: 0, down: 0, ...g.get("shift") };
      if (g.get("core")) this.core = { ...blankCore(), ...g.get("core") };
      this.pc = g.get("pc") || {};
      this.rl = g.get("rl") || {};
      await this.maisie.load();
      await this.acct.load();
      await this.wall.load();
      await this.copy.load();
    });
  }

  // ---- state
  saveCore() { return this.ctx.storage.put("core", this.core); }
  viewers() {    // distinct audience sessions that are connected or have polled in the last few seconds
    const now = Date.now();
    if (this._vw && now - this._vw.t < 1000) return this._vw.n;   // G10 scale: walked at most once a second, not once per socket during a join storm
    const ids = new Set();
    for (const [k, t] of this.pollers) { if (now - t > 6000) this.pollers.delete(k); else ids.add(k); }
    for (const ws of this.ctx.getWebSockets("audience")) {
      const tag = this.ctx.getTags(ws).find((x) => x.startsWith("s:"));
      ids.add(tag || "ws");
    }
    this._vw = { t: now, n: ids.size };
    return ids.size;
  }
  stateFor(role, by = "") {
    const c = this.core;
    const s = {
      slide: c.slide, beat: c.beat, fx: c.fx, pace: c.pace, qr: c.qr, blackout: c.blackout,
      done: c.done, ch: c.slide == null ? null : CONTENT.chapterOfScene[c.slide], rev: c.rev, ver: c.cver, epoch: c.epoch,
      mv: this.maisie.version(role), viewers: this.viewers(), total: CONTENT.total, now: Date.now(), by,
      publish: false, links: {}, tally: {},
      plan: effective(c.plan),   // ---- v4 c: walking order and hidden scene indices
      qv: qVersion(c),           // ---- v4 a17 q: changes when the edited question list (or its order) changes
    };
    if (role === "presenter") { const pk = this.maisie.picks(); if (pk.length) s.picks = pk; }   // ---- v4 a17 q: Maisie's picks for Aran
    Object.assign(s, setupState(this, role));   // control: eyesUp, roomQ, pairing, probe (src/setup.js)
    if (role === "presenter") { s.presenter = true; s.auto = autoMap(c); if (this.cmd) s.cmd = this.cmd; }   // ---- v4 a23 step: autoplay per slide, and the last Back or Next the slides page is asked to play
    s.cv = this.copy.sceneVer(c.slide);   // G9: copy version of the slide on screen only (a number, never text)
    const sn = this.acct.profile.view(); if (sn) s.shownNote = sn;   // the shared note on the projector, never an email
    return s;
  }
  // One serialised frame per role, sent to that role's sockets only (tag filter, no per-socket
  // tag lookups). Roles limits which sockets are walked, so a board-only change touches a handful.
  broadcast(by = "", roles = ["presenter", "audience"]) {
    for (const role of roles) {
      const socks = this.ctx.getWebSockets(role);
      if (!socks.length) continue;
      const frame = JSON.stringify({ t: "state", s: this.stateFor(role, by) });
      for (const ws of socks) { try { ws.send(frame); } catch { /* socket gone */ } }
    }
  }

  // ---- rate limiting (per key, sliding window; failures are persisted so they survive eviction)
  rlPrune(key, win) {
    const now = Date.now();
    const arr = (this.rl[key] || []).filter((t) => now - t < win * 1000);
    if (arr.length) this.rl[key] = arr; else delete this.rl[key];
    return arr;
  }
  hit(key, limit, win) {     // memory only; true if allowed
    const arr = this.rlPrune(key, win);
    if (arr.length >= limit) return false;
    arr.push(Date.now()); this.rl[key] = arr;
    return true;
  }
  async rate(body) {
    const key = String(body.key || "").slice(0, 80), limit = num(body.limit, 1, 1000) || 5, win = num(body.win, 1, 86400) || 600;
    if (!key) return J({ error: "key" }, 400);
    const arr = this.rlPrune(key, win);
    const retry = arr.length ? Math.max(1, Math.ceil((arr[0] + win * 1000 - Date.now()) / 1000)) : 0;
    if (body.op === "check") return J({ blocked: arr.length >= limit, retry });
    if (body.op === "fail") {
      arr.push(Date.now()); this.rl[key] = arr;
      const keys = Object.keys(this.rl);
      if (keys.length > 400) for (const k of keys.slice(0, keys.length - 400)) delete this.rl[k];
      await this.ctx.storage.put("rl", this.rl);
      return J({ blocked: arr.length >= limit, retry });
    }
    if (body.op === "clear") { delete this.rl[key]; await this.ctx.storage.put("rl", this.rl); return J({ ok: true }); }
    return J({ error: "op" }, 400);
  }

  // ---- presenter controls
  async setSlide(i, by) {
    const c = this.core;
    if (!Number.isInteger(i) || i < 0 || i >= N) return false;
    if (c.slide === i) return true;
    const was = liveQuestion(this);   // round 2: the poll live before the move (Aran's open one, else the slide's own)
    c.slide = i; c.visit += 1; c.beat = 0;
    if (!c.reached.includes(i)) c.reached = [...c.reached, i].sort((a, b) => a - b);
    closeOnLeave(this, was, SCENES[i].id);   // round 2 (Flux): it closes when he leaves its slide, either direction, unless it is live on the new slide too
    if (DECK.autoTick) {
      const add = (SCENES[i].ticks || []).filter((q) => ALL_REQ.has(q) && !c.done.includes(q));
      if (add.length) { c.done = [...c.done, ...add].sort(); c.rev += 1; }
    }
    c.cver += 1;
    await this.saveCore();
    await this.ctx.storage.setAlarm(Date.now() + 8000);
    this.broadcast(by);
    return true;
  }
  // ---- v4 a23 step: Back and Next from the remote or from Maisie. While a slides page is open it is asked to play the step
  // (one build, one frame, or the slide), so Back undoes exactly one thing and Next plays exactly one piece. With no page
  // open, or none that answers within a second, the whole slide moves, as before.
  async stepBy(d, by) {
    const c = this.core;
    if (c.slide != null && slidesLive(this)) {
      const n = Math.max(Date.now(), ((this.cmd && this.cmd.n) || 0) + 1);
      this.cmd = { n, d }; this.cmdAck = 0;
      this.broadcast(by, ["presenter"]);
      for (let k = 0; k < 24 && (this.cmdAck || 0) < n; k++) await new Promise((r) => setTimeout(r, 50));
      if ((this.cmdAck || 0) >= n) return true;
    }
    const n = neighbour(c.plan, c.slide, d);
    return n != null && await this.setSlide(n, by);
  }
  // slide actions that Maisie may take for Aran (same code path as his own buttons)
  async control(c) {
    const cur = this.core.slide;
    if (c.op === "next") return this.stepBy(1, "maisie");   // ---- v4 c, v4 a23 step
    if (c.op === "back") return this.stepBy(-1, "maisie");
    if (c.op === "jump") return this.setSlide(c.slide, "maisie");
    if (c.op === "blackout") { this.core.blackout = !!c.on; await this.saveCore(); this.broadcast("maisie"); return true; }
    return false;
  }
  remoteView() {
    const i = this.core.slide;
    const titleOf = (s) => String(s.title || s.hl || s.kick || s.id || "").replace(/\s+/g, " ").slice(0, 90);
    const pl = effective(this.core.plan), hid = new Set(pl.hidden);   // ---- v4 c
    const slides = pl.order.map((k) => ({ i: k, id: SCENES[k].id || "s" + k, t: SCENES[k].t || "", title: titleOf(SCENES[k]), kick: SCENES[k].kick || "", hidden: hid.has(k), dflt: !!SCENES[k].hidden }));
    const notesOf = (k) => (k == null || !SCENES[k] ? [] : [].concat(SCENES[k].notes || []).map((x) => String(x)));
    return { slides, now: i, notes: notesOf(i), next: i == null ? neighbour(this.core.plan, null, 1) : neighbour(this.core.plan, i, 1),
      nextNotes: (() => { const n = i == null ? neighbour(this.core.plan, null, 1) : neighbour(this.core.plan, i, 1); return n == null ? [] : notesOf(n); })(), state: this.stateFor("presenter"),
      ...(() => { const picks = this.maisie.picks(); return picks.length ? { picks } : {}; })() };   // ---- v4 a17 q: Maisie's picks for Aran, only when there are any
  }
  async ctl(name, body, by) {
    const c = this.core;
    switch (name) {
      case "jump": return await this.setSlide(body.slide, by) ? J({ ok: true, state: this.stateFor("presenter", by) }) : J({ error: "slide" }, 400);
      case "next": return await this.stepBy(1, by) ? J({ ok: true, state: this.stateFor("presenter", by) }) : J({ error: "end" }, 400);   // ---- v4 c, v4 a23 step
      case "back": return await this.stepBy(-1, by) ? J({ ok: true, state: this.stateFor("presenter", by) }) : J({ error: "start" }, 400);
      case "ack": {   // ---- v4 a23 step: the slides page says it played the step it was asked for
        const n = num(body.n, 0, 1e15); if (n !== null && n > (this.cmdAck || 0)) this.cmdAck = n;
        return J({ ok: true });
      }
      case "autoplay": {   // ---- v4 a23 step: per-slide autoplay, kept in the room so every screen agrees and a reload keeps it
        if (body.reset === true) c.auto = {};
        else {
          const id = String(body.slide || "");
          if (!PIECE_IDS.includes(id) || typeof body.on !== "boolean") return J({ error: "autoplay" }, 400);
          if (body.on === autoDefault(id)) delete c.auto[id]; else c.auto[id] = body.on;
        }
        await this.saveCore(); this.broadcast(by);
        return J({ ok: true, auto: autoMap(c) });
      }
      case "plan": {   // ---- v4 c: save the slide order and the hidden set; { reset: true } restores the default
        c.plan = cleanPlan(body); c.cver += 1;
        await this.saveCore(); this.broadcast(by);
        return J({ ok: true, plan: effective(c.plan), saved: !!c.plan });
      }
      case "questions": {   // ---- v4 a17 q: save the edited question list; { reset: true } restores Aran's original questions
        const before = this.qs();
        c.questions = cleanQuestions(body); c.qver = (c.qver || 0) + 1; c.cver += 1;
        let drop = false;
        for (const q of this.qs()) { const o = before.find((x) => x.id === q.id); if (o && o.options.length !== q.options.length && this.pc[q.id]) { delete this.pc[q.id]; drop = true; } }
        if (drop) await this.ctx.storage.put("pc", this.pc);
        await this.saveCore(); this.broadcast(by);
        return J({ ok: true, qv: qVersion(c), saved: !!c.questions, questions: this.qs() });
      }
      case "beat": {
        const b = num(body.beat, 0, 200);
        if (b === null) return J({ error: "beat" }, 400);
        if (c.beat !== b) { c.beat = Math.floor(b); await this.saveCore(); this.broadcast(by); }
        return J({ ok: true });
      }
      case "blackout": {
        const on = !!body.on;
        if (c.blackout !== on) { c.blackout = on; await this.saveCore(); this.broadcast(by); }
        return J({ ok: true });
      }
      case "effects": {
        if (!FX_LEVELS.includes(body.level)) return J({ error: "level" }, 400);
        if (c.fx !== body.level) { c.fx = body.level; await this.saveCore(); this.broadcast(by); }
        return J({ ok: true });
      }
      case "pace": {   // ---- v4 a17 ctl: builds Autoplay or Click
        if (body.mode !== "auto" && body.mode !== "click") return J({ error: "mode" }, 400);
        if (c.pace !== body.mode) { c.pace = body.mode; await this.saveCore(); this.broadcast(by); }
        return J({ ok: true, state: this.stateFor("presenter", by) });
      }
      case "qr": {     // ---- v4 a17 ctl: the big join QR card on the presenter page
        if (typeof body.on !== "boolean") return J({ error: "on" }, 400);
        const on = body.on;
        if (c.qr !== on) { c.qr = on; await this.saveCore(); this.broadcast(by); }
        return J({ ok: true, state: this.stateFor("presenter", by) });
      }
      case "ticks": {
        if (!Array.isArray(body.done) || body.done.length > 300) return J({ error: "done" }, 400);
        const done = [...new Set(body.done.filter((q) => typeof q === "string" && ID_RE.test(q) && ALL_REQ.has(q)))].sort();
        if (JSON.stringify(done) !== JSON.stringify(c.done)) {
          c.done = done; c.rev += 1; c.cver += 1;
          await this.saveCore(); this.broadcast(by);
        }
        return J({ ok: true, state: this.stateFor("presenter", by) });
      }
      case "reset": {
        c.epoch += 1; c.done = []; c.rev += 1; c.cver += 1;
        c.reached = c.slide == null ? [] : [c.slide];
        c.closed = []; c.roomQ = null;   // round 2 polls: a fresh run starts with every poll open and none forced on phones
        await this.saveCore(); this.broadcast(by);
        return J({ ok: true, epoch: c.epoch, state: this.stateFor("presenter", by) });
      }
      case "signups": case "noteshow": case "never": return this.acct.ctl(name, body);
      case "rehearsal": return rehearsalReset(this, body);   // ---- v4 a19 admin
      default: return (await setupCtl(this, name, body, by)) || J({ error: "unknown" }, 404);
    }
  }

  // ---- exports
  csv(rows, file) {
    const cell = (v) => {
      let s = String(v == null ? "" : v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return new Response(rows.map((r) => r.map(cell).join(",")).join("\n") + "\n", {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${file}"` } });
  }
  questionsCsv() {
    const m = this.maisie;
    const rows = [["when", "question id", "status", "slide", "first name", "last name", "email", "ok to follow up", "question"]]
      .concat(m.qb.map((q) => [new Date(q.ts * 1000).toISOString(), q.id, q.status, q.slide, q.name, q.ln || "", q.em || "", q.oi ? "yes" : "no", q.text]));
    return this.csv(rows, "questions.csv");
  }
  registrantsCsv() { return this.acct.csv(); }   // rebuilt from the accounts: email, name, optin, created
  // ---- the poll. Counters per option are kept in memory and in storage, so a tally never walks the
  // answers. Each session's own answers live under "pa:<sid>" (question id -> option index).
  // Only counts ever leave this object, and only for slides the room has already reached.
  qs() {   // ---- v4 a17 q: the effective question list, cached until the saved list or the plan changes
    const ed = this.copy && typeof this.copy.scene === "function";   // round 2: the editor's move4 wording feeds the Rehearse buttons (after deck2edit merges)
    const key = qVersion(this.core) + (ed ? ":c" + this.copy.v : "");
    if (!this._ql || this._ql.key !== key) { const list = effQuestions(this.core.questions, this.core.plan, ed ? this.copy.scene("move4") : null); this._ql = { key, list, map: Object.fromEntries(list.map((q) => [q.id, q])) }; }
    return this._ql.list;
  }
  qby(id) { this.qs(); return Object.hasOwn(this._ql.map, id) ? this._ql.map[id] : null; }
  reachedQ(q) {
    if (q.manual) return liveQuestion(this) === q.id || isClosed(this, q.id);   // round 2: a Rehearse poll counts as reached once the deck opened it
    const i = indexOfId(q.slide);
    return i >= 0 && this.core.reached.includes(i);
  }
  countsOf(q) {
    const c = this.pc[q.id];
    return Array.isArray(c) && c.length === q.options.length ? c : q.options.map(() => 0);
  }
  tallyOf(q) {
    if (q.type === "rows") {   // round 2 readiness: two distributions over the same five choices, stored as its parts
      const rows = q.rows.map((r) => { const p = this.qby(r.q); const c = p ? this.countsOf(p) : q.options.map(() => 0); return { key: r.key, label: r.label, counts: c, total: c.reduce((a, b) => a + b, 0), median: medianOf(c) }; });
      return { q: q.id, type: "rows", rows, total: Math.max(...rows.map((r) => r.total)), counts: rows[rows.length - 1].counts, options: q.options, closed: isClosed(this, q.id) };
    }
    const counts = this.countsOf(q);
    return { q: q.id, total: counts.reduce((a, b) => a + b, 0), counts, options: q.options, type: q.type, closed: isClosed(this, q.id) };
  }
  pollAllow(sid) {       // per session, fixed 60 s window, kept apart from the login limiter
    const now = Date.now();
    if (this.pollRl.size > 6000) this.pollRl.clear();
    let w = this.pollRl.get(sid);
    if (!w || now - w.t0 > 60000) { w = { t0: now, n: 0 }; this.pollRl.set(sid, w); }
    return ++w.n <= 40;
  }
  async answersOf(sid) {
    let a = this.pa.get(sid);
    if (a) return a;
    const got = (await this.ctx.storage.get("pa:" + sid)) || {};
    a = this.pa.get(sid);          // a concurrent request may have filled it while we waited
    if (a) return a;
    if (this.pa.size > 4000) this.pa.clear();
    this.pa.set(sid, got);
    return got;
  }
  // at most one "poll" frame per second to the whole room, carrying fresh counts for what changed
  pollKick(qid) {
    this.pollDirty.add(qid);
    for (const q of this.qs()) if (q.type === "rows" && q.rows.some((r) => r.q === qid)) this.pollDirty.add(q.id);   // round 2: a part changes its readiness bars
    if (this.pollTimer) return;
    const wait = Math.max(0, 1000 - (Date.now() - this.pollLast));
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null; this.pollLast = Date.now();
      const tallies = {};
      for (const id of this.pollDirty) if (this.qby(id)) tallies[id] = this.tallyOf(this.qby(id));
      this.pollDirty.clear();
      const frame = JSON.stringify({ t: "poll", tallies });
      for (const ws of this.ctx.getWebSockets()) { try { ws.send(frame); } catch { /* socket gone */ } }
    }, wait);
  }
  threadFor(role) {
    const slides = {}, hid = new Set(effective(this.core.plan).hidden);   // ---- v4 c: hidden slides are not listed
    for (let i = 0; i < N; i++) {
      const id = SCENES[i].id;
      if (hid.has(i)) continue;
      if (role !== "presenter" && !this.core.reached.includes(i)) continue;
      slides[i] = { id, card: CARDS[id] || null, questions: this.qs().filter((q) => q.slide === id).map((q) => (role === "presenter" ? q : (({ verdicts, ...r }) => r)(q))) };   // round 2: no Rehearse verdicts to the audience
    }
    return { n: N, slides, order: effective(this.core.plan).order.filter((k) => !hid.has(k)) };   // ---- v4 c
  }
  async pollRoute(name, req, role, sid) {
    if (name === "thread") {
      if (role === "presenter") return J(this.threadFor(role));
      // G10 scale: every phone asks for this at once when the slide changes; it is the same for all of them until the room moves
      const k = this.core.reached.join(",") + "|" + qVersion(this.core) + "|" + JSON.stringify(this.core.plan);
      if (!this._th || this._th.k !== k) this._th = { k, v: JSON.stringify(this.threadFor(role)) };
      return new Response(this._th.v, { headers: { "content-type": "application/json; charset=utf-8" } });
    }
    if (name === "tally") {
      const id = new URL(req.url).searchParams.get("q") || "";
      const q = this.qby(id);
      if (!q) return J({ error: "question" }, 400);
      if (role !== "presenter" && !this.reachedQ(q) && liveQuestion(this) !== q.id) return J({ error: "not yet" }, 403);
      return J(this.tallyOf(q));
    }
    if (name === "questions") return J({ qv: qVersion(this.core), saved: !!this.core.questions, questions: role === "presenter" ? this.qs() : this.qs().map(({ verdicts, ...q }) => q) });   // ---- v4 a17 q   // round 2: Rehearse verdicts (which reply is best) stay off audience pages; the deck reads them from move4
    if (name === "mine") {
      const out = { answers: role === "audience" ? { ...(await this.answersOf(sid)) } : {} };
      for (const k of Object.keys(out.answers)) {   // round 2: a rows poll is answered as {today, month}; its marker becomes the two rows
        if (!k.startsWith("rows:")) continue;
        const rq = this.qby(k.slice(5));
        delete out.answers[k];
        if (rq) out.answers[rq.id] = Object.fromEntries(rq.rows.map((r) => [r.key, Number.isInteger(out.answers[r.q]) ? out.answers[r.q] : null]));
      }
      if (role === "audience") {   // ---- v4 a17 q: this person's own open text answers
        const ids = this.qs().filter((q) => q.type === "text").map((q) => q.id);
        const got = ids.length ? await this.ctx.storage.get(ids.map((id) => "ot:" + id + ":" + sid)) : new Map();
        const texts = {};
        for (const id of ids) { const v = got.get("ot:" + id + ":" + sid); if (v && v.t) texts[id] = v.t; }
        if (Object.keys(texts).length) out.texts = texts;
      }
      return J(out);
    }
    if (name === "text") {   // ---- v4 a17 q: one short free text answer per person per question, a new one replaces the old
      if (role !== "audience") return J({ error: "audience only" }, 403);
      if (req.method !== "POST") return J({ error: "method" }, 405);
      const body = await readJson(req);
      const q = typeof body.q === "string" ? this.qby(body.q) : null;
      if (!q || q.type !== "text") return J({ error: "question" }, 400);
      const t = String(body.text == null ? "" : body.text).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 280);
      if (!t) return J({ error: "Type an answer first." }, 400);
      if (!this.reachedQ(q)) return J({ error: "not yet" }, 403);
      if (!this.pollAllow(sid)) return J({ error: "Too many taps. Wait a moment." }, 429);
      const who = this.acct.joinBody(sid);
      await this.ctx.storage.put("ot:" + q.id + ":" + sid, { t, ts: Math.floor(Date.now() / 1000), n: who ? who.first : "" });
      return J({ ok: true, q: q.id, text: t });
    }
    if (name === "texts") {   // ---- v4 a17 q: the open text answers for the admin, newest first, first names only
      if (role !== "presenter") return J({ error: "presenter only" }, 403);
      const out = [];
      for (const q of this.qs().filter((x) => x.type === "text")) {
        const rows = [...(await this.ctx.storage.list({ prefix: "ot:" + q.id + ":", limit: 1000 })).values()].sort((a, b) => b.ts - a.ts);
        out.push({ id: q.id, text: q.text, slide: q.slide, items: rows.map((r) => ({ n: r.n || "", t: r.t, ts: r.ts })) });
      }
      return J({ questions: out });
    }
    if (name === "answer") {
      if (role !== "audience") return J({ error: "audience only" }, 403);
      if (req.method !== "POST") return J({ error: "method" }, 405);
      const body = await readJson(req);
      const q = typeof body.q === "string" ? this.qby(body.q) : null;
      if (!q) return J({ error: "question" }, 400);
      if (q.type !== "poll" && q.type !== "choice" && q.type !== "rows") return J({ error: "question" }, 400);
      // round 2 readiness: a = {today, month} (or [today, month]); both rows in one submit, either can change until close
      const picks = q.type === "rows" ? q.rows.map((r, k) => (Array.isArray(body.a) ? body.a[k] : body.a && typeof body.a === "object" ? body.a[r.key] : undefined)) : [body.a];
      if (!picks.every((a) => Number.isInteger(a) && a >= 0 && a < q.options.length)) return J({ error: "answer" }, 400);
      const parts = q.type === "rows" ? q.rows.map((r) => this.qby(r.q)) : [q];
      if (!parts.every(Boolean)) return J({ error: "question" }, 400);
      if (!this.reachedQ(q) && liveQuestion(this) !== q.id) return J({ error: "not yet" }, 403);
      if (isClosed(this, q.id)) return J({ error: "closed", ...this.tallyOf(q) }, 409);   // round 2 polls: a closed poll keeps its bars and takes no answers
      if (!this.pollAllow(sid)) return J({ error: "Too many taps. Wait a moment." }, 429);
      const mine = await this.answersOf(sid);
      const sh0 = shiftOf(mine);       // from here to the put there is no await, so counters stay exact
      let changed = q.type === "rows" && mine["rows:" + q.id] !== 1;
      parts.forEach((p, k) => {
        const old = Object.hasOwn(mine, p.id) ? mine[p.id] : null;
        if (old === picks[k]) return;
        const c = this.countsOf(p).slice();
        if (old !== null && c[old] > 0) c[old] -= 1;
        c[picks[k]] += 1;
        this.pc[p.id] = c; mine[p.id] = picks[k]; changed = true;
      });
      if (q.type === "rows") mine["rows:" + q.id] = 1;   // marker: this phone sent the readiness screen (GET mine turns it into {today, month})
      if (changed) {
        const sh1 = shiftOf(mine);
        if (sh0 !== sh1) { if (sh0) this.shift[sh0] -= 1; if (sh1) this.shift[sh1] += 1; }
        await this.ctx.storage.put({ pc: this.pc, shift: this.shift, ["pa:" + sid]: mine });
        parts.forEach((p) => this.pollKick(p.id)); this.pollKick(q.id);
      }
      return J({ ok: true, q: q.id, a: body.a, ...this.tallyOf(q) });
    }
    return J({ error: "not found" }, 404);
  }

  // ---- Maisie routes
  async maisieRoute(name, req, role, sid, ip) {
    const m = this.maisie;
    const body = req.method === "POST" ? await readJson(req) : {};
    if (role === "presenter") {
      switch (name) {
        case "state": return J(m.state("presenter", sid));
        case "ask": return J(await m.ask(body));
        case "approve": return J(await m.approve(String(body.id || "")));
        case "dismiss": return J(await m.dismiss(String(body.id || "")));
        case "undo": return J(await m.undo(String(body.sceneId || "")));
        case "clear": return J(await m.clear());
        case "say": return J(await m.say(body));
        case "budget-reset": return J(await m.resetBudget());
        case "log": return J({ log: await m.readLog() });
        case "qlist": {
          const sp = new URL(req.url).searchParams, full = sp.get("full") === "1";
          const questions = m.boardList(!!body.all || sp.get("all") === "1").map((q) => {
            const o = { id: q.id, name: q.name, last: q.ln || "", optin: !!q.oi, text: q.text, slide: q.slide, ts: q.ts, status: q.status };
            if (full) o.email = q.em || "";
            return o;
          });
          return J({ questions, counts: m.boardCounts(), steer: m.mz.steer, live: m.liveChat, online: m.online(), calls: m.mz.calls, budget: m.budget, v: m.version("presenter"), registered: Object.keys(m.regs).length, picks: m.picks() });
        }
        case "qset": return J(await m.qset(String(body.id || ""), String(body.status || "")));
        case "qsteer": return J(await m.setSteer(body.text));
        case "livechat": return J(await m.setLive(body.on));
        case "callout": return J(await m.callout(body));
        case "qpick": return J(await m.pickBest());   // ---- v4 a17 q
        case "qdone": return J(await m.pickDone(String(body.id || "")));
        default: break;
      }
    }
    switch (name) {
      case "state": return J(m.state("audience", sid));
      case "join": {
        if (role !== "audience") return J({ error: "audience only" }, 403);
        // a whole room can sit behind one venue IP, so the per-IP ceiling is generous; the
        // per-session limit is what stops one device hammering the form
        if (!this.hit("join:" + ip, 800, 600) || !this.hit("joins:" + sid, 10, 600) || !this.hit("join:*", 1500, 600)) {
          return J({ error: "Too many tries. Wait a minute." }, 429);
        }
        const mine = this.acct.joinBody(sid);      // the account is the registration: no form, no second sign up
        if (!mine) return J({ error: "Sign in first." }, 401);
        const [st, out] = await m.join(sid, mine);
        return J(st === 200 ? { name: out.name, registered: !!out.registered } : out, st);
      }
      case "boardq": {   // ---- v4 a17 q: the Ask a question card on the phone; signs the person in to the board by their account
        if (role !== "audience") return J({ error: "audience only" }, 403);
        if (!this.hit("chat:" + ip, 300, 300)) return J({ error: "rate", reply: "That is a lot of questions at once. Give it a minute." }, 429);
        if (!m.atts[sid]) {
          if (!this.hit("joins:" + sid, 10, 600)) return J({ error: "Too many tries. Wait a minute." }, 429);
          const mine = this.acct.joinBody(sid);
          if (!mine) return J({ error: "Sign in first." }, 401);
          const [js, jout] = await m.join(sid, mine);
          if (js !== 200) return J(jout, js);
        }
        const [st, out] = await m.boardAsk(sid, body.text);
        return J(out, st);
      }
      case "chat": {
        if (role !== "audience") return J({ error: "audience only" }, 403);
        if (!this.hit("chat:" + ip, 300, 300)) return J({ error: "rate", reply: "You are sending messages faster than I can think. Give me a minute." }, 429);
        const [st, out] = await m.chat(sid, body.text);
        return J(out, st);
      }
      case "inbox": {
        if (role !== "audience") return J({ error: "audience only" }, 403);
        const [st, out] = await m.inbox(sid, new URL(req.url).searchParams.get("since") || "");
        return J(out, st);
      }
      default: return J({ error: "not found" }, 404);
    }
  }

  // ---- entry
  async fetch(req) {
    const url = new URL(req.url), p = url.pathname;
    const role = req.headers.get("x-role") || "", sid = req.headers.get("x-sid") || "", ip = req.headers.get("x-ip") || "unknown";
    const by = (req.headers.get("x-cid") || "").slice(0, 24);

    if (p === "/do/rl" && req.method === "POST") return this.rate(await readJson(req));
    if (p === "/do/auth/join" && req.method === "POST") return this.acct.join(await readJson(req), ip);
    if (p === "/do/signedin") return J({ n: this.acct.a.size });   // v3 today: a count, no identities
    if (p === "/do/pub") return J({ slide: this.core.slide, fx: this.core.fx, ver: this.core.cver, cp: this.copy.overrides() });   // cp: G9, internal to the Worker, which applies only what each page carries

    if (role !== "presenter" && role !== "audience") return J({ error: "unauthorized" }, 401);

    if (p === "/do/ws") {
      if (req.headers.get("upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
      // G10 scale: after a wifi blip a phone opens a new socket while the old one is still half open here. Keep the newest
      // PER_PERSON sockets of a session (phone, laptop, a second tab) and close the older ones, so stale sockets never fill the room.
      const tag = "s:" + sid.slice(0, 20), now = Date.now();
      const same = role === "audience" ? this.ctx.getWebSockets(tag) : [];   // presenter screens of one login share an id; never closed here
      if (same.length >= PER_PERSON) {
        const at = (w) => { try { return (w.deserializeAttachment() || {}).at || 0; } catch { return 0; } };
        for (const old of same.sort((a, b) => at(a) - at(b)).slice(0, same.length - PER_PERSON + 1)) { try { old.close(4000, "replaced"); } catch { /* gone */ } }
      }
      if (this.ctx.getWebSockets().length >= MAX_SOCKETS) return new Response("room is full", { status: 503 });
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server, [role, tag]);
      try { server.serializeAttachment({ at: now }); } catch { /* best effort */ }
      server.send(JSON.stringify({ t: "state", s: this.stateFor(role) }));
      return new Response(null, { status: 101, webSocket: client });
    }
    if (p === "/do/state") {
      if (role === "audience" && sid && this.pollers.size < 5000) this.pollers.set("s:" + sid.slice(0, 20), Date.now());
      if (req.method === "POST") {   // G10 scale: the phones a Worker isolate answered from its shared read since the last one (src/scale.js)
        try { const t = await req.text(); const seen = t.length < 200000 ? JSON.parse(t).seen : null;
          if (Array.isArray(seen)) { const n = Date.now(); for (const x of seen) if (typeof x === "string" && this.pollers.size < 5000) this.pollers.set("s:" + x.slice(0, 20), n); } } catch { /* ignore */ }
      }
      return J(this.stateFor(role));
    }
    if (p === "/do/plan") return J({ plan: effective(this.core.plan), saved: !!this.core.plan, ver: this.core.cver });   // ---- v4 c: public read of the effective list
    if (p === "/do/remote") return role === "presenter" ? J(this.remoteView()) : J({ error: "presenter only" }, 403);
    if (p === "/do/content") {
      const content = role === "presenter" ? presenterContent() : audienceContent(this.core.reached, this.core.done, effective(this.core.plan));
      return J({ ...content, ver: this.core.cver });
    }
    if (p === "/do/questions.csv") return role === "presenter" ? this.questionsCsv() : J({ error: "forbidden" }, 403);
    if (p === "/do/registrants.csv") return role === "presenter" ? this.registrantsCsv() : J({ error: "forbidden" }, 403);
    if (p.startsWith("/do/exp/")) return this.wall.route(p.slice(8), req, role, sid);   // v3 wall
    if (p.startsWith("/do/acct/")) return this.acct.route(p.slice("/do/acct/".length), req, role, sid);
    if (p.startsWith("/do/poll/")) return this.pollRoute(p.slice("/do/poll/".length), req, role, sid);
    if (p.startsWith("/do/copy/")) return this.copy.route(p.slice("/do/copy/".length), req, role, by);   // G9 editable copy
    if (p.startsWith("/do/maisie/")) return this.maisieRoute(p.slice("/do/maisie/".length), req, role, sid, ip);
    if (p.startsWith("/do/ctl/")) {
      if (role !== "presenter") return J({ error: "presenter only" }, 403);
      if (req.method !== "POST") return J({ error: "method" }, 405);
      return this.ctl(p.slice("/do/ctl/".length), await readJson(req), by);
    }
    return J({ error: "not found" }, 404);
  }

  // ---- hibernating WebSocket handlers
  webSocketMessage(ws, msg) {
    if (typeof msg !== "string" || msg.length > 256) return;
    if (msg === "state") { try { ws.send(JSON.stringify({ t: "state", s: this.stateFor(this.ctx.getTags(ws)[0] || "audience") })); } catch { /* gone */ } }
  }
  webSocketClose(ws, code) { try { ws.close(code, "bye"); } catch { /* already closed */ } }
  webSocketError(ws) { try { ws.close(1011, "error"); } catch { /* already closed */ } }

  async alarm() {
    try { await this.maisie.proactive(); } catch { /* proactive pop-ups are best effort */ }
  }
}

async function readJson(req) {
  try {
    const t = await req.text();
    if (t.length > 8192) return {};
    const v = JSON.parse(t || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}
