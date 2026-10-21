/* G9 editable copy, the part every slide page loads (projector, presenter, audience frame).
   The Worker has already put Aran's wording into the scene data, so text needs nothing here. This file does two small jobs:
   1. size: a scene may carry __cs = { "field.path": scale } for the paths whose size Aran changed; after each render the
      matching element gets its font size multiplied. Nothing else on the page is touched.
   2. on the presenter page (not the editor tab): every few seconds it asks whether the copy changed, and re-renders any
      slide that is not on screen right now. The slide on screen updates the moment the presenter moves off it.
   Every step is wrapped: if anything here fails, the slide stays exactly as shipped. */
(function () {
"use strict";
if (window.CopyTags) return;
const norm = (s) => String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, "");
const SKIP_UI = ".ce-ui,.maisie-ui,.maisie-dock";

/* find the element that shows the text at each path: the deepest element whose letters and digits equal the text
   (the engine may split a title into words or put a highlight inside it; letters survive that). Returns path -> [elements]. */
function locate(el, pairs) {
  const all = [...el.querySelectorAll("*")].filter((x) => !x.closest(SKIP_UI) && x.tagName !== "SCRIPT" && x.tagName !== "STYLE");
  const txt = new Map(all.map((x) => [x, norm(x.textContent)]));
  const taken = new Set(), out = {};
  for (const [path, value] of pairs) {
    const want = norm(value); if (!want) continue;
    let m = all.filter((x) => txt.get(x) === want);
    if (!m.length) m = all.filter((x) => { const t = txt.get(x); return t.length <= want.length + 14 && t.includes(want); });
    m = m.filter((x) => !m.some((y) => y !== x && x.contains(y)));     /* the deepest only */
    const free = m.filter((x) => !taken.has(x));
    const pick = free.length ? [free[0]] : [];                          /* the same words twice: one element per path, in order */
    pick.forEach((x) => taken.add(x));
    if (pick.length) out[path] = pick;
  }
  return out;
}
function size(x, scale) {
  if (!x.dataset.copyBase) { x.style.fontSize = ""; x.dataset.copyBase = String(parseFloat(getComputedStyle(x).fontSize) || 0); }
  const b = +x.dataset.copyBase;
  if (b > 0) x.style.fontSize = scale && scale !== 1 ? (b * scale).toFixed(1) + "px" : "";
}
/* tag one rendered scene: data-copy-key on each element found, sizes applied. pairs: [[path, text]] */
function tag(el, s, pairs) {
  if (!el || !s) return {};
  const found = locate(el, pairs);
  const cs = s.__cs || {};
  for (const [path, list] of Object.entries(found)) list.forEach((x) => {
    x.setAttribute("data-copy-key", s.id + "." + path);
    if (cs[path] || x.dataset.copyBase) size(x, cs[path] || 1);
  });
  return found;
}
const getAt = (o, path) => path.split(".").reduce((a, k) => (a == null ? a : a[k]), o);
/* the sized paths of a scene, with their current text */
const sizedPairs = (s) => Object.keys(s.__cs || {}).map((p) => [p, getAt(s, p)]).filter((x) => typeof x[1] === "string");

/* re-tag when the engine fills text in later (typing, a sequence playing): only on scenes that carry sizes */
const watchers = new WeakMap();
function watch(el, s) {
  const old = watchers.get(el); if (old) old.disconnect();
  if (!s.__cs || !window.MutationObserver) return;
  let t = 0;
  const mo = new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => { try { mo.disconnect(); tag(el, s, sizedPairs(s)); mo.observe(el, OPTS); } catch (e) {} }, 120); });
  const OPTS = { childList: true, subtree: true, characterData: true };
  mo.observe(el, OPTS); watchers.set(el, mo);
}
window.CopyTags = { norm, locate, tag, size, getAt };

/* the hook on every render; the engine renders all scenes once at load, so walk them now as well */
const hook = (el, s) => { try { if (s && s.__cs) { tag(el, s, sizedPairs(s)); watch(el, s); } } catch (e) { /* shipped look */ } };
window.SCENE_HOOKS = window.SCENE_HOOKS || [];
window.SCENE_HOOKS.push(hook);
try { document.querySelectorAll("#stage > section.scene").forEach((el, k) => { const s = (typeof SCENES !== "undefined" && SCENES[k]) || null; if (s && s.__cs) requestAnimationFrame(() => hook(el, s)); }); } catch (e) {}

/* ---- presenter page only (not the editor tab, not the audience): follow edits made in the editor tab or by Maisie ---- */
if (window.LIVE_VIEW !== "presenter" || window.__COPY_EDIT || !window.LiveDeck || typeof SCENES === "undefined") return;
let v = -1, ship = null, pend = new Set(), busy = false;
const setAt = (o, path, val) => { const p = path.split("."), last = p.pop(), t = p.reduce((a, k) => (a == null ? a : a[k]), o); if (t && typeof t[last] === "string") { t[last] = val; return true; } return false; };
function render(i) { try { window.rerenderScene(i); } catch (e) {} }
function applyAll(ov) {
  const byId = {}; SCENES.forEach((s, i) => { if (s && s.id) byId[s.id] = i; });
  const touched = new Set();
  for (const key of Object.keys(ship || {})) {
    const k = key.indexOf("."), id = key.slice(0, k), path = key.slice(k + 1), i = byId[id]; if (i == null) continue;
    const s = SCENES[i], o = ov[key] || {}, text = typeof o.text === "string" ? o.text : ship[key];
    if (getAt(s, path) !== text && setAt(s, path, text)) touched.add(i);
    const cs = s.__cs || {}, want = o.size && o.size !== 1 ? o.size : 0;
    if ((cs[path] || 0) !== want) { if (want) cs[path] = want; else delete cs[path]; s.__cs = Object.keys(cs).length ? cs : undefined; if (!s.__cs) delete s.__cs; touched.add(i); }
  }
  touched.forEach((i) => { if (i === LiveDeck.slide()) pend.add(i); else render(i); });
}
LiveDeck.on("slide", () => { const now = LiveDeck.slide(); [...pend].forEach((i) => { if (i !== now) { pend.delete(i); render(i); } }); });
async function tick() {
  if (busy || document.visibilityState === "hidden") return;
  busy = true;
  try {
    const r = await fetch("/api/copy/live?since=" + v + (ship ? "" : "&ship=1"), { credentials: "same-origin", cache: "no-store" });
    if (r.ok) {
      const j = await r.json();
      if (j && !j.same && j.ov) { if (j.ship) ship = j.ship; if (ship) applyAll(j.ov); v = j.v; }   /* idempotent: the page already carries the copy it was served with */
      else if (j && typeof j.v === "number") v = j.v;
    }
  } catch (e) { /* offline: keep what is on screen */ }
  busy = false;
}
setTimeout(tick, 1500); setInterval(tick, 4000);
})();
