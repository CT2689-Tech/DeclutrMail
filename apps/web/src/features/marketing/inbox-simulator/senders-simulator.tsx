'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, PreviewSheet, SheetFactList, ToastHost, toast } from '@declutrmail/shared';
import { MIN_UNDO_WINDOW_DAYS } from '@declutrmail/shared/entitlements';
import { defaultLaterWakeAtIso } from '@declutrmail/shared/actions';
import { WS2_COPY, WS3_COPY, WS5_COPY } from '@declutrmail/shared/copy/launch';

import { ActionReachControl } from '@/components/action-scope-controls';
import { InboxReportPanel } from '@/features/inbox-report/panel';
import type { ActionRequest } from '@/features/senders/data';
import { UnsubscribeBacklogDialog } from '@/features/senders/unsubscribe-backlog/unsubscribe-backlog-dialog';
import {
  unsubscribeBacklogActivityLine,
  unsubscribeBacklogToast,
} from '@/features/senders/unsubscribe-backlog/toast';
import type { UnsubscribeBacklogResult } from '@/lib/api/actions';

import { sampleInboxReport } from './sample-report';
import './senders-simulator.css';

type Verb = 'Keep' | 'Archive' | 'Unsubscribe' | 'Later' | 'Delete';
type MailPlace = 'inbox' | 'archived';
type Reach = 'inbox_only' | 'all_mail';
type Backlog = 'none' | 'archive' | 'delete';
type Filter = 'active' | 'all' | 'quiet' | 'protected' | 'unsubscribe';

interface SampleSender {
  id: string;
  name: string;
  email: string;
  category: string;
  lastSeenDays: number;
  received90d: number;
  totalReceived: number;
  markedRead: number;
  wroteTo: number;
  protected: boolean;
  unsubscribe: 'one_click' | 'mailto' | 'none';
  subjects: readonly string[];
  // Buckets are the current sample emails at ages 12, 45, 120, 240 and 420 days.
  inbox: readonly number[];
  archived: readonly number[];
  unsubRequested?: boolean;
  kept?: boolean;
}

const AGES = [12, 45, 120, 240, 420] as const;
const WINDOWS = [
  { label: 'All inbox', days: null },
  { label: '30 days+', days: 30 },
  { label: '3 months+', days: 90 },
  { label: '6 months+', days: 180 },
  { label: '1 year+', days: 365 },
] as const;

const INITIAL_SENDERS: readonly SampleSender[] = [
  {
    id: 'northstar',
    name: 'Northstar Weekly',
    email: 'hello@northstar.example',
    category: 'Newsletter',
    lastSeenDays: 2,
    received90d: 46,
    totalReceived: 389,
    markedRead: 18,
    wroteTo: 0,
    protected: false,
    unsubscribe: 'one_click',
    subjects: ['Your Sunday reading list', 'What changed this week', 'A note from our editors'],
    inbox: [26, 22, 18, 31, 14],
    archived: [12, 19, 21, 48, 62],
  },
  {
    id: 'market',
    name: 'Market Finds',
    email: 'offers@market.example',
    category: 'Promotion',
    lastSeenDays: 1,
    received90d: 83,
    totalReceived: 652,
    markedRead: 5,
    wroteTo: 0,
    protected: false,
    unsubscribe: 'one_click',
    subjects: ['A deal picked for you', 'Last chance this week', 'Your saved items'],
    inbox: [41, 37, 34, 52, 27],
    archived: [9, 13, 28, 79, 98],
  },
  {
    id: 'trail',
    name: 'Trail Journal',
    email: 'stories@trail.example',
    category: 'Newsletter',
    lastSeenDays: 6,
    received90d: 21,
    totalReceived: 174,
    markedRead: 72,
    wroteTo: 1,
    protected: false,
    unsubscribe: 'one_click',
    subjects: ['A route for the weekend', 'Gear notes', 'The long way home'],
    inbox: [9, 7, 12, 8, 4],
    archived: [7, 18, 24, 39, 46],
  },
  {
    id: 'receipts',
    name: 'Parcel Receipts',
    email: 'receipts@parcel.example',
    category: 'Transactional',
    lastSeenDays: 3,
    received90d: 14,
    totalReceived: 218,
    markedRead: 89,
    wroteTo: 2,
    protected: true,
    unsubscribe: 'none',
    subjects: ['Your order receipt', 'Delivery update', 'Order confirmation'],
    inbox: [3, 4, 5, 2, 1],
    archived: [8, 13, 22, 37, 44],
  },
  {
    id: 'studio',
    name: 'Studio Dispatch',
    email: 'dispatch@studio.example',
    category: 'Newsletter',
    lastSeenDays: 52,
    received90d: 6,
    totalReceived: 96,
    markedRead: 28,
    wroteTo: 0,
    protected: false,
    unsubscribe: 'one_click',
    subjects: ['Spring notes', 'A new collection', 'From the studio'],
    inbox: [0, 5, 7, 8, 6],
    archived: [0, 4, 10, 22, 29],
  },
  {
    id: 'catalog',
    name: 'Catalog Club',
    email: 'news@catalog.example',
    category: 'Promotion',
    lastSeenDays: 203,
    received90d: 0,
    totalReceived: 141,
    markedRead: 12,
    wroteTo: 0,
    protected: false,
    unsubscribe: 'one_click',
    subjects: ['A note from last season', 'Your member update', 'New in store'],
    inbox: [0, 0, 0, 11, 13],
    archived: [0, 0, 0, 33, 58],
  },
];

