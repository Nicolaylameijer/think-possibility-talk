// EDITOR_MODE: "live" (the default) lets the editor and Maisie's key save wording; "repo" refuses every copy write with 409 "edit in the repo".
// Runs the real copyApi with a stand-in for the room object. Plain Node, no server.
import "../scripts/lib-load.mjs";
const { copyApi, copyToken } = await import("../src/copy.js");

const results = [];
const check = (id, name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} [${id}] ${name}${detail ? "  (" + detail + ")" : ""}`); };
const asked = [];
const h = {
  json: (o, req, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } }),
  // the real one returns a Response from the room object: a stream body, not a string
  toEvent: async (env, p, o) => { asked.push(p); return p.startsWith("/do/rl") ? new Response(JSON.stringify({ blocked: false })) : new Response(JSON.stringify({ ok: true, v: 1, changed: 0, keys: [] }), { status: 200 }); },
  sameOrigin: () => true, ipOf: () => "127.0.0.1", secure: (r) => r,
};
const call = async (env, method, p, headers = {}, sess = { role: "presenter" }) => {
  asked.length = 0;
  const url = new URL("https://example.test" + p);
  const res = await copyApi(new Request(url, { method, headers, body: method === "POST" ? JSON.stringify({ key: "cover.title", text: "x" }) : undefined }), env, url, sess, h);
  return { status: res.status, j: await res.json(), event: asked.filter((x) => x.startsWith("/do/copy")).length };
};

for (const [label, env] of [["no EDITOR_MODE set", {}], ['EDITOR_MODE "live"', { EDITOR_MODE: "live" }]]) {
  const r = await call(env, "POST", "/api/copy/set");
  check("em-1", `${label}: a save goes through to the room object`, r.status === 200 && r.event === 1, r.status);
  const g = await call(env, "GET", "/api/copy");
  check("em-2", `${label}: the editor list carries no read only mode`, g.status === 200 && g.j.mode === undefined);
}
const repo = { EDITOR_MODE: "repo", SESSION_SECRET: "local-test-secret" };
for (const op of ["set", "reset", "restore"]) {
  const r = await call(repo, "POST", "/api/copy/" + op);
  check("em-3", `repo mode: /api/copy/${op} answers 409 "edit in the repo" and writes nothing`, r.status === 409 && r.j.error === "edit in the repo" && r.event === 0, r.status);
}
const g = await call(repo, "GET", "/api/copy");
check("em-4", "repo mode: reading still works and tells the editor it is read only", g.status === 200 && g.j.mode === "repo");
const bearer = { authorization: "Bearer " + (await copyToken(repo)) };
const m = await call(repo, "POST", "/api/copy/set", bearer, null);
check("em-5", "repo mode: Maisie's key is refused the same way", m.status === 409 && m.event === 0, m.status);
const lm = await call({ SESSION_SECRET: "local-test-secret" }, "POST", "/api/copy/set", bearer, null);
check("em-6", "live mode: Maisie's key still saves", lm.status === 200 && lm.event === 1, lm.status);
const bad = results.filter((x) => !x).length;
console.log(`${results.length - bad} of ${results.length} passed`);
process.exit(bad ? 1 : 0);
