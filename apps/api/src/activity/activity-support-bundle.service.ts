import { Inject, Injectable } from '@nestjs/common';
import { PassThrough } from 'node:stream';
import { and, eq } from 'drizzle-orm';
import { strToU8, Zip, ZipPassThrough } from 'fflate';

import { mailboxAccounts } from '@declutrmail/db';
import {
  ACTIVITY_SUPPORT_BUNDLE_FORMAT,
  ACTIVITY_SUPPORT_CSV_COLUMNS,
} from '@declutrmail/shared/contracts';
import {
  activityActionLabel,
  activityExecutionLabel,
  activitySourceLabel,
  activityUndoLabel,
} from '@declutrmail/shared/actions';

import { AppException } from '../common/app-exception.js';
import { csvField } from '../common/csv.js';
import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import {
  ActivityReadService,
  type ActivityIterationSnapshot,
  type IterateActivityParams,
} from './activity.read-service.js';
import type { ActivityRow } from './activity.types.js';

export interface CreateActivitySupportBundleParams {
  workspaceId: string;
  mailboxAccountId: string;
  filters: Omit<IterateActivityParams, 'mailboxAccountId' | 'nowMs'>;
  includeFullSenderAddresses: boolean;
  includeTechnicalDetails: boolean;
  generatedAt?: Date;
}

interface BundleCounts {
  records: number;
  affectedMessages: number;
}

