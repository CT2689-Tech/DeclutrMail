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

const { color, font, radius, shadow, text } = tokens;

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
        fontSize: text.sm,
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
      <span
        role="note"
        style={{ color: dark ? color.fgInverseSoft : color.fgSoft, fontSize: text.sm }}
      >
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
          border: 'none',
          borderRadius: radius.pill,
          fontFamily: font.sans,
          fontSize: stretch ? text.md : text.sm,
          fontWeight: 600,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.4 : 1,
        }}
      >
        {label}
        <span
          style={{
            fontSize: stretch ? text.sm : text.xs,
            fontVariantNumeric: 'tabular-nums',
            opacity: 0.8,
          }}
        >
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
              fontSize: text.lg,
              fontWeight: 600,
              color: color.fg,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {senders.length}
          </strong>
          <span style={{ fontSize: text.base, color: color.fgSoft, flex: 1 }}>
            sender{senders.length === 1 ? '' : 's'} selected
          </span>
          <button
            onClick={onClear}
            style={{
              background: color.fill,
              border: 'none',
              borderRadius: radius.pill,
              height: 32,
              padding: '0 14px',
              color: color.fgSoft,
              fontFamily: font.sans,
              fontSize: text.sm,
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
        padding: '8px 8px 8px 22px',
        background: color.fg,
        borderRadius: radius.pill,
        boxShadow: shadow.pop,
      }}
    >
      <span
        style={{ display: 'inline-flex', alignItems: 'center', gap: 10, color: color.fgInverse }}
      >
        <strong
          style={{
            fontSize: text.base,
            fontWeight: 600,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {senders.length}
        </strong>
        <span style={{ fontSize: text.sm, color: color.fgInverseSoft }}>
          sender{senders.length === 1 ? '' : 's'} selected
        </span>
        <button
          onClick={onClear}
          style={{
            background: 'transparent',
            border: 'none',
            color: color.fgInverseMuted,
            fontFamily: font.sans,
            fontSize: text.sm,
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
