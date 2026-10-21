/* G9 editable copy: the editor. Served only to a presenter session, only on the editor tab (/?edit=1).
   That tab is a private copy of the deck: it does not load presenter.js and cannot write localStorage, so moving
   around in it never moves the room. Aran clicks any outlined text on a slide and types; Enter saves, Esc cancels.
   The panel on the right lists every piece of copy on the slide, with size, reset, the history and Maisie's key.
   Saved copy reaches the projector and the phones without a reload of the deck (see copy.js and shell.js). */
(function () {
"use strict";
if (!window.__COPY_EDIT || !window.LiveDeck || !window.CopyTags || typeof SCENES === "undefined") return;
try { const q = new URLSearchParams(location.search); if (q.get("builds") !== "all") { q.set("builds", "all"); location.replace(location.pathname + "?" + q.toString()); return; } } catch (e) {}
const D = window.LiveDeck, T = window.CopyTags;
const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => [...(r || document).querySelectorAll(s)];
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sceneEl = (i) => $$("#stage > section.scene")[i] || null;
const idx = {}; SCENES.forEach((s, i) => { if (s && s.id) idx[s.id] = i; });
const MIN = 0.6, MAX = 1.6, STEP = 0.1;

/* ---- look: the shared app tokens (private/ui.css), scoped to the panel so the slides keep their own ---- */
const css = `
.ce-ui{--brand:#e25c0f;--brand-strong:#c44a06;--amber:#e7a23c;--navy:#15233b;--navy-deep:#0f1a2e;--navy-2:#1d2d4a;--paper:#f7f1e8;--paper-2:#efe7da;
 --white:#fff;--green:#1E7A3C;--ink:#15233b;--ink-2:#46536b;--ink-3:#6b7689;--line:rgba(21,35,59,.10);--sans:'Public Sans',system-ui,-apple-system,'Segoe UI',sans-serif;
 --serif:'Fraunces',Georgia,serif;--r-sm:10px;--r:16px;--r-pill:999px;--shadow:0 1px 2px rgba(15,26,46,.06),0 8px 24px rgba(15,26,46,.08);--focus:0 0 0 3px var(--amber);
 font-family:var(--sans);color:var(--ink);font-size:15px;line-height:1.45;box-sizing:border-box}
.ce-ui *{box-sizing:border-box}
body.ce-on #viewport{right:420px!important}
#ce-panel{position:fixed;top:0;right:0;bottom:0;width:420px;z-index:9000;background:var(--paper);display:flex;flex-direction:column;box-shadow:-12px 0 40px rgba(0,0,0,.35)}
body:not(.ce-on) #ce-panel{display:none}
#ce-panel header{padding:18px 20px 14px;background:var(--navy);color:#fff}
#ce-panel header h2{margin:0;font:600 22px/1.15 var(--serif);color:#fff}
#ce-panel header p{margin:6px 0 0;color:rgba(255,255,255,.75);font-size:13px}
.ce-nav{display:flex;align-items:center;gap:8px;margin-top:14px}
.ce-nav b{flex:1;font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ce-ui button{font:600 14px var(--sans);border:0;border-radius:var(--r-pill);padding:9px 14px;cursor:pointer;background:var(--paper-2);color:var(--ink)}
.ce-ui button:focus-visible,.ce-ui textarea:focus-visible{outline:none;box-shadow:var(--focus)}
.ce-ui button:disabled{opacity:.45;cursor:default}
.ce-ui button.pri{background:var(--brand-strong);color:#fff}
.ce-ui button.ghost{background:transparent;color:var(--ink-2);padding:6px 10px}
.ce-nav button{background:rgba(255,255,255,.12);color:#fff;padding:8px 12px}
#ce-status{padding:9px 20px;font-size:13px;color:var(--ink-2);border-bottom:1px solid var(--line);min-height:37px}
#ce-status.err{background:#fde8dc;color:#8a2c00}
#ce-status.ok{color:var(--green)}
#ce-list{flex:1;overflow:auto;padding:14px 16px 20px}
.ce-row{background:var(--white);border-radius:var(--r);padding:12px 14px;margin-bottom:10px;box-shadow:var(--shadow);border:2px solid transparent}
.ce-row.hot{border-color:var(--brand)}
.ce-row .lab{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--ink-3)}
.ce-row .lab .on{width:8px;height:8px;border-radius:50%;background:var(--brand)}
.ce-row .lab .chip{margin-left:auto;text-transform:none;letter-spacing:0;font-weight:600;color:var(--brand-strong)}
.ce-row textarea{width:100%;margin:8px 0 6px;border:1px solid var(--line);border-radius:var(--r-sm);padding:9px 10px;font:16px/1.4 var(--sans);color:var(--ink);background:var(--paper);resize:vertical;min-height:44px}
.ce-row .tools{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.ce-row .tools .sz{font-size:13px;color:var(--ink-2);min-width:74px}
.ce-row .tools .sp{flex:1}
.ce-row .ship{margin-top:8px;font-size:13px;color:var(--ink-3)}
.ce-row .warn{margin-top:8px;font-size:13px;color:#8a2c00}
.ce-key{font:12px ui-monospace,Menlo,monospace;color:var(--ink-3)}
#ce-foot{padding:12px 16px;border-top:1px solid var(--line);display:flex;gap:8px;flex-wrap:wrap;background:var(--paper)}
#ce-drawer{max-height:46vh;overflow:auto;padding:12px 16px;border-top:1px solid var(--line);background:var(--white)}
#ce-drawer[hidden]{display:none}
#ce-drawer h3{margin:4px 0 10px;font:600 17px var(--serif)}
.ce-ver{padding:10px 0;border-bottom:1px solid var(--line);font-size:13px}
.ce-ver .top{display:flex;gap:8px;align-items:center}.ce-ver .top b{flex:1}
.ce-ver ul{margin:6px 0 0;padding-left:18px;color:var(--ink-2)}
.ce-tok{font:13px ui-monospace,Menlo,monospace;background:var(--paper);padding:8px 10px;border-radius:var(--r-sm);word-break:break-all;margin:8px 0}
#ce-open{position:fixed;right:16px;bottom:60px;z-index:9000;display:none}
body:not(.ce-on) #ce-open{display:block}
html.proj,html.proj body{cursor:default!important}
body.ce-on #stage [data-copy-key]{outline:2px dashed rgba(231,162,60,.75);outline-offset:3px;cursor:text}
body.ce-on #stage [data-copy-key]:hover,body.ce-on #stage [data-copy-key].ce-hover{outline:3px solid #e7a23c;background:rgba(231,162,60,.12)}
body.ce-on #stage.ce-text,body.ce-on #stage.ce-text *{cursor:text!important}
#ce-banner{position:fixed;top:12px;left:12px;right:432px;z-index:8999;display:flex;align-items:center;gap:14px;padding:12px 16px;background:var(--navy);color:#fff;border-radius:var(--r);box-shadow:var(--shadow);font-size:16px;line-height:1.35}
#ce-banner[hidden],body:not(.ce-on) #ce-banner{display:none}
#ce-banner{pointer-events:none}#ce-banner button{pointer-events:auto}
#ce-banner b{font-weight:700}#ce-banner span{flex:1}
#ce-banner button{background:var(--brand-strong);color:#fff}
.ce-row .ce-save{background:var(--brand-strong);color:#fff}
.ce-row .ce-save:disabled{opacity:.5}
body.ce-on #stage [data-copy-key].ce-flash{outline:3px solid #e25c0f}
.ce-tabs{display:flex;gap:6px;padding:10px 16px;border-bottom:1px solid var(--line);background:var(--paper)}
.ce-tabs button{flex:1}.ce-tabs button[aria-selected=true]{background:var(--navy);color:#fff}
#ce-slides,#ce-polls{flex:1;overflow:auto;padding:14px 16px 20px}#ce-slides[hidden],#ce-polls[hidden],#ce-list[hidden],#ce-foot[hidden]{display:none}
.ce-sl{list-style:none;margin:0;padding:0}.ce-sl li{display:flex;align-items:center;gap:6px;background:var(--white);border-radius:var(--r-sm);padding:8px 10px;margin-bottom:6px;box-shadow:var(--shadow);border:2px solid transparent;cursor:grab}
.ce-sl li.drag{border-color:var(--brand)}.ce-sl .n{width:24px;font-weight:700;color:var(--ink-3);font-size:13px}.ce-sl .t{flex:1;min-width:0;font-size:14px;line-height:1.3;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.ce-sl.off li{cursor:default;opacity:.8}.ce-sl button{padding:6px 10px;font-size:13px}
.ce-h{margin:16px 0 8px;font:700 12px var(--sans);letter-spacing:.04em;text-transform:uppercase;color:var(--ink-3)}
.ce-poll input[type=text],.ce-poll select{width:100%;max-width:100%;min-width:0;margin:8px 0 0;border:1px solid var(--line);border-radius:var(--r-sm);padding:9px 10px;font:15px/1.3 var(--sans);color:var(--ink);background:var(--paper)}
.ce-poll .two{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.ce-poll .two select{flex:1 1 100%;width:100%;min-width:0;max-width:100%;text-overflow:ellipsis}.ce-poll .two select[aria-label=Type]{flex:0 0 auto}.ce-poll .fix{margin-top:8px;font-size:13px;color:var(--ink-3)}
.ce-poll .orow{display:flex;gap:6px;align-items:center}.ce-poll .orow input{flex:1}.ce-poll .opts{margin-top:4px}.ce-poll .opts>button{margin-top:8px}
body.ce-on #stage .ce-editing{outline:3px solid #e25c0f!important;background:rgba(255,255,255,.92)!important;color:#15233b!important;-webkit-text-fill-color:#15233b!important;cursor:text}`;
const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

/* ---- the panel ---- */
const P = document.createElement("aside");
P.id = "ce-panel"; P.className = "ce-ui"; P.setAttribute("aria-label", "Edit slide text");
P.innerHTML = `<header><h2>Edit slide text</h2><p><b style="color:#fff">Click any outlined text on the slide, type, press Enter to save, Esc to cancel.</b> Saved copy reaches the screen and phones in a few seconds.</p>
<div class="ce-nav"><button type="button" id="ce-prev" aria-label="Previous slide">&#8249;</button><b id="ce-where"></b><button type="button" id="ce-next" aria-label="Next slide">&#8250;</button><button type="button" id="ce-hide">Preview</button></div></header>
<div class="ce-tabs" role="tablist"><button type="button" role="tab" id="ce-tab-text" aria-selected="true">Text</button><button type="button" role="tab" id="ce-tab-slides" aria-selected="false">Slides</button><button type="button" role="tab" id="ce-tab-polls" aria-selected="false">Polls</button></div>
<div id="ce-status" role="status" aria-live="polite">Loading the copy</div>
<div id="ce-list"></div><div id="ce-slides" hidden></div><div id="ce-polls" hidden></div>
<div id="ce-drawer" hidden></div>
<div id="ce-foot"><button type="button" id="ce-hist">History</button><button type="button" id="ce-maisie">Maisie's key</button><span style="flex:1"></span><button type="button" id="ce-all" class="pri">Restore all shipped copy</button></div>`;
document.body.appendChild(P);
/* first run: say how to edit, over the slide, until it is dismissed */
const BN = document.createElement("div");
BN.id = "ce-banner"; BN.className = "ce-ui"; BN.setAttribute("role", "note");
BN.innerHTML = `<span><b>Click any dashed text to edit it.</b> Type, then press Enter to save. Prefer boxes? Every line on this slide is listed on the right: type in the box and press Save.</span><button type="button" id="ce-banner-ok">Got it</button>`;
try { if (sessionStorage.getItem("ce-banner") === "1") BN.hidden = true; } catch (e) {}
document.body.appendChild(BN);
$("#ce-banner-ok").onclick = () => { BN.hidden = true; try { sessionStorage.setItem("ce-banner", "1"); } catch (e) {} };
const OPEN = document.createElement("button");
OPEN.id = "ce-open"; OPEN.className = "ce-ui pri"; OPEN.type = "button"; OPEN.textContent = "Edit slide text";
document.body.appendChild(OPEN);
// the engine scales the slide to the whole window; with the panel open it has to fit the space left of the panel
const refit = () => {
  const st = document.getElementById("stage"), vp = document.getElementById("viewport");
  if (!st || !vp || !document.body.classList.contains("ce-on")) return;
  st.style.transform = `translate(-50%,-50%) scale(${Math.min(vp.clientWidth / 1440, vp.clientHeight / 810) * 0.97})`;
};
addEventListener("resize", refit);
const fit = () => { try { dispatchEvent(new Event("resize")); } catch (e) {} refit(); };
const setOn = (on) => { document.body.classList.toggle("ce-on", on); fit(); };
OPEN.onclick = () => setOn(true);
$("#ce-hide").onclick = () => setOn(false);
$("#ce-prev").onclick = () => D.go(Math.max(0, D.slide() - 1));
$("#ce-next").onclick = () => D.go(Math.min(D.count() - 1, D.slide() + 1));
setOn(true);

let data = null, byKey = {}, ver = -1, hot = "", editing = null;
function status(t, kind) { const s = $("#ce-status"); s.textContent = t; s.className = kind || ""; }
async function api(method, path, body) {
  try {
    const r = await fetch(path, { method, credentials: "same-origin", cache: "no-store",
      headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch (e) {}
    return { ok: r.ok, status: r.status, j: j || {} };
  } catch (e) { return { ok: false, status: 0, j: {} }; }
}

/* ---- scene data on this page follows the saved copy ---- */
const setAt = (o, path, val) => { const p = path.split("."), last = p.pop(), t = p.reduce((a, k) => (a == null ? a : a[k]), o); if (t && typeof t[last] === "string") { t[last] = val; return true; } return false; };
function applyKey(k, rerender) {
  const i = idx[k.scene]; if (i == null) return false;
  const s = SCENES[i], path = k.key.slice(k.scene.length + 1);
  let changed = false;
  if (T.getAt(s, path) !== k.text && setAt(s, path, k.text)) changed = true;
  const cs = s.__cs || {}, want = k.size && k.size !== 1 ? k.size : 0;
  if ((cs[path] || 0) !== want) { if (want) cs[path] = want; else delete cs[path]; if (Object.keys(cs).length) s.__cs = cs; else delete s.__cs; changed = true; }
  if (changed && rerender) { try { window.rerenderScene(i); } catch (e) {} }
  return changed;
}
function take(view) {
  data = view; ver = view.v; byKey = {};
  const touched = new Set();
  view.keys.forEach((k) => { byKey[k.key] = k; if (!(editing && editing.key === k.key) && applyKey(k, false)) touched.add(idx[k.scene]); });
  touched.forEach((i) => { try { window.rerenderScene(i); } catch (e) {} });
  paint();
}
async function load(quiet) {
  const r = await api("GET", "/api/copy");
  if (!r.ok) { status(r.status === 401 || r.status === 403 ? "Signed out. Log in as presenter again." : "The editor cannot reach the server. The slides keep the copy they have.", "err"); return false; }
  take(r.j);
  if (r.j.mode === "repo") { status("Read only: the words are edited in the repo now. Ask for a change there; nothing saved here would show.", "err"); return true; }
  if (!quiet) status(r.j.changed ? `${r.j.changed} piece${r.j.changed === 1 ? "" : "s"} of copy changed from shipped. Version ${r.j.v}.` : "Everything is the shipped copy.", "");
  return true;
}

/* ---- what is on the current slide ---- */
const keysOf = (i) => (data ? data.keys.filter((k) => k.scene === (SCENES[i] && SCENES[i].id)) : []);
function tagNow() {
  const i = D.slide(), el = sceneEl(i); if (!el || !data) return {};
  $$("[data-copy-key]", el).forEach((x) => x.removeAttribute("data-copy-key"));
  const s = SCENES[i];
  return T.tag(el, s, keysOf(i).map((k) => [k.key.slice(k.scene.length + 1), T.getAt(s, k.key.slice(k.scene.length + 1))]));
}
function paint() {
  const i = D.slide(), s = SCENES[i] || {};
  const nm = s.title || s.kick || s.id || "", pl = SL && SL.find((x) => x.id === s.id);   // one numbering: shown slides 1 to N as the Slides section counts them, a hidden slide reads Hidden
  if (pl) { const sh = SL.filter((x) => !x.hidden); $("#ce-where").textContent = pl.hidden ? `Hidden: ${nm}` : `Slide ${sh.indexOf(pl) + 1} of ${sh.length}: ${nm}`; }
  else $("#ce-where").textContent = s.hidden ? `Hidden: ${nm}` : `Slide ${i + 1} of ${D.count()}: ${nm}`;
  const found = tagNow(), list = $("#ce-list"), keys = keysOf(i);
  if (!keys.length) { list.innerHTML = `<p style="color:var(--ink-2)">No editable copy on this slide.</p>`; return; }
  const titleK = keys.find((k) => k.key === s.id + ".title"), emK = keys.find((k) => k.key === s.id + ".em");
  list.innerHTML = keys.map((k) => {
    const path = k.key.slice(k.scene.length + 1), pct = Math.round((k.size || 1) * 100);
    const lost = k === titleK && emK && emK.text && k.text.indexOf(emK.text) < 0;
    return `<div class="ce-row${hot === k.key ? " hot" : ""}" data-k="${esc(k.key)}">
<div class="lab">${found[path] ? '<i class="on" title="On the slide: click it there too"></i>' : ""}${esc(k.label)}${k.changed ? `<span class="chip">edited${k.by ? " by " + (k.by === "maisie" ? "Maisie" : "Aran") : ""}</span>` : ""}</div>
<textarea rows="${Math.min(6, Math.max(1, Math.ceil(k.text.length / 38)))}" aria-label="${esc(k.label)}" placeholder="Blank. Type to put words back." spellcheck="true">${esc(k.text)}</textarea>
<div class="tools"><span class="sz">Size ${pct}%</span><button type="button" data-a="dn" aria-label="Smaller"${k.size <= MIN ? " disabled" : ""}>A&#8722;</button><button type="button" data-a="up" aria-label="Bigger"${k.size >= MAX ? " disabled" : ""}>A+</button>
<span class="sp"></span><button type="button" class="ce-save" data-a="save">Save</button>${k.changed ? `<button type="button" class="ghost" data-a="reset">Back to shipped</button>` : ""}</div>
${k.changed && k.text !== k.shipped ? `<div class="ship">Shipped: ${esc(k.shipped)}</div>` : ""}
${k.stale ? `<div class="warn">The shipped wording here changed after this edit. Check it still belongs on this spot.</div>` : ""}
${lost ? `<div class="warn">The highlighted words "${esc(emK.text)}" are not in this title any more, so nothing is highlighted. Edit Highlighted words to match.</div>` : ""}
<div class="ce-key">${esc(k.key)}</div></div>`;
  }).join("");
}

/* ---- saving ---- */
/* a new title keeps its highlight: same words if they are still there, else the same number of words at the same end */
function emFollow(key, text) {
  if (!/\.title$/.test(key)) return null;
  const em = byKey[key.replace(/\.title$/, ".em")], k = byKey[key]; if (!em || !em.text || text.indexOf(em.text) >= 0) return null;
  const n = em.text.trim().split(/\s+/).length, w = text.trim().split(/\s+/);
  if (n >= w.length) return null;
  const next = k.text.endsWith(em.text) ? w.slice(-n).join(" ") : k.text.startsWith(em.text) ? w.slice(0, n).join(" ") : null;
  return next ? { key: em.key, base: em.text, text: next.replace(/^[,.;:]+|[,.;:]+$/g, "") } : null;
}
const inflight = new Set();
async function save(key, change) {
  const k = byKey[key]; if (!k || inflight.has(key)) return;
  inflight.add(key);
  try { await save1(key, k, change); } finally { inflight.delete(key); }
}
async function save1(key, k, change) {
  status("Saving", "");
  const follow = typeof change.text === "string" ? emFollow(key, change.text) : null;
  const r = await api("POST", "/api/copy/set", follow ? { edits: [{ key, base: k.text, ...change }, follow] } : { key, base: k.text, ...change });
  if (r.status === 409 && r.j && r.j.mode === "repo") { status("Not saved. Read only: edit in the repo.", "err"); try { window.rerenderScene(D.slide()); } catch (e) {} paint(); return; }
  if (r.status === 409) { status("Someone else changed this a moment ago (Maisie?). Showing their version now.", "err"); await load(true); return; }
  if (!r.ok) { status(r.j.error ? "Not saved: " + r.j.error : "Not saved. The server did not answer; nothing changed.", "err"); try { window.rerenderScene(D.slide()); } catch (e) {} paint(); return; }
  const fresh = await api("GET", "/api/copy");
  if (fresh.ok) { take(fresh.j); } else paint();
  status(r.j.changed && r.j.changed.length ? `Saved. Version ${r.j.v}.` : "No change.", "ok");
}
const sizeOf = (k, d) => Math.round(Math.max(MIN, Math.min(MAX, (k.size || 1) + d)) * 10) / 10;
$("#ce-list").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-a]"), row = e.target.closest(".ce-row"); if (!row) return;
  const key = row.dataset.k, k = byKey[key];
  if (b && k) {
    if (b.dataset.a === "up") save(key, { size: sizeOf(k, STEP) });
    if (b.dataset.a === "dn") save(key, { size: sizeOf(k, -STEP) });
    if (b.dataset.a === "save") {
      const ta = $("textarea", row), t = ta.value.replace(/\s+/g, " ").trim();
      if (t === k.text) status("Nothing to save: this line is already " + (k.changed ? "saved." : "the shipped copy."), "");
      else save(key, { text: t });
    }
    if (b.dataset.a === "reset") api("POST", "/api/copy/reset", { key }).then((r) => { if (r.ok) load(true).then(() => status(`Back to shipped. Version ${r.j.v}.`, "ok")); else status(r.j && r.j.mode === "repo" ? "Not reset. Read only: edit in the repo." : "Not reset. Try again.", "err"); });
    return;
  }
  hot = key; flashOnSlide(key);
  $$(".ce-row").forEach((x) => x.classList.toggle("hot", x === row));
});
$("#ce-list").addEventListener("mousedown", (e) => { if (e.target.closest("button[data-a=save]")) e.preventDefault(); });
$("#ce-list").addEventListener("focusout", (e) => {
  const ta = e.target.closest("textarea"); if (!ta) return;
  const key = ta.closest(".ce-row").dataset.k, k = byKey[key];
  const t = ta.value.replace(/\s+/g, " ").trim();
  if (k && t !== k.text) save(key, { text: t });   // empty is allowed: the line is blanked on purpose
});
$("#ce-list").addEventListener("keydown", (e) => {
  const ta = e.target.closest("textarea"); if (!ta) return;
  if (e.key === "Enter") { e.preventDefault(); ta.blur(); }
  if (e.key === "Escape") { const k = byKey[ta.closest(".ce-row").dataset.k]; if (k) ta.value = k.text; ta.blur(); }
});
function flashOnSlide(key) {
  const x = $(`#stage [data-copy-key="${CSS.escape(key)}"]`); if (!x) return;
  x.classList.add("ce-flash"); setTimeout(() => x.classList.remove("ce-flash"), 1200);
}

/* ---- in place on the slide ---- */
function startInline(x) {
  /* the highlighted words sit inside the title: a click on them edits the whole title (the highlight follows, see save) */
  if (/\.em$/.test(x.getAttribute("data-copy-key") || "")) { const t = x.parentElement && x.parentElement.closest('[data-copy-key$=".title"]'); if (t) x = t; }
  const key = x.getAttribute("data-copy-key"), k = byKey[key]; if (!k) return;
  if (editing) endInline(true);
  editing = { x, key, html: x.innerHTML };
  x.setAttribute("contenteditable", "true");   /* "true", not plaintext-only: the deck's key handler leaves [contenteditable='true'] alone */
  x.textContent = k.text; x.classList.add("ce-editing"); x.focus();
  try { const r = document.createRange(); r.selectNodeContents(x); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); } catch (e) {}
  hot = key; $$(".ce-row").forEach((r) => r.classList.toggle("hot", r.dataset.k === key));
  const row = $(`.ce-row[data-k="${CSS.escape(key)}"]`); if (row) row.scrollIntoView({ block: "nearest" });
}
function endInline(commit) {
  const ed = editing; if (!ed) return; editing = null;
  const t = (ed.x.innerText || ed.x.textContent || "").replace(/\s+/g, " ").trim();
  ed.x.removeAttribute("contenteditable"); ed.x.classList.remove("ce-editing");
  const k = byKey[ed.key];
  if (commit && k && t !== k.text) { save(ed.key, { text: t }); return; }
  ed.x.innerHTML = ed.html;
}
/* Which piece of copy is under the pointer. Many slides draw a transparent story layer above the text, so the click lands on
   that layer and not on the text: find the copy by where it sits, smallest box first (the highlighted words before their title). */
