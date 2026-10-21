// The one audience sign in page: first name, last name, email, one button. First time, the same form makes the
// account; the same email on any device returns to it. It is served wherever a visit without a session lands
// (/, /app, /watch, /notes, /maisie) and sends the person back to the page they asked for. The audience link
// (/join/<code>) shows the same form, with the code carried along so nobody types it. The presenter login is
// a different page and is unchanged.
import { brandBase } from "./pages.js";

const FORM = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow">
<meta name="color-scheme" content="dark"><meta name="theme-color" content="#15233b">
<title>__TITLE__</title><link rel="icon" href="data:,"><link rel="preload" href="/fonts/publicsans-400.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="/brand.css"><style>__CSS__
/* v4 a19 app: dark in every room (the page is branded dark), big targets, 16px+ inputs, safe areas */
:root{color-scheme:dark}
body{grid-template-columns:minmax(0,420px);align-content:start;padding:max(24px,env(safe-area-inset-top)) max(20px,env(safe-area-inset-right)) max(40px,env(safe-area-inset-bottom)) max(20px,env(safe-area-inset-left));-webkit-text-size-adjust:100%;text-size-adjust:100%}
button,input{touch-action:manipulation}
.logos{margin-bottom:28px}h1{font-size:34px;margin:0 0 8px}
.first{font-size:17px;line-height:1.45;color:rgba(255,255,255,.82);margin:0 0 22px}
label{display:block;font:600 16px var(--font);margin:0 0 6px;color:#fff}
.f{margin:0 0 16px}
input[type=email],input[type=text]{display:block;width:100%;min-height:56px;font:500 18px var(--font);padding:12px 16px;border-radius:14px;
border:1.5px solid rgba(255,255,255,.45);background:rgba(255,255,255,.07);color:#fff;outline:none;-webkit-appearance:none;appearance:none}
input:focus{border-color:var(--bright);background:rgba(255,255,255,.12);box-shadow:0 0 0 4px rgba(231,162,60,.28)}
input[aria-invalid=true]{border-color:#FFB38A}
button{display:flex;align-items:center;justify-content:center;width:100%;min-height:58px;font:700 18px var(--font);padding:14px;border:0;border-radius:14px;background:var(--warm);color:#fff;cursor:pointer;-webkit-tap-highlight-color:transparent}
button:active{filter:brightness(.88)}
button:focus-visible{outline:3px solid var(--bright);outline-offset:3px}
button[disabled]{opacity:.75;cursor:default}
button[disabled]::after{content:"";width:18px;height:18px;margin-left:12px;border-radius:50%;border:2.5px solid #fff;border-right-color:transparent;animation:spin .7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){button[disabled]::after{animation-duration:2s}}
.msg{min-height:48px;margin:14px 0 0;font:500 16px/1.45 var(--font);color:#FFC9A8}
@media (max-height:500px){.logos{margin-bottom:12px}h1{font-size:28px}.first{margin-bottom:14px}}
</style></head><body>
<form id="f" novalidate autocomplete="on"><div class="logos">__LOGOS__</div>
<h1>Join</h1>
<p class="first">Add your name and email. Use the same email on any device to come back to your notes.</p>
<div class="f"><label for="first">First name</label>
<input id="first" name="first" type="text" autocomplete="given-name" autocapitalize="words" autocorrect="off" enterkeyhint="next" maxlength="40" required></div>
<div class="f"><label for="last">Last name</label>
<input id="last" name="last" type="text" autocomplete="family-name" autocapitalize="words" autocorrect="off" enterkeyhint="next" maxlength="40" required></div>
<div class="f"><label for="email">Email</label>
<input id="email" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="go" maxlength="254" required></div>
<button id="go" type="submit">Continue</button>
<div id="msg" class="msg" role="alert" aria-live="polite"></div>
<noscript><p class="msg">This page needs JavaScript to sign you in.</p></noscript>
</form>
<script nonce="__NONCE__">
(function () {
  var NEXT = __NEXT__, CODE = __CODE__, f = document.getElementById("f"), go = document.getElementById("go"), msg = document.getElementById("msg");
  var busy = false;
  function say(t, field) {
    msg.textContent = t;
    ["first", "last", "email"].forEach(function (i) { var el = document.getElementById(i); if (i === field) el.setAttribute("aria-invalid", "true"); else el.removeAttribute("aria-invalid"); });
  }
  function done() { busy = false; go.disabled = false; }
  function mins(s) { var m = Math.max(1, Math.ceil((Number(s) || 60) / 60)); return m + (m === 1 ? " minute" : " minutes"); }
  f.addEventListener("submit", function (e) {
    e.preventDefault();
    if (busy) return;
    var $ = function (i) { return document.getElementById(i); };
    var first = $("first").value.trim(), last = $("last").value.trim(), email = $("email").value.trim();
    if (!first) { say("Enter your first name.", "first"); $("first").focus(); return; }
    if (!last) { say("Enter your last name.", "last"); $("last").focus(); return; }
    if (!/^\\S+@\\S+\\.\\S+$/.test(email)) { say("Enter a valid email address.", "email"); $("email").focus(); return; }
    var body = { first: first, last: last, email: email };
    if (CODE) body.code = CODE;
    busy = true; go.disabled = true; say("");
    var ac = window.AbortController ? new AbortController() : null, tm = ac ? setTimeout(function () { ac.abort(); }, 15000) : 0;
    fetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body), signal: ac ? ac.signal : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { s: r.status, j: j }; }); })
      .then(function (x) {
        clearTimeout(tm);
        if (x.s === 200) { location.replace(NEXT); return; }
        done();
        if (x.s === 403 && x.j.error === "code") say("This link is not current. Ask the speaker for the latest one.");
        else if (x.s === 403) say("New sign ups are closed. If you already joined, use the same email.");
        else if (x.s === 429) say("Too many tries from this network. Wait " + mins(x.j.retry) + " and try again.");
        else if (x.s === 400) say("Check your first name, last name and email address.");
        else say("Something went wrong. Try again in a moment.");
      })
      .catch(function () { clearTimeout(tm); done(); say("No connection. Check your signal and try again."); });
  });
})();
</script></body></html>`;

// next is one of the fixed audience pages (the Worker has already checked it). code is the audience link code, or "".
export function signInPage(nonce, next = "/", code = "") {
  const html = brandBase(FORM);
  return html.split("__NONCE__").join(nonce).split("__NEXT__").join(JSON.stringify(String(next))).split("__CODE__").join(JSON.stringify(String(code)));
}

// the audience link with a wrong or old code
const BAD = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow">
<meta name="color-scheme" content="dark"><meta name="theme-color" content="#15233b">
<title>__TITLE__</title><link rel="icon" href="data:,"><link rel="stylesheet" href="/brand.css"><style>__CSS__
:root{color-scheme:dark}
body{grid-template-columns:minmax(0,420px);align-content:start;padding:max(24px,env(safe-area-inset-top)) max(20px,env(safe-area-inset-right)) max(40px,env(safe-area-inset-bottom)) max(20px,env(safe-area-inset-left))}
.logos{margin-bottom:28px}h1{font-size:30px;margin:0 0 8px}p{font-size:17px;line-height:1.45;color:rgba(255,255,255,.78)}
</style></head><body><div class="logos">__LOGOS__</div><h1>This link is not current</h1>
<p>Ask the speaker for the latest link or QR code.</p></body></html>`;
export function badLinkPage() { return brandBase(BAD); }

// round 2: the short join page. /join with no code asks for the room code shown on the slide corner, then
// sends the phone to /join/<code>, which signs it in and lands it on /app (the QR and the short URL end there too).
const JOIN = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow">
<meta name="color-scheme" content="dark"><meta name="theme-color" content="#15233b">
<title>__TITLE__</title><link rel="icon" href="data:,"><link rel="stylesheet" href="/brand.css"><style>__CSS__
:root{color-scheme:dark}
body{grid-template-columns:minmax(0,420px);align-content:start;padding:max(24px,env(safe-area-inset-top)) max(20px,env(safe-area-inset-right)) max(40px,env(safe-area-inset-bottom)) max(20px,env(safe-area-inset-left))}
.logos{margin-bottom:28px}h1{font-size:30px;margin:0 0 8px}p{font-size:17px;line-height:1.45;color:rgba(255,255,255,.78);margin:0 0 20px}
label{display:block;font-size:17px;font-weight:600;margin:0 0 8px}
input{width:100%;box-sizing:border-box;min-height:56px;font-size:24px;letter-spacing:.12em;text-transform:uppercase;padding:0 16px;border-radius:12px;border:2px solid rgba(255,255,255,.35);background:#0f1a2e;color:#fff}
input:focus{outline:3px solid #e7a23c;outline-offset:2px}
button{width:100%;min-height:56px;margin-top:16px;font-size:20px;font-weight:700;border:0;border-radius:12px;background:#c44a06;color:#fff;cursor:pointer}
button:focus-visible{outline:3px solid #e7a23c;outline-offset:2px}
.err{color:#fff;background:rgba(196,74,6,.35);border-radius:10px;padding:10px 12px;font-size:17px}
</style></head><body><div class="logos">__LOGOS__</div><h1>Join the room</h1>
<p>Type the code on the screen. Cellular data works fine.</p>__ERR__
<form method="get" action="/join"><label for="c">Room code</label>
<input id="c" name="c" value="__VAL__" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" maxlength="32" required>
<button type="submit">Join</button></form></body></html>`;
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");
export function joinPage(err = "", val = "") {
  return brandBase(JOIN).split("__ERR__").join(err ? '<p class="err" role="alert">' + esc(err) + "</p>" : "").split("__VAL__").join(esc(val));
}
