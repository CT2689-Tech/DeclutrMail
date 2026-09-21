'use client';

import type { ReactNode } from 'react';
import { color, font, radius, text } from '../../tokens/tokens';

/**
 * Promoted shared empty-state primitive (D212).
 *
 * Empty states are first-class in DeclutrMail. Every list/queue/index
 * surface that can be empty renders an `<EmptyState />` instead of a
 * blank panel — D212 forbids the "0 results" / "Nothing here" / "Error"
 * placeholder patterns.
 *
 * Rules encoded here:
 *
 *   - **Calm, never apologetic.** The component never renders the
 *     forbidden words automatically; the consumer supplies the copy
 *     and `check-microcopy.sh` (D209) catches forbidden words at PR
 *     time.
 *   - **Distinct from error states.** Neutral and unboxed: a quiet grey
 *     icon disc, no alert role. `ErrorState` owns the amber disc and
 *     `role="alert"`; an empty state never borrows either.
 *   - **Tier-aware.** When `tier='free'` and a `tierNudge` prop is
 *     supplied, the component renders the D33-style upgrade nudge
 *     beneath the action row. This is the generalization of the Triage
 *     end-of-ritual empty state to any feature that has a Free-cap
 *     surface (Senders bulk apply, Autopilot rule count, etc.).
 *
 * Props:
 *
 *   - `icon`          — optional leading icon (rendered inside a 56px
 *                       neutral disc).
 *   - `title`         — short headline. Required.
 *   - `description`   — body copy that reinforces the mental model.
 *                       Optional; aliased as `body` for backwards
 *                       compatibility with pre-D212 call sites.
 *   - `body`          — DEPRECATED alias for `description`. Existing
 *                       consumers in `apps/web/src/features/senders/**`
 *                       still pass this; new code uses `description`.
 *   - `action`        — optional CTA node (typically a `<Button />`).
 *   - `tier`          — `'free' | 'plus' | 'pro'`. When `'free'` and a
 *                       `tierNudge` is provided, renders an inline
 *                       upgrade nudge below the action.
 *   - `tierNudge`     — `{ headline, body, cta }` for the nudge.
 */
export type EmptyStateTier = 'free' | 'plus' | 'pro';

export interface EmptyStateTierNudge {
  /** Bold lead sentence — "You're out of free decisions today." */
  headline: ReactNode;
  /** Trailing softer sentence — "Plus removes the daily cap…". */
  body: ReactNode;
  /** Pre-rendered CTA — typically a `<Button tone="primary" />`. */
  cta?: ReactNode;
}

export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  /** Body copy. Aliased as `body` for legacy call sites. */
  description?: ReactNode;
  /** @deprecated Use `description`. Kept for pre-D212 consumers. */
  body?: ReactNode;
  action?: ReactNode;
  tier?: EmptyStateTier;
  tierNudge?: EmptyStateTierNudge;
}

export function EmptyState({
  icon,
  title,
  description,
  body,
  action,
  tier,
  tierNudge,
}: EmptyStateProps) {
  // `description` wins when both are supplied; `body` is the legacy alias.
  const copy = description ?? body;
  const showNudge = tier === 'free' && tierNudge !== undefined;

  return (
    <div
      style={{
        padding: '56px 24px',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 20,
        fontFamily: font.sans,
      }}
    >
      {icon != null && (
        <span
          aria-hidden="true"
          style={{
            width: 56,
            height: 56,
            borderRadius: radius.pill,
            background: color.fill,
            color: color.fgSoft,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {icon}
        </span>
      )}
      <div>
        <h3
          style={{
            fontSize: text.xl,
            fontWeight: 650,
            margin: 0,
            letterSpacing: '-0.02em',
            color: color.fg,
          }}
        >
          {title}
        </h3>
        {copy != null && (
          <p
            style={{
              fontSize: text.md,
              color: color.fgMuted,
              margin: '8px auto 0',
              lineHeight: 1.5,
              maxWidth: 380,
            }}
          >
            {copy}
          </p>
        )}
      </div>
      {action}
      {showNudge && (
        <div
          // D33 nudge surface, hoisted to a primitive so any list/queue
          // can render the same pattern (Senders bulk-apply, Autopilot
          // rule cap, etc.) without duplicating the chrome.
          style={{
            marginTop: 8,
            padding: '14px 18px',
            background: color.primaryWash,
            borderRadius: radius.lg,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            justifyContent: 'center',
            maxWidth: 520,
          }}
        >
          <span style={{ fontSize: text.base, color: color.fg, textAlign: 'left' }}>
            <strong style={{ fontWeight: 600 }}>{tierNudge.headline}</strong>{' '}
            <span style={{ color: color.fgSoft }}>{tierNudge.body}</span>
          </span>
          {tierNudge.cta != null && tierNudge.cta}
        </div>
      )}
    </div>
  );
}
