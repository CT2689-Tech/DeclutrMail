'use client';

import { useCallback, useMemo, useState } from 'react';
import { Avatar, Button, EmptyState, NumericDisplay, tokens, toast } from '@declutrmail/shared';
import { type ActionRequest, type ActionVerb, type Sender, VERB_PAST } from '../data';
import { ConfirmActionModal, type ConfirmOptions } from '../confirm-action-modal';
import { ReceiptStrip, type ActionReceipt } from '../receipt-strip';
import { RecommendationBanner } from './recommendation-banner';
import { ActionToolbar } from './action-toolbar';
import { RecentMessages } from './recent-messages';
import type { DecisionHistoryRow, SenderDetail, SenderDetailState } from './types';
import { useSenderDetail } from '../api/use-sender-detail';
import { useSenderMessages } from '../api/use-sender-messages';
import { useSenderTimeseries } from '../api/use-sender-timeseries';
import { useSenderHistory } from '../api/use-sender-history';
import { adaptSenderDetail } from '../api/adapters';
import { ApiError } from '@/lib/api/client';
import { DecisionTimeline, KpiStrip, type TimelineItem } from '../uplift-d';

const { color, font, radius, shadow, space } = tokens;

let receiptSeq = 0;

/**
 * Sender Detail page — Variant D composition per ADR-0012 (amends D39).
 *
 * Order (Variant D):
 *   1. Editorial hero card — avatar + name + meta + Fraunces narrative
 *      + per-message ROI + recommendation box + K/A/U/L toolbar +
 *      quiet "See full reasoning" disclosure.
 *   2. 4-cell KPI strip — Volume / Read rate / Relationship /
 *      Reading cost (replaces D44's 5-stat strip; absorbs the
 *      open-rate footnote previously in Charts).
 *   3. Recent messages (unchanged).
 *   4. Decision timeline — vertical timeline (replaces D46
 *      table-style history per ADR-0012).
 *
 * Removed from the surface (component files preserved on disk;
 * deletion deferred to a follow-up cleanup PR):
 *   - <StatsStrip> (replaced by <KpiStrip>)
 *   - <Charts> (heatmap + open-rate; founder feedback: "chart adds noise")
 *   - <DecisionHistory> table (replaced by <DecisionTimeline>)
 *   - <SenderDetailHeader> (inlined into the hero card composition)
 *
 * Action lifecycle (D226): every destructive action routes through
 * `requestAction` → `<ConfirmActionModal>` (mandatory preview) →
 * `performAction` mutation → undo receipt strip. Keep / VIP / Protect
 * are non-destructive and fire immediately.
 *
 * Canonical verbs (D227): K/A/U/L only.
 *
 * Privacy (D7): never fetches or stores message bodies. The recent
 * messages list shows sender + subject + Gmail snippet + dates only.
 *
 * Edge states (D211/D212): loading / error / not-found / ready are
 * each their own branch with a designed UI.
 */
export function SenderDetailPage({ state }: { state: SenderDetailState }) {
  if (state.kind === 'loading') return <LoadingState />;
  if (state.kind === 'error') return <ErrorState message={state.message} />;
  return <ReadyState initial={state.detail} />;
}

const GENERIC_RETRY_MESSAGE = "We couldn't load this sender right now.";

/**
 * Reading-cost coefficient — average minutes per email scanned. Matches
 * the placeholder in senders-screen.tsx so the hero ROI sentence and
 * the KPI strip stay consistent. Per-user calibration tracked in
 * FOUNDER-FOLLOWUPS as a follow-up.
 */
const READ_MIN_PER_MSG = 1.6;

