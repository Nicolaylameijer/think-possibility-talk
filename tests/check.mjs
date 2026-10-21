// The one check: npm run check   (about 10 seconds, no browser, no network)
//   node tests/check.mjs [--base REF]            everything
//   node tests/check.mjs --scan dashes|names|secrets   just one scan (the pull request workflow shows them as separate steps)
// It builds the deck from content/, checks every content file, scans for dashes, secrets and blocked names, then runs the small server tests.
//   --base REF   compare line lengths and keys with the content at that git ref (default origin/live, then HEAD~1; skipped when there is neither)
import "../scripts/lib-load.mjs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SECRET, appLinkProblems } from "../scripts/lib-scan.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const ONLY = arg("--scan");
const T0 = Date.now();
let fail = 0;
const check = (id, what, ok, extra = "") => { console.log((ok ? "PASS" : "FAIL") + " [" + id + "] " + what + (ok ? "" : "\n       " + String(extra).split("\n").join("\n       "))); if (!ok) fail++; };
const note = (id, what) => console.log("NOTE [" + id + "] " + what);
const list = (a, n = 8) => a.slice(0, n).join("\n") + (a.length > n ? `\n... and ${a.length - n} more` : "");
const done = () => { console.log(fail ? `\n${fail} CHECK(S) FAILED. Fix them before opening the pull request.` : `\nAll checks passed (${((Date.now() - T0) / 1000).toFixed(1)} s).`); process.exit(fail ? 1 : 0); };

// ---------------------------------------------------------------- files to scan
const SKIP_DIR = new Set(["node_modules", ".git", ".wrangler", "generated", "_deck", "_tpl"]);   // build outputs are made from what is scanned
const BUILD_FILES = new Set(["public/brand.css", "public/ui.css", "public/robots.txt"]);
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.relative(ROOT, path.join(dir, e.name));
    if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) walk(path.join(dir, e.name)); }
    else if (e.isFile() && !BUILD_FILES.has(rel)) files.push(rel);
  }
})(ROOT);
const isText = (f) => /\.(js|mjs|json|html|md|toml|css|txt|sh|yml|yaml|sha256)$/.test(f) || /(^|\/)\.(gitignore|npmrc)$/.test(f);
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

// ---------------------------------------------------------------- scans
function scanDashes() {
  const bad = files.filter((f) => isText(f) && !/^package-lock\.json$/.test(f) && /[\u2013\u2014]/.test(read(f)));
  check("s-1", "no em dash or en dash in any file (content, docs, code)", bad.length === 0, list(bad.map((f) => f + ": use a comma, a period, a colon or the word 'to'")));
}
function scanSecrets() {
  const leaked = files.filter((f) => isText(f) && !/^package-lock\.json$/.test(f) && fs.statSync(path.join(ROOT, f)).size < 3e6 && SECRET.test(read(f)));
  const env = files.filter((f) => /(^|\/)(\.dev\.vars[^/]*|\.env[^/]*)$/.test(f));
  check("s-2", "no key, token, password or account id in any file, and no .dev.vars or .env file", leaked.length === 0 && env.length === 0,
    list([...leaked.map((f) => "secret-shaped text in " + f), ...env.map((f) => "secret file: " + f)]));
}
function scanNames() {
  const hf = path.join(ROOT, "tests/blocked.sha256");
  const blocked = new Set(fs.readFileSync(hf, "utf8").split("\n").filter((l) => /^[0-9a-f]{64}$/.test(l)));
  const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
  const hit = (text, pairs) => {
    const w = text.toLowerCase().match(/[a-z0-9]+/g) || [], seen = new Set();
    for (let i = 0; i < w.length; i++) {
      if (!seen.has(w[i])) { seen.add(w[i]); if (blocked.has(sha(w[i]))) return true; }
      if (pairs && i) { const p = w[i - 1] + " " + w[i]; if (!seen.has(p)) { seen.add(p); if (blocked.has(sha(p))) return true; } }
    }
    return false;
  };
  const found = [];
  for (const f of files) {
    if (f === "tests/blocked.sha256" || f === ".github/CODEOWNERS") continue;   // the hash list; and the code owner's handle, which GitHub needs in plain text (the repo is private)
    if (hit(f, true)) { found.push(f + " (in the file name)"); continue; }
    const buf = fs.readFileSync(path.join(ROOT, f));
    if (hit(buf.toString(isText(f) ? "utf8" : "latin1"), isText(f))) found.push(f);
  }
  check("s-3", "no blocked name or account id in any file name or file (compared by hash; the list is not in the repo)", found.length === 0, list(found) + "\nTake the name out. Do not write it in the pull request either.");
}
if (ONLY) { ({ dashes: scanDashes, secrets: scanSecrets, names: scanNames }[ONLY] || (() => { console.error("--scan dashes|names|secrets"); process.exit(2); }))(); done(); }

