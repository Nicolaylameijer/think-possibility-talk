/* Watch-live shell. It holds no slide content itself. It listens to the room state (a WebSocket,
   with 1 second polling as the fallback) and, whenever the speaker changes slide, loads /frame,
   which the Worker answers with the speaker's current slide only. There is nothing to click:
   the audience cannot choose a slide, and no other slide is ever sent to this device. */
(function(){
"use strict";
const $=s=>document.querySelector(s);
const A=$("#fa"), B=$("#fb"), BK=$("#bk"), WAIT=$("#wait"), PILL=$("#wpill");
let front=A, back=B, shown=null, want=null, loading=false, fx="standard", state=null;
let cv=null;
let ws=null, wsOk=false, wsAt=0, wsTry=0, lastOk=0, mv=null, WHO=(window.__WHO||"speaker");
/* round 2 polls: the live poll takeover (/_deck/poll.js) rides on this page's socket, so it opens none of its own */
const LP=window.LivePoll||null;
if(LP) LP.config({fed:true,host:"watch"});

function paint(){
  const waiting=!state||state.slide==null;
  WAIT.classList.toggle("on",waiting);
  PILL.className=waiting?"":"on";
  PILL.innerHTML="<i></i>"+(waiting?"Waiting for the "+WHO:"Following the "+WHO);
  BK.classList.toggle("on",!!(state&&state.blackout));
}
function fxOf(s){ return ["calm","standard","full"].indexOf(s&&s.fx)>=0?s.fx:"standard"; }

/* a portrait or narrow screen gets the phone layout; rotating the phone reloads into the right one */
const isMob=()=>innerWidth<700||innerHeight>innerWidth*1.05;
const MOBILE=isMob();
addEventListener("resize",()=>{ if(isMob()!==MOBILE) location.reload(); });
function load(){
  if(loading||want==null||want===shown) return;
  loading=true;
  const target=want, f=back;
  f.onload=()=>{
    loading=false;
    let w=null; try{ w=f.contentWindow; }catch(e){}
    shown=(w&&typeof w.__START==="number")?w.__START:target;
    f.classList.add("on"); front.classList.remove("on");
    const old=front; front=f; back=old;
    setTimeout(()=>{ try{ if(back!==front && !loading){ back.onload=null; back.src="/blank"; } }catch(e){} },600);
    applyExtras();
    if(want!==shown) load();
  };
  f.onerror=()=>{ loading=false; };
  f.src="/frame?fx="+encodeURIComponent(fx)+(MOBILE?"&m=1":"")+"&t="+Date.now();
}
function win(){ try{ return front.contentWindow; }catch(e){ return null; } }
function applyExtras(){
  if(!state) return;
  const w=win(); if(!w) return;
  try{ if(w.FXSET && w.FXSET.setting && w.FXSET.setting()!==fx) w.FXSET.set(fx); }catch(e){}
  try{ if(state.mv!==mv){ mv=state.mv; if(typeof w.__maisiePoll==="function") w.__maisiePoll(); } }catch(e){}
}
function take(s){
  if(!s||typeof s!=="object") return;
  lastOk=Date.now(); state=s; fx=fxOf(s);
  if(LP) LP.feed(s);
  if(typeof s.slide==="number") want=s.slide;
  if(typeof s.cv==="number"){ if(cv!==null&&s.cv!==cv&&want===shown&&!loading) shown=null; cv=s.cv; }   /* G9: the slide on screen got new copy: load it again */
  paint();
  if(want!=null && want!==shown) load(); else applyExtras();
}

/* ---- live link: WebSocket first, a 1 second poll whenever it is not healthy ---- */
function connect(){
  if(!window.WebSocket||ws) return;
  let w; try{ w=new WebSocket((location.protocol==="https:"?"wss://":"ws://")+location.host+"/api/ws"); }catch(e){ return; }
  ws=w;
  w.onopen=()=>{ wsOk=true; wsAt=Date.now(); wsTry=0; if(LP) LP.net(true); };
  w.onmessage=e=>{ wsAt=Date.now(); try{ const m=JSON.parse(e.data); if(m&&m.t==="state") take(m.s); else if(m&&m.t==="poll"){ if(LP) LP.tallies(m.tallies); [A,B].forEach(f=>{ try{ f.contentWindow.postMessage(m,location.origin); }catch(_){} }); } }catch(_){} };
  const gone=()=>{ if(ws!==w) return; wsOk=false; ws=null; try{ w.close(); }catch(_){} setTimeout(connect,Math.min(15000,1000*(++wsTry))); };
  w.onclose=gone; w.onerror=gone;
}
setInterval(()=>{ if(ws&&wsOk){ try{ ws.send("ping"); }catch(_){} } },20000);
const VID=Math.random().toString(36).slice(2,12);
async function poll(){
  const healthy=wsOk && Date.now()-wsAt<35000;
  if(!healthy){
    try{
      const r=await fetch("/api/state?v="+VID,{cache:"no-store",credentials:"same-origin"});
      if(r.status===401||r.status===403){ location.href="/"; return; }
      if(r.ok){ take(await r.json()); if(LP) LP.net(true); }
    }catch(e){ if(LP) LP.net(false); }
  }
  setTimeout(poll,1000);
}
document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible"){ fetch("/api/state?v="+VID,{cache:"no-store",credentials:"same-origin"}).then(r=>r.ok?r.json():null).then(take).catch(()=>{}); } });
paint(); connect(); poll();
})();