function hitCopy(e) {
  const direct = e.target && e.target.closest && e.target.closest("[data-copy-key]"); if (direct) return direct;
  const sc = sceneEl(D.slide()); if (!sc) return null;
  const PAD = 6; let best = null, area = Infinity;
  $$("[data-copy-key]", sc).forEach((el) => {
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return;
    if (e.clientX < r.left - PAD || e.clientX > r.right + PAD || e.clientY < r.top - PAD || e.clientY > r.bottom + PAD) return;
    const cs = getComputedStyle(el); if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity < 0.05) return;
    const a = r.width * r.height; if (a < area) { area = a; best = el; }
  });
  return best;
}
let hoverEl = null, hoverRaf = 0;
document.addEventListener("mousemove", (e) => {
  if (hoverRaf || !document.body.classList.contains("ce-on")) return;
  hoverRaf = requestAnimationFrame(() => {
    hoverRaf = 0;
    const st = document.getElementById("stage"), inStage = e.target.closest && e.target.closest("#stage");
    const h = inStage && !editing ? hitCopy(e) : null;
    if (h !== hoverEl) { if (hoverEl) hoverEl.classList.remove("ce-hover"); hoverEl = h; if (h) h.classList.add("ce-hover"); }
    if (st) st.classList.toggle("ce-text", !!h);
  });
}, true);
/* the editor owns clicks on the slide (no build steps, no slide changes from a click) and every key typed into it */
document.addEventListener("click", (e) => {
  if (!document.body.classList.contains("ce-on")) return;
  const inStage = e.target.closest && e.target.closest("#stage"); if (!inStage) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const x = hitCopy(e);
  if (editing && editing.x === x) return;
  if (x) startInline(x); else if (editing) endInline(true);
}, true);
/* every key typed into the editor stays in the editor: the deck's own keys (build steps, effects, blackout) never see it */
const typing = (e) => (editing && (e.target === editing.x || editing.x.contains(e.target)))
  || (e.target && e.target.closest && e.target.closest(".ce-ui") && /^(TEXTAREA|INPUT|BUTTON)$/.test(e.target.tagName));
