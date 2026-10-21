// Rules shared by tests/check.mjs and the tests that try them.

// What a secret looks like. The local- values in test scripts are fake on purpose.
// Added in round 2: GitHub tokens (the gh and a letter and underscore kinds, and the long fine-grained kind) and a bare Cloudflare API token (40 characters of letters, digits, _ and -) on a line that mentions cloudflare or CF_.
export const SECRET = /sk-ant-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{16,}|cpy_[A-Za-z0-9]{12,}|AKIA[0-9A-Z]{12,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}|(?:SESSION_SECRET|PRESENTER_PASSWORD|AUDIENCE_CODE|COPY_TOKEN|ANTHROPIC_API_KEY)\s*=\s*(?!local-|\$)\S{4,}|(?:password|passwd|secret|api[_-]?key|token)["']?\s*[:=]\s*["'](?!local-)[A-Za-z0-9_\-+/=]{12,}["']|account[_-]?id["']?\s*[:=]\s*["']?[0-9a-f]{32}|gh[pousr]_[A-Za-z0-9]{20,}|github[_]pat[_][A-Za-z0-9_]{20,}|(?:cloudflare|CF_)[^\n]{0,80}?(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{40}(?![A-Za-z0-9_-])/i;

// Where the phone page's "Get started with an AI app" links may go: https only, and only these hosts (or empty).
export const APP_HOSTS = ["claude.ai", "chatgpt.com", "gemini.google.com", "grok.com", "copilot.microsoft.com", "www.perplexity.ai", "apps.apple.com", "play.google.com"];
export function appLinkProblems(apps) {
  const out = [];
  (Array.isArray(apps) ? apps : []).forEach((a, i) => {
    for (const k of ["site", "ios", "android"]) {
      const v = a && a[k];
      if (v === undefined || v === null || v === "") continue;
      let u = null;
      try { u = typeof v === "string" ? new URL(v) : null; } catch (_) { u = null; }
      const who = "apps.json: " + ((a && a.name) || "entry " + (i + 1)) + " " + k;
      if (!u || u.protocol !== "https:") out.push(who + " must be empty or start with https://");
      else if (!APP_HOSTS.includes(u.hostname) || u.username || u.password || u.port) out.push(who + " goes to " + u.hostname + ", which is not on the list (" + APP_HOSTS.join(", ") + "). Ask Aran.");
    }
  });
  return out;
}
