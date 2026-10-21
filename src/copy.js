// G9 editable copy: Aran (and Maisie, his assistant, with a key) can change the wording and the size of slide text
// without a rebuild or a deploy. Three parts, like wall.js:
//   applyCopy()  pure: puts the overrides onto scene data on its way out of the Worker. It touches only the scenes a
//                response already carries, so an audience frame (current scene only) can never carry another slide's text.
//   copyApi()    runs in the Worker: /api/copy/*, presenter cookie or the Maisie bearer key, origin and body checks.
//   Copy         runs inside the Event Durable Object: validation, the versioned history, storage (keys "copy:*").
// Any failure on the way out falls back to the shipped copy: the keynote never depends on this file working.
import COPY from "./generated/copy.json";
import HELP from "./generated/copyhelp.js";
import { splitKey, getPath, setPath, labelOf } from "./copykeys.js";
import { secretEquals } from "./auth.js";
import { SCENES } from "./deckdata.js";

export const SIZE_MIN = 0.6, SIZE_MAX = 1.6;
const HIST_MAX = 300;          // versions kept; the oldest go first
const BODY_MAX = 32768;        // a batch of edits from Maisie
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json; charset=utf-8" } });
const SHIPPED = COPY.keys;
const SCENE_OF = Object.fromEntries(COPY.scenes.map((s) => [s.id, s]));

// ---------------------------------------------------------------- applying (Worker, on every page that carries scenes)
// scenes: the array a response is about to send. ov: { key: { text?, size? } } from the Event object.
// Returns a new array; scenes without overrides are passed through untouched, the shared SCENES is never changed.
export function applyCopy(scenes, ov) {
  try {
    if (!ov || typeof ov !== "object" || !Array.isArray(scenes)) return scenes;
    const byScene = {};
    for (const [key, o] of Object.entries(ov)) {
      if (!(key in SHIPPED) || !o || typeof o !== "object") continue;   // unknown key (slide removed since the edit): ignored
      const k = splitKey(key); if (!k) continue;
      (byScene[k.id] = byScene[k.id] || []).push([k.path, o]);
    }
    if (!Object.keys(byScene).length) return scenes;
    return scenes.map((s) => {
      const list = s && byScene[s.id];
      if (!list) return s;
      try {
        const c = JSON.parse(JSON.stringify(s));
        for (const [path, o] of list) {
          if (typeof getPath(c, path) !== "string") continue;           // not in what this response carries: nothing to apply
          if (typeof o.text === "string") setPath(c, path, o.text);   // "" is a real override: the line is blanked
          if (typeof o.size === "number" && o.size !== 1) (c.__cs = c.__cs || {})[path.join(".")] = o.size;
        }
        return c;
      } catch { return s; }
    });
  } catch { return scenes; }
}

// Rehearse picks: on a talk entry that carries a pick, talk[i].line is the same words as the option whose verdict is
// "best". An edit to either one is mirrored to the other, so the projector line and the phone button never disagree.
export function partnerOf(key) {
  const k = splitKey(key); if (!k) return null;
  const sc = SCENES.find((x) => x.id === k.id); if (!sc || !Array.isArray(sc.talk)) return null;
  const p = k.path.join(".");
  let m = /^talk\.(\d+)\.line$/.exec(p);
  if (m) {
    const t = sc.talk[+m[1]], opts = t && t.pick && Array.isArray(t.pick.options) ? t.pick.options : [];
    const b = opts.findIndex((o) => o && o.verdict === "best");
    return b >= 0 ? `${k.id}.talk.${m[1]}.pick.options.${b}.line` : null;
  }
  m = /^talk\.(\d+)\.pick\.options\.(\d+)\.line$/.exec(p);
  if (m) {
    const t = sc.talk[+m[1]], o = t && t.pick && t.pick.options && t.pick.options[+m[2]];
    return o && o.verdict === "best" ? `${k.id}.talk.${m[1]}.line` : null;
  }
  return null;
}
const withPartners = (edits) => {
  const out = edits.slice(), seen = new Set(edits.map((e) => String((e && e.key) || "")));
  for (const e of edits) {
    const q = e && partnerOf(String(e.key || ""));
    if (q && q in SHIPPED && !seen.has(q)) { seen.add(q); out.push({ key: q, ...(e.text != null ? { text: e.text } : {}), ...(e.size != null ? { size: e.size } : {}) }); }
  }
  return out;
};

// ---------------------------------------------------------------- cleaning
const cleanText = (v) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ").replace(/[<>]/g, "")
  .replace(/\s+/g, " ").trim();
