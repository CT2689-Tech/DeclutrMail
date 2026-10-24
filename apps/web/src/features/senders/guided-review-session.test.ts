import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearGuidedReviewSession,
  GUIDED_REVIEW_STORAGE_KEY,
  GUIDED_REVIEW_TTL_MS,
  guidedReviewHref,
  newGuidedReviewSession,
  readGuidedReviewSession,
  saveGuidedReviewSession,
} from './guided-review-session';

beforeEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/senders?q=Google&sort=name&direction=asc');
});
function record() {
  return newGuidedReviewSession({
    userId: 'user-1',
    mailboxId: 'mailbox-1',
    scope: 'normalized-scope',
    senderIds: ['pixel', 'photos'],
    selectedIds: ['pixel', 'photos'],
    kind: 'selected',
    index: 1,
  });
}
const context = (token: string) => ({
  token,
  userId: 'user-1',
  mailboxId: 'mailbox-1',
  scope: 'normalized-scope',
});
describe('per-tab guided navigation context', () => {
  it('stores only IDs and navigation context, retaining order/index without persisting sender facts', () => {
    const item = record();
    const withFacts = {
      ...item,
      rows: [{ name: 'Private sender', email: 'private@example.invalid', inboxCount: 12 }],
    };
    expect(saveGuidedReviewSession(withFacts)).toBe(true);
    expect(readGuidedReviewSession(context(item.token))).toEqual(item);
    const raw = sessionStorage.getItem(GUIDED_REVIEW_STORAGE_KEY)!;
    expect(raw).not.toContain('Private sender');
    expect(raw).not.toContain('private@example.invalid');
    expect(raw).not.toContain('inboxCount');
    expect(item.returnHref).toBe(guidedReviewHref('?q=Google&sort=name&direction=asc', item.token));
  });
  it('rejects unrelated tokens, users, mailboxes and normalized scopes', () => {
    const item = record();
    saveGuidedReviewSession(item);
    for (const mismatch of [
      { token: 'unrelated' },
      { userId: 'another-user' },
      { mailboxId: 'another-mailbox' },
      { scope: 'another-scope' },
    ])
      expect(readGuidedReviewSession({ ...context(item.token), ...mismatch })).toBeNull();
  });
  it('rejects expiration, malformed IDs/order/index, duplicate IDs, excess lifetime and external return URLs', () => {
    const item = record();
    saveGuidedReviewSession(item);
    expect(readGuidedReviewSession(context(item.token), item.expiresAt)).toBeNull();
    for (const patch of [
      { senderIds: ['pixel', 'pixel'] },
      { senderIds: ['../foreign'] },
      { selectedIds: ['foreign'] },
      { index: 2 },
      { expiresAt: item.createdAt + GUIDED_REVIEW_TTL_MS + 1 },
      { returnHref: 'https://example.invalid/send' },
    ]) {
      sessionStorage.setItem(GUIDED_REVIEW_STORAGE_KEY, JSON.stringify({ ...item, ...patch }));
      expect(readGuidedReviewSession(context(item.token))).toBeNull();
    }
    sessionStorage.setItem(GUIDED_REVIEW_STORAGE_KEY, '{');
    expect(readGuidedReviewSession(context(item.token))).toBeNull();
  });
  it('does not throw when browser storage is disabled and clears on explicit completion', () => {
    const item = record();
    saveGuidedReviewSession(item);
    clearGuidedReviewSession();
    expect(readGuidedReviewSession(context(item.token))).toBeNull();
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new Error('disabled');
    });
    expect(saveGuidedReviewSession(item)).toBe(false);
  });
});