export function SenderDetailRoute({ id }: { id: string }) {
  const detail = useSenderDetail(id);
  const messages = useSenderMessages(id);
  const timeseries = useSenderTimeseries(id);
  const history = useSenderHistory(id);

  const isLoading =
    detail.isLoading || messages.isLoading || timeseries.isLoading || history.isLoading;

  const adapted = useMemo(() => {
    if (!detail.data || !messages.data || !timeseries.data || !history.data) {
      return null;
    }
    return adaptSenderDetail({
      detail: detail.data.data,
      messages: messages.data.pages.flatMap((p) => p.data),
      timeseries: timeseries.data.data,
      history: history.data.pages.flatMap((p) => p.data),
    });
  }, [detail.data, messages.data, timeseries.data, history.data]);

  if (detail.error instanceof ApiError && detail.error.status === 404) {
    return <NotFoundState />;
  }

  if (detail.isError) {
    return (
      <ErrorState
        message={
          detail.error instanceof ApiError
            ? `We couldn't load this sender (HTTP ${detail.error.status}).`
            : GENERIC_RETRY_MESSAGE
        }
        onRetry={() => {
          detail.refetch();
          messages.refetch();
          timeseries.refetch();
          history.refetch();
        }}
      />
    );
  }

  const anyChildError = messages.isError || timeseries.isError || history.isError;
  if (anyChildError && adapted == null) {
    return (
      <ErrorState
        message={GENERIC_RETRY_MESSAGE}
        onRetry={() => {
          detail.refetch();
          messages.refetch();
          timeseries.refetch();
          history.refetch();
        }}
      />
    );
  }

  if (isLoading || adapted == null) {
    return <LoadingState />;
  }

  return <ReadyState initial={adapted} />;
}

