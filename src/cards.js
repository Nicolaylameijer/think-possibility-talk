// The explainer card per slide: a title line, two short sentences, one procurement example.
// Forty words in total at most (tests enforce it). Keys are slide ids.
// The cards themselves are content/app/cards.json (built into src/generated/cards.js).
import CARDS_DATA from "./generated/cards.js";
export const CARDS = CARDS_DATA;

export const cardWords = (c) => `${c.title} ${c.body} ${c.example}`.trim().split(/\s+/).length;
