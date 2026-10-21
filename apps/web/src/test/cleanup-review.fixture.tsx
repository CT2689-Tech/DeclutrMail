import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HomeFixDialog } from '../features/home/home-fix-dialog';
import { DecidePreview } from '../features/screener/decide-preview';
import { SCREENER_QUEUE } from '../features/screener/data';
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
  const [accepted, setAccepted] = useState('');
  const [days, setDays] = useState<number | null>(null);
  const [reach, setReach] = useState<'inbox_only' | 'all_mail'>('inbox_only');
  const cancel = () => setOpen(false);
  const accept = (payload: unknown) => {
    setAccepted(JSON.stringify(payload));
    setOpen(false);
  };
  const inboxCount = pickBucketCount(counts, days)!;
  const allMailCount = pickBucketCount(archived, days)!;
  return (
    <main style={{ maxWidth: 640, margin: 'auto', padding: 12 }}>
      <h1>Cleanup review fixture</h1>
      <button
        type="button"
        onClick={() => {
          setAccepted('');
          setDays(surface === 'screener' ? 180 : null);
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
          inboxCount={reach === 'all_mail' ? allMailCount : inboxCount}
          reach={reach}
          onReachChange={setReach}
          onCancel={cancel}
          onConfirm={accept}
          onBacklogModeChange={(mode) => setDays(mode === 'delete' ? 180 : null)}
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
          verb="delete"
          row={{ ...SCREENER_QUEUE[0]!, senderName: sender.name, brandMark: false }}
          inboxCount={inboxCount}
          inboxTotal={12}
          windowDays={days}
          onWindowChange={setDays}
          allMailCount={allMailCount}
          allMailTotal={20}
          reach={reach}
          onReachChange={setReach}
          confirming={false}
          onCancel={cancel}
          onConfirm={() => accept({ olderThanDays: days, reach })}
        />
      )}
      {surface === 'screener' && <button type="button">Next row</button>}
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('cleanup review fixture root missing');
createRoot(root).render(<Fixture />);
