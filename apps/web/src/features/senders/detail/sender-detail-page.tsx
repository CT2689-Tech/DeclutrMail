'use client';

import { useCallback, useMemo, useState } from 'react';
import { Button, EmptyState, tokens, toast } from '@declutrmail/shared';
import {
  historicCount,
  type ActionRequest,
  type ActionVerb,
  type Sender,
  VERB_PAST,
} from '../data';
import { ConfirmActionModal, type ConfirmOptions } from '../confirm-action-modal';
import { ReceiptStrip, type ActionReceipt } from '../receipt-strip';
import { SenderDetailHeader } from './header';
import { RecommendationBanner } from './recommendation-banner';
import { ActionToolbar } from './action-toolbar';
import { RecentMessages } from './recent-messages';
import { StatsStrip } from './stats-strip';
import { Charts } from './charts';
import { DecisionHistory } from './decision-history';
import type { DecisionHistoryRow, SenderDetail, SenderDetailState } from './types';
import { useSenderDetail } from '../api/use-sender-detail';
import { useSenderMessages } from '../api/use-sender-messages';
import { useSenderTimeseries } from '../api/use-sender-timeseries';
import { useSenderHistory } from '../api/use-sender-history';
import { adaptSenderDetail } from '../api/adapters';
import { ApiError } from '@/lib/api/client';

const { color, font } = tokens;

let receiptSeq = 0;

/**
 * Sender Detail page (D39 — strict layout order).
 *
 * Order (D39): Header → Recommendation banner → Action toolbar →
 * Recent messages → Stats strip → Charts → Decision history.
 *
 * Action lifecycle (D226): every destructive action routes through
 * `requestAction` → `<ConfirmActionModal>` (mandatory preview) →
 * `performAction` mutation → undo receipt strip. Keep / VIP / Protect
 * are non-destructive and fire immediately.
 *
 * Canonical verbs (D227): K/A/U/L only. The toolbar renders those
 * four; the recommendation banner highlights the verb the engine
 * suggests; the decision history surfaces past-tense forms.
 *
 * Privacy (D7): never fetches or stores message bodies. The recent
 * messages list shows sender + subject + Gmail snippet + dates only;
 * clicking a subject opens the thread in Gmail via the D41 deep link.
 *
 * Edge states (D211/D212): loading / error / not-found / ready are
 * each their own branch with a designed UI. Empty messages list and
 * empty history list are handled by their respective components.
 */
export function SenderDetailPage({ state }: { state: SenderDetailState }) {
  if (state.kind === 'loading') return <LoadingState />;
  if (state.kind === 'error') return <ErrorState message={state.message} />;
  return <ReadyState initial={state.detail} />;
}

/** Generic retry copy used when an error short-circuits without a more specific status. */
const GENERIC_RETRY_MESSAGE = "We couldn't load this sender right now.";

/**
 * Route-level wrapper that fans out the four sender-scoped queries
 * (detail / messages / timeseries / history) and folds them into the
 * `SenderDetailState` the page component already understands.
 *
 * Branching:
 *   - Any in-flight query → loading skeleton (the page is composed and
 *     the user reads it whole; partial reveals would be jarring).
 *   - Detail 404 → not-found UI (the children never fetch since
 *     `enabled` guards on `id.length > 0` only — but if the detail
 *     returns 404 we still don't render the page).
 *   - Detail error other than 404 → error UI with retry.
 *   - All four succeed → adapt + render the ready state.
 *
 * D211/D212 — every branch is its own designed UI; no spinners.
 */
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

  // 404 — render the not-found branch. We check `detail` only; if the
  // detail is missing the children are irrelevant.
  if (detail.error instanceof ApiError && detail.error.status === 404) {
    return <NotFoundState />;
  }

  // Any other detail error wins — show the error state with retry.
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

  // Children errors that don't propagate as `detail.isError` still leave
  // `adapted` null with `isLoading` false — without this branch the page
  // hangs on the loading skeleton forever (silent-failure-hunter finding
  // on PR #41). Surface the same error UI with a retry that re-runs all
  // four queries.
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
  // as useMutation calls that invalidate sendersKeys.detail(id) — the
  // architecture-guardian flagged this as a D200 violation in PR #41
  // review; deferred to the mutations PR because this PR's scope is
  // read-side wiring.
  const [detail, setDetail] = useState<SenderDetail>(initial);
  const [pendingAction, setPendingAction] = useState<ActionRequest | null>(null);
  const [receipt, setReceipt] = useState<ActionReceipt | null>(null);

  const { sender, recommendation, recentMessages, stats, timeseries, history } = detail;

  const performAction = useCallback(
    (verb: ActionVerb, senders: Sender[], opts?: ConfirmOptions) => {
      if (senders.length === 0) return;
      const historicTotal =
        verb === 'Archive' ||
        ((verb === 'Unsubscribe' || verb === 'Later') && opts?.archiveHistoric)
          ? senders.reduce((sum, s) => sum + historicCount(s), 0)
          : 0;
      toast(
        `${VERB_PAST[verb]} ${senders.length} sender${senders.length === 1 ? '' : 's'}`,
        verb === 'Unsubscribe' ? 'warn' : 'success',
      );
      if (verb !== 'Keep') {
        setReceipt({
          id: `r${++receiptSeq}`,
          verb,
          count: senders.length,
          historicTotal,
          timeLeft: '6d 23h',
        });
      }
      setPendingAction(null);
    },
    [],
  );

  // Mandatory preview gate (D226) — Archive / Unsubscribe / Later
  // open the modal; Keep + Protect change nothing destructive and
  // fire directly. The lifecycle here mirrors `senders-screen.tsx`.
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

  const handleHistoryUndo = useCallback((row: DecisionHistoryRow) => {
    toast(`Undo queued for op ${row.opId}`, 'info');
  }, []);

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

      {/* 1. Header */}
      <SenderDetailHeader
        sender={sender}
        gmailCategory={detail.gmailCategory}
        isVip={detail.isVip}
        isProtected={detail.isProtected}
        protectionReason={detail.protectionReason}
        onToggleVip={toggleVip}
        onToggleProtect={toggleProtect}
      />

      {/* 2. Recommendation banner */}
      <RecommendationBanner recommendation={recommendation} />

      {/* 3. Action toolbar (K/A/U/L per D227) */}
      <ActionToolbar sender={sender} recommendation={recommendation} onAction={requestAction} />

      {/* 4. Recent messages — opens in Gmail per D41 */}
      <RecentMessages messages={recentMessages} />

      {/* 5. Stats strip — 5 stats, single reflow row per D44 */}
      <StatsStrip stats={stats} />

      {/* 6. Volume + open-rate charts side-by-side per D45 */}
      <Charts timeseries={timeseries} />

      {/* 7. Decision history — 10 most recent actions per D46 */}
      <DecisionHistory history={history} senderId={sender.id} onUndo={handleHistoryUndo} />

      <ConfirmActionModal
        request={pendingAction}
        onCancel={closePending}
        onConfirm={confirmPending}
      />
    </div>
  );
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
      {[88, 60, 56, 220, 90, 200, 240].map((h, i) => (
        <div
          key={i}
          aria-hidden="true"
          style={{
            height: h,
            background: color.card,
            border: `1px solid ${color.lineSoft}`,
            borderRadius: 12,
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
  // `onRetry` lets the `SenderDetailRoute` branch re-run all four
  // sender-scoped queries in place — falls back to a page reload when
  // the caller doesn't wire one (e.g. the `SenderDetailPage` adapter
  // entry point that consumes a pre-built `SenderDetailState`).
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
