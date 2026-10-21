// A poll can only be asked on a slide that shows it. Moving movecheck to "principles" would lose its poll; the check says so in plain words.
import "../scripts/lib-load.mjs";
const { QUESTIONS, pollSlideProblems } = await import("../src/questions.js");
const results = [];
const check = (id, name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} [${id}] ${name}${detail ? "  (" + detail + ")" : ""}`); };
const move = (id, slide) => QUESTIONS.map((q) => (q.id === id ? { ...q, slide } : q));

check("ps-1", "the polls in content/polls.json are all on slides that show them", pollSlideProblems(QUESTIONS).length === 0, pollSlideProblems(QUESTIONS).join(" "));
const p = pollSlideProblems(move("movecheck", "principles"));
check("ps-2", "movecheck moved to principles is refused in plain words", p.length === 1 && p[0] === "polls.json: movecheck cannot be asked on principles, that slide shows no poll. Ask Aran; this needs a layout change.", p.join(" "));
check("ps-3", "cover asked on the 2 a.m. slide (where Aran asks it) or on ladder or pulse is fine", ["where", "ladder", "pulse"].every((s) => pollSlideProblems(move("cover", s)).length === 0));
check("ps-4", "cover moved to principles is refused", pollSlideProblems(move("cover", "principles")).length === 1);
check("ps-5", "a slide in the poll's liveOn is fine", pollSlideProblems(QUESTIONS.map((q) => (q.id === "movecheck" ? { ...q, slide: "guardrails", liveOn: ["guardrails"] } : q))).length === 0);
const bad = results.filter((x) => !x).length;
console.log(`${results.length - bad} of ${results.length} passed`);
process.exit(bad ? 1 : 0);
