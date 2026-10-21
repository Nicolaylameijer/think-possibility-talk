// Control additions for the remote and the command center: Eyes up, Room, pairing heartbeats and
// the Next round trip probe. Kept out of event.js so the Event object only needs three small hooks.
// Heartbeats and the probe live in memory only (they are re-sent every few seconds); eyesUp and
// roomQ live in the persisted core so a restart does not drop a question that is open on phones.
import { SCENES } from "./deckdata.js";

const REMOTE_FRESH = 20000, SLIDES_FRESH = 12000;
const J = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });

// round 2 polls: the deck sends {id}, the presenter screens send {q}; both name the poll
const pid = (body) => (body && body.q !== undefined ? body.q : body ? body.id : undefined);

function sp(ev) { return ev.sp || (ev.sp = { remoteAt: 0, slidesAt: 0, slidesSlide: null, probe: null }); }

// The first question that belongs to the slide now on screen, or null.
function currentQuestion(ev) {
  const i = ev.core.slide;
  const id = i == null || !SCENES[i] ? null : SCENES[i].id;
  const q = id ? ev.qs().find((x) => (x.slide === id || (Array.isArray(x.liveOn) && x.liveOn.includes(id))) && !x.part && !x.manual) : null;   // ---- v4 a17 q: the edited list; round 2: a part of readiness or a manual (Rehearse) poll never opens by itself
  return q ? q.id : null;
}

// ---- round 2 polls: the one poll the room is answering right now, or null. Aran's open poll wins;
// otherwise the first poll of the slide on screen, unless he closed it. A closed poll takes no answers
// and shows its final bars; closing never deletes an answer.
export function liveQuestion(ev) {
  const c = ev.core, closed = Array.isArray(c.closed) ? c.closed : [];
  if (c.roomQ && ev.qby(c.roomQ)) return c.roomQ;
  const q = currentQuestion(ev);
  return q && !closed.includes(q) ? q : null;
}
export const isClosed = (ev, id) => Array.isArray(ev.core.closed) && ev.core.closed.includes(id);

// round 2 (Flux): when the deck moves to another slide, the poll that was live closes (keeps its bars,
// answers get 409) unless it is live on the new slide too (cover stays open from ladder to pulse).
// An opened poll (roomQ, the Rehearse ones included) closes the same way, and roomQ is cleared.
export function closeOnLeave(ev, id, to) {
  const c = ev.core, q = id ? ev.qby(id) : null;
  if (!q) return;
  if (q.slide === to || (Array.isArray(q.liveOn) && q.liveOn.includes(to))) return;
  c.closed = [...new Set([...(Array.isArray(c.closed) ? c.closed : []), q.id])];
  if (c.roomQ === q.id) c.roomQ = null;
}

// ---- v4 a23 step: true while a slides page has said hello in the last few seconds
export function slidesLive(ev) { return Date.now() - sp(ev).slidesAt < 9000; }

// Extra fields for the state object. Audience sockets get the two display fields only;
// the pairing and probe fields are for the presenter's own screens.
export function setupState(ev, role) {
  const c = ev.core, s = sp(ev), now = Date.now();
  const out = { eyesUp: !!c.eyesUp, roomQ: c.roomQ || null, closed: Array.isArray(c.closed) ? c.closed.slice() : [], liveQ: liveQuestion(ev) };   // round 2 polls
  if (role === "presenter") {
    const following = c.slide == null || s.slidesSlide === c.slide;
    out.paired = { remote: now - s.remoteAt < REMOTE_FRESH, slides: now - s.slidesAt < SLIDES_FRESH, following };
    out.probe = s.probe;
  }
  return out;
}

// Returns a Response for a control name this module owns, or null for any other name.
export async function setupCtl(ev, name, body, by) {
  const c = ev.core, s = sp(ev);
  switch (name) {
    case "eyesup": {
      const on = typeof body.on === "boolean" ? body.on : !c.eyesUp;
      if (!!c.eyesUp !== on) { c.eyesUp = on; await ev.saveCore(); ev.broadcast(by); }
      return J({ ok: true, eyesUp: on });
    }
    case "roomq": {
      let q = c.roomQ || null;
      if (body.q === null) q = null;
      else if (typeof pid(body) === "string") { if (!ev.qby(pid(body))) return J({ error: "question" }, 400); q = pid(body); }
      else q = q ? null : currentQuestion(ev);    // toggle: open this slide's question, or close
      const closed = Array.isArray(c.closed) ? c.closed.slice() : [];
      if (q) { const k = closed.indexOf(q); if (k >= 0) closed.splice(k, 1); }   // round 2 polls: opening a closed poll reopens it
      if ((c.roomQ || null) !== q || JSON.stringify(closed) !== JSON.stringify(c.closed || [])) { c.roomQ = q; c.closed = closed; await ev.saveCore(); ev.broadcast(by); }
      return J({ ok: true, roomQ: q, closed });
    }
    case "pollclose": {   // round 2 polls: stop answers for one poll (default: the live one); phones go back to the slide
      const id = typeof pid(body) === "string" ? pid(body) : liveQuestion(ev);
      if (!id || !ev.qby(id)) return J({ error: "question" }, 400);
      const closed = Array.isArray(c.closed) ? c.closed.slice() : [];
      if (!closed.includes(id)) closed.push(id);
      const changed = !(c.closed || []).includes(id) || c.roomQ === id;
      c.closed = closed; if (c.roomQ === id) c.roomQ = null;
      if (changed) { await ev.saveCore(); ev.broadcast(by); }
      return J({ ok: true, closed, roomQ: c.roomQ || null, liveQ: liveQuestion(ev) });
    }
    case "pollopen": {    // round 2 polls: open one poll on every phone (reopens it if it was closed)
      const id = typeof pid(body) === "string" ? pid(body) : "";
      if (!ev.qby(id)) return J({ error: "question" }, 400);
      const closed = (Array.isArray(c.closed) ? c.closed : []).filter((x) => x !== id);
      const changed = c.roomQ !== id || closed.length !== (c.closed || []).length;
      c.roomQ = id; c.closed = closed;
      if (changed) { await ev.saveCore(); ev.broadcast(by); }
      return J({ ok: true, closed, roomQ: id, liveQ: id });
    }
    case "hello": {
      const k = body.k === "slides" ? "slides" : body.k === "remote" ? "remote" : null;
      if (!k) return J({ error: "k" }, 400);
      const before = setupState(ev, "presenter").paired;
      const now = Date.now();
      if (k === "remote") s.remoteAt = now;
      else { s.slidesAt = now; s.slidesSlide = Number.isInteger(body.slide) ? body.slide : null; }
      const after = setupState(ev, "presenter").paired;
      if (JSON.stringify(before) !== JSON.stringify(after)) ev.broadcast(by, ["presenter"]);
      return J({ ok: true, paired: after });
    }
    case "probe": {
      const id = String(body.id || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 16);
      if (!id) return J({ error: "id" }, 400);
      s.probe = { id, ack: false };
      ev.broadcast(by, ["presenter"]);
      return J({ ok: true });
    }
    case "probeack": {
      const id = String(body.id || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 16);
      if (s.probe && s.probe.id === id && !s.probe.ack) { s.probe = { id, ack: true }; ev.broadcast(by, ["presenter"]); }
      return J({ ok: true });
    }
    default: return null;
  }
}
