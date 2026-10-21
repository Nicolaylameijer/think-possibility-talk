// possibility-live: the Worker in front of the Event Durable Object.
// It authenticates every request (signed cookies), decides what each role may fetch, assembles
// each page for its role, and forwards state, control and Maisie calls to the Event object over
// an internal path with trusted headers. Nothing reaches the Durable Object unauthenticated.
import { Event } from "./event.js";
import { makeToken, verifyToken, parseCookies, setCookie, clearCookie, secretEquals, randomId, audienceCode, normCode, COOKIE } from "./auth.js";
import { accountsApi } from "./accounts.js";
import { wallApi } from "./wall.js";   // v3 wall
import { signInPage, badLinkPage, joinPage } from "./signin.js";
import { mobileFramePage } from "./mobile.js";
import { nonceInline, HEAD, TITLE, loginPage, startPage, framePage, shellPage, presenterPage, maisiePage, appPage, BLANK } from "./pages.js";
import { guideMarkdown, assistantName, slugOf, starterMarkdown } from "./guide.js";
import { OPEN_IMG, imagesOfScene } from "./deckdata.js";
import { copyApi } from "./copy.js";   // G9 editable copy
import { shared, noteViewer, takeViewers, asRes } from "./scale.js";   // G10 scale

export { Event };

const MAX_BODY = 8192;
const NEXT_OK = new Set(["/", "/start", "/watch", "/notes", "/maisie", "/app"]);
const PNEXT_OK = new Set(["/", "/admin", "/remote", "/?edit=1"]);   // /?edit=1 is the copy editor: signing in must land back on it
const DECK_FILES = { "tokens.css": "any", "deck.css": "any", "pre.js": "any", "engine.js": "any", "shell.js": "any", "poll.js": "any", "presenter.js": "presenter", "qr.js": "presenter",
  "copy.js": "any", "copyedit.js": "presenter" };   // G9: copy.js sizes and tags text on every slide page; the editor is presenter only. round 2: poll.js is the phone poll takeover
const IMG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

