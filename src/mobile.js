// Mobile slide renderer. The 1440x810 deck engine is made for a projector; on a phone it shrinks to
// a postage stamp. This file draws the same slide data (current scene only, no speaker notes) as a
// vertical, thumb-sized card with icons and small diagrams. It is pure markup and CSS: no engine.
import { audienceData, jsLit } from "./deckdata.js";
import { applyCopy } from "./copy.js";   // G9 editable copy

const E = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const P = {
  pencil: '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.2 7.6-8 9-4.8-1.4-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  flask: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3"/>',
  doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  x: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  scale: '<path d="M12 3v18M6 21h12M5 7h14"/><path d="M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};
const ico = (n, cls = "") => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || P.spark}</svg>`;

// wrap the em phrase of a title in a highlight
function title(t, em) {
  const s = String(t || ""), m = String(em || "");
  const k = m ? s.indexOf(m) : -1;
  if (k < 0) return E(s);
  return E(s.slice(0, k)) + `<em>${E(m)}</em>` + E(s.slice(k + m.length));
}
const kick = (s) => (s.kick ? `<p class="kick">${E(s.kick)}</p>` : "");
const hl = (s) => (s.hl ? `<aside class="hl">${ico("spark")}<p>${E(s.hl)}</p></aside>` : "");

const MOVE_ICON = ["compass", "shield", "spark", "chat"];
const CARD_ICON = [["shield", "check", "eye"], ["pencil", "x", "flask", "users"]];

const R = {
  open(s) {
    const p = s.portrait && s.portrait.img ? `<div class="avatar"><img src="${E(s.portrait.img.startsWith("/") ? s.portrait.img : "/" + s.portrait.img)}" alt="${E(s.portrait.alt || "")}"></div>` : "";
    const meta = (s.meta || []).map((m, i) => `<p class="meta${i ? " small" : ""}">${E(m)}</p>`).join("");
    return `${p}${kick(s)}<h1>${title(s.title, s.em)}</h1><p class="lede">${E(s.sub || "")}</p><div class="rule"></div>${meta}`;
  },
  confess(s) {
    const c = s.curve || ["", ""];
    const curve = `<figure class="curve"><svg viewBox="0 0 320 120" role="img" aria-label="${E(c[0])} in the middle, ${E(c[1])} at the edges">
<path d="M0 108 C60 108 90 100 120 70 C140 48 150 14 160 14 C170 14 180 48 200 70 C230 100 260 108 320 108" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="2"/>
<path d="M104 108 C120 90 140 30 160 14 C180 30 200 90 216 108Z" fill="var(--brand)" opacity=".85"/>
<circle cx="14" cy="104" r="6" fill="var(--bright)"/><circle cx="306" cy="104" r="6" fill="var(--bright)"/></svg>
<figcaption><span>${E(c[1])}</span><span class="a">${E(c[0])}</span><span>${E(c[1])}</span></figcaption></figure>`;
    const cols = (s.cols || []).map((col, i) => `<section class="card ${i ? "alt" : ""}"><h3>${ico(i ? "compass" : "pencil")}${E(col.h)}</h3><ul>${(col.items || []).map((x) => `<li>${E(x)}</li>`).join("")}</ul></section>`).join("");
    return `${kick(s)}<h1>${title(s.title, s.em)}</h1>${curve}${cols}`;
  },
  ladder(s) {
    const steps = (s.steps || []).map((st, i, a) => `<li class="step s${i}${i === a.length - 1 ? " top" : ""}" style="margin-left:${i * 14}px">
