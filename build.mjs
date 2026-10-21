// Build step. Splits the deck page (engine/index.html) and fills it with the words in content/ :
//   content/slides/NN-<id>.json, plan.json, app/talk-prompts.json, brand.json   (see AGENTS.md for who edits what)
// and writes:
//   public/_deck/tokens.css, deck.css   styles (no content)
//   public/_deck/pre.js, engine.js      engine code (no slide content)
//   public/brand.css                    colours and fonts from brand.json
//   src/generated/deck.json             the DECK data object
//   src/generated/scenes.json           every scene, with speaker notes (private to the Worker bundle)
//   src/generated/content.json          checklist content, parsed like the old server did
//   src/generated/body.html             the static markup of the deck page
// Slide content never lands in public/ (the _tpl templates hold only page chrome). The Worker decides, per request, what each role receives.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(ROOT, "engine/index.html"), "utf8");
const OUT = path.join(ROOT, "src/generated");
const PUB = path.join(ROOT, "public");
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.join(PUB, "_deck"), { recursive: true });

// ---- literal scanner: finds the end of a [...] or {...} literal, aware of strings and comments
function literalEnd(s, i) {
  let depth = 0, j = i;
  while (j < s.length) {
    const c = s[j];
    if (c === '"' || c === "'") { j++; while (j < s.length && s[j] !== c) { if (s[j] === "\\") j++; j++; } j++; continue; }
    if (c === "`") throw new Error("template literal in deck data");
    if (s.startsWith("//", j)) { const k = s.indexOf("\n", j); j = k < 0 ? s.length : k; continue; }
    if (s.startsWith("/*", j)) { const k = s.indexOf("*/", j); j = k < 0 ? s.length : k + 2; continue; }
    if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") { depth--; if (depth === 0) return j + 1; }
    j++;
  }
  throw new Error("unbalanced literal");
}
const evalLiteral = (src) => new Function("return (" + src + ")")();

// ---- split the page
const bodyStart = SRC.indexOf("<body>");
const scriptStart = SRC.indexOf("<script>", bodyStart);
const scriptEnd = SRC.lastIndexOf("</script>");
if (bodyStart < 0 || scriptStart < 0 || scriptEnd < 0) throw new Error("deck page structure changed");
const bodyMarkup = SRC.slice(bodyStart + 6, scriptStart).trim();
const script = SRC.slice(scriptStart + 8, scriptEnd);

