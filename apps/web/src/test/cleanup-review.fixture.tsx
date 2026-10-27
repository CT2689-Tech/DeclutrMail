import { DEFAULT_DELETE_WINDOW_DAYS } from '@declutrmail/shared/actions';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HomeFixDialog } from '../features/home/home-fix-dialog';
import { DecidePreview } from '../features/screener/decide-preview';
import { SCREENER_QUEUE, type ScreenerDecideVerb } from '../features/screener/data';
import { makeSender } from '../features/senders/testing/make-sender';
import { UnsubscribeBacklogDialog } from '../features/senders/unsubscribe-backlog/unsubscribe-backlog-dialog';
import { ActionSheet } from '../features/triage/action-sheet';
import { TRIAGE_QUEUE } from '../features/triage/fixtures';
import { pickBucketCount } from '../features/senders/action-window';
import type { CompositeActionPreviewResult } from '../lib/api/use-action';

const sender = makeSender({
  id: 'fixture-sender',
  name: 'Fixture Newsletter',
  domain: 'example.invalid',
  unsubscribeMethod: 'one_click',
  inboxCount: 12,
  brandMark: false,
});
const counts = { all: 12, olderThan30d: 10, olderThan90d: 8, olderThan180d: 4, olderThan365d: 1 };
const archived = { ...counts, all: 20, olderThan180d: 7 };
const preview: CompositeActionPreviewResult = {
  sender: {
    id: sender.id,
    name: sender.name,
    domain: sender.domain,
    lastSeenDays: 2,
    wroteToCount: 0,
  },
  counts,
  recentMessages: {
    all: [],
    olderThan30d: [],
    olderThan90d: [],
    olderThan180d: [],
    olderThan365d: [],
  },
  allMail: {
    counts: archived,
    recentMessages: {
      all: [],
      olderThan30d: [],
      olderThan90d: [],
      olderThan180d: [],
      olderThan365d: [],
    },
  },
  unsubAvailable: true,
  protected: false,
};

/** Real production review components. Only account/telemetry boundaries are replaced by the spec. */
function Fixture() {
  const surface = new URLSearchParams(location.search).get('surface') ?? 'senders';
  const [open, setOpen] = useState(false);
  const [screenerVerb, setScreenerVerb] = useState<ScreenerDecideVerb>('delete');
  const [accepted, setAccepted] = useState('');
  const [days, setDays] = useState<number | null>(null);
  const [reach, setReach] = useState<'inbox_only' | 'all_mail'>('inbox_only');
  const cancel = () => setOpen(false);
  const accept = (payload: unknown) => {
    setAccepted(JSON.stringify(payload));
    setOpen(false);
  };
  const scenario = new URLSearchParams(location.search).get('scenario');
  const empty = { all: 0, olderThan30d: 0, olderThan90d: 0, olderThan180d: 0, olderThan365d: 0 };
  const inboxBuckets = scenario ? empty : counts;
  const allMailBuckets = scenario === 'empty' ? empty : scenario ? { ...empty, all: 2 } : archived;
  const inboxCount = pickBucketCount(inboxBuckets, days)!;
  const allMailCount = scenario === 'unavailable' ? null : pickBucketCount(allMailBuckets, days)!;
  return (
    <main style={{ maxWidth: 640, margin: 'auto', padding: 12 }}>
      <h1>Cleanup review fixture</h1>
      <button
        type="button"
        onClick={() => {
          setAccepted('');
          setScreenerVerb('delete');
          setDays(surface === 'screener' ? DEFAULT_DELETE_WINDOW_DAYS : null);
          setReach('inbox_only');
          setOpen(true);
        }}
      >
        Review {surface}
      </button>
      <output
        data-testid="accepted"
        aria-label="Accepted local payload"
        style={{ display: 'block', overflowWrap: 'anywhere' }}
      >
        {accepted}
      </output>
      {open && surface === 'senders' && (
        <UnsubscribeBacklogDialog
          mailboxEmail="fixture@example.invalid"
          request={{ verb: 'Unsubscribe', senders: [sender] }}
          compositePreview={preview}
          onCancel={cancel}
          onConfirm={accept}
        />
      )}
      {open && surface === 'triage' && (
        <ActionSheet
          open
          mailboxEmail="fixture@example.invalid"
          verb="Unsubscribe"
          row={{ ...TRIAGE_QUEUE[0]!, senderName: sender.name, inboxCount: 12 }}
          inboxCount={reach === 'all_mail' ? (allMailCount ?? 'unavailable') : inboxCount}
          reach={reach}
          onReachChange={setReach}
          onCancel={cancel}
          onConfirm={accept}
          onBacklogModeChange={(mode) =>
            setDays(mode === 'delete' ? DEFAULT_DELETE_WINDOW_DAYS : null)
          }
          detail={{
            inboxTotal: 12,
            ageControl: {
              olderThanDays: days,
              options: [null, 30, 90, 180, 365].map((days) => ({ days })),
              onChange: setDays,
            },
            reachControl: { reach, inboxCount, allMailCount, onChange: setReach },
          }}
        />
      )}
      {open && surface === 'home' && (
        <HomeFixDialog
          step={{
            kind: 'unsub_archive',
            senderCount: 1,
            senderName: sender.name,
            emailCount: 12,
            senderIds: [sender.id],
          }}
          onCancel={cancel}
          onConfirm={() => accept({ mode: 'archive', emailCount: 12, senderIds: [sender.id] })}
        />
      )}
      {open && surface === 'screener' && (
        <DecidePreview
          verb={screenerVerb}
          row={{ ...SCREENER_QUEUE[0]!, senderName: sender.name, brandMark: false }}
          inboxCount={inboxCount}
          inboxTotal={inboxBuckets.all}
          windowDays={days}
          onWindowChange={setDays}
          allMailCount={allMailCount}
          allMailTotal={scenario === 'unavailable' ? null : allMailBuckets.all}
          reach={reach}
          onReachChange={setReach}
          confirming={false}
          onCancel={cancel}
          onChooseDecision={(verb) => {
            setScreenerVerb(verb);
            setDays(null);
            setReach('inbox_only');
          }}
          onConfirm={() =>
            accept(
              screenerVerb === 'delete' ? { olderThanDays: days, reach } : { verb: screenerVerb },
            )
          }
        />
      )}
      {surface === 'screener' && <button type="button">Next row</button>}
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('cleanup review fixture root missing');
createRoot(root).render(<Fixture />);
