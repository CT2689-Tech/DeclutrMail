import { BRIEF_NAME, CONNECTION_TERM } from '../screen-decisions.js';

import { WS4_COPY } from './ws4.js';

/**
 * PENDING D-SYNCFAILED. The retrying sentence stays in the deck.
 * The sync-failed email is sent only after automatic retries are
 * exhausted or the user must act, so this stays false.
 */
export const SYNC_FAILED_NOTICE_WHILE_RETRYING = false;

type Vars = Record<string, string | number>;

export function connectionTermPlural(term: string = CONNECTION_TERM): string {
  return `${term}s`;
}

export function fillWs4(template: string, vars: Vars = {}): string {
  const withTerms = template
    .replaceAll('{CONNECTION_TERM_PLURAL}', connectionTermPlural())
    .replaceAll('{CONNECTION_TERM}', CONNECTION_TERM)
    .replaceAll('{BRIEF_NAME}', BRIEF_NAME);
  return withTerms.replace(/\{([A-Za-z0-9_]+)\}/g, (match, key: string) => {
    const value = vars[key];
    return value === undefined ? match : String(value);
  });
}

export function pluralWs4(
  forms: { readonly one: string; readonly other: string },
  n: number,
  vars: Vars = {},
): string {
  return fillWs4(n === 1 ? forms.one : forms.other, { n, ...vars });
}

/** Lapse uses "a" in front of the term. Every other footer uses "this". */
export function connectedFooter(article: 'this' | 'a'): string {
  const filled = fillWs4(WS4_COPY.email.footer.connected);
  if (article === 'this') return filled;
  const needle = `this ${CONNECTION_TERM}`;
  const at = filled.lastIndexOf(needle);
  if (at === -1) return filled;
  return `${filled.slice(0, at)}a ${CONNECTION_TERM}${filled.slice(at + needle.length)}`;
}
