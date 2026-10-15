import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { makeSender } from '../testing/make-sender';
import { canPerformSenderAction } from '../data';
import { sendersKeys } from './query-keys';
import { currentListActionSender } from './current-action-sender';

const subject = makeSender({ id: 'test', inboxCount: 21, archivedCount: 0 });
const empty = { ...subject, inboxCount: 0, archivedCount: 0 };
const key = sendersKeys.list({ q: 'active' });
const list = (row: typeof subject) => ({ pages: [{ data: [row] }] });

describe('current list action scope', () => {
  it.each(['Archive', 'Later', 'Delete'] as const)(
    '%s blocks an immediate canonical zero read',
    (verb) => {
      const qc = new QueryClient();
      qc.setQueryData(key, list(subject), { updatedAt: 10 });
      qc.setQueryData(sendersKeys.detail(subject.id), { data: empty }, { updatedAt: 11 });
      expect(canPerformSenderAction(verb, currentListActionSender(qc, key, subject, verb)!)).toBe(
        false,
      );
    },
  );
  it.each(['Archive', 'Later', 'Delete'] as const)(
    '%s recovers after newer positive readback over old zero',
    (verb) => {
      const qc = new QueryClient();
      qc.setQueryData(key, list(subject), { updatedAt: 20 });
      qc.setQueryData(sendersKeys.detail(subject.id), { data: empty }, { updatedAt: 10 });
      expect(canPerformSenderAction(verb, currentListActionSender(qc, key, subject, verb)!)).toBe(
        true,
      );
    },
  );
  it.each(['Archive', 'Later', 'Delete'] as const)(
    '%s treats a tied zero detail conservatively',
    (verb) => {
      const qc = new QueryClient();
      qc.setQueryData(key, list(subject), { updatedAt: 10 });
      qc.setQueryData(sendersKeys.detail(subject.id), { data: empty }, { updatedAt: 10 });
      expect(canPerformSenderAction(verb, currentListActionSender(qc, key, subject, verb)!)).toBe(
        false,
      );
    },
  );
  it('uses completion detail for a vanished row; ignores invalidated detail', async () => {
    const qc = new QueryClient();
    const detailKey = [...sendersKeys.detail(subject.id), 'cleanup', 123];
    qc.setQueryData(key, { pages: [{ data: [] }] });
    qc.setQueryData(detailKey, { data: empty });
    expect(currentListActionSender(qc, key, subject, 'Delete')?.inboxCount).toBe(0);
    await qc.invalidateQueries({ queryKey: detailKey, exact: true, refetchType: 'none' });
    expect(currentListActionSender(qc, key, subject, 'Delete')).toBeNull();
  });
  it('does not fall back to a different list or a frozen confirmation', () => {
    const qc = new QueryClient();
    qc.setQueryData(sendersKeys.list({ q: 'other' }), list(subject));
    expect(currentListActionSender(qc, key, subject, 'Delete')).toBeNull();
  });
});
