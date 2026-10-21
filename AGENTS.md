# Agent guide for the talk repo

This repo is a live conference talk: "Think Possibility, Not Probability", a slide deck plus a phone app for the audience, for public procurement professionals. The presenter, Aran, asks you for changes in plain words. You make them as a pull request. Merging the pull request puts the change on the live deck, so be careful and exact.

## Who you are working with

Aran is the presenter and owns every word of the talk. He is at home in ChatGPT but he is not a developer: he asks in plain words, reads your pull request description, and clicks Merge on GitHub. Never ask him to run a command, edit a file by hand, or sort out a Git problem. Tell him in plain words what changed and what he will see on the deck. The people who built the deck look after its code and hosting. If a request needs a code change, a hosting change or a secret, say so plainly in your reply and leave it for the code owner.

## The rules

1. **Only edit files under `content/`.** Never edit `engine/`, `src/`, `public/`, `tests/`, `.github/` or `wrangler.toml` unless the task clearly asks for a layout or code change. If a request seems to need one, say so and ask first.
2. **Secrets.** Never create, read, print, copy or commit a key, password, token, `.dev.vars` or `.env` file, and never put one in any file. If you see one, stop and tell Aran. The real secrets live in the hosting account, not here.
3. **Plain words.** Slide lines are plain text. No HTML, no markdown, no line breaks inside a line.
4. **Keep lengths close.** A new line should be within about 15 percent of the old one. Slides have fixed space and a longer line spills off. Never make a line more than 50 percent longer.
5. **Smallest change.** Change only what was asked. Do not tidy, reformat, reorder or rename anything else. Keep the file's existing layout and key order.
6. **Never rename or delete ids or keys.** Slide ids, line keys, poll ids and card ids are fixed. Saved edits and the phones depend on them.
7. **Do not invent.** No new facts, figures, quotes or legal citations that Aran did not give you.
8. **Keep examples consistent.** Grants, bid waivers (sole source), RFPs and solicitations, and cooperative contracts are four different things in procurement. Never swap one for another. When Aran changes an example, search all of `content/` for the same example and change those places too, or list them in the pull request.
9. **Match the voice.** Warm, direct, short sentences, no jargon, the way the existing lines read.
10. **Never push to `live`.** `live` is the branch the deck runs from. Open a pull request into `live`. Aran reviews and merges it. Merging into `live` deploys.
11. **Code is for a code owner.** Files under `tests/`, `.github/`, `src/`, `engine/` and `build.mjs` need a code owner's review. Do not change them unless Aran asks for a code change, and when you do, say so in the pull request.
12. **Never weaken the check.** Do not edit `tests/check.mjs` or the check workflow to make a change pass. If the check fails, fix your change.

## Where each thing lives

| Aran says | Edit this |
|---|---|
| a slide title, a line, a card, a button | `content/slides/NN-<id>.json`, one file per slide, found by the slide id (see the list below). The number in the file name is its place in the file list only, not the number Aran says. |
| speaker notes on a slide | the `notes` list in the same slide file |
| the small label above a title (the kicker, like "MOVE 2 OF 4 · RED TEAM") | `kick` in the slide file. The heading is `title`. If a request says "heading" and both could be meant, ask which. |
| the highlighted words in a title | the `em` value in the same slide file. It must be an exact piece of that slide's `title`. |
| a line in the Rehearse conversation, a reply choice | `content/slides/*-move4.json`. A conversation line and its best reply are the same words, change both. |
| make a line bigger or smaller | `sizes` in the slide file, like `"sizes": {"title": 1.1}`: 1 is normal, 0.6 to 1.6 allowed. Add the entry only if the request is about size. |
| hide or show a slide, change the order | `content/plan.json`: `order` lists every slide id once, `hidden` lists the slides that are skipped |
| turn a slide's autoplay on or off | `content/plan.json`, under `autoplay`. Only slides that already have a sequence. |
| keep a hidden slide's card on the phones | `content/plan.json`, `keepPhoneCard`: a list of slide ids. A hidden slide leaves both the screen and the phones. Add its id here only if Aran says the phone should keep it. "Hide the confession slide" means add `confession` to `hidden` and leave `keepPhoneCard` alone. |
| a poll question or its answers, or which slide a poll is asked on | `content/polls.json`. Each poll has an `id`, a `slide` (the slide id it is asked on), a `text` and `options`. Live bars on the screen exist only on the slides built for them: `pulse`, `movecheck`, `pledge`, `close` and the Rehearse slide. Moving a poll to any other slide would change what the phones ask but leave the screen without bars and the old slide without its poll, and the check does not catch that. So a request to move a poll to another slide is a code change: say so and ask Aran. The Rehearse polls come from the Rehearse slide file. |
| the explainer card on the phone | `content/app/cards.json` (title, body, example; 40 words or fewer each) |
| the "Build yours" starter prompt | `content/app/starter.md`. Keep `{{NAME}}` exactly where it is. |
| the take-home guide | `content/app/guide.md`. Keep `{{NAME}}` exactly where it is. |
| the four take-home prompts people take away (P1 to P4) | `content/app/talk-prompts.json` |
| the eight starter prompts on the phone | `content/app/starters.json` |
| the list of AI apps on the phone | `content/app/apps.json` |
| the talk title, speaker line, colours | `content/brand.json` |

The slide ids (the order of the talk and which slides are skipped are in `content/plan.json`, not here):

`cover`, `confession`, `ladder`, `pulse`, `where` (the 2 a.m. slide), `system`, `move4` (Rehearse), `principles` ("Four moves when you return to work"), `move1`, `move2`, `move3`, `movecheck` ("Which move will you try first?"), `guardrails`, `thisweek`, `pledge`, `close`, `walkout`.

Read `plan.json` for the true current state, because this list can go stale. If a request asks for something that is already so (a slide already hidden, a line already worded that way), change nothing and say so in your reply. If Aran's wording already matches one place (for example the label above a title already says "Red team" and he asked for the heading), show him where it already is and ask before you change anything else.

To find a line, search `content/` for a few of its words. The slide number people say is the position in the talk after hidden slides are skipped. The title of the slide is the safest way to find it.

## How to make a change

1. Read the request. If it could mean more than one slide or line, ask one short question first.
2. Search `content/` for the current words. Read the whole slide file before you change it.
3. Make the smallest edit. If you change a title, check its `em` value still fits. If you change a Rehearse line, change its matching best reply.
4. Look for the same example or wording elsewhere and fix those too (rule 8). A move or slide name can appear in the slide title, in `content/app/talk-prompts.json` and in `content/app/cards.json`. Search all of `content/` for the old words before you finish.
5. Run `npm ci` once on a fresh copy of the repo, then `npm run check`. It builds the deck from `content/`, checks every content file (valid JSON, known ids, length and size limits, cards at most 40 words, poll rules) and runs the fast server tests. It takes a few seconds. It must pass.
6. Open one pull request for the request. Title in plain words, like "Slide 7: heading says Red team". In the description, list every line you changed as: slide, where on the slide, old words, new words. Say which slides were touched and that the check passed. Aran reads this to decide, so write it for Aran, not for a programmer.

## When something is not possible

- Pictures, fonts, layout and animation are not content. Say it needs a code change and ask Aran before you touch `engine/`.
- You cannot see or change anything about who signed in or what they answered. That data is not in this repo.
- If a request would break a rule above, say which rule and offer the closest safe change.

## Rolling back

Every change is one pull request. To undo a change, revert that pull request. Reverting also deploys. Never fix a bad change by editing history.
