'use client';

import { Button, tokens } from '@declutrmail/shared';
import type { RulePreviewState } from './types';

const { color, font } = tokens;

/**
 * Dry-run preview results for one rule (D103's "If active now, this
 * rule would have affected: X senders" — preset-scoped per D192).
 *
 * Renders inside the RuleCard under the "Preview matches" button.
 * Read-only: the dry-run endpoint mutates nothing, so there is no
 * confirm step here — this is information, not an action preview.
 *
 * Privacy (D7): the sample rows carry sender name + email (both on
 * the storage allowlist) and the matcher's reason string built from
 * engine signals. No subject, no snippet, no body.
 */
export function RulePreviewPanel({
  ruleName,
  state,
  onRetry,
}: {
  ruleName: string;
  state: RulePreviewState;
  onRetry: () => void;
}) {
  return (
    <div
      role="region"
      aria-label={`Dry-run preview for rule ${ruleName}`}
      style={{
        background: color.paper,
        border: `1px solid ${color.line}`,
        borderRadius: 9,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        fontFamily: font.sans,
      }}
    >
      {state.status === 'loading' && (
        <div role="status" aria-live="polite" style={{ fontSize: 12, color: color.fgMuted }}>
          Running the dry-run against current signals…
        </div>
      )}

      {state.status === 'error' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span role="alert" style={{ fontSize: 12, color: color.red }}>
            {state.message}
          </span>
          <Button tone="default" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}

      {state.status === 'ready' && (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <strong
              style={{
                fontFamily: font.display,
                fontSize: 18,
                fontWeight: 600,
                letterSpacing: '-0.02em',
                color: color.fg,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {state.result.wouldMatchCount.toLocaleString()}
            </strong>
            <span style={{ fontSize: 12, color: color.fgSoft }}>
              sender{state.result.wouldMatchCount === 1 ? '' : 's'} would match if this rule were
              active now · {state.result.evaluatedSenders.toLocaleString()} evaluated
            </span>
          </div>

          {state.result.sample.length > 0 ? (
            <ul
              aria-label={`Sample matches for rule ${ruleName}`}
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              {state.result.sample.map((s) => (
                <li
                  key={s.senderKey}
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 8,
                    fontSize: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <span style={{ fontWeight: 600, color: color.fg }}>
                    {s.senderName ?? `sender·${s.senderKey.slice(0, 8)}`}
                  </span>
                  {s.senderEmail != null && (
                    <span
                      style={{
                        fontFamily: font.mono,
                        fontSize: 11,
                        color: color.fgMuted,
                        maxWidth: 260,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {s.senderEmail}
                    </span>
                  )}
                  <span style={{ color: color.fgMuted }}>{s.reason}</span>
                </li>
              ))}
            </ul>
          ) : (
            <span style={{ fontSize: 12, color: color.fgMuted }}>
              Nothing matches right now — the rule would take no action today.
            </span>
          )}

          <span style={{ fontSize: 11, color: color.fgMuted }}>
            Dry-run only — nothing changed in your mailbox.
          </span>
        </>
      )}
    </div>
  );
}
