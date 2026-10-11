import deck from './deck/ws2.json' with { type: 'json' };

/**
 * WS2 launch copy. The checked-in deck file is the source; this module
 * re-exports it so a string cannot drift from `deck/ws2.json`.
 * Revision: drop2-r8 (2026-10-11), plus the drop2-r11 `liveFix` key
 * `billing.scope`. The rest of this deck is still r8 — the r11 filing
 * was not in the repo, so no other `liveFix` strings are synced here.
 * §P.5 glossary YAML was not in the r8 deck.
 */
export const WS2_COPY = deck;
