# The talk: Think Possibility, Not Probability

A slide deck and a phone app for the audience, run on a Cloudflare Worker. The words are in `content/`.
Edit them as in `AGENTS.md`, then run `npm install` and `npm run check`; open a pull request.
`engine/` is the deck and the phone page, `src/` is the Worker. Secrets are set in the hosting account, never here.
The pull request check builds the deck from `content/` and scans for dashes, secrets and blocked names.
Merging into `live` deploys the live deck.