<span class="num">${i + 1}</span><div><h3>${E(st[1])}</h3><p>${E(st[2])}</p></div>${i === a.length - 1 ? ico("up", "arrow") : ""}</li>`).join("");
    return `${kick(s)}<h1>${title(s.title, s.em)}</h1><ol class="steps">${steps}</ol>${hl(s)}`;
  },
  where(s) {
    const cols = (s.cols || []).map((c, i) => `<section class="card ${i ? "alt" : ""}"><h3>${ico(i ? "spark" : "clock")}${E(c.h)}</h3><p>${E(c.t)}</p></section>`).join("");
    return `<div class="moon">${ico("moon")}</div>${kick(s)}<h1>${title(s.title, s.em)}</h1><p class="lede">${E(s.sub || "")}</p>${cols}${hl(s)}`;
  },
  system(s) {
    const tiles = (s.moves || []).map((m, i) => `<li class="tile"><span class="n">${E(m[0])}</span>${ico(MOVE_ICON[i % 4])}<h3>${E(m[1])}</h3><p>${E(m[2])}</p>${s.roles && s.roles[i] ? `<span class="role">${E(s.roles[i])}</span>` : ""}</li>`).join("");
    return `${kick(s)}<h1>${title(s.title, s.em)}</h1><ul class="tiles">${tiles}</ul>${s.foot ? `<p class="foot">${E(s.foot)}</p>` : ""}`;
  },
  move(s) {
    const head = `<div class="mvhead"><span class="big">${E(s.n)}</span><span class="of">of 4</span>${s.time ? `<span class="chip">${ico("clock")}${E(s.time)}</span>` : ""}</div>`;
    let body = "";
    if (s.blockH) body += `<h2 class="sub">${E(s.blockH)}</h2>`;
    if (s.assume) body += `<ul class="assume">${s.assume.map((a, i) => `<li${s.key === i ? ' class="key"' : ""}>${ico(s.key === i ? "target" : "check")}<span>${E(a)}</span></li>`).join("")}</ul>`;
    if (s.chips) body += `<div class="chips">${s.chips.map((c) => `<span>${ico("user")}${E(c)}</span>`).join("")}</div>`;
    if (s.dots && s.dots.length === 2) {
      const [a, b] = s.dots;
      body += `<figure class="dots" aria-label="${a} ordinary options and ${b} you would never consider"><div>${"<i></i>".repeat(a)}${'<i class="odd"></i>'.repeat(b)}</div><figcaption><span>${a} ordinary</span><span class="o">${b} never</span></figcaption></figure>`;
    }
    if (s.blocks) body += s.blocks.map((b, i) => `<section class="card ${i ? "alt" : ""}"><h3>${ico(i ? "target" : "spark")}${E(b.h)}</h3><p>${E(b.t)}</p>${b.foot ? `<p class="mini">${E(b.foot)}</p>` : ""}</section>`).join("");
    return `${kick(s)}${head}<h1>${title(s.title, s.em)}</h1>${body}${hl(s)}`;
  },
  cards(s) {
    const set = s.cols3 ? 0 : 1;
    const items = (s.items || []).map((it, i) => `<li class="card ${i === 0 && s.cols3 ? "alt" : ""}"><h3>${ico(CARD_ICON[set][i % CARD_ICON[set].length])}${E(it[0])}</h3><p>${E(it[1])}</p></li>`).join("");
    const blanks = s.blanks ? `<div class="blanks">${ico("pen")}<p>${E(s.hl)}</p></div>` : hl(s);
    return `${kick(s)}<h1>${title(s.title, s.em)}</h1><ul class="stack">${items}</ul>${blanks}`;
  },
  close(s) {
    const p = s.portrait && s.portrait.img ? `<div class="avatar sm"><img src="${E(s.portrait.img.startsWith("/") ? s.portrait.img : "/" + s.portrait.img)}" alt="${E(s.portrait.alt || "")}"></div>` : "";
    const c = s.contact || [];
    const rows = [[c[0], "user"], [c[1], "mail"], [c[2], "globe"], [c[3], "link"]].filter((r) => r[0]).map((r) => `<li>${ico(r[1])}<span>${E(r[0])}</span></li>`).join("");
    return `${p}${kick(s)}<h1>${title(s.title, s.em)}</h1>${(s.body || []).map((b) => `<p class="lede">${E(b)}</p>`).join("")}<ul class="contact">${rows}</ul>`;
  },
  walkout(s) {
    const src = s.img ? (String(s.img).startsWith("/") ? s.img : "/" + s.img) : "";
    return `<figure class="photo"><img src="${E(src)}" alt="${E(s.alt || "")}"></figure><h1 class="small">${E(s.title)}</h1><p class="foot">${E(s.foot || "")}</p>`;
  },
};

const CSS = `
*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:var(--dark);color:#fff;font-family:var(--font);-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%}
body{min-height:100dvh;background:radial-gradient(520px 340px at 100% -6%,color-mix(in srgb,var(--bright) 26%,transparent),transparent 70%),radial-gradient(420px 300px at -10% 104%,color-mix(in srgb,var(--brand) 22%,transparent),transparent 70%),var(--dark)}
.wrap{max-width:560px;margin:0 auto;padding:calc(22px + env(safe-area-inset-top)) 18px calc(96px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:16px}
/* v4 fix b: the watch bar floats 56px up and is about 40px tall, so on narrow screens the page ends 120px above the bottom edge (28px of clear space under the last card at the end of the scroll). */
@media (max-width:520px){.wrap{padding-bottom:calc(108px + env(safe-area-inset-bottom))}}
.wrap>*{animation:rise .55s cubic-bezier(.2,.8,.2,1) both}
.wrap>*:nth-child(2){animation-delay:.05s}.wrap>*:nth-child(3){animation-delay:.1s}.wrap>*:nth-child(4){animation-delay:.16s}.wrap>*:nth-child(5){animation-delay:.22s}.wrap>*:nth-child(n+6){animation-delay:.28s}
@keyframes rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.wrap>*{animation:none}.step .num,.arrow{animation:none!important}}
.kick{margin:0;font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--bright)}
h1{margin:0;font-family:var(--serif,var(--font));font-weight:600;font-size:clamp(28px,8.6vw,38px);line-height:1.12;letter-spacing:-.02em;text-wrap:balance}
h1.small{font-size:clamp(20px,6vw,26px)}
h1 em{font-style:italic;font-weight:500;color:var(--bright)}
h2.sub{margin:4px 0 -4px;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.6)}
h3{margin:0 0 6px;font-size:17px;line-height:1.25;display:flex;gap:10px;align-items:flex-start}
p{margin:0}.lede{font-size:18px;line-height:1.5;color:rgba(255,255,255,.82)}
.meta{font-size:15px;font-weight:700}.meta.small{font-weight:500;color:rgba(255,255,255,.65);font-size:13.5px;line-height:1.45}
.rule{height:3px;width:56px;border-radius:3px;background:var(--brand)}
.ic{width:22px;height:22px;flex:none;color:var(--bright)}
.avatar{width:112px;height:112px;border-radius:30px;overflow:hidden;box-shadow:0 0 0 3px var(--bright),0 20px 40px -18px rgba(0,0,0,.7)}
.avatar.sm{width:84px;height:84px;border-radius:24px}.avatar img{width:100%;height:100%;object-fit:cover;display:block}
.card{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:20px;padding:16px 16px 18px;list-style:none}
.card.alt{background:color-mix(in srgb,var(--brand) 22%,transparent);border-color:color-mix(in srgb,var(--brand) 55%,transparent)}
.card ul{margin:0;padding:0;list-style:none;display:grid;gap:8px}
.card li{position:relative;padding-left:20px;font-size:16px;line-height:1.4}
.card li::before{content:"";position:absolute;left:2px;top:.58em;width:8px;height:8px;border-radius:50%;background:var(--bright)}
.card p{font-size:16px;line-height:1.5;color:rgba(255,255,255,.88)}
.mini{margin-top:8px;font-size:13px!important;color:rgba(255,255,255,.6)!important}
.stack{margin:0;padding:0;display:grid;gap:12px}
.curve{margin:0}.curve svg{width:100%;height:auto;display:block}
.curve figcaption{display:flex;justify-content:space-between;font-size:13px;font-weight:700;margin-top:4px;color:rgba(255,255,255,.7)}
.curve .a{color:var(--bright)}.curve figcaption span{flex:1;text-align:center}.curve figcaption span:first-child{text-align:left}.curve figcaption span:last-child{text-align:right}
.hl{display:flex;gap:12px;align-items:flex-start;border-radius:20px;padding:16px;background:linear-gradient(135deg,var(--brand),color-mix(in srgb,var(--brand) 55%,var(--dark)));box-shadow:0 18px 36px -22px rgba(0,0,0,.8)}
.hl .ic{color:#fff;margin-top:2px}.hl p{font-size:16.5px;line-height:1.45;font-weight:600}
.steps{margin:0;padding:0;list-style:none;display:grid;gap:10px}
.step{display:flex;gap:14px;align-items:center;border-radius:20px;padding:14px 16px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12)}
.step .num{width:38px;height:38px;border-radius:50%;flex:none;display:grid;place-items:center;font-weight:800;background:rgba(255,255,255,.14)}
.step h3{margin:0 0 3px}.step p{font-size:14.5px;line-height:1.4;color:rgba(255,255,255,.78)}
.step.top{background:linear-gradient(135deg,var(--brand),color-mix(in srgb,var(--brand) 55%,var(--dark)));border-color:transparent}
.step.top .num{background:#fff;color:var(--brand)}.arrow{margin-left:auto;color:#fff;width:28px;height:28px;animation:bob 1.8s ease-in-out infinite}
@keyframes bob{50%{transform:translateY(-5px)}}
.moon{width:64px;height:64px;border-radius:20px;display:grid;place-items:center;background:rgba(255,255,255,.08)}.moon .ic{width:34px;height:34px}
.tiles{margin:0;padding:0;list-style:none;display:grid;grid-template-columns:1fr 1fr;gap:12px}
.tile{position:relative;border-radius:20px;padding:14px 14px 16px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);display:flex;flex-direction:column;gap:6px}
.tile .n{position:absolute;top:10px;right:14px;font:800 26px var(--font);color:rgba(255,255,255,.18)}
.tile h3{margin:4px 0 0;font-size:18px}.tile p{font-size:13.5px;line-height:1.4;color:rgba(255,255,255,.78)}
.role{margin-top:auto;align-self:flex-start;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--dark);background:var(--bright);border-radius:99px;padding:3px 9px}
.foot{font-size:13.5px;line-height:1.45;color:rgba(255,255,255,.62)}
.mvhead{display:flex;align-items:baseline;gap:8px}
.mvhead .big{font:700 64px/0.9 var(--serif,var(--font));color:var(--bright)}.mvhead .of{font-size:13px;font-weight:700;color:rgba(255,255,255,.55)}
.chip{margin-left:auto;display:inline-flex;align-items:center;gap:6px;border-radius:99px;padding:6px 12px;background:rgba(255,255,255,.1);font-size:13px;font-weight:700}
.chip .ic{width:16px;height:16px}
.assume{margin:0;padding:0;list-style:none;display:grid;gap:8px}
.assume li{display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border-radius:16px;background:rgba(255,255,255,.06);font-size:15px;line-height:1.4}
.assume li.key{background:color-mix(in srgb,var(--brand) 30%,transparent);outline:1.5px solid var(--brand);font-weight:700}
.chips{display:flex;flex-wrap:wrap;gap:8px}.chips span{display:inline-flex;gap:8px;align-items:center;padding:9px 13px;border-radius:99px;background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.14);font-size:14.5px}
.chips .ic{width:17px;height:17px}
.dots{margin:0}.dots div{display:grid;grid-template-columns:repeat(10,1fr);gap:8px;padding:6px 0}
.dots i{aspect-ratio:1;border-radius:50%;background:rgba(255,255,255,.35)}.dots i.odd{background:var(--bright);box-shadow:0 0 0 4px color-mix(in srgb,var(--bright) 28%,transparent)}
.dots figcaption{display:flex;justify-content:space-between;font-size:13px;font-weight:700;color:rgba(255,255,255,.65)}.dots .o{color:var(--bright)}
.blanks{display:flex;gap:12px;border-radius:20px;padding:16px;background:#fff;color:var(--dark);font-family:var(--serif,var(--font));font-size:17px;line-height:1.5;font-style:italic}
.blanks .ic{color:var(--brand)}
.contact{margin:0;padding:0;list-style:none;display:grid;gap:8px}.contact li{display:flex;gap:12px;align-items:center;padding:12px 14px;border-radius:14px;background:rgba(255,255,255,.07);font-size:15px;overflow-wrap:anywhere}
.photo{margin:0;border-radius:22px;overflow:hidden;box-shadow:0 24px 50px -24px rgba(0,0,0,.8)}.photo img{width:100%;height:auto;display:block}
/* Maisie additions */
#mcards{display:grid;gap:10px}
.mcard{display:flex;gap:12px;align-items:flex-start;background:#fff;color:var(--dark);border-radius:18px;padding:14px;box-shadow:0 18px 36px -22px rgba(0,0,0,.8);animation:rise .4s both}
.mcard img{width:36px;height:36px;border-radius:50%;object-fit:cover;flex:none}.mcard p{font-size:15px;line-height:1.45}.mcard b{display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--warm);margin-bottom:2px}
#msay{position:fixed;left:12px;right:12px;top:calc(12px + env(safe-area-inset-top));z-index:9;display:none}
#msay.on{display:flex;animation:rise .4s both}
`;

export function mobileFramePage(i, nonce, head, title0, cp) {
  const scenes = applyCopy(audienceData(i).scenes, cp);   // G9: Aran's wording on this one scene; sizes are for the projector layout only
  const s = scenes[i];
  const body = (R[s.t] || R.open)(s);
  return head(title0)
    + `<style>${CSS}</style><meta name="theme-color" content="#15233b"></head><body>
<main class="wrap" data-slide="${E(s.id)}">${body}<div id="mcards"></div></main>
<div id="msay"><div class="mcard"><img src="/img/maisie-avatar.jpg" alt=""><div><b>Maisie</b><p id="msayt"></p></div></div></div>
<script nonce="${nonce}">window.__START=${i | 0};window.LIVE_VIEW="watch";var SID=${jsLit(s.id)};
(function(){
  var cards=document.getElementById("mcards"),say=document.getElementById("msay"),st=document.getElementById("msayt"),seen={},tm;
  function paint(s){
    var list=(s.cards&&s.cards[SID])||[];
    list.forEach(function(c){ if(seen[c.id])return; seen[c.id]=1;
      var d=document.createElement("div");d.className="mcard";
      d.innerHTML='<img src="/img/maisie-avatar.jpg" alt=""><div><b>Maisie</b><p></p></div>';
      d.querySelector("p").textContent=c.text; cards.appendChild(d); });
    var q=s.say;
    if(q&&q.id&&!seen[q.id]){ seen[q.id]=1; st.textContent=(q.to?q.to+", ":"")+q.text; say.classList.add("on");
      clearTimeout(tm); tm=setTimeout(function(){ say.classList.remove("on"); },(q.ttl||9)*1000); }
  }
  window.__maisiePoll=function(){ fetch("/api/maisie/state",{credentials:"same-origin",cache:"no-store"}).then(function(r){return r.json();}).then(paint).catch(function(){}); };
  window.__maisiePoll();
})();</script></body></html>`;
}