addEventListener("keydown", (e) => {
  if (!typing(e)) return;
  e.stopImmediatePropagation();
  if (editing && (e.target === editing.x || editing.x.contains(e.target))) {
    if (e.key === "Enter") { e.preventDefault(); endInline(true); }
    else if (e.key === "Escape") { e.preventDefault(); endInline(false); }
  }
}, true);
["keyup", "keypress"].forEach((t) => { addEventListener(t, (e) => { if (typing(e)) e.stopImmediatePropagation(); }, true); document.addEventListener(t, (e) => { if (typing(e)) e.stopImmediatePropagation(); }, true); });
document.addEventListener("keydown", (e) => { if (typing(e)) e.stopImmediatePropagation(); }, true);
/* paste and drop arrive as plain text only */
document.addEventListener("paste", (e) => { if (!editing || !editing.x.contains(e.target)) return; e.preventDefault();
  const t = ((e.clipboardData && e.clipboardData.getData("text/plain")) || "").replace(/\s+/g, " "); try { document.execCommand("insertText", false, t); } catch (x) {} }, true);
document.addEventListener("drop", (e) => { if (editing && editing.x.contains(e.target)) e.preventDefault(); }, true);
addEventListener("focusout", (e) => { if (editing && e.target === editing.x) setTimeout(() => { if (editing && document.activeElement !== editing.x) endInline(true); }, 0); }, true);

