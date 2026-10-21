// Room numbers for the command center and the closing slide. Everything here is a count or a
// string Aran picked: never a name, an email or an individual answer.

const J = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const NEVER_MAX = 5, NEVER_LEN = 80;

// v3 today: where one account moved, from its own answers. Both Today (cover) and a month from now (close) must be answered.
// Returns "up", "same", "down" or null. Only the direction ever leaves the Worker.
export const shiftOf = (mine) => {
  if (!mine || !Number.isInteger(mine.cover) || !Number.isInteger(mine.close)) return null;
  return mine.close > mine.cover ? "up" : mine.close < mine.cover ? "down" : "same";
};

export class Finale {
  constructor(acc) {
    this.acc = acc;
    this.never = [];             // the "wildest never" lines Aran picked for the closing slide
  }
  get h() { return this.acc.h; }
  async load() {
    const g = await this.acc.storage.get(["never"]);
    this.never = Array.isArray(g.get("never")) ? g.get("never") : [];
  }
  counts(qid) { return this.h.countsOf(this.h.qby(qid)).slice(); }
  total(qid) { return this.counts(qid).reduce((a, b) => a + b, 0); }
  agencies() {
    const seen = new Set();
    for (const r of this.acc.a.values()) { const g = String(r.agency || "").trim().toLowerCase(); if (g) seen.add(g); }
    return seen.size;
  }
  // v3 wall: experiments pledged = experiments on the wall (visible ones, same data as the slide)
  pledges() { return this.h.wall.count(); }
  room() {
    const answered = {};
    for (const qid of this.h.qs().map((q) => q.id)) { const n = this.total(qid); if (n) answered[qid] = n; }
    return { phones: this.h.viewers(), accounts: this.acc.a.size, answered, agencies: this.agencies(), pledges: this.pledges() };
  }
  // The closing slide. The presenter gets everything; a phone gets a block only once the room has
  // reached the question behind it, the same no-peeking rule as the poll tally.
  view(role) {
    const ok = (qid) => role === "presenter" || this.h.reachedQ(this.h.qby(qid));
    const block = (qid) => (ok(qid) ? { counts: this.counts(qid), total: this.total(qid) } : { counts: this.h.qby(qid).options.map(() => 0), total: 0 });
    const sh = this.h.shift || { up: 0, same: 0, down: 0 };
    const shift = ok("close") ? { up: sh.up, same: sh.same, down: sh.down, both: sh.up + sh.same + sh.down } : { up: 0, same: 0, down: 0, both: 0 };
    return { today: block("cover"), month: block("close"), words: this.h.qby("cover").options.slice(),   // ---- v4 a17 q: the scale words, as edited
       shift, people: this.acc.a.size, agencies: this.agencies(), pledges: this.pledges(), never: this.never.slice() };
  }
  async setNever(b) {
    if (!Array.isArray(b.pick) || b.pick.length > NEVER_MAX) return J({ error: "pick" }, 400);
    const pick = b.pick.map((s) => String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, NEVER_LEN)).filter(Boolean);
    this.never = pick;
    await this.acc.storage.put("never", pick);
    this.h.broadcast("");
    return J({ ok: true, never: pick });
  }
}
