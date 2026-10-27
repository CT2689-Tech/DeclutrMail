import { GUIDED_REVIEW_STORAGE_KEY } from './guided-review-storage';
export { GUIDED_REVIEW_STORAGE_KEY, clearGuidedReviewSession } from './guided-review-storage';

/** Per-tab navigation context only. Sender facts and action eligibility are always re-read. */
export const GUIDED_REVIEW_PARAM = 'review';
export const GUIDED_REVIEW_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_SENDERS = 10_000;
const identifier = /^[a-zA-Z0-9_-]{1,128}$/;
const scopeParams = [
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
  'sender',
];

export interface StoredGuidedReviewSession {
  version: 1;
  token: string;
  userId: string;
  mailboxId: string;
  scope: string;
  senderIds: string[];
  selectedIds: string[];
  kind: 'selected' | 'filtered' | 'loaded';
  index: number;
  createdAt: number;
  expiresAt: number;
  returnHref: string;
}

export function guidedReviewHref(search: string, token: string): string {
  const source = new URLSearchParams(search);
  const out = new URLSearchParams();
  for (const key of scopeParams) {
    const value = source.get(key);
    if (value !== null) out.set(key, value);
  }
  out.set('view', 'guided');
  out.set(GUIDED_REVIEW_PARAM, token);
  return `/senders?${out.toString()}`;
}

function validRecord(value: unknown, now: number): value is StoredGuidedReviewSession {
  if (value === null || typeof value !== 'object') return false;
  const item = value as Partial<StoredGuidedReviewSession>;
  if (
    item.version !== 1 ||
    typeof item.token !== 'string' ||
    !identifier.test(item.token) ||
    typeof item.userId !== 'string' ||
    !identifier.test(item.userId) ||
    typeof item.mailboxId !== 'string' ||
    !identifier.test(item.mailboxId) ||
    typeof item.scope !== 'string' ||
    item.scope.length > 8192 ||
    !['selected', 'filtered', 'loaded'].includes(item.kind ?? '')
  )
    return false;
  if (
    !Array.isArray(item.senderIds) ||
    item.senderIds.length === 0 ||
    item.senderIds.length > MAX_SENDERS ||
    !item.senderIds.every((id) => typeof id === 'string' && identifier.test(id))
  )
    return false;
  const ids = new Set(item.senderIds);
  if (
    ids.size !== item.senderIds.length ||
    !Array.isArray(item.selectedIds) ||
    !item.selectedIds.every((id) => typeof id === 'string' && ids.has(id)) ||
    new Set(item.selectedIds).size !== item.selectedIds.length
  )
    return false;
  if (
    !Number.isInteger(item.index) ||
    item.index! < 0 ||
    item.index! >= item.senderIds.length ||
    typeof item.createdAt !== 'number' ||
    typeof item.expiresAt !== 'number' ||
    !Number.isFinite(item.createdAt) ||
    item.createdAt > now ||
    item.expiresAt !== item.createdAt + GUIDED_REVIEW_TTL_MS ||
    item.expiresAt <= now
  )
    return false;
  if (
    typeof item.returnHref !== 'string' ||
    item.returnHref.length > 8192 ||
    !item.returnHref.startsWith('/senders?')
  )
    return false;
  return (
    item.returnHref === guidedReviewHref(item.returnHref.slice('/senders?'.length), item.token)
  );
}

export function saveGuidedReviewSession(session: StoredGuidedReviewSession): boolean {
  if (typeof window === 'undefined' || !validRecord(session, Date.now())) return false;
  try {
    const {
      version,
      token,
      userId,
      mailboxId,
      scope,
      senderIds,
      selectedIds,
      kind,
      index,
      createdAt,
      expiresAt,
      returnHref,
    } = session;
    window.sessionStorage.setItem(
      GUIDED_REVIEW_STORAGE_KEY,
      JSON.stringify({
        version,
        token,
        userId,
        mailboxId,
        scope,
        senderIds,
        selectedIds,
        kind,
        index,
        createdAt,
        expiresAt,
        returnHref,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

export function readGuidedReviewSession(
  context: { token: string; userId: string; mailboxId: string; scope?: string },
  now = Date.now(),
): StoredGuidedReviewSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(GUIDED_REVIEW_STORAGE_KEY);
    if (raw === null || raw.length > 2_000_000) return null;
    const value: unknown = JSON.parse(raw);
    if (
      !validRecord(value, now) ||
      value.token !== context.token ||
      value.userId !== context.userId ||
      value.mailboxId !== context.mailboxId ||
      (context.scope !== undefined && value.scope !== context.scope)
    )
      return null;
    return value;
  } catch {
    return null;
  }
}

export function newGuidedReviewSession(
  input: Omit<
    StoredGuidedReviewSession,
    'version' | 'token' | 'createdAt' | 'expiresAt' | 'returnHref'
  >,
): StoredGuidedReviewSession {
  const token = window.crypto.randomUUID();
  const createdAt = Date.now();
  return {
    ...input,
    version: 1,
    token,
    createdAt,
    expiresAt: createdAt + GUIDED_REVIEW_TTL_MS,
    returnHref: guidedReviewHref(window.location.search, token),
  };
}

/** Keep other query/filter state intact; this parameter identifies only a local review. */
export function writeGuidedReviewToken(token: string | null): void {
  const params = new URLSearchParams(window.location.search);
  if (token === null) params.delete(GUIDED_REVIEW_PARAM);
  else params.set(GUIDED_REVIEW_PARAM, token);
  const search = params.toString();
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`,
  );
}
