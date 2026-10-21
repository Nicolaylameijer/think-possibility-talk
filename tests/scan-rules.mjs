// The app link rule and the secret patterns, each tried on made-up text. Fake tokens are built from pieces so this file does not trip the scan itself.
import "../scripts/lib-load.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SECRET, appLinkProblems, APP_HOSTS } from "../scripts/lib-scan.mjs";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const results = [];
const check = (id, name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} [${id}] ${name}${detail ? "  (" + detail + ")" : ""}`); };
const ok1 = { name: "X", by: "b", site: "https://claude.ai", ios: "https://apps.apple.com/us/app/x/id1", android: "" };

// app links
const real = JSON.parse(fs.readFileSync(path.join(ROOT, "content/app/apps.json"), "utf8"));
check("sr-1", "app links: the current apps.json passes", appLinkProblems(real).length === 0, appLinkProblems(real).join("; "));
check("sr-2", "app links: a javascript: link fails", appLinkProblems([{ ...ok1, site: "java" + "script:alert(1)" }]).length === 1);
check("sr-3", "app links: an off-list host fails", appLinkProblems([{ ...ok1, ios: "https://example.org/x" }]).length === 1 && appLinkProblems([{ ...ok1, site: "https://claude.ai.example.org" }]).length === 1);
check("sr-4", "app links: http (not https), data:, a missing scheme and a look-alike host (user@host) all fail", appLinkProblems([{ ...ok1, site: "http://claude.ai" }, { ...ok1, site: "data:text/html,x" }, { ...ok1, site: "claude.ai" }, { ...ok1, site: "https://claude.ai@example.org" }]).length === 4);
check("sr-5", "app links: empty is fine and the host list has the 8 allowed hosts", appLinkProblems([{ ...ok1, ios: "", android: "" }]).length === 0 && APP_HOSTS.length === 8);

// the phone page draws a link only for http(s)
const tpl = fs.readFileSync(path.join(ROOT, "engine/app.html"), "utf8");
const m = tpl.match(/const webOnly=(u=>[^\n]+);/);
const webOnly = m ? eval(m[1]) : null;
check("sr-6", "phone page: webOnly lets https and http through and drops javascript:, data:, empty and missing", !!webOnly && webOnly("https://claude.ai") && webOnly("http://a.b") && !webOnly("java" + "script:alert(1)") && !webOnly("data:text/html,x") && !webOnly("") && !webOnly(undefined));
const ra = tpl.slice(tpl.indexOf("function renderApps"), tpl.indexOf("/* ---------- Polls"));
check("sr-7", "phone page: renderApps wraps all three links (site, iPhone, Google Play) in webOnly", ["site", "ios", "and"].every((v) => ra.includes("webOnly(" + v + ")")) && !/href="\$\{esc\(site\)\}"[^`]*`\)/.test(ra.replace(/\$\{webOnly\(site\)\?`[^`]*`:""\}/, "")));

// secrets
const hit = (s) => SECRET.test(s);
const pad = (n, c = "a") => c.repeat(n).slice(0, n);
check("sr-8", "secrets: GitHub tokens (four short kinds and the long fine-grained kind) are found", ["ghp_", "gho_", "ghu_", "ghs_"].every((p) => hit("token " + p + pad(36, "A1"))) && hit("x github" + "_pat_" + pad(30, "B2") + "_" + pad(20)));
check("sr-9", "secrets: a bare Cloudflare token (40 characters) next to the word cloudflare or CF_ is found", hit("the cloudflare token is " + pad(20, "Ab_") + pad(20, "-9")) && hit("CF_" + "TOKEN: " + pad(40, "x1")) && !hit("cloudflare " + pad(39, "x")) && !hit("just some " + pad(40, "x1") + " here"));
check("sr-10", "secrets: the older patterns still work (sk-ant-, AKIA, KEY=value) and a local- value is allowed", hit("sk-" + "ant-" + pad(20)) && hit("AKIA" + pad(16, "A")) && hit("ANTHROPIC_API" + "_KEY=" + pad(12, "q")) && !hit("PRESENTER_PASSWORD=local-presenter"));
check("sr-11", "secrets: plain sentences and short ids are not flagged", !hit("Cloudflare Workers Builds, previews off, no build secrets") && !hit("ghost_writer is a word") && !hit("github pull request"));
const bad = results.filter((x) => !x).length;
console.log(`${results.length - bad} of ${results.length} passed`);
process.exit(bad ? 1 : 0);