// ---------------------------------------------------------------- 1. it builds
try { execFileSync("node", ["build.mjs"], { cwd: ROOT, stdio: "pipe" }); check("c-1", "the deck builds from content/ (node build.mjs)", true); }
catch (e) { check("c-1", "the deck builds from content/ (node build.mjs)", false, String(e.stderr || e.message).slice(0, 800)); console.log("FAILED: nothing else can be checked until the build works"); process.exit(1); }

// ---------------------------------------------------------------- 2. content files
const jsonFiles = files.filter((f) => f.startsWith("content/") && f.endsWith(".json"));
const parsed = {}, badJson = [];
for (const f of jsonFiles) { try { parsed[f] = JSON.parse(read(f)); } catch (e) { badJson.push(f + ": " + e.message); } }
check("c-2", `every content file is valid JSON (${jsonFiles.length} files)`, badJson.length === 0, list(badJson));
if (badJson.length) done();
const slideFiles = jsonFiles.filter((f) => f.startsWith("content/slides/")).sort();
const slides = slideFiles.map((f) => ({ f, id: parsed[f].id, d: parsed[f] }));
const ids = slides.map((s) => s.id), idSet = new Set(ids);
const plan = parsed["content/plan.json"], polls = parsed["content/polls.json"], cards = parsed["content/app/cards.json"];

const idBad = [];
slides.forEach((s, i) => {
  const m = /^content\/slides\/(\d\d)-([A-Za-z0-9]+)\.json$/.exec(s.f);
  if (!m || m[2] !== s.id) idBad.push(`${s.f}: the file name must be NN-<id>.json with the id inside the file`);
  else if (+m[1] !== i + 1) idBad.push(`${s.f}: the numbers run 01, 02, 03 ... without gaps (the number is only a label, content/plan.json sets the order)`);
  if ("hidden" in s.d || "autoplay" in s.d) idBad.push(`${s.f}: hidden and autoplay belong in content/plan.json`);
});
if (new Set(ids).size !== ids.length) idBad.push("two slides have the same id");
const inPlan = (name, a) => (Array.isArray(a) ? a : []).filter((id) => !idSet.has(id)).map((id) => `content/plan.json ${name}: unknown slide id "${id}"`);
idBad.push(...inPlan("order", plan.order), ...inPlan("hidden", plan.hidden), ...inPlan("keepPhoneCard", plan.keepPhoneCard), ...inPlan("autoplay", Object.keys(plan.autoplay || {})));
if (new Set(plan.order).size !== plan.order.length || plan.order.length !== ids.length) idBad.push(`content/plan.json order must list every slide id exactly once (${ids.length} slides)`);
for (const q of polls) if (!idSet.has(q.slide)) idBad.push(`content/polls.json: poll ${q.id} is asked on unknown slide "${q.slide}"`);
for (const id of Object.keys(cards)) if (!idSet.has(id)) idBad.push(`content/app/cards.json: unknown slide id "${id}"`);
check("c-3", "slide files, plan and ids line up (known ids, every slide once in the order, no hidden or autoplay inside a slide file)", idBad.length === 0, list(idBad, 12));

const gen = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, "src/generated", f), "utf8"));
const copy = gen("copy.json"), content = gen("content.json"), scenes = gen("scenes.json");
const { QUESTIONS, pollSlideProblems } = await import("../src/questions.js?" + Date.now());
const { CARDS, cardWords } = await import("../src/cards.js?" + Date.now());

