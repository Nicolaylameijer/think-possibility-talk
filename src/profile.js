// Per account private data inside the Event Durable Object: notes (one per question, optionally
// flagged "share with Aran"), kept slides, and the one sentence decision. Stored under "prof:<id>".
// Only the owner ever reads their own profile. The presenter sees notes the owner flagged as shared
// (with the name, agency and email attached, in the command center only) and nothing else.
import { QBY } from "./questions.js";
import { indexOfId } from "./deckdata.js";

const J = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const NOTE_MAX = 600, DECISION_MAX = 300, MAX_NOTES = 40, MAX_KEPT = 60;
const KEY_RE = /^[a-z0-9-]{1,32}$/;
const text = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\r\n?/g, "\n").trim().slice(0, max + 1);
const blank = () => ({ notes: {}, kept: [], decision: "" });

export class Profile {
  constructor(acc) {
    this.acc = acc;
    this.p = new Map();          // account id -> profile
    this.shown = null;           // the note on the projector: { key, q, text, name }
  }
  get h() { return this.acc.h; }
  async load() {
    const s = this.acc.storage;
    for (const [k, v] of await s.list({ prefix: "prof:" })) this.p.set(k.slice(5), v);
    const g = await s.get(["shown"]);
    this.shown = g.get("shown") || null;
  }
  of(id) { let x = this.p.get(id); if (!x) { x = blank(); this.p.set(id, x); } return x; }
  save(id) { return this.acc.storage.put("prof:" + id, this.p.get(id)); }
  allow(id) { return this.h.hit("pw:" + id, 60, 60); }     // writes per account per minute

  async me(id) {
    const r = this.acc.a.get(id), x = this.p.get(id) || blank();
    const mine = await this.h.answersOf(id);
    const notes = {};
    for (const [q, n] of Object.entries(x.notes)) notes[q] = { text: n.text, shared: !!n.shared, updated: n.updated };
    const answers = Object.fromEntries(Object.entries(mine).filter(([k]) => !k.startsWith("rows:")));   // round 2: drop the readiness marker
    return { name: r.name || "", agency: r.agency || "", optin: !!r.optin, answers, notes, kept: x.kept.slice(), decision: x.decision || "" };
  }

  async putNote(id, b) {
    const q = typeof b.q === "string" ? b.q : "";
    if (!(Object.hasOwn(QBY, q) || KEY_RE.test(q))) return J({ error: "bad" }, 400);
    if (b.text !== undefined && typeof b.text !== "string") return J({ error: "bad" }, 400);
    const t = text(b.text, NOTE_MAX);
    if (t.length > NOTE_MAX) return J({ error: "bad" }, 400);
    if (!this.allow(id)) return J({ error: "Too many saves. Wait a moment." }, 429);
    const x = this.of(id), now = Date.now(), old = x.notes[q];
    if (!t) {
      if (old) { delete x.notes[q]; await this.save(id); }
      this.unshow(id + "." + q);
      return J({ ok: true, updated: now });
    }
    if (!old && Object.keys(x.notes).length >= MAX_NOTES) return J({ error: "bad" }, 400);
    const shared = typeof b.shared === "boolean" ? b.shared : !!(old && old.shared);
    x.notes[q] = { text: t, shared, updated: now };
    await this.save(id);
    this.unshow(id + "." + q);           // any edit takes the note off the projector
    return J({ ok: true, updated: now });
  }
  async putKept(id, b) {
    const slide = typeof b.slide === "string" ? b.slide : "";
    if (!slide || slide.length > 40 || indexOfId(slide) < 0 || typeof b.on !== "boolean") return J({ error: "bad" }, 400);
    if (!this.allow(id)) return J({ error: "Too many saves. Wait a moment." }, 429);
    const x = this.of(id), has = x.kept.includes(slide);
    if (b.on && !has) { if (x.kept.length >= MAX_KEPT) return J({ error: "bad" }, 400); x.kept.push(slide); await this.save(id); }
    if (!b.on && has) { x.kept = x.kept.filter((s) => s !== slide); await this.save(id); }
    return J({ ok: true });
  }
  async putDecision(id, b) {
    if (typeof b.text !== "string") return J({ error: "bad" }, 400);
    const t = text(b.text, DECISION_MAX);
    if (t.length > DECISION_MAX) return J({ error: "bad" }, 400);
    if (!this.allow(id)) return J({ error: "Too many saves. Wait a moment." }, 429);
    const x = this.of(id);
    if (x.decision !== t) { x.decision = t; await this.save(id); }
    return J({ ok: true });
  }

  // ---- shared notes, for the presenter
  sharedList() {
    const out = [];
    for (const [id, x] of this.p) {
      const r = this.acc.a.get(id);
      if (!r) continue;
      for (const [q, n] of Object.entries(x.notes)) {
        if (n.shared && n.text) out.push({ key: id + "." + q, q, text: n.text, email: r.email, name: r.name || "", agency: r.agency || "", updated: n.updated });
      }
    }
    return out.sort((a, b) => b.updated - a.updated);
  }
  // POST /api/ctl/note/show {key} puts one shared note on the projector; {key:null} takes it off
  async show(b) {
    if (b.key === null || b.key === undefined || b.key === "") {
      if (this.shown) { this.shown = null; await this.acc.storage.put("shown", null); this.h.broadcast(""); }
      return J({ ok: true, shown: null });
    }
    const key = String(b.key), i = key.indexOf(".");
    const id = key.slice(0, i), q = key.slice(i + 1), n = i > 0 && this.p.get(id) ? this.p.get(id).notes[q] : null;
    const r = this.acc.a.get(id);
    if (!n || !n.shared || !n.text || !r) return J({ error: "none" }, 404);
    const first = String(r.name || "").split(" ")[0] || "";
    this.shown = { key, q, text: n.text, name: first };
    await this.acc.storage.put("shown", this.shown);
    this.h.broadcast("");
    return J({ ok: true, shown: this.view() });
  }
  unshow(key) {
    if (!this.shown || this.shown.key !== key) return;
    this.shown = null;
    this.acc.storage.put("shown", null);
    this.h.broadcast("");
  }
  // what the state channel carries: never the key, never the email
  view() {
    if (!this.shown) return null;
    const v = { q: this.shown.q, text: this.shown.text };
    if (this.shown.name) v.name = this.shown.name;
    return v;
  }
}
