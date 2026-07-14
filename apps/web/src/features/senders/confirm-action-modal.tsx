'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { Button, Eyebrow, Kbd, tokens, useFocusTrap } from '@declutrmail/shared';
import {
  buildActionPresentation,
  defaultLaterWakeAtIso,
  type PresentedAction,
  type UnsubscribeChannel,
} from '@declutrmail/shared/actions';
import type { BulkActionPreviewResult, CompositeActionPreviewResult } from '@/lib/api/use-action';
import { verbDisplay, type ActionRequest, type ActionVerb } from './data';

const { color, font } = tokens;

/**
 * Composite secondary verb (spec v1.2 Decision 15). Picked from the
 * "ALSO ACT ON PAST EMAILS" chip row on Unsubscribe + Later primary.
 * `null` = "Leave alone" (the default — no secondary action fires).
 */
export type ConfirmSecondaryVerb = 'archive' | 'delete' | null;

export interface ConfirmOptions {
  /** Exact return time confirmed for a Later action. */
  wakeAt?: string;
  /**
   * Time-window filter for the PRIMARY verb (Archive primary, Delete
   * primary, or the secondary historic action on Unsub/Later when its
   * own window is not set). `null` = no filter, act on all matching
   * mail. Spec v1.2 Decision 15 chips: All / 30d+ / 3mo+ / 6mo+ / 1yr+.
   */
  olderThanDays?: number | null;
  /**
   * Composite secondary (ADR-0020). Applies only when primary ∈
   * {Unsubscribe, Later}. `null` / omitted = "Leave alone" — no
   * secondary action fires. Carries its own time-window so the user
   * can say "Unsubscribe + Delete past 6 months" with one click.
   */
  secondary?: {
    type: 'archive' | 'delete';
    olderThanDays?: number | null;
  } | null;
  /**
   * @deprecated Pre-spec-v1.2 boolean toggle preserved for tracer
   * surfaces (review-session apply). New callers should populate
   * `secondary` directly. The modal derives this from `secondary` so
   * legacy consumers continue to receive a truthy value when the user
   * picks "Archive them".
   */
  archiveHistoric?: boolean;
}

/**
 * Time-window presets (spec v1.2 Decision 15). Days values plumb to the
 * BE `olderThanDays` filter; the label is what the user reads. `null`
 * value = no time filter (act on all). Defaults per verb (handoff spec):
 *   - Archive primary → null    ("All inbox")
 *   - Delete primary  → 180     ("6 months+" — safer)
 *   - Unsub/Later secondary historic → null when first toggled on
 */
const TIME_WINDOW_PRESETS = [
  { label: 'All inbox', days: null as number | null },
  { label: '30 days+', days: 30 },
  { label: '3 months+', days: 90 },
  { label: '6 months+', days: 180 },
  { label: '1 year+', days: 365 },
] as const;

/**
 * Real archive preview (D226). Carried alongside the request shape so
 * the modal can state the REAL inbox-now count for the single-sender
 * Archive path. Kept for backwards compatibility; the composite preview
 * supersedes it on every Senders surface.
 */
export interface ArchivePreviewState {
  inboxCount: number | undefined;
  loading: boolean;
  error: boolean;
}

/**
 * Aggregated multi-sender preview state (D52). Drives the chip-row
 * bucket counts, the headline figure, and the per-sender breakdown for
 * a bulk action. `loading` gates confirm exactly like the single-sender
 * preview; `error` blocks Delete confirm (D226 preview mandate).
 */
export interface BulkPreviewState {
  data: BulkActionPreviewResult | undefined;
  loading: boolean;
  error: boolean;
}

/**
 * Pick the right bucket count from the composite preview for a given
 * `olderThanDays`. Keeps the summary line + confirm button in step with
 * the active chip without a round-trip per chip.
 */
function pickBucketCount(
  counts: CompositeActionPreviewResult['counts'] | undefined,
  olderThanDays: number | null,
): number | undefined {
  if (!counts) return undefined;
  if (olderThanDays === null) return counts.all;
  if (olderThanDays === 30) return counts.olderThan30d;
  if (olderThanDays === 90) return counts.olderThan90d;
  if (olderThanDays === 180) return counts.olderThan180d;
  if (olderThanDays === 365) return counts.olderThan365d;
  // Custom value (post-launch) — fall back to `all` until the
  // server-side on-demand bucket query lands (Phase 1 BE PR-N polish).
  return counts.all;
}

/**
 * Mirror of `pickBucketCount` for the "Show what will move" recent-
 * subjects panel (spec v1.3 — recent beats oldest for 3-sec sender
 * recognition). Returns the BE-returned top-5 subjects for the chip
 * the user has selected; `undefined` while the preview is in flight
 * (the disclosure renders nothing until real data lands — §10).
 */
