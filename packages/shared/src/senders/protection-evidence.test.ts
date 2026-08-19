import { describe, expect, it } from 'vitest';

import {
  evaluateProtectionEvidence,
  PROTECTION_WROTE_TO_THRESHOLD,
  type ProtectionEvidenceInput,
} from './protection-evidence';

/** A protection that currently holds; each test perturbs one field. */
function base(over: Partial<ProtectionEvidenceInput> = {}): ProtectionEvidenceInput {
  return {
    isProtected: true,
    reason: 'replied',
    wroteToCount: 5,
    receivedCount: 12,
    mailboxHasOutbound: true,
    ...over,
  };
}

describe('evaluateProtectionEvidence', () => {
  // THE BLIND CASE FIRST. A mailbox with no outbound mail indexed can
  // produce no evidence for "you wrote to them", and a `false` here
  // would mark EVERY correspondence shield on that mailbox unsupported
  // in one pass. Starve the input; the answer must be "unknown".
  it('returns null — never false — when the mailbox has no outbound indexed', () => {
    expect(evaluateProtectionEvidence(base({ mailboxHasOutbound: false }))).toBeNull();
    // Even with a zero count, which is the tempting `false`.
    expect(
      evaluateProtectionEvidence(base({ mailboxHasOutbound: false, wroteToCount: 0 })),
    ).toBeNull();
    expect(
      evaluateProtectionEvidence(base({ mailboxHasOutbound: false, receivedCount: 0 })),
    ).toBeNull();
  });

  it('holds on genuine two-way correspondence', () => {
    expect(evaluateProtectionEvidence(base())).toBe(true);
    // Exactly at the threshold, not above it.
    expect(evaluateProtectionEvidence(base({ wroteToCount: PROTECTION_WROTE_TO_THRESHOLD }))).toBe(
      true,
    );
  });

  it('fails when too little was addressed to them', () => {
    expect(
      evaluateProtectionEvidence(base({ wroteToCount: PROTECTION_WROTE_TO_THRESHOLD - 1 })),
    ).toBe(false);
    // The bounce-notifier shape: plenty of inbound, nothing addressed
    // to it. This is the row the whole change exists for — 14 "replies"
    // to a mail-delivery subsystem.
    expect(evaluateProtectionEvidence(base({ wroteToCount: 0, receivedCount: 400 }))).toBe(false);
  });

  it('fails when nothing was ever received from them', () => {
    // Defensive rather than currently reachable: the sender index is
    // built from inbound mail, so every row implies at least one
    // received message — until Gmail deletes it and a rebuild leaves a
    // row keyed on mail we no longer hold.
    expect(evaluateProtectionEvidence(base({ receivedCount: 0 }))).toBe(false);
  });

  it('has nothing to recheck for the other reasons', () => {
    // A star and a Gmail importance flag are re-evaluated from labels we
    // still hold, by the sweep itself; the user's own Protect is not
    // ours to second-guess. None of them may be reported unsupported on
    // a wrote-to count that says nothing about them.
    for (const reason of ['user_defined', 'starred', 'gmail_important'] as const) {
      expect(evaluateProtectionEvidence(base({ reason, wroteToCount: 0, receivedCount: 0 }))).toBe(
        true,
      );
    }
  });

  it('makes no claim about an unprotected sender', () => {
    expect(
      evaluateProtectionEvidence(base({ isProtected: false, reason: null, wroteToCount: 0 })),
    ).toBe(true);
    // Including a manual-unprotect memory pin, which keeps a non-null
    // reason on an unprotected row (D245 sticky override).
    expect(
      evaluateProtectionEvidence(base({ isProtected: false, reason: 'replied', wroteToCount: 0 })),
    ).toBe(true);
  });

  it('never returns false for anything but a checked replied shield', () => {
    // Structural version of the rule above: enumerate the space and
    // assert that `false` is reachable only through one door. A future
    // edit that widened it would otherwise withdraw evidence from
    // reasons this rule cannot speak to.
    const reasons = ['user_defined', 'replied', 'starred', 'gmail_important', null] as const;
    for (const reason of reasons) {
      for (const isProtected of [true, false]) {
        for (const mailboxHasOutbound of [true, false]) {
          for (const wroteToCount of [0, 2, 3, 9]) {
            for (const receivedCount of [0, 1]) {
              const verdict = evaluateProtectionEvidence({
                isProtected,
                reason,
                wroteToCount,
                receivedCount,
                mailboxHasOutbound,
              });
              if (verdict === false) {
                expect(reason).toBe('replied');
                expect(isProtected).toBe(true);
                expect(mailboxHasOutbound).toBe(true);
              }
            }
          }
        }
      }
    }
  });
});
