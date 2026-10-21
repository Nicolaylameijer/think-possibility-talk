// Page assembly. Every HTML page is built per request so that each role receives only what it may see.
import BODY from "./generated/body.js";
import { BRAND, DECK, audienceData, presenterData, jsLit, SCENES, sceneId } from "./deckdata.js";
import { ALL } from "./qedit.js";
import { PAGE_CSS, LOGIN_HTML, START_HTML } from "./templates.js";
import { applyCopy } from "./copy.js";   // G9 editable copy
import { starterPrompt } from "./guide.js";
import STARTERS from "../content/app/starters.json";   // the phone page's starter prompts and AI apps list
import APPS from "../content/app/apps.json";

const E = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const LABEL_DEFAULTS = {
  item: "item", items: "items", presenterWord: "presenter",
  watchBlurb: "The slides move with the presenter, and each item ticks off as we show it. Nothing to click.",
  notesBlurb: "Takeaways from each part of the talk, your own notes, starter prompts to copy, AI app links, and a guide to build your own assistant.",
  maisieTitle: "Talk to Maisie", maisieBlurb: "Ask Aran's AI assistant about anything in today's session, right from your phone.",
  maisieCta: "Chat with Maisie",
};
export const LABELS = { ...LABEL_DEFAULTS, ...Object.fromEntries(Object.entries(BRAND.labels || {}).filter(([, v]) => typeof v === "string")) };
const B = (k, d = "") => (BRAND[k] == null || BRAND[k] === "" ? d : BRAND[k]);
export const TITLE = [B("title", "Presentation"), B("audience", "")].filter(Boolean).join(", ");

function logosHtml(onDark) {
  const out = [];
  (BRAND.logos || []).forEach((l, i) => {
    const src = (onDark ? l.dark : null) || l.src || "";
    if (!src) return;
    if (i) out.push('<i class="dv"></i>');
    out.push(`<img${l.big ? ' class="big"' : ""} src="/img/${E(String(src).split("/").pop())}" alt="${E(l.alt)}">`);
  });
  return out.join("");
}
const LOGOS_ON_DARK = logosHtml(true), LOGOS_ON_LIGHT = logosHtml(false);

// every inline <script> gets the request nonce; scripts with a src are covered by script-src 'self'
export const nonceInline = (html, nonce) => html.replace(/<script(?![^>]*\bsrc=)([^>]*)>/g, `<script nonce="${nonce}"$1>`);

const fill = (tpl, map) => {
  let t = tpl;
  for (const [k, v] of Object.entries(map)) t = t.split("__" + k + "__").join(v);
  return t;
};
const base = (tpl) => fill(tpl, { CSS: PAGE_CSS, LOGOS: LOGOS_ON_DARK, TITLE: E(TITLE) });
export const brandBase = base;   // the shared page chrome, for src/signin.js

export function loginPage(kind, { next = "/", err = "" } = {}) {
  let t = base(LOGIN_HTML);
  if (kind === "presenter") {
    t = t.replace("<h1>Welcome</h1>", "<h1>Presenter</h1>")
      .replace(/<input name="code"[^>]*>/, '<input name="password" type="password" autocomplete="current-password" spellcheck="false" maxlength="200" autofocus aria-label="Presenter password">')
      .replace('action="/login"', 'action="/presenter/login"')
      .replace("</style>", "input[type=password]{text-transform:none;letter-spacing:.06em;font-size:20px}</style>");
  }
  return fill(t, { NEXT: E(next), ERR: E(err) });
}

// round 2 polls: every audience page carries the live poll takeover (/_deck/poll.js), so a phone turns into the poll
// whichever page it is on when Aran opens one. /ui.css brings the shared fonts and tokens.
const POLL_TAG = '<script src="/_deck/poll.js"></script>';
const withPoll = (html) => html.replace("</head>", '<link rel="stylesheet" href="/ui.css"></head>').replace("</body>", POLL_TAG + "</body>");

