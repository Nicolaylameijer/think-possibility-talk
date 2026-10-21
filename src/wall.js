// v3 wall: the experiment wall on the "One experiment. Not a program." slide.
// Each signed in audience account may send ONE short experiment: what I will test, what I will check,
// who I will tell. A new send from the same account replaces the old one. The slide shows the cards
// only: text, never an email, name or account id. Two halves in one file, like accounts.js:
//   wallApi()  runs in the Worker: routing, origin and role checks, body size.
//   Wall       runs inside the Event Durable Object: validation, storage, the wall view, the broadcast.
import { indexOfId } from "./deckdata.js";

const FIELD_MAX = 80;        // characters per box
const WALL_MAX = 60;         // cards the wall endpoint returns
const BODY_MAX = 1024;
const KEYS = ["test", "check", "tell"];
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

// strip markup and control characters, collapse spaces, cap the length
export const cleanField = (v) => String(v == null ? "" : v)
  .replace(/<[^>]*>?/g, " ").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, FIELD_MAX);

const newId = () => { const b = new Uint8Array(6); crypto.getRandomValues(b); return Array.from(b, (x) => x.toString(36).padStart(2, "0")).join("").slice(0, 8); };

export class Wall {
  constructor(h) {
    this.h = h;                 // the Event object
    this.m = new Map();         // account id -> { id, test, check, tell, t, hide }
    this.last = 0; this.timer = null;
  }
  get storage() { return this.h.ctx.storage; }
  async load() {
    const all = await this.storage.list({ prefix: "exp:", limit: 5000 });
    for (const [k, v] of all) if (v && typeof v === "object") this.m.set(k.slice(4), v);
  }
  visible() { return [...this.m.values()].filter((r) => !r.hide); }
  count() { return this.visible().length; }
  // the public shape of a card: never anything that names the sender
  card(r) { return { id: r.id, test: r.test, check: r.check, tell: r.tell, t: r.t }; }
  view(all) {
    const rows = [...this.m.values()].filter((r) => all || !r.hide).sort((a, b) => b.t - a.t);
    const cards = rows.slice(0, WALL_MAX).map((r) => (all && r.hide ? { ...this.card(r), hidden: true } : this.card(r)));
    return { n: this.count(), cards };
  }
  // tell every phone and screen that the wall changed (one frame a second at most)
  kick() {
    if (this.timer) return;
    const wait = Math.max(0, 1000 - (Date.now() - this.last));
    this.timer = setTimeout(() => {
      this.timer = null; this.last = Date.now();
      const frame = JSON.stringify({ t: "poll", tallies: {}, wall: this.count() });
      for (const ws of this.h.ctx.getWebSockets()) { try { ws.send(frame); } catch { /* socket gone */ } }
    }, wait);
  }
  reached() { const i = indexOfId("thisweek"); return i >= 0 && this.h.core.reached.includes(i); }

  async put(sid, body) {
    if (!sid || !this.h.acct.a.has(sid)) return J({ error: "Sign in first." }, 401);
    if (!body || typeof body !== "object" || Array.isArray(body)) return J({ error: "bad request" }, 400);
    const f = {};
    for (const k of KEYS) {
      const v = body[k];
      if (v != null && typeof v !== "string") return J({ error: "Text only." }, 400);
      f[k] = cleanField(v);
    }
    if (!f.test && !f.check && !f.tell) return J({ error: "Write at least one box." }, 400);
    if (!this.h.hit("exp:" + sid, 12, 60) || !this.h.hit("exp:*", 1500, 60)) return J({ error: "Too many tries. Wait a minute." }, 429);
    const old = this.m.get(sid);
    if (!old && this.m.size >= 5000) return J({ error: "The wall is full." }, 503);
    const rec = { id: old ? old.id : newId(), ...f, t: Date.now(), hide: old ? !!old.hide : false };
    this.m.set(sid, rec);
    await this.storage.put("exp:" + sid, rec);
    this.kick();
    return J({ ok: true, mine: { test: rec.test, check: rec.check, tell: rec.tell } });
  }
  mine(sid) {
    const r = this.m.get(sid);
    return J({ mine: r ? { test: r.test, check: r.check, tell: r.tell } : null });
  }
  async hide(body) {
    const id = typeof body.id === "string" ? body.id.slice(0, 16) : "";
    if (!id) return J({ error: "id" }, 400);
    for (const [sid, r] of this.m) {
      if (r.id !== id) continue;
      r.hide = body.hide !== false;
      await this.storage.put("exp:" + sid, r);
      this.kick();
      return J({ ok: true, hidden: r.hide, n: this.count() });
    }
    return J({ error: "not found" }, 404);
  }

  async route(name, req, role, sid) {
    const url = new URL(req.url);
    if (name === "wall" && req.method === "GET") {
      if (role !== "presenter" && !this.reached()) return J({ error: "not yet" }, 403);
      return J(this.view(role === "presenter" && url.searchParams.get("all") === "1"));
    }
    if (name === "mine" && req.method === "GET") {
      if (role !== "audience") return J({ mine: null });
      return this.mine(sid);
    }
    if (name === "put" && req.method === "PUT") {
      if (role !== "audience") return J({ error: "audience only" }, 403);
      let body = {}; try { const t = await req.text(); body = t.length > BODY_MAX ? null : JSON.parse(t); } catch { body = null; }
      return this.put(sid, body);
    }
    if (name === "hide" && req.method === "POST") {
      if (role !== "presenter") return J({ error: "presenter only" }, 403);
      let body = {}; try { body = JSON.parse(await req.text()) || {}; } catch { /* empty */ }
      return this.hide(body);
    }
    return J({ error: "not found" }, 404);
  }
}

// The Worker half. Returns a Response for the paths it owns, null for everything else.
export async function wallApi(req, env, url, sess, isP, H) {
  const path = url.pathname, method = req.method;
  if (path !== "/api/exp" && path !== "/api/exp/mine" && path !== "/api/exp/wall" && path !== "/api/ctl/exp/hide") return null;
  const { json, toEvent, readBody, sameOrigin, ipOf } = H;
  if (!sess) return json({ error: "login required" }, req, 401);
  const ip = ipOf(req);
  const relay = async (to, opts) => {
    const r = await toEvent(env, to, { ...opts, sess, ip });
    return new Response(r.body, { status: r.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  };
  if (path === "/api/exp" && method === "PUT") {
    if (isP) return json({ error: "audience only" }, req, 403);
    if (!sameOrigin(req)) return json({ error: "bad origin" }, req, 403);
    const t = await readBody(req);
    if (t == null || t.length > BODY_MAX) return json({ error: "too large" }, req, 413);
    return relay("/do/exp/put", { method: "PUT", body: t });
  }
  if (path === "/api/exp/mine" && method === "GET") return relay("/do/exp/mine");
  if (path === "/api/exp/wall" && method === "GET") return relay("/do/exp/wall" + (isP && url.searchParams.get("all") === "1" ? "?all=1" : ""));
  if (path === "/api/ctl/exp/hide" && method === "POST") {
    if (!isP) return json({ error: "presenter only" }, req, 403);
    if (!sameOrigin(req)) return json({ error: "bad origin" }, req, 403);
    const t = await readBody(req);
    if (t == null) return json({ error: "too large" }, req, 413);
    return relay("/do/exp/hide", { method: "POST", body: t });
  }
  return json({ error: "method" }, req, 405);
}
