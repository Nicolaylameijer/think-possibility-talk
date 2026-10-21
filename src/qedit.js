// ---- v4 a17 q: the editable question list.
// src/questions.js stays Aran's original list. The Event core may hold an edited copy (core.questions);
// null means the original. The set of question ids is fixed: the editor changes the words, the
// answer options, the type, the slide a question is sent at and the order, but never adds or deletes one
// (the closing chart needs the two scale questions "cover" and "close" to exist).
// A saved list is [{ id, slide, text, type, options }] for every id. The effective list adds n (the
// number shown on the phone) and follow (the note prompt), and is sorted by the slide plan.
import { QUESTIONS, rehearsePolls } from "./questions.js";
import { SCENES, sceneId } from "./deckdata.js";
import { effective } from "./plan.js";

export const TYPES = ["poll", "choice"];   // round 2: open text and Ask a question are removed with the Questions feature; a saved text or ask becomes its default type
export const TYPE_NAMES = { poll: "Poll", choice: "Multiple choice" };
export const MAX_OPT = 6, MIN_OPT = 2, MAX_TEXT = 120, MAX_WORD = 40;
// Aran's scale questions are Polls (pick one point on a scale); the rest are lists of choices.
const POLLS = new Set(["cover", "close"]);   // round 2: the final list (movecheck is a choice; readiness is rows; Rehearse is derived)
// The two Today / a month from now questions share one five point scale: the closing chart compares them.
export const LOCKED = new Set(["cover", "close"]);

const IDS = SCENES.map((s, i) => sceneId(i));
// round 2: every poll the room can get. Aran's list plus the three Rehearse polls derived from the move4 scene.
// Derived polls are not edited here (the editor changes the scene lines) and are never stored in a saved list.
export const ALL = QUESTIONS.concat(rehearsePolls(SCENES.find((x) => x.id === "move4")));
const DEF = new Map(ALL.map((q) => [q.id, q]));
const derived = (id) => !!(DEF.get(id) && DEF.get(id).manual && /^rehearse\d$/.test(id));
const fixed = (id) => { const d = DEF.get(id); return { ...d, type: defaultType(id), options: d.options.slice() }; };
export const defaultType = (id) => (DEF.get(id) && DEF.get(id).type === "rows" ? "rows" : POLLS.has(id) ? "poll" : "choice");   // round 2: readiness keeps its two rows type
export const defaultList = () => QUESTIONS.map((q) => ({ id: q.id, slide: q.slide, text: q.text, type: defaultType(q.id), options: q.options.slice() }));

const tidy = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

// A request body -> a clean saved list, or null for "back to the original".
export function cleanQuestions(body) {
  if (!body || body.reset === true) return null;
  const src = Array.isArray(body.questions) ? body.questions : [];
  const seen = new Set(), got = [];
  for (const r of src) {
    if (!r || typeof r !== "object" || typeof r.id !== "string" || !DEF.has(r.id) || derived(r.id) || seen.has(r.id)) continue;
    seen.add(r.id);
    const d = DEF.get(r.id), lock = LOCKED.has(r.id);
    const slide = typeof r.slide === "string" && IDS.includes(r.slide) ? r.slide : d.slide;
    const text = tidy(r.text, MAX_TEXT) || d.text;
    const type = lock ? "poll" : d.type === "rows" ? "rows" : TYPES.includes(r.type) ? r.type : defaultType(r.id);
    let options = Array.isArray(r.options) ? r.options.map((w) => tidy(w, MAX_WORD)).filter(Boolean).slice(0, MAX_OPT) : [];
    if (lock || d.type === "rows" ? options.length !== 5 : options.length < MIN_OPT) options = d.options.slice();
    got.push({ id: r.id, slide, text, type, options });
  }
  for (const q of QUESTIONS) if (!seen.has(q.id)) got.push(defaultList().find((x) => x.id === q.id));
  const cover = got.find((x) => x.id === "cover"), close = got.find((x) => x.id === "close");
  close.options = cover.options.slice();   // one shared scale
  const rd = got.find((x) => x.id === "readiness"); if (rd) rd.options = cover.options.slice();   // round 2: readiness rows are cover and close
  return JSON.stringify(got) === JSON.stringify(defaultList()) ? null : got;
}

