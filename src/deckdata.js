// What each role may receive. The full deck lives only inside the Worker bundle (src/generated).
// Audience pages are assembled per request: the current scene in full, every other scene as an
// empty placeholder, no speaker notes, no future checklist text.
import DECK from "./generated/deck.json";
import SCENES from "./generated/scenes.json";
import CONTENT from "./generated/content.json";
import BRAND from "../content/brand.json";
import PLAN from "../content/plan.json";

export { DECK, SCENES, CONTENT, BRAND };
export const N = SCENES.length;

export const sceneId = (i) => (SCENES[i] && SCENES[i].id) || "s" + i;
export const indexOfId = (id) => SCENES.findIndex((s, i) => sceneId(i) === id);

const strip = (s) => {
  const { notes, ...rest } = s;
  return rest;
};

// Data for an audience frame showing scene i.
export function audienceData(i) {
  const cur = SCENES[i];
  const scenes = SCENES.map((s, k) => (k === i ? strip(s) : { id: "s" + k, t: "statement" }));
  if (cur.t === "move") {
    // the move slides draw a four-name rail from the "system" scene; send only the names, and only here
    const k = SCENES.findIndex((x) => x.id === "system");
    if (k >= 0) scenes[k] = { id: "system", t: "statement", moves: (SCENES[k].moves || []).map((m) => [m[0], m[1]]) };
  }
  const ticks = new Set(cur.ticks || []);
  const chapters = DECK.chapters.map((c) => ({
    n: c.n, t: "", q: "", mins: "", url: "", line: "",
    reqs: (c.reqs || []).filter((r) => ticks.has(r[0])),
  }));
  const outcomes = {};
  ticks.forEach((q) => { if (DECK.outcomes && DECK.outcomes[q]) outcomes[q] = DECK.outcomes[q]; });
  const deck = {
    ...DECK, chapters, outcomes, stories: [], polls: [], cameo: [], team: [],
    prompts: (DECK.prompts || []).filter((p) => p.id === cur.p),
  };
  return { deck, scenes };
}

export function presenterData() {
  return { deck: DECK, scenes: SCENES };
}

// A JS literal that is safe inside an inline <script>.
export const jsLit = (v) =>
  JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

// A hidden slide's words leave every audience surface (unhiding brings them back), unless the slide is listed in keepPhoneCard in content/plan.json
// (the confession and the three one-move slides ship hidden and keep their approved phone lines).
const DEFAULT_HIDDEN = new Set(SCENES.map((s, i) => (s.hidden ? i : -1)).filter((i) => i >= 0));   // the build sets hidden from content/plan.json
// The shipped walking order: content/plan.json order, as scene indices (a slide the file leaves out goes last). Scene index itself never changes.
export const DEFAULT_ORDER = (() => {
  const ids = SCENES.map((s, i) => sceneId(i)), seen = new Set(), out = [];
  for (const id of PLAN.order || []) { const i = ids.indexOf(id); if (i >= 0 && !seen.has(i)) { seen.add(i); out.push(i); } }
  ids.forEach((_, i) => { if (!seen.has(i)) out.push(i); });
  return out;
})();
export const DEFAULT_HIDDEN_LIST = [...DEFAULT_HIDDEN];
// Which slides keep their phone card and lines although they are hidden on screen: content/plan.json "keepPhoneCard" (slide ids).
export const KEEP_CARD = new Set((PLAN.keepPhoneCard || []).map((id) => SCENES.findIndex((s, i) => sceneId(i) === id)).filter((i) => i >= 0));
// Hidden slides whose words leave every audience surface: the hidden ones minus keepPhoneCard (same rule for the repo plan and a plan saved from the editor).
export const extraHidden = (hiddenList) => new Set((Array.isArray(hiddenList) ? hiddenList : []).filter((i) => Number.isInteger(i) && !KEEP_CARD.has(i)));
// The slide a checklist line belongs to: where it first shows, except the four Move lines, which belong to their own move slides
const REQ_OWNER = { M1: "move1", M2: "move2", M3: "move3", M4: "move4" };
const reqOwner = (id) => (REQ_OWNER[id] ? indexOfId(REQ_OWNER[id]) : CONTENT.sceneOfReq[id]);

