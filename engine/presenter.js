/* Presenter hook. The Worker adds this only to the page it serves after a valid presenter login.
   It reports the current slide, build step, effects level, blackout and ticks to the
   room (every audience phone and laptop), follows changes made from another presenter tab,
   and adds the audience QR card (press L, or the Phones button in the bottom bar).
   Talks to the deck only through window.LiveDeck and a few small hooks the engine exposes. */
(function(){
if(window.__LIVE_P) return; window.__LIVE_P=true;
const D=window.LiveDeck; if(!D){ console.warn("presenter.js: this deck does not expose window.LiveDeck"); return; }
const CID=Math.random().toString(36).slice(2,12);
const EPK=D.storageKey+"-epoch";
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

let lastCmd=0;   /* v4 a23 step: the last Back or Next from the remote that this page has played */
let beatSent=-1;   /* v4 fix b: the last beat this page told the room */
let info={}, ready=false, applying=false, unsynced=false, inflight=0, lastNav=0, ws=null, wsOk=false, wsAt=0, wsTry=0;

async function ctl(name,body){
  inflight++;
  try{
    const r=await fetch("/api/ctl/"+name,{method:"POST",credentials:"same-origin",cache:"no-store",
      headers:{"Content-Type":"application/json","x-cid":CID},body:JSON.stringify(body||{})});
    if(r.status===401||r.status===403){ status("Signed out. Reload to log in again."); return null; }
    if(!r.ok){ unsynced=true; return null; }
    const j=await r.json().catch(()=>({})); unsynced=false;
    if(j&&j.state) info=j.state;
    return j;
  }catch(e){ unsynced=true; status("Offline. Retrying."); return null; }
  finally{ inflight--; }
}
async function getState(){
  try{ const r=await fetch("/api/state",{cache:"no-store",credentials:"same-origin"}); if(r.ok) return await r.json(); }catch(e){}
  return null;
}

/* ---- what the room should show, pushed by this page ---- */
function pushAll(){
  ctl("jump",{slide:D.slide()});
  ctl("ticks",{done:D.done()});
  try{ ctl("effects",{level:FXSET.setting()}); }catch(e){}
  try{ if(D.pace) ctl("pace",{mode:D.pace.get()}); }catch(e){}
  ctl("qr",{on:card.classList.contains("on")});
}
D.on("slide",()=>{ beatSent=-1; if(applying) return; lastNav=Date.now(); ctl("jump",{slide:D.slide()}); });   /* v4 fix b: the room resets the beat to 0 on a jump, so the next poll tells it the real one */
D.on("tick",()=>{ if(applying) return; setTimeout(()=>{ if(!applying) ctl("ticks",{done:D.done()}); },0); });
/* v4 fix b: the beat the room sees is the real step. The 2 a.m. slide and Rehearse play a sequence of their own: one build click starts it and
   each later position is one more press, so the build counter alone says 1 the whole way. On those two slides every position after the first
   counts as one more step, and a build that follows (Rehearse "Your turn") carries on from there. Everywhere else the beat is the build counter, as before. */
const STEPPED=["where","move4"];
function realBeat(){
  const cur=D.steps.current();
  try{
    const pl=window.__PLAYERS||{};
    for(const k of STEPPED){ const P=pl[k]; if(P && P.started() && cur>=P.gate && P.pos()>1) return cur+P.pos()-1; }
  }catch(e){}
  return cur;
}
function sendBeat(){ if(applying) return; const b=realBeat(); beatSent=b; try{ ctl("beat",{beat:b}); }catch(e){} }
if(D.onStep) D.onStep(sendBeat);
if(D.onUnstep) D.onUnstep(sendBeat);   /* v4 a23 step: Back takes a build away */
setInterval(()=>{ if(ready && !applying && inflight===0 && realBeat()!==beatSent) sendBeat(); },250);   /* v4 fix b: player positions move without a build event */
window.__onBlackout=on=>{ if(applying) return; ctl("blackout",{on:!!on}); };
try{ FXSET.on(()=>{ if(!applying) ctl("effects",{level:FXSET.setting()}); }); }catch(e){}
/* v4 a17 ctl: the D key on this laptop tells the room (admin Controls, remote) the new pace */
try{ if(D.pace&&D.pace.on) D.pace.on(m=>{ if(!applying) ctl("pace",{mode:m}); }); }catch(e){}

/* ---- what the room says back (another presenter tab, a reconnect) ---- */
function apply(s,viaPoll){
  if(!s) return;
  try{ window.dispatchEvent(new CustomEvent("live-state",{detail:s})); }catch(_){}
  info=s;
  try{ if(s.plan && window.__setPlan) window.__setPlan(s.plan); }catch(_){}   /* v4 c: slide order and hidden set */
  const mine=s.by===CID, theirs=!!s.by&&!mine;
  applying=true;
  try{
    if(typeof s.slide==="number" && s.slide!==D.slide() && !mine){
      const quiet=Date.now()-lastNav>4000 && inflight===0;
      if(theirs || (viaPoll && quiet) || !ready) D.go(s.slide);
    }
    if(!mine){
      if(typeof s.blackout==="boolean" && window.__setBlackout) window.__setBlackout(s.blackout);
      if(s.fx && window.FXSET && FXSET.setting()!==s.fx) FXSET.set(s.fx);
      if((s.pace==="auto"||s.pace==="click") && D.pace && D.pace.get()!==s.pace) D.pace.set(s.pace);   /* v4 a17 ctl */
      if(typeof s.qr==="boolean" && s.qr!==card.classList.contains("on")) setCard(s.qr);
      const done=(s.done||[]).slice().sort();
      if(!same(done,D.done()) && (theirs||!ready) ){
        const u=[...new Set([...(theirs?[]:D.done()),...done])].sort(); D.setDone(theirs?done:u);
      }
    }
  }catch(e){ console.warn("presenter apply",e); }
  finally{ applying=false; }
  /* v4 a23 step: autoplay per slide comes from the room; a Back or Next from the remote is played here, one step, then acknowledged */
  try{ if(s.auto && D.autoplay) D.autoplay.set(s.auto); }catch(e){ console.warn("presenter auto",e); }
  try{
    const c=s.cmd;
    if(c && typeof c.n==="number" && c.n>lastCmd){
      lastCmd=c.n;
      if(ready){ if(c.d>0 && D.forward) D.forward(); else if(c.d<0 && D.back) D.back(); ctl("ack",{n:c.n}); }
    }
  }catch(e){ console.warn("presenter cmd",e); }
  paint();
}

async function boot(){
  const s=await getState();
  if(!s){ setTimeout(boot,2000); return; }
  const known=localStorage.getItem(EPK);
  applying=true;
  try{ if(known!==null && +known!==s.epoch) D.setDone([]); }catch(e){} finally{ applying=false; }
  try{ localStorage.setItem(EPK,String(s.epoch)); }catch(e){}
  if(s.slide==null){            /* nothing has started yet: this page's own settings are the truth */
    ready=true; info=s; pushAll();
  }else{
    apply(s,false); ready=true;
    if(!same((s.done||[]).slice().sort(),D.done())) ctl("ticks",{done:D.done()});   /* never lose ticks made on this laptop */
  }
  paint(); connect(); setInterval(poll,1000);
}
async function poll(){
  if(wsOk && Date.now()-wsAt<35000) return;
  const s=await getState(); if(!s) return;
  if(unsynced){ pushAll(); return; }
  apply(s,true);
}
function connect(){
  if(!window.WebSocket||ws) return;
  let w; try{ w=new WebSocket((location.protocol==="https:"?"wss://":"ws://")+location.host+"/api/ws"); }catch(e){ return; }
  ws=w;
  w.onopen=()=>{ wsOk=true; wsAt=Date.now(); wsTry=0; };
  w.onmessage=e=>{ wsAt=Date.now(); try{ const m=JSON.parse(e.data); if(m&&m.t==="state"){ if(unsynced){ pushAll(); } else apply(m.s,false); } else if(m&&m.t==="poll"){ window.dispatchEvent(new CustomEvent("live-poll",{detail:m})); } }catch(_){} };
  const gone=()=>{ if(ws!==w) return; wsOk=false; ws=null; try{ w.close(); }catch(_){} setTimeout(connect,Math.min(15000,1000*(++wsTry))); };
  w.onclose=gone; w.onerror=gone;
}
setInterval(()=>{ if(ws&&wsOk){ try{ ws.send("ping"); }catch(_){} } },20000);
addEventListener("storage",e=>{ if(e.key===D.storageKey) setTimeout(()=>ctl("ticks",{done:D.done()}),0); });
boot();

/* ---- control: tell the command center these slides are loaded and which slide they show ---- */
function hello(){ try{ fetch("/api/ctl/hello",{method:"POST",credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json","x-cid":CID},body:JSON.stringify({k:"slides",slide:D.slide()})}).catch(()=>{}); }catch(e){} }
setInterval(hello,4000); setTimeout(hello,300); D.on("slide",()=>setTimeout(hello,150));

/* ---- QR card ---- */
const st=document.createElement("style");
st.textContent=`
#flcard{position:fixed;left:22px;bottom:62px;z-index:2147482001;background:#fff;border-radius:18px;padding:14px;width:250px;text-align:center;
  box-shadow:0 20px 50px rgba(0,0,0,.35);font-family:var(--font);color:var(--dark);display:none}
#flcard.on{display:block;animation:flIn .4s cubic-bezier(.2,.8,.2,1)}
@keyframes flIn{from{opacity:0;transform:translateX(-12px)}to{opacity:1;transform:none}}
#flcard .qr{width:210px;height:210px;margin:0 auto;display:block}
#flcard .qr svg{width:210px;height:210px;display:block}
#flcard b{display:block;font-size:15.5px;margin-top:8px}
#flcard .u{display:block;font-size:11.5px;color:#64748B;margin-top:3px;word-break:break-all}
#flcard .s{display:block;font-size:12px;font-weight:700;color:var(--accent);margin-top:8px}
#flcard .more{position:absolute;top:8px;right:10px;border:0;background:none;font-size:18px;color:#94A3B8;cursor:pointer}
#flcard .ctl{display:none;text-align:left;border-top:1px solid #E2E8F0;margin-top:10px;padding-top:10px;font-size:13px}
#flcard.ctl .ctl{display:block}
#flcard .ctl button{width:100%;border:0;border-radius:8px;padding:8px;background:#FEE2E2;color:#991B1B;font-weight:700;cursor:pointer}
#flcard .ctl a{display:block;margin-top:8px;color:var(--brand);font-weight:600}`;
document.head.appendChild(st);
const short=location.host;
const card=document.createElement("div"); card.id="flcard";
card.innerHTML=`<button class="more" title="Presenter controls">&#8943;</button><div class="qr" id="flqr"></div><b>Follow along on your phone</b>
  <span class="u">${short}</span><span class="s" id="fls">Connecting</span>
  <div class="ctl"><button id="flreset">Reset all ticks</button><a href="/api/questions.csv">Download questions (CSV)</a></div>`;
document.body.appendChild(card);
function drawQR(){
  const box=card.querySelector("#flqr"); if(!box||box.firstChild) return;
  try{
    const q=window.qrcode(0,"M"); q.addData(location.origin+"/"); q.make();
    box.innerHTML=q.createSvgTag({cellSize:4,margin:8,scalable:true});
  }catch(e){ box.textContent=location.origin; }
}
card.querySelector(".more").onclick=e=>{ e.stopPropagation(); card.classList.toggle("ctl"); };
card.querySelector("#flreset").onclick=async e=>{ e.stopPropagation();
  if(!confirm("Clear every tick, in the deck and on all phones?")) return;
  const j=await ctl("reset",{});
  if(j&&j.ok){ try{ localStorage.setItem(EPK,String(j.epoch)); }catch(_){} applying=true; try{ D.setDone([]); }finally{ applying=false; } } };
function status(t){ const s=card.querySelector("#fls"); if(s) s.textContent=t; }
function paint(){
  const n=(info.done||[]).length, v=info.viewers, tot=info.total||D.total();
  status(`Live, ${n} of ${tot} ${String((window.LIVE_LABELS||{}).shown||"shown").toLowerCase()}`+(typeof v==="number"?`, ${v} viewer${v===1?"":"s"}`:""));
}
function setCard(on){ card.classList.toggle("on",!!on); if(on) drawQR(); }
function toggle(){ setCard(!card.classList.contains("on")); if(!applying) ctl("qr",{on:card.classList.contains("on")}); }
document.addEventListener("keydown",e=>{
  if(e.metaKey||e.ctrlKey||e.altKey) return;
  if(e.target&&e.target.matches&&e.target.matches("input,textarea")) return;
  if(e.key==="l"||e.key==="L"){ toggle(); e.stopPropagation(); }
},true);
/* v4 a17 ctl: no Phones button on the slide. The L key still opens the card, and so does the admin Controls tab. */
D.addButton("Questions", ()=>window.open("/admin","_blank","noopener"), "bfq");
})();
