import { describe, expect, it } from 'vitest';

import {
  AutopilotActionIntentEmittedPayloadSchema,
  AutopilotMatchRecordedPayloadSchema,
  EVENT_SCHEMAS,
  FollowupDismissedPayloadSchema,
  MailboxDeletedPayloadSchema,
  MailboxSyncReadyPayloadSchema,
  TriageDecisionRecomputedPayloadSchema,
  TriageScoreRunCompletedPayloadSchema,
  TriageVerdictAppliedPayloadSchema,
} from './events.js';
import { isEventTopic, TOPICS } from './topics.js';

/**
 * Event-contract tests — every schema parses a happy payload, rejects
 * unknown keys (strict mode), enforces format invariants (UUID,
 * sender_key hex, verdict enums), and the EVENT_SCHEMAS map covers
 * every TOPICS entry.
 *
 * Privacy-side check at the very end: every schema rejects the
 * D7 / D228 PII keys (`subject`, `snippet`, `body`, etc.) by default
 * because `.strict()` rejects unknown keys.
 */

// Real UUIDs — zod 4's `.uuid()` enforces RFC 9562 version + variant
// bits, so the lazy `11111111-...` fixtures from prior zod 3 tests no
// longer parse. `crypto.randomUUID()` produces conformant v4 UUIDs.
import { randomUUID } from 'node:crypto';

const VALID_MAILBOX = randomUUID();
const VALID_WORKSPACE = randomUUID();
const VALID_UNDO = randomUUID();
const VALID_RULE = randomUUID();
const VALID_MATCH = randomUUID();
const VALID_FOLLOWUP = randomUUID();
const VALID_SENDER_KEY = 'a'.repeat(64);

describe('TOPICS', () => {
  it('every topic follows the {feature}.{noun}_{past_participle} convention', () => {
    const PATTERN = /^[a-z]+\.[a-z_]+$/;
    for (const topic of Object.values(TOPICS)) {
      expect(topic, `topic ${topic}`).toMatch(PATTERN);
    }
  });

  it('isEventTopic narrows known topics', () => {
    expect(isEventTopic(TOPICS.TRIAGE_SCORE_RUN_COMPLETED)).toBe(true);
    expect(isEventTopic('triage.score_run_completed')).toBe(true);
  });

  it('isEventTopic rejects unknown values', () => {
    expect(isEventTopic('triage.unknown_event')).toBe(false);
    expect(isEventTopic('')).toBe(false);
    expect(isEventTopic(42)).toBe(false);
    expect(isEventTopic(null)).toBe(false);
    expect(isEventTopic(undefined)).toBe(false);
  });

  it('EVENT_SCHEMAS covers every TOPICS entry (exhaustiveness)', () => {
    const topicValues = Object.values(TOPICS).sort();
    const schemaKeys = Object.keys(EVENT_SCHEMAS).sort();
    expect(schemaKeys).toEqual(topicValues);
  });
});

