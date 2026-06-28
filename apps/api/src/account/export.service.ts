import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt } from 'drizzle-orm';

import {
  activityLog,
  mailMessages,
  mailboxAccounts,
  senderPolicies,
  senders,
} from '@declutrmail/db';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';

/**
 * DataExportService (D116 + D228 + DPDP) — builds the user-facing data
 * export as an async chunk stream so the controller can pipe it without
 * buffering the whole mailbox in memory.
 *
 * PRIVACY (D7/D228 — CLAUDE.md §2.1). Every query below is an
 * EXPLICIT-COLUMN select over the storage allowlist:
 *
 *   - sender (name + email), subject, snippet ("Gmail Preview"),
 *     dates, Gmail labels, read/unread state
 *   - the user's own standing policies + activity rows (their
 *     decisions ABOUT senders — user-generated, not message content)
 *
 * Never `SELECT *` — even though bodies don't exist in the DB, the
 * explicit column lists make the boundary reviewable and stop a future
 * column (e.g. an encrypted token) from leaking into the export.
 * `mailbox_accounts` is read for id/email/status ONLY — the encrypted
 * refresh-token columns are never selected.
 *
 * Batching: keyset pagination on `id` (uuid, stable order) with
 * BATCH_SIZE rows per round-trip. The generators yield serialized
 * string chunks; backpressure is the HTTP stream's problem.
 */
