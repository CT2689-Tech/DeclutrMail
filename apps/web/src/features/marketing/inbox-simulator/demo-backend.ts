/**
 * In-memory API for the public Senders demo.
 *
 * The demo renders the product's own `SendersScreen`, so it needs
 * something to answer the product's own requests. This answers them from
 * a made-up mailbox held in memory: nothing leaves the browser, and a
 * reload starts over.
 *
 * Two rules keep it from drifting the way the hand-built demo screen did:
 *
 *   - Every response body is typed with the wire interface the client
 *     reads it as. A contract change breaks typecheck here.
 *   - A request with no handler is answered 501 and recorded in
 *     `unhandled`. The demo tests assert that list is empty, so a new
 *     product request is a red test, never a silent 200.
 *
 * Behaviour follows the API (`apps/api/src/{senders,actions,undo}`): the
 * 30/180-day activity buckets, "at least N days old" windows, Later mail
 * counting as archived, one Undo per decision, Protected senders refused
 * without `override` and skipped in bulk.
 */

import type { Envelope } from '@declutrmail/shared/contracts';
import {
  DEFAULT_ACTION_SHEET_PREFS,
  DEFAULT_BRIEF_PREFS,
  DEFAULT_EMAIL_PREFS,
  type ActionSheetPrefs,
  type MeSettings,
  type OnboardingState,
  type SavedSenderView,
} from '@declutrmail/shared/contracts';
import type { InboxReportDto } from '@declutrmail/shared/inbox-report';

import type { TriageBootstrap } from '@/features/triage/api/query-options';
import type { KeepIntentResult } from '@/features/triage/api/use-triage-actions';
import type { TriageDecisionRow } from '@/features/triage/data';
import type { UndoWireEntry } from '@/features/undo/query-options';
import type {
  ActionStatusResult,
  BatchStatusResult,
  BulkActionEnqueueResult,
  BulkActionPreviewResult,
  BulkPreviewBuckets,
  BulkSkipReason,
  CompositeActionEnqueueResult,
  CompositeActionPreviewResult,
  CompositePreviewMessage,
  InFlightActionGroup,
  UndoRevertResult,
  UnsubscribeBacklogResult,
  UnsubscribeBacklogSenderResult,
  UnsubscribeIntentResult,
  UnsubscribeManualStatusResult,
} from '@/lib/api/actions';
import type {
  DecisionHistoryRowDto,
  MailMessageRow,
  SenderDetailDto,
  SenderListEnvelope,
  SenderListQueryMeta,
  SenderListRow,
  SenderPolicyResultDto,
  SenderSuggestionDto,
  SenderSummaryDto,
  TimeseriesPointDto,
  UnsubStatus,
} from '@/lib/api/senders';

import {
  DEMO_AGES,
  DEMO_MAILBOX_ID,
  DEMO_SENDERS,
  type DemoBuckets,
  type DemoSenderSeed,
} from './demo-senders';
import { sampleInboxReport } from './sample-report';

const DAY_MS = 86_400_000;
const UNDO_WINDOW_DAYS = 30;
/** A finished decision stays in `GET /api/actions/active` this long. */
const SETTLED_GRACE_MS = 60_000;
const WINDOWS = [30, 90, 180, 365] as const;

type LabelVerb = 'archive' | 'later' | 'delete';
type JobVerb = LabelVerb | 'unsubscribe';
type Reach = 'inbox_only' | 'all_mail';

interface DemoSender extends Omit<DemoSenderSeed, 'inbox' | 'archived'> {
  inbox: DemoBuckets;
  archived: DemoBuckets;
  isProtected: boolean;
  protectionSetAt: string | null;
  policyType: 'keep' | 'unsubscribe' | null;
  unsubStatus: UnsubStatus | null;
  /** Set by any decision; a decided sender leaves the Guided Review queue. */
  decided: boolean;
  history: DecisionHistoryRowDto[];
}

interface Job {
  id: string;
  groupId: string;
  senderId: string;
  verb: JobVerb;
  direction: 'forward' | 'reverse';
  status: 'executing' | 'done';
  requestedCount: number;
  affectedCount: number;
  olderThanDays: number | null;
  reach: Reach;
  wakeAt: string | null;
  createdAt: number;
  finishedAt: number | null;
  /** What a forward job moved, so its Undo puts back exactly that. */
  moved: { inbox: DemoBuckets; archived: DemoBuckets } | null;
  undoToken: string | null;
  undoExpiresAt: string | null;
  undoRevertedAt: string | null;
  /** Reverse jobs only: the forward job being undone. */
  reverses: string | null;
  historyId: string | null;
}

interface Request {
  method: string;
  path: string;
  query: URLSearchParams;
  body: Record<string, unknown>;
}

interface Reply {
  status: number;
  body: unknown;
}

export interface DemoBackend {
  /** Drop-in for `fetch`: the demo hands it to the API client. */
  transport: typeof fetch;
  /** `METHOD /path` of every request no handler matched. */
  unhandled: readonly string[];
  hasSender(id: string): boolean;
}

function ok<T>(data: T, meta?: unknown): Reply {
  const body: Envelope<T, unknown> = meta === undefined ? { data } : { data, meta };
  return { status: 200, body };
}

/** The API's error envelope (`all-exceptions.filter.ts`). */
function fail(status: number, code: string, message: string): Reply {
  return {
    status,
    body: {
      error: {
        code,
        message,
        correlationId: 'demo',
        traceId: null,
        displayId: 'DM-DEMO00',
        retryable: false,
        severityTier: 'inline_recoverable',
      },
    },
  };
}

const zeros = (): DemoBuckets => [0, 0, 0, 0, 0];
const sum = (buckets: readonly number[]): number => buckets.reduce((a, b) => a + b, 0);

/** Email at least `days` old. `null` is every age. */
function countOlder(buckets: readonly number[], days: number | null): number {
  return buckets.reduce(
    (total, value, index) => total + (days === null || DEMO_AGES[index]! >= days ? value : 0),
    0,
  );
}

function bucketCounts(buckets: readonly number[]): BulkPreviewBuckets {
  return {
    all: countOlder(buckets, null),
    olderThan30d: countOlder(buckets, 30),
    olderThan90d: countOlder(buckets, 90),
    olderThan180d: countOlder(buckets, 180),
    olderThan365d: countOlder(buckets, 365),
  };
}

function addBuckets(a: readonly number[], b: readonly number[]): DemoBuckets {
  return [a[0]! + b[0]!, a[1]! + b[1]!, a[2]! + b[2]!, a[3]! + b[3]!, a[4]! + b[4]!];
}

function activityOf(sender: DemoSender): 'active' | 'quiet' | 'dormant' {
  return sender.lastSeenDays <= 30 ? 'active' : sender.lastSeenDays <= 180 ? 'quiet' : 'dormant';
}

function triState(raw: string | null): boolean | null {
  return raw === 'true' ? true : raw === 'not' || raw === 'false' ? false : null;
}

