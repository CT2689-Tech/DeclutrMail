import deck from './deck/ws2.json' with { type: 'json' };

/**
 * WS2 launch copy. The checked-in deck file is the source; this module
 * re-exports it so a string cannot drift from `deck/ws2.json`.
 * Revision: drop2-r15 (issued 2026-10-11T17:01:00-07:00).
 * Nested so existing imports keep compiling. A flat key that is both a
 * string and a parent (`quiet` / `quiet.fields`, `dismiss` /
 * `dismiss.aria`, `scanNow` / `scanNow.busy`) stays a string plus a
 * camelCase sibling. `plainExplain.rule` stays an object whose values
 * match the deck's `key: value` lines.
 * Long `aiConsent` / `aiPrompt` keys stay in the JSON for imports and
 * are listed on `_notShipping` (NOT SHIPPING). The card renders the
 * short title, `intro` or `upgrade.body`, the How we use AI link, and
 * Allow / Not now. Settings renders the two switch labels, their help
 * lines, and `reask` when the stored version asks again.
 * §P.5 glossary YAML was not in this deck.
 */
export const WS2_COPY = deck;
