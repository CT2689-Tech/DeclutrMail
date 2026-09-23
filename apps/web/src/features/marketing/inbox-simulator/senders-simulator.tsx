'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MIN_UNDO_WINDOW_DAYS } from '@declutrmail/shared/entitlements';
import { defaultLaterWakeAtIso } from '@declutrmail/shared/actions';

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
  unsubscribe: 'one_click' | 'none';
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
  const closeButton = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
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
    previousFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPending({
      ids: actionables.map((sender) => sender.id),
      verb,
      skipped: candidates.length - actionables.length,
    });
    setBacklog('none');
    setReach('inbox_only');
    setOlderThanDays(verb === 'Delete' ? 180 : null);
    setWakeAt(verb === 'Later' ? localDateTime(defaultLaterWakeAtIso()) : '');
  };

  const closePreview = () => {
    setPending(null);
    requestAnimationFrame(() => previousFocus.current?.focus());
  };

  useEffect(() => {
    if (!pending) return;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePreview();
      if (event.key !== 'Tab') return;
      const modal = closeButton.current?.closest('[role="dialog"]');
      const focusable = modal?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), select:not([disabled])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // The modal owns focus for its lifetime; changing scope must not reset it.
  }, [pending]);

  const confirm = () => {
    if (!pending || !canConfirm) return;
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
      return isUnsubscribe ? { ...changed, unsubRequested: true } : changed;
    });
    const destination =
      effectiveMailVerb === 'delete'
        ? 'Gmail Trash'
        : effectiveMailVerb === 'later'
          ? 'Later'
          : 'Gmail All Mail';
    const summary = isUnsubscribe
      ? `Unsubscribe requested; not yet confirmed by the sender.${previewCount > 0 ? ` ${fmt(previewCount)} sample emails moved to ${destination}.` : canMove ? ' No sample email matched the selected past-email scope.' : ' Existing email left alone.'}`
      : `${fmt(previewCount)} sample emails moved to ${destination}.${pending.verb === 'Later' ? ` Return time: ${wakeAt.replace('T', ' ')} local.` : ''}`;
    setSenders(next);
    setActivity((current) => [
      {
        id: ++activitySequence.current,
        senderNames: pendingNames,
        verb: pending.verb,
        affected: previewCount,
        summary,
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

  return (
    <div className="dm-senders-demo">
      <div className="dm-senders-demo-note">
        Sample mailbox · made-up senders and counts · no Gmail connection
      </div>
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
                {visible.length} {filter === 'active' ? 'active ' : ''}senders
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
                  <span>
                    {sender.category} · {summaryFor(sender)}
                  </span>
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
                <span>{selectedSender.category}</span>
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
                <span>Your next decision</span>
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
                  {entry.undone ? (
                    <span>Mail movement undone. Any unsubscribe request remains sent.</span>
                  ) : entry.undoable ? (
                    <button type="button" onClick={() => undo(entry)}>
                      Undo mail movement
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
      {pending ? (
        <div className="dm-senders-demo-modal-layer">
          <button
            type="button"
            className="dm-senders-demo-scrim"
            aria-label="Close preview"
            onClick={closePreview}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="dm-senders-demo-dialog-title"
            className="dm-senders-demo-dialog"
          >
            <div className="dm-senders-demo-dialog-top">
              <span>Action preview · sample data</span>
              <button
                type="button"
                ref={closeButton}
                aria-label="Close preview"
                onClick={closePreview}
              >
                ×
              </button>
            </div>
            <h2 id="dm-senders-demo-dialog-title">
              {isUnsubscribe
                ? `Unsubscribe${canMove && previewCount > 0 ? ` and ${mailVerb} ${fmt(previewCount)} emails` : ''} from ${pendingNames}?`
                : `${pending.verb} ${fmt(previewCount)} emails from ${pendingNames}?`}
            </h2>
            <p>
              {isUnsubscribe
                ? 'This requests that future email stop. A sent unsubscribe cannot be recalled.'
                : pending.verb === 'Archive'
                  ? 'These emails leave Inbox and stay in Gmail All Mail.'
                  : pending.verb === 'Delete'
                    ? 'These emails move to Gmail Trash. Gmail controls permanent deletion and recovery.'
                    : 'These emails move to Later and return at the chosen time in the product.'}
            </p>
            {pending.skipped > 0 ? (
              <p className="dm-senders-demo-warning">
                {pending.skipped} selected sender{pending.skipped === 1 ? ' is' : 's are'} excluded
                from this action (Protected or no one-click unsubscribe).
              </p>
            ) : null}
            {pendingSenders.some((sender) => sender.protected) ? (
              <p className="dm-senders-demo-warning">
                This sender is Protected. A single-sender action requires your explicit choice; bulk
                actions skip them.
              </p>
            ) : null}
            {isUnsubscribe ? (
              <fieldset>
                <legend>Also act on past emails</legend>
                {(
                  [
                    ['none', 'Leave alone'],
                    ['archive', 'Archive them'],
                    ['delete', 'Delete them'],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value}>
                    <input
                      type="radio"
                      name="demo-backlog"
                      checked={backlog === value}
                      onChange={() => {
                        setBacklog(value);
                        setReach('inbox_only');
                        setOlderThanDays(null);
                      }}
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
            ) : null}
            {canWiden ? (
              <fieldset>
                <legend>Where it applies</legend>
                <label>
                  <input
                    type="radio"
                    name="demo-reach"
                    checked={reach === 'inbox_only'}
                    onChange={() => setReach('inbox_only')}
                  />
                  Inbox only · {fmt(totalCount(pendingSenders, 'inbox_only', olderThanDays))}
                </label>
                <label>
                  <input
                    type="radio"
                    name="demo-reach"
                    checked={reach === 'all_mail'}
                    onChange={() => setReach('all_mail')}
                  />
                  Inbox + archived · {fmt(totalCount(pendingSenders, 'all_mail', olderThanDays))}
                </label>
              </fieldset>
            ) : null}
            {mailVerb === 'archive' || mailVerb === 'delete' ? (
              <label className="dm-senders-demo-window">
                How far back
                <select
                  aria-label="How far back to act on"
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
            ) : null}
            {pending.verb === 'Later' ? (
              <label className="dm-senders-demo-window">
                Returns
                <input
                  type="datetime-local"
                  aria-label="Later return time"
                  value={wakeAt}
                  onChange={(event) => setWakeAt(event.target.value)}
                />
              </label>
            ) : null}
            {canMove ? (
              <div className="dm-senders-demo-preview-count">
                <strong>{fmt(previewCount)} emails currently match</strong>
                <span>
                  {activeReach === 'all_mail' ? 'Inbox and archived' : 'Inbox only'}
                  {olderThanDays !== null ? ` · older than ${olderThanDays} days` : ''}
                </span>
              </div>
            ) : (
              <div className="dm-senders-demo-preview-count">
                <strong>Existing email stays where it is</strong>
                <span>Unsubscribe affects future mail only.</span>
              </div>
            )}
            {pendingSenders.length === 1 && canMove && olderThanDays === null ? (
              <div className="dm-senders-demo-subjects">
                <strong>Sample subject context</strong>
                <ul>
                  {pendingSenders[0]!.subjects.map((subject) => (
                    <li key={subject}>{subject}</li>
                  ))}
                </ul>
                <small>
                  Illustrative recent subjects. The connected product shows live matches and a
                  matching Gmail search.
                </small>
              </div>
            ) : olderThanDays !== null && canMove ? (
              <p className="dm-senders-demo-footnote">
                Subjects are omitted for this age selection in the demo. The connected product shows
                the matching subjects.
              </p>
            ) : null}
            <p className="dm-senders-demo-footnote">
              {pending.verb === 'Unsubscribe'
                ? 'Undo can restore supported mail movement, but cannot recall an unsubscribe request.'
                : `Supported mail-moving actions have ${MIN_UNDO_WINDOW_DAYS} days of Activity Undo.`}{' '}
              This demo changes sample data in this browser only.
            </p>
            <div className="dm-senders-demo-dialog-actions">
              <button type="button" onClick={closePreview}>
                Cancel
              </button>
              <button type="button" disabled={!canConfirm} onClick={confirm}>
                {isUnsubscribe
                  ? backlog === 'none'
                    ? 'Request unsubscribe'
                    : `Unsubscribe + ${backlog === 'delete' ? 'Delete' : 'Archive'}`
                  : `${pending.verb} ${fmt(previewCount)}`}
                {pendingSenders.length === 1 && pendingSenders[0]!.protected && backlog === 'none'
                  ? ' anyway'
                  : ''}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
