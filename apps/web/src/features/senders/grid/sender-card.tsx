'use client';

/**
 * `SenderCard` — one sender card on the grid view (D49).
 *
 * D49 makes grid the default Senders view; the table mode is a
 * per-session toggle. A card surfaces the same per-row decisions as
 * a table row (K/A/U/L verbs from D227) plus the recommendation
 * badge, but in a layout that reads like a curated review rather
 * than a spreadsheet.
 *
 * Privacy (D7, D228). Renders only allowlisted fields: sender name,
 * domain, monthly volume, read rate, last-seen days. Never body
 * content, attachments, or non-allowlisted headers.
 */

import type { ReactNode } from 'react';
import { Avatar, Button, tokens } from '@declutrmail/shared';
import { canArchive, canLater, canUnsubscribe, type ActionRequest, type Sender } from '../data';

const { color, font } = tokens;

const VERB_ICONS: Record<'Archive' | 'Later' | 'Unsubscribe', ReactNode> = {
  Archive: (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="21 8 21 21 3 21 3 8" />
      <rect x="1" y="3" width="22" height="5" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </svg>
  ),
  Later: (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  Unsubscribe: (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
};

export interface SenderCardProps {
  sender: Sender;
  /** Selected — controlled by parent for shift-click range + sticky bar. */
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onAction: (req: ActionRequest) => void;
}

export function SenderCard({ sender, selected, onToggleSelect, onAction }: SenderCardProps) {
  const archiveOk = canArchive(sender);
  const laterOk = canLater(sender);
  const unsubOk = canUnsubscribe(sender);

  return (
    <article
      data-testid={`sender-card-${sender.id}`}
      data-selected={selected || undefined}
      style={{
        background: color.card,
        border: `1px solid ${selected ? color.primary : color.line}`,
        borderRadius: 12,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        position: 'relative',
        transition: 'border-color 120ms',
      }}
    >
      {/* Top — avatar + name + select */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <Avatar name={sender.name} domain={sender.domain} size={36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: font.sans,
              fontSize: 14,
              fontWeight: 600,
              color: color.fg,
              letterSpacing: '-0.005em',
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
              fontSize: 11,
              color: color.fgMuted,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {sender.domain}
          </div>
        </div>
        <input
          type="checkbox"
          aria-label={`Select ${sender.name}`}
          checked={selected}
          onChange={() => onToggleSelect(sender.id)}
          style={{ cursor: 'pointer', marginTop: 4 }}
        />
      </div>

      {/* Mid — single-line stats */}
      <div
        style={{
          display: 'flex',
          gap: 14,
          fontFamily: font.mono,
          fontSize: 11,
          color: color.fgSoft,
        }}
      >
        <span>
          <strong style={{ color: color.fg, fontWeight: 600 }}>{sender.monthly}</strong> in last 30d
        </span>
        <span>
          <strong style={{ color: color.fg, fontWeight: 600 }}>
            {Math.round(sender.read * 100)}%
          </strong>{' '}
          read
        </span>
        {sender.lastDays > 0 && <span>{sender.lastDays}d ago</span>}
      </div>

      {/* Bottom — verbs */}
      <div style={{ display: 'flex', gap: 6 }}>
        <Button tone="dark" size="sm" onClick={() => onAction({ verb: 'Keep', senders: [sender] })}>
          Keep
        </Button>
        <Button
          tone="default"
          size="sm"
          disabled={!archiveOk}
          onClick={() => onAction({ verb: 'Archive', senders: [sender] })}
          iconLeft={VERB_ICONS.Archive}
        >
          Archive
        </Button>
        <Button
          tone="default"
          size="sm"
          disabled={!laterOk}
          onClick={() => onAction({ verb: 'Later', senders: [sender] })}
          iconLeft={VERB_ICONS.Later}
        >
          Later
        </Button>
        <Button
          tone="warn"
          size="sm"
          disabled={!unsubOk}
          onClick={() => onAction({ verb: 'Unsubscribe', senders: [sender] })}
          iconLeft={VERB_ICONS.Unsubscribe}
        >
          Unsub
        </Button>
      </div>
    </article>
  );
}
