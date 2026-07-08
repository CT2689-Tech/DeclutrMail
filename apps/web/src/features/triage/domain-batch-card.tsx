'use client';

import { useState } from 'react';
import { Avatar, Button, Pill, tokens } from '@declutrmail/shared';

import type { DomainBatch } from './domain-batch';
import { verdictToVerb } from './types';

const { color, font } = tokens;

/** The verbs a batch can apply — the bulk pipeline's triage subset.
 *  Keep and Unsubscribe stay per-sender: Keep is a per-sender policy
 *  intent, Unsubscribe depends on each sender's channel (D9/D230). */
export type BatchVerb = 'Archive' | 'Later';

/**
 * Domain-batch card — "{n} senders from {domain} — decide together?"
 *
 * Offered when ≥3 consecutive queue rows share a registrable domain
 * (see `domain-batch.ts`). Strictly additive to the daily ritual:
 * "Decide one by one" dismisses the card and the run renders as
 * normal rows. A batch verb routes through the SAME mandatory
 * preview → mutation path as every destructive action (D226) — the
 * screen opens `<BatchActionSheet>` with the REAL aggregated counts
 * before one `POST /api/actions` (senders selector, ADR-0020) fires.
 * One composite action → one batch undo token (cascade revert).
 *
 * Presentational: mutation lifecycle lives in `triage-screen.tsx`
 * alongside the single-row pipeline so the "one decision confirms at
 * a time" latch covers both.
 */
export function DomainBatchCard({
  batch,
  busy = false,
  disabled = false,
  onVerb,
  onDismiss,
}: {
  batch: DomainBatch;
  /** True while THIS batch's action is confirming server-side. */
  busy?: boolean;
  /** True while any other decision is confirming (single-slot latch). */
  disabled?: boolean;
  onVerb: (verb: BatchVerb) => void;
  onDismiss: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const eligible = batch.rows.filter((r) => r.protectionReason === null);
  const protectedCount = batch.rows.length - eligible.length;

  return (
    <div
      aria-busy={busy}
      style={{
        background: color.card,
        border: `1px dashed ${color.primaryBorder}`,
        borderRadius: 10,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        fontFamily: font.sans,
        opacity: busy ? 0.6 : 1,
        transition: 'opacity 0.15s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span
          style={{
            fontFamily: font.mono,
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: color.primary,
          }}
        >
          Same domain
        </span>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: color.fg }}>
          {eligible.length} senders from {batch.domain} — decide together?
        </span>
        {protectedCount > 0 && (
          <span style={{ fontSize: 11.5, color: color.fgMuted }}>
            {protectedCount} protected sender{protectedCount === 1 ? '' : 's'} stay untouched
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        style={{
          all: 'unset',
          cursor: 'pointer',
          fontSize: 11.5,
          color: color.fgSoft,
          textDecoration: 'underline',
          textUnderlineOffset: 2,
          textDecorationColor: color.lineSoft,
          alignSelf: 'flex-start',
        }}
      >
        {expanded ? 'Hide the senders' : `Show all ${batch.rows.length} senders`}
      </button>

      {expanded && (
        <div
          role="list"
          aria-label={`Senders from ${batch.domain}`}
          style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
        >
          {batch.rows.map((row) => (
            <div
              key={row.id}
              role="listitem"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '6px 8px',
                background: color.paper,
                border: `1px solid ${color.lineSoft}`,
                borderRadius: 8,
              }}
            >
              <Avatar name={row.senderName} domain={row.senderDomain} size={24} />
              <span
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: color.fg,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  minWidth: 0,
                  flex: 1,
                }}
              >
                {row.senderName}
              </span>
              {row.protectionReason !== null ? (
                <span
                  style={{
                    fontFamily: font.mono,
                    fontSize: 9,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: color.primary,
                  }}
                >
                  Protected
                </span>
              ) : (
                <Pill tone="default">{verdictToVerb(row.verdict)}</Pill>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Button
          tone="dark"
          size="md"
          disabled={busy || disabled}
          onClick={() => onVerb('Archive')}
          ariaLabel={`Archive all ${eligible.length} senders from ${batch.domain}`}
        >
          Archive all
        </Button>
        <Button
          tone="default"
          size="md"
          disabled={busy || disabled}
          onClick={() => onVerb('Later')}
          ariaLabel={`Move all ${eligible.length} senders from ${batch.domain} to Later`}
        >
          Later for all
        </Button>
        <span style={{ flex: 1 }} />
        <Button tone="ghost" size="sm" disabled={busy} onClick={onDismiss}>
          Decide one by one
        </Button>
      </div>

      {busy && (
        <span role="status" style={{ position: 'absolute', left: -9999 }}>
          Applying your decision for {batch.domain}
        </span>
      )}
    </div>
  );
}
