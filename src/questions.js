// round 2 FINAL POLL LIST (lead, Flux approved). Polls are tap to pick only; there is no follow-up prompt after a tap.
//   cover      Today. Answerable from sign up (ladder), live with bars on pulse (liveOn), and the readiness "today" row.
//   movecheck  the four moves, live on movecheck: the take-home pick.
//   rehearse1..3 on move4, derived from move4.talk (rehearsePolls below), opened and closed by the deck.
//   readiness  on pledge: two rows of the same five choices, "Today" (stored as cover) and "In one month" (stored as close).
//   close      the month row of readiness. Kept as its own id so the closing chart and the shift counts keep working,
//              but a part: never live by itself and never listed on a phone. The close slide shows the comparison.
// Cut: thisweek, where, and the whole follow-up thread (cover-work, confession, ladder, system, move1, move2, move3,
// move4 dread, guardrails). No slide other than ladder, pulse, movecheck, move4 and pledge carries a poll.
// A question's slide field says where it is asked; the first non part, non manual poll of a slide is the one the room
// answers live. Plain data, shared by the Worker (validation, tallies) and the phone page (it is injected into /app).
// Options are listed in tally order: counts[i] belongs to options[i].
// The list itself is content/polls.json (built into src/generated/polls.js): edit the words there. The Rehearse polls are not in it.
import POLLS from "./generated/polls.js";

export const QUESTIONS = POLLS;

// Where each poll can be asked: the slides whose layout shows that poll (bars, comparison chart or sign up), taken from the deck engine:
//   cover      ladder (answered from sign up), pulse (live bars), where (Aran asks it there, bars stay on pulse via liveOn)
//   movecheck  movecheck (live bars)           readiness  pledge (two rows, today and in one month)
//   close      close (the month row of readiness, a part)
// Any other slide shows no poll, so a poll moved there would be lost: moving one needs a layout change in engine/. Checked by tests/check.mjs.
export const ASK_SLIDES = { cover: ["ladder", "pulse", "where"], movecheck: ["movecheck"], readiness: ["pledge"], close: ["close"] };
export function pollSlideProblems(list) {
  const out = [];
  for (const q of list) {
    const ok = new Set([...(ASK_SLIDES[q.id] || []), ...(Array.isArray(q.liveOn) ? q.liveOn : [])]);
    if (!ok.has(q.slide)) out.push(`polls.json: ${q.id} cannot be asked on ${q.slide}, that slide shows no poll. Ask Aran; this needs a layout change.`);
  }
  return out;
}

// round 2 Rehearse (lead contract): three presenter paced polls on slide move4, DERIVED from the move4 scene, never copied.
// Each talk entry with a pick becomes rehearseN (talk order); its options are pick.options[].line in file order. They are
// "manual": live only when the deck opens them (POST /api/ctl/pollopen {id}), never by being on the slide.
// src/qedit.js adds them to the list (ALL); call it with an edited move4 scene to get the edited buttons (the editor's override, when it exists).
export function rehearsePolls(scene) {
  const talk = scene && Array.isArray(scene.talk) ? scene.talk : [];
  return talk.filter((t) => t && t.pick && Array.isArray(t.pick.options) && t.pick.options.length >= 2).slice(0, 3).map((t, k) => ({
    id: "rehearse" + (k + 1), slide: "move4", n: "R" + (k + 1), type: "choice", manual: true,
    text: String(t.pick.prompt || "Your reply?"), options: t.pick.options.map((o, j) => String((o && o.line) || "") || "Reply " + (j + 1)), follow: null }));   // a blanked reply keeps a button on the phone, by its number
  // no verdict, coach note or director reply rides along: this list reaches every phone, and the verdicts would give the answer away
}

export const QBY = Object.fromEntries(QUESTIONS.map((q) => [q.id, q]));
export const MAX_OPTIONS = Math.max(...QUESTIONS.map((q) => q.options.length));
