'use client';

import { useMemo } from 'react';
import { Avatar, Button, tokens } from '@declutrmail/shared';
import { useUserTimeZone } from '@/features/auth/api/use-me';
import { useSenderDetail } from './api/use-sender-detail';
import { adaptSenderDetail } from './api/adapters';
import { ActionToolbar } from './detail/action-toolbar';
import { currentRecommendation } from './detail/current-recommendation';
import { RecommendationBanner } from './detail/recommendation-banner';
import { canPerformSenderAction, type ActionRequest, type ActionVerb } from './data';
import styles from './sender-workspace.module.css';

/** Sender facts are re-read; the session snapshot supplies identity/order only. */
export function GuidedSenderCard({
  senderId,
  onAction,
  active = true,
  reviewToken,
  reviewSaved = true,
  onRetrySave,
}: {
  senderId: string;
  onAction: (request: ActionRequest) => void;
  active?: boolean;
  reviewToken?: string;
  reviewSaved?: boolean;
  onRetrySave?: () => void;
}) {
  const query = useSenderDetail(senderId);
  const timeZone = useUserTimeZone();
  const detail = useMemo(
    () =>
      query.data
        ? adaptSenderDetail({
            detail: query.data.data,
            messages: [],
            timeseries: [],
            history: [],
            now: Date.now(),
            timeZone,
          })
        : null,
    [query.data, timeZone],
  );
  if (query.isPending)
    return (
      <div role="status" className={styles.guidedCard}>
        Loading sender…
      </div>
    );
  if (query.isError || detail === null)
    return (
      <div role="alert" className={styles.guidedCard}>
        <p>Couldn’t load this sender’s current details.</p>
        <Button onClick={() => void query.refetch()}>Try again</Button>
      </div>
    );
  const currentSuggestion = currentRecommendation(detail.recommendation, {
    ...detail,
    inboxCount: detail.sender.inboxCount,
    archivedCount: detail.archivedCount,
  });
  const currentVerb = currentSuggestion
    ? ((currentSuggestion.verdict[0]?.toUpperCase() +
        currentSuggestion.verdict.slice(1)) as Exclude<ActionVerb, 'Protect'>)
    : null;
  const suggestion =
    currentVerb && canPerformSenderAction(currentVerb, detail.sender) ? currentSuggestion : null;
  const suggestedVerb = suggestion && suggestion.verdict !== 'later' ? currentVerb : null;
  return (
    <section className={styles.guidedCard} aria-label="Current sender">
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 0 }}>
        <Avatar
          name={detail.sender.name}
          domain={detail.sender.domain}
          hasMark={detail.sender.brandMark}
          size={48}
        />
        <div style={{ minWidth: 0 }}>
          <h2 className={styles.detailName}>{detail.sender.name}</h2>
          <p
            style={{
              margin: '6px 0 0',
              fontSize: tokens.text.sm,
              color: tokens.color.fgMuted,
              overflowWrap: 'anywhere',
            }}
          >
            {detail.email}
          </p>
        </div>
      </div>
      {detail.isProtected && (
        <p style={{ margin: 0 }}>Protected · excluded from bulk and automatic cleanup.</p>
      )}
      <p style={{ margin: 0 }}>
        {detail.sender.inboxCount == null
          ? 'Current Inbox count unavailable'
          : `${detail.sender.inboxCount.toLocaleString('en-US')} ${detail.sender.inboxCount === 1 ? 'email' : 'emails'} in Inbox`}
      </p>
      {suggestion ? (
        <RecommendationBanner recommendation={suggestion} />
      ) : (
        <p style={{ margin: 0, color: tokens.color.fgMuted }}>
          Choose what works for this sender. There’s no current suggestion.
        </p>
      )}
      <ActionToolbar
        sender={detail.sender}
        onAction={onAction}
        shortcuts={active}
        guided
        suggestedVerb={suggestedVerb}
      />
      {reviewSaved ? (
        <a
          href={`/senders/${encodeURIComponent(senderId)}?from=senders_table${reviewToken ? `&review=${encodeURIComponent(reviewToken)}` : ''}`}
        >
          View sender details
        </a>
      ) : (
        <div role="status">
          <p>Your browser couldn’t save this review. Keep this page open to preserve your place.</p>
          <Button tone="ghost" onClick={() => onRetrySave?.()}>
            Try saving review
          </Button>
        </div>
      )}
    </section>
  );
}
