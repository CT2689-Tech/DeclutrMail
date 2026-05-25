'use client';
// apps/web/src/features/senders/uplift-d/inbox-story-hero/inbox-story-hero.tsx
//
// Variant D inbox-story hero — feature-owned per ADR-0007 (lazy
// promotion). Promote to packages/shared/ when Triage / Brief / Activity
// builds a similar editorial-hero pattern; today's only consumer is the
// Senders list.
//
// Design intent (~/.claude/plans/how-can-we-uplift-foamy-cloud.md §D1):
// the topmost block on the Senders surface that frames the user's week
// in 1-2 lines of display-serif copy. Right side carries a small
// meta-strip (reading time, week-over-week delta). Below the headline:
// a teal-washed ROI CTA that turns the framing into a single action.
// Trust line ("Metadata only · No message bodies · Reversible for 7
// days") sits below — quiet, always-on, the wedge against Unroll.me /
// Clean Email anxieties.
//
// Copy rules (ADR-0011 + D209):
//   - At most ONE editorial framing phrase per surface. The component
//     accepts copy as ReactNode props so the consumer owns the exact
//     wording; check-microcopy.sh enforces the forbidden-word list
//     when the consumer's strings are committed.
//   - "Only 18% were worth reading" is the canonical V1 framing —
//     audited as permitted under ADR-0011's hero-surface relaxation.
//   - ROI sentence: "5 decisions can cut next week's inbox by ~48%".
//     "decisions" framing per D221; "cut next week's" sets the time
//     horizon. No "clean" (forbidden), no "smart" (forbidden).

import type { ReactNode } from 'react';
import { tokens } from '@declutrmail/shared';

const { color, font, radius, shadow, text, space } = tokens;

export interface InboxStoryHeroProps {
  /**
   * Small uppercase eyebrow above the headline — e.g. "Your inbox this
   * week" / "Your inbox this month".
   */
  eyebrow: ReactNode;
  /**
   * The 1-2 line display-serif story. Pass an array for line-broken
   * copy (each entry becomes a paragraph). Consumers should wrap
   * emphasis spans (`<span className="em">...</span>`) inline to mark
   * the highlighted numbers — the component preserves them as-is.
   *
   * Per ADR-0011 hero-relaxation: ONE editorial framing phrase per
   * surface. Pure number recital is allowed; "worth reading" /
   * "mail you back" / similar one-phrase framings are allowed.
   * "smart" / "magic" / "AI" / "nuke" remain forbidden by D209.
   */
  story: ReactNode[];
  /**
   * Right-side meta strip — typically reading time + week-over-week
   * delta. Each entry: { value, label, deltaTone? } — deltaTone tints
   * the value when it's a delta (down=emerald, up=amber).
   */
  meta?: Array<{
    value: ReactNode;
    label: ReactNode;
    deltaTone?: 'up' | 'down' | null;
  }>;
  /**
   * Outcome CTA — the actionable sentence that turns the framing into
   * the next step. Typical: "5 decisions can cut next week's inbox by
   * ~48%. We'll guide you one at a time. 3 minutes."
   */
  ctaCopy: ReactNode;
  /** Primary action label — typically "Start review". */
  ctaLabel: ReactNode;
  /** Fires when the CTA is clicked. */
  onCtaClick?: () => void;
  /**
   * Trust line below the CTA. Defaults to the V1 canonical string
   * "Metadata only · No message bodies · Reversible for 7 days" —
   * override only with founder approval (D7 / D228 alignment).
   */
  trustLine?: ReactNode;
}

const DEFAULT_TRUST_LINE = 'Metadata only · No message bodies · Reversible for 7 days';

/**
 * Editorial hero strip for the Senders list. Uses display serif + warm
 * gradient wash to set the brand voice; CTA is the only loud button.
 */
