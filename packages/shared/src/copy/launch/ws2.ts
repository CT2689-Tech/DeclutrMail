import deck from './deck/ws2.json' with { type: 'json' };

/**
 * WS2 launch copy. The checked-in deck file is the source; this module
 * re-exports it so a string cannot drift from `deck/ws2.json`.
 * Revision: drop2-r18 (issued 2026-10-11T21:04:00-07:00).
 * `home.failed` is drop2-r23.
 * drop2-r20 marks the inline `aiPrompt` question NOT SHIPPING. The short
 * consent card is the nudge; its Allow / Not now strings are unchanged.
 * Nested so existing imports keep compiling. A flat key that is both a
 * string and a parent (`quiet` / `quiet.fields`, `dismiss` /
 * `dismiss.aria`, `scanNow` / `scanNow.busy`) stays a string plus a
 * camelCase sibling. `plainExplain.rule` stays an object whose values
 * match the deck's `key: value` lines.
 * Long `aiConsent` / `aiPrompt` keys stay in the JSON for imports and
 * are listed on `_notShipping` (NOT SHIPPING). The card renders the
 * short title, `intro` or `upgrade.body`, the How we use AI link, and
 * Allow / Not now. Settings renders the group title, the two switch
 * labels, their help lines, and `reask` when the stored version asks again.
 * §P.5 glossary YAML was not in this deck.
 * drop2-r27 adds `simplify.billing.meterRule` and
 * `simplify.confirm.meterLabel`.
 * drop2-r28 adds `simplify.activity.bundleIncludes` and
 * `simplify.deleteAccount.paymentPending`.
 * drop2-r29 adds `simplify.privacy.keptLimited`,
 * `simplify.privacy.logoCache`, and `simplify.privacy.auditRecords`.
 * The same revision’s reviewed, load-error, Later-slow, and reset lines
 * live under `simplify.onboarding`, `simplify.later`, and
 * `simplify.billing.resetLine`. `liveFix.billing.limit.free` is the
 * email-count sentence.
 */
export const WS2_COPY = deck;
