// A hidden slide drops its phone card, unless content/plan.json lists it in keepPhoneCard. Three cases plus the shipped one, each on a build of its own
// (a copy of the repo in a temp folder with a different content/plan.json). Plain Node, no server, no browser.
import "../scripts/lib-load.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const real = JSON.parse(fs.readFileSync(path.join(ROOT, "content/plan.json"), "utf8"));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plan-card-"));
const results = [];
const check = (id, name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} [${id}] ${name}${detail ? "  (" + detail + ")" : ""}`); };

async function world(name, plan) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const d of ["engine", "content", "src"]) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "build.mjs"), path.join(dir, "build.mjs"));
  fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  fs.writeFileSync(path.join(dir, "content/plan.json"), JSON.stringify(plan));
  fs.mkdirSync(path.join(dir, "node_modules"), { recursive: true });
  execFileSync("node", ["build.mjs"], { cwd: dir, stdio: "pipe" });
  const mod = await import(pathToFileURL(path.join(dir, "src/deckdata.js")).href);
  const { effective } = await import(pathToFileURL(path.join(dir, "src/plan.js")).href);
  const all = mod.SCENES.map((_, i) => i);
  const idx = (id) => mod.SCENES.findIndex((s) => s.id === id);
  // the lines on the phone checklist for every reached slide
  const lines = (plan) => new Set(mod.audienceContent(all, [], plan).chapters.flatMap((c) => c.reqs.filter((r) => r.text !== "Not shown yet").map((r) => r.id)));
  return { mod, effective, lines, idx };
}
const ids = real.order;
const shipped = { order: ids, hidden: ["confession", "move1", "move2", "move3"], keepPhoneCard: ["confession", "move1", "move2", "move3"], autoplay: {} };

try {
  const s = await world("shipped", shipped);
  const L = s.lines(s.effective(null));
  check("pc-0", "shipped plan: the four slides that ship hidden keep their phone lines, the others show", L.has("C1") && L.has("M1") && L.has("L1"));

  const a = await world("repo-hide", { ...shipped, hidden: ["ladder"], keepPhoneCard: [] });
  const A = a.lines(a.effective(null));
  check("pc-1", "a slide hidden in the repo plan drops its card from the phone", !A.has("L1") && !A.has("L3") && A.has("C1"), [...A].join(","));

  const b = await world("repo-keep", { ...shipped, hidden: ["ladder"], keepPhoneCard: ["ladder"] });
  const B = b.lines(b.effective(null));
  check("pc-2", "a slide hidden in the repo plan but listed in keepPhoneCard keeps its card", B.has("L1") && B.has("L3"), [...B].join(","));

  const c = await world("live-hide", shipped);
  const saved = c.effective({ order: ids, hidden: ["confession", "move1", "move2", "move3", "ladder"] });
  const C = c.lines(saved);
  check("pc-3", "a slide hidden from the editor (a saved live plan) drops its card, the slides kept by the repo plan stay", !C.has("L1") && C.has("C1") && C.has("M1"), [...C].join(","));
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
const bad = results.filter((x) => !x).length;
console.log(`${results.length - bad} of ${results.length} passed`);
process.exit(bad ? 1 : 0);