describe('TriageScoreRunCompletedPayloadSchema', () => {
  it('parses a valid payload', () => {
    const result = TriageScoreRunCompletedPayloadSchema.safeParse({
      mailboxAccountId: VALID_MAILBOX,
      trigger: 'sync_complete',
      producedAtMs: 1700000000000,
      decisionsWritten: 42,
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown keys (strict mode)', () => {
    const result = TriageScoreRunCompletedPayloadSchema.safeParse({
      mailboxAccountId: VALID_MAILBOX,
      trigger: 'sync_complete',
      producedAtMs: 1700000000000,
      decisionsWritten: 42,
      extraKey: 'oops',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid trigger enum value', () => {
    const result = TriageScoreRunCompletedPayloadSchema.safeParse({
      mailboxAccountId: VALID_MAILBOX,
      trigger: 'some_other_trigger',
      producedAtMs: 1700000000000,
      decisionsWritten: 42,
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative producedAtMs', () => {
    const result = TriageScoreRunCompletedPayloadSchema.safeParse({
      mailboxAccountId: VALID_MAILBOX,
      trigger: 'sync_complete',
      producedAtMs: -1,
      decisionsWritten: 42,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-UUID mailbox id', () => {
    const result = TriageScoreRunCompletedPayloadSchema.safeParse({
      mailboxAccountId: 'not-a-uuid',
      trigger: 'sync_complete',
      producedAtMs: 0,
      decisionsWritten: 0,
    });
    expect(result.success).toBe(false);
  });
});

describe('TriageDecisionRecomputedPayloadSchema', () => {
  it('parses a valid payload', () => {
    expect(
      TriageDecisionRecomputedPayloadSchema.safeParse({
        mailboxAccountId: VALID_MAILBOX,
        senderKey: VALID_SENDER_KEY,
        verdict: 'archive',
        confidence: 0.87,
        producedAtMs: 1700000000000,
        generatedBy: 'template',
      }).success,
    ).toBe(true);
  });

  it('rejects non-sha256-hex sender_key', () => {
    const result = TriageDecisionRecomputedPayloadSchema.safeParse({
      mailboxAccountId: VALID_MAILBOX,
      senderKey: 'too short',
      verdict: 'archive',
      confidence: 0.87,
      producedAtMs: 0,
      generatedBy: 'template',
    });
    expect(result.success).toBe(false);
  });

  it('rejects confidence > 1', () => {
    expect(
      TriageDecisionRecomputedPayloadSchema.safeParse({
        mailboxAccountId: VALID_MAILBOX,
        senderKey: VALID_SENDER_KEY,
        verdict: 'archive',
        confidence: 1.5,
        producedAtMs: 0,
        generatedBy: 'template',
      }).success,
    ).toBe(false);
  });

  it('rejects unknown verdict value', () => {
    const result = TriageDecisionRecomputedPayloadSchema.safeParse({
      mailboxAccountId: VALID_MAILBOX,
      senderKey: VALID_SENDER_KEY,
      verdict: 'screen', // D227 — only the K/A/U/L canonical verbs
      confidence: 0.5,
      producedAtMs: 0,
      generatedBy: 'template',
    });
    expect(result.success).toBe(false);
  });
});

describe('TriageVerdictAppliedPayloadSchema', () => {
  it('parses with undoToken non-null', () => {
    expect(
      TriageVerdictAppliedPayloadSchema.safeParse({
        mailboxAccountId: VALID_MAILBOX,
        senderKey: VALID_SENDER_KEY,
        verdict: 'archive',
        source: 'triage',
        undoToken: VALID_UNDO,
        affectedCount: 47,
      }).success,
    ).toBe(true);
  });

  it('parses with undoToken=null (Keep verdict has no undo)', () => {
    expect(
      TriageVerdictAppliedPayloadSchema.safeParse({
        mailboxAccountId: VALID_MAILBOX,
        senderKey: VALID_SENDER_KEY,
        verdict: 'keep',
        source: 'manual',
        undoToken: null,
        affectedCount: 0,
      }).success,
    ).toBe(true);
  });

  it('rejects unknown source value', () => {
    const result = TriageVerdictAppliedPayloadSchema.safeParse({
      mailboxAccountId: VALID_MAILBOX,
      senderKey: VALID_SENDER_KEY,
      verdict: 'archive',
      source: 'inbox', // not one of the 4 activity_source values
      undoToken: VALID_UNDO,
      affectedCount: 1,
    });
    expect(result.success).toBe(false);
  });
});

describe('AutopilotMatchRecordedPayloadSchema', () => {
  it('parses a valid observe-mode match', () => {
    expect(
      AutopilotMatchRecordedPayloadSchema.safeParse({
        mailboxAccountId: VALID_MAILBOX,
        ruleId: VALID_RULE,
        matchId: VALID_MATCH,
        senderKey: VALID_SENDER_KEY,
        modeAtMatch: 'observe',
        confidence: 0.92,
        reason: 'Engine verdict=Archive @0.92 above threshold 0.85',
      }).success,
    ).toBe(true);
  });

  it('caps reason length at 280 chars', () => {
    const longReason = 'x'.repeat(281);
    const result = AutopilotMatchRecordedPayloadSchema.safeParse({
      mailboxAccountId: VALID_MAILBOX,
      ruleId: VALID_RULE,
      matchId: VALID_MATCH,
      senderKey: VALID_SENDER_KEY,
      modeAtMatch: 'observe',
      confidence: 0.92,
      reason: longReason,
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty reason', () => {
    expect(
      AutopilotMatchRecordedPayloadSchema.safeParse({
        mailboxAccountId: VALID_MAILBOX,
        ruleId: VALID_RULE,
        matchId: VALID_MATCH,
        senderKey: VALID_SENDER_KEY,
        modeAtMatch: 'observe',
        confidence: 0.92,
        reason: '',
      }).success,
    ).toBe(false);
  });
});

describe('AutopilotActionIntentEmittedPayloadSchema', () => {
  it('parses a valid intent (action_kind ∈ archive/unsubscribe/later)', () => {
    for (const kind of ['archive', 'unsubscribe', 'later'] as const) {
      const result = AutopilotActionIntentEmittedPayloadSchema.safeParse({
        mailboxAccountId: VALID_MAILBOX,
        ruleId: VALID_RULE,
        matchId: VALID_MATCH,
        senderKey: VALID_SENDER_KEY,
        actionKind: kind,
        undoToken: VALID_UNDO,
      });
      expect(result.success, `kind=${kind}`).toBe(true);
    }
  });

  it('rejects actionKind="keep" — Autopilot never fires Keep', () => {
    const result = AutopilotActionIntentEmittedPayloadSchema.safeParse({
      mailboxAccountId: VALID_MAILBOX,
      ruleId: VALID_RULE,
      matchId: VALID_MATCH,
      senderKey: VALID_SENDER_KEY,
      actionKind: 'keep',
      undoToken: VALID_UNDO,
    });
    expect(result.success).toBe(false);
  });
});

describe('FollowupDismissedPayloadSchema', () => {
  it('parses a valid dismissal', () => {
    expect(
      FollowupDismissedPayloadSchema.safeParse({
        mailboxAccountId: VALID_MAILBOX,
        followupId: VALID_FOLLOWUP,
        providerThreadId: 'gmail-thread-abc',
      }).success,
    ).toBe(true);
  });

  it('rejects empty providerThreadId', () => {
    const result = FollowupDismissedPayloadSchema.safeParse({
      mailboxAccountId: VALID_MAILBOX,
      followupId: VALID_FOLLOWUP,
      providerThreadId: '',
    });
    expect(result.success).toBe(false);
  });
});

describe('MailboxSyncReadyPayloadSchema', () => {
  it('parses a valid sync-ready event', () => {
    expect(
      MailboxSyncReadyPayloadSchema.safeParse({
        mailboxAccountId: VALID_MAILBOX,
        workspaceId: VALID_WORKSPACE,
        readyAt: '2026-05-25T08:00:00Z',
        messageCount: 1234,
      }).success,
    ).toBe(true);
  });

  it('rejects non-ISO readyAt', () => {
    expect(
      MailboxSyncReadyPayloadSchema.safeParse({
        mailboxAccountId: VALID_MAILBOX,
        workspaceId: VALID_WORKSPACE,
        readyAt: 'yesterday',
        messageCount: 0,
      }).success,
    ).toBe(false);
  });
});

describe('MailboxDeletedPayloadSchema', () => {
  it('parses each D232 basis value', () => {
    for (const basis of ['undo-window', 'waiver', 'standard-30d'] as const) {
      expect(
        MailboxDeletedPayloadSchema.safeParse({
          mailboxAccountId: VALID_MAILBOX,
          workspaceId: VALID_WORKSPACE,
          basis,
          deletedAt: '2026-05-25T08:00:00Z',
        }).success,
        `basis=${basis}`,
      ).toBe(true);
    }
  });

  it('rejects unknown basis value', () => {
    expect(
      MailboxDeletedPayloadSchema.safeParse({
        mailboxAccountId: VALID_MAILBOX,
        workspaceId: VALID_WORKSPACE,
        basis: 'admin-override',
        deletedAt: '2026-05-25T08:00:00Z',
      }).success,
    ).toBe(false);
  });
});

describe('D7/D228 privacy — every schema rejects PII keys (strict mode)', () => {
  // The OutboxPublisher's runtime denylist catches these too, but the
  // schema-level rejection is the first gate. Verify each schema's
  // .strict() blocks every PII top-level key.
  const PII_KEYS = ['subject', 'snippet', 'body', 'htmlBody', 'rawMime', 'headers'];
  const HAPPY_PAYLOADS = [
    {
      label: 'TriageScoreRunCompleted',
      schema: TriageScoreRunCompletedPayloadSchema,
      base: {
        mailboxAccountId: VALID_MAILBOX,
        trigger: 'sync_complete' as const,
        producedAtMs: 0,
        decisionsWritten: 0,
      },
    },
    {
      label: 'TriageDecisionRecomputed',
      schema: TriageDecisionRecomputedPayloadSchema,
      base: {
        mailboxAccountId: VALID_MAILBOX,
        senderKey: VALID_SENDER_KEY,
        verdict: 'archive' as const,
        confidence: 0.5,
        producedAtMs: 0,
        generatedBy: 'template' as const,
      },
    },
    {
      label: 'TriageVerdictApplied',
      schema: TriageVerdictAppliedPayloadSchema,
      base: {
        mailboxAccountId: VALID_MAILBOX,
        senderKey: VALID_SENDER_KEY,
        verdict: 'archive' as const,
        source: 'triage' as const,
        undoToken: VALID_UNDO,
        affectedCount: 1,
      },
    },
    {
      label: 'AutopilotMatchRecorded',
      schema: AutopilotMatchRecordedPayloadSchema,
      base: {
        mailboxAccountId: VALID_MAILBOX,
        ruleId: VALID_RULE,
        matchId: VALID_MATCH,
        senderKey: VALID_SENDER_KEY,
        modeAtMatch: 'observe' as const,
        confidence: 0.9,
        reason: 'r',
      },
    },
    {
      label: 'AutopilotActionIntentEmitted',
      schema: AutopilotActionIntentEmittedPayloadSchema,
      base: {
        mailboxAccountId: VALID_MAILBOX,
        ruleId: VALID_RULE,
        matchId: VALID_MATCH,
        senderKey: VALID_SENDER_KEY,
        actionKind: 'archive' as const,
        undoToken: VALID_UNDO,
      },
    },
    {
      label: 'FollowupDismissed',
      schema: FollowupDismissedPayloadSchema,
      base: {
        mailboxAccountId: VALID_MAILBOX,
        followupId: VALID_FOLLOWUP,
        providerThreadId: 'thr-1',
      },
    },
    {
      label: 'MailboxSyncReady',
      schema: MailboxSyncReadyPayloadSchema,
      base: {
        mailboxAccountId: VALID_MAILBOX,
        workspaceId: VALID_WORKSPACE,
        readyAt: '2026-05-25T08:00:00Z',
        messageCount: 0,
      },
    },
    {
      label: 'MailboxDeleted',
      schema: MailboxDeletedPayloadSchema,
      base: {
        mailboxAccountId: VALID_MAILBOX,
        workspaceId: VALID_WORKSPACE,
        basis: 'undo-window' as const,
        deletedAt: '2026-05-25T08:00:00Z',
      },
    },
  ];

  for (const { label, schema, base } of HAPPY_PAYLOADS) {
    for (const pii of PII_KEYS) {
      it(`${label} rejects top-level PII key "${pii}"`, () => {
        const result = schema.safeParse({ ...base, [pii]: 'whatever' });
        expect(result.success).toBe(false);
      });
    }
  }
});
