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
 * Renders: avatar · sender name · domain · Gmail category · Protect
 * toggle beneath the name. Filled = active; outlined = inactive.
 */
export function SenderDetailHeader({
  sender,
  gmailCategory,
  isProtected,
  protectionReason,
  onToggleProtect,
}: {
  sender: Sender;
  gmailCategory: string;
  isProtected: boolean;
  protectionReason: ProtectionReason | null;
  onToggleProtect: () => void;
}) {
  const protectTooltip =
    protectionReason === 'replied'
      ? 'Automatically protected because you replied at least three times. Select to remove protection.'
      : protectionReason === 'starred'
        ? 'Automatically protected because you starred a message this year. Select to remove protection.'
        : protectionReason === 'gmail-important'
          ? 'Automatically protected because Gmail marked at least three messages important this year. Select to remove protection.'
          : isProtected
            ? 'Protected by you. Select to remove protection.'
            : 'Protect this sender from bulk and automatic mail-changing actions.';

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
            {/* Protection is the sole standing safety state. */}
            <span
              style={{
                display: 'inline-flex',
                gap: 6,
                alignItems: 'center',
                fontFamily: font.sans,
              }}
            >
              <PolicyChip
                active={isProtected}
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
  label,
  icon,
  onToggle,
  tooltip,
}: {
  active: boolean;
  label: string;
  icon: React.ReactNode;
  onToggle: () => void;
  tooltip: string;
}) {
  const fillBg = color.primarySoft;
  const fillFg = color.primary;
  const fillBr = color.primaryBorder;
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
