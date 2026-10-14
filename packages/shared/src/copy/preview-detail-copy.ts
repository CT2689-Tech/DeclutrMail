import { fillCopy, pluralCopy, WS2_COPY } from './launch';

// D199 consumers: Senders, Triage (modal and inline), Screener,
// Brief Noise, and Autopilot rule approval. Existing preview stories
// exercise these rows; this module owns wording/formatting only.

/** Content deck r44 labels and values for in-app preview Details rows. */
export const PREVIEW_DETAILS = WS2_COPY.preview.details;

/**
 * Includes row: scope, the age window when one is set, then the recheck.
 * The window uses the deck's plural pair (`1 day` / `{n} days`).
 */
export function previewIncludesValue(allMail: boolean, olderThanDays: number | null): string {
  const scope = allMail ? PREVIEW_DETAILS.includes.all : PREVIEW_DETAILS.includes.inbox;
  const window =
    olderThanDays === null ? '' : ` ${pluralCopy(PREVIEW_DETAILS.includes.window, olderThanDays)}`;
  return `${scope}${window}. ${PREVIEW_DETAILS.includes.recheck}`;
}

/**
 * Details value for `mailLocationCopy`'s sentence.
 * `{n}` and `{m}` are the inbox and elsewhere counts, with thousands separators.
 * The deck value names those two places and leaves Trash and Spam out of this row.
 */
export function previewWhereNowFromSentence(line: string): string {
  const inbox = countBeforeLocation(line, ' in your inbox');
  const elsewhere = countBeforeLocation(line, ' elsewhere in Gmail');
  if (inbox === null || elsewhere === null) {
    return line.replace(/^Where it is now: /u, '').replace(/\.$/u, '');
  }
  const format = (raw: string) => {
    const value = Number(raw.replaceAll(',', ''));
    return Number.isFinite(value) ? value.toLocaleString('en-US') : raw;
  };
  return fillCopy(PREVIEW_DETAILS.whereNow.value, {
    n: format(inbox),
    m: format(elsewhere),
  });
}

/** Neutral failure for any mail-moving preview, including Later. */
export const PREVIEW_UNAVAILABLE_MESSAGE =
  'Couldn’t load the preview. Nothing can move until it loads.';

/** Read the immediately preceding count without an unbounded pattern search. */
function countBeforeLocation(line: string, location: string): string | null {
  const end = line.indexOf(location);
  if (end === -1) return null;
  const prefix = line.slice(0, end);
  const nounStart = prefix.lastIndexOf(' ');
  const noun = prefix.slice(nounStart + 1);
  if (noun !== 'email' && noun !== 'emails') return null;
  const beforeNoun = prefix.slice(0, nounStart);
  const count = beforeNoun.slice(beforeNoun.lastIndexOf(' ') + 1);
  let hasDigit = false;
  for (const char of count) {
    if (char === ',') continue;
    if (char < '0' || char > '9') return null;
    hasDigit = true;
  }
  return hasDigit ? count : null;
}
