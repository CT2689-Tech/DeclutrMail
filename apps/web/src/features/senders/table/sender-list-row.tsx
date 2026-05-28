'use client';

import type { MouseEvent, ReactNode } from 'react';
import { Avatar, Button, tokens, useIsAtMost } from '@declutrmail/shared';
import {
  canArchive,
  canLater,
  canUnsubscribe,
  isStandingProtected,
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

/**
 * Render a `Sender.volumeTrend` bucket as a short evidence-line token.
 * Returns `null` when the bucket should be omitted from the line (no
 * history, or `steady` — which would only add noise to the row).
 *
 * Bucketed labels (per Codex review on the senders-tightening v2
 * brief) — never a raw percentage. False precision on small baselines
 * is the failure mode we're avoiding.
 */
function trendToken(s: Sender): string | null {
  if (!s.volumeTrend || s.volumeTrend === 'steady') return null;
  if (s.volumeTrend === 'up') return '↑ Up';
  if (s.volumeTrend === 'down') return '↓ Down';
  if (s.volumeTrend === 'dormant') return '○ Dormant';
  return '• New';
}

/**
 * Build the row evidence line.
 *
 * Tightening pass — see senders-tightening v2 brief. Replaces the
 * old `whyLine` + 2-cell numeric grid (volume + read%) with a single
 * bounded-token line. Token order is deterministic; tokens are
 * single-word / single-glyph compact (no long prose). The row clamps
 * to one line and ellipsis-truncates from the recency token first.
 *
 * Token order (highest decision weight first, last to truncate):
 *   1. `<N>/mo`             — cadence (always present unless 0)
 *   2. `<trend>`            — Up / Down / Dormant / New (omitted on steady)
 *   3. `<read-state>`       — "Almost never marked read" etc. when
 *                              the signal is decision-grade, otherwise
 *                              omitted to keep the line short
 *   4. `Last seen <recency>`— recency token (first to truncate on
 *                              narrow widths)
 *
 * Vocabulary: "marked read" never "opened" — Gmail exposes no open
 * events (Codex review). The `volumeTrend` chip is the canonical
 * place for trend, never an inferred percentage in this string.
 */
function buildEvidenceTokens(s: Sender): string[] {
  const tokens: string[] = [];

  if (s.monthly > 0) {
    tokens.push(`${s.monthly}/mo`);
  }

  const trend = trendToken(s);
  if (trend) tokens.push(trend);

  // Read-state phrase — only emit when it's strong enough to drive a
  // decision. Otherwise the line goes silent and the recency token
  // gets the slot.
  const read = Math.round(s.read * 100);
  if (s.spike) {
    tokens.push('Volume spike');
  } else if (read <= 5 && s.monthly >= 8) {
    tokens.push('Almost never marked read');
  } else if (read >= 70) {
    tokens.push(`${read}% marked read`);
  }

  // Recency token — last because narrow widths drop it first.
  if (s.lastDays === 0) {
    tokens.push('Last seen today');
  } else if (s.lastDays === 1) {
    tokens.push('Last seen yesterday');
  } else if (s.lastDays < 7) {
    tokens.push(`Last seen ${s.lastDays}d ago`);
  } else if (s.lastDays < 60) {
    tokens.push(`Last seen ${Math.round(s.lastDays / 7)}w ago`);
  } else {
    tokens.push(`Last seen ${Math.round(s.lastDays / 30)}mo ago`);
  }

  return tokens;
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
  // Below `sm` the evidence line drops so the row keeps the name +
  // actions reachable without horizontal clipping. The evidence-line
  // tokens are deterministically ordered so when the visible string
  // truncates on a narrow desktop it loses the lowest-weight token
  // first (recency) and keeps the highest-weight ones (cadence,
  // trend, read-state phrase).
  const isMobile = useIsAtMost('sm');
  const evidenceTokens = buildEvidenceTokens(s);
  const evidenceLine = evidenceTokens.join(' · ');

  const verbs: ('Archive' | 'Later' | 'Unsubscribe')[] = [];
  if (canArchive(s)) verbs.push('Archive');
  if (canLater(s)) verbs.push('Later');
  if (canUnsubscribe(s)) verbs.push('Unsubscribe');

  return (
    <>
      <div
        onClick={onToggleExpand}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onToggleExpand();
          }
        }}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`${s.name} — ${expanded ? 'collapse' : 'expand'} detail`}
        style={{
          display: 'grid',
          // Tightening pass — dropped the 2-cell numeric stat block
          // (volume + read%) in favour of a single bounded evidence
          // line. The grid is now one cell narrower per row, freeing
          // ~272px for the action cluster + chevron without changing
          // overall row height. See senders-tightening v2 brief.
          gridTemplateColumns: isMobile
            ? '20px 32px minmax(0,1fr) auto 22px'
            : '20px 32px minmax(0,1.7fr) minmax(0,1.5fr) 156px 22px',
          gap: isMobile ? 10 : 14,
          alignItems: 'center',
          padding: '12px 16px',
          background: expanded ? 'rgba(14,20,19,0.028)' : 'transparent',
          cursor: 'pointer',
          borderBottom: `1px solid ${color.lineSoft}`,
          boxShadow: expanded ? `inset 3px 0 0 ${color.primary}` : undefined,
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
            {isStandingProtected(s) && (
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

        {!isMobile && (
          <span
            title={evidenceLine}
            style={{
              fontSize: 12.5,
              color: color.fgSoft,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {evidenceLine}
          </span>
        )}

        <div
          onClick={(e) => e.stopPropagation()}
          style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4 }}
        >
          {isStandingProtected(s) ? (
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
