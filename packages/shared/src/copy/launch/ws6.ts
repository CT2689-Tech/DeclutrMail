import deck from './deck/ws6.json' with { type: 'json' };

/**
 * WS6 copy. The checked-in deck file is the source (drop2-r50).
 * Inventory sentences are what Settings › Privacy & data renders from
 * the Gmail data registry. `audit.retention` and `logo.retention` are
 * in the deck; the settings screen replaces those two rows, so the
 * registry keeps its own sentences.
 */
export const WS6_COPY = deck;
