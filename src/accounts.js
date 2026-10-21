// Accounts: first name, last name and email. No PIN. Two halves in one file.
//   accountsApi()  runs in the Worker. It validates input and signs the cookie.
//   Accounts       runs inside the Event Durable Object. It owns the account records, the sign ups
//                  open/closed switch, and the presenter views of accounts.
// The email is the identity: the same email on any device returns to the same account. That means anyone who
// knows an email address can sign in as it. The audience link carries a code that unlocks the form, but the
// open sign in on the main address stays open for the projected QR.
// Nothing here logs an email, and no response ever carries more than the person's own details.
import { b64u, makeToken, setCookie, audienceCode, secretEquals } from "./auth.js";
import { Profile } from "./profile.js";
import { Finale } from "./finale.js";

const enc = new TextEncoder();
const IP_NEW = 3000, IP_WIN = 600;                   // new accounts per IP per 10 min (a whole room shares one venue IP: G10 measured 600 locking out phone 601 of 1000)
const BODY_MAX = 2048;
const EMAIL_RE = /^[a-z0-9._%+'-]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,24}$/;
const ID_RE = /^[A-Za-z0-9_-]{22}$/;

export const cleanEmail = (v) => {
  if (typeof v !== "string") return "";
  const e = v.trim().toLowerCase();
  return e.length <= 254 && EMAIL_RE.test(e) ? e : "";
};
export const cleanText = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export async function accountId(email) {
  return b64u(await crypto.subtle.digest("SHA-256", enc.encode(email))).slice(0, 22);
}
// ============================================================ Worker side
// Returns a Response for the account routes, or null when the path is not one of them.
// H = { json, toEvent, eventJson, readBody, sameOrigin, ipOf }  (the Worker's own helpers)
export async function accountsApi(req, env, url, sess, H) {
  const path = url.pathname, method = req.method === "HEAD" ? "GET" : req.method;
  const ip = H.ipOf(req);
  const isA = !!sess && sess.role === "audience", isP = !!sess && sess.role === "presenter";
  const bad = (status = 400) => H.json({ error: "bad" }, req, status);
  const body = async () => {
    const t = await H.readBody(req);
    if (t == null || t.length > BODY_MAX) return null;
    try { const v = JSON.parse(t || "{}"); return v && typeof v === "object" && !Array.isArray(v) ? v : null; } catch { return null; }
  };
  const viaDo = async (doPath, opts = {}) => {
    const r = await H.toEvent(env, doPath, { sess, ip, ...opts });
    return H.json(await r.json(), req, r.status);
  };

  // ---- sign in (open to everyone) and the cookie: first name, last name, email
  if (path === "/api/auth" && method === "POST") {
    if (!H.sameOrigin(req)) return H.json({ error: "bad origin" }, req, 403);
    const b = await body();
    if (!b) return bad();
    if (typeof b.first !== "string" || typeof b.last !== "string") return bad();
    const email = cleanEmail(b.email), first = cleanText(b.first, 40), last = cleanText(b.last, 40);
    if (!email || !first || !last) return bad();
    // the audience link carries a code. It is checked when sent; the open sign in on the main address sends none.
    if (b.code != null && !(await secretEquals(String(b.code), await audienceCode(env)))) return H.json({ error: "code" }, req, 403);
    const id = await accountId(email);
    const cm = await H.toEvent(env, "/do/auth/join", { method: "POST", ip, body: JSON.stringify({ id, email, first, last, agency: cleanText(b.agency, 80), optin: typeof b.optin === "boolean" ? b.optin : null }) });
    const out = await cm.json();
    if (cm.status !== 200) return H.json(out, req, cm.status);
    const token = await makeToken(env.SESSION_SECRET, "audience", id);
    return H.json(out, req, 200, { "set-cookie": setCookie("audience", token, url.protocol === "https:") });
  }

  // ---- account owner routes
  if (path === "/api/me" || path === "/api/profile" || path === "/api/notes" || path === "/api/kept" || path === "/api/decision") {
    if (!sess) return H.json({ error: "login required" }, req, 401);
    if (!isA) return H.json({ error: "audience only" }, req, 403);
    const want = { "/api/me": "GET", "/api/profile": "POST" }[path] || "PUT";
    if (method !== want) return H.json({ error: "method" }, req, 405);
    if (method !== "GET" && !H.sameOrigin(req)) return H.json({ error: "bad origin" }, req, 403);
    if (path === "/api/me") return viaDo("/do/acct/me");
    const b = await body();
    if (!b) return bad();
    const name = { "/api/profile": "profile", "/api/notes": "note", "/api/kept": "kept", "/api/decision": "decision" }[path];
    return viaDo("/do/acct/" + name, { method: "POST", body: JSON.stringify(b) });
  }

  // ---- presenter reads (the POST controls travel the existing /api/ctl/ route)
  if (method === "GET" && (path === "/api/ctl/accounts" || path === "/api/ctl/notes" || path === "/api/ctl/room")) {
    if (!sess) return H.json({ error: "login required" }, req, 401);
    if (!isP) return H.json({ error: "presenter only" }, req, 403);
    return viaDo("/do/acct/" + { "/api/ctl/accounts": "accounts", "/api/ctl/notes": "sharednotes", "/api/ctl/room": "room" }[path]);
  }
  // v3 today: the sign up count for the countdown on the ladder slide. A number only, no identities, open to the phone and the projector, cached 1 s.
  if (method === "GET" && path === "/api/signedin") {
    const now = Date.now();
    if (!accountsApi.si || now - accountsApi.si.t > 1000) {
      const r = await H.toEvent(env, "/do/signedin", { ip });
      const j = await r.json();
      accountsApi.si = { t: now, n: Number.isInteger(j && j.n) ? j.n : 0 };
    }
    return H.json({ n: accountsApi.si.n }, req, 200);
  }
  if (method === "GET" && path === "/api/finale") {
    if (!sess) return H.json({ error: "login required" }, req, 401);
    return viaDo("/do/acct/finale");
  }
  return null;
}

// ============================================================ Durable Object side
const J = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });

