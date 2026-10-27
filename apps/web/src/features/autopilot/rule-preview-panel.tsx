'use client';

import { Button, tokens } from '@declutrmail/shared';
import type { ReactNode } from 'react';
import type { AutopilotRuleDto, AutopilotRulePreviewResultDto } from '@/lib/api/autopilot';
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
  actionKind,
}: {
  ruleName: string;
  state: RulePreviewState;
  onRetry: () => void;
  actionKind: AutopilotRuleDto['actionKind'];
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
        count="matches"
        actionKind={actionKind}
      />
      {state.status === 'ready' && (
        <>
          <RulePreviewTotals result={state.result} actionKind={actionKind} />
          <RulePreviewSample ruleName={ruleName} result={state.result} />
          {/* Pressing "Preview matches" must never read as having done
              something to the mail. */}
          <span style={{ fontSize: text.xs, color: color.fgMuted }}>
            Preview only. No emails will change.
          </span>
        </>
      )}
    </div>
  );
}

/**
 * Rule cards lead with all matches, matching their historical sample.
 * Activation keeps the eligible action count. Also owns loading and failed states,
 * so a surface that gates a commit on the preview has one place to look.
 */
export function RulePreviewHero({
  state,
  onRetry,
  align = 'center',
  actionKind,
  count = 'actionable',
}: {
  state: RulePreviewState;
  onRetry: () => void;
  align?: Align;
  actionKind: AutopilotRuleDto['actionKind'];
  count?: 'matches' | 'actionable';
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
        <span role="alert" style={{ fontSize: text.md, color: color.dangerText }}>
          {state.message}
        </span>
        <Button tone="default" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }

  const n = count === 'matches' ? state.result.wouldMatchCount : state.result.actionableSenderCount;
  const eligibleLabel = {
    archive: 'with Inbox email to Archive',
    later: 'with Inbox email to move to Later',
    delete: 'with email to Delete',
    unsubscribe: 'eligible for Unsubscribe',
  }[actionKind];
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
        {count === 'matches'
          ? n === 1
            ? 'sender matches this rule'
            : 'senders match this rule'
          : `sender${n === 1 ? '' : 's'} ${eligibleLabel}`}
      </span>
    </div>
  );
}

/** Match counts exclude Protected senders; action eligibility is a separate subset. */
export function RulePreviewTotals({
  result,
  actionKind,
}: {
  result: AutopilotRulePreviewResultDto;
  actionKind: AutopilotRuleDto['actionKind'];
}) {
  const eligible = result.actionableSenderCount;
  const verb = {
    archive: 'Archive',
    later: 'move to Later',
    delete: 'Delete',
    unsubscribe: 'Unsubscribe',
  }[actionKind];
  return (
    <div style={{ fontSize: text.sm, lineHeight: 1.5, color: color.fgMuted }}>
      <div>
        {result.evaluatedSenders.toLocaleString('en-US')} sender
        {result.evaluatedSenders === 1 ? '' : 's'} checked. {eligible.toLocaleString('en-US')}{' '}
        sender{eligible === 1 ? '' : 's'}{' '}
        {actionKind === 'unsubscribe'
          ? `${eligible === 1 ? 'is' : 'are'} eligible for Unsubscribe.`
          : `${eligible === 1 ? 'has' : 'have'} email to ${verb}.`}
      </div>
      <RulePreviewExclusions result={result} actionKind={actionKind} />
      {result.protectedWouldMatchCount > 0 && (
        <div>
          {result.protectedWouldMatchCount.toLocaleString('en-US')} matching Protected sender
          {result.protectedWouldMatchCount === 1 ? '' : 's'} excluded from these counts.
        </div>
      )}
    </div>
  );
}

/** The action-ineligible subset of historical matches, shared by cards and activation. */
export function RulePreviewExclusions({
  result,
  actionKind,
}: {
  result: AutopilotRulePreviewResultDto;
  actionKind: AutopilotRuleDto['actionKind'];
}) {
  const excluded = result.wouldMatchCount - result.actionableSenderCount;
  if (excluded <= 0) return null;
  const exclusion =
    actionKind === 'unsubscribe'
      ? `${excluded === 1 ? 'already has' : 'already have'} Unsubscribe selected`
      : actionKind === 'delete'
        ? `${excluded === 1 ? 'has' : 'have'} no email in this rule’s scope to Delete`
        : `${excluded === 1 ? 'has' : 'have'} no Inbox email to ${actionKind === 'archive' ? 'Archive' : 'move to Later'}`;
  return (
    <div style={{ fontSize: text.sm, lineHeight: 1.5, color: color.fgMuted }}>
      {excluded.toLocaleString('en-US')} matching sender{excluded === 1 ? '' : 's'} {exclusion}.
    </div>
  );
}

