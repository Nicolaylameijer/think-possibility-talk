// Fold the live room's edits into content/:  npm run fold -- <export dir>
// The export dir holds four read-only exports of the live deck (nothing about the audience is in them):
//   copy.json         every copy key with its live text and size        -> content/slides/*.json (text, and "sizes" when not 1)
//   plan.json         the saved slide order and hidden slides (indices)  -> content/plan.json (order, hidden, keepPhoneCard)
//   remote-plan.json  state.auto, the autoplay switch per slide          -> content/plan.json (autoplay)
//   polls.json        the effective poll list                            -> content/polls.json (slide, text, answers)
// Safe to run again: it writes the live values over content/ every time, and only rewrites a file when something changed.
// It reads those four files and writes inside content/. It never touches the network, sign ups, answers or notes.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fmt } from "./lib-json.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) { console.error("usage: npm run fold -- <export dir with copy.json, plan.json, remote-plan.json, polls.json>"); process.exit(2); }
const rd = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
const copy = rd("copy.json"), plan = rd("plan.json"), remote = rd("remote-plan.json"), polls = rd("polls.json");

const slideDir = path.join(ROOT, "content/slides");
const files = fs.readdirSync(slideDir).filter((f) => /^\d\d-[A-Za-z0-9]+\.json$/.test(f)).sort();
const slides = files.map((f) => ({ f, id: f.slice(3, -5), data: JSON.parse(fs.readFileSync(path.join(slideDir, f), "utf8")), changed: false }));
const ids = slides.map((s) => s.id);
const touched = { text: 0, size: 0, plan: 0, polls: 0 };
const problems = [];

// ---- wording and sizes
for (const k of copy.keys) {
  const dot = k.key.indexOf("."), id = k.key.slice(0, dot), p = k.key.slice(dot + 1);
  const s = slides.find((x) => x.id === id);
  if (!s) { problems.push("unknown slide in key " + k.key); continue; }
  const parts = p.split(".");
  let o = s.data;
  for (let i = 0; i < parts.length - 1 && o != null; i++) o = o[parts[i]];
  const last = parts[parts.length - 1];
  if (o == null || typeof o[last] !== "string") { problems.push("no such line in content: " + k.key); continue; }
  if (typeof k.text !== "string") { problems.push("no text for " + k.key); continue; }
  if (o[last] !== k.text) { o[last] = k.text; s.changed = true; touched.text++; }
  const size = Number(k.size) || 1;
  const sizes = s.data.sizes || {};
  if (size !== 1) { if (sizes[p] !== size) { sizes[p] = size; s.data.sizes = sizes; s.changed = true; touched.size++; } }
  else if (p in sizes) { delete sizes[p]; if (!Object.keys(sizes).length) delete s.data.sizes; s.changed = true; touched.size++; }
}
if (copy.orphans && copy.orphans.length) problems.push("the live deck has edits for lines that no longer exist: " + copy.orphans.map((x) => x.key).join(", "));
for (const s of slides) if (s.changed) fs.writeFileSync(path.join(slideDir, s.f), fmt(s.data) + "\n");

// ---- plan: scene indices in the export are the file numbers (the shipped order), so they map straight to ids
const pl = plan.plan;
if (!pl || !Array.isArray(pl.order) || !Array.isArray(pl.hidden)) problems.push("plan.json has no plan");
else {
  const toId = (i) => { if (!ids[i]) problems.push("plan names slide number " + i + " which does not exist"); return ids[i]; };
  const planFile = path.join(ROOT, "content/plan.json");
  const cur = JSON.parse(fs.readFileSync(planFile, "utf8"));
  const hid = pl.hidden.map(toId);
  const next = { order: pl.order.map(toId), hidden: hid, keepPhoneCard: (cur.keepPhoneCard || []).filter((id) => hid.includes(id)), autoplay: {} };   // live hides drop the card, except slides already kept
  const auto = remote && remote.state && remote.state.auto;
  if (auto && typeof auto === "object") { for (const id of ids) if (id in auto) next.autoplay[id] = !!auto[id]; }
  else for (const id of Object.keys(cur.autoplay || {})) next.autoplay[id] = cur.autoplay[id];
  if (JSON.stringify(cur) !== JSON.stringify(next)) { fs.writeFileSync(planFile, fmt(next) + "\n"); touched.plan++; }
}

// ---- polls: wording, answers and the slide each is asked on. The Rehearse polls come from the move4 slide, not from this file.
{
  const pollFile = path.join(ROOT, "content/polls.json");
  const cur = JSON.parse(fs.readFileSync(pollFile, "utf8"));
  for (const q of polls.questions || []) {
    if (/^rehearse\d$/.test(q.id)) continue;
    const mine = cur.find((x) => x.id === q.id);
    if (!mine) { problems.push("live poll " + q.id + " is not in content/polls.json"); continue; }
    for (const f of ["slide", "text"]) if (typeof q[f] === "string" && mine[f] !== q[f]) { mine[f] = q[f]; touched.polls++; }
    if (Array.isArray(q.options) && JSON.stringify(mine.options) !== JSON.stringify(q.options)) { mine.options = q.options.slice(); touched.polls++; }
  }
  if (touched.polls) fs.writeFileSync(pollFile, fmt(cur) + "\n");
}

console.log(`fold: ${touched.text} lines, ${touched.size} sizes, ${touched.plan ? "plan changed" : "plan same"}, ${touched.polls} poll fields`);
if (problems.length) { console.error("fold problems:\n  " + problems.join("\n  ")); process.exit(1); }
