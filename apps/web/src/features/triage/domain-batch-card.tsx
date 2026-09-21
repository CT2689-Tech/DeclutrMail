'use client';

import { useState } from 'react';
import { Avatar, Button, Pill, tokens } from '@declutrmail/shared';

import type { DomainBatch } from './domain-batch';
import { verdictToVerb } from './types';

const { color, font, motion, radius, text } = tokens;

/** The verbs a batch can apply — the bulk pipeline's triage subset.
 *  Keep and Unsubscribe stay per-sender: Keep is a per-sender policy
 *  intent, Unsubscribe depends on each sender's channel (D9/D230). */
export type BatchVerb = 'Archive' | 'Later';

const BOTH_VERBS: readonly BatchVerb[] = ['Archive', 'Later'];

/**
 * Batch offer — "{n} senders from {domain}", decided together.
 *
 * Offered when ≥3 consecutive queue rows share a registrable domain
 * (see `domain-batch.ts`), and — in focus mode — for the same-verdict
 * offer too (`headline` + a single verb). Strictly additive to the
 * daily ritual: "Decide one by one" dismisses it and the run renders as
 * normal rows. A batch verb routes through the SAME mandatory preview →
 * mutation path as every destructive action (D226) — the screen opens
 * `<BatchActionSheet>` with the REAL aggregated counts before one
 * `POST /api/actions` (senders selector, ADR-0020) fires. One composite
 * action → one batch undo token (cascade revert).
 *
 * Presentational: mutation lifecycle lives in `triage-screen.tsx`
 * alongside the single-row pipeline so the "one decision confirms at
 * a time" latch covers both.
 */
export function DomainBatchCard({
  batch,
  busy = false,
  disabled = false,
  variant = 'list',
  headline,
  verbs = BOTH_VERBS,
  onVerb,
  onDismiss,
}: {
  batch: DomainBatch;
  /** True while THIS batch's action is confirming server-side. */
  busy?: boolean;
  /** True while any other decision is confirming (single-slot latch). */
  disabled?: boolean;
  /** `'focus'` is the centred card in the one-at-a-time stack. */
  variant?: 'list' | 'focus';
  /**
   * Replaces "senders from {domain}" — the same-verdict offer groups by
   * recommendation and has no domain to name.
   */
  headline?: string;
  /** The first verb is the filled one. */
  verbs?: readonly BatchVerb[];
  onVerb: (verb: BatchVerb) => void;
  onDismiss: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // The shared eligibility set — same rows the sheet previews and the
  // enqueue sends, so the headline count can never drift from them.
  const eligible = batch.eligibleRows;
  const protectedCount = batch.rows.length - eligible.length;
  const focus = variant === 'focus';
  const scope = headline ?? `senders from ${batch.domain}`;
  const verbLabel = (verb: BatchVerb) =>
    headline !== undefined
      ? `${verb} all ${eligible.length} recommended senders — preview first`
      : verb === 'Archive'
        ? `Archive all ${eligible.length} senders from ${batch.domain}`
        : `Move all ${eligible.length} senders from ${batch.domain} to Later`;

  const protectedNote = protectedCount > 0 && (
    <span style={{ fontSize: text.sm, color: color.fgMuted }}>
      {/* The verb has to agree too. This read "1 protected sender stay
          untouched" until 2026-08-27 — the noun was pluralised and the verb
          was not, and a test asserted the broken string verbatim. */}
      {protectedCount} protected sender{protectedCount === 1 ? ' stays' : 's stay'} untouched
    </span>
  );

  const disclosure = (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      aria-expanded={expanded}
      style={{
        // Explicit resets, not `all: unset` — that also unsets the
        // global :focus-visible ring.
        background: 'none',
        border: 'none',
        padding: 0,
        fontFamily: 'inherit',
        cursor: 'pointer',
        fontSize: text.sm,
        fontWeight: 600,
        color: color.primary,
        alignSelf: focus ? 'center' : 'flex-start',
        minHeight: focus ? 28 : undefined,
      }}
    >
      {expanded ? 'Hide senders' : 'Show senders'}
    </button>
  );

  const members = expanded && (
    <div
      role="list"
      aria-label={headline !== undefined ? 'Senders in this batch' : `Senders from ${batch.domain}`}
      style={{ display: 'flex', flexDirection: 'column', width: '100%', textAlign: 'left' }}
    >
      {batch.rows.map((row) => (
        <div
          key={row.id}
          role="listitem"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 0',
            borderTop: `1px solid ${color.line}`,
          }}
        >
          <Avatar
            name={row.senderName}
            domain={row.senderDomain}
            size={24}
            hasMark={row.brandMark}
          />
          <span
            style={{
              fontSize: text.md,
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
            <span style={{ fontSize: text.xs, fontWeight: 600, color: color.primary }}>
              Protected
            </span>
          ) : (
            <Pill tone="default">{verdictToVerb(row.verdict)}</Pill>
          )}
        </div>
      ))}
    </div>
  );

  const buttons = (
    <>
      {verbs.map((verb, i) => (
        <Button
          key={verb}
          tone={i === 0 ? 'primary' : 'default'}
          size="md"
          disabled={busy || disabled}
          onClick={() => onVerb(verb)}
          ariaLabel={verbLabel(verb)}
          {...(focus ? { style: { height: 44 } } : {})}
        >
          {busy && i === 0 ? 'Applying…' : verb === 'Archive' ? 'Archive all' : 'Later for all'}
        </Button>
      ))}
      <Button
        tone="ghost"
        size="md"
        disabled={busy}
        onClick={onDismiss}
        {...(focus ? { style: { height: 44 } } : {})}
      >
        Decide one by one
      </Button>
    </>
  );

  const status = busy && (
    <span role="status" style={{ position: 'absolute', left: -9999 }}>
      Applying your decision for {headline ?? batch.domain}
    </span>
  );

  if (focus) {
    return (
      <section
        aria-label="Current decision"
        aria-busy={busy}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          opacity: busy ? 0.6 : 1,
          transition: `opacity ${motion.fast} ${motion.ease}`,
          fontFamily: font.sans,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            gap: 6,
            padding: '40px 24px 28px',
            background: color.card,
            border: `1px solid ${color.line}`,
            borderRadius: radius.lg,
          }}
        >
          <span
            style={{
              fontFamily: font.display,
              fontSize: text['4xl'],
              fontWeight: 600,
              lineHeight: 1,
              letterSpacing: '-0.02em',
              color: color.fg,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {eligible.length}
          </span>
          <h2
            style={{
              margin: '8px 0 0',
              fontSize: text['2xl'],
              fontWeight: 600,
              letterSpacing: '-0.014em',
              color: color.fg,
              overflowWrap: 'anywhere',
            }}
          >
            {scope}
          </h2>
          {protectedNote}
          {disclosure}
          {members}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
          {buttons}
        </div>
        {status}
      </section>
    );
  }

  return (
    <div
      aria-busy={busy}
      style={{
        position: 'relative',
        borderBottom: `1px solid ${color.line}`,
        padding: '14px 4px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        fontFamily: font.sans,
        opacity: busy ? 0.6 : 1,
        transition: `opacity ${motion.fast} ${motion.ease}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span
          style={{ flex: 1, minWidth: 200, fontSize: text.md, fontWeight: 600, color: color.fg }}
        >
          {eligible.length} {scope}
        </span>
        {buttons}
      </div>
      {protectedNote}
      {disclosure}
      {members}
      {status}
    </div>
  );
}
