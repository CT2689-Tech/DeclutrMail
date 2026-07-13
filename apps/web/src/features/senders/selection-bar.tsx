'use client';

import Link from 'next/link';

import { tokens } from '@declutrmail/shared';
import type { TierId } from '@declutrmail/shared/entitlements';
import { floatingSurfaceLayout } from '@/lib/ui/floating-surface-layout';

import {
  canUseActionSelector,
  canArchive,
  canDelete,
  canLater,
  canUnsubscribe,
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
}) {
  if (senders.length === 0) return null;

  const eligible = {
    // Keep is a standing-policy write (D40) — non-destructive, so every
    // selected sender is eligible (protected senders included).
    Keep: senders.length,
    Archive: senders.filter(canArchive).length,
    Later: senders.filter(canLater).length,
    Unsubscribe: senders.filter(canUnsubscribe).length,
    Delete: senders.filter(canDelete).length,
  };
  const selector = senders.length > 1 ? 'multi-sender' : 'sender';
  const multiSenderLocked =
    selector === 'multi-sender' && !canUseActionSelector(tier, 'Archive', selector);

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

      {multiSenderLocked ? (
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
          Multi-sender actions require Plus.
          <Link
            href="/billing"
            style={{ color: color.fgInverse, fontWeight: 700, textUnderlineOffset: 3 }}
          >
            See plans
          </Link>
        </span>
      ) : null}

      {(['Keep', 'Archive', 'Unsubscribe', 'Later', 'Delete'] as const).map((verb) => {
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
        return (
          <button
            key={verb}
            onClick={() => !disabled && onAct(verb)}
            disabled={disabled}
            title={
              !entitled
                ? `${label} — Plus required for multi-sender actions`
                : shortcut
                  ? `${label} (${shortcut})`
                  : label
            }
            aria-keyshortcuts={entitled ? (shortcut ?? undefined) : undefined}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: 32,
              padding: '0 14px',
              background: danger ? color.danger : primary ? color.amber : color.lineInverse,
              color: color.fgInverse,
              border: `1px solid ${danger ? color.danger : primary ? color.amber : color.lineInverse}`,
              borderRadius: 7,
              fontFamily: font.sans,
              fontSize: 12.5,
              fontWeight: 600,
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.4 : 1,
            }}
          >
            {label}
            <span style={{ fontFamily: font.mono, fontSize: 11, opacity: 0.8 }}>{n}</span>
          </button>
        );
      })}
    </div>
  );
}
