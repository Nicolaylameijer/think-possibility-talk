// Lets plain Node import the Worker's source files: their .json imports become modules (the Worker bundler does this itself).
// import "./lib-load.mjs" before importing anything from src/.
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent(`
export async function load(url, ctx, next) {
  if (url.endsWith(".json")) { const fs = await import("node:fs"); const src = fs.readFileSync(new URL(url), "utf8");
    return { format: "module", source: "export default " + src + ";", shortCircuit: true }; }
  return next(url, ctx);
}`));