// The slide numbers a chapter card shows ("Slide 4", "Slides 6 and 7", "Slides 9 to 11"), counted the way the deck is shown now.
const slideLabel = (nums) => {
  if (!nums.length) return "";
  if (nums.length === 1) return "Slide " + nums[0];
  if (nums.length === 2) return `Slides ${nums[0]} and ${nums[1]}`;
  return nums.every((x, i) => !i || x === nums[i - 1] + 1) ? `Slides ${nums[0]} to ${nums[nums.length - 1]}` : `Slides ${nums.slice(0, -1).join(", ")} and ${nums[nums.length - 1]}`;
};

// The checklist as the audience may see it, given which scenes have been reached and the plan (walking order and hidden set) now.
// The cards follow the plan: its order and its shown numbering. A card's n stays its stable id (today's default numbering), because a
// phone keeps notes under "ch-" + n and a reorder or a hide must never move a note onto another card; pos is the position to show.
// With the shipped plan nothing here changes the shipped cards, labels included.
export function audienceContent(reachedList, doneList, plan) {
  const reached = new Set(reachedList), done = new Set(doneList);
  const order = plan && Array.isArray(plan.order) ? plan.order : DEFAULT_ORDER, hiddenNow = new Set(plan && plan.hidden ? plan.hidden : [...DEFAULT_HIDDEN]);
  const gone = extraHidden([...hiddenNow]);
  const shipped = order.every((k, i) => k === i) && hiddenNow.size === DEFAULT_HIDDEN.size && [...hiddenNow].every((k) => DEFAULT_HIDDEN.has(k));
  const at = new Map(order.map((k, i) => [k, i]));                                 // where each scene sits in the walking order
  const shownNo = new Map(order.filter((k) => !hiddenNow.has(k)).map((k, i) => [k, i + 1]));   // its number among the shown slides
  const showReq = (id) => done.has(id) || (id in CONTENT.sceneOfReq && reached.has(CONTENT.sceneOfReq[id]));
  const members = CONTENT.chapters.map(() => []);
  CONTENT.chapterOfScene.forEach((c, i) => { if (members[c]) members[c].push(i); });
  const firstScene = {};
  CONTENT.chapterOfScene.forEach((c, i) => { if (!(c in firstScene)) firstScene[c] = i; });
  const early = (ci) => Math.min(...members[ci].map((k) => (at.has(k) ? at.get(k) : k)));   // a card sits where its first slide sits
  const chapters = [];
  CONTENT.chapters.map((c, ci) => ({ c, ci })).sort((x, y) => early(x.ci) - early(y.ci) || x.ci - y.ci).forEach(({ c, ci }) => {
    const reqs = c.reqs.filter((r) => !gone.has(reqOwner(r.id)));
    if (c.reqs.length && !reqs.length) return;                      // every line of this chapter belongs to a hidden slide: no card
    const any = reqs.some((r) => showReq(r.id));
    const q = shipped ? c.q : slideLabel(members[ci].filter((k) => shownNo.has(k)).map((k) => shownNo.get(k)).sort((x, y) => x - y));
    chapters.push({
      n: c.n, pos: String(chapters.length + 1).padStart(2, "0"), title: any ? c.title : "Coming up", q: any ? q : "", mins: "", url: "", hi: false, use: null,
      line: any && reached.has(firstScene[ci]) && !gone.has(firstScene[ci]) ? c.line : "",
      reqs: reqs.map((r) => (showReq(r.id) ? r : { id: r.id, text: "Not shown yet", hi: false, outcome: "" })),
    });
  });
  const prompts = CONTENT.prompts.filter((p) => reached.has(CONTENT.sceneOfPrompt[p.id]) && !gone.has(CONTENT.sceneOfPrompt[p.id]))
    .sort((x, y) => (at.get(CONTENT.sceneOfPrompt[x.id]) ?? 99) - (at.get(CONTENT.sceneOfPrompt[y.id]) ?? 99));   // prompts follow the order the moves are walked
  return { chapters, total: CONTENT.total, prompts, polls: [] };
}

export function presenterContent() {
  return { chapters: CONTENT.chapters, total: CONTENT.total, prompts: CONTENT.prompts, polls: [] };
}

// Images
const imgRe = /img\/([A-Za-z0-9._-]+)/g;
const sceneImg = SCENES.map((s) => new Set([...JSON.stringify(s).matchAll(imgRe)].map((m) => m[1])));
export const OPEN_IMG = new Set(["maisie-avatar.jpg"]);
(BRAND.logos || []).forEach((l) => [l.src, l.dark].forEach((f) => f && OPEN_IMG.add(String(f).split("/").pop())));
export const imagesOfScene = (i) => sceneImg[i] || new Set();
