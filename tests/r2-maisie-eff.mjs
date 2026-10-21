// Round 2: Maisie reads a slide with Aran's edits applied (G9), so she never edits blind, and falls back to the shipped
// text when the editor hook is missing or throws. Plain Node, no server: a small loader turns the Worker's JSON imports
// into modules, then the real Maisie class and the real applyCopy run against the built scenes.
//   node tests/r2-maisie-eff.mjs        (run `npm run build` first)
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent(`
export async function load(url, ctx, next) {
  if (url.endsWith(".json")) { const fs = await import("node:fs"); const src = fs.readFileSync(new URL(url), "utf8");
    return { format: "module", source: "export default " + src + ";", shortCircuit: true }; }
  return next(url, ctx);
}`));

const { Maisie } = await import("../src/maisie.js");
const { applyCopy } = await import("../src/copy.js");
const { SCENES } = await import("../src/deckdata.js");

const results = [];
const check = (id, name, ok, detail = "") => { results.push({ id, ok: !!ok }); console.log(`${ok ? "PASS" : "FAIL"} [${id}] ${name}${detail ? "  (" + detail + ")" : ""}`); };

const ov = { "ladder.title": { text: "Edited by Aran for the test" } };
const LI = SCENES.findIndex((s) => s.id === "ladder");
const host = (eff) => ({ env: {}, storage: null, slide: () => LI, reached: () => [0, 1, 2, LI], notify: async () => {}, control: () => {}, eff });
const shipped = SCENES.find((s) => s.id === "ladder").title;

const m = new Maisie(host((s) => applyCopy([s], ov)[0]));
const a = m.scene("ladder", true), cur = m.current();
check("r2-mz-1", "Maisie's get_slide sees Aran's edited title", a && a.scene.title === "Edited by Aran for the test", a && a.scene.title);
check("r2-mz-2", "Maisie's get_current_slide sees the edit on the slide on screen", cur && cur.id === "ladder" && cur.scene.title === "Edited by Aran for the test", cur && cur.id);
check("r2-mz-3", "the shipped scene data is not changed by the edit", SCENES.find((s) => s.id === "ladder").title === shipped);

const broken = new Maisie(host(() => { throw new Error("editor down"); }));
check("r2-mz-4", "an editor that throws falls back to the shipped text", broken.scene("ladder", true).scene.title === shipped);
const none = new Maisie(host(undefined));
check("r2-mz-5", "no editor hook at all gives the shipped text", none.scene("ladder", true).scene.title === shipped);

const bad = results.filter((r) => !r.ok).length;
console.log(`${results.length - bad} of ${results.length} passed`);
process.exit(bad ? 1 : 0);