interface Pending {
  ids: readonly string[];
  verb: Exclude<Verb, 'Keep'>;
  skipped: number;
}

interface DemoActivity {
  id: number;
  senderNames: string;
  verb: Verb;
  affected: number;
  summary: string;
  note: string | null;
  before: readonly SampleSender[];
  undoable: boolean;
  undone: boolean;
  superseded: boolean;
}

function count(sender: SampleSender, place: MailPlace, olderThanDays: number | null): number {
  return sender[place].reduce(
    (total, value, index) =>
      total + (olderThanDays === null || AGES[index]! > olderThanDays ? value : 0),
    0,
  );
}

function actionCount(sender: SampleSender, reach: Reach, olderThanDays: number | null): number {
  return (
    count(sender, 'inbox', olderThanDays) +
    (reach === 'all_mail' ? count(sender, 'archived', olderThanDays) : 0)
  );
}

function totalCount(senders: readonly SampleSender[], reach: Reach, days: number | null): number {
  return senders.reduce((total, sender) => total + actionCount(sender, reach, days), 0);
}

function previewBuckets(senders: readonly SampleSender[], reach: Reach) {
  return {
    all: totalCount(senders, reach, null),
    olderThan30d: totalCount(senders, reach, 30),
    olderThan90d: totalCount(senders, reach, 90),
    olderThan180d: totalCount(senders, reach, 180),
    olderThan365d: totalCount(senders, reach, 365),
  };
}

function moveMail(
  sender: SampleSender,
  verb: 'archive' | 'delete' | 'later',
  reach: Reach,
  days: number | null,
): SampleSender {
  const inbox = [...sender.inbox];
  const archived = [...sender.archived];
  AGES.forEach((age, index) => {
    if (days !== null && age <= days) return;
    const moved = inbox[index]!;
    inbox[index] = 0;
    if (verb === 'archive') archived[index] = archived[index]! + moved;
    if (verb === 'delete' && reach === 'all_mail') archived[index] = 0;
  });
  return { ...sender, inbox, archived };
}

function fmt(value: number): string {
  return value.toLocaleString('en-US');
}

function summaryFor(sender: SampleSender): string {
  return `${fmt(count(sender, 'inbox', null))} in inbox · ${fmt(sender.received90d)} in last 90 days`;
}

