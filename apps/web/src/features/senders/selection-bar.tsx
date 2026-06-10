'use client';

import { tokens } from '@declutrmail/shared';
import {
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
export type SelectionBarVerb = Extract<ActionVerb, 'Archive' | 'Later' | 'Unsubscribe' | 'Delete'>;

/** Sticky bulk-action bar — appears while one or more senders are checked. */
export function SelectionBar({
  senders,
  onClear,
  onAct,
  busy = false,
}: {
  senders: Sender[];
  onClear: () => void;
  onAct: (verb: SelectionBarVerb) => void;
  /**
   * True while a bulk enqueue is in flight (D52). Disables every verb
   * button so a slow round-trip can't double-fire; the selection stays
   * visible until the server confirms.
   */
  busy?: boolean;
}) {
  if (senders.length === 0) return null;

  const eligible = {
    Archive: senders.filter(canArchive).length,
    Later: senders.filter(canLater).length,
    Unsubscribe: senders.filter(canUnsubscribe).length,
    Delete: senders.filter(canDelete).length,
  };

  return (
    <div
      style={{
        position: 'sticky',
        bottom: 14,
        zIndex: 30,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '10px 12px 10px 18px',
        background: color.fg,
        borderRadius: 12,
        boxShadow: '0 14px 34px -10px rgba(0,0,0,0.45)',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, color: '#FFFFFF' }}>
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
        <span style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.7)' }}>
          sender{senders.length === 1 ? '' : 's'} selected
        </span>
        <button
          onClick={onClear}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'rgba(255,255,255,0.55)',
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

      {(['Archive', 'Later', 'Unsubscribe', 'Delete'] as const).map((verb) => {
        const n = eligible[verb];
        const disabled = n === 0 || busy;
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
            title={shortcut ? `${label} (${shortcut})` : label}
            aria-keyshortcuts={shortcut ?? undefined}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: 32,
              padding: '0 14px',
              background: danger ? color.danger : primary ? color.amber : 'rgba(255,255,255,0.10)',
              color: '#FFFFFF',
              border: `1px solid ${danger ? color.danger : primary ? color.amber : 'rgba(255,255,255,0.18)'}`,
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
