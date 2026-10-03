'use client';

import { Button, tokens } from '@declutrmail/shared';
import type { AutopilotRulePreviewResultDto } from '@/lib/api/autopilot';
import type { RulePreviewState } from './types';
import { resolveSenderIdentity } from './sender-label';
import { MatchReasonCopy } from './match-reason-copy';

const { color, font, space, text } = tokens;

const SAMPLE_CSS = `.dm-rule-preview-match { align-items: center; }
.dm-rule-preview-reason { text-align: right; flex-shrink: 0; max-width: 50%; }
@media (max-width: 600px) {
  .dm-rule-preview-match { flex-direction: column; align-items: flex-start; }
  .dm-rule-preview-identity { width: 100%; }
  .dm-rule-preview-reason { text-align: left; max-width: 100%; width: 100%; }
}`;

type Align = 'start' | 'center';

/**
 * Dry-run preview results for one rule (D103's "If active now, this
 * rule would have affected: X senders" — preset-scoped per D192).
 *
 * Three pieces, because two surfaces lay the same result out
 * differently: the RuleCard shows all of it inline (`RulePreviewPanel`),
 * while the turn-on sheet leads with the one number (`RulePreviewHero`)
 * and keeps its own facts and the sample behind Details.
 *
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
  requiresApproval = false,
}: {
  ruleName: string;
  state: RulePreviewState;
  onRetry: () => void;
  requiresApproval?: boolean;
}) {
  return (
    <div
      role="region"
      aria-label={`Current match preview for rule ${ruleName}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: space[3],
        fontFamily: font.sans,
      }}
    >
      <RulePreviewHero
        state={state}
        onRetry={onRetry}
        align="start"
        requiresApproval={requiresApproval}
      />
      {state.status === 'ready' && (
        <>
          <RulePreviewTotals result={state.result} />
          <RulePreviewSample ruleName={ruleName} result={state.result} />
          {/* Pressing "Preview matches" must never read as having done
              something to the mail. */}
          <span style={{ fontSize: text.xs, color: color.fgMuted }}>
            This preview changes nothing.
          </span>
        </>
      )}
    </div>
  );
}

/**
 * The ONE number the user acts on: senders the rule would act on right
 * now (`actionableSenderCount`). Also owns the loading and failed states,
 * so a surface that gates a commit on the preview has one place to look.
 */
export function RulePreviewHero({
  state,
  onRetry,
  align = 'center',
  requiresApproval = false,
}: {
  state: RulePreviewState;
  onRetry: () => void;
  align?: Align;
  requiresApproval?: boolean;
}) {
  const justify = align === 'center' ? 'center' : 'flex-start';

  if (state.status === 'loading') {
    return (
      <div role="status" aria-live="polite" style={{ fontSize: text.md, color: color.fgMuted }}>
        Checking current sender data…
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: justify,
          gap: space[3],
          flexWrap: 'wrap',
        }}
      >
        <span role="alert" style={{ fontSize: text.md, color: color.danger }}>
          {state.message}
        </span>
        <Button tone="default" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }

  const n = state.result.actionableSenderCount;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: justify,
        gap: space[2],
        flexWrap: 'wrap',
      }}
    >
      <strong
        style={{
          fontSize: text['3xl'],
          lineHeight: 1.1,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          color: color.fg,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {n.toLocaleString('en-US')}
      </strong>
      <span style={{ fontSize: text.md, color: color.fgMuted }}>
        sender{n === 1 ? '' : 's'} {requiresApproval ? 'ready for review' : 'actionable now'}
      </span>
    </div>
  );
}

/** The other two counts from the same dry-run, in one line. */
export function RulePreviewTotals({ result }: { result: AutopilotRulePreviewResultDto }) {
  return (
    <span style={{ fontSize: text.sm, lineHeight: 1.5, color: color.fgMuted }}>
      {result.wouldMatchCount.toLocaleString('en-US')} of{' '}
      {result.evaluatedSenders.toLocaleString('en-US')} senders checked match.{' '}
      {result.protectedWouldMatchCount.toLocaleString('en-US')} Protected sender
      {result.protectedWouldMatchCount === 1 ? ' is' : 's are'} skipped.
    </span>
  );
}

/** Up to ten matching senders: name + address left, the matcher's reason right. */
export function RulePreviewSample({
  ruleName,
  result,
}: {
  ruleName: string;
  result: AutopilotRulePreviewResultDto;
}) {
  if (result.sample.length === 0) {
    return (
      <span style={{ fontSize: text.sm, color: color.fgMuted }}>
        {result.wouldMatchCount > 0
          ? 'Matching senders have no Inbox mail to act on right now.'
          : 'Nothing matches right now.'}
      </span>
    );
  }
  return (
    <>
      <style>{SAMPLE_CSS}</style>
      <ul
        aria-label={`Sample matches for rule ${ruleName}`}
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: space[2],
        }}
      >
        {/* No per-row separators: the gap is the rhythm, so a sample reads
          as one list rather than a stack of boxes. */}
        {result.sample.map((s) => {
          const identity = resolveSenderIdentity(s);
          return (
            <li
              key={s.senderKey}
              className="dm-rule-preview-match"
              style={{
                display: 'flex',
                gap: space[3],
                minWidth: 0,
              }}
            >
              <span
                className="dm-rule-preview-identity"
                style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}
              >
                <span
                  style={{ ...ellipsis, fontSize: text.base, fontWeight: 600, color: color.fg }}
                >
                  {identity.label}
                </span>
                {identity.source === 'name' && s.senderEmail != null && (
                  <span style={{ ...ellipsis, fontSize: text.xs, color: color.fgMuted }}>
                    {s.senderEmail}
                  </span>
                )}
              </span>
              <div
                className="dm-rule-preview-reason"
                style={{
                  fontSize: text.sm,
                  color: color.fgMuted,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                <MatchReasonCopy reason={s.reason} />
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

const ellipsis = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const;