function pickBucketSubjects(
  buckets: CompositeActionPreviewResult['recentSubjects'] | undefined,
  olderThanDays: number | null,
): string[] | undefined {
  if (!buckets) return undefined;
  if (olderThanDays === null) return buckets.all;
  if (olderThanDays === 30) return buckets.olderThan30d;
  if (olderThanDays === 90) return buckets.olderThan90d;
  if (olderThanDays === 180) return buckets.olderThan180d;
  if (olderThanDays === 365) return buckets.olderThan365d;
  return buckets.all;
}

/** Default time-window per primary verb (spec v1.2 Decision 15 table). */
function defaultWindow(verb: ActionVerb): number | null {
  return verb === 'Delete' ? 180 : null;
}

/**
 * Verb → confirm-button emoji glyph. Spec v1.2 Decision 15 confirm
 * button copy: `📥 Archive 47` / `🗑 Delete 125` / `🚫 Unsubscribe` etc.
 * Kept letter-free per ADR-0019 §3.1 (shortcut chip carries the letter).
 */
const VERB_GLYPH: Partial<Record<ActionVerb, string>> = {
  Archive: '📥',
  Delete: '🗑',
  Unsubscribe: '🚫',
  Later: '⏰',
};

/**
 * The mandatory action preview (D226). No bulk mutation runs without
 * this confirm — it states exactly what changes and how much mail it
 * touches before anything happens. PR-FE3 (spec v1.2 Decision 15)
 * adds: Delete primary (red tone + 30-day recovery banner), composite
 * secondary chip row on Unsub/Later, "Show what will move" expand
 * panel, and per-bucket count preview via the composite endpoint.
 */