// the text of every place a person reads: slide copy, poll questions and answers, phone cards, take-home prompts, app texts
const texts = [];
for (const [k, v] of Object.entries(copy.keys)) texts.push([k, v]);
for (const q of QUESTIONS) { texts.push(["poll " + q.id, q.text]); q.options.forEach((o, i) => texts.push([`poll ${q.id} answer ${i + 1}`, o])); }
for (const [id, c] of Object.entries(CARDS)) for (const f of ["title", "body", "example"]) texts.push([`card ${id}.${f}`, c[f]]);
for (const p of content.prompts || []) for (const f of ["title", "note", "text"]) texts.push([`prompt ${p.id}.${f}`, p[f]]);
for (const [i, x] of (parsed["content/app/starters.json"] || []).entries()) for (const f of ["title", "text"]) texts.push([`starter ${i + 1}.${f}`, x[f]]);

const html = texts.filter(([, t]) => typeof t !== "string" || /[<>]/.test(t) || /\n/.test(t));
check("c-4", "plain text only: no angle brackets, no line breaks in any line", html.length === 0, list(html.map(([k]) => k)));
const empty = texts.filter(([, t]) => typeof t === "string" && !t.trim());
if (empty.length) note("c-5", "blank lines (allowed, the slide shows nothing there): " + empty.map(([k]) => k).join(", "));

const tooLong = Object.entries(copy.keys).filter(([, t]) => t.length > 1200).map(([k, t]) => `${k}: ${t.length} characters`);
check("c-6", "no line is longer than 1200 characters", tooLong.length === 0, list(tooLong));
const badSize = [];
for (const s of slides) for (const [p, v] of Object.entries(s.d.sizes || {})) {
  if (!(`${s.id}.${p}` in copy.keys)) badSize.push(`${s.f}: sizes has "${p}", which is not a line of this slide`);
  else if (typeof v !== "number" || v < 0.6 || v > 1.6) badSize.push(`${s.f}: size of "${p}" is ${v}, allowed 0.6 to 1.6`);
}
check("c-7", "sizes: only real lines, each between 0.6 and 1.6", badSize.length === 0, list(badSize));

const bad = [];
for (const k of Object.keys(copy.keys)) if (k.endsWith(".em")) {
  const id = k.slice(0, -3), title = copy.keys[id + ".title"];
  if (title != null && !title.includes(copy.keys[k])) bad.push(`${id}: highlighted "${copy.keys[k]}" is not inside the title "${title}"`);
}
check("c-8", "every highlighted phrase (.em) appears word for word inside its title", bad.length === 0, list(bad));

const m4 = scenes.find((s) => s.id === "move4"), pairBad = [];
((m4 && m4.talk) || []).forEach((t, i) => {
  if (!t.pick) return;
  const best = (t.pick.options || []).find((o) => o.verdict === "best");
  if (!best) pairBad.push(`talk ${i + 1} has no best reply`); else if (best.line !== t.line) pairBad.push(`talk ${i + 1}: the line and the best reply differ`);
});
check("c-9", "Rehearse: each conversation line equals its best reply (change both together)", pairBad.length === 0, list(pairBad));

// polls: the room's own rules (cleanQuestions) must leave the shipped list exactly as it is
const { cleanQuestions, defaultList } = await import("../src/qedit.js?" + Date.now());
const pollBad = [];
for (const q of QUESTIONS) {
  if (!q.text || q.options.length < 2) pollBad.push(q.id + ": needs a question and at least two answers");
  if (new Set(q.options).size !== q.options.length) pollBad.push(q.id + ": two answers are the same");
  if (q.text.length > 120) pollBad.push(q.id + ": the question is over 120 characters");
  if (q.options.some((o) => !o || o.length > 40) || q.options.length > 6) pollBad.push(q.id + ": answers must be 1 to 40 characters, six at most");
  if ((q.id === "cover" || q.id === "close" || q.id === "readiness") && q.options.length !== 5) pollBad.push(q.id + ": the scale polls keep exactly five answers (the closing chart compares them)");
}
const cv = QUESTIONS.find((q) => q.id === "cover"), cl = QUESTIONS.find((q) => q.id === "close");
if (cv && cl && JSON.stringify(cv.options) !== JSON.stringify(cl.options)) pollBad.push("close: the two scale polls (cover and close) share one set of answers");
const round = cleanQuestions({ questions: defaultList() });
if (round !== null) pollBad.push("the room's poll rules would change the list (cleanQuestions)");
check("c-10", "polls: a question and 2+ distinct answers, the scale polls keep five, the room's own rules accept the list", pollBad.length === 0, list(pollBad));