@Injectable()
export class ActivitySupportBundleService {
  static readonly BATCH_SIZE = 500;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly reads: ActivityReadService,
  ) {}

  async createBundle(params: CreateActivitySupportBundleParams): Promise<PassThrough> {
    const mailbox = await this.loadMailboxContext(params.workspaceId, params.mailboxAccountId);
    const generatedAt = params.generatedAt ?? new Date();
    const readParams: IterateActivityParams = {
      mailboxAccountId: mailbox.id,
      ...params.filters,
      nowMs: generatedAt.getTime(),
    };
    const snapshot = await this.reads.captureIterationSnapshot(mailbox.id);
    const output = new PassThrough();
    let aborted = false;
    const zip = new Zip((error, chunk, final) => {
      if (error) {
        output.destroy(error);
        return;
      }
      if (aborted || output.destroyed) return;
      output.write(Buffer.from(chunk));
      if (final) output.end();
    });
    output.once('close', () => {
      if (output.writableEnded) return;
      aborted = true;
      zip.terminate();
    });

    void this.writeBundle(zip, output, {
      ...params,
      generatedAt,
      mailbox,
      readParams,
      snapshot,
      isAborted: () => aborted || output.destroyed,
    }).catch((error: unknown) => {
      if (!aborted) {
        zip.terminate();
        output.destroy(error instanceof Error ? error : new Error(String(error)));
      }
    });
    return output;
  }

  private async loadMailboxContext(workspaceId: string, mailboxAccountId: string) {
    const [mailbox] = await this.db
      .select({
        id: mailboxAccounts.id,
        email: mailboxAccounts.providerAccountId,
        status: mailboxAccounts.status,
      })
      .from(mailboxAccounts)
      .where(
        and(
          eq(mailboxAccounts.id, mailboxAccountId),
          eq(mailboxAccounts.workspaceId, workspaceId),
          eq(mailboxAccounts.status, 'active'),
        ),
      )
      .limit(1);
    if (!mailbox) {
      throw new AppException({
        code: 'MAILBOX_NOT_OWNED',
        message: 'Selected mailbox is not connected to your workspace.',
      });
    }
    return mailbox;
  }

  private async writeBundle(
    zip: Zip,
    output: PassThrough,
    context: CreateActivitySupportBundleParams & {
      generatedAt: Date;
      mailbox: { id: string; email: string; status: 'active' | 'disconnected' };
      readParams: IterateActivityParams;
      snapshot: ActivityIterationSnapshot;
      isAborted: () => boolean;
    },
  ): Promise<void> {
    const counts = await this.writeActivityFiles(zip, output, context);
    await this.writeTextFile(
      zip,
      output,
      'summary.txt',
      this.summaryText(context, counts),
      context,
    );
    zip.end();
  }

  private async writeActivityFiles(
    zip: Zip,
    output: PassThrough,
    context: {
      includeFullSenderAddresses: boolean;
      includeTechnicalDetails: boolean;
      generatedAt: Date;
      mailbox: { id: string };
      readParams: IterateActivityParams;
      snapshot: ActivityIterationSnapshot;
      isAborted: () => boolean;
    },
  ): Promise<BundleCounts> {
    const csvFile = new ZipPassThrough('activity.csv');
    zip.add(csvFile);
    await this.push(csvFile, output, `${ACTIVITY_SUPPORT_CSV_COLUMNS.join(',')}\n`, context);
    const technicalFile = context.includeTechnicalDetails
      ? new ZipPassThrough('technical-details.json')
      : null;
    if (technicalFile) {
      zip.add(technicalFile);
      await this.push(technicalFile, output, technicalHeader(context), context);
    }
    const counts = { records: 0, affectedMessages: 0 };
    let firstTechnicalRecord = true;
    for await (const row of this.reads.iterateActivity(
      context.readParams,
      ActivitySupportBundleService.BATCH_SIZE,
      context.snapshot,
    )) {
      counts.records += 1;
      counts.affectedMessages += row.affectedCount;
      await this.push(
        csvFile,
        output,
        `${activityCsvLine(row, context.includeFullSenderAddresses)}\n`,
        context,
      );
      if (technicalFile) {
        await this.push(
          technicalFile,
          output,
          `${firstTechnicalRecord ? '' : ','}${JSON.stringify(technicalRecord(row))}`,
          context,
        );
        firstTechnicalRecord = false;
      }
    }
    await this.finishFile(csvFile, output, context);
    if (technicalFile) {
      await this.push(technicalFile, output, ']}', context);
      await this.finishFile(technicalFile, output, context);
    }
    return counts;
  }

  private summaryText(
    context: CreateActivitySupportBundleParams & {
      generatedAt: Date;
      mailbox: { email: string };
    },
    counts: BundleCounts,
  ): string {
    const { filters } = context;
    const actionFilter =
      filters.verbs && filters.verbs.length > 0
        ? filters.verbs.map((verb) => activityActionLabel(verb, null)).join(', ')
        : 'All';
    return [
      'DeclutrMail Activity support bundle',
      '',
      `Generated: ${context.generatedAt.toISOString()}`,
      `Mailbox: ${context.mailbox.email}`,
      `Window: ${windowLabel(filters.window)}`,
      `Source: ${filters.source ? activitySourceLabel(filters.source) : 'All'}`,
      `Actions: ${actionFilter}`,
      `Date from: ${filters.dateFrom?.toISOString() ?? 'Not set'}`,
      `Date to: ${filters.dateTo?.toISOString() ?? 'Not set'}`,
      `Sender search: ${filters.senderQuery ? 'Applied' : 'Not applied'}`,
      `Sender addresses: ${context.includeFullSenderAddresses ? 'Full (explicitly included)' : 'Masked'}`,
      `Technical details: ${context.includeTechnicalDetails ? 'Included' : 'Not included'}`,
      '',
      `Records: ${counts.records}`,
      `Messages affected: ${counts.affectedMessages}`,
      '',
      'This bundle contains Activity metadata only. It never contains message bodies, OAuth or session tokens, Undo tokens, idempotency keys, raw provider responses, or unbounded exception text.',
      '',
    ].join('\n');
  }

  private async writeTextFile(
    zip: Zip,
    output: PassThrough,
    name: string,
    content: string,
    context: { isAborted: () => boolean },
  ): Promise<void> {
    const file = new ZipPassThrough(name);
    zip.add(file);
    await this.push(file, output, content, context);
    await this.finishFile(file, output, context);
  }

  private async push(
    file: ZipPassThrough,
    output: PassThrough,
    value: string,
    context: { isAborted: () => boolean },
  ): Promise<void> {
    if (context.isAborted()) throw new Error('Activity support bundle stream closed.');
    file.push(strToU8(value));
    await waitForDrain(output, context.isAborted);
  }

  private async finishFile(
    file: ZipPassThrough,
    output: PassThrough,
    context: { isAborted: () => boolean },
  ): Promise<void> {
    if (context.isAborted()) throw new Error('Activity support bundle stream closed.');
    file.push(new Uint8Array(0), true);
    await waitForDrain(output, context.isAborted);
  }
}

