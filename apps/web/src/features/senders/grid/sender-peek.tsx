'use client';

/**
 * SenderPeek — the grid's answer to the table's expand-row (grid↔table
 * parity, 2026-07-03). The table reveals `SenderRowDetailLive`
 * (12-month volume + recent subjects + verb row) inline under the row;
 * cards had NO path to that data. This dialog renders the SAME
 * component, so the two views expose identical facts by construction.
 *
 * Also the mobile story: below `sm` the screen force-renders Grid
 * (D49 — no table on phones), so this sheet is how a phone reaches
 * the rich per-sender panel at all. Small viewports get a bottom
 * sheet; desktop gets a centered dialog.
 *
 * Rendering: portal to <body> — the card applies a hover transform
 * (data-dm-lift), and a transformed ancestor becomes the containing
 * block for `position: fixed`, which would pin the dialog to the card.
 *
 * A11y: real dialog semantics (role, aria-modal, labelled by the
 * sender name), shared `useFocusTrap` (Tab cycles inside, focus
 * restores on close), Escape + backdrop click close. The opener is a
 * dedicated control on the card — never a clickable-row wrapper
 * (matches the table's chevron contract, sender-table.tsx §2).
 */

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { Avatar, tokens, useFocusTrap, useIsAtMost } from '@declutrmail/shared';
import { SenderRowDetailLive } from '../table/sender-row-detail';
import type { ActionRequest, Sender } from '../data';

const { color, font, radius } = tokens;

export function SenderPeek({
  sender,
  onAction,
  onClose,
}: {
  sender: Sender;
  onAction: (req: ActionRequest) => void;
  onClose: () => void;
}) {
  const isMobile = useIsAtMost('sm');
  const trapRef = useFocusTrap<HTMLDivElement>(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 90,
        background: 'var(--dm-scrim)',
        display: 'flex',
        alignItems: isMobile ? 'flex-end' : 'center',
        justifyContent: 'center',
        padding: isMobile ? 0 : 20,
      }}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${sender.name} — recent activity`}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: color.card,
          border: `1px solid ${color.line}`,
          borderRadius: isMobile ? `${radius.lg}px ${radius.lg}px 0 0` : radius.lg,
          boxShadow: tokens.shadow.pop,
          width: isMobile ? '100%' : 'min(680px, 92vw)',
          maxHeight: isMobile ? '82vh' : '84vh',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header — identity + full-page link + close. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '14px 16px',
            borderBottom: `1px solid ${color.lineSoft}`,
            position: 'sticky',
            top: 0,
            background: color.card,
            zIndex: 1,
          }}
        >
          <Avatar name={sender.name} domain={sender.domain} size={32} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontFamily: font.sans,
                fontSize: 14,
                fontWeight: 600,
                color: color.fg,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {sender.name}
            </div>
            <div
              style={{
                fontFamily: font.mono,
                fontSize: 10.5,
                color: color.fgMuted,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {sender.domain}
            </div>
          </div>
          <Link
            href={`/senders/${sender.id}`}
            style={{
              fontFamily: font.mono,
              fontSize: 11,
              letterSpacing: '0.04em',
              color: color.primary,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            Full page →
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 28,
              height: 28,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: `1px solid ${color.line}`,
              borderRadius: 7,
              color: color.fgSoft,
              cursor: 'pointer',
              fontSize: 14,
              lineHeight: 1,
              padding: 0,
            }}
          >
            ×
          </button>
        </div>

        {/* Body — the SAME live panel the table's expand-row renders
            (12-month volume, recent subjects, verify-in-Gmail link,
            verb row). Fetch-on-open: mounting is what triggers the
            timeseries + messages queries, exactly like a row expand. */}
        <div style={{ padding: '4px 8px 10px' }}>
          <SenderRowDetailLive s={sender} onAction={onAction} variant="panel" />
        </div>
      </div>
    </div>,
    document.body,
  );
}
