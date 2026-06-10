'use client';

import { Avatar, Eyebrow, NumericDisplay, tokens } from '@declutrmail/shared';
import type { Sender, SenderLastReview } from '../data';
import type { ProtectionReason } from './types';

const { color, font, radius } = tokens;

const VERDICT_LABEL: Record<SenderLastReview['verdict'], string> = {
  keep: 'Keep',
  archive: 'Archive',
  unsubscribe: 'Unsubscribe',
  later: 'Later',
};

/**
 * Render a `Sender.lastReview` as a single eyebrow line —
 * `Last reviewed Archive · 3d ago` or `Never reviewed`.
 *
 * Vocabulary: "reviewed" (not "decided") per Codex review on the
 * senders-tightening v2 brief. `generatedBy = 'template'` means an
 * auto-template fired the verdict without explicit user action;
 * calling that "decided" would overstate user agency. "Reviewed"
 * stays neutral across both LLM and template provenances.
 *
 * Recency is computed FE-side from `at` because the eyebrow re-renders
 * on every detail open and we don't want stale "5h ago" copy after a
 * long page session; the BE returns ISO `at` and the FE formats it
 * each render.
 */
function fmtLastReview(review: SenderLastReview | null, now: number = Date.now()): string {
  if (review === null) return 'Never reviewed';
  const verdictLabel = VERDICT_LABEL[review.verdict];
  const ageMs = now - new Date(review.at).getTime();
  const days = Math.floor(ageMs / (1000 * 60 * 60 * 24));
  let recency: string;
  if (days <= 0) {
    recency = 'today';
  } else if (days === 1) {
    recency = 'yesterday';
  } else if (days < 7) {
    recency = `${days}d ago`;
  } else if (days < 60) {
    recency = `${Math.round(days / 7)}w ago`;
  } else {
    recency = `${Math.round(days / 30)}mo ago`;
  }
  return `Last reviewed ${verdictLabel} · ${recency}`;
}

/**
 * Sender Detail header (D39 #1).
 *
 * Renders: avatar · sender name · domain · Gmail category · VIP/Protect
 * toggle chips beneath the name (D43). VIP and Protect are two
 * distinct standing policies (D42) — the icons + tooltips communicate
 * that distinction. Filled = active; outlined = inactive.
 */
export function SenderDetailHeader({
  sender,
  gmailCategory,
  isVip,
  isProtected,
  protectionReason,
  onToggleVip,
  onToggleProtect,
}: {
  sender: Sender;
  gmailCategory: string;
  isVip: boolean;
  isProtected: boolean;
  protectionReason: ProtectionReason | null;
  onToggleVip: () => void;
  onToggleProtect: () => void;
}) {
  const protectTooltip =
    protectionReason === 'auto-receipts'
      ? "Auto-protected — receipts and statements aren't acted on in bulk."
      : protectionReason === 'auto-financial'
        ? "Auto-protected — financial-institution sender. Bulk actions won't apply."
        : isProtected
          ? 'Protect — never re-suggested. A silent guard against accidental bulk action.'
          : 'Protect — never re-suggested. A silent guard against accidental bulk action.';

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 16,
        padding: '20px 24px 16px',
        background: color.card,
        border: `1px solid ${color.line}`,
        borderRadius: radius.lg,
        fontFamily: font.sans,
        flexWrap: 'wrap',
      }}
    >
      <Avatar name={sender.name} domain={sender.domain} size={44} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, flex: 1 }}>
        <div>
          <Eyebrow>Sender</Eyebrow>
          {/* ADR-0016 §A1 — sender name uses `NumericDisplay
              variant="display"` (Fraunces 28/400/-0.025em) so the
              h1 scale on Detail mirrors the SenderTable total cell
              + Hero slice headline. Card↔Detail navigation now lands
              on a consistent display-numeric scale. */}
          <h1
            style={{
              margin: '4px 0 0',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
              minWidth: 0,
            }}
          >
            <NumericDisplay
              value={sender.name}
              variant="display"
              style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}
            />
            {/* D43 — small VIP/Protect icons sit next to the name, not in the toolbar. */}
            <span
              style={{
                display: 'inline-flex',
                gap: 6,
                alignItems: 'center',
                fontFamily: font.sans,
              }}
            >
              <PolicyChip
                active={isVip}
                tone="vip"
                label="VIP"
                icon={<StarIcon filled={isVip} />}
                onToggle={onToggleVip}
                tooltip={
                  isVip
                    ? 'VIP — elevated in the Morning Brief and notifications. Click to unmark.'
                    : 'Mark VIP — elevate in Brief and notifications.'
                }
              />
              <PolicyChip
                active={isProtected}
                tone="protect"
                label="Protect"
                icon={<ShieldIcon filled={isProtected} />}
                onToggle={onToggleProtect}
                tooltip={protectTooltip}
              />
            </span>
          </h1>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12.5,
            color: color.fgSoft,
            fontFamily: font.mono,
            flexWrap: 'wrap',
          }}
        >
          <span>{sender.domain}</span>
          <span aria-hidden="true">·</span>
          <span>{gmailCategory}</span>
          <span aria-hidden="true">·</span>
          {/* Last-reviewed eyebrow — see senders-tightening v2 brief.
              Neutral copy ("Last reviewed …" not "Decided …") because the
              underlying verdict may have been auto-template-fired. */}
          <span title="Most recent triage decision for this sender">
            {fmtLastReview(sender.lastReview ?? null)}
          </span>
        </div>
      </div>
    </header>
  );
}

function PolicyChip({
  active,
  tone,
  label,
  icon,
  onToggle,
  tooltip,
}: {
  active: boolean;
  tone: 'vip' | 'protect';
  label: string;
  icon: React.ReactNode;
  onToggle: () => void;
  tooltip: string;
}) {
  const fillBg = tone === 'vip' ? 'rgba(180, 83, 9, 0.12)' : color.primarySoft;
  const fillFg = tone === 'vip' ? '#92400E' : color.primary;
  const fillBr = tone === 'vip' ? 'rgba(180, 83, 9, 0.40)' : color.primaryBorder;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      title={tooltip}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '3px 9px',
        height: 24,
        borderRadius: radius.pill,
        background: active ? fillBg : 'transparent',
        color: active ? fillFg : color.fgSoft,
        border: `1px solid ${active ? fillBr : color.border}`,
        fontFamily: font.sans,
        fontSize: 11.5,
        fontWeight: 600,
        cursor: 'pointer',
        letterSpacing: '0.01em',
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function ShieldIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