export function InboxStoryHero({
  eyebrow,
  story,
  meta,
  ctaCopy,
  ctaLabel,
  onCtaClick,
  trustLine = DEFAULT_TRUST_LINE,
}: InboxStoryHeroProps) {
  return (
    <section
      style={{
        background: color.card,
        border: `1px solid ${color.line}`,
        borderRadius: 20,
        boxShadow: shadow.pop,
        padding: `${space[8]}px ${space[10]}px ${space[6]}px`,
        marginBottom: space[5],
        position: 'relative',
        overflow: 'hidden',
        fontFamily: font.sans,
      }}
    >
      <div
        // Subtle radial wash — restrained per D2; visible only in the
        // top-right corner so the body of the hero stays calm.
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(ellipse at 85% -10%, ${color.primaryWash} 0%, transparent 55%)`,
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          fontSize: text['2xs'],
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          color: color.fgMuted,
          fontWeight: 500,
          position: 'relative',
          marginBottom: space[3],
        }}
      >
        {eyebrow}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          gap: space[10],
          alignItems: 'end',
          marginBottom: space[6],
          position: 'relative',
        }}
      >
        <div
          style={{
            fontFamily: font.display,
            fontSize: 34,
            lineHeight: 1.22,
            letterSpacing: '-0.02em',
            fontWeight: 500,
            color: color.fg,
            maxWidth: 720,
          }}
        >
          {story.map((line, i) => (
            <p
              key={i}
              style={{
                margin: 0,
                marginTop: i === 0 ? 0 : space[2],
                color: i === 0 ? color.fg : color.fgSoft,
              }}
            >
              {line}
            </p>
          ))}
        </div>
        {meta != null && meta.length > 0 && (
          <div style={{ display: 'flex', gap: space[8], alignItems: 'flex-end' }}>
            {meta.map((m, i) => (
              <div key={i} style={{ textAlign: 'right' }}>
                <div
                  style={{
                    fontSize: text['2xl'],
                    fontWeight: 600,
                    letterSpacing: '-0.02em',
                    fontVariantNumeric: 'tabular-nums',
                    color:
                      m.deltaTone === 'up'
                        ? color.amber
                        : m.deltaTone === 'down'
                          ? color.emerald
                          : color.fg,
                  }}
                >
                  {m.value}
                </div>
                <div
                  style={{
                    fontSize: text['2xs'],
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                    color: color.fgMuted,
                    marginTop: 5,
                    fontWeight: 500,
                  }}
                >
                  {m.label}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div
        style={{
          background: color.primaryWash,
          border: `1px solid ${color.primaryBorder}`,
          borderRadius: radius.lg,
          padding: `${space[4]}px ${space[5]}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: space[6],
          position: 'relative',
        }}
      >
        <div
          style={{
            color: color.primaryDeep,
            fontSize: 14.5,
            lineHeight: 1.5,
            maxWidth: 560,
          }}
        >
          {ctaCopy}
        </div>
        <button
          type="button"
          onClick={onCtaClick}
          style={{
            background: color.primary,
            color: 'white',
            padding: `${space[3]}px ${space[5]}px`,
            borderRadius: radius.md,
            fontSize: text.md,
            fontWeight: 500,
            border: `1px solid ${color.primaryDeep}`,
            boxShadow: '0 6px 16px rgba(0,107,95,0.25)',
            whiteSpace: 'nowrap',
            display: 'inline-flex',
            alignItems: 'center',
            gap: space[2],
            cursor: 'pointer',
            transition: 'background 150ms',
          }}
        >
          {ctaLabel}
          <span style={{ opacity: 0.7 }}>→</span>
        </button>
      </div>
      <div
        style={{
          marginTop: space[3],
          fontSize: text.sm,
          color: color.fgMuted,
          fontFamily: font.mono,
          display: 'flex',
          alignItems: 'center',
          gap: space[2],
          position: 'relative',
        }}
      >
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: color.emerald,
            display: 'inline-block',
          }}
        />
        {trustLine}
      </div>
    </section>
  );
}
