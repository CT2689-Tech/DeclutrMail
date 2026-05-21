'use client';

import type { MouseEvent, ReactNode } from 'react';
import { Avatar, Button, tokens } from '@declutrmail/shared';
import {
  canArchive,
  canLater,
  canUnsubscribe,
  recommendAction,
  type ActionRequest,
  type Sender,
} from '../data';
import { RowCheckbox } from './row-checkbox';
import { SenderRowDetail } from './sender-row-detail';

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
    >
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
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
    >
      <path d="M4 4h16v16H4z" />
      <polyline points="22 6 12 13 2 6" />
      <line x1="3" y1="20" x2="21" y2="4" />
    </svg>
  ),
};

function whyLine(s: Sender): string {
  const read = Math.round(s.read * 100);
  if (s.spike) return `Volume spike · ${read}% read`;
  if (read <= 5 && s.monthly >= 8) return `Almost never opened · ${read}% read`;
  if (s.lastDays > 60) return `Last opened ${Math.round(s.lastDays / 7)}w ago`;
  if (read >= 70) return `You open ${read}% — keep close`;
  if (read >= 30) return `${read}% read · steady`;
  return `${read}% read · ${s.monthly}/mo`;
}

/** One sender row in a category bloc. Click anywhere to expand the detail. */
export function SenderListRow({
  s,
  selected,
  onToggleSelect,
  expanded,
  onToggleExpand,
  onAction,
}: {
  s: Sender;
  selected: boolean;
  onToggleSelect: (evt: MouseEvent) => void;
  expanded: boolean;
  onToggleExpand: () => void;
  onAction: (req: ActionRequest) => void;
}) {
  const recommended = recommendAction(s); // "Unsubscribe" | "Later" | null
  const readPct = Math.round(s.read * 100);

  const verbs: ('Archive' | 'Later' | 'Unsubscribe')[] = [];
  if (canArchive(s)) verbs.push('Archive');
  if (canLater(s)) verbs.push('Later');
  if (canUnsubscribe(s)) verbs.push('Unsubscribe');

  return (
    <>
      <div
        onClick={onToggleExpand}
        style={{
          display: 'grid',
          gridTemplateColumns: '20px 32px minmax(0,1.7fr) minmax(0,1.1fr) 116px auto 22px',
          gap: 14,
          alignItems: 'center',
          padding: '12px 16px',
          background: expanded ? 'rgba(14,20,19,0.028)' : 'transparent',
          cursor: 'pointer',
          borderBottom: `1px solid ${color.lineSoft}`,
          transition: 'background 0.12s',
        }}
        onMouseEnter={(e) => {
          if (!expanded) e.currentTarget.style.background = 'rgba(14,20,19,0.015)';
        }}
        onMouseLeave={(e) => {
          if (!expanded) e.currentTarget.style.background = 'transparent';
        }}
      >
        <div onClick={(e) => e.stopPropagation()}>
          <RowCheckbox
            checked={selected}
            onChange={(_, evt) => onToggleSelect(evt)}
            ariaLabel={`Select ${s.name}`}
          />
        </div>

        <Avatar name={s.name} domain={s.domain} size={28} />

        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: 2 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
            <span
              style={{
                fontWeight: 600,
                fontSize: 13.5,
                letterSpacing: '-0.005em',
                color: color.fg,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
              }}
            >
              {s.name}
            </span>
            {s.protected && (
              <span
                title="Protected — bulk actions can't touch this sender"
                style={{
                  padding: '1px 7px',
                  borderRadius: 4,
                  fontFamily: font.mono,
                  fontSize: 9,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  fontWeight: 600,
                  background: color.primarySoft,
                  color: color.primary,
                  border: `1px solid ${color.primaryBorder}`,
                  flexShrink: 0,
                }}
              >
                Protected
              </span>
            )}
          </div>
          <span
            style={{
              fontFamily: font.mono,
              fontSize: 10.5,
              color: color.fgMuted,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {s.domain}
          </span>
        </div>

        <span
          style={{
            fontSize: 12.5,
            color: color.fgSoft,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {whyLine(s)}
        </span>

        <div
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, textAlign: 'right' }}
        >
          <Stat value={s.monthly.toLocaleString()} label="per month" valueColor={color.fg} />
          <Stat
            value={`${readPct}%`}
            label="read"
            valueColor={s.read >= 0.5 ? color.primary : s.read >= 0.2 ? color.fg : color.amber}
          />
        </div>

        <div
          onClick={(e) => e.stopPropagation()}
          style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4 }}
        >
          {s.protected ? (
            <Button tone="ghost" size="sm" disabled>
              Protected
            </Button>
          ) : (
            verbs.map((verb) => {
              const isRec = recommended === verb;
              if (isRec) {
                return (
                  <Button
                    key={verb}
                    tone={verb === 'Unsubscribe' ? 'warn' : 'dark'}
                    size="sm"
                    onClick={() => onAction({ verb, senders: [s] })}
                    title={`Recommended for ${s.name}`}
                  >
                    {verb}
                  </Button>
                );
              }
              return (
                <IconVerb key={verb} verb={verb} onClick={() => onAction({ verb, senders: [s] })} />
              );
            })
          )}
        </div>

        <span
          aria-hidden="true"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 22,
            height: 22,
            color: color.fgMuted,
            fontFamily: font.mono,
            fontSize: 14,
            transform: expanded ? 'rotate(90deg)' : 'none',
            transition: 'transform 0.15s',
          }}
        >
          ›
        </span>
      </div>

      {expanded && <SenderRowDetail s={s} onAction={onAction} />}
    </>
  );
}

function Stat({ value, label, valueColor }: { value: string; label: string; valueColor: string }) {
  return (
    <div>
      <span
        style={{
          fontFamily: font.mono,
          fontWeight: 700,
          fontSize: 14.5,
          letterSpacing: '-0.012em',
          color: valueColor,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
      <small
        style={{
          fontFamily: font.sans,
          fontSize: 9,
          color: color.fgMuted,
          fontWeight: 400,
          display: 'block',
          marginTop: 1,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </small>
    </div>
  );
}

function IconVerb({
  verb,
  onClick,
}: {
  verb: 'Archive' | 'Later' | 'Unsubscribe';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={verb}
      aria-label={verb}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = color.paper;
        e.currentTarget.style.color = color.fg;
        e.currentTarget.style.borderColor = color.fgMuted;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = color.fgMuted;
        e.currentTarget.style.borderColor = color.line;
      }}
      style={{
        height: 26,
        width: 26,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        color: color.fgMuted,
        border: `1px solid ${color.line}`,
        borderRadius: 6,
        cursor: 'pointer',
        padding: 0,
        flexShrink: 0,
        transition: 'background 0.12s, color 0.12s, border-color 0.12s',
      }}
    >
      {VERB_ICONS[verb]}
    </button>
  );
}
