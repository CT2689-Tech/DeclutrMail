'use client';

import { useEffect, useMemo } from 'react';
import { Avatar, EmptyState, Eyebrow, NumericDisplay, Spark, tokens } from '@declutrmail/shared';
import { senderAddressLine } from '@/features/senders/data';
import { formatReadRatePct } from '@/features/senders/fact-language';
import {
  historyRowToTimelineItem,
  monthAbbrev,
  relationshipDisplay,
} from '@/features/senders/detail/format';
import { RecentMessages } from '@/features/senders/detail/recent-messages';
import { RecommendationBanner } from '@/features/senders/detail/recommendation-banner';
import { DecisionTimeline, KpiStrip, type TimelineItem } from '@/features/senders/uplift-d';
import { buildSenderDetail } from '@/mocks/sender-detail-builder';
import { SENDER_FIXTURES } from '@/mocks/sender-fixture-data';
import { useNow } from '@/lib/use-now';
import { TrackedCta } from '@/features/marketing/landing/tracked-cta';
import { oauthStartUrl } from '@/features/marketing/landing/urls';

const { color, font } = tokens;

/**
 * The only two demo rows with a matching entry in the shared
 * `SENDER_FIXTURES` dataset (Storybook's own fixture set) — every other
 * demo row would need a new synthetic `SenderDetail` authored by hand.
 */
export const SENDER_DETAIL_PREVIEW_FIXTURE_IDS = ['linkedin', 'groupon'] as const;
export type SenderDetailPreviewFixtureId = (typeof SENDER_DETAIL_PREVIEW_FIXTURE_IDS)[number];

export function isSenderDetailPreviewFixtureId(
  value: string | null,
): value is SenderDetailPreviewFixtureId {
  return value != null && (SENDER_DETAIL_PREVIEW_FIXTURE_IDS as readonly string[]).includes(value);
}

function requireFixture(id: SenderDetailPreviewFixtureId) {
  const fixture = SENDER_FIXTURES.find((f) => f.id === id);
  if (!fixture) throw new Error(`Missing sender detail preview fixture: ${id}`);
  return fixture;
}

/**
 * A read-only showcase of the real Sender Detail page's content —
 * hero facts, KPI strip, recent messages, decision timeline — built
 * from `buildSenderDetail`'s synthetic data (same source Storybook
 * uses). Deliberately NOT the production `SenderDetailPage`: that
 * component's `ReadyState` hard-imports real mutation hooks
 * (`useSetSenderPolicy`, `useEnqueueComposite`, `useQueryClient`, …)
 * with no read-only escape hatch, and importing it here would both
 * bloat the public route's bundle with the authenticated API client
 * and let a click fire a real unauthenticated request — the same bug
 * class already open against `TriageRow`'s chain. This only touches
 * the sub-components (`KpiStrip`, `DecisionTimeline`, `RecentMessages`,
 * `RecommendationBanner`) that are already presentation-only, plus the
 * pure formatters in `../../senders/detail/format`.
 */
export function SenderDetailPreviewModal({
  fixtureId,
  onClose,
}: {
  fixtureId: SenderDetailPreviewFixtureId | null;
  onClose: () => void;
}) {
  const now = useNow();

  useEffect(() => {
    if (fixtureId == null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fixtureId, onClose]);

  const detail = useMemo(
    () => (fixtureId == null ? null : buildSenderDetail(requireFixture(fixtureId))),
    [fixtureId],
  );

  if (detail == null) return null;

  const { sender, stats, recommendation, recentMessages, timeseries, history } = detail;
  const volumes = timeseries.map((p) => p.volume);
  const latestPoint = timeseries.length > 0 ? timeseries[timeseries.length - 1]! : null;
  const latestMonthAbbrev = latestPoint != null ? monthAbbrev(latestPoint.yearMonth) : null;
  const relationship = relationshipDisplay(stats.relationshipMonths);
  const timelineItems: TimelineItem[] = history.map((row, i) =>
    historyRowToTimelineItem(row, i === 0, now),
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${sender.name} — sender detail preview`}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(14,20,19,0.45)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '5vh 16px',
        overflowY: 'auto',
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: color.bg,
          borderRadius: 16,
          maxWidth: 720,
          width: '100%',
          padding: '24px 28px 28px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          position: 'relative',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close sender detail preview"
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            border: 'none',
            background: 'transparent',
            fontSize: 20,
            lineHeight: 1,
            cursor: 'pointer',
            color: color.fgMuted,
          }}
        >
          ×
        </button>

        <Eyebrow>Sample sender · not from your inbox</Eyebrow>

        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <Avatar name={sender.name} domain={sender.domain} size={56} hasMark={sender.brandMark} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span
              style={{
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: color.fgMuted,
                fontWeight: 500,
              }}
            >
              {detail.gmailCategory}
            </span>
            <h2 style={{ margin: 0 }}>
              <NumericDisplay value={sender.name} variant="display" />
            </h2>
            <span style={{ fontFamily: font.mono, fontSize: 12.5, color: color.fgMuted }}>
              {senderAddressLine(sender)}
            </span>
          </div>
        </div>

        <p style={{ margin: 0, fontSize: 14, color: color.fgSoft, lineHeight: 1.5 }}>
          {latestPoint != null
            ? `Sent ${latestPoint.volume} in ${latestMonthAbbrev}${
                stats.readRate !== null
                  ? `, ${formatReadRatePct(stats.readRate)}% marked read in the last 90 days`
                  : ''
              }.`
            : "Hasn't mailed you yet."}
        </p>

        {recommendation != null ? <RecommendationBanner recommendation={recommendation} /> : null}

        <KpiStrip
          cells={[
            {
              label: 'Volume',
              value: latestPoint != null ? latestPoint.volume : '—',
              unit: latestPoint != null ? latestMonthAbbrev : null,
              micro:
                latestPoint != null && volumes.length > 0 ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Spark values={volumes} />
                    <span>12 mo</span>
                  </div>
                ) : null,
            },
            {
              label: 'Read rate',
              value: stats.readRate !== null ? formatReadRatePct(stats.readRate) : '—',
              unit: stats.readRate !== null ? '%' : null,
              micro: stats.readRate === null ? 'no data yet' : 'of the last 90 days',
            },
            {
              label: 'Relationship',
              value: relationship.value,
              unit: relationship.unit,
              micro: relationship.since,
            },
          ]}
        />

        <RecentMessages messages={recentMessages} mailboxEmail={null} senderEmail={detail.email} />

        <DecisionTimeline
          heading="Decision timeline"
          empty={
            <EmptyState
              title="No actions on this sender yet"
              description="Sample activity — nothing here is from a real inbox."
            />
          }
          items={timelineItems}
        />

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
            borderTop: `1px solid ${color.line}`,
            paddingTop: 16,
          }}
        >
          <span style={{ fontSize: 12.5, color: color.fgMuted }}>
            Sample sender — see your real senders on the same page.
          </span>
          <TrackedCta href={oauthStartUrl()} cta="connect_gmail" placement="demo">
            Review my Gmail senders →
          </TrackedCta>
        </div>
      </div>
    </div>
  );
}
