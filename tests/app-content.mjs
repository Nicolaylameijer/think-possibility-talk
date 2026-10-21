// The phone and take-home texts come from content/app/: the {{NAME}} interpolation, the starter prompt, and the phone page's starters and apps lists.
import "../scripts/lib-load.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { guideMarkdown, starterPrompt, starterMarkdown } = await import("../src/guide.js");
const { appPage } = await import("../src/pages.js");
const results = [];
const check = (id, name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} [${id}] ${name}${detail ? "  (" + detail + ")" : ""}`); };
const json = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));

const g = guideMarkdown("Zed");
check("ac-1", "guide: the name goes in everywhere and no placeholder is left", g.startsWith("# Build your own Zed\n") && !g.includes("{{NAME}}") && g.split("Zed").length - 1 === fs.readFileSync(path.join(ROOT, "content/app/guide.md"), "utf8").split("{{NAME}}").length - 1);
check("ac-2", "guide: a blank name falls back to My Assistant", guideMarkdown("  ").startsWith("# Build your own My Assistant"));
const s = starterPrompt("NAMEMARK");
check("ac-3", "starter prompt: NAMEMARK marks the name for the phone, one line, no placeholder", s.startsWith("You are NAMEMARK,") && !s.includes("{{") && !s.includes("\n"));
check("ac-4", "starter download carries the prompt with the typed name", starterMarkdown("Zed").includes(starterPrompt("Zed")) && starterMarkdown("Zed").startsWith("# Zed: starter prompt"));

const tpl = fs.readFileSync(path.join(ROOT, "engine/app.html"), "utf8");
const page = appPage(tpl, "n0nce", null);
const line = page.split("\n").find((l) => l.startsWith("const D="));
const D = line ? JSON.parse(line.slice(8, line.lastIndexOf(";"))) : null;
check("ac-5", "phone page: the starter prompts and the apps list in content/app are what the page carries", D && JSON.stringify(D.ST) === JSON.stringify(json("content/app/starters.json")) && JSON.stringify(D.APPS) === JSON.stringify(json("content/app/apps.json")));
check("ac-6", "phone page: the template no longer holds its own copy of either list", !/const STARTERS=\[/.test(tpl) && !/const APPS=\[/.test(tpl));
const bad = results.filter((x) => !x).length;
console.log(`${results.length - bad} of ${results.length} passed`);
process.exit(bad ? 1 : 0);