export function startPage() {
  const icon = '<img src="/img/maisie-avatar.jpg" alt="">';
  return withPoll(fill(base(START_HTML), {
    H1: E(B("title", "Presentation")), LEDE: E(B("subtitle", "")), WATCHBLURB: E(LABELS.watchBlurb),
    NOTESBLURB: E(LABELS.notesBlurb), MAISIEICON: icon, MAISIETITLE: E(LABELS.maisieTitle),
    MAISIEBLURB: E(LABELS.maisieBlurb), MAISIECTA: E(LABELS.maisieCta),
  }));
}

export const HEAD = (title) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>${E(title)}</title><base href="/"><link rel="icon" href="data:,"><link rel="stylesheet" href="/brand.css">`;

// the page one audience frame shows: the speaker's current slide and nothing else
export function framePage(i, fx, nonce, cp) {
  const { deck, scenes: shipped } = audienceData(i);
  const scenes = applyCopy(shipped, cp);   // G9: overrides land only on the one scene this frame carries
  const fxq = ["calm", "standard", "full"].includes(fx) ? fx : "standard";
  return HEAD(TITLE)
    + `<link rel="stylesheet" href="/_deck/tokens.css"><link rel="stylesheet" href="/_deck/deck.css">
<style>.zone,#chrome button,.ovl{display:none!important}html,body{background:var(--dark)}</style></head><body>${BODY}
<script nonce="${nonce}">window.LIVE_VIEW="watch";window.LIVE_LABELS=${jsLit(LABELS)};window.__LOCKED=true;window.__START=${i | 0};
try{history.replaceState(null,"","/frame?fx=${fxq}");}catch(e){}</script>
<script src="/_deck/pre.js"></script>
<script nonce="${nonce}">const DECK=${jsLit(deck)};
const DEMO_LINKS={};
const SCENES=${jsLit(scenes)};</script>
<script src="/_deck/engine.js"></script>
<script src="/_deck/copy.js"></script>
</body></html>`;
}

// the audience shell: two frames and a status pill, no slide content
export function shellPage(nonce) {
  return HEAD(TITLE)
    + `<link rel="stylesheet" href="/ui.css"><style>html,body{margin:0;height:100%;background:var(--dark);overflow:hidden}
iframe{position:fixed;inset:0;width:100%;height:100%;border:0;opacity:0;transition:opacity .45s ease;background:var(--dark)}
iframe.on{opacity:1}
#bk{position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;transition:opacity .3s;z-index:20}#bk.on{opacity:1}
#wait{position:fixed;inset:0;z-index:10;display:none;align-content:center;justify-items:center;text-align:center;padding:24px;gap:18px;color:#fff;
 font-family:var(--font);background:radial-gradient(900px 560px at 84% -14%,color-mix(in srgb,var(--bright) 24%,transparent),transparent 62%),var(--dark)}
