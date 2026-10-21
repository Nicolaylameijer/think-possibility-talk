// After `npm run fold -- <dir>` and `npm run build`: does the built deck equal the live export?  npm run verify-fold -- <dir>
// Compares all copy keys (text and size), the effective slide plan (order, hidden), autoplay, and the poll list (ids, slide, text, answers).
import "./lib-load.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = process.argv[2];
if (!dir) { console.error("usage: npm run verify-fold -- <export dir>"); process.exit(2); }
const rd = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
const live = { copy: rd("copy.json"), plan: rd("plan.json").plan, remote: rd("remote-plan.json"), polls: rd("polls.json") };
const built = JSON.parse(fs.readFileSync(path.join(ROOT, "src/generated/copy.json"), "utf8"));
const scenes = JSON.parse(fs.readFileSync(path.join(ROOT, "src/generated/scenes.json"), "utf8"));
const { effective } = await import("../src/plan.js");
const { effQuestions } = await import("../src/qedit.js");
let fail = 0;
const check = (what, ok, extra = "") => { console.log((ok ? "PASS " : "FAIL ") + what + (ok ? "" : "\n     " + extra)); if (!ok) fail++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const texts = live.copy.keys.filter((k) => built.keys[k.key] !== k.text).map((k) => k.key);
check(`all ${live.copy.keys.length} copy keys: built text equals live text`, texts.length === 0 && Object.keys(built.keys).length === live.copy.keys.length, texts.join(", "));
const sizes = live.copy.keys.filter((k) => { const sc = scenes.find((s) => s.id === k.key.split(".")[0]); const got = (sc.__cs || {})[k.key.slice(k.key.indexOf(".") + 1)] || 1; return got !== (Number(k.size) || 1); }).map((k) => k.key);
check("sizes equal live", sizes.length === 0, sizes.join(", "));

const eff = effective(null);
check("effective slide order equals live", same(eff.order, live.plan.order), JSON.stringify(eff.order));
check("effective hidden slides equal live", same(eff.hidden, live.plan.hidden), JSON.stringify(eff.hidden));
const auto = live.remote.state.auto, bad = Object.keys(auto).filter((id) => !!(scenes.find((s) => s.id === id) || {}).autoplay !== !!auto[id]);
check("autoplay defaults equal live", bad.length === 0, bad.join(", "));

const m4 = scenes.find((s) => s.id === "move4");
const mine = effQuestions(null, null, m4);   // no saved list: the repo polls, sorted and numbered by the plan like a saved list
const pick = (q) => ({ id: q.id, slide: q.slide, n: q.n, text: q.text, options: q.options });
check(`poll list equals live (${live.polls.questions.length} polls: order, number, id, slide, text, answers)`, same(mine.map(pick), live.polls.questions.map(pick)),
  JSON.stringify(mine.map(pick)).slice(0, 400));
console.log(fail ? `\n${fail} FAILED` : "\nbuilt deck equals live");
process.exit(fail ? 1 : 0);
