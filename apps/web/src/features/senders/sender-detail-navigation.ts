/** Navigation scope only; never restore sender facts, action state, or an open pane. */
const scopeKeys = new Set([
  'activity',
  'unsub_ready',
  'wrote-to',
  'protected',
  'window',
  'domain',
  'unsub_ignored',
  'has_inbox_mail',
  'mostly_unread',
  'q',
  'sort',
  'direction',
]);

export const SENDER_RETURN_PARAM = 'returnTo';

export function sendersReturnHref(search: string): string {
  const out = new URLSearchParams();
  for (const [key, value] of new URLSearchParams(search)) {
    if (scopeKeys.has(key) || (key === 'view' && value === 'first-review')) out.set(key, value);
  }
  const query = out.toString();
  return `/senders${query ? `?${query}` : ''}`;
}

/** Only accept the same canonical workspace scope that our own links produce. */
export function readSendersReturnHref(value: string | null | undefined): string | null {
  if (value === '/senders') return value;
  if (!value?.startsWith('/senders?') || value.length > 8192) return null;
  return sendersReturnHref(value.slice('/senders?'.length)) === value ? value : null;
}

export function senderDetailHref(senderId: string, search: string): string {
  const returnHref = sendersReturnHref(search);
  const params = new URLSearchParams({ from: 'senders_table' });
  if (returnHref !== '/senders') params.set(SENDER_RETURN_PARAM, returnHref);
  return `/senders/${encodeURIComponent(senderId)}?${params}`;
}