#wait.on{display:grid}#wait h1{margin:0;font-size:clamp(26px,4vw,44px);font-weight:600;letter-spacing:-.02em}#wait p{margin:0;font-size:18px;color:rgba(255,255,255,.72)}
#wait .logos{display:flex;align-items:center;gap:14px;flex-wrap:wrap;justify-content:center}#wait .logos img{height:30px;width:auto;max-width:60%}
#wait .logos .dv{width:1px;height:20px;background:rgba(255,255,255,.25)}
#wbar{position:fixed;right:16px;bottom:56px;z-index:30;display:flex;gap:10px;align-items:center;font:600 14px var(--font)}
#wbar>*{display:flex;align-items:center;gap:9px;border:0;cursor:default;font:inherit;padding:10px 16px;border-radius:99px;text-decoration:none;box-shadow:0 10px 28px rgba(0,0,0,.3)}
#wpill{background:var(--brand);color:#fff}#wpill.on{background:#fff;color:var(--dark)}
#wmine{background:var(--dark);color:#fff;border:1px solid rgba(255,255,255,.2)!important;cursor:pointer}
#wpill i{width:9px;height:9px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 25%,transparent);animation:wpl 1.6s ease-in-out infinite}
@keyframes wpl{50%{box-shadow:0 0 0 7px color-mix(in srgb,var(--accent) 8%,transparent)}}
@media (max-width:520px){#wbar{left:12px;right:12px;justify-content:space-between}#wbar>*{padding:9px 13px;font-size:13px}}
</style></head><body>
<iframe id="fa" title="Slide"></iframe><iframe id="fb" title="Slide"></iframe>
<div id="wait"><div class="logos">${LOGOS_ON_DARK}</div><h1>${E(B("title", "Presentation"))}</h1><p>Waiting for the ${E(LABELS.presenterWord)} to begin.</p></div>
<div id="bk"></div>
<div id="wbar"><span id="wpill"></span><a id="wmine" href="/app" target="_blank" rel="noopener">Notes and resources &#8599;</a></div>
<script nonce="${nonce}">window.__WHO=${jsLit(LABELS.presenterWord)};</script>
${POLL_TAG}
<script src="/_deck/shell.js"></script>
</body></html>`;
}

// the full deck for the presenter, with speaker notes and every slide
// G9: cp is every copy override (the presenter may see every slide); edit = the copy editor tab, which never drives the room
export function presenterPage(nonce, startSlide, cp, edit = false) {
  const { deck, scenes: shipped } = presenterData();
  const scenes = applyCopy(shipped, cp);
  return HEAD(TITLE)
    + `<link rel="stylesheet" href="/_deck/tokens.css"><link rel="stylesheet" href="/_deck/deck.css"></head><body>${BODY}
<script nonce="${nonce}">window.LIVE_VIEW="presenter";window.LIVE_LABELS=${jsLit(LABELS)};${typeof startSlide === "number" ? `window.__START=${startSlide | 0};` : ""}window.__PRES=${jsLit({})};</script>
${edit ? `<script nonce="${nonce}">window.__COPY_EDIT=true;try{var _si=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(this===window.localStorage)return;return _si.call(this,k,v);};}catch(e){}</script>` : ""}<script src="/_deck/pre.js"></script>
<script nonce="${nonce}">const DECK=${jsLit(deck)};
const DEMO_LINKS={};
const SCENES=${jsLit(scenes)};</script>
<script src="/_deck/engine.js"></script>
<script src="/_deck/qr.js"></script>
${edit ? `<script src="/_deck/copy.js"></script><script src="/_deck/copyedit.js"></script>` : `<script src="/_deck/presenter.js"></script><script src="/_deck/copy.js"></script>`}
</body></html>`;
}

// the phone app: a static template, all live content (slide, thread, tallies) arrives over the API
// The phone gets every question, card and slide id inline: nothing to fetch at join, and it works offline.
// round 2 kit: SP is the starter prompt with NAMEMARK where the assistant's name goes (the phone fills in the name the
// person types, so Copy runs inside the tap with no fetch, which iOS needs). T is the talk title for the waiting screen.
// Move prompts are not inlined: they come from /api/content, which only carries the ones Aran has reached.
const APP_DATA = { Q: ALL,   // round 2: with readiness and the Rehearse polls derived from move4
  S: SCENES.map((s, i) => sceneId(i)), SP: starterPrompt("NAMEMARK"), T: B("title", "Presentation"), ST: STARTERS, APPS };
export function appPage(tpl, nonce, qs) {   // ---- v4 a17 q: qs is { qv, questions }, the effective list; default is Aran's original
  return nonceInline(tpl.replace("/*__DATA__*/null", () => jsLit(qs && qs.questions ? { ...APP_DATA, Q: qs.questions, qv: qs.qv } : APP_DATA)), nonce);
}

export function maisiePage(tpl, nonce) {
  const cfg = { title: B("title"), presenter: B("presenter"), audience: B("audience"), labels: LABELS };
  return nonceInline(tpl.replace("/*__BRAND__*/null", () => jsLit(cfg)), nonce);
}

export const BLANK = `<!doctype html><html><head><meta charset="utf-8"><title></title></head><body style="margin:0;background:#15233b"></body></html>`;
export const deckTitle = DECK.title;
