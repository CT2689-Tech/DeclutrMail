import { z } from 'zod';

/**
 * The confirm page's view of a stored preview (ADR-0048 rule 1,
 * docs/spec/mcp-connector.md §3) — `GET /api/action-previews/:id` and
 * `POST /api/action-previews/:id/confirm`.
 *
 * An assistant asked for a cleanup; this is what the person is shown and
 * what pressing the verb did. Sender names and counts only: no subject,
 * no snippet.
 */
export const ACTION_PREVIEW_VERBS = ['keep', 'archive', 'unsubscribe', 'later', 'delete'] as const;
export const ActionPreviewVerbSchema = z.enum(ACTION_PREVIEW_VERBS);
export type ActionPreviewVerb = z.infer<typeof ActionPreviewVerbSchema>;

/** Why a sender in a confirmed preview was not acted on. */
export const ACTION_PREVIEW_SKIP_REASONS = [
  'protected',
  'not_found',
  'in_progress',
  'mailto',
  'no_channel',
  'unknown',
  'failed',
] as const;
export const ActionPreviewSkipReasonSchema = z.enum(ACTION_PREVIEW_SKIP_REASONS);
export type ActionPreviewSkipReason = z.infer<typeof ActionPreviewSkipReasonSchema>;

export const ActionPreviewSkippedSchema = z.object({
  senderId: z.string(),
  /** Null when the sender is no longer in the mailbox's index. */
  name: z.string().nullable(),
  reason: ActionPreviewSkipReasonSchema,
  /** `mailto` only: a Gmail compose link the person sends themself. */
  composeUrl: z.string().nullable(),
  /**
   * Unsubscribe with Archive or Delete: the sender was not unsubscribed,
   * but their existing email was still moved.
   */
  emailMoved: z.boolean().optional(),
});
export type ActionPreviewSkipped = z.infer<typeof ActionPreviewSkippedSchema>;

export const ActionPreviewOutcomeSchema = z.object({
  /** Senders the verb was applied to. */
  appliedSenders: z.number().int(),
  /** Emails the started action was asked to move. */
  requestedEmails: z.number().int(),
  /**
   * The started action right now. `failed` means it did not run; null
   * when the verb started none (Keep, a mailto unsubscribe).
   */
  actionStatus: z.enum(['queued', 'executing', 'done', 'failed']).nullable(),
  skipped: z.array(ActionPreviewSkippedSchema),
});
export type ActionPreviewOutcome = z.infer<typeof ActionPreviewOutcomeSchema>;

/** What Unsubscribe may do with the senders' existing email in the same confirmation. */
export const ActionPreviewAlsoVerbSchema = z.enum(['archive', 'delete']);
export type ActionPreviewAlsoVerb = z.infer<typeof ActionPreviewAlsoVerbSchema>;

export const ActionPreviewViewSchema = z.object({
  id: z.string(),
  verb: ActionPreviewVerbSchema,
  /**
   * Unsubscribe only: also Archive or Delete the email these senders
   * already sent, in the same confirmation. Optional on the wire, so a
   * page served ahead of its API reads a missing value as "no".
   */
  alsoVerb: ActionPreviewAlsoVerbSchema.nullable().optional(),
  /**
   * `pending` — waiting for the person. `confirmed` — they pressed the
   * verb but the action did not start; pressing again retries.
   * `applied` — done; `outcome` says what happened. `expired` — the 15
   * minutes ran out first.
   */
  state: z.enum(['pending', 'confirmed', 'applied', 'expired']),
  /** The connected app that asked; null when it registered without a name. */
  appName: z.string().nullable(),
  mailboxEmail: z.string(),
  senderCount: z.number().int(),
  emailCount: z.number().int(),
  /**
   * Every sender in the request, by name, A–Z (up to 1,000). The page
   * shows the first few and lets the person open the whole list: this is
   * where they see exactly what they are confirming.
   */
  senderNames: z.array(z.string()),
  olderThanDays: z.number().int().nullable(),
  /** Later only: when the email returns to the inbox. */
  wakeAt: z.string().nullable(),
  expiresAt: z.string(),
  /**
   * When the person pressed the verb; null until they do. An `expired`
   * request with this set was confirmed but never recorded as started,
   * so the page must not say that nothing happened.
   */
  confirmedAt: z.string().nullable(),
  outcome: ActionPreviewOutcomeSchema.nullable(),
});
export type ActionPreviewView = z.infer<typeof ActionPreviewViewSchema>;