const maxLen = (key) => Math.min(1200, Math.max(300, 3 * String(SHIPPED[key] || "").length));
const cleanSize = (v) => { const n = Number(v); if (!isFinite(n)) return null; return Math.round(Math.max(SIZE_MIN, Math.min(SIZE_MAX, n)) * 20) / 20; };

// ---------------------------------------------------------------- the Durable Object side
export class Copy {
  constructor(h) {
    this.h = h;                         // the Event object
    this.v = 0;                         // current version; 0 = shipped copy, nothing changed
    this.ov = {};                       // key -> { text?, size?, ship, at, by }
    this.sv = {};                       // scene id -> version of its last change (the audience frame reloads on it)
    this.hist = [];                     // [{ v, at, by, op, changes:[{key, before, after}], snap }], oldest first
  }
  get storage() { return this.h.ctx.storage; }
  async load() {
    try {
      const cur = await this.storage.get("copy:cur");
      if (cur && typeof cur === "object") { this.v = cur.v | 0; this.ov = cur.ov || {}; this.sv = cur.sv || {}; }
      const all = await this.storage.list({ prefix: "copy:h:", limit: HIST_MAX + 50 });
      this.hist = [...all.values()].filter((x) => x && typeof x === "object").sort((a, b) => a.v - b.v);
    } catch { this.v = 0; this.ov = {}; this.sv = {}; this.hist = []; }   // unreadable storage: shipped copy
  }
  // the internal handoff to the Worker: every override (the Worker applies only what each response carries)
  overrides() { const o = {}; for (const [k, x] of Object.entries(this.ov)) if (k in SHIPPED) o[k] = { text: x.text, size: x.size }; return o; }
  // one scene as the room sees it now, Aran's wording applied (for server code that derives things from scene text, such as
  // the three Rehearse polls built from move4.talk). Read it when you need it, do not cache it: this.v changes on every edit.
  scene(id) { const s = SCENES.find((x) => x.id === id); return s ? applyCopy([s], this.overrides())[0] : null; }
  // the version of one scene's copy: the audience shell reloads its frame when the slide on screen changes copy
  sceneVer(i) { const s = COPY.scenes[i]; return s ? this.sv[s.id] || 0 : 0; }

  eff(key) { const o = this.ov[key]; return { text: o && typeof o.text === "string" ? o.text : SHIPPED[key], size: o && o.size ? o.size : 1 }; }
  view(sceneId) {
    const keys = [];
    for (const [key, ship] of Object.entries(SHIPPED)) {
      const k = splitKey(key); if (sceneId && k.id !== sceneId) continue;
      const o = this.ov[key], e = this.eff(key), sc = SCENE_OF[k.id];
      keys.push({ key, scene: k.id, slide: sc.i + 1, label: labelOf(k.path), shipped: ship, text: e.text, size: e.size,
        changed: !!o, stale: !!(o && typeof o.ship === "string" && o.ship !== ship), by: o ? o.by : "", at: o ? o.at : 0 });
    }
    const orphans = Object.keys(this.ov).filter((k) => !(k in SHIPPED)).map((k) => ({ key: k, text: this.ov[k].text || "" }));
    return { v: this.v, changed: Object.keys(this.ov).filter((k) => k in SHIPPED).length, stale: keys.filter((x) => x.stale).length,
      slides: COPY.scenes.map((s) => ({ id: s.id, slide: s.i + 1, title: s.title, hidden: s.hidden })), keys, orphans };
  }
  history() {
    return { v: this.v, versions: this.hist.slice().reverse().map((x) => ({ v: x.v, at: x.at, by: x.by, op: x.op, changes: x.changes })) };
  }

  async commit(op, by, next, changes) {
    if (!changes.length) return J({ ok: true, v: this.v, changed: [] });
    const v = this.v + 1, at = Date.now();
    for (const c of changes) { const k = splitKey(c.key); if (k) this.sv[k.id] = v; }
    this.v = v; this.ov = next;
    const entry = { v, at, by, op, changes, snap: next };
    this.hist.push(entry);
    const drop = this.hist.length > HIST_MAX ? this.hist.splice(0, this.hist.length - HIST_MAX) : [];
    const put = { "copy:cur": { v, ov: next, sv: this.sv }, ["copy:h:" + String(v).padStart(8, "0")]: entry };
    await this.storage.put(put);
    if (drop.length) await this.storage.delete(drop.map((x) => "copy:h:" + String(x.v).padStart(8, "0")));
    // round 2: an edit to the move4 wording changes the Rehearse reply buttons, so the poll list version phones watch moves too
    if ((this.sv.move4 || 0) !== (this.h.core.m4v || 0)) { this.h.core.m4v = this.sv.move4 || 0; try { await this.h.saveCore(); } catch { /* next save keeps it */ } }
    try { this.h.broadcast("copy"); } catch { /* the room picks it up on its next state */ }
    return J({ ok: true, v, changed: changes.map((c) => c.key) });
  }
  snapOf(key, ov) { const o = ov[key]; return o ? { text: o.text, size: o.size || 1 } : null; }

