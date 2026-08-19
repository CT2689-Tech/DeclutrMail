import { describe, expect, it } from 'vitest';

import {
  PROTECTION_REASON_IDS,
  WEAK_PROTECTION_REASON_IDS,
  isWeakProtectionReason,
  normalizeProtectionReason,
  protectionReasonClause,
  protectionReasonLabel,
} from './protection';

describe('normalizeProtectionReason', () => {
  it('accepts the Triage wire spelling for a user-set Protect', () => {
    // THREE dialects, not two. `TriageReadService` maps `user_defined`
    // to `'manual'` on the wire while the FE union declares
    // `'user-marked'` — so a user-protected row carried a value in
    // neither, and rendering it produced "Protected · it is Protected":
    // a tautology exactly where the exact reason is required
    // (CLAUDE.md §2.6 / D245).
    expect(normalizeProtectionReason('manual')).toBe('user_defined');
  });

  it('accepts both dialects the codebase grew', () => {
    // `sender_policies.protection_reason` is snake_case; Triage and
    // Sender Detail invented kebab aliases and each adapted at their own
    // boundary. Consumers should not have to know which one they hold.
    expect(normalizeProtectionReason('user_defined')).toBe('user_defined');
    expect(normalizeProtectionReason('user-marked')).toBe('user_defined');
    expect(normalizeProtectionReason('gmail_important')).toBe('gmail_important');
    expect(normalizeProtectionReason('gmail-important')).toBe('gmail_important');
    expect(normalizeProtectionReason('replied')).toBe('replied');
    expect(normalizeProtectionReason('starred')).toBe('starred');
  });

  it('returns null for anything unrecognized rather than guessing', () => {
    // The adapter this replaces defaulted unknown values to "the user
    // marked it" — which turns a new enum value into a false statement
    // about the user's own actions, the worst direction to be wrong in.
    expect(normalizeProtectionReason('some_future_reason')).toBeNull();
    expect(normalizeProtectionReason(null)).toBeNull();
    expect(normalizeProtectionReason(undefined)).toBeNull();
    expect(normalizeProtectionReason('')).toBeNull();
  });
});

describe('protectionReasonClause', () => {
  // Derived, not hand-mirrored: a fifth reason added to the source list
  // reaches the distinctness + embeddability assertions automatically.
  const ALL = [...PROTECTION_REASON_IDS];

  it('names the exact evidence for every reason (D245 / CLAUDE.md §2.6)', () => {
    expect(protectionReasonClause('user_defined')).toBe('you marked it Protected');
    expect(protectionReasonClause('replied')).toBe('you wrote to them at least 3 times');
    expect(protectionReasonClause('starred')).toBe('you starred a message');
    expect(protectionReasonClause('gmail_important')).toBe('Gmail marks it important');
  });

  it('says the honest minimum when protection has no recorded reason', () => {
    // Unreachable from the DB (migration 0023's CHECK is protected ⇒
    // reason recorded) but real on the WIRE: adapters admit
    // `isProtected: true, reason: null`, and the normalizer maps any
    // enum value this build doesn't know to null.
    expect(protectionReasonClause(null)).toBe('it is Protected');
  });

  it('stays embeddable mid-sentence', () => {
    for (const reason of [...ALL, null]) {
      const clause = protectionReasonClause(reason);
      // No trailing period: callers append their own, and "…because you
      // starred a message.. Confirming acts on it anyway" is the bug
      // this guards.
      expect(clause.endsWith('.')).toBe(false);
      // Not sentence-cased at the START. Capitals inside are correct
      // and load-bearing — `Gmail` is a proper noun and `Protected` is
      // the product's safety-state name (D245), so both keep their case
      // wherever they sit.
      const first = clause[0]!;
      expect(first === first.toLowerCase() || clause.startsWith('Gmail')).toBe(true);
    }
  });

  it('gives every reason a DISTINCT sentence', () => {
    // Two reasons reading the same would make "show the exact reason"
    // vacuously satisfied.
    const clauses = ALL.map(protectionReasonClause);
    expect(new Set(clauses).size).toBe(ALL.length);
  });
});

describe('protectionReasonLabel', () => {
  it('prefixes the clause for row-level use', () => {
    expect(protectionReasonLabel('starred')).toBe('Protected · you starred a message');
  });
});

describe('isWeakProtectionReason', () => {
  it('treats one-way signals as weak and a reply as strong', () => {
    // The split the D245 protection review is built on: a reply is a
    // two-way relationship, a star or an importance flag marks a
    // message rather than a correspondent.
    expect(isWeakProtectionReason('starred')).toBe(true);
    expect(isWeakProtectionReason('gmail_important')).toBe(true);
    expect(isWeakProtectionReason('replied')).toBe(false);
    // The user's own Protect is neither — nothing to reassure about and
    // nothing to second-guess.
    expect(isWeakProtectionReason('user_defined')).toBe(false);
    expect(isWeakProtectionReason(null)).toBe(false);
  });

  it('agrees with the exported id list', () => {
    for (const id of WEAK_PROTECTION_REASON_IDS) {
      expect(isWeakProtectionReason(id)).toBe(true);
    }
  });
});