/* ---- re-tag after every render and on every slide change ---- */
window.SCENE_HOOKS.push((el, s, i) => { if (i === D.slide()) requestAnimationFrame(() => { try { if (!editing) paintSoon(); } catch (e) {} }); });
let pt = 0; const paintSoon = () => { clearTimeout(pt); pt = setTimeout(() => { if (!editing) paint(); }, 60); };
D.on("slide", () => { if (editing) endInline(true); hot = ""; closeDrawer(); paintSoon(); });

/* ---- history, restore, Maisie's key ---- */
const DR = $("#ce-drawer");
function closeDrawer() { DR.hidden = true; DR.innerHTML = ""; DR.dataset.k = ""; }
const when = (t) => { try { return new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch (e) { return ""; } };
const who = (b) => (b === "maisie" ? "Maisie" : "Aran");
const short = (x) => (x ? (x.text ? `"${x.text.length > 60 ? x.text.slice(0, 57) + "..." : x.text}"` : "shipped wording") + (x.size && x.size !== 1 ? `, size ${Math.round(x.size * 100)}%` : "") : "shipped");
$("#ce-hist").onclick = async () => {
  if (DR.dataset.k === "h") { closeDrawer(); return; }
  const r = await api("GET", "/api/copy/history");
  if (!r.ok) { status("History is not available right now.", "err"); return; }
  DR.dataset.k = "h"; DR.hidden = false;
  const vs = r.j.versions || [];
  DR.innerHTML = `<h3>History</h3>` + vs.map((x, n) => `<div class="ce-ver"><div class="top"><b>Version ${x.v}${n === 0 ? " (now)" : ""}</b><span>${esc(when(x.at))}, ${esc(who(x.by))}</span>
${n === 0 ? "" : `<button type="button" data-v="${x.v}">Go back to this</button>`}</div><ul>${x.changes.slice(0, 6).map((c) => `<li><span class="ce-key">${esc(c.key)}</span>: ${esc(short(c.after))}</li>`).join("")}${x.changes.length > 6 ? `<li>and ${x.changes.length - 6} more</li>` : ""}</ul></div>`).join("")
    + `<div class="ce-ver"><div class="top"><b>Version 0</b><span>the shipped copy</span>${vs.length ? `<button type="button" data-v="0">Go back to this</button>` : ""}</div></div>`;
};
DR.addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-v]"); if (!b) return;
  if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Click again to confirm"; setTimeout(() => { if (b.isConnected) { b.dataset.armed = ""; b.textContent = "Go back to this"; } }, 4000); return; }
  const r = await api("POST", "/api/copy/restore", { v: +b.dataset.v });
  if (!r.ok) { status(r.j && r.j.mode === "repo" ? "Not restored. Read only: edit in the repo." : "Not restored. Nothing changed.", "err"); return; }
  closeDrawer(); await load(true); status(`Went back to version ${b.dataset.v}. That is now version ${r.j.v}, so you can undo it from History.`, "ok");
});
const ALL = $("#ce-all");
ALL.onclick = async () => {
  if (ALL.dataset.armed !== "1") { ALL.dataset.armed = "1"; ALL.textContent = "Click again: every slide"; setTimeout(() => { ALL.dataset.armed = ""; ALL.textContent = "Restore all shipped copy"; }, 4000); return; }
  ALL.dataset.armed = ""; ALL.textContent = "Restore all shipped copy";
  const r = await api("POST", "/api/copy/reset", { all: true });
  if (!r.ok) { status(r.j && r.j.mode === "repo" ? "Not restored. Read only: edit in the repo." : "Not restored. Nothing changed.", "err"); return; }
  await load(true); status(`Every slide shows the shipped copy again (version ${r.j.v}). History can bring your edits back.`, "ok");
};
$("#ce-maisie").onclick = async () => {
  if (DR.dataset.k === "m") { closeDrawer(); return; }
  const r = await api("GET", "/api/copy/token");
  if (!r.ok) { status("The key is not available right now.", "err"); return; }
  DR.dataset.k = "m"; DR.hidden = false;
  const help = location.origin + "/api/copy/help";
  const brief = `Slide copy editor for Aran's deck. Read the instructions first: GET ${help} with the header "Authorization: Bearer ${r.j.token}". Keep this key private.`;
  DR.innerHTML = `<h3>Maisie's key</h3><p>Maisie can change slide text for you with this key. Give it only to her. Anyone with it can edit slide text, nothing else.</p>
<div class="ce-tok" id="ce-tok">${esc(r.j.token)}</div><p>Instructions she reads: <span class="ce-key">${esc(help)}</span></p>
<button type="button" class="pri" id="ce-copy">Copy key and instructions</button>`;
  $("#ce-copy").onclick = async () => { try { await navigator.clipboard.writeText(brief); status("Copied. Paste it to Maisie.", "ok"); } catch (e) { status("Copy failed. Select the key and copy it by hand.", "err"); } };
};