export function createDemoBackend(options: { jobMs?: number } = {}): DemoBackend {
  const jobMs = options.jobMs ?? 600;
  const unhandled: string[] = [];
  let sequence = 0;
  const nextId = (prefix: string) => `demo-${prefix}-${(sequence += 1)}`;

  const senders = new Map<string, DemoSender>(
    DEMO_SENDERS.map((seed) => [
      seed.id,
      {
        ...seed,
        inbox: [...seed.inbox],
        archived: [...seed.archived],
        isProtected: seed.protection !== null,
        protectionSetAt:
          seed.protection !== null ? new Date(Date.now() - DAY_MS).toISOString() : null,
        policyType: null,
        unsubStatus: null,
        decided: false,
        history: [],
      },
    ]),
  );
  const jobs = new Map<string, Job>();
  let senderViews: SavedSenderView[] = [];
  let actionSheetPrefs: ActionSheetPrefs = DEFAULT_ACTION_SHEET_PREFS;

  const iso = (ms = Date.now()) => new Date(ms).toISOString();

  /* ───────────── mail and jobs ───────────── */

  function matching(
    sender: DemoSender,
    verb: LabelVerb,
    days: number | null,
    reach: Reach,
  ): number {
    return (
      countOlder(sender.inbox, days) +
      (verb === 'delete' && reach === 'all_mail' ? countOlder(sender.archived, days) : 0)
    );
  }

  function liveForwardJob(senderId: string): boolean {
    return [...jobs.values()].some(
      (job) => job.senderId === senderId && job.direction === 'forward' && job.status !== 'done',
    );
  }

  function addHistory(
    sender: DemoSender,
    action: DecisionHistoryRowDto['action'],
    affectedCount: number,
    source: DecisionHistoryRowDto['source'] = 'manual',
  ): string {
    const id = nextId('activity');
    sender.history.unshift({
      id,
      action,
      source,
      occurredAt: iso(),
      affectedCount,
      revertedAt: null,
    });
    return id;
  }

  function enqueue(
    sender: DemoSender,
    verb: JobVerb,
    input: {
      groupId?: string;
      olderThanDays?: number | null;
      reach?: Reach;
      wakeAt?: string | null;
      requestedCount: number;
    },
  ): Job {
    const id = nextId('action');
    const job: Job = {
      id,
      groupId: input.groupId ?? id,
      senderId: sender.id,
      verb,
      direction: 'forward',
      status: 'executing',
      requestedCount: input.requestedCount,
      affectedCount: 0,
      olderThanDays: input.olderThanDays ?? null,
      reach: input.reach ?? 'inbox_only',
      wakeAt: input.wakeAt ?? null,
      createdAt: Date.now(),
      finishedAt: null,
      moved: null,
      undoToken: null,
      undoExpiresAt: null,
      undoRevertedAt: null,
      reverses: null,
      historyId: null,
    };
    jobs.set(id, job);
    sender.decided = true;
    return job;
  }

  function finish(job: Job): void {
    const sender = senders.get(job.senderId);
    job.status = 'done';
    job.finishedAt = Date.now();
    if (!sender) return;

    if (job.direction === 'reverse') {
      const forward = job.reverses ? jobs.get(job.reverses) : undefined;
      if (!forward?.moved) return;
      sender.inbox = addBuckets(sender.inbox, forward.moved.inbox);
      if (forward.verb === 'delete') {
        sender.archived = addBuckets(sender.archived, forward.moved.archived);
      } else {
        // Archive and Later put inbox mail in the archive; take it back out.
        sender.archived = sender.archived.map((value, index) =>
          Math.max(0, value - forward.moved!.inbox[index]!),
        ) as DemoBuckets;
      }
      job.affectedCount = job.requestedCount;
      job.undoRevertedAt = iso();
      forward.undoRevertedAt = job.undoRevertedAt;
      const row = sender.history.find((entry) => entry.id === forward.historyId);
      if (row) row.revertedAt = job.undoRevertedAt;
      sender.decided = false;
      return;
    }

    if (job.verb === 'unsubscribe') {
      job.affectedCount = 1;
      sender.unsubStatus = 'endpoint_accepted';
      return;
    }

    const moved = { inbox: zeros(), archived: zeros() };
    DEMO_AGES.forEach((age, index) => {
      if (job.olderThanDays !== null && age < job.olderThanDays) return;
      moved.inbox[index] = sender.inbox[index]!;
      sender.inbox[index] = 0;
      if (job.verb === 'delete') {
        if (job.reach === 'all_mail') {
          moved.archived[index] = sender.archived[index]!;
          sender.archived[index] = 0;
        }
      } else {
        sender.archived[index] = sender.archived[index]! + moved.inbox[index]!;
      }
    });
    job.affectedCount = sum(moved.inbox) + sum(moved.archived);
    job.historyId = addHistory(sender, job.verb, job.affectedCount);
    // The API mints no Undo for a job that moved nothing.
    if (job.affectedCount === 0) return;
    job.moved = moved;
    job.undoToken = nextId('undo');
    job.undoExpiresAt = iso(Date.now() + UNDO_WINDOW_DAYS * DAY_MS);
  }

  /** Jobs run for `jobMs`, in the order they were queued. */
  function settle(): void {
    const now = Date.now();
    for (const job of jobs.values()) {
      if (job.status !== 'done' && now - job.createdAt >= jobMs) finish(job);
    }
  }

  function snapshot(job: Job): ActionStatusResult {
    const forward = job.reverses ? jobs.get(job.reverses) : undefined;
    return {
      actionId: job.id,
      verb: job.verb,
      direction: job.direction,
      status: job.status,
      requestedCount: job.requestedCount,
      affectedCount: job.affectedCount,
      wakeAt: job.wakeAt,
      // A reverse job reports the token it is spending.
      undoToken: forward ? forward.undoToken : job.undoToken,
      undoExpiresAt: forward ? forward.undoExpiresAt : job.undoExpiresAt,
      undoExecutedAt: job.undoRevertedAt,
      undoRevertedAt: job.undoRevertedAt,
      errorCode: null,
    };
  }

  const forwardJobs = (groupId: string): Job[] =>
    [...jobs.values()].filter((job) => job.direction === 'forward' && job.groupId === groupId);

  /* ───────────── senders ───────────── */

  function listRow(sender: DemoSender): SenderListRow {
    const inboxCount = sum(sender.inbox);
    const activity = activityOf(sender);
    return {
      id: sender.id,
      displayName: sender.name,
      email: sender.email,
      domain: sender.email.slice(sender.email.indexOf('@') + 1),
      // No brand mark: the avatar then draws initials and requests nothing.
      brandMark: false,
      gmailCategory: sender.category,
      lastSeenAt: iso(Date.now() - sender.lastSeenDays * DAY_MS),
      firstSeenAt: iso(Date.now() - sender.firstSeenMonths * 30 * DAY_MS),
      totalReceived: sender.totalReceived,
      sizeBytes: sender.totalReceived * 48_000,
      inboxCount,
      archivedCount: sum(sender.archived),
      unreadInboxCount: Math.round((inboxCount * (100 - sender.readPct)) / 100),
      wroteToCount: sender.wroteTo,
      // The wire name is historical: the app reads this as the 90-day count.
      monthlyVolume: sender.received90d,
      readRate: sender.received90d > 0 ? sender.readPct / 100 : null,
      volumeTrend: activity === 'active' ? 'steady' : activity,
      sparkline: null,
      unsubscribeMethod: sender.unsubscribe,
      lastReview: null,
      protectionFlags: {
        isProtected: sender.isProtected,
        protectionReason: sender.isProtected ? (sender.protection ?? 'user_defined') : null,
        protectionSetAt: sender.isProtected ? sender.protectionSetAt : null,
      },
      policyType: sender.policyType,
      unsubStatus: sender.unsubStatus,
    };
  }

  const mailtoUrl = (sender: DemoSender): string | null =>
    sender.unsubscribe === 'mailto'
      ? `mailto:unsubscribe@${sender.email.slice(sender.email.indexOf('@') + 1)}?subject=unsubscribe`
      : null;

  function detail(sender: DemoSender): SenderDetailDto {
    return {
      ...listRow(sender),
      unsubscribeMailtoUrl: mailtoUrl(sender),
      recommendation: {
        verdict: sender.suggestion.verdict,
        confidence: 0.8,
        reasoning: sender.suggestion.reasoning,
        generatedBy: 'template',
        scoredAt: iso(Date.now() - DAY_MS),
        stale: false,
      },
    };
  }

  function listSenders(query: URLSearchParams): Reply {
    const sort = query.get('sort') ?? 'total';
    if (!['total', 'last_seen', 'first_seen', 'name', 'size'].includes(sort)) {
      return fail(400, 'BAD_REQUEST', 'Unsupported sort.');
    }
    const direction = query.get('direction') ?? (sort === 'name' ? 'asc' : 'desc');
    const currentMailOnly = query.get('current_mail_only') === 'true';
    const pool = [...senders.values()].filter(
      (sender) => !currentMailOnly || sum(sender.inbox) + sum(sender.archived) > 0,
    );

    const q = (query.get('q') ?? '').trim().toLowerCase();
    const activity = query.get('activity');
    const unsubReady = triState(query.get('unsub_ready'));
    const wroteTo = triState(query.get('wrote-to'));
    const isProtected = triState(query.get('protected'));
    const windowDays = query.get('window');
    const domain = (query.get('domain') ?? '').trim().toLowerCase();
    const category = query.get('category');

    const matches = pool.filter((sender) => {
      const row = listRow(sender);
      if (q && !`${row.displayName} ${row.email} ${row.domain}`.toLowerCase().includes(q)) {
        return false;
      }
      if (activity) {
        const negate = activity.startsWith('not-');
        const bucket = negate ? activity.slice(4) : activity;
        if ((activityOf(sender) === bucket) === negate) return false;
      }
      const hasChannel = sender.unsubscribe !== 'none';
      if (unsubReady !== null && hasChannel !== unsubReady) return false;
      if (wroteTo !== null && sender.wroteTo > 0 !== wroteTo) return false;
      if (isProtected !== null && sender.isProtected !== isProtected) return false;
      if (windowDays && !(sender.lastSeenDays > Number.parseInt(windowDays, 10))) return false;
      if (domain && !row.domain.includes(domain)) return false;
      if (category && sender.category !== category) return false;
      // No new email arrives in the demo, so no unsubscribe is ever ignored.
      if (query.get('unsub_ignored') === 'true') return false;
      if (query.get('has_inbox_mail') === 'true' && sum(sender.inbox) === 0) return false;
      if (
        query.get('mostly_unread') === 'true' &&
        !(sender.received90d > 0 && sender.readPct < 50)
      ) {
        return false;
      }
      return true;
    });

    const key = (sender: DemoSender): number | string =>
      sort === 'name'
        ? sender.name.toLowerCase()
        : sort === 'last_seen'
          ? -sender.lastSeenDays
          : sort === 'first_seen'
            ? -sender.firstSeenMonths
            : sender.totalReceived;
    matches.sort((a, b) => {
      const [ka, kb] = [key(a), key(b)];
      const order = ka < kb ? -1 : ka > kb ? 1 : a.id < b.id ? -1 : 1;
      return direction === 'asc' ? order : -order;
    });

    const limit = Math.min(100, Math.max(1, Number.parseInt(query.get('limit') ?? '25', 10) || 25));
    const offset = Number.parseInt(query.get('cursor') ?? '0', 10) || 0;
    const page = matches.slice(offset, offset + limit);
    const hasMore = offset + limit < matches.length;
    const meta: SenderListEnvelope['meta'] = {
      pagination: { nextCursor: hasMore ? String(offset + limit) : null, hasMore, limit },
    };
    // Mailbox-wide numbers ride page 1 only, as on the API.
    if (offset === 0) {
      const queryMeta: SenderListQueryMeta = {
        totalMatching: matches.length,
        globalMaxTotal: Math.max(0, ...pool.map((sender) => sender.totalReceived)),
        filterCounts: {
          total: pool.length,
          active: pool.filter((sender) => activityOf(sender) === 'active').length,
          quiet: pool.filter((sender) => activityOf(sender) === 'quiet').length,
          dormant: pool.filter((sender) => activityOf(sender) === 'dormant').length,
          unsubReady: pool.filter((sender) => sender.unsubscribe !== 'none').length,
          wroteTo: pool.filter((sender) => sender.wroteTo > 0).length,
          protected: pool.filter((sender) => sender.isProtected).length,
          unsubIgnored: 0,
        },
        asOf: iso(),
      };
      meta.query = queryMeta;
    }
    const envelope: SenderListEnvelope = { data: page.map(listRow), meta };
    return { status: 200, body: envelope };
  }

  function summary(): Reply {
    const all = [...senders.values()];
    const active = all.filter((sender) => activityOf(sender) === 'active');
    const byBucket = {
      one_time: 0,
      protect: 0,
      people: 0,
      needs_review: 0,
      quiet: 0,
      dormant: 0,
      bulk: 0,
      other: 0,
    };
    for (const sender of all) {
      if (sender.isProtected) byBucket.protect += 1;
      else if (sender.suggestion.verdict !== 'keep' && sender.lastSeenDays <= 30) {
        byBucket.needs_review += 1;
      } else if (sender.lastSeenDays > 180) byBucket.dormant += 1;
      else if (sender.lastSeenDays > 60) byBucket.quiet += 1;
      else if (sender.unsubscribe !== 'none') byBucket.bulk += 1;
      else byBucket.other += 1;
    }
    const last30dVolume = active.reduce((n, sender) => n + Math.round(sender.received90d / 3), 0);
    const reviewVolume = active
      .filter((sender) => !sender.isProtected && sender.suggestion.verdict !== 'keep')
      .reduce((n, sender) => n + Math.round(sender.received90d / 3), 0);
    return ok<SenderSummaryDto>({
      totalSenders: all.length,
      activeSenders: active.length,
      cleanupActiveSenders: active.filter((sender) => sum(sender.inbox) + sum(sender.archived) > 0)
        .length,
      last30dVolume,
      noiseReducible: last30dVolume > 0 ? Math.round((reviewVolume / last30dVolume) * 100) : 0,
      protected: byBucket.protect,
      needsReview: byBucket.needs_review,
      byBucket,
      asOf: iso(),
      hasCompletedCleanup: [...jobs.values()].some((job) => job.status === 'done'),
    });
  }

  /** The sender's current email, newest first, one row per message. */
  function messages(sender: DemoSender, scope: string): MailMessageRow[] {
    const rows: MailMessageRow[] = [];
    DEMO_AGES.forEach((age, index) => {
      const places = [
        ...(scope !== 'archived' ? [['inbox', sender.inbox[index]!] as const] : []),
        ...(scope !== 'inbox' ? [['archived', sender.archived[index]!] as const] : []),
      ];
      let n = 0;
      for (const [location, count] of places) {
        for (let i = 0; i < count; i += 1, n += 1) {
          const id = `${sender.id}-${age}-${location}-${i}`;
          rows.push({
            id,
            providerMessageId: id,
            providerThreadId: id,
            subject: sender.subjects[n % sender.subjects.length]!,
            snippet: 'Sample email. The demo holds no message text.',
            internalDate: iso(Date.now() - age * DAY_MS - n * 3 * 3_600_000),
            isUnread: location === 'inbox' && (n * 37) % 100 >= sender.readPct,
            location,
            sizeBytes: 48_000,
          });
        }
      }
    });
    return rows;
  }

  function previewMessages(sender: DemoSender, reach: Reach) {
    const rows = messages(sender, reach === 'all_mail' ? 'all_mail' : 'inbox');
    const pick = (days: number | null): CompositePreviewMessage[] =>
      rows
        .filter(
          (row) => days === null || Date.now() - Date.parse(row.internalDate) >= days * DAY_MS,
        )
        .slice(0, 5)
        .map((row) => ({ subject: row.subject, date: row.internalDate }));
    return {
      all: pick(null),
      olderThan30d: pick(WINDOWS[0]),
      olderThan90d: pick(WINDOWS[1]),
      olderThan180d: pick(WINDOWS[2]),
      olderThan365d: pick(WINDOWS[3]),
    };
  }

  function timeseries(sender: DemoSender): TimeseriesPointDto[] {
    const recent = Math.round(sender.received90d / 3);
    const older = Math.max(0, Math.round((sender.totalReceived - sender.received90d) / 30));
    const now = new Date();
    return Array.from({ length: 12 }, (_, i) => {
      const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (11 - i), 1));
      const volume = i >= 9 ? recent : older;
      return {
        yearMonth: month.toISOString().slice(0, 7),
        volume,
        readCount: Math.round((volume * sender.readPct) / 100),
      };
    });
  }

  function policyResult(sender: DemoSender, changed: boolean): SenderPolicyResultDto {
    return {
      senderId: sender.id,
      policyType: sender.policyType,
      isProtected: sender.isProtected,
      protectionReason: sender.isProtected ? (sender.protection ?? 'user_defined') : null,
      protectionSetAt: sender.isProtected ? sender.protectionSetAt : null,
      changed,
    };
  }

  function patchPolicy(sender: DemoSender, body: Record<string, unknown>): Reply {
    let changed = false;
    if (body.policyType === 'keep' && sender.policyType !== 'keep') {
      sender.policyType = 'keep';
      sender.decided = true;
      addHistory(sender, 'keep', 0);
      changed = true;
    }
    if (typeof body.isProtected === 'boolean' && body.isProtected !== sender.isProtected) {
      sender.isProtected = body.isProtected;
      if (body.isProtected) {
        sender.protection = 'user_defined';
        sender.protectionSetAt = iso();
      }
      addHistory(sender, body.isProtected ? 'marked_protected' : 'unmarked_protected', 0);
      changed = true;
    }
    return ok(policyResult(sender, changed));
  }

  function undoKeep(sender: DemoSender): Reply {
    if (sender.policyType !== 'keep') return ok(policyResult(sender, false));
    if (sender.isProtected) {
      return fail(409, 'PROTECTED_SENDER', 'Unprotect this sender before undoing Keep.');
    }
    sender.policyType = null;
    sender.decided = false;
    for (const row of sender.history) if (row.action === 'keep') row.revertedAt ??= iso();
    return ok(policyResult(sender, true));
  }

  /* ───────────── actions ───────────── */

  function preview(senderId: string | null): Reply {
    const sender = senderId ? senders.get(senderId) : undefined;
    if (!sender) return fail(404, 'SENDER_NOT_FOUND', 'Sender not found.');
    return ok<CompositeActionPreviewResult>({
      sender: {
        id: sender.id,
        name: sender.name,
        domain: sender.email.slice(sender.email.indexOf('@') + 1),
        lastSeenDays: sender.lastSeenDays,
        wroteToCount: sender.wroteTo,
      },
      counts: bucketCounts(sender.inbox),
      recentMessages: previewMessages(sender, 'inbox_only'),
      allMail: {
        counts: bucketCounts(addBuckets(sender.inbox, sender.archived)),
        recentMessages: previewMessages(sender, 'all_mail'),
      },
      unsubAvailable: sender.unsubscribe !== 'none',
      protected: sender.isProtected,
    });
  }

  function bulkPreview(ids: readonly string[]): Reply {
    const found = [...new Set(ids)].flatMap((id) => senders.get(id) ?? []);
    const open = found.filter((sender) => !sender.isProtected);
    return ok<BulkActionPreviewResult>({
      senders: found.map((sender) => ({
        senderId: sender.id,
        name: sender.name,
        counts: bucketCounts(sender.inbox),
        allMailCounts: bucketCounts(addBuckets(sender.inbox, sender.archived)),
        protected: sender.isProtected,
      })),
      totals: bucketCounts(open.reduce((all, sender) => addBuckets(all, sender.inbox), zeros())),
      allMailTotals: bucketCounts(
        open.reduce(
          (all, sender) => addBuckets(all, addBuckets(sender.inbox, sender.archived)),
          zeros(),
        ),
      ),
      protectedCount: found.length - open.length,
    });
  }

  interface Primary {
    type: JobVerb;
    olderThanDays: number | null;
    reach: Reach;
    wakeAt: string | null;
  }

  function readPrimary(raw: unknown): Primary | Reply {
    const primary = (raw ?? {}) as Record<string, unknown>;
    const type = primary.type;
    if (type !== 'archive' && type !== 'later' && type !== 'delete' && type !== 'unsubscribe') {
      return fail(400, 'INVALID_REQUEST', 'Unknown action.');
    }
    const wakeAt = typeof primary.wakeAt === 'string' ? primary.wakeAt : null;
    if (type === 'later' && !(wakeAt !== null && Date.parse(wakeAt) > Date.now())) {
      return fail(400, 'INVALID_REQUEST', 'Wake time must be in the future.');
    }
    return {
      type,
      olderThanDays: typeof primary.olderThanDays === 'number' ? primary.olderThanDays : null,
      reach: type === 'delete' && primary.reach === 'all_mail' ? 'all_mail' : 'inbox_only',
      wakeAt: type === 'later' ? wakeAt : null,
    };
  }

  /** `POST /api/actions`, one sender. */
  function enqueueSingle(body: Record<string, unknown>): Reply {
    const selector = body.selector as { senderId?: string };
    const sender = selector.senderId ? senders.get(selector.senderId) : undefined;
    if (!sender) return fail(404, 'SENDER_NOT_FOUND', 'Sender not found.');
    const primary = readPrimary(body.primary);
    if ('status' in primary) return primary;
    if (primary.type === 'unsubscribe') {
      return fail(400, 'INVALID_REQUEST', 'Unsubscribe takes the senders selector.');
    }
    if (sender.isProtected && body.override !== true) {
      return fail(
        409,
        'PROTECTED_SENDER',
        'This sender is Protected. Confirm to apply the action anyway.',
      );
    }
    if (liveForwardJob(sender.id)) {
      return fail(409, 'SENDER_ACTION_IN_PROGRESS', 'An action for this sender is still running.');
    }
    const job = enqueue(sender, primary.type, {
      ...primary,
      requestedCount: matching(sender, primary.type, primary.olderThanDays, primary.reach),
    });
    const secondary = body.secondary as
      { type?: LabelVerb; olderThanDays?: number | null } | undefined;
    const second =
      secondary?.type === 'archive' || secondary?.type === 'delete'
        ? enqueue(sender, secondary.type, {
            groupId: job.id,
            olderThanDays: secondary.olderThanDays ?? null,
            requestedCount: countOlder(sender.inbox, secondary.olderThanDays ?? null),
          })
        : null;
    return ok<CompositeActionEnqueueResult>({
      actionId: job.id,
      compositeId: job.id,
      secondaryId: second?.id ?? null,
      status: 'queued',
      primaryCount: job.requestedCount,
      secondaryCount: second?.requestedCount ?? null,
      wakeAt: job.wakeAt,
    });
  }

  function recordIntent(sender: DemoSender): void {
    sender.policyType = 'unsubscribe';
    sender.decided = true;
    sender.unsubStatus =
      sender.unsubscribe === 'one_click'
        ? 'requested'
        : sender.unsubscribe === 'mailto'
          ? 'action_required'
          : 'unavailable';
    addHistory(sender, 'unsubscribe', 0);
  }

  /** `POST /api/actions`, several senders. */
  function enqueueBulk(body: Record<string, unknown>): Reply {
    const ids = [...new Set((body.selector as { senderIds?: string[] }).senderIds ?? [])];
    const primary = readPrimary(body.primary);
    if ('status' in primary) return primary;
    const skipped: BulkActionEnqueueResult['skipped'] = [];
    const accepted: DemoSender[] = [];
    for (const id of ids) {
      const sender = senders.get(id);
      const reason: BulkSkipReason | null = !sender
        ? 'not_found'
        : sender.isProtected
          ? 'protected'
          : liveForwardJob(id)
            ? 'in_progress'
            : primary.type !== 'unsubscribe' || sender.unsubscribe === 'one_click'
              ? null
              : sender.unsubscribe === 'mailto'
                ? 'mailto'
                : 'no_channel';
      if (reason === null) accepted.push(sender!);
      else {
        const url = reason === 'mailto' ? mailtoUrl(sender!) : null;
        // The user sends a mailto opt-out; the intent is recorded now.
        if (reason === 'mailto') recordIntent(sender!);
        skipped.push({ senderId: id, reason, ...(url ? { mailtoUrl: url } : {}) });
      }
    }
    if (accepted.length === 0) {
      return fail(
        409,
        'NO_ACTIONABLE_SENDERS',
        'None of the selected senders can take this action.',
      );
    }
    let batchId: string | undefined;
    let requestedTotal = 0;
    for (const sender of accepted) {
      if (primary.type === 'unsubscribe') recordIntent(sender);
      const job = enqueue(sender, primary.type, {
        ...(batchId ? { groupId: batchId } : {}),
        ...primary,
        requestedCount:
          primary.type === 'unsubscribe'
            ? 1
            : matching(sender, primary.type, primary.olderThanDays, primary.reach),
      });
      batchId ??= job.id;
      requestedTotal += job.requestedCount;
    }
    return ok<BulkActionEnqueueResult>({
      batchId: batchId!,
      status: 'queued',
      senderCount: accepted.length,
      requestedTotal,
      wakeAt: primary.wakeAt,
      skipped,
    });
  }

  function batchStatus(batchId: string): Reply {
    const rows = forwardJobs(batchId);
    if (rows.length === 0) return fail(404, 'ACTION_NOT_FOUND', 'Action not found.');
    const done = rows.filter((job) => job.status === 'done').length;
    const tokened = rows.filter((job) => job.undoToken !== null);
    const lead = rows.find((job) => job.id === batchId && job.undoToken) ?? tokened[0];
    const unsub = rows.filter((job) => job.verb === 'unsubscribe');
    const allReverted = tokened.length > 0 && tokened.every((job) => job.undoRevertedAt !== null);
    return ok<BatchStatusResult>({
      feedbackVersion: 2,
      batchId,
      status: done === rows.length ? 'done' : 'executing',
      total: rows.length,
      done,
      failed: 0,
      requestedCount: rows.reduce((n, job) => n + job.requestedCount, 0),
      affectedCount: rows.reduce((n, job) => n + job.affectedCount, 0),
      skippedProtectedSenderIds: [],
      undoToken: lead?.undoToken ?? null,
      undoExpiresAt: lead?.undoExpiresAt ?? null,
      undoRevertedAt: allReverted
        ? tokened
            .map((job) => job.undoRevertedAt!)
            .sort()
            .at(-1)!
        : null,
      revertedSenderIds: [
        ...new Set(tokened.filter((job) => job.undoRevertedAt).map((job) => job.senderId)),
      ],
      unsubscribeOutcomes:
        unsub.length === 0
          ? null
          : {
              endpointAccepted: unsub.filter((job) => job.status === 'done').length,
              unconfirmed: 0,
              failed: 0,
              actionRequired: 0,
              pending: unsub.filter((job) => job.status !== 'done').length,
            },
    });
  }

  function activeGroups(): Reply {
    const now = Date.now();
    const groups = new Map<string, Job[]>();
    for (const job of jobs.values()) {
      if (job.direction !== 'forward') continue;
      groups.set(job.groupId, [...(groups.get(job.groupId) ?? []), job]);
    }
    const listed: InFlightActionGroup[] = [];
    for (const [groupId, rows] of groups) {
      const done = rows.filter((job) => job.status === 'done').length;
      const lastChange = Math.max(...rows.map((job) => job.finishedAt ?? job.createdAt));
      if (done === rows.length && now - lastChange > SETTLED_GRACE_MS) continue;
      const verbs = [...new Set(rows.map((job) => job.verb))];
      const senderIds = [...new Set(rows.map((job) => job.senderId))];
      listed.push({
        groupId,
        verb: rows.find((job) => job.verb !== 'unsubscribe')?.verb ?? 'unsubscribe',
        mixedVerbs: verbs.length > 1,
        running: done < rows.length,
        total: rows.length,
        done,
        failed: 0,
        senderCount: senderIds.length,
        leadSenderName: senders.get(rows[0]!.senderId)?.name ?? null,
        startedAt: iso(Math.min(...rows.map((job) => job.createdAt))),
        senderIds,
        senderKeys: [],
      });
    }
    return ok(listed.reverse());
  }

  /* ───────────── unsubscribe ───────────── */

  function unsubscribeIntent(body: Record<string, unknown>): Reply {
    const sender = typeof body.senderId === 'string' ? senders.get(body.senderId) : undefined;
    if (!sender) return fail(404, 'SENDER_NOT_FOUND', 'Sender not found.');
    const running = [...jobs.values()].some(
      (job) => job.senderId === sender.id && job.verb === 'unsubscribe' && job.status !== 'done',
    );
    if (running) {
      return fail(409, 'UNSUBSCRIBE_IN_FLIGHT', 'An unsubscribe request is already on its way.');
    }
    recordIntent(sender);
    const job =
      sender.unsubscribe === 'one_click'
        ? enqueue(sender, 'unsubscribe', { requestedCount: 1 })
        : null;
    return ok<UnsubscribeIntentResult>({
      senderId: sender.id,
      recordedAt: iso(),
      activityLogId: sender.history[0]!.id,
      lifecycleStatus: sender.unsubStatus!,
      method: sender.unsubscribe,
      executionActionId: job?.id ?? null,
      mailtoUrl: mailtoUrl(sender),
    });
  }

  function unsubscribeBacklog(body: Record<string, unknown>): Reply {
    const mode = body.mode as UnsubscribeBacklogResult['mode'];
    const ids = [...new Set((body.senderIds as string[] | undefined) ?? [])];
    const olderThanDays = typeof body.olderThanDays === 'number' ? body.olderThanDays : null;
    const reach: Reach = mode === 'delete' && body.reach === 'all_mail' ? 'all_mail' : 'inbox_only';
    const overridden = ids.length === 1 && body.override === true;

    const results: UnsubscribeBacklogSenderResult[] = [];
    const takes: DemoSender[] = [];
    for (const id of ids) {
      const sender = senders.get(id);
      const reason = !sender ? 'not_found' : sender.isProtected && !overridden ? 'protected' : null;
      if (reason === null) takes.push(sender!);
      else {
        results.push({
          senderId: id,
          method: sender?.unsubscribe ?? null,
          mailtoUrl: null,
          executionActionId: null,
          lifecycleStatus: null,
          unsubStatus: 'skipped',
          reasonCode: reason,
        });
      }
    }

    // The backlog move is queued first, then each unsubscribe joins it.
    let backlog: UnsubscribeBacklogResult['backlog'] = null;
    if (mode !== 'unsub_only') {
      const moving = takes.filter(
        (sender) => !liveForwardJob(sender.id) && matching(sender, mode, olderThanDays, reach) > 0,
      );
      let groupId: string | undefined;
      let requestedCount = 0;
      for (const sender of moving) {
        const job = enqueue(sender, mode, {
          ...(groupId ? { groupId } : {}),
          olderThanDays,
          reach,
          requestedCount: matching(sender, mode, olderThanDays, reach),
        });
        groupId ??= job.id;
        requestedCount += job.requestedCount;
      }
      if (groupId) {
        backlog = {
          actionId: groupId,
          handle: moving.length === 1 ? 'action' : 'batch',
          requestedCount,
          verb: mode,
        };
      }
    }

    for (const sender of takes) {
      recordIntent(sender);
      const job =
        sender.unsubscribe === 'one_click'
          ? enqueue(sender, 'unsubscribe', {
              ...(backlog ? { groupId: backlog.actionId } : {}),
              requestedCount: 1,
            })
          : null;
      results.push({
        senderId: sender.id,
        method: sender.unsubscribe,
        mailtoUrl: mailtoUrl(sender),
        executionActionId: job?.id ?? null,
        lifecycleStatus: sender.unsubStatus,
        unsubStatus:
          sender.unsubscribe === 'one_click'
            ? 'requested'
            : sender.unsubscribe === 'mailto'
              ? 'manual'
              : 'failed',
        reasonCode: sender.unsubscribe === 'none' ? 'no_link' : null,
      });
    }
    return ok<UnsubscribeBacklogResult>({ feedbackVersion: 2, mode, backlog, senders: results });
  }

  function manualStatus(body: Record<string, unknown>): Reply {
    const sender = typeof body.senderId === 'string' ? senders.get(body.senderId) : undefined;
    if (!sender) return fail(404, 'SENDER_NOT_FOUND', 'Sender not found.');
    const status = body.status as UnsubscribeManualStatusResult['status'];
    const from = sender.unsubStatus;
    if (from === null) {
      return fail(409, 'UNSUBSCRIBE_INTENT_REQUIRED', 'Record an unsubscribe first.');
    }
    const changed = from !== status;
    const allowed =
      !changed ||
      (status === 'draft_opened' && from === 'action_required') ||
      (status === 'user_marked_sent' && (from === 'action_required' || from === 'draft_opened'));
    if (!allowed) {
      return fail(409, 'UNSUBSCRIBE_INVALID_TRANSITION', 'That step is not available now.');
    }
    if (changed) sender.unsubStatus = status;
    return ok<UnsubscribeManualStatusResult>({
      senderId: sender.id,
      status,
      recordedAt: iso(),
      activityLogId: changed ? nextId('activity') : null,
      changed,
      irreversible: status === 'user_marked_sent',
    });
  }

  /* ───────────── undo ───────────── */

  const undoable = (job: Job): boolean =>
    job.direction === 'forward' && job.undoToken !== null && job.undoRevertedAt === null;

  function undoList(): Reply {
    const groups = new Map<string, Job[]>();
    for (const job of jobs.values()) {
      if (undoable(job)) groups.set(job.groupId, [...(groups.get(job.groupId) ?? []), job]);
    }
    const entries: UndoWireEntry[] = [...groups].map(([groupId, rows]) => {
      const lead = rows.find((job) => job.id === groupId) ?? rows[0]!;
      const kinds = new Set(rows.map((job) => job.verb));
      return {
        token: lead.undoToken!,
        actionKind: lead.verb,
        createdAt: iso(Math.max(...rows.map((job) => job.finishedAt ?? job.createdAt))),
        expiresAt: rows.map((job) => job.undoExpiresAt!).sort()[0]!,
        groupId,
        senderCount: new Set(rows.map((job) => job.senderId)).size,
        memberCount: rows.length,
        affectedCount: rows.reduce((n, job) => n + job.affectedCount, 0),
        mixedKinds: kinds.size > 1,
        protectedSkippedCount: 0,
        members: [...rows]
          .sort((a, b) => b.affectedCount - a.affectedCount)
          .map((job) => ({
            token: job.undoToken!,
            actionKind: job.verb,
            senderName: senders.get(job.senderId)?.name ?? null,
            affectedCount: job.affectedCount,
          })),
      };
    });
    entries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return ok(entries, { pagination: { nextCursor: null, hasMore: false, limit: 50 } });
  }

  function revert(token: string, scope: 'decision' | 'member'): Reply {
    const owner = [...jobs.values()].find(
      (job) => job.direction === 'forward' && job.undoToken === token,
    );
    if (!owner) return fail(404, 'NOT_FOUND', 'Nothing to undo.');
    const group = scope === 'member' ? [owner] : forwardJobs(owner.groupId);
    if (forwardJobs(owner.groupId).some((job) => job.status !== 'done')) {
      return fail(409, 'ACTION_STILL_RUNNING', 'This action is still running.');
    }
    const targets = group.filter(undoable);
    const base = { token, actionKind: owner.verb, expired: false } as const;
    if (targets.length === 0) {
      return ok<UndoRevertResult>({
        ...base,
        reverted: true,
        revertedAt: owner.undoRevertedAt,
        actionId: null,
        actionIds: [],
      });
    }
    const reverseIds = targets.map((forward) => {
      const running = [...jobs.values()].find(
        (job) => job.reverses === forward.id && job.status !== 'done',
      );
      if (running) return running.id;
      const id = nextId('action');
      jobs.set(id, {
        ...forward,
        id,
        direction: 'reverse',
        status: 'executing',
        requestedCount: forward.affectedCount,
        affectedCount: 0,
        createdAt: Date.now(),
        finishedAt: null,
        moved: null,
        undoToken: null,
        undoExpiresAt: null,
        undoRevertedAt: null,
        reverses: forward.id,
        historyId: null,
      });
      return id;
    });
    return ok<UndoRevertResult>({
      ...base,
      reverted: false,
      revertedAt: null,
      actionId: reverseIds[0]!,
      actionIds: reverseIds,
    });
  }

  function undoStatus(ids: readonly string[]): Reply {
    const rows = ids.flatMap((id) => jobs.get(id) ?? []);
    if (rows.length === 0) return fail(404, 'ACTION_NOT_FOUND', 'Action not found.');
    const finished = rows.every((job) => job.status === 'done');
    return ok<ActionStatusResult>({
      actionId: rows[0]!.id,
      verb: rows[0]!.verb,
      direction: 'reverse',
      status: finished ? 'done' : 'executing',
      requestedCount: rows.reduce((n, job) => n + job.requestedCount, 0),
      affectedCount: rows.reduce((n, job) => n + job.affectedCount, 0),
      wakeAt: null,
      undoToken: null,
      undoExpiresAt: null,
      undoExecutedAt: null,
      undoRevertedAt: finished
        ? (rows
            .map((job) => job.undoRevertedAt)
            .filter(Boolean)
            .sort()
            .at(-1) ?? null)
        : null,
      errorCode: null,
    });
  }

  /* ───────────── report, review queue, settings ───────────── */

  function inboxReport(): InboxReportDto {
    return sampleInboxReport(
      [...senders.values()].map((sender) => ({
        id: sender.id,
        received90d: sender.received90d,
        totalReceived: sender.totalReceived,
        markedReadPct: sender.readPct,
        wroteTo: sender.wroteTo,
        protected: sender.isProtected,
        unsubscribe: sender.unsubscribe,
        inboxCount: sum(sender.inbox),
        ...(sender.policyType === 'keep' ? { kept: true } : {}),
        ...(sender.policyType === 'unsubscribe' ? { handledByBacklog: true } : {}),
      })),
      iso(),
    );
  }

  function triageBootstrap(): TriageBootstrap {
    const queue = [...senders.values()]
      .filter((sender) => !sender.decided && activityOf(sender) === 'active')
      .map((sender): TriageDecisionRow => {
        const row = listRow(sender);
        return {
          id: sender.id,
          senderId: sender.id,
          senderKey: sender.id,
          senderName: sender.name,
          senderEmail: sender.email,
          senderDomain: row.domain,
          brandMark: false,
          gmailCategory: sender.category,
          unsubscribeMethod: sender.unsubscribe,
          verdict: sender.suggestion.verdict,
          confidence: 0.8,
          reasoning: sender.suggestion.reasoning,
          generatedBy: 'template',
          signals: [
            `${sender.received90d} emails in the last 90 days`,
            `${sender.readPct}% marked read`,
          ],
          protectionReason: !sender.isProtected
            ? null
            : sender.protection === 'replied'
              ? 'replied'
              : sender.protection === 'starred'
                ? 'starred'
                : sender.protection === 'gmail_important'
                  ? 'gmail-important'
                  : 'manual',
          monthlyVolume: Math.round(sender.received90d / 3),
          last90dMessages: sender.received90d,
          inboxCount: row.inboxCount ?? 0,
          readRate: row.readRate,
          lastSeenAt: row.lastSeenAt,
          totalAllTime: sender.totalReceived,
          unreadInboxCount: row.unreadInboxCount ?? 0,
        };
      });
    const today = [...senders.values()].flatMap((sender) => sender.history);
    const count = (action: DecisionHistoryRowDto['action']) =>
      today.filter((row) => row.action === action && !row.revertedAt).length;
    const noise = queue.filter((row) => row.verdict !== 'keep').length;
    return {
      queue,
      stats: {
        decidedToday: today.filter((row) => !row.revertedAt).length,
        archivedToday: count('archive'),
        unsubscribedToday: count('unsubscribe'),
        laterToday: count('later'),
        freeRemaining: null,
        tier: 'plus',
      },
      todaySummary: {
        receivedToday: [...senders.values()].filter((sender) => sender.lastSeenDays === 0).length,
        sendersToday: [...senders.values()].filter((sender) => sender.lastSeenDays === 0).length,
        handledAutomatically: 0,
        queuedDecisions: queue.length,
        noiseSenderCount: noise,
        noiseReductionPct: null,
      },
    };
  }

  function settings(): MeSettings {
    return {
      emailPrefs: DEFAULT_EMAIL_PREFS,
      actionSheetPrefs,
      briefPrefs: DEFAULT_BRIEF_PREFS,
      senderViews,
      // The demo has no AI behind it, so it never asks to use one.
      aiConsent: { explanations: 'off', brief: 'off', reask: false },
    };
  }

  const onboarding: OnboardingState = {
    onboardedAt: new Date(Date.now() - DAY_MS).toISOString(),
    skipped: false,
    goal: null,
    presetPicks: null,
    presets: [],
    verbTourCompletedAt: new Date(Date.now() - DAY_MS).toISOString(),
  };

  function backlogCandidate(): { senderId: string; name: string; inboxEmails: number } | null {
    const top = [...senders.values()]
      .filter((sender) => !sender.isProtected && sum(sender.inbox) > 0)
      .sort((a, b) => sum(b.inbox) - sum(a.inbox))[0];
    return top ? { senderId: top.id, name: top.name, inboxEmails: sum(top.inbox) } : null;
  }

  /* ───────────── routing ───────────── */

  function route({ method, path, query, body }: Request): Reply | null {
    const sender = /^\/api\/senders\/([^/]+)(\/.*)?$/.exec(path);
    if (sender && !['summary', 'suggest'].includes(sender[1]!)) {
      const found = senders.get(decodeURIComponent(sender[1]!));
      const rest = sender[2] ?? '';
      const known =
        (method === 'GET' && ['', '/messages', '/timeseries', '/history'].includes(rest)) ||
        (method === 'PATCH' && rest === '/policy') ||
        (method === 'POST' && rest === '/keep/undo');
      if (!known) return null;
      if (!found) return fail(404, 'SENDER_NOT_FOUND', 'Sender not found.');
      if (rest === '') return ok(detail(found));
      if (rest === '/timeseries') return ok(timeseries(found));
      if (rest === '/policy') return patchPolicy(found, body);
      if (rest === '/keep/undo') return undoKeep(found);
      const rows: Array<MailMessageRow | DecisionHistoryRowDto> =
        rest === '/messages' ? messages(found, query.get('scope') ?? 'all_mail') : found.history;
      const limit = Math.min(50, Number.parseInt(query.get('limit') ?? '10', 10) || 10);
      const offset = Number.parseInt(query.get('cursor') ?? '0', 10) || 0;
      const hasMore = offset + limit < rows.length;
      return ok(rows.slice(offset, offset + limit), {
        pagination: { nextCursor: hasMore ? String(offset + limit) : null, hasMore, limit },
      });
    }

    const key = `${method} ${path}`;
    switch (key) {
      case 'GET /api/senders':
        return listSenders(query);
      case 'GET /api/senders/summary':
        return summary();
      case 'GET /api/senders/suggest': {
        const q = (query.get('q') ?? '').trim().toLowerCase();
        const limit = Math.min(20, Number.parseInt(query.get('limit') ?? '8', 10) || 8);
        const hits: SenderSuggestionDto[] = [...senders.values()]
          .filter((item) => q !== '' && `${item.name} ${item.email}`.toLowerCase().includes(q))
          .sort((a, b) => b.totalReceived - a.totalReceived)
          .slice(0, limit)
          .map((item) => ({
            id: item.id,
            name: item.name,
            email: item.email,
            // Left empty on purpose. This wire has no `brandMark`, so the
            // search dropdown asks the real API for a logo of any domain
            // it is given, and these domains are made up.
            domain: '',
            totalReceived: item.totalReceived,
            activity: activityOf(item),
          }));
        return ok({ senders: hits });
      }
      case 'GET /api/actions/preview':
        return preview(query.get('senderId'));
      case 'POST /api/actions/preview/bulk':
        return bulkPreview((body.senderIds as string[] | undefined) ?? []);
      case 'POST /api/actions':
        return (body.selector as { type?: string } | undefined)?.type === 'senders'
          ? enqueueBulk(body)
          : enqueueSingle(body);
      case 'GET /api/actions/active':
        return activeGroups();
      case 'POST /api/actions/undo-status':
        return undoStatus((body.actionIds as string[] | undefined) ?? []);
      case 'POST /api/actions/unsubscribe-intent':
        return unsubscribeIntent(body);
      case 'POST /api/actions/unsubscribe-backlog':
        return unsubscribeBacklog(body);
      case 'POST /api/actions/unsubscribe-manual-status':
        return manualStatus(body);
      case 'POST /api/actions/keep-intent': {
        const kept = typeof body.senderId === 'string' ? senders.get(body.senderId) : undefined;
        if (!kept) return fail(404, 'SENDER_NOT_FOUND', 'Sender not found.');
        kept.policyType = 'keep';
        kept.decided = true;
        return ok<KeepIntentResult>({
          senderId: kept.id,
          recordedAt: iso(),
          activityLogId: addHistory(kept, 'keep', 0, 'triage'),
        });
      }
      case 'GET /api/undo':
        return undoList();
      case 'GET /api/me/settings':
        return ok(settings());
      case 'PATCH /api/me/sender-views':
        senderViews = (body.views as SavedSenderView[] | undefined) ?? [];
        return ok({ senderViews });
      case 'PATCH /api/me/action-sheet-prefs':
        actionSheetPrefs = { ...actionSheetPrefs, ...(body as Partial<ActionSheetPrefs>) };
        return ok({ actionSheetPrefs });
      case 'POST /api/me/ai-consent':
        return ok({ aiConsent: settings().aiConsent });
      case 'GET /api/onboarding/state':
        return ok(onboarding);
      case 'GET /api/onboarding/backlog':
        return ok(backlogCandidate());
      case 'GET /api/triage/bootstrap':
        return ok(triageBootstrap());
      case 'POST /api/triage/score-sender':
        return ok({ idempotencyKey: nextId('score') });
      case 'POST /api/triage/explain':
        // AI explanations are off in the demo, so nothing is queued.
        return ok<{ queued: string[] }>({ queued: [] });
      case `GET /api/mailboxes/${DEMO_MAILBOX_ID}/inbox-report`:
        return ok(inboxReport());
      default:
        break;
    }

    const batch = /^\/api\/actions\/batch\/([^/]+)$/.exec(path);
    if (method === 'GET' && batch) return batchStatus(batch[1]!);
    const action = /^\/api\/actions\/([^/]+)$/.exec(path);
    if (method === 'GET' && action) {
      const job = jobs.get(action[1]!);
      return job ? ok(snapshot(job)) : fail(404, 'ACTION_NOT_FOUND', 'Action not found.');
    }
    const undo = /^\/api\/undo\/([^/]+)(\/action)?$/.exec(path);
    if (method === 'POST' && undo) {
      return revert(decodeURIComponent(undo[1]!), undo[2] ? 'member' : 'decision');
    }
    return null;
  }

  const transport = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    const url = new URL(
      String(input instanceof Request ? input.url : input),
      'http://demo.invalid',
    );
    const method = (init?.method ?? 'GET').toUpperCase();
    let body: Record<string, unknown> = {};
    if (typeof init?.body === 'string' && init.body.length > 0) {
      body = JSON.parse(init.body) as Record<string, unknown>;
    }
    settle();
    let reply = route({ method, path: url.pathname, query: url.searchParams, body });
    if (reply === null) {
      unhandled.push(`${method} ${url.pathname}`);
      reply = fail(501, 'DEMO_UNHANDLED_REQUEST', 'The demo has no answer for this request.');
    }
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  return { transport, unhandled, hasSender: (id) => senders.has(id) };
}