function activityCsvLine(row: ActivityRow, includeFullSenderAddresses: boolean): string {
  const execution = row.executionState;
  const senderName = row.sender
    ? includeFullSenderAddresses
      ? row.sender.displayName
      : maskAddressInDisplayName(row.sender.displayName, row.sender.email)
    : 'Account-scoped action';
  const senderAddress = row.sender
    ? includeFullSenderAddresses
      ? row.sender.email
      : maskSenderAddress(row.sender.email)
    : '';
  return [
    row.occurredAt,
    activityActionLabel(row.action, execution),
    activitySourceLabel(row.source),
    senderName,
    senderAddress,
    String(row.affectedCount),
    activityExecutionLabel(execution),
    activityUndoLabel(row.undoState.kind),
  ]
    .map(csvField)
    .join(',');
}

function technicalHeader(context: {
  generatedAt: Date;
  mailbox: { id: string };
  readParams: IterateActivityParams;
}): string {
  const { readParams } = context;
  const filters = {
    window: readParams.window,
    source: readParams.source ?? 'all',
    verbs: readParams.verbs ?? [],
    dateFrom: readParams.dateFrom?.toISOString() ?? null,
    dateTo: readParams.dateTo?.toISOString() ?? null,
  };
  return `{"bundleFormat":${JSON.stringify(ACTIVITY_SUPPORT_BUNDLE_FORMAT)},"generatedAt":${JSON.stringify(context.generatedAt.toISOString())},"mailboxId":${JSON.stringify(context.mailbox.id)},"filters":${JSON.stringify(filters)},"records":[`;
}

function technicalRecord(row: ActivityRow) {
  const execution = row.executionState;
  return {
    activityId: execution ? null : row.id,
    actionAttemptId: execution?.actionId ?? null,
    occurredAt: row.occurredAt,
    action: row.action,
    source: row.source,
    executionStatus:
      execution === null
        ? 'completed'
        : execution.kind === 'in_progress'
          ? execution.status
          : 'failed',
    errorCode: execution?.kind === 'failed' ? execution.errorCode : null,
  };
}

function maskSenderAddress(email: string): string {
  const separator = email.lastIndexOf('@');
  if (separator < 0) return '***';
  const local = email.slice(0, separator);
  const domain = email.slice(separator + 1);
  return `${local.slice(0, 1) || '*'}***@${domain}`;
}

function maskAddressInDisplayName(displayName: string, email: string): string {
  const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return displayName.replace(new RegExp(escaped, 'gi'), maskSenderAddress(email));
}

async function waitForDrain(output: PassThrough, isAborted: () => boolean): Promise<void> {
  if (isAborted()) throw new Error('Activity support bundle stream closed.');
  if (!output.writableNeedDrain) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      output.off('drain', onDrain);
      output.off('close', onClose);
      output.off('error', onError);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      reject(new Error('Activity support bundle stream closed.'));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    output.once('drain', onDrain);
    output.once('close', onClose);
    output.once('error', onError);
  });
}

function windowLabel(window: IterateActivityParams['window']): string {
  const labels: Record<IterateActivityParams['window'], string> = {
    '7d': 'Last 7 days',
    '30d': 'Last 30 days',
    '90d': 'Last 90 days',
    all: 'All time',
  };
  return labels[window];
}
