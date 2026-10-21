// ---- v4 c: the slide plan. Which slides are shown and in which order.
// Scene indices stay the stable identity everywhere (checklist, reached, polls); the plan only decides
// the walking order and which scenes are skipped. Default: content/plan.json (order and hidden).
// A saved plan is { order: [sceneIds], hidden: [sceneIds] } kept in the Event core.
import { SCENES, sceneId, DEFAULT_ORDER, DEFAULT_HIDDEN_LIST } from "./deckdata.js";

const IDS = SCENES.map((s, i) => sceneId(i));

// Turns a request body into a clean plan, or null for "back to default".
export function cleanPlan(body) {
  if (!body || body.reset === true) return null;
  const seen = new Set();
  const order = (Array.isArray(body.order) ? body.order : []).filter((id) => typeof id === "string" && IDS.includes(id) && !seen.has(id) && seen.add(id));
  const hset = new Set();
  const hidden = (Array.isArray(body.hidden) ? body.hidden : []).filter((id) => typeof id === "string" && IDS.includes(id) && !hset.has(id) && hset.add(id));
  return { order, hidden };
}

// { order: every scene index in walking order, hidden: indices skipped }
export function effective(plan) {
  let order = DEFAULT_ORDER.slice(), hidden = DEFAULT_HIDDEN_LIST.slice();   // both from content/plan.json
  if (plan) {
    const seen = new Set();
    order = [];
    for (const id of plan.order || []) { const i = IDS.indexOf(id); if (i >= 0 && !seen.has(i)) { seen.add(i); order.push(i); } }
    for (let i = 0; i < IDS.length; i++) if (!seen.has(i)) order.push(i);   // scenes added after the plan was saved go last
    hidden = (plan.hidden || []).map((id) => IDS.indexOf(id)).filter((i) => i >= 0);
  }
  return { order, hidden };
}

// The next shown scene from cur in direction d (+1 or -1), or null at the end.
export function neighbour(plan, cur, d) {
  const { order, hidden } = effective(plan), hid = new Set(hidden);
  let p = cur == null ? (d > 0 ? -1 : order.length) : order.indexOf(cur);
  if (p < 0) p = d > 0 ? -1 : order.length;
  for (let k = p + d; k >= 0 && k < order.length; k += d) if (!hid.has(order[k])) return order[k];
  return null;
}