export function ConfirmActionModal({
  request,
  onCancel,
  onConfirm,
  archivePreview,
  compositePreview,
  compositePreviewLoading,
  compositePreviewError,
  bulkPreview,
  onRetryPreview,
}: {
  request: ActionRequest | null;
  onCancel: () => void;
  onConfirm: (opts: ConfirmOptions) => void;
  /**
   * Legacy single-sender archive count — superseded by `compositePreview`
   * on the senders surface; retained for triage's tracer integration.
   */
  archivePreview?: ArchivePreviewState | undefined;
  /**
   * Composite preview (ADR-0020). Drives the sender context strip's real
   * domain/monthly/lastSeenDays values + the per-bucket counts the chip
   * row displays. Single-sender path only — absent for bulk flows.
   */
  compositePreview?: CompositeActionPreviewResult | undefined;
  /** Composite preview is still resolving; confirmation remains unavailable. */
  compositePreviewLoading?: boolean | undefined;
  /**
   * Composite-preview fetch error — surfaces when the BE preview call
   * failed. Any action that moves existing mail MUST disable confirm so
   * the user cannot proceed past D226's preview mandate (silent-failure-hunter
   * 2026-06-05: a sustained 5xx during composite preview left confirm
   * enabled with `compositeCount === undefined`).
   */
  compositePreviewError?: boolean | undefined;
  /**
   * Aggregated multi-sender preview (D52). Present only for bulk
   * (>1 sender) flows — supplies the chip-row bucket totals, the
   * headline figure, and the per-sender breakdown list.
   */
  bulkPreview?: BulkPreviewState | undefined;
  /** Re-run the live preview after a failed read. */
  onRetryPreview?: (() => void) | undefined;
}) {
  const verb = request?.verb;
  // Composite secondary (chip row) — applies only on Unsubscribe + Later
  // primary. `null` = "Leave alone" (the default — keeps the modal
  // non-destructive for first-time openers).
  const [secondaryVerb, setSecondaryVerb] = useState<ConfirmSecondaryVerb>(null);
  // Time-window filter for the historic-scope verb (archive/delete
  // primary OR the active secondary).
  const [olderThanDays, setOlderThanDays] = useState<number | null>(null);
  const [wakeAt, setWakeAt] = useState<string | null>(null);
  // "Show what will move" expand panel state (spec v1.2 Decision 15).
  const [showSubjects, setShowSubjects] = useState(false);
  // Per-sender breakdown expand state (D52 — "Per-sender breakdown"
  // expandable list for verification on bulk flows).
  const [showAllSenders, setShowAllSenders] = useState(false);

  useEffect(() => {
    if (!request) return;
    setSecondaryVerb(null);
    setOlderThanDays(defaultWindow(request.verb));
    setWakeAt(request.verb === 'Later' ? defaultLaterWakeAtIso() : null);
    setShowSubjects(false);
    setShowAllSenders(false);
  }, [request]);

  // The historic-bucket count for the current chip selection — used by
  // the summary line + confirm button + "Show what will move" header.
  const isArchiveVerb = verb === 'Archive';
  const isDeleteVerb = verb === 'Delete';
  const isUnsubVerb = verb === 'Unsubscribe';
  const isLaterVerb = verb === 'Later';
  // Primary verbs that act on existing inbox mail in a time-window. The
  // chip row is visible only for these; Unsub/Later primaries delegate
  // the "how far back" decision to the secondary chip row instead.
  const primaryActsOnInbox = isArchiveVerb || isDeleteVerb;
  // Whether the secondary chip row is shown (Unsub or Later primary).
  const showSecondaryRow = isUnsubVerb || isLaterVerb;
  const hasSecondaryAction = showSecondaryRow && secondaryVerb !== null;

  // For Archive/Delete primary the time-window applies to the primary
  // verb itself. For Unsub/Later with a non-null secondary, the
  // time-window applies to the secondary's historic mail.
  const showWindowRow = primaryActsOnInbox || hasSecondaryAction;

  // Multi-sender bulk (D52) — the aggregated preview replaces the
  // single-sender composite preview as the bucket-count source. The
  // confirm-gating rules below are IDENTICAL across both shapes.
  const isBulk = (request?.senders.length ?? 0) > 1;
  const bucketCounts = isBulk ? bulkPreview?.data?.totals : compositePreview?.counts;

  // Preview bucket count under the current chip selection.
  const compositeCount = pickBucketCount(bucketCounts, olderThanDays);
  const previewLoading = isBulk
    ? (bulkPreview?.loading ?? false)
    : Boolean(compositePreviewLoading || archivePreview?.loading);
  const inboxNow = isBulk
    ? bulkPreview?.data?.totals.all
    : archivePreview != null && !previewLoading && !archivePreview.error
      ? archivePreview.inboxCount
      : (compositePreview?.counts?.all ?? undefined);

  // Archive is the only verb whose ENTIRE effect is moving inbox mail, so an
  // empty inbox makes it a pure no-op → block confirm. Delete primary
  // follows the same rule (no inbox mail in window = nothing to delete).
  const nothingToActOn =
    (isArchiveVerb && inboxNow === 0) ||
    (isDeleteVerb && (compositeCount === 0 || (compositeCount === undefined && inboxNow === 0)));
  // Every mail-changing action requires a successful live preview.
  // Never fall back to historic/fixture estimates after a read fails.
  const previewUnavailable = isBulk
    ? (bulkPreview?.error ?? false)
    : Boolean(compositePreviewError || archivePreview?.error);
  const previewRequired = primaryActsOnInbox || isLaterVerb || hasSecondaryAction;
  const requiredPreviewUnavailable = previewRequired && previewUnavailable;
  const wakeAtInvalid = isLaterVerb && (wakeAt === null || Date.parse(wakeAt) <= Date.now());
  const confirmDisabled =
    (previewRequired && previewLoading) ||
    nothingToActOn ||
    requiredPreviewUnavailable ||
    wakeAtInvalid;

  // Derived ConfirmOptions for onConfirm — packages secondary into the
  // shape the BE composite endpoint expects.
  const buildConfirmOpts = (): ConfirmOptions => {
    const opts: ConfirmOptions = {};
    if (isLaterVerb && wakeAt !== null) opts.wakeAt = wakeAt;
    if (showWindowRow) opts.olderThanDays = olderThanDays;
    if (hasSecondaryAction) {
      opts.secondary = {
        type: secondaryVerb as 'archive' | 'delete',
        olderThanDays,
      };
    } else if (showSecondaryRow) {
      opts.secondary = null;
    }
    // Backwards-compat surface for review-session (pre-spec-v1.2).
    opts.archiveHistoric = hasSecondaryAction && secondaryVerb === 'archive';
    return opts;
  };

  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !confirmDisabled) {
        onConfirm(buildConfirmOpts());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // `buildConfirmOpts` is a stable closure over the deps below; listing
    // it would re-add the same dependencies and the linter would still
    // flag the duplicate. Listing the inputs directly keeps the surface
    // explicit and the dep set accurate.
  }, [
    request,
    secondaryVerb,
    olderThanDays,
    wakeAt,
    onCancel,
    onConfirm,
    confirmDisabled,
    showSecondaryRow,
    showWindowRow,
    hasSecondaryAction,
  ]);

  const trapRef = useFocusTrap<HTMLDivElement>(request !== null);

  if (!request) return null;

  const { senders } = request;
  const senderTotals = senders.map((s) => s.total);
  const historic = senderTotals.every((t) => t != null)
    ? senderTotals.reduce((sum, t) => sum + (t as number), 0)
    : null;
  const requestedSenderCount = senders.length;
  const selectedCount = request.selectedCount ?? requestedSenderCount;
  const skippedCount = (request.skipped?.protectedCount ?? 0) + (request.skipped?.peopleCount ?? 0);
  const eligibleCount = Math.max(0, selectedCount - skippedCount);
  const n = eligibleCount;
  const plural = n === 1 ? '' : 's';
  const subject = n === 1 ? 'this sender' : 'these senders';
  // Tone: Delete is the strongest destructive — red eyebrow + amber-red
  // recovery banner. Unsubscribe reads as destructive too (cuts future
  // mail), but moves no past mail by itself.
  const danger = isUnsubVerb || isDeleteVerb;

  const primaryVerb = isDeleteVerb
    ? 'delete'
    : isArchiveVerb
      ? 'archive'
      : isLaterVerb
        ? 'later'
        : 'unsubscribe';
  const unsubscribeChannel: UnsubscribeChannel | null = (() => {
    if (!isUnsubVerb) return null;
    const channels = new Set(
      senders.map((sender) => sender.unsubscribeMethod).filter((value) => value != null),
    );
    return channels.size === 1 ? ([...channels][0] ?? null) : null;
  })();
  const presentation = buildActionPresentation({
    verb: primaryVerb,
    liveCount: isUnsubVerb ? 0 : (compositeCount ?? inboxNow ?? null),
    planUndoDeadline: null,
    wakeAt: isLaterVerb ? wakeAt : null,
    unsubscribeChannel,
    secondaryAction:
      secondaryVerb === null ? null : { verb: secondaryVerb, liveCount: compositeCount ?? null },
  });

  const title = isDeleteVerb
    ? `Delete mail from ${n} sender${plural}`
    : isArchiveVerb
      ? `Archive mail from ${n} sender${plural}`
      : isLaterVerb
        ? `Move ${n} sender${plural} to Later`
        : `Unsubscribe from ${n} sender${plural}`;
  const lead = [actionEffectCopy(presentation.primary), presentation.secondary]
    .filter((copy): copy is string => copy !== null)
    .join(' Also: ');

  const numberStyle: CSSProperties = {
    fontFamily: font.display,
    fontSize: 22,
    fontWeight: 600,
    letterSpacing: '-0.02em',
    color: color.fg,
    fontVariantNumeric: 'tabular-nums',
  };

  // Confirm-button label — spec v1.2 Decision 15 always names the action.
  const confirmLabel = (() => {
    const primaryGlyph = VERB_GLYPH[verb!] ?? '';
    const cnt = compositeCount ?? inboxNow;
    const primaryPart =
      isArchiveVerb || isDeleteVerb
        ? `${primaryGlyph} ${verbDisplay(verb!).label}${cnt !== undefined ? ` ${cnt.toLocaleString()}` : ''}`
        : `${primaryGlyph} ${verbDisplay(verb!).label}`;
    if (!hasSecondaryAction) return primaryPart;
    const secVerb = secondaryVerb === 'archive' ? 'Archive' : 'Delete';
    const secGlyph = VERB_GLYPH[secVerb] ?? '';
    const secCnt = compositeCount;
    const secondaryPart = `${secGlyph} ${secVerb}${secCnt !== undefined ? ` ${secCnt.toLocaleString()}` : ''}`;
    return `${primaryPart} + ${secondaryPart}`;
  })();

  const recoveryCopy = recoveryFacts(presentation.primary, presentation.secondary).join(' ');

  // Subjects for the "Show what will move" panel (spec v1.3 — recent
  // beats oldest for 3-sec sender recognition). Single-sender single-
  // verb path reads top-5 from `compositePreview.recentSubjects[bucket]`;
  // falls back to the fixture pool ONLY while the preview is in flight
  // so the panel never blanks during the load flash. Bulk flow (>1
  // sender) hides the panel entirely — per-sender drilldown is a
  // separate ticket.
  //
  // The sample is trimmed to the bucket's REAL total at the source —
  // the fixture pool (and any wire drift) must never offer more rows
  // than the count it previews (live smoke 2026-06-09 saw "5 of 3").
  // 5 stays the display cap (the BE's per-bucket sample size); the
  // disclosure label and the panel rows both read THIS array so the
  // advertised count always equals what expanding shows.
  const subjectsFromWire =
    senders.length === 1
      ? pickBucketSubjects(compositePreview?.recentSubjects, olderThanDays)
      : undefined;
  // Wire subjects ONLY — no fixture fallback. Before the composite
  // preview resolves, `compositeCount` is undefined so the disclosure
  // button below never renders; a fabricated "what will move" list on
  // the D226 trust surface is worse than none (§10 no-fake-data).
  const subjectsPreview =
    senders.length === 1 ? (subjectsFromWire ?? []).slice(0, Math.min(5, compositeCount ?? 5)) : [];

  // D226 honesty — when the eligibility gate narrowed the selection
  // before this preview opened, say so: the user saw "N selected" in
  // the bar and must not wonder why the sheet covers fewer senders.
  const skippedNote = (() => {
    const skipped = request.skipped;
    if (!skipped) return null;
    const parts: string[] = [];
    if (skipped.protectedCount > 0) {
      const p = skipped.protectedCount;
      parts.push(
        `${p} protected sender${p === 1 ? '' : 's'} skipped — unprotect to include ${p === 1 ? 'it' : 'them'}`,
      );
    }
    if (skipped.peopleCount > 0) {
      const q = skipped.peopleCount;
      parts.push(
        `${q === 1 ? '1 person' : `${q} people`} skipped — Unsubscribe doesn't apply to people`,
      );
    }
    return parts.length > 0 ? parts.join(' · ') : null;
  })();

  return (
    <>
      <div
        onClick={onCancel}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(14,20,19,0.45)',
          backdropFilter: 'blur(3px)',
          zIndex: 150,
        }}
      />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dm-confirm-title"
        aria-describedby="dm-confirm-lead"
        style={{
          position: 'fixed',
          top: '12vh',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(540px, calc(100vw - 32px))',
          maxHeight: '78vh',
          overflow: 'auto',
          background: color.card,
          borderRadius: 14,
          border: `1px solid ${color.border}`,
          boxShadow: '0 24px 60px rgba(14,20,19,0.30)',
          zIndex: 151,
          fontFamily: font.sans,
        }}
      >
        <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${color.line}` }}>
          <Eyebrow tone={danger ? 'amber' : 'primary'}>Preview · before anything changes</Eyebrow>
          <h2
            id="dm-confirm-title"
            style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.014em', margin: '6px 0 0' }}
          >
            {title}
          </h2>
          {/* Sender context strip (spec v1.2 Decision 15) — facts only:
              domain · monthly volume · last seen · you replied. */}
          {senders.length === 1 && (
            <div
              style={{
                fontFamily: font.mono,
                fontSize: 11.5,
                color: color.fgMuted,
                margin: '8px 0 0',
                letterSpacing: '0.01em',
                display: 'flex',
                gap: 10,
                flexWrap: 'wrap',
                alignItems: 'baseline',
              }}
            >
              <span style={{ color: color.fgSoft }}>
                {compositePreview?.sender?.domain ?? senders[0]!.domain}
              </span>
              <span>·</span>
              <span>
                <strong style={{ color: color.fg, fontFamily: font.sans, fontWeight: 600 }}>
                  {compositePreview?.sender?.monthly ?? senders[0]!.monthly}
                </strong>{' '}
                /mo
              </span>
              <span>·</span>
              <span>
                last seen{' '}
                <strong style={{ color: color.fg, fontFamily: font.sans, fontWeight: 600 }}>
                  {(() => {
                    const days = compositePreview?.sender?.lastSeenDays ?? senders[0]!.lastDays;
                    return days === 0 ? 'today' : `${days}d`;
                  })()}
                </strong>
              </span>
              {(() => {
                const r = compositePreview?.sender?.repliedCount ?? senders[0]!.repliedCount;
                if (r === undefined || r === null || r === 0) return null;
                return (
                  <>
                    <span>·</span>
                    <span>
                      you replied{' '}
                      <strong style={{ color: color.fg, fontFamily: font.sans, fontWeight: 600 }}>
                        {r}×
                      </strong>
                    </span>
                  </>
                );
              })()}
            </div>
          )}
          <p
            id="dm-confirm-lead"
            style={{ fontSize: 13, color: color.fgSoft, margin: '10px 0 0', lineHeight: 1.5 }}
          >
            {lead}
          </p>
          {skippedNote && (
            <p
              style={{
                fontFamily: font.mono,
                fontSize: 10.5,
                color: color.fgMuted,
                letterSpacing: '0.04em',
                margin: '8px 0 0',
              }}
            >
              {skippedNote}
            </p>
          )}
          {request.selectedCount !== undefined && (selectedCount > 1 || skippedCount > 0) && (
            <p
              aria-label="Bulk action scope"
              style={{
                fontFamily: font.mono,
                fontSize: 10.5,
                color: color.fgMuted,
                letterSpacing: '0.04em',
                margin: '8px 0 0',
              }}
            >
              {selectedCount} selected · {eligibleCount} eligible · {skippedCount} skipped
            </p>
          )}
        </div>

        {/* Recovery copy is generated from the canonical semantics for
            both primary and optional secondary actions. */}
        {recoveryCopy && (
          <div
            role="status"
            style={{
              margin: '12px 24px 0',
              padding: '8px 12px',
              borderRadius: 8,
              background: isDeleteVerb ? 'rgba(196,46,46,0.06)' : color.paper,
              border: `1px solid ${isDeleteVerb ? 'rgba(196,46,46,0.30)' : color.line}`,
              fontSize: 12,
              color: isDeleteVerb ? color.danger : color.fgSoft,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span aria-hidden style={{ fontSize: 13 }}>
              ⏱
            </span>
            <span>{recoveryCopy}</span>
          </div>
        )}

        <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {isLaterVerb && wakeAt !== null && (
            <label
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                fontSize: 12.5,
                color: color.fgSoft,
              }}
            >
              <span style={{ fontWeight: 600, color: color.fg }}>Return to Inbox</span>
              <input
                type="datetime-local"
                value={toLocalDateTimeInput(wakeAt)}
                min={toLocalDateTimeInput(new Date(Date.now() + 60_000).toISOString())}
                onChange={(event) => {
                  const next = new Date(event.currentTarget.value);
                  setWakeAt(Number.isNaN(next.getTime()) ? null : next.toISOString());
                }}
                aria-label="Later return time"
                style={{
                  border: `1px solid ${color.line}`,
                  borderRadius: 8,
                  padding: '8px 10px',
                  background: color.card,
                  color: color.fg,
                  fontFamily: font.sans,
                  fontSize: 13,
                }}
              />
            </label>
          )}
          {/* Per-sender breakdown (D52) — each lozenge carries the REAL
              count for the active time-window from the aggregated
              preview; protected senders are flagged (the BE skips them).
              The "+N more" toggle expands the full list for verification. */}
          {senders.length > 1 &&
            (() => {
              const breakdownById = new Map(
                (bulkPreview?.data?.senders ?? []).map((s) => [s.senderId, s] as const),
              );
              const visible = showAllSenders ? senders : senders.slice(0, 6);
              const protectedCount = bulkPreview?.data?.protectedCount ?? 0;
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 6,
                    }}
                  >
                    {visible.map((s) => {
                      const row = breakdownById.get(s.id);
                      const n = row ? pickBucketCount(row.counts, olderThanDays) : undefined;
                      return (
                        <span
                          key={s.id}
                          style={{
                            fontFamily: font.mono,
                            fontSize: 11,
                            color: color.fgSoft,
                            background: color.paper,
                            border: `1px solid ${color.line}`,
                            borderRadius: 6,
                            padding: '3px 8px',
                          }}
                        >
                          {s.name}
                          {row?.protected ? (
                            <span style={{ color: color.fgMuted }}> · protected</span>
                          ) : (
                            n !== undefined && (
                              <span
                                style={{
                                  color: color.fg,
                                  fontVariantNumeric: 'tabular-nums',
                                }}
                              >
                                {' '}
                                · {n.toLocaleString()}
                              </span>
                            )
                          )}
                        </span>
                      );
                    })}
                    {senders.length > 6 && (
                      <button
                        type="button"
                        onClick={() => setShowAllSenders((v) => !v)}
                        aria-expanded={showAllSenders}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          padding: 0,
                          cursor: 'pointer',
                          fontFamily: font.mono,
                          fontSize: 11,
                          color: color.fgMuted,
                          alignSelf: 'center',
                          letterSpacing: '0.04em',
                        }}
                      >
                        {showAllSenders ? 'show fewer ▴' : `+${senders.length - 6} more ▾`}
                      </button>
                    )}
                  </div>
                  {protectedCount > 0 && (
                    <span
                      style={{
                        fontFamily: font.mono,
                        fontSize: 10.5,
                        color: color.fgMuted,
                        letterSpacing: '0.04em',
                      }}
                    >
                      {protectedCount} protected sender{protectedCount === 1 ? '' : 's'} won&apos;t
                      be touched.
                    </span>
                  )}
                </div>
              );
            })()}

          {/* Time-window chip row (spec v1.2 Decision 15). Visible when
              the action acts on historic mail — Archive/Delete primary
              OR the active secondary historic action. */}
          {showWindowRow && (
            <div
              role="radiogroup"
              aria-label="How far back to act on"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div
                style={{
                  fontFamily: font.mono,
                  fontSize: 10,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: color.fgMuted,
                }}
              >
                How far back
              </div>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 6,
                }}
              >
                {TIME_WINDOW_PRESETS.map((preset) => {
                  const active = olderThanDays === preset.days;
                  const bucketCount = pickBucketCount(bucketCounts, preset.days);
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setOlderThanDays(preset.days)}
                      style={{
                        fontFamily: font.sans,
                        fontSize: 12.5,
                        fontWeight: 500,
                        padding: '6px 12px',
                        borderRadius: 999,
                        background: active ? color.fg : 'transparent',
                        color: active ? color.fgInverse : color.fgSoft,
                        border: `1px solid ${active ? color.fg : color.line}`,
                        cursor: 'pointer',
                        transition: 'background 120ms, color 120ms',
                      }}
                    >
                      {preset.label}
                      {bucketCount !== undefined && (
                        <span
                          style={{
                            marginLeft: 6,
                            fontVariantNumeric: 'tabular-nums',
                            opacity: active ? 0.85 : 0.7,
                          }}
                        >
                          {bucketCount.toLocaleString()}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Composite secondary chip row (spec v1.2 Decision 15). Shown
              for Unsub + Later primary — "ALSO ACT ON PAST EMAILS":
              [Leave alone | Archive them | Delete them]. */}
          {showSecondaryRow && (
            <div
              role="radiogroup"
              aria-label="Also act on past emails"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div
                style={{
                  fontFamily: font.mono,
                  fontSize: 10,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: color.fgMuted,
                }}
              >
                Also act on past emails
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {(
                  [
                    { value: null as ConfirmSecondaryVerb, label: 'Leave alone' },
                    { value: 'archive' as ConfirmSecondaryVerb, label: 'Archive them' },
                    { value: 'delete' as ConfirmSecondaryVerb, label: 'Delete them' },
                  ] as const
                ).map((opt) => {
                  const active = secondaryVerb === opt.value;
                  return (
                    <button
                      key={opt.label}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setSecondaryVerb(opt.value)}
                      style={{
                        fontFamily: font.sans,
                        fontSize: 12.5,
                        fontWeight: 500,
                        padding: '6px 12px',
                        borderRadius: 999,
                        background: active
                          ? opt.value === 'delete'
                            ? color.danger
                            : color.fg
                          : 'transparent',
                        color: active ? color.fgInverse : color.fgSoft,
                        border: `1px solid ${active ? (opt.value === 'delete' ? color.danger : color.fg) : color.line}`,
                        cursor: 'pointer',
                        transition: 'background 120ms, color 120ms',
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Summary line + "Show what will move" expand (spec v1.2 Decision 15). */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              padding: '12px 14px',
              background: color.paper,
              border: `1px solid ${color.line}`,
              borderRadius: 9,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              {(() => {
                // Headline figure resolution order:
                //   1. composite per-bucket count (most accurate)
                //   2. legacy archivePreview (single-sender archive path)
                //   3. historic total (bulk + no preview)
                //   4. fallback qualitative copy
                if (compositeCount !== undefined) {
                  if (primaryActsOnInbox) {
                    return (
                      <>
                        <strong style={numberStyle}>{compositeCount.toLocaleString()}</strong>
                        <span style={{ fontSize: 12.5, color: color.fgSoft }}>
                          email{compositeCount === 1 ? '' : 's'}{' '}
                          {isDeleteVerb ? 'will move to Trash' : 'will move to Archive'}
                          {olderThanDays !== null
                            ? ` (older than ${olderThanDays} day${olderThanDays === 1 ? '' : 's'})`
                            : ''}
                          .
                        </span>
                      </>
                    );
                  }
                  if (hasSecondaryAction) {
                    return (
                      <>
                        <strong style={numberStyle}>{compositeCount.toLocaleString()}</strong>
                        <span style={{ fontSize: 12.5, color: color.fgSoft }}>
                          email{compositeCount === 1 ? '' : 's'} will{' '}
                          {secondaryVerb === 'delete' ? 'move to Trash' : 'archive'}
                          {olderThanDays !== null
                            ? ` (older than ${olderThanDays} day${olderThanDays === 1 ? '' : 's'})`
                            : ''}
                          .
                        </span>
                      </>
                    );
                  }
                }
                if (
                  isArchiveVerb &&
                  archivePreview != null &&
                  !previewLoading &&
                  !archivePreview.error &&
                  archivePreview.inboxCount !== undefined
                ) {
                  if (archivePreview.inboxCount === 0) {
                    return (
                      <span style={{ fontSize: 12.5, color: color.fgSoft }}>
                        No mail from this sender is in your inbox right now — nothing to archive.
                      </span>
                    );
                  }
                  return (
                    <>
                      <strong style={numberStyle}>
                        {archivePreview.inboxCount.toLocaleString()}
                      </strong>
                      <span style={{ fontSize: 12.5, color: color.fgSoft }}>
                        email{archivePreview.inboxCount === 1 ? '' : 's'} from this sender{' '}
                        {archivePreview.inboxCount === 1 ? 'is' : 'are'} in your inbox now.
                      </span>
                    </>
                  );
                }
                if (
                  isArchiveVerb &&
                  archivePreview != null &&
                  !previewLoading &&
                  (archivePreview.error || archivePreview.inboxCount === undefined)
                ) {
                  return (
                    <span style={{ fontSize: 12.5, color: color.fgSoft }}>
                      Couldn’t check how much is in your inbox — we’ll archive whatever’s there from
                      this sender.
                    </span>
                  );
                }
                if (previewLoading) {
                  return (
                    <span style={{ fontSize: 12.5, color: color.fgSoft }}>
                      Checking how much mail from {subject} is in your inbox…
                    </span>
                  );
                }
                if (isUnsubVerb && !hasSecondaryAction) {
                  const channel = presentation.primary.unsubscribeChannel;
                  return (
                    <span style={{ fontSize: 12.5, color: color.fgSoft }}>
                      {presentation.primary.currentMail.summary}{' '}
                      {channel.kind === 'not-applicable'
                        ? presentation.primary.futureMail.summary
                        : channel.summary}
                    </span>
                  );
                }
                if (isLaterVerb && !hasSecondaryAction) {
                  return (
                    <span style={{ fontSize: 12.5, color: color.fgSoft }}>
                      {presentation.primary.currentMail.summary}{' '}
                      {presentation.primary.schedule.kind === 'scheduled'
                        ? presentation.primary.schedule.summary
                        : presentation.primary.schedule.kind === 'required'
                          ? presentation.primary.schedule.summary
                          : null}
                    </span>
                  );
                }
                if (historic != null) {
                  return (
                    <>
                      <strong style={numberStyle}>{historic.toLocaleString()}</strong>
                      <span style={{ fontSize: 12.5, color: color.fgSoft }}>
                        email{historic === 1 ? '' : 's'} received from {subject} in total.
                      </span>
                    </>
                  );
                }
                return (
                  <span style={{ fontSize: 12.5, color: color.fgSoft }}>
                    Only matching mail currently in your inbox is included.
                  </span>
                );
              })()}
            </div>

            {/* Show what will move (5 of N) ▾ — privacy-safe subjects panel.
                Only shown for single-sender flows where the "subjects pool"
                stub is meaningful; bulk flows would need a per-sender
                drilldown that lands separately. */}
            {senders.length === 1 && (compositeCount ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => setShowSubjects((v) => !v)}
                aria-expanded={showSubjects}
                style={{
                  alignSelf: 'flex-start',
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  fontFamily: font.mono,
                  fontSize: 11,
                  color: color.fgMuted,
                  letterSpacing: '0.04em',
                }}
              >
                {showSubjects
                  ? 'Hide what will move ▴'
                  : `Show what will move (${subjectsPreview.length.toLocaleString()} of ${(compositeCount ?? 0).toLocaleString()}) ▾`}
              </button>
            )}
            {showSubjects && subjectsPreview.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  padding: '8px 10px',
                  background: color.card,
                  border: `1px solid ${color.line}`,
                  borderRadius: 6,
                  marginTop: 4,
                }}
              >
                {subjectsPreview.map((s, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      gap: 8,
                      alignItems: 'baseline',
                      fontFamily: font.mono,
                      fontSize: 11.5,
                      color: color.fgSoft,
                    }}
                  >
                    <span style={{ width: 18, color: color.fgMuted }}>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span style={{ color: color.fg }}>{s}</span>
                  </div>
                ))}
                <div
                  style={{
                    marginTop: 6,
                    paddingTop: 6,
                    borderTop: `1px dashed ${color.line}`,
                    fontFamily: font.mono,
                    fontSize: 10.5,
                    color: color.fgMuted,
                    letterSpacing: '0.04em',
                  }}
                >
                  Subjects only · we never read email bodies
                </div>
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '14px 24px 18px',
            borderTop: `1px solid ${color.line}`,
          }}
        >
          <span
            style={{
              fontSize: 11.5,
              color: requiredPreviewUnavailable ? color.amber : color.fgMuted,
              fontWeight: requiredPreviewUnavailable ? 600 : 400,
            }}
          >
            {requiredPreviewUnavailable
              ? "Couldn't load the live preview. Nothing has changed; retry before confirming."
              : (recoveryCopy ?? '')}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {requiredPreviewUnavailable && onRetryPreview && (
              <Button tone="default" onClick={onRetryPreview}>
                Retry preview
              </Button>
            )}
            <Button
              tone="default"
              onClick={onCancel}
              iconRight={<Kbd style={{ fontSize: 9, color: color.fgMuted }}>Esc</Kbd>}
            >
              Cancel
            </Button>
            <Button
              // Delete-tone CTA fill is one of the three sanctioned
              // `color.danger` uses (ADR-0019 §accent) — amber stays
              // Unsubscribe's tone (ADR-0016 A5).
              tone={isDeleteVerb ? 'danger' : danger ? 'warn' : 'primary'}
              disabled={confirmDisabled}
              onClick={() => onConfirm(buildConfirmOpts())}
              iconRight={
                <Kbd
                  style={{ background: color.lineInverse, border: 'none', color: color.fgInverse }}
                >
                  ⌘⏎
                </Kbd>
              }
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

function actionEffectCopy(action: PresentedAction | null): string | null {
  if (action === null) return null;
  const future =
    action.unsubscribeChannel.kind === 'not-applicable'
      ? action.futureMail.summary
      : action.unsubscribeChannel.summary;
  return [
    action.currentMail.summary,
    future,
    ...action.unchanged,
    ...(action.schedule.kind === 'none' ? [] : [action.schedule.summary]),
  ].join(' ');
}

function recoveryFacts(primary: PresentedAction, secondary: PresentedAction | null): string[] {
  return [
    ...new Set(
      [primary, secondary]
        .filter((action): action is PresentedAction => action !== null)
        .flatMap((action) => [
          action.activityUndo.summary,
          ...(action.providerRecovery.kind === 'none' ? [] : [action.providerRecovery.summary]),
          ...(action.finality.kind === 'reversible-or-changeable' ? [] : [action.finality.summary]),
        ]),
    ),
  ];
}

function toLocalDateTimeInput(iso: string): string {
  const date = new Date(iso);
  const two = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`;
}