function ReadyState({ initial }: { initial: SenderDetail }) {
  // TODO(D200): VIP/Protect toggles currently mutate local state and
  // will be clobbered by a TanStack Query refetch (window focus,
  // navigation). When the senders-mutations slice lands, wire these
  // as useMutation calls that invalidate sendersKeys.detail(id).
  const [detail, setDetail] = useState<SenderDetail>(initial);
  const [pendingAction, setPendingAction] = useState<ActionRequest | null>(null);
  const [receipt, setReceipt] = useState<ActionReceipt | null>(null);

  const { sender, recommendation, recentMessages, stats, history } = detail;

  const performAction = useCallback(
    (verb: ActionVerb, senders: Sender[], _opts?: ConfirmOptions) => {
      if (senders.length === 0) return;
      // Tracer path — fake receipt until this surface's verb BE lands. No
      // fabricated email count (the former `monthly × 12`); the true number
      // comes from the worker once the verb is wired.
      toast(
        `${VERB_PAST[verb]} ${senders.length} sender${senders.length === 1 ? '' : 's'}`,
        verb === 'Unsubscribe' ? 'warn' : 'success',
      );
      if (verb !== 'Keep') {
        setReceipt({
          id: `r${++receiptSeq}`,
          verb,
          count: senders.length,
          historicTotal: 0,
          timeLeft: '6d 23h',
        });
      }
      setPendingAction(null);
    },
    [],
  );

  const requestAction = useCallback(
    (req: ActionRequest) => {
      if (req.senders.length === 0) return;
      if (req.verb === 'Archive' || req.verb === 'Unsubscribe' || req.verb === 'Later') {
        setPendingAction(req);
      } else {
        performAction(req.verb, req.senders);
      }
    },
    [performAction],
  );

  const closePending = useCallback(() => setPendingAction(null), []);
  const confirmPending = useCallback(
    (opts: ConfirmOptions) => {
      if (pendingAction) performAction(pendingAction.verb, pendingAction.senders, opts);
    },
    [pendingAction, performAction],
  );

  const toggleVip = useCallback(() => {
    setDetail((d) => ({ ...d, isVip: !d.isVip }));
    toast(detail.isVip ? 'Removed VIP mark' : 'Marked VIP', 'info');
  }, [detail.isVip]);

  const toggleProtect = useCallback(() => {
    setDetail((d) => {
      const next = !d.isProtected;
      return {
        ...d,
        isProtected: next,
        protectionReason: next ? (d.protectionReason ?? 'user-marked') : null,
      };
    });
    toast(detail.isProtected ? 'Unprotected' : 'Protected', 'info');
  }, [detail.isProtected]);

  // Derived ROI sentence numbers. Reading-cost in minutes/month;
  // yearly savings if the user unsubscribes (cleanup cohort only).
  const monthlyMins = Math.round(stats.monthlyVolume * READ_MIN_PER_MSG);
  const yearlySavedHrs = ((stats.monthlyVolume * 12 * READ_MIN_PER_MSG) / 60).toFixed(1);

  // Adapt history rows to the DecisionTimeline shape. Newest first; the
  // most-recent row carries the `current` flag so its node renders
  // filled + with a soft halo per ADR-0010.
  const timelineItems = useMemo<TimelineItem[]>(
    () => history.map((row, i) => historyRowToTimelineItem(row, i === 0)),
    [history],
  );

  return (
    <div
      style={{
        padding: '20px 24px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        maxWidth: 1180,
        margin: '0 auto',
        fontFamily: font.sans,
      }}
    >
      <ReceiptStrip
        receipt={receipt}
        onUndo={() => {
          toast('Reverted — see Activity for the full log', 'info');
          setReceipt(null);
        }}
        onDismiss={() => setReceipt(null)}
      />

      {/* 1. Editorial hero card — name, narrative, ROI, recommendation, actions */}
      <section
        style={{
          background: color.card,
          border: `1px solid ${color.line}`,
          borderRadius: 20,
          padding: '28px 32px',
          boxShadow: shadow.pop,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            background: `radial-gradient(circle at 100% 0%, ${color.primaryWash} 0%, transparent 50%)`,
            pointerEvents: 'none',
          }}
        />
        {/* Avatar + identity strip */}
        <div
          style={{
            display: 'flex',
            gap: 22,
            alignItems: 'center',
            marginBottom: 22,
            position: 'relative',
          }}
        >
          <Avatar name={sender.name} domain={sender.domain} size={72} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
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
            {/* ADR-0016 §A1 — sender name uses `NumericDisplay
                variant="display"` (Fraunces 28/400/-0.025em) so the
                Detail h1 scale matches the SenderTable total cell +
                Hero slice headline. Card↔Detail navigation now lands
                on a consistent display-numeric scale. Was ad-hoc
                28px/600 w/ system default font fallback. */}
            <h1 style={{ margin: 0 }}>
              <NumericDisplay value={sender.name} variant="display" />
            </h1>
            <span
              style={{
                fontFamily: font.mono,
                fontSize: 12.5,
                color: color.fgMuted,
              }}
            >
              {sender.domain}
            </span>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: space[2] }}>
            <Button
              tone={detail.isVip ? 'primary' : 'default'}
              size="sm"
              onClick={toggleVip}
              aria-pressed={detail.isVip}
            >
              {detail.isVip ? '★ VIP' : 'VIP'}
            </Button>
            <Button
              tone={detail.isProtected ? 'primary' : 'default'}
              size="sm"
              onClick={toggleProtect}
              aria-pressed={detail.isProtected}
            >
              {detail.isProtected ? '◆ Protect' : 'Protect'}
            </Button>
          </div>
        </div>

        {/* Fraunces narrative — ADR-0011 hero-surface editorial relaxation */}
        <p
          style={{
            fontFamily: font.display,
            fontSize: 24,
            lineHeight: 1.32,
            fontWeight: 500,
            color: color.fgSoft,
            margin: '0 0 14px',
            maxWidth: 720,
            position: 'relative',
          }}
        >
          Mails you{' '}
          <span style={{ color: color.fg, fontWeight: 600 }}>{stats.monthlyVolume}×/mo</span>. You
          read{' '}
          <span style={{ color: color.fg, fontWeight: 600 }}>
            {Math.round(stats.readRate * 100)}%
          </span>{' '}
          of what they send.
        </p>

        {/* ROI sentence */}
        <p
          style={{
            fontSize: 13.5,
            color: color.amber,
            fontWeight: 500,
            margin: '0 0 18px',
            position: 'relative',
          }}
        >
          ↘ Estimated reading cost: {monthlyMins} min/month. Unsubscribing saves ~{yearlySavedHrs}h
          /year.
        </p>

        {/* Recommendation banner (existing component, sits inside hero now) */}
        <div style={{ position: 'relative', marginBottom: 18 }}>
          <RecommendationBanner recommendation={recommendation} />
        </div>

        {/* K/A/U/L toolbar (existing) */}
        <div style={{ position: 'relative' }}>
          <ActionToolbar sender={sender} recommendation={recommendation} onAction={requestAction} />
        </div>

        {/* Quiet reasoning disclosure (per ADR-0011 — out of the rec box) */}
        <p
          style={{
            marginTop: 12,
            fontSize: 12,
            color: color.fgMuted,
            position: 'relative',
          }}
        >
          <a
            href="#reasoning"
            style={{
              color: color.fgMuted,
              textDecoration: 'underline',
              textUnderlineOffset: 2,
            }}
          >
            See full reasoning ›
          </a>{' '}
          · how the engine decided
        </p>
      </section>

      {/* 2. 4-cell KPI strip — replaces D44 5-stat strip; absorbs open-rate footnote */}
      <KpiStrip
        cells={[
          {
            label: 'Volume',
            value: stats.monthlyVolume,
            unit: '/mo',
            micro: trendCaption(stats.volumeTrend),
          },
          {
            label: 'Read rate',
            value: Math.round(stats.readRate * 100),
            unit: '%',
            micro:
              stats.readRate < 0.2
                ? 'below 20%'
                : `${Math.round(stats.readRate * 100)}% marked read`,
          },
          {
            label: 'Relationship',
            value: relationshipDisplay(stats.relationshipMonths).value,
            unit: relationshipDisplay(stats.relationshipMonths).unit,
            micro: relationshipDisplay(stats.relationshipMonths).since,
          },
          {
            label: 'Reading cost',
            value: monthlyMins,
            unit: 'min/mo',
            micro: `~${yearlySavedHrs}h/year`,
          },
        ]}
      />

      {/* 3. Recent messages (unchanged) */}
      <RecentMessages messages={recentMessages} />

      {/* 4. Decision timeline — replaces D46 table-style history */}
      <DecisionTimeline heading="Decision timeline" items={timelineItems} />

      <ConfirmActionModal
        request={pendingAction}
        onCancel={closePending}
        onConfirm={confirmPending}
      />
    </div>
  );
}