// The list the room uses. Unsaved: Aran's original array, untouched. Saved: sorted by where each
// question's slide sits in the current plan (stable, so the order inside a slide is kept) and numbered from 1.
export function effQuestions(saved, plan, m4) {
  // round 2: m4 is the move4 scene with the editor's wording (deck2edit this.copy.scene("move4")); its picks become the Rehearse buttons
  const re = m4 ? new Map(rehearsePolls(m4).map((q) => [q.id, q])) : null;
  const live = (q) => (re && derived(q.id) ? (re.has(q.id) ? { ...q, text: re.get(q.id).text, options: re.get(q.id).options.slice() } : null) : q);
  // no saved list: the shipped polls (content/polls.json plus the derived Rehearse polls) go through the same sort and numbering as a saved list,
  // so the repo's list reads exactly like the list Aran saved: by where each poll's slide sits in the plan, numbered from 1
  if (!saved) saved = ALL.map((q) => fixed(q.id));
  // round 2: a list saved before the cut can still hold a removed id or a text / ask type; drop the one, default the other
  // round 2: an older save lacks readiness and the derived Rehearse polls; they come from the source every time
  const keep = new Set(saved.filter((q) => q && DEF.has(q.id) && !derived(q.id)).map((q) => q.id));
  saved = saved.filter((q) => q && keep.has(q.id)).concat(ALL.filter((q) => !keep.has(q.id)).map((q) => fixed(q.id)));
  saved = saved.map((q) => (DEF.get(q.id).type === "rows" || derived(q.id) ? { ...fixed(q.id), slide: q.slide, text: derived(q.id) ? DEF.get(q.id).text : q.text } : TYPES.includes(q.type) && Array.isArray(q.options) && q.options.length >= MIN_OPT ? q : { ...q, type: defaultType(q.id), options: DEF.get(q.id).options.slice() }));
  { const cv = saved.find((q) => q.id === "cover"); if (cv) saved = saved.map((q) => (DEF.get(q.id).type === "rows" ? { ...q, options: cv.options.slice() } : q)); }   // round 2: the readiness rows are cover and close, so they show the cover words as edited
  const pos = new Map();
  effective(plan).order.forEach((k, p) => pos.set(sceneId(k), p));
  const sorted = saved.map((q, i) => ({ q, i })).sort((a, b) => ((pos.get(a.q.slide) ?? 99) - (pos.get(b.q.slide) ?? 99)) || (a.i - b.i)).map((x) => x.q);
  return sorted.map((q, k) => {
    const d = DEF.get(q.id);
    const type = q.type, hasOpts = type === "poll" || type === "choice" || type === "rows";
    const same = JSON.stringify(q.options) === JSON.stringify(d.options);
    const follow = !hasOpts ? null : same ? d.follow : (typeof d.follow === "string" ? d.follow : null);
    const out = { id: q.id, slide: q.slide, n: String(k + 1), text: q.text, type, options: q.options.slice(), follow };
    for (const f of ["part", "manual", "rows", "liveOn"]) if (d[f] !== undefined) out[f] = d[f];   // round 2 poll flags ride along
    return out;
  }).map(live).filter(Boolean);
}

// A short token that changes whenever the effective list can change (a save, or a plan change while a list is saved)
// round 2: plus the move4 copy version (core.m4v, set by src/copy.js), so an edited Rehearse reply line reaches open phones;
// other copy edits leave it alone, so the room is not asked to refetch for nothing. "0" still means the shipped list in the shipped plan
// (the unsaved list follows the plan order too, so a saved plan changes the token).
export const qVersion = (c) => (c.questions || c.plan ? (c.qver || 0) + ":" + effective(c.plan).order.join(".") : "0") + (c.m4v ? ":c" + c.m4v : "");