@Injectable()
export class DataExportService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /** Rows fetched per round-trip while streaming messages / activity. */
  static readonly BATCH_SIZE = 1000;

  /** Mailboxes (id + email + status only) for the workspace. */
  private async listMailboxes(workspaceId: string) {
    return this.db
      .select({
        id: mailboxAccounts.id,
        email: mailboxAccounts.providerAccountId,
        status: mailboxAccounts.status,
        connectedAt: mailboxAccounts.connectedAt,
      })
      .from(mailboxAccounts)
      .where(eq(mailboxAccounts.workspaceId, workspaceId))
      .orderBy(asc(mailboxAccounts.id));
  }

  /**
   * Senders + standing policies for one mailbox, batched by id.
   * Includes the user's verdict state (policyType / VIP / Protect) —
   * the "decisions about senders" half of the export.
   */
  private async senderBatch(mailboxId: string, afterId: string | null) {
    const conditions = [eq(senders.mailboxAccountId, mailboxId)];
    if (afterId) conditions.push(gt(senders.id, afterId));
    return this.db
      .select({
        id: senders.id,
        name: senders.displayName,
        email: senders.email,
        domain: senders.domain,
        gmailCategory: senders.gmailCategory,
        firstSeenAt: senders.firstSeenAt,
        lastSeenAt: senders.lastSeenAt,
        totalReceived: senders.totalReceived,
        policyType: senderPolicies.policyType,
        isVip: senderPolicies.isVip,
        isProtected: senderPolicies.isProtected,
        snoozedUntil: senderPolicies.snoozedUntil,
      })
      .from(senders)
      .leftJoin(
        senderPolicies,
        and(
          eq(senderPolicies.mailboxAccountId, senders.mailboxAccountId),
          eq(senderPolicies.senderKey, senders.senderKey),
        ),
      )
      .where(and(...conditions))
      .orderBy(asc(senders.id))
      .limit(DataExportService.BATCH_SIZE);
  }

  /** Message metadata index for one mailbox, batched by id. */
  private async messageBatch(mailboxId: string, afterId: string | null) {
    const conditions = [eq(mailMessages.mailboxAccountId, mailboxId)];
    if (afterId) conditions.push(gt(mailMessages.id, afterId));
    return this.db
      .select({
        id: mailMessages.id,
        senderName: senders.displayName,
        senderEmail: senders.email,
        subject: mailMessages.subject,
        snippet: mailMessages.snippet,
        receivedAt: mailMessages.internalDate,
        labels: mailMessages.labelIds,
        unread: mailMessages.isUnread,
      })
      .from(mailMessages)
      .leftJoin(
        senders,
        and(
          eq(senders.mailboxAccountId, mailMessages.mailboxAccountId),
          eq(senders.senderKey, mailMessages.senderKey),
        ),
      )
      .where(and(...conditions))
      .orderBy(asc(mailMessages.id))
      .limit(DataExportService.BATCH_SIZE);
  }

  /** Activity log (the user's decisions) for one mailbox, batched by id. */
  private async activityBatch(mailboxId: string, afterId: string | null) {
    const conditions = [eq(activityLog.mailboxAccountId, mailboxId)];
    if (afterId) conditions.push(gt(activityLog.id, afterId));
    return this.db
      .select({
        id: activityLog.id,
        occurredAt: activityLog.occurredAt,
        source: activityLog.source,
        action: activityLog.action,
        affectedCount: activityLog.affectedCount,
        senderEmail: senders.email,
      })
      .from(activityLog)
      .leftJoin(
        senders,
        and(
          eq(senders.mailboxAccountId, activityLog.mailboxAccountId),
          eq(senders.senderKey, activityLog.senderKey),
        ),
      )
      .where(and(...conditions))
      .orderBy(asc(activityLog.id))
      .limit(DataExportService.BATCH_SIZE);
  }

  /**
   * Full JSON export. Yields a valid JSON document chunk-by-chunk:
   * `{ exportedAt, format, mailboxes: [ { …, senders, messages,
   * activity } ] }`. Arrays are streamed element-wise so memory stays
   * bounded at one batch.
   */
  async *streamJson(workspaceId: string): AsyncGenerator<string> {
    const mailboxes = await this.listMailboxes(workspaceId);
    yield `{"exportedAt":${JSON.stringify(new Date().toISOString())},"format":"declutrmail-export-v1","mailboxes":[`;
    for (let i = 0; i < mailboxes.length; i++) {
      const mb = mailboxes[i]!;
      if (i > 0) yield ',';
      yield `{"email":${JSON.stringify(mb.email)},"status":${JSON.stringify(mb.status)},"connectedAt":${JSON.stringify(mb.connectedAt?.toISOString() ?? null)}`;

      yield ',"senders":[';
      yield* this.streamJsonArray(
        (after) => this.senderBatch(mb.id, after),
        (row) =>
          JSON.stringify({
            name: row.name,
            email: row.email,
            domain: row.domain,
            gmailCategory: row.gmailCategory,
            firstSeenAt: row.firstSeenAt.toISOString(),
            lastSeenAt: row.lastSeenAt.toISOString(),
            totalReceived: Number(row.totalReceived ?? 0),
            policyType: row.policyType ?? null,
            isVip: row.isVip ?? false,
            isProtected: row.isProtected ?? false,
            snoozedUntil: row.snoozedUntil?.toISOString() ?? null,
          }),
      );
      yield ']';

      yield ',"messages":[';
      yield* this.streamJsonArray(
        (after) => this.messageBatch(mb.id, after),
        (row) =>
          JSON.stringify({
            senderName: row.senderName ?? null,
            senderEmail: row.senderEmail ?? null,
            subject: row.subject,
            gmailPreview: row.snippet,
            receivedAt: row.receivedAt.toISOString(),
            labels: row.labels,
            unread: row.unread,
          }),
      );
      yield ']';

      yield ',"activity":[';
      yield* this.streamJsonArray(
        (after) => this.activityBatch(mb.id, after),
        (row) =>
          JSON.stringify({
            occurredAt: row.occurredAt.toISOString(),
            source: row.source,
            action: row.action,
            affectedCount: row.affectedCount,
            senderEmail: row.senderEmail ?? null,
          }),
      );
      yield ']}';
    }
    yield ']}';
  }

  /**
   * CSV export — the message metadata index, one row per message
   * across every mailbox in the workspace. Header row first; RFC-4180
   * quoting via `csvField`.
   */
  async *streamCsv(workspaceId: string): AsyncGenerator<string> {
    yield 'mailbox_email,sender_email,sender_name,subject,gmail_preview,received_at,labels,unread\n';
    const mailboxes = await this.listMailboxes(workspaceId);
    for (const mb of mailboxes) {
      let after: string | null = null;
      for (;;) {
        const batch = await this.messageBatch(mb.id, after);
        if (batch.length === 0) break;
        let chunk = '';
        for (const row of batch) {
          chunk +=
            [
              csvField(mb.email),
              csvField(row.senderEmail ?? ''),
              csvField(row.senderName ?? ''),
              csvField(row.subject),
              csvField(row.snippet),
              csvField(row.receivedAt.toISOString()),
              csvField(row.labels.join(' ')),
              csvField(row.unread ? 'unread' : 'read'),
            ].join(',') + '\n';
        }
        yield chunk;
        after = batch[batch.length - 1]!.id;
        if (batch.length < DataExportService.BATCH_SIZE) break;
      }
    }
  }

  /**
   * Stream one JSON array's elements: fetch batches via `fetchBatch`,
   * serialize each row with `serialize`, comma-join across batch
   * boundaries. The caller owns the surrounding `[` / `]`.
   */
  private async *streamJsonArray<T extends { id: string }>(
    fetchBatch: (afterId: string | null) => Promise<T[]>,
    serialize: (row: T) => string,
  ): AsyncGenerator<string> {
    let after: string | null = null;
    let first = true;
    for (;;) {
      const batch = await fetchBatch(after);
      if (batch.length === 0) break;
      let chunk = '';
      for (const row of batch) {
        if (!first) chunk += ',';
        first = false;
        chunk += serialize(row);
      }
      yield chunk;
      after = batch[batch.length - 1]!.id;
      if (batch.length < DataExportService.BATCH_SIZE) break;
    }
  }
}

/**
 * CSV field quoting (RFC-4180) plus a spreadsheet formula-injection
 * guard. Sender-controlled metadata (subject, sender display name)
 * reaches the CSV verbatim, so a cell beginning with `=`, `+`, `-`,
 * `@`, tab, or CR would be interpreted as a formula by Excel / Sheets /
 * LibreOffice — a crafted subject like `=HYPERLINK("http://evil","x")`
 * executes when the user opens their export. Prefix such cells with a
 * single quote to force text, then apply RFC-4180 quoting.
 */
export function csvField(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}
