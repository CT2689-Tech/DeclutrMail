import { describe, expect, it } from 'vitest';

import { getFixSet } from '@/features/inbox-report';

import {
  homeCandidatesFromReport,
  homeV1Mode,
  rankHomeNextSteps,
  type HomeFixCandidate,
} from './home-next-steps';

const unsub: HomeFixCandidate = { kind: 'unsub_archive', senderCount: 4, senderIds: ['a'] };
const largest: HomeFixCandidate = { kind: 'largest', senderCount: 10, senderIds: ['b'] };
const later: HomeFixCandidate = { kind: 'later_due', senderCount: 2, senderIds: ['c'] };
const empty: HomeFixCandidate = { kind: 'unsub_archive', senderCount: 0, senderIds: [] };

describe('rankHomeNextSteps', () => {
  it('orders unsubscribe, then largest, then later, and keeps three', () => {
    expect(
      rankHomeNextSteps([later, largest, unsub, empty], { senderSizeView: true }).map(
        (step) => step.kind,
      ),
    ).toEqual(['unsub_archive', 'largest', 'later_due']);
  });

  it('drops largest when the size view is off', () => {
    expect(
      rankHomeNextSteps([largest, later, unsub], { senderSizeView: false }).map(
        (step) => step.kind,
      ),
    ).toEqual(['unsub_archive', 'later_due']);
  });
});

describe('homeCandidatesFromReport', () => {
  it('returns no step when there is no report', () => {
    expect(homeCandidatesFromReport(null)).toEqual([]);
  });

  it('reads getFixSet(report) and does not invent a later card', () => {
    expect(
      homeCandidatesFromReport({
        fix: { senderKeys: ['s1', 's2'], sendersCount: 2, inboxEmailCount: 9 },
      } as Parameters<typeof getFixSet>[0]),
    ).toEqual([
      {
        kind: 'unsub_archive',
        senderCount: 2,
        emailCount: 9,
        senderIds: ['s1', 's2'],
      },
    ]);
  });
});

describe('homeV1Mode', () => {
  it('maps ready with steps to full and ready without steps to fallback', () => {
    expect(homeV1Mode('ready', 1)).toBe('full');
    expect(homeV1Mode('ready', 0)).toBe('fallback');
    expect(homeV1Mode('empty', 3)).toBe('empty');
    expect(homeV1Mode('sync-failed', 0)).toBe('sync-failed');
  });
});
