// Sharded storage for lists that can grow past what one Durable Object value should hold.
// A list is stored as chunks "<prefix>:0", "<prefix>:1", ... of SIZE items each, plus "<prefix>:n"
// (the chunk count). Appends rewrite only the last chunk. Reading falls back to the older single
// key so data written before sharding is still found.
export const CHUNK = 100;

export async function loadList(storage, prefix, legacyKey) {
  const n = await storage.get(prefix + ":n");
  if (typeof n !== "number") return (legacyKey && (await storage.get(legacyKey))) || [];
  const keys = [];
  for (let i = 0; i < n; i++) keys.push(prefix + ":" + i);
  const got = keys.length ? await storage.get(keys) : new Map();
  return keys.flatMap((k) => got.get(k) || []);
}

// all=true rewrites every chunk (needed when an old item changed); otherwise only the last chunk.
export async function saveList(storage, prefix, list, { all = false, prevCount = 0 } = {}) {
  const n = Math.max(1, Math.ceil(list.length / CHUNK));
  const out = { [prefix + ":n"]: n };
  const from = all ? 0 : n - 1;
  for (let i = from; i < n; i++) out[prefix + ":" + i] = list.slice(i * CHUNK, (i + 1) * CHUNK);
  await storage.put(out);
  if (prevCount > n) { const dead = []; for (let i = n; i < prevCount; i++) dead.push(prefix + ":" + i); await storage.delete(dead); }
  return n;
}
