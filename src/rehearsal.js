// v4 a19 admin: "Reset for a rehearsal". Presenter only, runs inside the Event object.
// Clears what a test run leaves behind: sign ins (accounts), their notes and kept slides, every answer,
// the open text answers, the experiment wall and the note on the projector.
// Leaves alone: the question list, the slide plan, Aran's speaker notes, the sign up open/closed switch,
// the three "never" lines Aran picked, and the audience question board.
const J = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });

async function dropPrefix(storage, prefix) {
  let n = 0;
  for (;;) {
    const keys = [...(await storage.list({ prefix, limit: 500 })).keys()];
    if (!keys.length) return n;
    for (let i = 0; i < keys.length; i += 120) await storage.delete(keys.slice(i, i + 120));
    n += keys.length;
  }
}

export async function rehearsalReset(h, body) {
  if (!body || body.confirm !== true) return J({ error: "confirm" }, 400);
  const st = h.ctx.storage, acc = h.acct;
  const people = acc.a.size;
  await dropPrefix(st, "acct:"); await dropPrefix(st, "prof:"); await dropPrefix(st, "pa:"); await dropPrefix(st, "ot:"); await dropPrefix(st, "exp:");
  const before = Object.keys(h.pc);
  acc.a.clear(); acc.profile.p.clear(); h.pa.clear(); h.wall.m.clear();
  acc.profile.shown = null; await st.put("shown", null);
  h.pc = {}; h.shift = { up: 0, same: 0, down: 0 };
  h.core.closed = []; h.core.roomQ = null; await h.saveCore();   // round 2 polls: every poll open again, none forced on phones
  await st.put({ pc: h.pc, shift: h.shift });
  for (const id of before) h.pollKick(id);
  for (const q of h.qs()) h.pollKick(q.id);
  h.broadcast("");
  return J({ ok: true, people });
}