const slideProblems = pollSlideProblems(QUESTIONS);
check("c-10b", "polls: each is asked on a slide that shows it (src/questions.js ASK_SLIDES or the poll's liveOn)", slideProblems.length === 0, list(slideProblems));

const linkProblems = appLinkProblems(JSON.parse(read("content/app/apps.json")));
check("c-14", "app links (content/app/apps.json): each site, ios and android link is empty or https:// on the allowed list of AI app hosts", linkProblems.length === 0, list(linkProblems));

const over = Object.entries(CARDS).map(([id, c]) => [id, cardWords(c)]).filter(([, n]) => n > 40);
const noCard = ids.filter((id) => !(id in CARDS)).concat(Object.keys(CARDS).filter((id) => !idSet.has(id)));
check("c-11", "phone cards: 40 words or fewer each, one card per slide", over.length === 0 && noCard.length === 0, list([...over.map(([id, n]) => `${id}: ${n} words`), ...noCard.map((id) => id + ": missing or unknown card")]));

// base: no line grown past what fits, no key lost
let baseLeaves = null, baseRef = null;
const copykeys = await import("../src/copykeys.js");
const git = (...a) => execFileSync("git", a, { cwd: ROOT, stdio: "pipe" }).toString();
for (const ref of arg("--base") ? [arg("--base")] : ["origin/live", "HEAD~1"]) {
  try {
    const names = git("ls-tree", "-r", "--name-only", ref, "content/slides").split("\n").filter(Boolean), keys = {};
    for (const n of names) { const sc = JSON.parse(git("show", `${ref}:${n}`)); for (const [p, v] of copykeys.copyLeaves(sc)) keys[sc.id + "." + p] = v; }
    if (Object.keys(keys).length) { baseLeaves = keys; baseRef = ref; break; }
  } catch (e) { /* try the next ref */ }
}
if (baseLeaves) {
  const grew = Object.keys(copy.keys).filter((k) => k in baseLeaves && copy.keys[k].length > Math.max(60, baseLeaves[k].length * 1.5)).map((k) => `${k}: ${baseLeaves[k].length} to ${copy.keys[k].length} characters`);
  check("c-12", `no line is more than 50 percent longer than before (slides have fixed space; compared with ${baseRef})`, grew.length === 0, list(grew) + "\nShorten them, or say in the pull request why a longer line fits.");
  const lost = Object.keys(baseLeaves).filter((k) => !(k in copy.keys));
  check("c-13", "no line has lost its key (a removed or renamed line breaks the editor and saved edits)", lost.length === 0, list(lost));
} else note("c-12", "skipped the length and lost-key comparison: no origin/live and no earlier commit to compare with");

// ---------------------------------------------------------------- 3. scans
scanDashes(); scanSecrets(); scanNames();

// ---------------------------------------------------------------- 4. the small server tests (plain Node, no browser, no network)
const tests = ["tests/r2-maisie-eff.mjs", "tests/plan-card.mjs", "tests/editor-mode.mjs", "tests/app-content.mjs", "tests/poll-slides.mjs", "tests/scan-rules.mjs"].filter((t) => fs.existsSync(path.join(ROOT, t)));
for (const t of tests) {
  const r = spawnSync("node", [t], { cwd: ROOT, encoding: "utf8" });
  const out = (r.stdout || "") + (r.stderr || ""), last = out.trim().split("\n").slice(-1)[0];
  check("t-" + path.basename(t, ".mjs"), `${path.basename(t)}: ${last}`, r.status === 0, out.split("\n").filter((l) => /FAIL|Error/.test(l)).slice(0, 8).join("\n"));
}
done();
