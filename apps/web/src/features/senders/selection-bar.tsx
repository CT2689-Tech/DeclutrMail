'use client';

import Link from 'next/link';

import { tokens } from '@declutrmail/shared';
import type { TierId } from '@declutrmail/shared/entitlements';
import { floatingSurfaceLayout } from '@/lib/ui/floating-surface-layout';

import {
  canUseActionSelector,
  multiSenderPlanName,
  canBulkArchive,
  canBulkDelete,
  canBulkLater,
  canBulkUnsubscribe,
  isStandingProtected,
  verbDisplay,
  type ActionVerb,
  type Sender,
} from './data';

const { color, font } = tokens;

/** The bulk verbs the bar offers (D52 + ADR-0019 K/A/U/L/D order). */
export type SelectionBarVerb = Extract<
  ActionVerb,
  'Keep' | 'Archive' | 'Unsubscribe' | 'Later' | 'Delete'
>;

/** Sticky bulk-action bar — appears while one or more senders are checked. */
export function SelectionBar({
  senders,
  onClear,
  onAct,
  tier,
  busy = false,
  variant = 'bar',
}: {
  senders: Sender[];
  onClear: () => void;
  onAct: (verb: SelectionBarVerb) => void;
  /** Workspace tier; selector access is resolved from ACTION_REGISTRY. */
  tier: TierId;
  /**
   * True while a bulk enqueue is in flight (D52). Disables every verb
   * button so a slow round-trip can't double-fire; the selection stays
   * visible until the server confirms.
   */
  busy?: boolean;
  /**
   * D54 (ADR-0018) — 'sheet' renders the same verb set as a full-width
   * stacked list for the phone `SelectionFab`'s bottom sheet, instead of
   * the desktop's sticky horizontal bar (five inline buttons don't fit
   * a 375px viewport). Business logic (eligibility, entitlement, counts)
   * is identical either way.
   */
  variant?: 'bar' | 'sheet';
}) {
  if (senders.length === 0) return null;

  const eligible = {
    // Keep is a standing-policy write (D40) — non-destructive, so every
    // selected sender is eligible (protected senders included).
    Keep: senders.length,
    // D245 — bulk EXCLUDES protected senders. Must read the `canBulk*`
    // predicates, never the bare `can*` ones (which carry no protection
    // term because explicit single-sender intent is not bulk).
    Archive: senders.filter(canBulkArchive).length,
    Later: senders.filter(canBulkLater).length,
    Unsubscribe: senders.filter(canBulkUnsubscribe).length,
    Delete: senders.filter(canBulkDelete).length,
  };
  const selector = senders.length > 1 ? 'multi-sender' : 'sender';
  const multiSenderLocked =
    selector === 'multi-sender' && !canUseActionSelector(tier, 'Archive', selector);

  const multiSenderNote = multiSenderLocked ? (
    <span
      role="note"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        color: color.fgInverseSoft,
        fontSize: 12,
      }}
    >
      Multi-sender actions require {multiSenderPlanName()}.
      <Link
        href="/billing"
        style={{ color: color.fgInverse, fontWeight: 700, textUnderlineOffset: 3 }}
      >
        See plans
      </Link>
    </span>
  ) : null;

  // QA-senders-20260901-08: every destructive verb button already carries
  // the "protected senders are excluded" reason in its `title`/aria-label,
  // but a disabled `<button>` never fires `onClick` — so a mouse user who
  // doesn't hover sees 4 greyed buttons and no reason at all. Standing
  // protection is the only thing that can zero out Archive/Later/Delete
  // together (Unsubscribe alone can also drop to 0 for non-protected
  // "people" senders — canUnsubscribe's own rule — so it's excluded from
  // this check).
  const allProtected = senders.every(isStandingProtected);
  const protectedLockNote = (dark: boolean) =>
    allProtected ? (
      <span role="note" style={{ color: dark ? color.fgInverseSoft : color.fgSoft, fontSize: 12 }}>
        {senders.length === 1
          ? `${senders[0]!.name} is protected — unprotect it first`
          : `All ${senders.length} are protected — unprotect to include them`}
      </span>
    ) : null;

  const verbButton = (verb: SelectionBarVerb, stretch: boolean) => {
    const n = eligible[verb];
    const entitled = canUseActionSelector(tier, verb, selector);
    const disabled = n === 0 || busy || !entitled;
    const primary = verb === 'Unsubscribe';
    // Delete carries the destructive treatment — same `color.danger`
    // the single-sender Delete confirm uses (spec v1.2 Decision 1).
    const danger = verb === 'Delete';
    // Label + shortcut from the Action Registry (ADR-0015) — the
    // shortcut stays invisible inline (§3.1), surfaced only via the
    // hover tooltip + the `?` cheatsheet. `aria-keyshortcuts` advertises
    // the binding the senders-screen handler honors for the selection.
    const { label, shortcut } = verbDisplay(verb);
    // The number is SENDERS, never emails — the D226 preview modal
    // is what counts emails (finding 5.13). When protection (D245)
    // excludes some of the selection, say "n of m" so the shrink is
    // visible instead of reading like a different count of the same
    // thing.
    const countLabel = n === senders.length ? `${n}` : `${n} of ${senders.length}`;
    const unitTitle =
      n === senders.length
        ? `${label} ${n} sender${n === 1 ? '' : 's'}`
        : `${label} ${n} of ${senders.length} selected senders (protected senders are excluded from bulk actions)`;
    return (
      <button
        key={verb}
        onClick={() => !disabled && onAct(verb)}
        disabled={disabled}
        aria-label={unitTitle}
        title={
          !entitled
            ? `${label} — ${multiSenderPlanName()} required for multi-sender actions`
            : shortcut
              ? `${unitTitle} (${shortcut})`
              : unitTitle
        }
        aria-keyshortcuts={entitled ? (shortcut ?? undefined) : undefined}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: stretch ? 'space-between' : undefined,
          gap: 6,
          height: stretch ? 44 : 32,
          padding: stretch ? '0 16px' : '0 14px',
          width: stretch ? '100%' : undefined,
          background: danger ? color.danger : primary ? color.amber : color.lineInverse,
          color: color.fgInverse,
          border: `1px solid ${danger ? color.danger : primary ? color.amber : color.lineInverse}`,
          borderRadius: stretch ? 10 : 7,
          fontFamily: font.sans,
          fontSize: stretch ? 14 : 12.5,
          fontWeight: 600,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.4 : 1,
        }}
      >
        {label}
        <span style={{ fontFamily: font.mono, fontSize: stretch ? 12 : 11, opacity: 0.8 }}>
          {countLabel}
        </span>
      </button>
    );
  };

  if (variant === 'sheet') {
    return (
      <div
        data-dm-selection-bar="sheet"
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <strong
            style={{
              fontFamily: font.mono,
              fontSize: 16,
              fontWeight: 700,
              color: color.fg,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {senders.length}
          </strong>
          <span style={{ fontSize: 13.5, color: color.fgSoft, flex: 1 }}>
            sender{senders.length === 1 ? '' : 's'} selected
          </span>
          <button
            onClick={onClear}
            style={{
              background: 'transparent',
              border: `1px solid ${color.line}`,
              borderRadius: 7,
              padding: '6px 12px',
              color: color.fgSoft,
              fontFamily: font.mono,
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              cursor: 'pointer',
            }}
          >
            Clear selection
          </button>
        </div>
        {multiSenderNote}
        {protectedLockNote(false)}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(['Keep', 'Archive', 'Unsubscribe', 'Later', 'Delete'] as const).map((verb) =>
            verbButton(verb, true),
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      data-dm-selection-bar
      style={{
        position: 'sticky',
        bottom: floatingSurfaceLayout.selectionBarBottom,
        height: floatingSurfaceLayout.selectionBarHeight,
        flexShrink: 0,
        boxSizing: 'border-box',
        zIndex: floatingSurfaceLayout.selectionBarZIndex,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '10px 12px 10px 18px',
        background: color.fg,
        borderRadius: 12,
        boxShadow: '0 14px 34px -10px rgba(0,0,0,0.45)',
      }}
    >
      <span
        style={{ display: 'inline-flex', alignItems: 'center', gap: 10, color: color.fgInverse }}
      >
        <strong
          style={{
            fontFamily: font.mono,
            fontSize: 13,
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {senders.length}
        </strong>
        <span style={{ fontSize: 12.5, color: color.fgInverseSoft }}>
          sender{senders.length === 1 ? '' : 's'} selected
        </span>
        <button
          onClick={onClear}
          style={{
            background: 'transparent',
            border: 'none',
            color: color.fgInverseMuted,
            fontFamily: font.mono,
            fontSize: 10.5,
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            cursor: 'pointer',
          }}
        >
          Clear
        </button>
      </span>

      <span style={{ flex: 1 }} />

      {multiSenderNote}
      {protectedLockNote(true)}

      {(['Keep', 'Archive', 'Unsubscribe', 'Later', 'Delete'] as const).map((verb) =>
        verbButton(verb, false),
      )}
    </div>
  );
}