  // edits: [{ key, text?, size?, base? }]. All or nothing: one bad edit and nothing changes.
  async set(edits, by) {
    if (!Array.isArray(edits) || !edits.length || edits.length > 200) return J({ error: "send edits: a list of 1 to 200 { key, text, size }" }, 400);
    const next = JSON.parse(JSON.stringify(this.ov)), changes = [], at = Date.now();
    edits = withPartners(edits);
    for (const e of edits) {
      const key = String((e && e.key) || "");
      if (!(key in SHIPPED)) return J({ error: "unknown key", key }, 400);
      const cur = next[key] ? { ...next[key] } : null, before = this.snapOf(key, next);
      let text = cur && typeof cur.text === "string" ? cur.text : undefined, size = cur && cur.size ? cur.size : 1;
      if (e.base != null && cleanText(e.base) !== cleanText(text != null ? text : SHIPPED[key]))
        return J({ error: "changed since you read it", key, text: text != null ? text : SHIPPED[key] }, 409);
      if (e.text != null) {
        const t = cleanText(e.text);
        if (t.length > maxLen(key)) return J({ error: "too long", key, max: maxLen(key) }, 400);
        text = t === SHIPPED[key] ? undefined : t;   // "" is kept as a real override (a blanked line), distinct from not set
      }
      if (e.size != null) { const s = cleanSize(e.size); if (s == null) return J({ error: "size must be a number from " + SIZE_MIN + " to " + SIZE_MAX, key }, 400); size = s; }
      if (text === undefined && size === 1) delete next[key];
      else next[key] = { ...(text !== undefined ? { text } : {}), ...(size !== 1 ? { size } : {}), ship: SHIPPED[key], at, by };
      const after = this.snapOf(key, next);
      if (JSON.stringify(before) !== JSON.stringify(after)) changes.push({ key, before, after });
    }
    return this.commit(edits.length > 1 ? "batch" : "set", by, next, changes);
  }
  async reset(body, by) {
    const next = JSON.parse(JSON.stringify(this.ov));
    const keys = body.all === true ? Object.keys(next) : [String(body.key || "")];
    if (body.all !== true) { const q = partnerOf(keys[0]); if (q && q in next) keys.push(q); }
    if (body.all !== true && !keys.some((k) => k in next)) return J(keys[0] in SHIPPED ? { ok: true, v: this.v, changed: [] } : { error: "unknown key" }, keys[0] in SHIPPED ? 200 : 400);
    const changes = keys.filter((key) => key in next).map((key) => ({ key, before: this.snapOf(key, next), after: null }));
    keys.forEach((k) => delete next[k]);
    return this.commit(body.all === true ? "reset-all" : "reset", by, next, changes);
  }
  async restore(body, by) {
    const v = Number(body.v);
    const target = v === 0 ? { snap: {} } : this.hist.find((x) => x.v === v);
    if (!target) return J({ error: "no such version", v }, 404);
    const next = JSON.parse(JSON.stringify(target.snap || {}));
    const keys = new Set([...Object.keys(this.ov), ...Object.keys(next)]), changes = [];
    for (const key of keys) { const b = this.snapOf(key, this.ov), a = this.snapOf(key, next); if (JSON.stringify(a) !== JSON.stringify(b)) changes.push({ key, before: b, after: a }); }
    return this.commit("restore " + v, by, next, changes);
  }

  // /do/copy/<name>. The Worker has already checked who is asking; only the presenter role gets here.
  async route(name, req, role, by) {
    if (role !== "presenter") return J({ error: "presenter only" }, 403);
    const who = by === "maisie" ? "maisie" : "aran";
    if (req.method === "GET") {
      const u = new URL(req.url);
      if (name === "" || name === "keys") return J(this.view(u.searchParams.get("scene") || ""));
      if (name === "history") return J(this.history());
      if (name === "live") { const since = Number(u.searchParams.get("since")); return J(since === this.v ? { v: this.v, same: true } : { v: this.v, ov: this.overrides(), ...(u.searchParams.get("ship") === "1" ? { ship: SHIPPED } : {}) }); }
      return J({ error: "not found" }, 404);
    }
    if (req.method !== "POST") return J({ error: "method" }, 405);
    let body = {};
    try { const t = await req.text(); body = JSON.parse(t || "{}") || {}; } catch { return J({ error: "bad json" }, 400); }
    if (typeof body !== "object" || Array.isArray(body)) return J({ error: "bad json" }, 400);
    if (name === "set") return this.set(Array.isArray(body.edits) ? body.edits : [body], who);
    if (name === "reset") return this.reset(body, who);
    if (name === "restore") return this.restore(body, who);
    return J({ error: "not found" }, 404);
  }
}