// ---------------------------------------------------------------- responses
function secure(res, req, { nonce = "", html = false, store = true } = {}) {
  const url = new URL(req.url);
  const h = new Headers(res.headers);
  h.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "same-origin");
  h.set("Permissions-Policy", "microphone=(self), camera=(), geolocation=()");
  if (url.protocol === "https:") h.set("Strict-Transport-Security", "max-age=31536000");
  h.set("Cache-Control", store ? "no-store" : "private, no-cache");
  if (html) {
    const ws = (url.protocol === "https:" ? "wss://" : "ws://") + url.host;
    h.set("Content-Security-Policy", [
      "default-src 'self'", `script-src 'self' 'nonce-${nonce}'`, "style-src 'self' 'unsafe-inline'", "img-src 'self' data:",
      "font-src 'self'", `connect-src 'self' ${ws}`, "media-src 'self'", "frame-src 'self'", "frame-ancestors 'self'",
      "form-action 'self'", "base-uri 'self'", "object-src 'none'",
    ].join("; "));
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}
const pageRes = (html, req, nonce, status = 200, extra = {}) =>
  secure(new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", ...extra } }), req, { nonce, html: true });
const json = (obj, req, status = 200, extra = {}) =>
  secure(new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", ...extra } }), req);
const plain = (text, req, status = 200) => secure(new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8" } }), req);

// ---------------------------------------------------------------- session
// A browser that holds both cookies (the presenter looking at the audience app) is a presenter everywhere,
// except on the audience pages the join link opens. Those carry ?as=aud on the page and an x-as header on
// every call and socket (see audShim), and the audience session wins there. The presenter cookie is never touched.
const PRESENTER_ONLY = (p) => p === "/admin" || p === "/remote" || p === "/presenter" || p === "/api/remote" || p.startsWith("/api/ctl/") || p === "/_deck/presenter.js" || p === "/_deck/qr.js" || p === "/_deck/copyedit.js";
async function sessionOf(req, env) {
  if (!env.SESSION_SECRET) return null;
  const c = parseCookies(req.headers.get("cookie"));
  const u = new URL(req.url);
  const wantAud = (u.searchParams.get("as") === "aud" || req.headers.get("x-as") === "aud") && !PRESENTER_ONLY(u.pathname);
  if (wantAud) {
    const a = await verifyToken(env.SESSION_SECRET, c[COOKIE.audience], "audience");
    if (a) return { role: "audience", sid: a.sid, aud: true };
  }
  const p = await verifyToken(env.SESSION_SECRET, c[COOKIE.presenter], "presenter");
  if (p) return { role: "presenter", sid: p.sid };
  const a = await verifyToken(env.SESSION_SECRET, c[COOKIE.audience], "audience");
  if (a) return { role: "audience", sid: a.sid };
  return null;
}
// the small script put on audience pages served in audience mode: it marks every call, socket and link
function audShim(html, nonce) {
  const js = `(function(){var F=window.fetch;window.fetch=function(u,o){try{var h=new Headers((o&&o.headers)||(u&&u.headers)||{});h.set("x-as","aud");o=Object.assign({},o,{headers:h});}catch(e){}return F.call(this,u,o);};
var W=window.WebSocket;function WS(u,p){u=String(u);u+=(u.indexOf("?")<0?"?":"&")+"as=aud";return p===undefined?new W(u):new W(u,p);}
WS.prototype=W.prototype;["CONNECTING","OPEN","CLOSING","CLOSED"].forEach(function(k){WS[k]=W[k];});window.WebSocket=WS;
document.addEventListener("click",function(e){var a=e.target&&e.target.closest&&e.target.closest("a[href]");if(!a)return;var u=new URL(a.href,location.href);if(u.origin!==location.origin)return;u.searchParams.set("as","aud");a.href=u.href;},true);})();`;
  const tag = `<script nonce="${nonce}">${js}</script>`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + tag) : tag + html;
}
const ipOf = (req) => (req.headers.get("cf-connecting-ip") || "local").slice(0, 64);
const configured = (env) => !!(env.SESSION_SECRET && env.PRESENTER_PASSWORD);

// ---------------------------------------------------------------- Durable Object calls
const stub = (env) => env.EVENT.get(env.EVENT.idFromName("main"));
async function toEvent(env, path, { method = "GET", body, sess, ip = "", cid = "" } = {}) {
  const headers = new Headers({ "x-role": sess ? sess.role : "", "x-sid": sess ? sess.sid : "", "x-ip": ip,
    "x-cid": String(cid || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 24) });
  if (body !== undefined) headers.set("content-type", "application/json");
  return stub(env).fetch("https://event" + path, { method, headers, body });
}
const eventJson = async (env, path, opts) => (await toEvent(env, path, opts)).json();
async function limit(env, key, max, win, ip) { return eventJson(env, "/do/rl", { method: "POST", ip, body: JSON.stringify({ op: "check", key, limit: max, win }) }); }
async function failed(env, key, max, win, ip) { return eventJson(env, "/do/rl", { method: "POST", ip, body: JSON.stringify({ op: "fail", key, limit: max, win }) }); }

async function readBody(req) {
  const t = await req.text();
  return t.length > MAX_BODY ? null : t;
}
function sameOrigin(req) {
  const sfs = req.headers.get("sec-fetch-site");      // sent by every current browser
  if (sfs) return sfs === "same-origin" || sfs === "none";
  const o = req.headers.get("origin");
  if (!o) return true;
  try { return new URL(o).host === new URL(req.url).host; } catch { return false; }
}

// ---------------------------------------------------------------- assets
async function assetRes(env, path, req, opts) {
  const r = await env.ASSETS.fetch(new Request("https://assets.invalid" + path));
  if (!r.ok) return json({ error: "not found" }, req, 404);
  return secure(new Response(r.body, { status: 200, headers: { "content-type": r.headers.get("content-type") || "application/octet-stream" } }), req, { store: false, ...opts });
}
const tplCache = {};
async function template(env, name) {
  if (!tplCache[name]) {
    const r = await env.ASSETS.fetch(new Request("https://assets.invalid/_tpl/" + name));
    if (!r.ok) throw new Error("template missing");
    tplCache[name] = await r.text();
  }
  return tplCache[name];
}

// ---------------------------------------------------------------- login
function safeNext(n) { return NEXT_OK.has(n) ? n : "/"; }
async function formOf(req) {
  const t = await readBody(req);
  if (t == null) return null;
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) { try { return JSON.parse(t) || {}; } catch { return {}; } }
  return Object.fromEntries(new URLSearchParams(t));
}
// The presenter login. (The audience signs in with first name, last name and email at POST /api/auth, see src/accounts.js.)
async function login(req, env, url) {
  const ip = ipOf(req), nonce = randomId(16);
  const f = await formOf(req);
  if (f == null) return plain("Request too large", req, 413);
  const nextPath = PNEXT_OK.has(String(f.next || "/")) ? String(f.next || "/") : "/";
  const max = 5, key = "p:" + ip;
  const [mine, all] = await Promise.all([limit(env, key, max, 600, ip), limit(env, "p:*", 120, 600, ip)]);
  if (mine.blocked || all.blocked) {
    const mins = Math.ceil(Math.max(mine.retry || 0, all.retry || 0, 60) / 60);
    return pageRes(loginPage("presenter", { next: nextPath, err: `Too many tries. Wait ${mins} minute${mins === 1 ? "" : "s"} and try again.` }), req, nonce, 429,
      { "retry-after": String(Math.max(mine.retry || 0, all.retry || 0, 60)) });
  }
  if (!(await secretEquals(String(f.password || ""), env.PRESENTER_PASSWORD))) {
    await Promise.all([failed(env, key, max, 600, ip), failed(env, "p:*", 120, 600, ip)]);
    return pageRes(loginPage("presenter", { next: nextPath, err: "That password did not work." }), req, nonce, 401);
  }
  const token = await makeToken(env.SESSION_SECRET, "presenter");
  const res = new Response(null, { status: 303, headers: { location: nextPath } });
  res.headers.append("set-cookie", setCookie("presenter", token, url.protocol === "https:"));
  return secure(res, req);
}

// ---------------------------------------------------------------- routes
async function route(req, env) {
  const url = new URL(req.url), path = url.pathname, method = req.method === "HEAD" ? "GET" : req.method;
  const ip = ipOf(req);
  const nonce = randomId(16);

  // open routes: no session needed (nothing here carries slide content)
  if (path === "/robots.txt" && method === "GET") return assetRes(env, "/robots.txt", req);
  if (path === "/blank" && method === "GET") return pageRes(BLANK, req, nonce);
  if (path === "/brand.css" && method === "GET") return assetRes(env, "/brand.css", req);
  if (path === "/ui.css" && method === "GET") return assetRes(env, "/ui.css", req);   // round 2: shared UI tokens (no slide content)
  if (path.startsWith("/fonts/") && method === "GET") {
    const n = path.slice(7);
    if (!IMG_RE.test(n)) return json({ error: "not found" }, req, 404);
    const r = await assetRes(env, "/fonts/" + n, req);   // G10 scale: fonts never change, so a phone fetches each one once, not on every page
    if (r.status === 200) r.headers.set("Cache-Control", "public, max-age=604800, immutable");
    return r;
  }
  if (path.startsWith("/img/") && method === "GET") {
    const n = path.slice(5);
    if (!IMG_RE.test(n)) return json({ error: "not found" }, req, 404);
    if (OPEN_IMG.has(n)) return assetRes(env, "/img/" + n, req);
  }

  if (!configured(env)) {
    return plain("This event is not configured yet. The Worker secrets PRESENTER_PASSWORD and SESSION_SECRET must be set.", req, 503);
  }

  // login and logout
  if (path === "/presenter/login" && method === "POST") { if (!sameOrigin(req)) return json({ error: "bad origin" }, req, 403); return login(req, env, url); }
  if (path === "/logout" && (method === "GET" || method === "POST")) {
    const res = new Response(null, { status: 303, headers: { location: "/" } });
    const sec = url.protocol === "https:";
    res.headers.append("set-cookie", clearCookie("presenter", sec));
    res.headers.append("set-cookie", clearCookie("audience", sec));
    return secure(res, req);
  }

  const sess = await sessionOf(req, env);
  const isP = !!sess && sess.role === "presenter";

  // the audience link: /join/<code>. A valid code shows the first name, last name and email form; a signed in
  // audience browser goes straight to the audience app. Either way the presenter cookie is left alone.
  if ((path === "/join" || path === "/join/") && method === "GET") {   // round 2: the short join page (code typed by hand)
    const typed = String(url.searchParams.get("c") || "").slice(0, 64);
    if (!typed) return pageRes(joinPage(), req, nonce);
    const real = await audienceCode(env);
    const ok = (await secretEquals(typed.trim(), real)) || (await secretEquals(normCode(typed), normCode(real)));   // case and spaces do not matter when typed
    if (!ok) return pageRes(joinPage("That code does not match. Check the screen and try again.", typed), req, nonce, 404);
    return secure(new Response(null, { status: 303, headers: { location: "/join/" + encodeURIComponent(real) } }), req);
  }
  if (path.startsWith("/join/") && method === "GET") {
    const code = decodeURIComponent(path.slice(6)).replace(/\/$/, "");
    if (!(await secretEquals(code, await audienceCode(env)))) return pageRes(badLinkPage(), req, nonce, 404);
    const c = parseCookies(req.headers.get("cookie"));
    if (await verifyToken(env.SESSION_SECRET, c[COOKIE.audience], "audience")) return secure(new Response(null, { status: 303, headers: { location: "/app?as=aud" } }), req);
    return pageRes(signInPage(nonce, "/app?as=aud", code), req, nonce);
  }

  if (path === "/presenter" && method === "GET") {
    const nx = PNEXT_OK.has(url.searchParams.get("next") || "") ? url.searchParams.get("next") : "/";
    if (isP) return secure(new Response(null, { status: 303, headers: { location: nx } }), req);
    return pageRes(loginPage("presenter", { next: nx }), req, nonce);
  }

  // presenter-only apps: the question board (admin) and the phone remote
  if ((path === "/admin" || path === "/remote") && method === "GET") {
    if (!isP) return secure(new Response(null, { status: 303, headers: { location: "/presenter?next=" + path } }), req);
    return pageRes(nonceInline(await template(env, path.slice(1) + ".html"), nonce), req, nonce);
  }

  if ((path === "/follow" || path === "/follow/") && method === "GET") return secure(new Response(null, { status: 303, headers: { location: "/app" } }), req);
  if (path === "/guide.md" && method === "GET") {
    if (!sess) return json({ error: "login required" }, req, 401);
    const nm = assistantName(url.searchParams.get("name"));
    return secure(new Response(guideMarkdown(nm), { status: 200, headers: { "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="build-${slugOf(nm)}.md"` } }), req);
  }

  if (path === "/starter.md" && method === "GET") {   // round 2 kit: the starter prompt as a Markdown file
    if (!sess) return json({ error: "login required" }, req, 401);
    const nm = assistantName(url.searchParams.get("name"));
    return secure(new Response(starterMarkdown(nm), { status: 200, headers: { "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${slugOf(nm)}-starter-prompt.md"` } }), req);
  }

  // pages
  const PAGES = new Set(["/", "/start", "/watch", "/notes", "/maisie", "/frame", "/app"]);
  if (PAGES.has(path) || path === "/notes/" || path === "/maisie/" || path === "/watch/" || path === "/app/") {
    if (method !== "GET") return json({ error: "method" }, req, 405);
    const p = path.replace(/\/$/, "") || "/";
    // the copy editor is presenter only: anyone else (signed out, or signed in as audience) is sent to the presenter sign in and back, not to the join form or the phone app
    if (p === "/" && url.searchParams.get("edit") === "1" && !isP) return secure(new Response(null, { status: 303, headers: { location: "/presenter?next=" + encodeURIComponent("/?edit=1") } }), req);
    if (!sess) {
      if (p === "/frame") return json({ error: "login required" }, req, 401);
      return pageRes(signInPage(nonce, NEXT_OK.has(p) ? p : "/"), req, nonce);
    }
    const pg = (h, st) => pageRes(sess.aud ? audShim(h, nonce) : h, req, nonce, st);
    if (p === "/") {
      if (isP) {
        const pub = await eventJson(env, "/do/pub", { sess, ip });
        return pageRes(presenterPage(nonce, pub.slide, pub.cp, url.searchParams.get("edit") === "1"), req, nonce);   // G9: ?edit=1 is the copy editor
      }
      // The slide QR and the join form both land on "/". A phone there goes straight to the app, the only page where the poll can be answered
      // (the start page had no link to it and Watch live shows the question without its answers). /start keeps the old three tile page.
      return secure(new Response(null, { status: 303, headers: { location: "/app?as=aud" } }), req);
    }
    if (p === "/start") return pg(startPage());
    if (p === "/watch") return pg(shellPage(nonce));
    if (p === "/frame") {
      const pub = await eventJson(env, "/do/pub", { sess, ip });
      if (pub.slide == null) return pageRes(BLANK, req, nonce);
      if (url.searchParams.get("m") === "1") return pageRes(mobileFramePage(pub.slide, nonce, HEAD, TITLE, pub.cp), req, nonce);
      return pageRes(framePage(pub.slide, url.searchParams.get("fx") || pub.fx, nonce, pub.cp), req, nonce);
    }
    if (p === "/app") return pg(appPage(await template(env, "app.html"), nonce, isP ? await eventJson(env, "/do/poll/questions", { sess, ip })
      : JSON.parse((await shared("questions", async () => asRes(await toEvent(env, "/do/poll/questions", { sess, ip })))).body)));   // G10 scale: shared by every phone that opens the app   // ---- v4 a17 q: the edited list
    if (p === "/notes") return secure(new Response(null, { status: 303, headers: { location: "/app" } }), req);   // one audience app: Notes and resources is /app now
    return pg(maisiePage(await template(env, "maisie.html"), nonce));
  }

  // deck engine files and images, gated by role
  if (path.startsWith("/_deck/") && method === "GET") {
    const n = path.slice(7), need = DECK_FILES[n];
    if (!need) return json({ error: "not found" }, req, 404);
    if (!sess) return json({ error: "login required" }, req, 401);
    if (need === "presenter" && !isP) return json({ error: "presenter only" }, req, 403);
    return assetRes(env, "/_deck/" + n, req);
  }
  if (path.startsWith("/img/") && method === "GET") {
    const n = path.slice(5);
    if (!sess) return json({ error: "login required" }, req, 401);
    if (!isP) {
      const pub = await eventJson(env, "/do/pub", { sess, ip });
      if (pub.slide == null || !imagesOfScene(pub.slide).has(n)) return json({ error: "not available yet" }, req, 403);
    }
    return assetRes(env, "/img/" + n, req, { store: false });
  }

  // api
  if (path.startsWith("/api/")) {
    const cpy = await copyApi(req, env, url, sess, { json, toEvent, sameOrigin, ipOf, secure }); if (cpy) return cpy;   // G9 editable copy: presenter cookie or Maisie's key
    // accounts: sign in, profile, private notes, and the presenter's account and room views (src/accounts.js)
    const acc = await accountsApi(req, env, url, sess, { json, toEvent, eventJson, readBody, sameOrigin, ipOf });
    if (acc) return acc;
    if (!sess) return json({ error: "login required" }, req, 401);
    // the audience link for the admin page: presenter only, a read
    if (path === "/api/ctl/join" && method === "GET") {
      if (!isP) return json({ error: "presenter only" }, req, 403);
      const code = await audienceCode(env);
      return json({ code, path: "/join/" + encodeURIComponent(code) }, req);
    }
    if (path === "/api/ws") {
      if (req.headers.get("upgrade") !== "websocket") return json({ error: "websocket expected" }, req, 426);
      if (!sameOrigin(req) || !req.headers.get("origin")) return json({ error: "bad origin" }, req, 403);
      const h = new Headers({ upgrade: "websocket", "x-role": sess.role, "x-sid": sess.sid, "x-ip": ip });
      return stub(env).fetch("https://event/do/ws", { headers: h });
    }
    if (method === "POST" && !sameOrigin(req)) return json({ error: "bad origin" }, req, 403);
    const wl = await wallApi(req, env, url, sess, isP, { json, toEvent, readBody, sameOrigin, ipOf }); if (wl) return wl;   // v3 wall
    const cid = req.headers.get("x-cid") || "";
    if (path === "/api/state" && method === "GET") {
      const v = (url.searchParams.get("v") || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 24);
      if (!isP) {   // G10 scale: the audience state is the same for every phone; one read per isolate per second, viewers handed over with it
        noteViewer(sess.sid);
        return cachedRes(await shared("state", async () => asRes(await toEvent(env, "/do/state", { method: "POST", sess, ip, body: JSON.stringify({ seen: takeViewers() }) }))), req);
      }
      return passthru(await toEvent(env, "/do/state" + (v ? "?v=" + v : ""), { sess, ip }), req);
    }
    if (path === "/api/plan" && method === "GET") return passthru(await toEvent(env, "/do/plan", { sess, ip }), req);   // ---- v4 c
    if (path === "/api/remote" && method === "GET") {
      if (!isP) return json({ error: "presenter only" }, req, 403);
      return passthru(await toEvent(env, "/do/remote", { sess, ip }), req);
    }
    if (path === "/api/content" && method === "GET") return passthru(await toEvent(env, "/do/content", { sess, ip }), req);
    if ((path === "/api/questions.csv" || path === "/api/registrants.csv") && method === "GET") {
      if (!isP) return json({ error: "presenter only" }, req, 403);
      const r = await toEvent(env, "/do/" + path.slice(5), { sess, ip });
      return secure(new Response(r.body, { status: r.status, headers: r.headers }), req);
    }
    if (path.startsWith("/api/poll/")) {
      // the poll: answers are audience only, tallies are counts only (the Event object applies the no-peeking rule)
      const name = path.slice(10);
      if ((name === "answer" || name === "text") && method === "POST") {   // ---- v4 a17 q: text is the open text answer
        const t = await readBody(req);
        if (t == null) return json({ error: "too large" }, req, 413);
        return passthru(await toEvent(env, "/do/poll/" + name, { method: "POST", body: t, sess, ip, cid }), req);
      }
      if ((name === "tally" || name === "mine" || name === "thread" || name === "questions" || (name === "texts" && isP)) && method === "GET") {
        const q = (url.searchParams.get("q") || "").slice(0, 40);
        if (!isP && (name === "tally" || name === "questions" || name === "thread")) {   // G10 scale: counts, the question list and the thread are the same for every phone
          const k = name === "tally" ? "tally:" + q : name;
          return cachedRes(await shared(k, async () => asRes(await toEvent(env, "/do/poll/" + name + (name === "tally" ? "?q=" + encodeURIComponent(q) : ""), { sess, ip }))), req);
        }
        return passthru(await toEvent(env, "/do/poll/" + name + (name === "tally" ? "?q=" + encodeURIComponent(q) : ""), { sess, ip }), req);
      }
      return json({ error: "not found" }, req, 404);
    }
    if (path.startsWith("/api/ctl/") && method === "POST") {
      if (!isP) return json({ error: "presenter only" }, req, 403);
      const t = await readBody(req);
      if (t == null) return json({ error: "too large" }, req, 413);
      return passthru(await toEvent(env, "/do/ctl/" + path.slice(9).replace(/[^a-z]/g, ""), { method: "POST", body: t, sess, ip, cid }), req);
    }
    if (path.startsWith("/api/maisie/")) {
      const name = path.slice(12);
      if (!/^[a-z-]{1,20}$/.test(name)) return json({ error: "not found" }, req, 404);
      const PRESENTER_ONLY = new Set(["ask", "approve", "dismiss", "undo", "clear", "say", "budget-reset", "log", "qlist", "qset", "qsteer", "livechat", "callout", "qpick", "qdone"]);
      if (PRESENTER_ONLY.has(name) && !isP) return json({ error: "presenter only" }, req, 403);
      let body;
      if (method === "POST") { body = await readBody(req); if (body == null) return json({ error: "too large" }, req, 413); }
      return passthru(await toEvent(env, "/do/maisie/" + name + url.search, { method, body, sess, ip, cid }), req);
    }
    return json({ error: "not found" }, req, 404);
  }

  return json({ error: "not found" }, req, 404);
}

// G10 scale: a response rebuilt from a shared read (src/scale.js)
const cachedRes = (r, req) => secure(new Response(r.body, { status: r.status, headers: { "content-type": r.type } }), req);
function passthru(r, req) {
  return secure(new Response(r.body, { status: r.status, headers: { "content-type": r.headers.get("content-type") || "application/json" } }), req);
}

export default {
  async fetch(req, env) {
    try {
      return await route(req, env);
    } catch (e) {
      console.error("route failed", req.method, new URL(req.url).pathname, String((e && e.message) || e).slice(0, 200));   // G10: visible in wrangler tail, never to the client
      // never echo internals to the client
      return secure(new Response("Something went wrong. Try again in a moment.", { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } }), req);
    }
  },
};
