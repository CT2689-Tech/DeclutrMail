'use client';

import { Button, tokens } from '@declutrmail/shared';
import type { DomainBatch } from './domain-batch';

const { color, font } = tokens;

/**
 * Same-verdict batch banner (2026-07-10) — mounts ABOVE the queue when
 * ≥3 unprotected rows share an Archive/Later recommendation. One click
 * opens the SAME aggregated D226 preview sheet as the domain batch;
 * nothing mutates until the user confirms there. Dismiss returns the
 * queue to one-row-at-a-time for the session (D32's default ritual).
 */
export function VerdictBatchBanner({
  batch,
  verdict,
  busy,
  onApply,
  onDismiss,
}: {
  batch: DomainBatch;
  verdict: 'archive' | 'later';
  /** True while this batch's composite decision is confirming. */
  busy: boolean;
  onApply: () => void;
  onDismiss: () => void;
}) {
  const n = batch.rows.length;
  const verb = verdict === 'archive' ? 'Archive' : 'Later';
  return (
    <div
      data-testid="verdict-batch-banner"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        padding: '10px 14px',
        background: 'rgba(0,107,95,0.05)',
        border: `1px solid ${color.primaryBorder}`,
        borderRadius: 10,
        fontFamily: font.sans,
      }}
    >
      <p style={{ margin: 0, flex: 1, minWidth: 220, fontSize: 13, color: color.fg }}>
        <strong>{n} of these decisions are the same:</strong>{' '}
        {verdict === 'archive' ? (
          <>the engine recommends Archive for all {n}. One preview, one undo.</>
        ) : (
          <>the engine recommends Later for all {n}. One preview, one undo.</>
        )}
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Button
          size="sm"
          tone="primary"
          disabled={busy}
          onClick={onApply}
          aria-label={`${verb} all ${n} recommended senders — preview first`}
        >
          {busy ? 'Applying…' : `${verb} all ${n}`}
        </Button>
        <Button size="sm" tone="default" disabled={busy} onClick={onDismiss}>
          Decide one by one
        </Button>
      </div>
    </div>
  );
}
