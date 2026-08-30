'use client';

/**
 * D54 (ADR-0018) — the phone-width replacement for the desktop
 * `SelectionBar`. Five inline buttons plus counts do not fit a 375px
 * viewport, so mobile gets a floating "N selected" trigger that opens
 * the same verb set as a bottom-sheet stacked list instead.
 */

import { useState } from 'react';
import { BottomSheet, tokens } from '@declutrmail/shared';
import type { TierId } from '@declutrmail/shared/entitlements';
import { SelectionBar, type SelectionBarVerb } from '../selection-bar';
import type { Sender } from '../data';

const { color, font, shadow } = tokens;

export function SelectionFab({
  senders,
  onClear,
  onAct,
  tier,
  busy = false,
}: {
  senders: Sender[];
  onClear: () => void;
  onAct: (verb: SelectionBarVerb) => void;
  tier: TierId;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (senders.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${senders.length} sender${senders.length === 1 ? '' : 's'} selected — open bulk actions`}
        style={{
          position: 'fixed',
          right: 16,
          bottom: 'calc(16px + env(safe-area-inset-bottom))',
          zIndex: 130,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          height: 48,
          padding: '0 18px',
          borderRadius: 999,
          background: color.fg,
          color: color.fgInverse,
          border: 'none',
          boxShadow: shadow.pop,
          fontFamily: font.sans,
          fontSize: 14,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        <span
          style={{
            fontFamily: font.mono,
            fontVariantNumeric: 'tabular-nums',
            fontWeight: 700,
          }}
        >
          {senders.length}
        </span>
        selected
      </button>
      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        ariaLabel="Bulk actions for selected senders"
      >
        <SelectionBar
          variant="sheet"
          senders={senders}
          tier={tier}
          busy={busy}
          onClear={() => {
            setOpen(false);
            onClear();
          }}
          onAct={(verb) => {
            setOpen(false);
            onAct(verb);
          }}
        />
      </BottomSheet>
    </>
  );
}