export class Accounts {
  constructor(host) {
    this.h = host;                 // the Event object
    this.a = new Map();            // account id -> record (every account, in memory, loaded at start)
    this.open = true;              // are new sign ups allowed
    this.profile = new Profile(this);
    this.finale = new Finale(this);
  }
  get storage() { return this.h.ctx.storage; }
  async load() {
    const s = this.storage;
    for (const [k, v] of await s.list({ prefix: "acct:" })) this.a.set(k.slice(5), v);
    const g = await s.get(["signups"]);
    this.open = g.get("signups") !== false;
    await this.profile.load();
    await this.finale.load();
  }
  save(id) { return this.storage.put("acct:" + id, this.a.get(id)); }
  who(id) { const r = this.a.get(id); return r ? { name: r.name || "", agency: r.agency || "", optin: !!r.optin } : null; }

  // ---- worker facing: one call makes the account or returns to it (the same email is the same account)
  async join(b, ip) {
    const id = String(b.id || ""), email = cleanEmail(b.email);
    if (!ID_RE.test(id) || !email) return J({ error: "bad" }, 400);
    if (typeof b.first !== "string" || typeof b.last !== "string") return J({ error: "bad" }, 400);
    const first = cleanText(b.first, 40), last = cleanText(b.last, 40);
    if (!first || !last) return J({ error: "bad" }, 400);
    const now = new Date().toISOString();
    let rec = this.a.get(id), created = false;
    if (!rec) {
      if (!this.open) return J({ error: "closed" }, 403);
      if (!this.h.hit("sn:" + ip, IP_NEW, IP_WIN)) return J({ error: "locked", retry: 60, why: "network" }, 429);
      rec = { email, agency: "", optin: false, created: now };
      this.a.set(id, rec); created = true;
    }
    const ag = cleanText(b.agency, 80);
    if (ag) rec.agency = ag;
    if (typeof b.optin === "boolean") rec.optin = b.optin;
    // a returning visit keeps the name already on the account (profile edits stick); only a new account takes the typed name
    if (created || !rec.name) { rec.firstName = first; rec.lastName = last; rec.name = (first + " " + last).slice(0, 80); }
    rec.last = now;
    await this.save(id);
    const w = this.who(id);
    return J({ ok: true, created, name: w.name, agency: w.agency });
  }

