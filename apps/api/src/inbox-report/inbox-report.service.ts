import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';

import { inboxReportCache, mailboxAccounts, syncRuns } from '@declutrmail/db';
import {
  INBOX_REPORT_THRESHOLDS,
  selectInboxReport,
  type InboxReportDto,
  type ReportFacts,
  type ReportSenderFacts,
} from '@declutrmail/shared/inbox-report';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import { mailboxFactsQuery, senderFactsQuery, vendorQuery } from './inbox-report.queries.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return (result as { rows?: T[] }).rows ?? [];
}

function num(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function flag(value: unknown): boolean {
  return value === true || value === 't' || value === 'true';
}

@Injectable()
export class InboxReportService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async getForMailbox(mailboxId: string, now = new Date()): Promise<InboxReportDto> {
    const syncId = await this.latestSucceededSyncId(mailboxId);
    const [cached] = await this.db
      .select()
      .from(inboxReportCache)
      .where(eq(inboxReportCache.mailboxAccountId, mailboxId))
      .limit(1);
    if (cached && (cached.sourceSyncRunId ?? null) === syncId && isReportDto(cached.payload)) {
      return cached.payload;
    }

    const report = selectInboxReport(await this.computeFacts(mailboxId, now), now.toISOString());
    await this.db
      .insert(inboxReportCache)
      .values({
        mailboxAccountId: mailboxId,
        payload: report,
        sourceSyncRunId: syncId,
        generatedAt: now,
      })
      .onConflictDoUpdate({
        target: inboxReportCache.mailboxAccountId,
        set: {
          payload: report,
          sourceSyncRunId: syncId,
          generatedAt: now,
        },
      });
    return report;
  }

  /** 404 when the id is not in this workspace. The report never reads another mailbox. */
  async assertInWorkspace(workspaceId: string, mailboxId: string): Promise<void> {
    const [row] = await this.db
      .select({ id: mailboxAccounts.id })
      .from(mailboxAccounts)
      .where(and(eq(mailboxAccounts.id, mailboxId), eq(mailboxAccounts.workspaceId, workspaceId)))
      .limit(1);
    if (!row) throw new NotFoundException();
  }

  private async latestSucceededSyncId(mailboxId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: syncRuns.id })
      .from(syncRuns)
      .where(and(eq(syncRuns.mailboxAccountId, mailboxId), eq(syncRuns.status, 'succeeded')))
      .orderBy(desc(syncRuns.finishedAt), desc(syncRuns.id))
      .limit(1);
    return row?.id ?? null;
  }

  private async computeFacts(mailboxId: string, now: Date): Promise<ReportFacts> {
    const sinceIso = new Date(
      now.getTime() - INBOX_REPORT_THRESHOLDS.engineWindowDays * DAY_MS,
    ).toISOString();
    const threeYearsIso = new Date(now.getTime() - 3 * 365 * DAY_MS).toISOString();
    const [mailboxRows, senderRows, vendorRows] = await Promise.all([
      this.db.execute(mailboxFactsQuery(mailboxId, sinceIso, threeYearsIso)),
      this.db.execute(senderFactsQuery(mailboxId, sinceIso)),
      this.db.execute(vendorQuery(mailboxId)),
    ]);
    const mailbox = rowsOf<Record<string, unknown>>(mailboxRows)[0] ?? {};
    const vendor = rowsOf<{ vendor_key?: string | null }>(vendorRows)[0];
    const senders: ReportSenderFacts[] = rowsOf<Record<string, unknown>>(senderRows).map((row) => ({
      senderId: String(row.sender_id),
      inbound90: num(row.inbound_90),
      markedRead90: num(row.marked_read_90),
      sweeperMarked90: num(row.sweeper_marked_90),
      hasUnsubscribe: flag(row.has_unsubscribe),
      wroteToCount: num(row.wrote_to_count),
      isProtected: flag(row.is_protected),
      isKeep: flag(row.is_keep),
      inboxCount: num(row.inbox_count),
    }));
    const oldest = mailbox.oldest_year;
    return {
      receivedCount: num(mailbox.received_count),
      receivedBytes: num(mailbox.received_bytes),
      inbound90: num(mailbox.inbound_90),
      markedRead90: num(mailbox.marked_read_90),
      peopleReceived: num(mailbox.people_received),
      largeCount: num(mailbox.large_count),
      largeBytes: num(mailbox.large_bytes),
      top10Bytes: num(mailbox.top10_bytes),
      thirdPartyCount: num(mailbox.third_party_count),
      thirdPartyBytes: num(mailbox.third_party_bytes),
      thirdPartyRecent90: num(mailbox.third_party_recent_90),
      vendorKey: vendor?.vendor_key ? String(vendor.vendor_key) : null,
      oldestYear: oldest === null || oldest === undefined ? null : num(oldest),
      olderThan3YearsCount: num(mailbox.older_than_3_years),
      top10Count: num(mailbox.top10_count),
      trashCount: num(mailbox.trash_count),
      trashBytes: num(mailbox.trash_bytes),
      senders,
      nowYear: now.getUTCFullYear(),
    };
  }
}

function isReportDto(value: unknown): value is InboxReportDto {
  if (typeof value !== 'object' || value === null) return false;
  const variant = (value as { variant?: unknown }).variant;
  return variant === 'full' || variant === 'fallback';
}
