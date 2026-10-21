// G9 editable copy: which strings in a scene are slide copy, and the stable key of each one.
// A key is the scene id plus the field path inside that scene, for example "cover.title",
// "ladder.steps.1.2" or "move4.talk.3.line". It never depends on the words themselves, so a
// rewrite of the shipped wording keeps every key (and every override Aran made) in place.
// Shared by build.mjs (writes src/generated/copy.json) and the Worker (applies overrides).

// fields that are never copy: ids, types, pacing, images, links, speaker notes, alt text, tick ids
const SKIP = new Set(["id", "t", "builds", "notes", "p", "ticks", "tiles", "img", "src", "bg", "alt", "href", "url",
  "poll", "autoplay", "video", "poster", "cls", "class", "icon", "who", "kind", "mode", "layout", "__cs",
  "verdict"]);   // Rehearse picks: verdict is best | ok | weak, a rule, not words
// words in the scene data that the slide never draws (the Where slide is one fixed drawing: its subtitle, bottom line and the two
// column heads are in the data for the notes and the app, not on the screen), so they are not offered for editing
const NOT_DRAWN = new Set(["where.sub", "where.hl", "where.cols.0.h", "where.cols.1.h"]);
// an empty string counts: a line Aran blanked in the editor stays a line (and a key) when the repo ships it blank
const isCopy = (v) => typeof v === "string" && (v === "" || /[A-Za-z]/.test(v)) && !/^(img\/|https?:|\/)/.test(v.trim());

// every [path, text] pair of copy in one scene, in document order
export function copyLeaves(scene) {
  const out = [];
  const walk = (v, path) => {
    if (typeof v === "string") { if (isCopy(v) && !NOT_DRAWN.has(scene.id + "." + path)) out.push([path, v]); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, path + "." + i)); return; }
    if (v && typeof v === "object") for (const k of Object.keys(v)) { if (!SKIP.has(k) && k[0] !== "_") walk(v[k], path ? path + "." + k : k); }
  };
  if (scene && typeof scene === "object") for (const k of Object.keys(scene)) { if (!SKIP.has(k) && k[0] !== "_") walk(scene[k], k); }   // _readme and other _ fields are notes, not copy
  return out;
}

// split "move4.talk.3.line" into the scene id and the path inside it (scene ids carry no dots)
export function splitKey(key) {
  const s = String(key || ""), k = s.indexOf(".");
  return k <= 0 ? null : { id: s.slice(0, k), path: s.slice(k + 1).split(".") };
}

// read or write one path inside a scene object; both return undefined/false when the path is not there
export function getPath(obj, path) {
  let o = obj;
  for (const p of path) { if (o == null || typeof o !== "object" || !Object.prototype.hasOwnProperty.call(o, p)) return undefined; o = o[p]; }
  return o;
}
export function setPath(obj, path, val) {
  let o = obj;
  for (let i = 0; i < path.length - 1; i++) { if (o == null || typeof o !== "object" || !Object.prototype.hasOwnProperty.call(o, path[i])) return false; o = o[path[i]]; }
  const last = path[path.length - 1];
  if (o == null || typeof o !== "object" || typeof o[last] !== "string") return false;
  o[last] = val;
  return true;
}

// a short human label for one key, for the editor list ("Title", "Steps 2, line 3", "Talk 4")
export function labelOf(path) {
  const NAMES = { title: "Title", em: "Highlighted words", kick: "Kicker", sub: "Subtitle", hl: "Bottom line", foot: "Footer",
    meta: "Byline", body: "Body", cols: "Card", items: "Item", steps: "Step", moves: "Move", roles: "Role", blocks: "Block",
    assume: "Assumption", curve: "Curve label", contact: "Contact", talk: "Conversation", line: "line", h: "heading", t: "text",
    blockH: "Block heading", portrait: "Portrait", cap: "caption" };
  return path.map((p) => (/^\d+$/.test(p) ? String(+p + 1) : NAMES[p] || p)).join(" ");
}