// ---------------------------------------------------------------- the Worker side
// The key Maisie sends as "Authorization: Bearer <key>": COPY_TOKEN when it is set, otherwise derived from SESSION_SECRET.
export async function copyToken(env) {
  const set = String(env.COPY_TOKEN || "").trim();
  if (set) return set;
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(String(env.SESSION_SECRET || "")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const b = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode("copy-editor-v1")));
  return "cpy_" + btoa(String.fromCharCode(...b)).replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
}

export async function copyApi(req, env, url, sess, h) {
  const path = url.pathname;
  if (path !== "/api/copy" && !path.startsWith("/api/copy/")) return null;
  const { json, toEvent, sameOrigin, ipOf } = h;
  const method = req.method === "HEAD" ? "GET" : req.method;
  const name = path === "/api/copy" ? "" : path.slice(10);
  if (!/^[a-z]{0,12}$/.test(name)) return json({ error: "not found" }, req, 404);
  const ip = ipOf(req);

  // who: the presenter cookie, or Maisie's bearer key. An audience session never gets in.
  let who = "";
  const auth = req.headers.get("authorization") || "";
  if (/^Bearer\s+/i.test(auth)) {
    const rl = await (await toEvent(env, "/do/rl", { method: "POST", ip, body: JSON.stringify({ op: "check", key: "cpy:" + ip, limit: 10, win: 600 }) })).json();
    if (rl.blocked) return json({ error: "too many bad keys, wait " + Math.ceil((rl.retry || 60) / 60) + " minutes" }, req, 429);
    if (!(await secretEquals(auth.replace(/^Bearer\s+/i, "").trim(), await copyToken(env)))) {
      await toEvent(env, "/do/rl", { method: "POST", ip, body: JSON.stringify({ op: "fail", key: "cpy:" + ip, limit: 10, win: 600 }) });
      return json({ error: "bad key" }, req, 401);
    }
    who = "maisie";
  } else {
    if (!sess) return json({ error: "login required" }, req, 401);
    if (sess.role !== "presenter" || sess.aud) return json({ error: "presenter only" }, req, 403);
    if (method === "POST" && !sameOrigin(req)) return json({ error: "bad origin" }, req, 403);
    who = "aran";
  }

  // EDITOR_MODE = "repo": the words live in the repo, so every write through here is refused (the editor and Maisie's key alike). Default "live".
  const repoMode = String(env.EDITOR_MODE || "live").toLowerCase() === "repo";
  if (repoMode && method === "POST" && (name === "set" || name === "reset" || name === "restore")) return json({ error: "edit in the repo", mode: "repo" }, req, 409);

  if (name === "help" && method === "GET") return h.secure(new Response(HELP, { status: 200, headers: { "content-type": "text/markdown; charset=utf-8" } }), req);
  if (name === "token" && method === "GET") {
    if (who !== "aran") return json({ error: "presenter only" }, req, 403);   // Maisie's key is shown to Aran, never to the key holder
    return json({ token: await copyToken(env), help: "/api/copy/help", custom: !!String(env.COPY_TOKEN || "").trim() }, req);
  }
  let body;
  if (method === "POST") {
    const t = await req.text();
    if (t.length > BODY_MAX) return json({ error: "too large" }, req, 413);
    body = t;
  } else if (method !== "GET") return json({ error: "method" }, req, 405);
  const r = await toEvent(env, "/do/copy/" + name + url.search, { method, body, sess: { role: "presenter", sid: who }, ip, cid: who });
  if (repoMode && method === "GET" && (name === "" || name === "keys") && r.status === 200) {   // the editor reads this to show its read only note
    const txt = await r.text();
    let out = txt;
    try { out = JSON.stringify({ ...JSON.parse(txt), mode: "repo" }); } catch { /* the plain answer */ }
    return h.secure(new Response(out, { status: 200, headers: { "content-type": "application/json; charset=utf-8" } }), req);
  }
  return h.secure(new Response(r.body, { status: r.status, headers: { "content-type": "application/json; charset=utf-8" } }), req);
}
