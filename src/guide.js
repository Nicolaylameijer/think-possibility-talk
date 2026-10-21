// The "build your own assistant" guide. Produced by the Worker as a Markdown download; the name
// the attendee typed on the page is dropped in everywhere. Nothing here is stored.

import { GUIDE, STARTER } from "./generated/appmd.js";

export function assistantName(raw) {
  const n = String(raw == null ? "" : raw).normalize("NFC").replace(/[^\p{L}\p{N} .'\-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 32);
  return n || "My Assistant";
}
export const slugOf = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32) || "assistant";

export function guideMarkdown(rawName) {
  return GUIDE.split("{{NAME}}").join(assistantName(rawName));   // the text is content/app/guide.md
}

// ---- round 2 kit: the starter prompt. One tap copies it on the phone; /starter.md downloads it with
// the attendee's assistant name in it. Plain words, no names, no confidential data asked for.
export function starterPrompt(rawName) {
  return STARTER.split("{{NAME}}").join(assistantName(rawName));   // the text is content/app/starter.md
}
export function starterMarkdown(rawName) {
  const N = assistantName(rawName);
  return `# ${N}: starter prompt

Paste the text below into ChatGPT, Claude, Copilot or Gemini as your first message. If you set ${N} up as a Project, a custom GPT or a Gem with the guide file, paste it there instead.

\`\`\`text
${starterPrompt(N)}
\`\`\`

## Two questions before you commit

Ask both of the tool on one real decision this week, then ask your team.

* What have we missed?
* What assumptions have we made?

Do not paste anything confidential or personal into an AI tool.
`;
}