/** Rule-card samples and complete, paged activation evidence share the row presentation. */
export function RulePreviewSample({
  ruleName,
  result,
  layout = 'list',
  page,
  controls,
}: {
  ruleName: string;
  result: AutopilotRulePreviewResultDto;
  layout?: 'list' | 'table';
  page?: { page: number; pageSize: number; total: number } | undefined;
  controls?: ReactNode;
}) {
  if (result.sample.length === 0) {
    return (
      <span style={{ fontSize: text.sm, color: color.fgMuted }}>
        {page
          ? 'No senders are eligible right now.'
          : result.wouldMatchCount > 0
            ? 'No sample senders available.'
            : 'Nothing matches right now.'}
      </span>
    );
  }
  if (layout === 'table') {
    const rows = result.sample.map((sender) => ({
      sender,
      identity: resolveSenderIdentity(sender),
      evidence: readHistoryEvidence(sender.reason),
    }));
    const structured = rows.every((row) => row.evidence != null);
    return (
      <section
        className="dm-autopilot-sample"
        aria-label={`${page ? 'Eligible senders' : 'Sample matches'} for rule ${ruleName}`}
      >
        <div className={`dm-autopilot-sample-heading${page ? ' dm-autopilot-paged-heading' : ''}`}>
          <h3>{page ? 'Eligible senders' : 'Matching senders'}</h3>
          <span aria-live={page ? 'polite' : undefined}>
            {page
              ? `${((page.page - 1) * page.pageSize + 1).toLocaleString('en-US')}–${Math.min(page.page * page.pageSize, page.total).toLocaleString('en-US')} of ${page.total.toLocaleString('en-US')}`
              : `Sample of ${result.sample.length.toLocaleString('en-US')}`}
          </span>
          {controls}
        </div>
        <table className="dm-autopilot-sender-table">
          {structured && (
            <caption className="dm-autopilot-sample-note">
              Matching uses synced email history, including inbox and archived mail. “In inbox”
              counts only mail currently in your inbox. Read rate is the rule’s matching diagnostic;
              it may exclude mail marked read by other tools and does not prove whether you read an
              email.
            </caption>
          )}
          <thead>
            <tr>
              <th scope="col">Sender</th>
              {structured ? (
                <>
                  <th scope="col" title="Adjusted read-rate diagnostic used by this rule">
                    Read rate
                  </th>
                  <th scope="col">Email history</th>
                </>
              ) : (
                <th scope="col">Why it matches</th>
              )}
              <th scope="col">In inbox</th>
              {structured && <th scope="col">Last seen</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ sender, identity, evidence }) => (
              <tr key={sender.senderKey}>
                <th scope="row">
                  <span className="dm-autopilot-sender-name">{identity.label}</span>
                  {identity.source === 'name' && sender.senderEmail != null && (
                    <span className="dm-autopilot-sender-email">{sender.senderEmail}</span>
                  )}
                  {sender.ineligibleReason === 'unsubscribe_policy_recorded' && (
                    <span
                      style={{
                        display: 'block',
                        fontSize: text.xs,
                        fontWeight: 400,
                        color: color.fgMuted,
                      }}
                    >
                      Unsubscribe already selected
                    </span>
                  )}
                </th>
                {structured && evidence ? (
                  <>
                    <td>
                      <span className="dm-autopilot-mobile-label">Read rate </span>
                      {evidence[1]}%
                    </td>
                    <td>
                      <span className="dm-autopilot-mobile-label">Email history </span>
                      {Number(evidence[2]).toLocaleString('en-US')}
                    </td>
                  </>
                ) : (
                  <td className="dm-autopilot-sender-reason">
                    <MatchReasonCopy reason={sender.reason} />
                  </td>
                )}
                <td aria-label={sender.inboxCount == null ? 'Inbox count unavailable' : undefined}>
                  <span className="dm-autopilot-mobile-label">In inbox </span>
                  {sender.inboxCount == null ? (
                    <span title="Inbox count unavailable">—</span>
                  ) : (
                    sender.inboxCount.toLocaleString('en-US')
                  )}
                </td>
                {structured && evidence && (
                  <td>
                    <span className="dm-autopilot-mobile-label">Last seen </span>
                    {evidence[3]}d ago
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
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
                {s.ineligibleReason === 'unsubscribe_policy_recorded' && (
                  <span style={{ fontSize: text.xs, color: color.fgMuted }}>
                    Unsubscribe already selected
                  </span>
                )}
                {s.inboxCount != null && (
                  <span style={{ fontSize: text.xs, color: color.fgMuted }}>
                    {s.inboxCount.toLocaleString('en-US')} Inbox email
                    {s.inboxCount === 1 ? '' : 's'}
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

/** Only expose metrics when the recorded preset evidence has known, valid units. */
function readHistoryEvidence(reason: string): RegExpExecArray | null {
  const evidence = /^Read rate (\d+)% across all (\d+) messages, last seen (\d+)d ago$/.exec(
    reason,
  );
  if (!evidence) return null;
  const [rate, messages, days] = evidence.slice(1).map(Number);
  return rate! <= 100 && messages! > 0 && [rate, messages, days].every(Number.isSafeInteger)
    ? evidence
    : null;
}
