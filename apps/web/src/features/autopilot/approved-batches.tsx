'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@declutrmail/shared';
import { useInFlightActions } from '@/features/undo/in-flight';
import { useBatchStatus, useRevertUndo, useUndoStatus } from '@/lib/api/use-action';
import type { SenderRuleExecution } from '@/lib/api/autopilot-sender-rules';
import { senderRuleFailureCopy } from './sender-rule-feedback';
import { useHydrated } from '@/lib/use-hydrated';
import styles from './sender-rule-library.module.css';

type Receipt = SenderRuleExecution & { ruleName?: string };
type Batch = { id: string; name: string; startedAt: string; enqueueFailedCount?: number };
const number = (value: number) => value.toLocaleString('en-US');

/** Discovery is server-backed; a local receipt closes the acceptance-to-discovery gap. */
export function ApprovedBatches({
  mailboxId,
  receipt,
}: {
  mailboxId: string;
  receipt: Receipt | null;
}) {
  const active = useInFlightActions(mailboxId);
  const hydrated = useHydrated();
  const [seen, setSeen] = useState<Batch[]>([]);
  useEffect(() => {
    setSeen((previous) => {
      const batches = new Map(previous.map((batch) => [batch.id, batch]));
      for (const group of active.data ?? []) {
        if (group.autopilot)
          batches.set(group.groupId, {
            id: group.groupId,
            name: group.autopilot.ruleName ?? 'Approved rule batch',
            startedAt: group.startedAt,
          });
      }
      if (receipt)
        batches.set(receipt.batchId, {
          id: receipt.batchId,
          name: receipt.ruleName ?? 'Approved rule batch',
          startedAt: batches.get(receipt.batchId)?.startedAt ?? new Date().toISOString(),
          enqueueFailedCount: receipt.enqueueFailedCount,
        });
      const next = [...batches.values()]
        .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
        .slice(0, 20);
      return JSON.stringify(next) === JSON.stringify(previous) ? previous : next;
    });
  }, [active.data, receipt]);
  return (
    <section aria-label="Approved batches" className={styles.approvals}>
      <div className={styles.top}>
        <h2>Approved batches</h2>
        <Link href="/activity">All activity</Link>
      </div>
      {hydrated && active.isError && (
        <p role="alert">
          Queued approvals couldn’t be refreshed.{' '}
          <Button size="sm" tone="ghost" onClick={() => void active.refetch()}>
            Retry approvals
          </Button>
        </p>
      )}
      {!seen.length && (
        <p className={styles.muted}>
          {!hydrated || active.isPending
            ? 'Checking approved batches…'
            : active.isError
              ? 'Check Activity for your approved batches.'
              : 'Preview a rule and approve a batch. It will appear here while it waits or runs.'}
        </p>
      )}
      {seen.length > 6 && (
        <p className={styles.muted}>
          Showing the 6 most recent batches. See All activity for the rest.
        </p>
      )}
      {seen.slice(0, 6).map((batch) => (
        <ApprovedBatch key={batch.id} batch={batch} mailboxId={mailboxId} />
      ))}
    </section>
  );
}

function ApprovedBatch({ batch, mailboxId }: { batch: Batch; mailboxId: string }) {
  const status = useBatchStatus(batch.id, mailboxId, 15_000);
  const undo = useRevertUndo();
  const restoration = useUndoStatus(undo.data?.actionId ?? null, mailboxId, undo.data?.actionIds);
  const data = status.data;
  const [now, setNow] = useState(Date.now);
  const waiting = data?.autopilot?.waitingUntil;
  const held = waiting != null && Date.parse(waiting) > Date.now();
  const restored =
    undo.data?.reverted === true ||
    data?.undoRevertedAt != null ||
    restoration.data?.status === 'done';
  const restoring =
    undo.isPending ||
    (undo.data?.actionId != null &&
      !restored &&
      !restoration.isError &&
      restoration.data?.status !== 'failed');
  const undoAvailable =
    data?.undoToken &&
    data.undoExpiresAt &&
    Date.parse(data.undoExpiresAt) > now &&
    data.affectedCount > 0 &&
    (data.status === 'done' || data.status === 'failed');
  useEffect(() => {
    const expiresAt = data?.undoExpiresAt ? Date.parse(data.undoExpiresAt) : NaN;
    if (restored || !Number.isFinite(expiresAt) || expiresAt <= now) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(expiresAt - Date.now() + 10, 2_147_483_647),
    );
    return () => clearTimeout(timer);
  }, [data?.undoExpiresAt, now, restored]);
  useEffect(() => {
    if (restored) void status.refetch();
  }, [restored]);
  return (
    <article className={styles.approvedBatch} aria-label={`Batch progress for ${batch.name}`}>
      <strong>{batch.name}</strong>
      <div role="status">
        {status.isError ? (
          <p className={styles.error}>
            Progress couldn’t be checked.{' '}
            <Button tone="ghost" size="sm" onClick={() => void status.refetch()}>
              Retry status
            </Button>
          </p>
        ) : restored ? (
          <p className={styles.notice}>Undo complete. Emails restored.</p>
        ) : data?.status === 'done' || data?.status === 'failed' ? (
          <p className={data.failed ? styles.error : styles.notice}>
            {number(data.affectedCount)} emails moved.
            {data.failed > 0
              ? ` ${number(data.failed)} actions failed. ${senderRuleFailureCopy(data.failureCodes) ?? 'Review Activity to recover.'}`
              : ''}
          </p>
        ) : held ? (
          <p className={styles.muted}>
            Waiting for Schedule · resumes{' '}
            {new Date(waiting).toLocaleString([], {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              timeZoneName: 'short',
            })}
            . {number(data?.requestedCount ?? 0)} approved emails.
          </p>
        ) : (
          <p className={styles.muted}>
            {data?.status === 'executing'
              ? `Working · ${number(data.done)} of ${number(data.total)} steps finished.`
              : 'Batch queued. Schedule applies before it starts.'}
          </p>
        )}
      </div>
      {(batch.enqueueFailedCount ?? 0) > 0 && (
        <p className={styles.error}>
          Some actions couldn’t be queued. Review Activity before trying again.
        </p>
      )}
      {(data?.skippedProtectedSenderIds?.length ?? 0) > 0 && (
        <p className={styles.muted}>
          {number(data!.skippedProtectedSenderIds!.length)} Protected senders skipped.
        </p>
      )}
      {data?.undoToken &&
        data.undoExpiresAt &&
        Date.parse(data.undoExpiresAt) <= now &&
        !restored && <p className={styles.muted}>The Undo window has ended.</p>}
      {restoring && <p role="status">Restoring emails…</p>}
      {(undo.isError || restoration.isError || restoration.data?.status === 'failed') && (
        <p role="alert" className={styles.error}>
          Undo couldn’t be completed. Review Activity or retry.
        </p>
      )}
      {undoAvailable && !restored && (
        <Button
          tone="default"
          size="sm"
          disabled={restoring}
          onClick={() => undo.mutate({ token: data.undoToken!, mailboxId })}
        >
          Undo
        </Button>
      )}
      <Link href="/activity">Activity and Undo</Link>
    </article>
  );
}
