'use client';

import { useState } from 'react';
import { Button, Kbd, tokens } from '@declutrmail/shared';

import { VERB_LESSONS } from './verb-lessons';

const { color, font, radius } = tokens;

/**
 * The D38 first-run tour — inline, three steps, no overlay chrome.
 *
 * D38: "inline tour points out the [five] verbs, the keyboard
 * shortcuts, the action tray, the recommended-verb highlight", shown
 * once during onboarding and never again. It is a panel rather than a
 * spotlight walkthrough on purpose: a spotlight has to anchor to live
 * DOM nodes that only exist when a row happens to be expanded, and D38
 * asks for calm education, not chrome that chases the user's cursor.
 *
 * No animation anywhere, so there is nothing for
 * `prefers-reduced-motion` to degrade (WCAG 2.3.3).
 *
 * Presentational: the caller owns persistence, so Storybook can render
 * every step and the onboarding/Settings hosts share one component.
 */
export function VerbTourPanel({
  onDone,
  onDismiss,
  saving = false,
  saveFailed = false,
  headingId,
}: {
  /** Last step's primary button — finishes the tour. */
  onDone: () => void;
  /** The escape hatch, available on every step. */
  onDismiss: () => void;
  /** True while the completion write is in flight. */
  saving?: boolean;
  /** True when the last write failed (inline error line). */
  saveFailed?: boolean;
  /** Id stamped on the heading so a host dialog can label itself. */
  headingId?: string;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const step = TOUR_STEPS[stepIndex]!;
  const isLast = stepIndex === TOUR_STEPS.length - 1;

  return (
    <section
      aria-labelledby={headingId ?? 'dm-verb-tour-title'}
      style={{
        background: color.card,
        border: `1px solid ${color.border}`,
        borderRadius: radius.lg,
        padding: '16px 18px',
        fontFamily: font.sans,
        maxWidth: 620,
      }}
    >
      <div
        style={{
          fontFamily: font.mono,
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: color.fgMuted,
        }}
      >
        How deciding works · {stepIndex + 1} of {TOUR_STEPS.length}
      </div>
      <h2
        id={headingId ?? 'dm-verb-tour-title'}
        style={{
          fontSize: 16,
          fontWeight: 600,
          letterSpacing: '-0.012em',
          margin: '6px 0 0',
          color: color.fg,
        }}
      >
        {step.title}
      </h2>

      {/* Politely announced so a screen reader hears the new step
          without focus having to jump between the nav buttons. */}
      <div aria-live="polite" style={{ margin: '8px 0 0' }}>
        <p style={{ fontSize: 13.5, color: color.fgSoft, lineHeight: 1.55, margin: 0 }}>
          {step.body}
        </p>

        {step.kind === 'verbs' && (
          <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0 }}>
            {VERB_LESSONS.map((lesson) => (
              <li
                key={lesson.id}
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 9,
                  padding: '7px 0',
                  borderTop: `1px solid ${color.lineSoft}`,
                }}
              >
                <Kbd>{lesson.shortcut}</Kbd>
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: color.fg }}>
                    {lesson.label}
                  </span>
                  <span style={{ fontSize: 13, color: color.fgMuted }}> — {lesson.effect}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {saveFailed && (
        <p role="alert" style={{ fontSize: 12, color: color.danger, margin: '10px 0 0' }}>
          Could not save that. Try again.
        </p>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
        {stepIndex > 0 && (
          <Button tone="default" size="sm" onClick={() => setStepIndex(stepIndex - 1)}>
            Back
          </Button>
        )}
        {isLast ? (
          <Button tone="primary" size="sm" onClick={onDone} disabled={saving}>
            {saving ? 'Saving…' : 'Got it'}
          </Button>
        ) : (
          <Button tone="primary" size="sm" onClick={() => setStepIndex(stepIndex + 1)}>
            Next
          </Button>
        )}
        <span style={{ flex: 1 }} />
        {/* Available on every step, not just the last — D38's promise is
            that this never comes back, so the way out cannot be gated
            behind reading all of it. */}
        <Button tone="ghost" size="sm" onClick={onDismiss} disabled={saving}>
          Skip for now
        </Button>
      </div>
    </section>
  );
}

/**
 * The three things D38 asks the tour to point out. The verb list is
 * generated from `VERB_LESSONS` (which is itself generated from the
 * D245 action semantics), so only the framing sentences live here.
 */
const TOUR_STEPS = [
  {
    kind: 'verbs',
    title: 'Five decisions, one sender at a time',
    body: 'Each sender gets one of these. Press the letter, or use the buttons — they do the same thing.',
  },
  {
    kind: 'preview',
    title: 'You see what changes before it changes',
    body: 'Every decision that moves email shows a preview first — how many messages match and what happens to them. Nothing moves until you confirm. Archive, Later, and Delete can be undone from Activity; a delivered unsubscribe request cannot be recalled.',
  },
  {
    kind: 'recommendation',
    title: 'A highlighted action is a suggestion',
    body: 'When one decision stands out, that is what we would pick from this sender’s history. It is never applied for you — the decision stays yours.',
  },
] as const;
