import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfirmActionModal } from '../features/senders/confirm-action-modal';
import { SenderActionRow } from '../features/senders/action-row';
import { makeSender } from '../features/senders/testing/make-sender';
import { ActionSheet } from '../features/triage/action-sheet';
import { InlinePreviewBlock } from '../features/triage/inline-preview';
import { BatchActionSheet } from '../features/triage/batch-action-sheet';
import { TRIAGE_QUEUE } from '../features/triage/fixtures';
import { DecidePreview } from '../features/screener/decide-preview';
import { SCREENER_QUEUE } from '../features/screener/data';
import { HomeFixDialog } from '../features/home/home-fix-dialog';
import { MailboxActionContextView } from '../features/auth/mailbox-action-context-view';
import { SendersSimulator } from '../features/marketing/inbox-simulator/senders-simulator';
import { pickBucketCount } from '../features/senders/action-window';
import scenarios from './scenarios.json';

// Evidence-only controller. Components, copy, gates and CSS come from each pinned source ref.
// All accounts, metadata, messages and accepted callbacks below are synthetic.
const scenario = scenarios.find(
  (item) => item.id === new URLSearchParams(location.search).get('case'),
);
if (!scenario) throw new Error('Unknown screenshot evidence case');
const c = scenario as Record<string, any>;
const NOW = '2026-10-21T19:00:00.000Z';
const MAILBOX = 'review@example.invalid';
const baseCount = c.count ?? 12;
const makeBuckets = (n: number) => ({
  all: n,
  olderThan30d: Math.floor(n * 0.8),
  olderThan90d: Math.floor(n * 0.6),
  olderThan180d: c.state === 'zero-window' || c.state === 'zero-one' ? 0 : Math.floor(n / 3),
  olderThan365d: c.state === 'missing-age' ? undefined : Math.floor(n / 12),
});
const counts = makeBuckets(c.state === 'zero' || c.state === 'zero-all' ? 0 : baseCount);
const allMailCounts = makeBuckets(c.state === 'zero-all' ? 0 : baseCount + 8);
const messages = {
  all: [],
  olderThan30d: [],
  olderThan90d: [],
  olderThan180d: [],
  olderThan365d: [],
};
const sender = makeSender({
  id: 'fixture-sender',
  name: 'Acme Newsletter',
  domain: 'acme.example',
  email: 'news@acme.example',
  unsubscribeMethod: c.method ?? 'one_click',
  inboxCount: c.rowCount === 'unknown' ? undefined : (c.rowCount ?? baseCount),
  totalReceived: 144,
  monthlyVolume: 12,
  brandMark: false,
  ...(c.protected
    ? { protectionFlags: { isProtected: true, protectionReason: 'manual', protectionSetAt: NOW } }
    : {}),
});
const second = makeSender({
  id: 'fixture-second',
  name: 'Beta Digest',
  domain: 'beta.example',
  email: 'digest@beta.example',
  unsubscribeMethod: 'one_click',
  inboxCount: baseCount,
  brandMark: false,
});
const third = makeSender({
  id: 'fixture-third',
  name: 'Studio Dispatch',
  domain: 'studio.example',
  email: 'news@studio.example',
  unsubscribeMethod: 'one_click',
  inboxCount: baseCount,
  brandMark: false,
});
const selection = c.bulk ? [sender, second, third] : [sender];
// Keep the action request stable while synthetic live counts refresh, as the
// production pending action does. A new request intentionally resets scope.
const request = {
  verb: c.verb,
  senders: selection,
  ...(c.alreadyUnsubscribed ? { skipped: { recordedUnsubscribeCount: 1 } } : {}),
};
const preview = {
  sender: {
    id: sender.id,
    name: sender.name,
    domain: sender.domain,
    lastSeenDays: c.lastSeenDays ?? 2,
    wroteToCount: 0,
  },
  counts,
  recentMessages: messages,
  ...(c.state !== 'missing-archived'
    ? { allMail: { counts: allMailCounts, recentMessages: messages } }
    : {}),
  unsubAvailable: true,
  protected: Boolean(c.protected),
};
const scale = (bucket: typeof counts, multiplier: number) =>
  Object.fromEntries(
    Object.entries(bucket).map(([key, value]) => [
      key,
      value === undefined ? undefined : value * multiplier,
    ]),
  );
const bulkData = {
  senders: selection.map((s, index) => ({
    senderId: s.id,
    name: s.name,
    counts,
    ...(c.state !== 'missing-archived' ? { allMailCounts } : {}),
    protected: c.excluded === true && index === 1,
  })),
  totals: scale(counts, c.excluded ? selection.length - 1 : selection.length),
  ...(c.state !== 'missing-archived'
    ? { allMailTotals: scale(allMailCounts, selection.length) }
    : {}),
  protectedCount: c.excluded ? 1 : 0,
};

