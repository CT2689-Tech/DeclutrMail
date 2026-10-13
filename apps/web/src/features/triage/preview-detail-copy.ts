import { fillCopy, pluralCopy, WS2_COPY } from '@declutrmail/shared/copy/launch';

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
  const inbox = /([\d,]+) emails? in your inbox/u.exec(line);
  const elsewhere = /([\d,]+) emails? elsewhere in Gmail/u.exec(line);
  if (inbox?.[1] === undefined || elsewhere?.[1] === undefined) {
    return line.replace(/^Where it is now: /u, '').replace(/\.$/u, '');
  }
  const format = (raw: string) => {
    const value = Number(raw.replaceAll(',', ''));
    return Number.isFinite(value) ? value.toLocaleString('en-US') : raw;
  };
  return fillCopy(PREVIEW_DETAILS.whereNow.value, {
    n: format(inbox[1]),
    m: format(elsewhere[1]),
  });
}
