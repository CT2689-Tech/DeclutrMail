import deck from './deck/ws2.json';

/**
 * WS2 launch copy. The checked-in deck file is the source; this module
 * re-exports it so a string cannot drift from `deck/ws2.json`.
 * Revision: drop2-r6 (2026-10-11). §P.5 glossary YAML was not in that deck.
 */
export const WS2_COPY = deck;