const styles = [...SRC.slice(0, bodyStart).matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
if (styles.length !== 2) throw new Error("expected two style blocks, got " + styles.length);

const iDeck = script.indexOf("const DECK = {");
const iDataComment = script.lastIndexOf("/* ====", iDeck);
const iScenes = script.indexOf("const SCENES = [");
const iScenesLit = iScenes + "const SCENES = ".length;
const iScenesEnd = literalEnd(script, iScenesLit);
const iDeckLit = iDeck + "const DECK = ".length;
const iDeckEnd = literalEnd(script, iDeckLit);
const pre = script.slice(0, iDataComment);
const engine = script.slice(iScenesEnd).replace(/^\s*;/, "");
const DECK = evalLiteral(script.slice(iDeckLit, iDeckEnd));
// ---- the words: content/ replaces the literals the page used to carry
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
DECK.prompts = readJson("content/app/talk-prompts.json");   // the key stays where the page has it
const PLAN = readJson("content/plan.json");
const slideFiles = fs.readdirSync(path.join(ROOT, "content/slides")).filter((f) => /^\d\d-[A-Za-z0-9]+\.json$/.test(f)).sort();
// scene index is the stable identity in the room (reached, answers): it is the file number, never the plan order
const SCENES = slideFiles.map((f) => {
  const { sizes, ...o } = readJson("content/slides/" + f);
  if (f.slice(3, -5) !== o.id) throw new Error(f + ": the file name must end with the slide id " + o.id);
  if ("hidden" in o || "autoplay" in o) throw new Error(f + ": hidden and autoplay are set in content/plan.json");
  let sc = o;
  if ((PLAN.hidden || []).includes(o.id)) { const { id, ...rest } = o; sc = { id, hidden: true, ...rest }; }   // hidden sits right after id, as the page always had it
  if ((PLAN.autoplay || {})[o.id] === true) sc.autoplay = true;
  if (sizes && Object.keys(sizes).length) sc.__cs = { ...sizes };   // size per copy path, applied like an editor size
  return sc;
});
if (!SCENES.length) throw new Error("no scenes");
for (const id of [...(PLAN.order || []), ...(PLAN.hidden || []), ...(PLAN.keepPhoneCard || []), ...Object.keys(PLAN.autoplay || {})]) if (!SCENES.some((s) => s.id === id)) throw new Error("content/plan.json names an unknown slide: " + id);

// ---- content extraction (what /follow shows), same rules as the old server
const ID_RE = /^[A-Za-z]{1,3}\d{1,3}$/;
const chapters = DECK.chapters.map((c, i) => ({
  n: c.n || String(i + 1).padStart(2, "0"), title: c.t || "", q: c.q || "", mins: c.mins || "", line: c.line || "", url: "", hi: !!c.hi,
  reqs: (c.reqs || []).filter((r) => Array.isArray(r) && r.length >= 2 && ID_RE.test(String(r[0])))
    .map((r) => ({ id: r[0], text: r[1], hi: !!(r.length > 2 && r[2]), outcome: (DECK.outcomes || {})[r[0]] || "" })),
  use: null,
}));
const prompts = (DECK.prompts || []).filter((p) => p && ID_RE.test(String(p.id)))
  .map((p) => ({ id: p.id, title: String(p.t || ""), text: String(p.text || ""), note: String(p.note || "") }));
const reqChapter = {};
chapters.forEach((c, ci) => c.reqs.forEach((r) => (reqChapter[r.id] = ci)));
const sceneOfReq = {}, chapterOfScene = [], sceneOfPrompt = {};
SCENES.forEach((s, i) => {
  (s.ticks || []).forEach((q) => { if (!(q in sceneOfReq)) sceneOfReq[q] = i; });
  chapterOfScene[i] = (s.ticks && s.ticks.length && reqChapter[s.ticks[0]] != null) ? reqChapter[s.ticks[0]] : null;
  if (s.p) sceneOfPrompt[s.p] = i;
});
for (let i = 0; i < SCENES.length; i++) if (chapterOfScene[i] == null) chapterOfScene[i] = i ? chapterOfScene[i - 1] : 0;
const content = { chapters, total: chapters.reduce((a, c) => a + c.reqs.length, 0), prompts, polls: [], sceneOfReq, chapterOfScene, sceneOfPrompt };

// ---- brand.css, as the old server generated it
const brand = JSON.parse(fs.readFileSync(path.join(ROOT, "content/brand.json"), "utf8"));
const col = (k, d) => (/^#[0-9A-Fa-f]{3,8}$/.test(String((brand.colors || {})[k] || "")) ? brand.colors[k] : d);
const font = String(brand.font || "Plus Jakarta Sans").replace(/'/g, "");
let faces = "";
if (font === "Public Sans") {
  faces = "@font-face{font-family:'Public Sans';font-weight:400 700;font-display:swap;src:url(/fonts/publicsans-400.woff2) format('woff2')}"
    + "@font-face{font-family:'Fraunces';font-weight:400 700;font-display:swap;src:url(/fonts/fraunces-400.woff2) format('woff2')}"
    + "@font-face{font-family:'Fraunces';font-style:italic;font-weight:400 700;font-display:swap;src:url(/fonts/fraunces-500i.woff2) format('woff2')}"
    + ":root{--serif:'Fraunces',Georgia,'Times New Roman',serif}";
} else if (font === "Plus Jakarta Sans") {
  faces = [400, 500, 600, 700, 800].map((w) => `@font-face{font-family:'${font}';font-weight:${w};font-display:swap;src:url(/fonts/pjs-${w}.woff2) format('woff2')}`).join("");
}
const brandCss = faces + `:root{--brand:${col("primary", "#2563EB")};--bright:${col("bright", "#38BDF8")};--accent:${col("accent", "#0D9488")};--dark:${col("dark", "#0F172A")};--warm:${col("warm", "#D97706")};--font:'${font}',system-ui,-apple-system,'Segoe UI',sans-serif}`
  + (col("code", "") ? `:root{--code:${col("code", "")}}` : "");

// ---- write
// write only when the content changed, so a running `wrangler dev` is not told to reload for nothing
const w = (p, s) => { try { if (fs.readFileSync(p, "utf8") === s) return; } catch (e) { /* new file */ } fs.writeFileSync(p, s); };
const cp = (from, to) => { try { if (fs.readFileSync(from).equals(fs.readFileSync(to))) return; } catch (e) { /* new file */ } fs.copyFileSync(from, to); };
w(path.join(PUB, "_deck/tokens.css"), styles[0]);
w(path.join(PUB, "_deck/deck.css"), styles[1]);
// the poll list and the phone cards: content/polls.json and content/app/cards.json become modules the Worker imports
w(path.join(OUT, "polls.js"), "// generated by build.mjs from content/polls.json\nexport default " + JSON.stringify(readJson("content/polls.json"), null, 1) + ";\n");
w(path.join(OUT, "cards.js"), "// generated by build.mjs from content/app/cards.json\nexport default " + JSON.stringify(readJson("content/app/cards.json"), null, 1) + ";\n");
// option words for every poll slide come from src/questions.js: one source, no second copy in the deck
const { QUESTIONS } = await import("./src/questions.js");
const qwords = Object.fromEntries(QUESTIONS.map((q) => [q.id, q.options]));
w(path.join(PUB, "_deck/pre.js"), "window.QWORDS=" + JSON.stringify(qwords) + ";\n" + pre);
w(path.join(PUB, "_deck/engine.js"), engine);
w(path.join(PUB, "brand.css"), brandCss + "\n");
w(path.join(PUB, "robots.txt"), "User-agent: *\nDisallow: /\n");
// hand-written browser files and page templates (kept in engine/, served only through the Worker)
fs.mkdirSync(path.join(PUB, "_tpl"), { recursive: true });
for (const [from, to] of [["engine/presenter.js", "_deck/presenter.js"], ["engine/shell.js", "_deck/shell.js"],
  ["engine/app.html", "_tpl/app.html"], ["engine/maisie.html", "_tpl/maisie.html"],
  ["engine/admin.html", "_tpl/admin.html"], ["engine/remote.html", "_tpl/remote.html"],
  ["engine/follow.html", "_tpl/follow.html"], ["engine/ui.css", "ui.css"], ["engine/poll.js", "_deck/poll.js"]]) {   // round 2: shared UI tokens and the live poll takeover
  const f = path.join(ROOT, from);
  if (fs.existsSync(f)) cp(f, path.join(PUB, to));
}
const qrSrc = path.join(ROOT, "node_modules/qrcode-generator/qrcode.js");
if (fs.existsSync(qrSrc)) cp(qrSrc, path.join(PUB, "_deck/qr.js"));
// the two take-home texts (guide and starter prompt) as modules; {{NAME}} is where the assistant's name goes
const md = (f) => fs.readFileSync(path.join(ROOT, "content/app", f), "utf8");
w(path.join(OUT, "appmd.js"), "// generated by build.mjs from content/app/guide.md and starter.md\nexport const GUIDE = " + JSON.stringify(md("guide.md")) + ";\nexport const STARTER = " + JSON.stringify(md("starter.md").replace(/\n$/, "")) + ";\n");
w(path.join(OUT, "deck.json"), JSON.stringify(DECK));
w(path.join(OUT, "scenes.json"), JSON.stringify(SCENES));
w(path.join(OUT, "content.json"), JSON.stringify(content));
w(path.join(OUT, "body.html"), bodyMarkup + "\n");
w(path.join(OUT, "body.js"), "export default " + JSON.stringify(bodyMarkup) + ";\n");
// ---- G9 editable copy: one stable key per piece of slide copy (scene id + field path, never the words), see src/copykeys.js
const copy = await (async () => {
  const { copyLeaves } = await import("./src/copykeys.js");
  const keys = {}, scenes = [];
  SCENES.forEach((s, i) => {
    if (!s.id || /\./.test(s.id)) throw new Error("copy keys: scene " + i + " needs an id without dots");
    scenes.push({ id: s.id, i, title: String(s.title || s.kick || s.id), hidden: !!s.hidden });
    for (const [p, v] of copyLeaves(s)) keys[s.id + "." + p] = v;
  });
  w(path.join(OUT, "copy.json"), JSON.stringify({ keys, scenes }));
  const help = path.join(ROOT, "COPY-EDITING-FOR-MAISIE.md");
  w(path.join(OUT, "copyhelp.js"), "// generated by build.mjs from COPY-EDITING-FOR-MAISIE.md\nexport default " + JSON.stringify(fs.existsSync(help) ? fs.readFileSync(help, "utf8") : "") + ";\n");
  for (const f of ["copy.js", "copyedit.js"]) if (fs.existsSync(path.join(ROOT, "engine", f))) cp(path.join(ROOT, "engine", f), path.join(PUB, "_deck", f));
  return Object.keys(keys).length;
})();
const title = DECK.title + (DECK.audience ? ", " + DECK.audience : "");
console.log(`build: ${SCENES.length} scenes, ${content.total} items, ${prompts.length} prompts, ${copy} copy keys, engine ${(engine.length / 1024) | 0} KB, "${title}"`);