function localDateTime(iso: string): string {
  const date = new Date(iso);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** Public, local-only Senders simulation. The production workspace remains the source of truth. */
export function SendersSimulator() {
  const [senders, setSenders] = useState<readonly SampleSender[]>(INITIAL_SENDERS);
  const [selectedId, setSelectedId] = useState('northstar');
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('active');
  const [sort, setSort] = useState<'received' | 'recent' | 'name'>('received');
  const [pending, setPending] = useState<Pending | null>(null);
  const [backlog, setBacklog] = useState<Backlog>('none');
  const [reach, setReach] = useState<Reach>('inbox_only');
  const [olderThanDays, setOlderThanDays] = useState<number | null>(null);
  const [wakeAt, setWakeAt] = useState('');
  const [activity, setActivity] = useState<readonly DemoActivity[]>([]);
  const [activityOpen, setActivityOpen] = useState(false);
  const [reportDismissed, setReportDismissed] = useState(false);
  const [celebration, setCelebration] = useState<{ archived: number; senders: number } | null>(
    null,
  );
  const activitySequence = useRef(0);

  const visible = useMemo(
    () =>
      senders
        .filter((sender) => {
          const textMatch = `${sender.name} ${sender.email}`
            .toLowerCase()
            .includes(query.toLowerCase().trim());
          const filterMatch =
            filter === 'all' ||
            (filter === 'active' && sender.lastSeenDays <= 30) ||
            (filter === 'quiet' && sender.lastSeenDays > 30) ||
            (filter === 'protected' && sender.protected) ||
            (filter === 'unsubscribe' && sender.unsubscribe === 'one_click');
          return textMatch && filterMatch;
        })
        .sort((a, b) =>
          sort === 'name'
            ? a.name.localeCompare(b.name)
            : sort === 'recent'
              ? a.lastSeenDays - b.lastSeenDays
              : b.totalReceived - a.totalReceived,
        ),
    [filter, query, senders, sort],
  );
  const selectedSender = visible.find((sender) => sender.id === selectedId) ?? visible[0] ?? null;
  const report = useMemo(
    () =>
      sampleInboxReport(
        senders.map((sender) => ({
          id: sender.id,
          received90d: sender.received90d,
          totalReceived: sender.totalReceived,
          markedReadPct: sender.markedRead,
          wroteTo: sender.wroteTo,
          protected: sender.protected,
          unsubscribe: sender.unsubscribe,
          inboxCount: count(sender, 'inbox', null),
          ...(sender.kept ? { kept: true } : {}),
        })),
      ),
    [senders],
  );
  const pendingSenders = pending ? senders.filter((sender) => pending.ids.includes(sender.id)) : [];
  const isUnsubscribe = pending?.verb === 'Unsubscribe';
  const mailVerb = pending?.verb === 'Unsubscribe' ? backlog : pending?.verb.toLowerCase();
  const canMove = mailVerb === 'archive' || mailVerb === 'delete' || mailVerb === 'later';
  const canWiden = mailVerb === 'delete';
  const activeReach: Reach = canWiden ? reach : 'inbox_only';
  const previewCount = canMove ? totalCount(pendingSenders, activeReach, olderThanDays) : 0;
  // A zero historic bucket never blocks an unsubscribe: future mail is
  // still the primary action, exactly as in the connected preview.
  const canConfirm =
    pending !== null &&
    (isUnsubscribe || !canMove || previewCount > 0) &&
    (pending.verb !== 'Later' || Date.parse(wakeAt) > Date.now());
  const pendingNames =
    pendingSenders.length === 1 ? pendingSenders[0]!.name : `${pendingSenders.length} senders`;

  const openAction = (verb: Verb, ids: readonly string[]) => {
    if (verb === 'Keep') {
      const before = senders.filter((sender) => ids.includes(sender.id));
      setSenders((current) =>
        current.map((sender) => (ids.includes(sender.id) ? { ...sender, kept: true } : sender)),
      );
      setActivity((current) => [
        {
          id: ++activitySequence.current,
          senderNames: before.length === 1 ? before[0]!.name : `${before.length} senders`,
          verb,
          affected: 0,
          summary: 'Keep decision recorded. No existing email moved.',
          note: null,
          before,
          undoable: false,
          undone: false,
          superseded: false,
        },
        ...current,
      ]);
      setSelected([]);
      return;
    }
    const candidates = senders.filter((sender) => ids.includes(sender.id));
    const eligible = ids.length > 1 ? candidates.filter((sender) => !sender.protected) : candidates;
    const actionables =
      verb === 'Unsubscribe'
        ? eligible.filter((sender) => sender.unsubscribe === 'one_click')
        : eligible;
    if (actionables.length === 0) return;
    setPending({
      ids: actionables.map((sender) => sender.id),
      verb,
      skipped: candidates.length - actionables.length,
    });
    setBacklog(
      verb === 'Unsubscribe' && totalCount(actionables, 'inbox_only', null) > 0
        ? 'archive'
        : 'none',
    );
    setReach('inbox_only');
    setOlderThanDays(verb === 'Delete' ? 180 : null);
    setWakeAt(verb === 'Later' ? localDateTime(defaultLaterWakeAtIso()) : '');
  };

  const closePreview = () => {
    setPending(null);
  };

  const applyUnsubscribe = (
    targets: readonly SampleSender[],
    mode: 'archive' | 'delete' | 'unsub_only',
    requestedReach: Reach = 'inbox_only',
    requestedWindow: number | null = null,
  ) => {
    if (targets.length === 0) return;
    const ids = new Set(targets.map((sender) => sender.id));
    const scope = mode === 'delete' ? requestedReach : 'inbox_only';
    const n = totalCount(targets, scope, requestedWindow);
    setSenders((current) =>
      current.map((sender) => {
        if (!ids.has(sender.id)) return sender;
        const moved =
          mode === 'archive' || mode === 'delete'
            ? moveMail(sender, mode, scope, requestedWindow)
            : sender;
        return { ...moved, unsubRequested: true };
      }),
    );
    const result: UnsubscribeBacklogResult = {
      mode,
      backlog: mode === 'unsub_only' ? null : { actionId: 'sample', requestedCount: n, verb: mode },
      senders: targets.map((sender) => ({
        senderId: sender.id,
        method: sender.unsubscribe === 'none' ? 'none' : sender.unsubscribe,
        mailtoUrl: null,
        executionActionId: null,
        lifecycleStatus: null,
        unsubStatus: sender.unsubscribe === 'mailto' ? 'manual' : 'requested',
        reasonCode: null,
      })),
    };
    const line = unsubscribeBacklogToast(result);
    if (line !== '') toast(line);
    const summary = unsubscribeBacklogActivityLine(result);
    const note =
      mode === 'delete'
        ? WS5_COPY['f1.honesty.delete']
        : mode === 'archive'
          ? WS5_COPY['f1.honesty.archive']
          : null;
    setActivity((current) => [
      {
        id: ++activitySequence.current,
        senderNames: targets.length === 1 ? targets[0]!.name : `${targets.length} senders`,
        verb: 'Unsubscribe',
        affected: n,
        summary,
        note,
        before: targets,
        undoable: n > 0 && mode !== 'unsub_only',
        undone: false,
        superseded: false,
      },
      ...current.map((item) =>
        item.undoable && item.before.some((old) => ids.has(old.id))
          ? { ...item, undoable: false, superseded: true }
          : item,
      ),
    ]);
    if (mode === 'archive') setCelebration({ archived: n, senders: targets.length });
    setSelected([]);
    setActivityOpen(true);
    setPending(null);
  };

  const confirm = () => {
    if (!pending || !canConfirm || isUnsubscribe) return;
    const before = pendingSenders;
    const effectiveMailVerb = mailVerb;
    const next = senders.map((sender) => {
      if (!pending.ids.includes(sender.id)) return sender;
      let changed = sender;
      if (
        effectiveMailVerb === 'archive' ||
        effectiveMailVerb === 'delete' ||
        effectiveMailVerb === 'later'
      ) {
        changed = moveMail(changed, effectiveMailVerb, activeReach, olderThanDays);
      }
      return changed;
    });
    const destination =
      effectiveMailVerb === 'delete'
        ? 'Gmail Trash'
        : effectiveMailVerb === 'later'
          ? 'Later'
          : 'Gmail All Mail';
    const summary = `${fmt(previewCount)} sample emails moved to ${destination}.${pending.verb === 'Later' ? ` Return time: ${wakeAt.replace('T', ' ')} local.` : ''}`;
    setSenders(next);
    setActivity((current) => [
      {
        id: ++activitySequence.current,
        senderNames: pendingNames,
        verb: pending.verb,
        affected: previewCount,
        summary,
        note: null,
        before,
        undoable: previewCount > 0,
        undone: false,
        superseded: false,
      },
      ...current.map((item) =>
        item.undoable && item.before.some((old) => pending.ids.includes(old.id))
          ? { ...item, undoable: false, superseded: true }
          : item,
      ),
    ]);
    setSelected([]);
    setActivityOpen(true);
    closePreview();
  };

  const undo = (entry: DemoActivity) => {
    if (!entry.undoable || entry.undone) return;
    setSenders((current) =>
      current.map((sender) => {
        const original = entry.before.find((item) => item.id === sender.id);
        return original
          ? { ...original, ...(sender.unsubRequested ? { unsubRequested: true } : {}) }
          : sender;
      }),
    );
    setActivity((current) =>
      current.map((item) => (item.id === entry.id ? { ...item, undone: true } : item)),
    );
  };

  const senderNames = Object.fromEntries(
    senders.map((sender) => [
      sender.id,
      { name: sender.name, unsubscribeMethod: sender.unsubscribe },
    ]),
  );

  useEffect(() => {
    if (!pending || isUnsubscribe) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && canConfirm) {
        event.preventDefault();
        confirm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, isUnsubscribe, canConfirm, confirm]);

  return (
    <div className="dm-senders-demo">
      <div className="dm-senders-demo-note">{WS3_COPY['ws3.demo.senders.note']}</div>
      <InboxReportPanel
        report={report}
        mailboxEmail="you@example.com"
        dismissed={reportDismissed}
        senderNames={senderNames}
        fixPreviewCounts={{
          inbox: previewBuckets(
            senders.filter((s) => report.fix.senderKeys.includes(s.id)),
            'inbox_only',
          ),
          allMail: previewBuckets(
            senders.filter((s) => report.fix.senderKeys.includes(s.id)),
            'all_mail',
          ),
        }}
        celebration={celebration}
        onDismiss={() => setReportDismissed(true)}
        onReopen={() => setReportDismissed(false)}
        onReview={() => {
          const ids = report.fix.senderKeys;
          const first = ids[0];
          if (first) setSelectedId(first);
          setSelected(ids);
        }}
        trustHref="/privacy"
        onFixConfirmed={(mode, scope, senderIds, days) => {
          const included = new Set(senderIds);
          applyUnsubscribe(
            senders.filter((sender) => included.has(sender.id)),
            mode,
            scope,
            days,
          );
        }}
      />
      <div className="dm-senders-demo-tools">
        <label className="dm-senders-demo-search">
          <input
            aria-label="Search sample senders"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected([]);
            }}
            placeholder="Search senders"
          />
        </label>
        <label>
          Filter{' '}
          <select
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value as Filter);
              setSelected([]);
            }}
          >
            <option value="active">Active</option>
            <option value="all">All senders</option>
            <option value="quiet">Quiet or dormant</option>
            <option value="protected">Protected</option>
            <option value="unsubscribe">Has unsubscribe</option>
          </select>
        </label>
        <label>
          Sort{' '}
          <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
            <option value="received">Most received</option>
            <option value="recent">Last seen</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>
      <div className="dm-senders-demo-grid">
        <section className="dm-senders-demo-list" aria-label="Sample senders">
          <div className="dm-senders-demo-list-head">
            <div>
              <strong>
                {visible.length} {filter === 'active' ? 'active ' : ''}sender
                {visible.length === 1 ? '' : 's'}
              </strong>
              <span>Select a sender to inspect it</span>
            </div>
            <label>
              <input
                type="checkbox"
                aria-label="Select all visible senders"
                checked={
                  visible.length > 0 && visible.every((sender) => selected.includes(sender.id))
                }
                onChange={(event) =>
                  setSelected(event.target.checked ? visible.map((sender) => sender.id) : [])
                }
              />{' '}
              Select visible
            </label>
          </div>
          {visible.length === 0 ? (
            <p className="dm-senders-demo-empty">
              No sample senders match. Try another filter or search.
            </p>
          ) : (
            visible.map((sender) => (
              <div
                className={`dm-senders-demo-row ${selectedSender?.id === sender.id ? 'is-open' : ''}`}
                key={sender.id}
              >
                <input
                  type="checkbox"
                  aria-label={`Select ${sender.name}`}
                  checked={selected.includes(sender.id)}
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, sender.id]
                        : current.filter((id) => id !== sender.id),
                    )
                  }
                />
                <button
                  type="button"
                  onClick={() => setSelectedId(sender.id)}
                  aria-current={selectedSender?.id === sender.id ? 'true' : undefined}
                >
                  <strong>{sender.name}</strong>
                  <span>{summaryFor(sender)}</span>
                </button>
                {sender.protected ? <span className="dm-senders-demo-badge">Protected</span> : null}
              </div>
            ))
          )}
          {selected.length > 0 ? (
            <div className="dm-senders-demo-selection">
              <strong>{selected.length} selected</strong>
              <div>
                {(['Keep', 'Archive', 'Unsubscribe', 'Later', 'Delete'] as const).map((verb) => {
                  const eligible = senders.filter(
                    (sender) =>
                      selected.includes(sender.id) &&
                      (verb === 'Keep' ||
                        (!sender.protected &&
                          (verb !== 'Unsubscribe' || sender.unsubscribe === 'one_click'))),
                  );
                  return (
                    <button
                      key={verb}
                      type="button"
                      disabled={eligible.length === 0}
                      onClick={() => openAction(verb, selected)}
                    >
                      {verb}
                    </button>
                  );
                })}
                <button type="button" onClick={() => setSelected([])}>
                  Clear
                </button>
              </div>
              <small>
                Protected senders are excluded from bulk mail actions. Bulk actions are available on
                Free, subject to its monthly cleanup allowance.
              </small>
            </div>
          ) : null}
        </section>
        <aside className="dm-senders-demo-inspector" aria-label="Sender details">
          {selectedSender ? (
            <>
              <div className="dm-senders-demo-kicker">Sender details · sample</div>
              <h2>{selectedSender.name}</h2>
              <p className="dm-senders-demo-email">{selectedSender.email}</p>
              <div className="dm-senders-demo-stats">
                <div>
                  <strong>{fmt(count(selectedSender, 'inbox', null))}</strong>
                  <span>Currently in inbox</span>
                </div>
                <div>
                  <strong>{fmt(selectedSender.received90d)}</strong>
                  <span>Received in last 90 days</span>
                </div>
              </div>
              <div className="dm-senders-demo-insight">
                <span>
                  {selectedSender.protected
                    ? 'Protected from bulk actions'
                    : `${selectedSender.markedRead}% marked read · 90 days`}
                </span>
              </div>
              <p className="dm-senders-demo-hint">
                Marked read reflects Gmail flags, not proof you opened an email. You wrote{' '}
                {selectedSender.wroteTo}×.
              </p>
              {selectedSender.unsubRequested ? (
                <p className="dm-senders-demo-status">
                  Unsubscribe requested · watch for new email to confirm it worked.
                </p>
              ) : null}
              {selectedSender.kept ? (
                <p className="dm-senders-demo-status">Keep decision recorded.</p>
              ) : null}
              <div className="dm-senders-demo-actions">
                <span>{WS2_COPY.senders.detail.actionHeading}</span>
                <div>
                  {(['Keep', 'Archive', 'Unsubscribe', 'Later', 'Delete'] as const).map((verb) => (
                    <button
                      key={verb}
                      type="button"
                      disabled={verb === 'Unsubscribe' && selectedSender.unsubscribe === 'none'}
                      onClick={() => openAction(verb, [selectedSender.id])}
                    >
                      {verb}
                    </button>
                  ))}
                </div>
              </div>
              {selectedSender.unsubscribe === 'none' ? (
                <p className="dm-senders-demo-hint">
                  No one-click unsubscribe channel found for this sender.
                </p>
              ) : null}
              <div className="dm-senders-demo-recent">
                <strong>Recent subjects</strong>
                <ul>
                  {selectedSender.subjects.map((subject) => (
                    <li key={subject}>{subject}</li>
                  ))}
                </ul>
              </div>
            </>
          ) : (
            <p className="dm-senders-demo-empty">
              Choose another filter to inspect a sample sender.
            </p>
          )}
        </aside>
      </div>
      <section className="dm-senders-demo-activity" aria-label="Sample activity">
        <div>
          <h2>Activity</h2>
          <button
            type="button"
            aria-expanded={activityOpen}
            onClick={() => setActivityOpen((open) => !open)}
          >
            {activityOpen ? 'Hide' : 'Show'} outcomes{' '}
            {activity.length > 0 ? `(${activity.length})` : ''}
          </button>
        </div>
        {activityOpen ? (
          activity.length === 0 ? (
            <p>Confirmed actions appear here with available Undo.</p>
          ) : (
            <ol>
              {activity.map((entry) => (
                <li key={entry.id}>
                  <strong>
                    {entry.senderNames} · {entry.verb}
                  </strong>
                  <p>{entry.summary}</p>
                  {entry.note ? <p>{entry.note}</p> : null}
                  {entry.undone ? (
                    <span>Mail movement undone. Any unsubscribe request remains sent.</span>
                  ) : entry.undoable ? (
                    <button type="button" onClick={() => undo(entry)}>
                      Undo
                    </button>
                  ) : entry.superseded ? (
                    <span>
                      A later sample decision changed this sender. This earlier snapshot cannot be
                      undone in the demo.
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          )
        ) : null}
      </section>
      {pending && isUnsubscribe ? (
        <UnsubscribeBacklogDialog
          request={
            {
              verb: 'Unsubscribe',
              senders: pendingSenders.map((sender) => ({
                id: sender.id,
                name: sender.name,
                unsubscribeMethod: sender.unsubscribe,
              })),
            } as ActionRequest
          }
          preferredCounts={{
            inbox: previewBuckets(pendingSenders, 'inbox_only'),
            allMail: previewBuckets(pendingSenders, 'all_mail'),
          }}
          {...(pendingSenders.length > 1
            ? {
                bulkPreview: {
                  loading: false,
                  data: {
                    senders: pendingSenders.map((sender) => ({
                      senderId: sender.id,
                      name: sender.name,
                      protected: false,
                      counts: previewBuckets([sender], 'inbox_only'),
                      allMailCounts: previewBuckets([sender], 'all_mail'),
                    })),
                  },
                },
              }
            : {})}
          onCancel={closePreview}
          onConfirm={(opts) => {
            const included = new Set(opts.senderIds);
            applyUnsubscribe(
              pendingSenders.filter((sender) => included.has(sender.id)),
              opts.secondary?.type ?? 'unsub_only',
              opts.reach ?? 'inbox_only',
              opts.secondary?.olderThanDays ?? null,
            );
          }}
        />
      ) : null}
      {pending && !isUnsubscribe ? (
        <PreviewSheet
          onClose={closePreview}
          icon={<Avatar name={pendingNames} size={64} />}
          title={`${pending.verb} ${fmt(previewCount)} emails from ${pendingNames}?`}
          subtitle={
            pending.verb === 'Archive'
              ? 'These emails leave your inbox and stay in Gmail.'
              : pending.verb === 'Delete'
                ? 'These emails move to Gmail Trash.'
                : 'These emails move to Later and return at the chosen time in the product.'
          }
          note={`Undo from Activity for ${MIN_UNDO_WINDOW_DAYS} days.`}
          footer="Sample data · changes stay in this browser"
          primary={{
            label: pendingSenders.some((sender) => sender.protected)
              ? `${pending.verb} anyway`
              : `${pending.verb} ${fmt(previewCount)}`,
            onClick: confirm,
            disabled: !canConfirm,
            tone: pending.verb === 'Delete' ? 'danger' : 'primary',
          }}
          status={
            pending.verb === 'Later' && !(Date.parse(wakeAt) > Date.now())
              ? WS5_COPY['preview.later.returnInvalid']
              : undefined
          }
          details={
            <>
              <SheetFactList
                facts={[
                  {
                    label: WS3_COPY['ws3.demo.details.includes.label'],
                    value: `${activeReach === 'all_mail' ? WS3_COPY['ws3.demo.details.includes.all'] : WS3_COPY['ws3.demo.details.includes.inbox']}${olderThanDays !== null ? ` · older than ${olderThanDays} days` : ''}`,
                  },
                  ...(pending.verb === 'Delete'
                    ? [
                        {
                          label: WS3_COPY['ws3.demo.details.deleted.label'],
                          value: WS3_COPY['ws3.demo.details.deleted.value'],
                        },
                      ]
                    : []),
                ]}
              />
              {pendingSenders.length === 1 && canMove && olderThanDays === null ? (
                <>
                  <strong>Sample subject context</strong>
                  <ul style={{ margin: 0, paddingInlineStart: 20 }}>
                    {pendingSenders[0]!.subjects.map((subject) => (
                      <li key={subject}>{subject}</li>
                    ))}
                  </ul>
                  <span>
                    Illustrative recent subjects. The connected product shows live matches and a
                    matching Gmail search.
                  </span>
                </>
              ) : olderThanDays !== null && canMove ? (
                <span>{WS3_COPY['ws3.demo.details.subjectsNote']}</span>
              ) : null}
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {pending.skipped > 0 && (
              <p>
                {pending.skipped} Protected sender{pending.skipped === 1 ? '' : 's'} will be left
                unchanged.
              </p>
            )}
            {pendingSenders.some((sender) => sender.protected) && (
              <p>
                This sender is Protected. A single-sender action requires your explicit choice; bulk
                actions skip them.
              </p>
            )}
            {canWiden && (
              <ActionReachControl
                value={reach}
                inboxCount={totalCount(pendingSenders, 'inbox_only', olderThanDays)}
                allMailCount={totalCount(pendingSenders, 'all_mail', olderThanDays)}
                onChange={setReach}
              />
            )}
            {(mailVerb === 'archive' || mailVerb === 'delete') && (
              <label className="dm-senders-demo-window">
                Email age
                <select
                  aria-label="Email age to act on"
                  value={olderThanDays ?? 'all'}
                  onChange={(event) =>
                    setOlderThanDays(
                      event.target.value === 'all' ? null : Number(event.target.value),
                    )
                  }
                >
                  {WINDOWS.map((window) => (
                    <option key={window.label} value={window.days ?? 'all'}>
                      {window.days === null && reach === 'all_mail' ? 'All mail' : window.label} ·{' '}
                      {fmt(totalCount(pendingSenders, activeReach, window.days))}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {pending.verb === 'Later' && (
              <label className="dm-senders-demo-window">
                Returns
                <input
                  type="datetime-local"
                  value={wakeAt}
                  onChange={(event) => setWakeAt(event.target.value)}
                />
              </label>
            )}
          </div>
        </PreviewSheet>
      ) : null}
      <ToastHost />
    </div>
  );
}
