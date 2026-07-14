import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';

import { activityLog, senderPolicies, senders } from '@declutrmail/db';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import type { SenderPolicyPatch, SenderPolicyResult } from './senders.types.js';

/**
 * SendersPolicyService — the standing-policy WRITE surface for the
 * Senders feature (D40, D42, D43).
 *
 * Owns the `sender_policies` writes for the two user-facing policy
 * mutations:
 *
 *   - **Keep** (D40) — `policy_type='keep'`; applies immediately, no
 *     Gmail mutation, no preview (ADR-0015: `keep` is `policy-only`
 *     with `buildPolicyWrite() → { policyType: 'keep' }`).
 *   - **Protect toggle** (D42/D43) — `is_protected` set-state with
 *     `protection_reason='user_defined'` provenance (D22) on protect
 *     and the user-agency-wins memory pin on unprotect (the prior
 *     `protection_reason` is preserved so the sync workers' re-protect
 *     guard respects the demote — see schema/sender-policies.ts).
 *
 * D204 boundary: `sender_policies` is OWNED by the senders feature, so
 * the upsert lives here — no outbox indirection needed (the writer is
 * the owner; contrast the actions feature's unsubscribe-intent path,
 * which publishes an event for the senders-owned consumer instead).
 *
 * Audit (D43): every actual state change appends `activity_log` rows —
 * `keep` for the standing verdict and `marked_protected` /
 * `unmarked_protected` for the safety state — in the
 * SAME transaction as the policy upsert. `affected_count` is always 0
 * (a standing-policy flip moves no mail) and `undo_token` is null
 * (nothing destructive to reverse; the toggle itself is the undo).
 *
 * Idempotency: the patch carries explicit TARGET states, so the write
 * is a state diff — a field already at its target is skipped (no
 * policy write, no audit row). A network-retried PATCH therefore
 * dedups naturally without the Idempotency-Key machinery the enqueue
 * routes need. Two CONCURRENT conflicting patches are last-write-wins
 * with both audit rows kept — same accepted race cost as the
 * unsubscribe-intent path.
 *
 * Ownership: the sender resolve is scoped to the current mailbox; a
 * forged / cross-mailbox id 404s before any write.
 *
 * Privacy (D7, D228): only the sha256 sender_key + policy flags are
 * read/written. No message content anywhere on this path.
 */
@Injectable()
export class SendersPolicyService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async setPolicy(input: {
    mailboxAccountId: string;
    senderId: string;
    patch: SenderPolicyPatch;
  }): Promise<SenderPolicyResult> {
    const { mailboxAccountId, senderId, patch } = input;

    const [sender] = await this.db
      .select({ senderKey: senders.senderKey })
      .from(senders)
      .where(and(eq(senders.id, senderId), eq(senders.mailboxAccountId, mailboxAccountId)))
      .limit(1);
    if (!sender) {
      throw new NotFoundException({
        code: 'SENDER_NOT_FOUND',
        message: 'Sender not found in the current mailbox.',
      });
    }
    const senderKey = sender.senderKey;

    return await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(senderPolicies)
        .where(
          and(
            eq(senderPolicies.mailboxAccountId, mailboxAccountId),
            eq(senderPolicies.senderKey, senderKey),
          ),
        )
        .limit(1);

      // State diff — a field already at its target is NOT a change.
      // `policyType` on a missing row reads as null (engine-default),
      // so the first Keep on a fresh sender IS a change.
      const keepChange =
        patch.policyType !== undefined && existing?.policyType !== patch.policyType;
      const protectChange =
        patch.isProtected !== undefined && patch.isProtected !== (existing?.isProtected ?? false);

      if (!keepChange && !protectChange) {
        // Idempotent no-op: nothing written, no audit row, and — when
        // the sender has no policy row — none created (a no-op must not
        // promote an engine-default sender to `policy_type='keep'`).
        return projectResult(senderId, existing ?? null, false);
      }

      // Upsert with ONLY the changed fields in the conflict SET so a
      // Protect can never clobber a concurrent standing-verdict write.
      const [row] = await tx
        .insert(senderPolicies)
        .values({
          mailboxAccountId,
          senderKey,
          // Fresh row: unspecified fields take their column defaults
          // (policy_type='keep' is the schema default for any policy
          // row; protection defaults false).
          ...(patch.policyType !== undefined ? { policyType: patch.policyType } : {}),
          ...(patch.isProtected !== undefined ? { isProtected: patch.isProtected } : {}),
          ...(patch.isProtected === true
            ? { protectionReason: 'user_defined' as const, protectionSetAt: sql`now()` }
            : {}),
        })
        .onConflictDoUpdate({
          target: [senderPolicies.mailboxAccountId, senderPolicies.senderKey],
          set: {
            ...(keepChange ? { policyType: patch.policyType } : {}),
            ...(protectChange
              ? patch.isProtected === true
                ? {
                    isProtected: true,
                    // Explicit user toggle → 'user_defined' provenance
                    // (D22). Overwrites a stale engagement-pin reason:
                    // the user re-protecting IS a fresh user decision.
                    protectionReason: 'user_defined' as const,
                    protectionSetAt: sql`now()`,
                  }
                : {
                    isProtected: false,
                    // Memory pin (schema/sender-policies.ts): the prior
                    // protection_reason is deliberately LEFT in place so
                    // the sync workers' re-protect guard sees the demote.
                    protectionSetAt: null,
                  }
              : {}),
            updatedAt: sql`now()`,
          },
        })
        .returning();
      if (!row) {
        // `.returning()` on an upsert always yields the row; guard for
        // the type system + a driver regression.
        throw new Error('sender_policies upsert returned no row');
      }

      // D43 audit rows — one per actual change, same tx as the upsert.
      const auditValues: Array<typeof activityLog.$inferInsert> = [];
      const base = {
        mailboxAccountId,
        senderKey,
        source: 'manual' as const,
        affectedCount: 0,
        undoToken: null,
      };
      if (keepChange) {
        auditValues.push({ ...base, action: 'keep' });
      }
      if (protectChange) {
        auditValues.push({
          ...base,
          action: patch.isProtected ? 'marked_protected' : 'unmarked_protected',
        });
      }
      await tx.insert(activityLog).values(auditValues);

      return projectResult(senderId, row, true);
    });
  }
}

/** Project a `sender_policies` row (or its absence) onto the wire shape. */
function projectResult(
  senderId: string,
  row: typeof senderPolicies.$inferSelect | null,
  changed: boolean,
): SenderPolicyResult {
  return {
    senderId,
    policyType: row?.policyType ?? null,
    isProtected: row?.isProtected ?? false,
    protectionReason: row?.protectionReason ?? null,
    protectionSetAt: row?.protectionSetAt ? row.protectionSetAt.toISOString() : null,
    changed,
  };
}