/* ────────────────── HELPERS ────────────────── */

function trendCaption(trend: SenderDetail['stats']['volumeTrend']): string | undefined {
  if (trend == null) return undefined;
  switch (trend) {
    case 'new':
      return 'New sender';
    case 'up':
      return '↑ up vs prior 3mo';
    case 'down':
      return '↓ down vs prior 3mo';
    case 'dormant':
      return 'Dormant — no recent volume';
    case 'steady':
      return 'Steady vs prior 3mo';
  }
}

function relationshipDisplay(months: number) {
  if (months < 12) {
    return {
      value: months,
      unit: months === 1 ? 'mo' : 'mo',
      since: months === 0 ? 'New' : `Since ${months} month${months === 1 ? '' : 's'} ago`,
    };
  }
  const years = Math.floor(months / 12);
  return {
    value: years,
    unit: years === 1 ? 'yr' : 'yr',
    since: `${months} months`,
  };
}

function historyRowToTimelineItem(row: DecisionHistoryRow, isCurrent: boolean): TimelineItem {
  const when = formatRelative(row.at);
  return {
    id: row.id,
    when,
    current: isCurrent,
    what: (
      <>
        <span style={{ color: '#4B5552' }}>{row.source}</span> <strong>{row.action}</strong>
        {row.count != null && (
          <span style={{ color: '#646D69', fontSize: 11.5 }}> · {row.count} messages</span>
        )}{' '}
        <span style={{ color: '#646D69', fontSize: 11.5 }}>· op {row.opId}</span>
      </>
    ),
  };
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const days = Math.max(0, Math.round((now - then) / (1000 * 60 * 60 * 24)));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.round(days / 7)}w ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}yr ago`;
}

function LoadingState() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        padding: '20px 24px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        maxWidth: 1180,
        margin: '0 auto',
        fontFamily: font.sans,
      }}
    >
      {[280, 90, 220, 240].map((h, i) => (
        <div
          key={i}
          aria-hidden="true"
          style={{
            height: h,
            background: color.card,
            border: `1px solid ${color.lineSoft}`,
            borderRadius: radius.lg,
            backgroundImage: `linear-gradient(90deg, ${color.lineSoft} 0%, rgba(14,20,19,0.03) 50%, ${color.lineSoft} 100%)`,
            backgroundSize: '200% 100%',
            backgroundPosition: '0 0',
          }}
        />
      ))}
      <span style={{ position: 'absolute', left: -9999 }}>Loading sender details</span>
    </div>
  );
}

function NotFoundState() {
  return (
    <div
      style={{
        padding: '20px 24px 28px',
        maxWidth: 720,
        margin: '0 auto',
        fontFamily: font.sans,
      }}
    >
      <EmptyState
        title="Sender not found"
        body="This sender isn't in your mailbox — either the URL is stale, or the sender hasn't mailed you yet."
        action={
          <Button tone="primary" onClick={() => window.history.back()}>
            Back to Senders
          </Button>
        }
      />
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const handleRetry = onRetry ?? (() => window.location.reload());
  return (
    <div
      style={{
        padding: '20px 24px 28px',
        maxWidth: 720,
        margin: '0 auto',
        fontFamily: font.sans,
      }}
    >
      <EmptyState
        title="We couldn't load this sender"
        body={message}
        action={
          <Button tone="primary" onClick={handleRetry}>
            Try again
          </Button>
        }
      />
    </div>
  );
}
