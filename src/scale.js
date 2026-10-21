// G10 scale: the reads that every phone in the room makes at the same moment (the room state when sockets are
// blocked, a poll's bars, the question list) are the same answer for every audience phone. Each Worker isolate lets
// one request fetch it while every other request that arrives meanwhile waits on the same promise. Nothing is reused
// once that read has landed, so an answer is never older than one round trip to the Event object, and the busier the
// room, the more phones each read serves. Only audience reads that are identical for every audience session come
// through here, never presenter views, never anything carrying a person's own data.
const C = new Map();

// shared(key, load): load() resolves to { status, type, body }.
export function shared(key, load) {
  const hit = C.get(key);
  if (hit) return hit;
  const p = load().finally(() => { if (C.get(key) === p) C.delete(key); });
  C.set(key, p);
  return p;
}

// Phones that poll the room state through the cache still count as viewers: their ids are collected here and
// handed to the Event object with the next real read.
const seen = new Set();
export function noteViewer(sid) { if (sid && seen.size < 5000) seen.add(String(sid).slice(0, 20)); }
export function takeViewers() { const a = [...seen]; seen.clear(); return a; }

export const asRes = async (r) => ({ status: r.status, type: r.headers.get("content-type") || "application/json", body: await r.text() });