  // ---- routes behind the Worker's session check: /do/acct/<name>
  async route(name, req, role, sid) {
    const body = req.method === "GET" ? {} : await readJson(req);
    const isP = role === "presenter";
    if (isP) {
      if (name === "accounts") return this.list();
      if (name === "sharednotes") return J({ notes: this.profile.sharedList() });
      if (name === "room") return J(this.finale.room());
    }
    if (name === "finale") return J(this.finale.view(role));
    if (role !== "audience") return J({ error: "audience only" }, 403);
    if (!this.a.has(sid)) return J({ error: "login required" }, 401);
    switch (name) {
      case "me": return J(await this.profile.me(sid));
      case "note": return this.profile.putNote(sid, body);
      case "kept": return this.profile.putKept(sid, body);
      case "decision": return this.profile.putDecision(sid, body);
      case "profile": return this.setProfile(sid, body);
      default: return J({ error: "not found" }, 404);
    }
  }
  async setProfile(id, b) {
    const rec = this.a.get(id);
    if (!this.h.hit("pw:" + id, 60, 60)) return J({ error: "Too many changes. Wait a moment." }, 429);
    if (b.name !== undefined) {
      rec.name = cleanText(b.name, 60);
      const parts = rec.name.split(" ").filter(Boolean);
      rec.firstName = parts[0] || ""; rec.lastName = parts.slice(1).join(" ");
    }
    if (b.agency !== undefined) rec.agency = cleanText(b.agency, 80);
    if (typeof b.optin === "boolean") rec.optin = b.optin;
    await this.save(id);
    return J({ ok: true, ...this.who(id) });
  }

  // ---- presenter controls (POST /api/ctl/<name> reaches Event.ctl, which hands these four names here)
  async ctl(name, body) {
    switch (name) {
      case "signups": {
        if (typeof body.open !== "boolean") return J({ error: "open" }, 400);
        this.open = body.open;
        await this.storage.put("signups", this.open);
        return J({ ok: true, open: this.open });
      }
      case "noteshow": return this.profile.show(body);
      case "never": return this.finale.setNever(body);
      default: return J({ error: "unknown" }, 404);
    }
  }
  list() {
    const accounts = [...this.a.values()].sort((x, y) => (x.created < y.created ? -1 : 1))
      .map((r) => ({ email: r.email, name: r.name || "", agency: r.agency || "", optin: !!r.optin, created: r.created, last: r.last }));
    return J({ open: this.open, count: accounts.length, accounts });
  }
  csv() {
    const rows = [["email", "name", "optin", "created"]]
      .concat([...this.a.values()].sort((x, y) => (x.created < y.created ? -1 : 1))
        .map((r) => [r.email, r.name || "", r.optin ? "yes" : "no", r.created]));
    return this.h.csv(rows, "registrants.csv");
  }

  // Maisie wants a first name, an optional last name and the email of whoever is chatting
  joinBody(id) {
    const r = this.a.get(id);
    if (!r) return null;
    const letters = (s) => String(s || "").replace(/[^\p{L} .'-]/gu, "").replace(/\s+/g, " ").trim();
    const first = (letters(r.firstName) || letters(r.email.split("@")[0].replace(/[._+0-9-]+/g, " ")).split(" ")[0] || "Guest").slice(0, 32);
    return { first, last: letters(r.lastName).slice(0, 40), email: r.email, optin: !!r.optin };
  }
}

async function readJson(req) {
  try {
    const t = await req.text();
    if (t.length > BODY_MAX) return {};
    const v = JSON.parse(t || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}