/* ---- Slides and Polls: the jobs the admin tabs used to do. Same routes: /api/remote, /api/ctl/plan, /api/poll/questions, /api/ctl/questions ---- */
const TABS = ["text", "slides", "polls"], PANES = { text: ["#ce-list", "#ce-foot"], slides: ["#ce-slides"], polls: ["#ce-polls"] };
function showTab(t) {
  TABS.forEach((n) => { const b = $("#ce-tab-" + n); b.setAttribute("aria-selected", n === t ? "true" : "false"); });
  Object.keys(PANES).forEach((n) => PANES[n].forEach((s) => { $(s).hidden = n !== t; }));
  if (t !== "text") closeDrawer();
  P.dataset.tab = t; status("", "");   // the status line belongs to one section at a time
  if (t === "slides") loadSlides(); if (t === "polls") loadPolls();
}
TABS.forEach((n) => { $("#ce-tab-" + n).onclick = () => showTab(n); });
const jsonOf = (r) => (r && r.j) || {};
let SL = null, QE = null;
const cut = (s, n) => (s.length > n ? s.slice(0, n - 3) + "..." : s);
async function loadSl() {
  const r = await api("GET", "/api/remote"); if (!r.ok || !jsonOf(r).slides) { status("The slide order is not available right now.", "err"); return false; }
  SL = r.j.slides.map((x) => ({ i: x.i, id: x.id, title: x.title || x.id, hidden: !!x.hidden }));
  paintSoon();
  return true;
}
async function saveSl(note) {
  status("Saving", "");
  const r = await api("POST", "/api/ctl/plan", { order: SL.map((x) => x.id), hidden: SL.filter((x) => x.hidden).map((x) => x.id) });
  status(r.ok ? note || "Saved. The screen, the remote and the phones follow it." : "Did not save. Try again.", r.ok ? "ok" : "err");
  paintSoon();
}
async function loadSlides() { if (await loadSl()) renderSlides(); }
function renderSlides() {
  const box = $("#ce-slides"); box.textContent = ""; if (!SL) return;
  const shown = SL.filter((x) => !x.hidden), hid = SL.filter((x) => x.hidden);
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const btn = (txt, label, fn, dis) => { const b = mk("button", "", txt); b.type = "button"; b.setAttribute("aria-label", label); b.disabled = !!dis; b.onclick = fn; return b; };
  const move = (x, d) => { const sh = SL.filter((y) => !y.hidden), a = sh.indexOf(x), o = sh[a + d]; if (!o) return; const i = SL.indexOf(x), j = SL.indexOf(o); SL[i] = o; SL[j] = x; renderSlides(); saveSl(); };
  let drag = null;
  const ol = mk("ol", "ce-sl");
  shown.forEach((x, k) => {
    const li = mk("li"); li.draggable = true; li.dataset.id = x.id;
    const tt = mk("span", "t", x.title); tt.title = x.title; li.append(mk("span", "n", String(k + 1)), tt);
    li.append(btn("Up", "Move up: " + x.title, () => move(x, -1), k === 0), btn("Down", "Move down: " + x.title, () => move(x, 1), k === shown.length - 1),
      btn("Hide", "Hide: " + x.title, () => { x.hidden = true; renderSlides(); saveSl(); }));
    li.ondragstart = (e) => { drag = x; try { e.dataTransfer.setData("text/plain", x.id); } catch (_) {} };
    li.ondragover = (e) => { e.preventDefault(); li.classList.add("drag"); };
    li.ondragleave = () => li.classList.remove("drag");
    li.ondrop = (e) => { e.preventDefault(); li.classList.remove("drag"); if (!drag || drag === x) return;
      SL.splice(SL.indexOf(drag), 1); SL.splice(SL.indexOf(x), 0, drag); drag = null; renderSlides(); saveSl(); };
    ol.append(li);
  });
  box.append(ol);
  if (hid.length) {
    box.append(mk("h3", "ce-h", "Hidden"));
    const ul = mk("ul", "ce-sl off");
    hid.forEach((x) => { const li = mk("li"); li.append(mk("span", "t", x.title), btn("Show", "Show: " + x.title, () => { x.hidden = false; renderSlides(); saveSl(); })); ul.append(li); });
    box.append(ul);
  }
  const rs = btn("Back to default", "Back to the default order", async () => {
    if (rs.dataset.armed !== "1") { rs.dataset.armed = "1"; rs.textContent = "Click again to confirm"; setTimeout(() => { if (rs.isConnected) { rs.dataset.armed = ""; rs.textContent = "Back to default"; } }, 4000); return; }
    const r = await api("POST", "/api/ctl/plan", { reset: true }); status(r.ok ? "Back to the default order." : "Did not save. Try again.", r.ok ? "ok" : "err"); loadSlides();
  });
  rs.className = "ghost"; box.append(rs);
}

