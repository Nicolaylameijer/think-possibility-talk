// JSON for people: objects and long arrays open out one entry per line, short ones stay on one line.
// Read back with JSON.parse it is exactly the same data.
const WIDTH = 100;
const one = (v) => (Array.isArray(v) ? "[" + v.map(one).join(", ") + "]"
  : v && typeof v === "object" ? "{" + Object.keys(v).map((k) => JSON.stringify(k) + ": " + one(v[k])).join(", ") + "}" : JSON.stringify(v));
export function fmt(v, indent = "") {
  const flat = one(v);
  if (v === null || typeof v !== "object" || flat.length + indent.length <= WIDTH) return flat;
  const next = indent + "  ";
  if (Array.isArray(v)) return "[\n" + v.map((x) => next + fmt(x, next)).join(",\n") + "\n" + indent + "]";
  return "{\n" + Object.keys(v).map((k) => next + JSON.stringify(k) + ": " + fmt(v[k], next)).join(",\n") + "\n" + indent + "}";
}