function Fixture() {
  const [open, setOpen] = useState(false);
  const [accepted, setAccepted] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const [days, setDays] = useState<number | null>(c.age ?? (c.verb === 'Delete' ? 180 : null));
  const [reach, setReach] = useState<'inbox_only' | 'all_mail'>('inbox_only');
  const [mode, setMode] = useState<'unsub_only' | 'archive' | 'delete'>(c.mode ?? 'archive');
  const [rowCount, setRowCount] = useState<number | undefined>(
    c.rowCount === 'unknown' ? undefined : (c.rowCount ?? baseCount),
  );
  const [liveOverride, setLiveOverride] = useState<number | undefined>();
  const [dropAge, setDropAge] = useState(false);
  const [dropAllCounts, setDropAllCounts] = useState(false);
  const [menuRequest, setMenuRequest] = useState<any>(null);
  const [wakeAt, setWakeAt] = useState<string | null>(
    c.state === 'invalid-time' ? '2000-01-01T12:00:00.000Z' : '2026-10-28T19:00:00.000Z',
  );
  const accept = (payload: unknown) => {
    setAccepted(JSON.stringify(payload));
    setOpen(false);
    setMenuRequest(null);
  };
  const cancel = () => {
    setOpen(false);
    setMenuRequest(null);
  };
  const retry = () => setRetryCount((value) => value + 1);
  const loading = c.state === 'loading';
  const failed = c.state === 'error' || c.state === 'sender-gone';
  const row = {
    ...TRIAGE_QUEUE[0]!,
    id: 'fixture-row',
    senderId: sender.id,
    senderName: sender.name,
    senderDomain: sender.domain,
    brandMark: false,
    inboxCount: rowCount,
    unsubscribeMethod: c.method ?? 'one_click',
    protectionReason: c.protected ? 'manual' : null,
  };
  const currentCounts = dropAllCounts
    ? makeBuckets(0)
    : dropAge
      ? { ...counts, olderThan180d: undefined }
      : counts;
  const currentAllMailCounts = dropAllCounts ? makeBuckets(0) : allMailCounts;
  const currentPreview = {
    ...preview,
    counts: currentCounts,
    ...(preview.allMail ? { allMail: { ...preview.allMail, counts: currentAllMailCounts } } : {}),
  };
  const inboxNumber = liveOverride ?? pickBucketCount(currentCounts as any, days);
  const allMailNumber = pickBucketCount(currentAllMailCounts, days);
  const live = loading ? 'loading' : failed ? 'unavailable' : (inboxNumber ?? 'unavailable');
  const scopedLive =
    reach === 'all_mail' && !loading && !failed ? (allMailNumber ?? 'unavailable') : live;
  const ageControl = {
    olderThanDays: days,
    options: [null, 30, 90, 180, 365].map((value) => ({
      days: value,
      disabled: !loading && pickBucketCount(currentCounts as any, value) === undefined,
    })),
    onChange: setDays,
  };
  const detail = {
    inboxTotal: liveOverride ?? currentCounts.all,
    ageControl,
    reachControl: {
      reach,
      inboxCount: typeof inboxNumber === 'number' ? inboxNumber : null,
      allMailCount: c.state === 'missing-archived' || loading ? null : allMailNumber,
      onChange: setReach,
    },
    senderVolume: { received90d: 12, total: 144 },
  };
  useEffect(() => {
    const refresh = (event: KeyboardEvent) => {
      if (event.key !== 'F8') return;
      event.preventDefault();
      if (typeof c.refreshRowCount === 'number') setRowCount(c.refreshRowCount);
      if (typeof c.refreshLiveCount === 'number') setLiveOverride(c.refreshLiveCount);
      if (c.refreshMissingAge) setDropAge(true);
      if (c.refreshAllZero) setDropAllCounts(true);
    };
    window.addEventListener('keydown', refresh);
    return () => window.removeEventListener('keydown', refresh);
  }, []);
  return (
    <main style={{ maxWidth: c.surface === 'demo' ? 1200 : 720, margin: '0 auto', padding: 16 }}>
      <header style={{ marginBottom: 18, fontFamily: 'system-ui', fontSize: 14 }}>
        <p style={{ margin: '0 0 8px', color: '#4b5563' }}>
          Synthetic review fixture · no Gmail/provider connection
        </p>
        <h1 style={{ fontSize: 22, margin: '0 0 10px' }}>{c.title}</h1>
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setAccepted('');
          }}
        >
          Open review
        </button>
      </header>
      <output
        data-testid="accepted"
        aria-label="Synthetic accepted callback"
        style={{ display: 'block', overflowWrap: 'anywhere' }}
      >
        {accepted}
      </output>
      <output data-testid="retry-count" style={{ display: 'block' }}>
        {retryCount > 0 ? `Retry requested ${retryCount}` : ''}
      </output>
      {open && c.surface === 'senders' && (
        <ConfirmActionModal
          request={request}
          mailboxEmail={MAILBOX}
          compositePreview={!c.bulk && !loading && !failed ? (currentPreview as any) : undefined}
          compositePreviewLoading={loading}
          compositePreviewError={failed}
          previewSenderGone={c.state === 'sender-gone'}
          bulkPreview={
            c.bulk
              ? {
                  data: !loading && !failed ? (bulkData as any) : undefined,
                  loading,
                  error: failed,
                }
              : undefined
          }
          onCancel={cancel}
          onConfirm={accept}
          onRetryPreview={retry}
          onRefreshSenders={retry}
          submitting={c.state === 'submitting'}
        />
      )}
      {open && c.surface === 'home' && (
        <HomeFixDialog
          step={{
            kind: 'unsub_archive',
            senderCount: selection.length,
            senderName: c.bulk ? undefined : sender.name,
            emailCount: baseCount,
            senderIds: selection.map((s) => s.id),
          }}
          onCancel={cancel}
          onConfirm={() =>
            accept({
              mode: 'archive',
              emailCount: baseCount,
              senderIds: selection.map((s) => s.id),
            })
          }
        />
      )}
      {open && c.surface === 'triage' && (
        <ActionSheet
          open
          verb={c.verb}
          row={row as any}
          inboxCount={scopedLive as any}
          mailboxEmail={MAILBOX}
          wakeAt={wakeAt}
          reach={reach}
          onReachChange={setReach}
          onBacklogModeChange={(value) => {
            setMode(value);
            setDays(value === 'delete' ? 180 : null);
          }}
          detail={loading || failed ? undefined : (detail as any)}
          onCancel={cancel}
          onConfirm={accept}
          onRetryPreview={retry}
          previewSenderGone={c.state === 'sender-gone'}
          onRefreshTriage={retry}
        />
      )}
      {open && c.surface === 'inline' && (
        <InlinePreviewBlock
          row={row as any}
          busy={false}
          shortcutLive
          accountContext={<MailboxActionContextView mailboxEmail={MAILBOX} />}
          preview={{
            verb: c.verb,
            archiveHistoric: mode === 'archive',
            backlogMode: mode,
            onBacklogMode: setMode,
            inboxCount: scopedLive as any,
            ageControl,
            wakeAt,
            onWakeAtChange: setWakeAt,
            onCancel: cancel,
            onRetryPreview: retry,
          }}
          onConfirm={() => accept({ backlogMode: mode, olderThanDays: days, reach })}
        />
      )}
      {open && c.surface === 'screener' && (
        <DecidePreview
          verb={c.verb.toLowerCase()}
          row={
            {
              ...SCREENER_QUEUE[0]!,
              senderId: sender.id,
              senderName: sender.name,
              brandMark: false,
              protectionReason: c.protected ? 'manual' : null,
            } as any
          }
          inboxCount={scopedLive as any}
          inboxTotal={counts.all}
          windowDays={days}
          onWindowChange={setDays}
          allMailCount={c.state === 'missing-archived' ? null : (allMailNumber ?? null)}
          allMailTotal={allMailCounts.all}
          reach={reach}
          onReachChange={setReach}
          wakeAt={wakeAt}
          onWakeAtChange={setWakeAt}
          confirming={false}
          mailboxEmail={MAILBOX}
          onCancel={cancel}
          onConfirm={() => accept({ verb: c.verb, olderThanDays: days, reach })}
          onRetryPreview={retry}
        />
      )}
      {open && c.surface === 'batch' && (
        <BatchActionSheet
          open
          verb={c.verb}
          batch={
            {
              domain: c.recommended ? 'Archive-recommended' : 'example.invalid',
              startIndex: 0,
              rows: selection.map((s) => ({
                ...row,
                id: s.id,
                senderId: s.id,
                senderName: s.name,
              })),
              eligibleRows: selection.map((s) => ({
                ...row,
                id: s.id,
                senderId: s.id,
                senderName: s.name,
              })),
            } as any
          }
          preview={loading ? 'loading' : failed ? 'unavailable' : (bulkData as any)}
          olderThanDays={days}
          onWindowChange={setDays}
          wakeAt={wakeAt}
          onWakeAtChange={setWakeAt}
          mailboxEmail={MAILBOX}
          onCancel={cancel}
          onConfirm={() => accept({ verb: c.verb, olderThanDays: days, wakeAt })}
          onRetryPreview={retry}
          onRefreshTriage={retry}
        />
      )}
      {open && c.surface === 'menu' && (
        <section
          aria-label="Synthetic sender row"
          style={{ padding: 20, border: '1px solid #ddd', borderRadius: 12 }}
        >
          <p>{sender.name}</p>
          <SenderActionRow sender={sender} onAction={setMenuRequest} />
          <ConfirmActionModal
            request={menuRequest}
            mailboxEmail={MAILBOX}
            compositePreview={preview as any}
            onCancel={() => setMenuRequest(null)}
            onConfirm={accept}
          />
        </section>
      )}
      {open && c.surface === 'demo' && <SendersSimulator />}
      {(c.surface === 'screener' || c.surface === 'inline') && (
        <button type="button" data-testid="next-row" style={{ marginTop: 16 }}>
          Next row
        </button>
      )}
    </main>
  );
}
const root = document.getElementById('root');
if (!root) throw new Error('Evidence root missing');
createRoot(root).render(<Fixture />);