const isRows = (q) => !!q && (q.type === "rows" || q.type === "pair");
async function loadPolls() {
  const [a, b] = await Promise.all([loadSl(), api("GET", "/api/poll/questions")]);
  if (b.ok && Array.isArray(b.j.questions)) QE = b.j.questions.map((q) => ({ id: q.id, slide: q.slide, text: q.text, type: q.type || "choice", options: (q.options || []).slice() }));
  else status("The polls are not available right now.", "err");
  renderPolls();
}
async function savePolls(rerender) {
  status("Saving", "");
  const r = await api("POST", "/api/ctl/questions", { questions: QE.map((q) => ({ id: q.id, slide: q.slide, text: q.text, type: q.type, options: q.options })) });
  if (!r.ok) { status("Did not save. Try again.", "err"); return; }
  QE = r.j.questions.map((q) => ({ id: q.id, slide: q.slide, text: q.text, type: q.type, options: q.options.slice() }));
  status("Saved.", "ok"); if (rerender) renderPolls();
}
function renderPolls() {
  const box = $("#ce-polls"); box.textContent = ""; if (!QE) return;
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const find = (id) => QE.find((x) => x.id === id);
  const shownNo = (x) => SL.filter((y) => !y.hidden).indexOf(x) + 1;
  QE.filter((q) => !/^rehearse\d/.test(q.id)).forEach((q) => {   // the Rehearse polls take their words from the script on the Rehearse slide, so they are edited there
    const id = q.id, locked = id === "cover" || id === "close", card = mk("div", "ce-row ce-poll"); card.dataset.id = id;
    const ti = mk("input"); ti.type = "text"; ti.maxLength = 120; ti.value = q.text; ti.setAttribute("aria-label", "Question");
    ti.onchange = () => { find(id).text = ti.value; savePolls(false); }; card.append(ti);
    const two = mk("div", "two");
    if (locked || isRows(q)) two.append(mk("span", "fix", isRows(q) ? "Two rows" : "Poll"));
    else { const se = mk("select"); [["poll", "Poll"], ["choice", "Multiple choice"]].forEach(([v, n]) => { const o = mk("option", "", n); o.value = v; if (v === q.type) o.selected = true; se.append(o); });
      se.setAttribute("aria-label", "Type"); se.onchange = () => { find(id).type = se.value; savePolls(true); }; two.append(se); }
    const ss = mk("select"); ss.setAttribute("aria-label", "Opens on slide");
    (SL || []).forEach((x) => { const o = mk("option", "", x.hidden ? x.title + " (hidden)" : shownNo(x) + ". " + x.title); o.value = x.id; if (x.id === q.slide) o.selected = true; ss.append(o); });
    ss.onchange = () => { find(id).slide = ss.value; savePolls(true); }; two.append(ss); card.append(two);
    if ((q.type === "poll" || q.type === "choice") && id !== "close") {
      const ob = mk("div", "opts");
      q.options.forEach((w, oi) => {
        const row = mk("div", "orow"), inp = mk("input"); inp.type = "text"; inp.maxLength = 40; inp.value = w; inp.setAttribute("aria-label", "Answer " + (oi + 1));
        inp.onchange = () => { find(id).options[oi] = inp.value; savePolls(false); }; row.append(inp);
        if (!locked && q.options.length > 2) { const rm = mk("button", "", "Remove"); rm.type = "button"; rm.setAttribute("aria-label", "Remove answer " + (oi + 1)); rm.onclick = () => { find(id).options.splice(oi, 1); savePolls(true); }; row.append(rm); }
        ob.append(row);
      });
      if (!locked && q.options.length < 6) { const ad = mk("button", "", "Add an answer"); ad.type = "button"; ad.onclick = () => { find(id).options.push("New answer"); savePolls(true); }; ob.append(ad); }
      card.append(ob);
    }
    box.append(card);
  });
  const rs = mk("button", "ghost", "Back to the original polls"); rs.type = "button";
  rs.onclick = async () => {
    if (rs.dataset.armed !== "1") { rs.dataset.armed = "1"; rs.textContent = "Click again to confirm"; setTimeout(() => { if (rs.isConnected) { rs.dataset.armed = ""; rs.textContent = "Back to the original polls"; } }, 4000); return; }
    const r = await api("POST", "/api/ctl/questions", { reset: true }); status(r.ok ? "Back to the original polls." : "Did not save. Try again.", r.ok ? "ok" : "err"); loadPolls();
  };
  box.append(rs);
}

/* ---- follow changes made elsewhere (Maisie, another editor tab) ---- */
setInterval(async () => {
  if (editing || document.visibilityState === "hidden" || $("#ce-list textarea:focus")) return;
  const r = await api("GET", "/api/copy/live?since=" + ver);
  if (r.ok && !r.j.same && typeof r.j.v === "number" && r.j.v !== ver) { await load(true); status(`Copy changed elsewhere. Now version ${ver}.`, "ok"); }
}, 5000);

load(false).then(() => { paint(); requestAnimationFrame(paint); });
loadSl();
window.__COPY_EDITOR = { load, paint, tagNow, data: () => data, showTab };
})();
