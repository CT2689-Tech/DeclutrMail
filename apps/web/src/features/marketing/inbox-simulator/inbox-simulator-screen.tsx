'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';

import {
  ACTION_SAFETY_SUMMARY,
  MANUAL_ACTION_SCOPE_CLAIM,
  OAUTH_SCOPE_DISCLOSURE,
  Button,
  Eyebrow,
  TIER_MANIFEST,
  type Capability,
  tokens,
  type TierId,
} from '@declutrmail/shared';
import { ACTION_REGISTRY, defaultLaterWakeAtIso } from '@declutrmail/shared/actions';
import { CASA_VERIFICATION_APPROVED_ON, DELETE_RECOVERY_CLAIM } from '@declutrmail/shared/copy';
import { MIN_UNDO_WINDOW_DAYS } from '@declutrmail/shared/entitlements';

import { TrackedCta } from '@/features/marketing/landing/tracked-cta';
import { CAPABILITY_LABELS, PRICING_TIER_ORDER } from '@/features/marketing/pricing/pricing-model';
import { TRIAGE_QUEUE, type TriageDecisionRow } from '@/features/triage/data';
import { findDomainBatches, type DomainBatch } from '@/features/triage/domain-batch';
import { DomainBatchCard, type BatchVerb } from '@/features/triage/domain-batch-card';
import { ActionSheet, type ConfirmDetails } from '@/features/triage/action-sheet';
import type { ActionPreviewDetail } from '@/features/triage/action-preview-detail';
import { BatchActionSheet } from '@/features/triage/batch-action-sheet';
import { TriageFocusCard } from '@/features/triage/focus-card';
import { TriageRow } from '@/features/triage/triage-row';
import { VERB_ORDER, type ActionVerb } from '@/features/triage/types';
import type { SheetableVerb } from '@/features/triage/store';
import { ActivateRuleModal } from '@/features/autopilot/activate-rule-modal';
import { permissionEntryUrl, siteUrl } from '@/features/marketing/landing/urls';
import { simulatorShareUrl } from '@/features/marketing/signup-ref';
import { track } from '@/lib/posthog';
import {
  buildSyntheticBulkPreview,
  buildSyntheticRulePreview,
  syntheticArchivedCount,
  syntheticInboxCount,
  SYNTHETIC_RULE,
} from './synthetic-preview';

const { color } = tokens;

// Keep the richer synthetic Senders workspace out of Triage's first-load chunk.
const SendersSimulator = dynamic(
  () => import('./senders-simulator').then((module) => module.SendersSimulator),
  { ssr: false },
);

// The FULL fixture queue on purpose (was slice(0,7)): the last two
// rows are the demo's most instructive states — a reply-protected
// sender (automatic/bulk protection explained, D245 signal shown) and an
// Unsubscribe recommendation with NO unsubscribe channel (disabled verb
// with an honest explanation). Trust is the product; show the honest
// edges, not just the happy path.
const DEMO_ROWS = TRIAGE_QUEUE;
const DEMO_ROW_BY_ID = new Map(DEMO_ROWS.map((row) => [row.id, row] as const));
const DEMO_VERBS: ReadonlySet<string> = new Set(VERB_ORDER);
const DEMO_DECISION_KEYS = new Set(['rowId', 'verb', 'senderName', 'affectedCount', 'at']);
// v4 (Plan 4 Task 5) adds `ruleDecision` — the rule step (kind: 'rule') has
// no row, so its outcome is not a `DemoDecision` and needs its own top-level
// field. The key-count check below rejects any pre-v4 payload on shape
// alone, before the `version` field is even inspected.
const DEMO_STATE_KEYS = new Set(['version', 'mode', 'decisions', 'ruleDecision']);
const STORAGE_KEY = 'dm.inbox-simulator.state.v4';
const LEGACY_STORAGE_KEY = 'dm.inbox-simulator.decisions.v2';

type DemoMode = 'guided' | 'explore';
/** Mirrors the rule step's `ruleActivated` state — `null` until the visitor
 *  confirms either `ActivateRuleModal` path (see `confirmRule`). */
type RuleDecision = 'active' | 'observe' | null;

interface DemoDecision {
  rowId: string;
  verb: ActionVerb;
  senderName: string;
  affectedCount: number;
  at: number;
}

interface PendingDecision {
  row: TriageDecisionRow;
  verb: SheetableVerb;
  /** Exact Later return time carried into the sheet; null for other verbs. */
  wakeAt: string | null;
}

interface StoredDemoState {
  version: 4;
  mode: DemoMode;
  decisions: DemoDecision[];
  ruleDecision: RuleDecision;
}

function requireDemoRow(rowId: string): TriageDecisionRow {
  const row = DEMO_ROW_BY_ID.get(rowId);
  if (!row) throw new Error(`Missing inbox simulator fixture: ${rowId}`);
  return row;
}

/**
 * Every batch the demo fixtures form, resolved once at module load —
 * `DEMO_ROWS` is a constant array, so this is the same run
 * `findDomainBatches` would return on every render, computed once.
 */
const DEMO_DOMAIN_BATCHES: readonly DomainBatch[] = findDomainBatches(DEMO_ROWS);

function requireDemoBatch(domain: string): DomainBatch {
  const batch = DEMO_DOMAIN_BATCHES.find((candidate) => candidate.domain === domain);
  if (!batch) throw new Error(`Missing inbox simulator batch: ${domain}`);
  return batch;
}

interface ScenarioBase {
  shortLabel: string;
  title: string;
  body: string;
  prompt: string;
}
/** One sender, one decision — the original demo shape. */
interface RowScenario extends ScenarioBase {
  kind: 'row';
  row: TriageDecisionRow;
}
/** A whole domain decided at once — proves the scale claim. */
interface BatchScenario extends ScenarioBase {
  kind: 'batch';
  domain: string;
}
/** No row at all: an Autopilot rule preview. */
interface RuleScenario extends ScenarioBase {
  kind: 'rule';
}
export type GuidedScenario = RowScenario | BatchScenario | RuleScenario;

/** The Amazon batch's own facts, derived rather than retyped. */
const amazonBatch = requireDemoBatch('amazon.com');

export const GUIDED_SCENARIOS: readonly GuidedScenario[] = [
  {
    kind: 'batch',
    domain: amazonBatch.domain,
    shortLabel: 'Scale',
    title: 'Review a group in one decision.',
    body: `${amazonBatch.rows.length} senders share ${amazonBatch.domain}. ${amazonBatch.eligibleRows.length} can join this batch; Protected and low-signal senders stay out. Preview the current count before anything moves.`,
    prompt: 'Try Archive all — it covers every eligible sender at once.',
  },
  {
    kind: 'row',
    row: requireDemoRow('t-linkedin'),
    shortLabel: 'One-way',
    title: 'Pause before a one-way request.',
    body: 'Unsubscribe asks this sender to stop future delivery. You see the method first because a delivered request cannot be recalled.',
    prompt: 'Try Unsubscribe — then inspect the warning.',
  },
  {
    kind: 'rule',
    shortLabel: 'Make it stick',
    title: 'A preset can keep watch.',
    body: `${MANUAL_ACTION_SCOPE_CLAIM} Autopilot offers separate preset rules; a manual decision does not create one.`,
    prompt: 'Preview the low-engagement Archive preset against the sample mailbox.',
  },
  {
    kind: 'row',
    row: requireDemoRow('t-groupon'),
    shortLabel: 'Free the space',
    title: 'Archiving freed no storage.',
    // Only the lead clause is hand-written; the recovery model itself is
    // the canonical claim, imported rather than retyped (D245-adjacent —
    // the same "one truth, many surfaces" reasoning as the storage list).
    body: `Archive leaves email in All Mail. Unsubscribe alone moves no existing email. Delete moves email to Trash; storage is freed only after permanent deletion in Gmail. ${DELETE_RECOVERY_CLAIM}`,
    prompt: 'Try Delete — inspect the Trash and recovery boundaries before confirming.',
  },
] as const;

/** The scenario's own row ids — for a batch, every ELIGIBLE member (a
 *  batch decision is recorded as one `DemoDecision` per eligible row, so
 *  these are exactly the ids `chooseBatchAction`'s confirm produces). */
function guidedScenarioRowIds(scenario: GuidedScenario): readonly string[] {
  switch (scenario.kind) {
    case 'row':
      return [scenario.row.id];
    case 'batch':
      return requireDemoBatch(scenario.domain).eligibleRows.map((row) => row.id);
    case 'rule':
      return [];
  }
}

const GUIDED_ROW_IDS: ReadonlySet<string> = new Set(GUIDED_SCENARIOS.flatMap(guidedScenarioRowIds));

/** A stable React key across scenario kinds — a batch has no `row.id`. */
function scenarioKey(scenario: GuidedScenario): string {
  switch (scenario.kind) {
    case 'row':
      return scenario.row.id;
    case 'batch':
      return `batch:${scenario.domain}`;
    case 'rule':
      return 'rule';
  }
}

/**
 * Whether this guided step's decision has been recorded. A batch is
 * complete only once every ELIGIBLE member has its own decision — the
 * same predicate the batch confirm itself fans out to. The rule step has
 * no row at all, so its completion travels as its own `ruleDecided` flag
 * rather than through `decidedIds` — set once `ActivateRuleModal`
 * confirms either path (turn on and run it, or watch first; both are a
 * real decision, not just the acting one).
 */
function isScenarioComplete(
  scenario: GuidedScenario,
  decidedIds: ReadonlySet<string>,
  ruleDecided: boolean,
): boolean {
  switch (scenario.kind) {
    case 'row':
      return decidedIds.has(scenario.row.id);
    case 'batch':
      return requireDemoBatch(scenario.domain).eligibleRows.every((row) => decidedIds.has(row.id));
    case 'rule':
      return ruleDecided;
  }
}

function isActionVerb(value: unknown): value is ActionVerb {
  return typeof value === 'string' && DEMO_VERBS.has(value);
}

/**
 * Treat browser storage as an untrusted wire boundary. The persisted
 * sender name/count are redundant display data, so validate them against
 * the current synthetic fixture before restoring anything. One malformed
 * entry rejects the whole snapshot: a partial restore would silently
 * change which decisions the visitor appears to have completed.
 */
function parseStoredDecisions(parsed: unknown): DemoDecision[] | null {
  if (!Array.isArray(parsed) || parsed.length > DEMO_ROWS.length) return null;

  const restored: DemoDecision[] = [];
  const seenRows = new Set<string>();
  const seenTimestamps = new Set<number>();
  for (const candidate of parsed) {
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate))
      return null;

    const record = candidate as Record<string, unknown>;
    const keys = Object.keys(record);
    if (
      keys.length !== DEMO_DECISION_KEYS.size ||
      keys.some((key) => !DEMO_DECISION_KEYS.has(key))
    ) {
      return null;
    }
    if (typeof record.rowId !== 'string' || seenRows.has(record.rowId)) return null;
    const row = DEMO_ROW_BY_ID.get(record.rowId);
    if (!row || !isActionVerb(record.verb) || record.senderName !== row.senderName) return null;
    if (row.unsubscribeMethod === 'none' && record.verb === 'Unsubscribe') return null;

    if (
      typeof record.affectedCount !== 'number' ||
      !Number.isSafeInteger(record.affectedCount) ||
      record.affectedCount < 0
    ) {
      return null;
    }
    // Unsubscribe's affected count is 0 UNLESS the visitor also ticked
    // the historic-archive toggle (D226 — Task 3 `ActionSheet` swap), in
    // which case it matches the same live count Archive/Later/Delete
    // use. Both are the only two legitimate values for that verb; a
    // single hard-coded expectation would reject an honest entry (and
    // one malformed entry rejects the whole snapshot below).
    const expectedCounts: readonly number[] =
      record.verb === 'Delete'
        ? [syntheticInboxCount(row), syntheticInboxCount(row) + syntheticArchivedCount(row)]
        : record.verb === 'Archive' || record.verb === 'Later'
          ? [syntheticInboxCount(row)]
          : record.verb === 'Unsubscribe'
            ? [0, syntheticInboxCount(row)]
            : [0];
    if (!expectedCounts.includes(record.affectedCount)) return null;

    if (
      typeof record.at !== 'number' ||
      !Number.isSafeInteger(record.at) ||
      record.at <= 0 ||
      seenTimestamps.has(record.at)
    ) {
      return null;
    }

    seenRows.add(record.rowId);
    seenTimestamps.add(record.at);
    restored.push({
      rowId: row.id,
      verb: record.verb,
      senderName: row.senderName,
      // Already validated against `expectedCounts` above — one of two
      // legitimate values for Unsubscribe, the one legitimate value for
      // everything else — so the incoming value itself is the sanitized one.
      affectedCount: record.affectedCount,
      at: record.at,
    });
  }
  return restored;
}

function parseStoredState(stored: string): StoredDemoState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== DEMO_STATE_KEYS.size ||
    keys.some((key) => !DEMO_STATE_KEYS.has(key)) ||
    record.version !== 4 ||
    (record.mode !== 'guided' && record.mode !== 'explore') ||
    (record.ruleDecision !== 'active' &&
      record.ruleDecision !== 'observe' &&
      record.ruleDecision !== null)
  ) {
    return null;
  }

  const decisions = parseStoredDecisions(record.decisions);
  if (decisions === null) return null;
  return { version: 4, mode: record.mode, decisions, ruleDecision: record.ruleDecision };
}

function parseLegacyState(stored: string): StoredDemoState | null {
  try {
    const decisions = parseStoredDecisions(JSON.parse(stored));
    // The v2 format predates the rule step entirely, so there is nothing to
    // migrate it from — `null` is the only honest value here.
    return decisions === null
      ? null
      : { version: 4, mode: 'guided', decisions, ruleDecision: null };
  } catch {
    return null;
  }
}

function hasCompletedGuide(decisions: readonly DemoDecision[], ruleDecided: boolean): boolean {
  const decidedIds = new Set(decisions.map((decision) => decision.rowId));
  return GUIDED_SCENARIOS.every((scenario) =>
    isScenarioComplete(scenario, decidedIds, ruleDecided),
  );
}

/** The row to auto-expand next, or `null` when the current step is not a
 *  single row (a batch card and the rule preview manage their own focus). */
function firstUndecidedRow(
  mode: DemoMode,
  decisions: readonly DemoDecision[],
  ruleDecided: boolean,
): TriageDecisionRow | null {
  const decidedIds = new Set(decisions.map((decision) => decision.rowId));
  if (mode === 'explore') {
    return DEMO_ROWS.find((row) => !decidedIds.has(row.id)) ?? null;
  }
  const current = GUIDED_SCENARIOS.find(
    (scenario) => !isScenarioComplete(scenario, decidedIds, ruleDecided),
  );
  return current?.kind === 'row' ? current.row : null;
}

function decisionSummary(decision: DemoDecision): string {
  switch (decision.verb) {
    case 'Keep':
      return 'Keep decision recorded. No messages moved.';
    case 'Archive':
      return `${decision.affectedCount} sample messages moved out of Inbox into All Mail.`;
    case 'Later':
      return `${decision.affectedCount} sample messages moved to DeclutrMail/Later.`;
    case 'Unsubscribe':
      // The historic-archive toggle (D226) is the only way Unsubscribe's
      // own affectedCount is ever nonzero — see `recordDecision`.
      return decision.affectedCount > 0
        ? `Sample unsubscribe request recorded — it can't be recalled. ${decision.affectedCount} sample messages already in the inbox were also archived.`
        : 'Sample unsubscribe request recorded. A delivered request cannot be recalled.';
    case 'Delete':
      return `${decision.affectedCount} sample messages moved to Gmail Trash.`;
  }
}

function isActivityUndoable(decision: DemoDecision): boolean {
  return (
    decision.verb === 'Archive' ||
    decision.verb === 'Later' ||
    decision.verb === 'Delete' ||
    (decision.verb === 'Unsubscribe' && decision.affectedCount > 0)
  );
}

/**
 * What each paid tier ADDS over the one below it, in the manifest's own
 * words. Hand-written before (2026-08-26): the Plus line said "Rules keep
 * it clean for you", which named Autopilot and silently omitted Screener
 * and Quiet hours — both Plus since the 2026-08-23 packaging patch. A
 * plan-comparison strip that a packaging change does not reach is a strip
 * that goes quietly wrong.
 *
 * `CAPABILITY_LABELS` is a total `Record<Capability, string>`, so a new
 * capability without a label is a compile error, and it is deduplicated
 * because `autopilot` and `autopilot-active` deliberately share one label.
 */
/**
 * The name of the cheapest tier that grants `capability`, read from the
 * manifest rather than written down.
 *
 * Step 3 shows an Autopilot rule, and Autopilot is a paid capability — a
 * visitor who is not told that meets the paywall later, having been sold
 * on it here. Naming the tier by hand is how the plan strip came to omit
 * Screener: Autopilot itself moved Pro -> Plus on 2026-08-23 and every
 * hand-written mention had to be found. Derived, this follows the next
 * move on its own.
 */
function tierGranting(capability: Capability): string {
  const tier = PRICING_TIER_ORDER.find((id) => TIER_MANIFEST[id].capabilities.includes(capability));
  return tier ? TIER_MANIFEST[tier].name : '';
}

function capabilitiesAddedBy(tier: TierId, previous: TierId): readonly string[] {
  const had = new Set(TIER_MANIFEST[previous].capabilities);
  return [
    ...new Set(
      TIER_MANIFEST[tier].capabilities
        .filter((c) => !had.has(c))
        .map((c) => CAPABILITY_LABELS[c].split('—')[0]!.trim()),
    ),
  ];
}

export function InboxSimulatorScreen() {
  const [orientationOpen, setOrientationOpen] = useState(false);
  const [workspace, setWorkspace] = useState<'triage' | 'senders'>('senders');
  const [decisions, setDecisions] = useState<DemoDecision[]>([]);
  const [mode, setMode] = useState<DemoMode>('explore');
  const [reviewLayout, setReviewLayout] = useState<'focus' | 'list'>('list');
  const [focusIndex, setFocusIndex] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingDecision | null>(null);
  const [deleteReach, setDeleteReach] = useState<'inbox_only' | 'all_mail'>('inbox_only');
  const [pendingBatch, setPendingBatch] = useState<{
    batch: DomainBatch;
    verb: BatchVerb;
    wakeAt: string | null;
  } | null>(null);
  const [pendingRule, setPendingRule] = useState(false);
  // Persisted since the v4 bump (Plan 4 Task 5) — see `StoredDemoState`.
  // Restored below by the hydration effect, so a reload after step 3
  // resumes at step 4 rather than replaying an already-decided rule step.
  const [ruleActivated, setRuleActivated] = useState<RuleDecision>(null);
  const [dismissedDomains, setDismissedDomains] = useState<readonly string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  // Explicit step selection from the progress bar or a `?step=` deep
  // link. `null` means "follow the guide" — the displayed step tracks
  // whichever scenario is first-incomplete, same as before free
  // navigation existed. Once set, it pins the view regardless of which
  // step is actually next, so revisiting/looking ahead never fires an
  // action out from under the visitor.
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  // Measured elapsed time (never a hardcoded figure). `startedAt` is
  // stamped by an effect the first time ANY decision exists — not during
  // render, so server and first-paint HTML never have to guess a value
  // that depends on wall-clock time. `completedAt` is stamped inside
  // `maybeTrackGuideCompletion`, the same one-way latch that already
  // guards the `demo_completed` analytics event, so both share one
  // "first time only" rule. Neither is persisted — see the `StoredDemoState`
  // comment; a reload restarts the clock like every other ephemeral state.
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [completedAt, setCompletedAt] = useState<number | null>(null);
  const guidedCompletionTracked = useRef(false);
  const decisionLock = useRef<string | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const legacyStored = stored ? null : localStorage.getItem(LEGACY_STORAGE_KEY);
      const restored = stored
        ? parseStoredState(stored)
        : legacyStored
          ? parseLegacyState(legacyStored)
          : null;
      if (restored) {
        setDecisions(restored.decisions);
        // The old persisted guide remains available, but a direct visit
        // should present the current Triage queue rather than an old tour.
        setMode('explore');
        setRuleActivated(restored.ruleDecision);
        const ruleDecidedRestored = restored.ruleDecision != null;
        setExpandedId(null);
        guidedCompletionTracked.current = hasCompletedGuide(
          restored.decisions,
          ruleDecidedRestored,
        );
      }
      if (legacyStored) localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // A corrupt or unavailable local store never blocks the demo.
    }
    // Deep link — `?step=1..4` jumps straight to a guided step. Read from
    // `location.search` rather than `useSearchParams()` so this stays
    // client-only with no Suspense boundary requirement, consistent with
    // the rest of this component's hydration-safe (server-then-client)
    // pattern.
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('workspace') === 'triage' || params.has('step')) setWorkspace('triage');
      if (params.get('tour') === '1') setMode('guided');
      const stepParam = params.get('step');
      const stepIndex = stepParam === null ? NaN : Number(stepParam) - 1;
      if (Number.isInteger(stepIndex) && stepIndex >= 0 && stepIndex < GUIDED_SCENARIOS.length) {
        setMode('guided');
        setViewIndex(stepIndex);
      }
    } catch {
      // A malformed query string never blocks the demo.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      const stored: StoredDemoState = { version: 4, mode, decisions, ruleDecision: ruleActivated };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // Private browsing and quota errors leave the current session usable.
    }
  }, [decisions, hydrated, mode, ruleActivated]);

  // Stamps the demo's start the first time any decision exists — restored
  // ones on hydration count too, since there is nothing to time an
  // already-in-progress session from except "now". Runs once per session
  // (guarded on `startedAt`), in an effect rather than during render, so
  // this can never diverge between the server-rendered HTML and the first
  // client paint (D206-adjacent hydration safety).
  useEffect(() => {
    if (startedAt === null && (decisions.length > 0 || ruleActivated != null)) {
      setStartedAt(Date.now());
    }
  }, [decisions.length, ruleActivated, startedAt]);

  const decidedIds = useMemo(
    () => new Set(decisions.map((decision) => decision.rowId)),
    [decisions],
  );
  const ruleDecided = ruleActivated != null;
  // First not-yet-decided scenario — the guide's default "next up" step,
  // and what a `viewIndex` of `null` falls back to.
  const currentGuideIndex = GUIDED_SCENARIOS.findIndex(
    (scenario) => !isScenarioComplete(scenario, decidedIds, ruleDecided),
  );
  // The DISPLAYED step. An explicit `viewIndex` (progress-bar click or a
  // `?step=` deep link) pins the view to that step regardless of
  // completion state — free navigation means step 3 is visible whether
  // or not step 1 is done. `-1` here means "nothing pinned and every
  // scenario is complete", matching `currentGuideIndex`'s own sentinel.
  const effectiveIndex = viewIndex ?? currentGuideIndex;
  const currentScenario = effectiveIndex === -1 ? null : (GUIDED_SCENARIOS[effectiveIndex] ?? null);
  // Order-independent — counts every INDIVIDUALLY complete scenario, not
  // just a consecutive run from the start. Before free navigation this
  // was reachable only via a hand-crafted localStorage payload (the
  // comment here used to say so); a real visitor can now legitimately
  // decide step 3 before step 1, and "0 of 4" would read as broken.
  const completedGuideCount = GUIDED_SCENARIOS.filter((scenario) =>
    isScenarioComplete(scenario, decidedIds, ruleDecided),
  ).length;
  // Whether the Amazon batch step (index 0) is decided — the rule step's
  // card references it, and with free navigation that step may not have
  // happened yet when the rule step is the one on screen.
  const currentBatch =
    currentScenario?.kind === 'batch'
      ? (findDomainBatches(DEMO_ROWS, dismissedDomains).find(
          (batch) =>
            batch.domain === currentScenario.domain &&
            // `dismissedDomains` is never persisted (Task 5's storage v4
            // only carries `decisions`/`mode`/`ruleDecision`), so a reload
            // after "Decide one by one" forgets the dismissal while
            // keeping whatever rows got individually decided first. Without
            // this check the aggregate card would reappear quoting the
            // ORIGINAL sender/message counts — including a sender that is
            // already archived — which is exactly the stale-preview defect
            // D226 exists to prevent. Once any member has its own decision,
            // treat the batch as left, the same as an explicit dismissal.
            !batch.rows.some((row) => decidedIds.has(row.id)),
        ) ?? null)
      : null;
  // Dismissing the batch card falls back to its full member run rendered
  // one row at a time — the same fallback `planQueueItems` uses when a
  // domain is dismissed — rather than leaving the step with nothing to do.
  const dismissedBatchRows =
    currentScenario?.kind === 'batch' && currentBatch === null
      ? requireDemoBatch(currentScenario.domain).rows.filter((row) => !decidedIds.has(row.id))
      : null;
  const rows =
    mode === 'guided'
      ? currentScenario?.kind === 'row'
        ? [currentScenario.row]
        : (dismissedBatchRows ?? [])
      : DEMO_ROWS.filter((row) => !decidedIds.has(row.id));
  const focusedRow = mode === 'explore' && rows.length > 0 ? rows[focusIndex % rows.length]! : null;
  const isFocusReview = reviewLayout === 'focus' && focusedRow !== null;
  const guidedDecisions = decisions.filter((decision) => GUIDED_ROW_IDS.has(decision.rowId));
  // `null` unless BOTH timestamps exist — see the `completedAt` note above:
  // a session restored already-complete from storage never re-enters
  // `maybeTrackGuideCompletion`, so it never gets a `completedAt`, and the
  // completion screen correctly shows no elapsed figure rather than a
  // reload-time artifact.
  const elapsedMs =
    startedAt !== null && completedAt !== null ? Math.max(0, completedAt - startedAt) : null;

  /** Fire the completion event once, the first time the guide's every
   *  step is done — shared by the single-row, batch, and rule confirm
   *  paths so the "have we completed?" check cannot drift between them.
   *  `ruleDecidedNow` defaults to the current render's `ruleDecided`;
   *  `confirmRule` overrides it with the fresh value, since its own
   *  `setRuleActivated` call has not yet re-rendered when this runs.
   *  Also stamps `completedAt` — measured here, in the same event-handler
   *  pass that already computes "is the guide done now", never during
   *  render (see the `startedAt` effect above for why that matters). */
  const maybeTrackGuideCompletion = (
    nextDecisions: DemoDecision[],
    ruleDecidedNow = ruleDecided,
  ) => {
    if (guidedCompletionTracked.current || !hasCompletedGuide(nextDecisions, ruleDecidedNow))
      return;
    guidedCompletionTracked.current = true;
    setCompletedAt(Date.now());
    const guidedOutcome = nextDecisions.filter((decision) => GUIDED_ROW_IDS.has(decision.rowId));
    void track('demo_completed', {
      decisions_completed: guidedOutcome.length,
      affected_messages: guidedOutcome.reduce(
        (total, decision) => total + decision.affectedCount,
        0,
      ),
    });
  };

  const recordDecision = (row: TriageDecisionRow, verb: ActionVerb, archiveHistoric = false) => {
    if (decisionLock.current === row.id || decidedIds.has(row.id)) return;
    decisionLock.current = row.id;
    queueMicrotask(() => {
      if (decisionLock.current === row.id) decisionLock.current = null;
    });

    // Archive/Later/Delete always move inbox mail. Unsubscribe only does
    // when the visitor also ticked the sheet's historic-archive toggle
    // (D226) — mirrors `ActionSheet`'s own `requiresLivePreview` gate.
    const affectedCount =
      verb === 'Archive' ||
      verb === 'Later' ||
      verb === 'Delete' ||
      (verb === 'Unsubscribe' && archiveHistoric)
        ? syntheticInboxCount(row) +
          (verb === 'Delete' && deleteReach === 'all_mail' ? syntheticArchivedCount(row) : 0)
        : 0;
    const at = Math.max(
      Date.now(),
      decisions.reduce((next, decision) => Math.max(next, decision.at + 1), 0),
    );
    const nextDecisions = [
      ...decisions,
      {
        rowId: row.id,
        senderName: row.senderName,
        verb,
        affectedCount,
        at,
      },
    ];
    setDecisions(nextDecisions);
    setFocusIndex(0);
    setExpandedId(
      mode === 'guided' ? (firstUndecidedRow(mode, nextDecisions, ruleDecided)?.id ?? null) : null,
    );
    setPending(null);

    void track('demo_decision_confirmed', {
      verb: verb.toLowerCase() as Lowercase<ActionVerb>,
      decision_index: decisions.length + 1,
      affected_messages: affectedCount,
    });
    maybeTrackGuideCompletion(nextDecisions);
  };

  const confirm = (details: ConfirmDetails) => {
    if (!pending) return;
    recordDecision(pending.row, pending.verb, details.archiveHistoric);
  };

  /**
   * A domain-batch card asked for a verb — open the D226-mandatory
   * preview. `wakeAt` mirrors how the real product's Later batches pick
   * one (`defaultLaterWakeAtIso`) so the sheet is never handed an
   * unusable `null` for the one verb that needs it.
   */
  const chooseBatchAction = (batch: DomainBatch, verb: BatchVerb) => {
    setPendingBatch({ batch, verb, wakeAt: verb === 'Later' ? defaultLaterWakeAtIso() : null });
    void track('demo_preview_opened', {
      verb: verb.toLowerCase() as Lowercase<BatchVerb>,
      decision_index: decisions.length + 1,
    });
  };

  /**
   * Batch confirm — one `DemoDecision` per ELIGIBLE row, appended in a
   * single state update (looping `recordDecision` would read the same
   * stale `decisions` closure on every iteration and lose all but the
   * last). Protected and low-signal rows never enter `eligible`, matching the sheet's
   * own totals (D245).
   */
  const recordBatchDecision = (batch: DomainBatch, verb: BatchVerb) => {
    const lockKey = `batch:${batch.domain}`;
    const eligible = batch.eligibleRows.filter((row) => !decidedIds.has(row.id));
    if (decisionLock.current === lockKey || eligible.length === 0) return;
    decisionLock.current = lockKey;
    queueMicrotask(() => {
      if (decisionLock.current === lockKey) decisionLock.current = null;
    });

    let at = Math.max(
      Date.now(),
      decisions.reduce((next, decision) => Math.max(next, decision.at + 1), 0),
    );
    const newDecisions: DemoDecision[] = eligible.map((row) => ({
      rowId: row.id,
      senderName: row.senderName,
      verb,
      affectedCount: syntheticInboxCount(row),
      at: at++,
    }));
    const nextDecisions = [...decisions, ...newDecisions];
    setDecisions(nextDecisions);
    setFocusIndex(0);
    setExpandedId(
      mode === 'guided' ? (firstUndecidedRow(mode, nextDecisions, ruleDecided)?.id ?? null) : null,
    );
    setPendingBatch(null);

    void track('demo_decision_confirmed', {
      verb: verb.toLowerCase() as Lowercase<BatchVerb>,
      decision_index: decisions.length + 1,
      affected_messages: newDecisions.reduce((sum, decision) => sum + decision.affectedCount, 0),
    });
    maybeTrackGuideCompletion(nextDecisions);
  };

  const confirmBatch = () => {
    if (!pendingBatch) return;
    recordBatchDecision(pendingBatch.batch, pendingBatch.verb);
  };

  /**
   * The rule step's decision — recorded on EITHER path
   * `ActivateRuleModal` offers. Turning the rule on and watching first
   * are both real, complete decisions (D226's mandatory preview already
   * gated both identically), so either one advances the guide; this is
   * the offer the step ends on, not a limitation. `true` is passed
   * explicitly wherever this function needs "is the step done now" —
   * `ruleActivated` itself has not re-rendered yet at this point.
   */
  const confirmRule = (activationMode: 'active' | 'observe') => {
    setRuleActivated(activationMode);
    setPendingRule(false);
    setExpandedId(firstUndecidedRow(mode, decisions, true)?.id ?? null);
    maybeTrackGuideCompletion(decisions, true);
  };

  const chooseAction = (row: TriageDecisionRow, verb: ActionVerb) => {
    setExpandedId(row.id);
    if (verb === 'Keep') {
      // Keep is policy-only in the real product: no mail moves, so there
      // is no affected-message preview to approve.
      recordDecision(row, verb);
      return;
    }
    // Later mirrors the batch path's own default (`chooseBatchAction`):
    // without a future return time, the real `ActionSheet` disables
    // confirm outright rather than silently no-op-ing.
    setPending({ row, verb, wakeAt: verb === 'Later' ? defaultLaterWakeAtIso() : null });
    setDeleteReach('inbox_only');
    void track('demo_preview_opened', {
      verb: verb.toLowerCase() as Lowercase<ActionVerb>,
      decision_index: decisions.length + 1,
    });
  };

  const undo = (decision: DemoDecision) => {
    // An unsubscribe request cannot be recalled. If its historic Archive
    // was selected, Undo restores only that mail movement and leaves the
    // one-way request in Activity, as the connected product does.
    const nextDecisions =
      decision.verb === 'Unsubscribe'
        ? decisions.map((item) => (item.at === decision.at ? { ...item, affectedCount: 0 } : item))
        : decisions.filter((item) => item.at !== decision.at);
    setDecisions(nextDecisions);
    if (decision.verb !== 'Unsubscribe') setExpandedId(decision.rowId);
  };

  const reset = () => {
    void track('demo_reset', { decisions_completed: decisions.length });
    guidedCompletionTracked.current = false;
    setDecisions([]);
    setMode('explore');
    setReviewLayout('list');
    setFocusIndex(0);
    setPending(null);
    setPendingBatch(null);
    setPendingRule(false);
    setRuleActivated(null);
    setDismissedDomains([]);
    setStartedAt(null);
    setCompletedAt(null);
    setExpandedId(null);
    setViewIndex(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // The in-memory reset still completes.
    }
  };

  const changeMode = (nextMode: DemoMode) => {
    setMode(nextMode);
    setFocusIndex(0);
    setPending(null);
    setViewIndex(null);
    setExpandedId(
      nextMode === 'guided'
        ? (firstUndecidedRow(nextMode, decisions, ruleDecided)?.id ?? null)
        : null,
    );
    const url = new URL(window.location.href);
    url.searchParams.delete('step');
    if (nextMode === 'guided') url.searchParams.set('tour', '1');
    else url.searchParams.delete('tour');
    window.history.replaceState(window.history.state, '', url);
  };

  const changeWorkspace = (next: 'triage' | 'senders') => {
    setWorkspace(next);
    if (next === 'triage') changeMode('explore');
    const url = new URL(window.location.href);
    if (next === 'senders') {
      url.searchParams.set('workspace', 'senders');
      url.searchParams.delete('step');
      url.searchParams.delete('tour');
    } else {
      url.searchParams.set('workspace', 'triage');
      url.searchParams.delete('step');
      url.searchParams.delete('tour');
    }
    window.history.replaceState(window.history.state, '', url);
  };

  const pendingInboxCount = pending ? syntheticInboxCount(pending.row) : 0;
  const pendingArchivedCount = pending ? syntheticArchivedCount(pending.row) : 0;
  const pendingReachCount =
    pending?.verb === 'Delete' && deleteReach === 'all_mail'
      ? pendingInboxCount + pendingArchivedCount
      : pendingInboxCount;
  const pendingDetail: ActionPreviewDetail | undefined = pending
    ? {
        mailLocationLine: `Where it is now: ${pendingInboxCount} emails in your inbox · ${pendingArchivedCount} emails elsewhere in Gmail.`,
        ...(pending.verb === 'Delete'
          ? {
              reachControl: {
                reach: deleteReach,
                inboxCount: pendingInboxCount,
                allMailCount: pendingInboxCount + pendingArchivedCount,
                onChange: setDeleteReach,
              },
            }
          : {}),
      }
    : undefined;

  return (
    <div className="dm-simulator">
      <section className="dm-simulator-hero">
        <h1>Try the workspace.</h1>
        <p>
          Explore Senders and a made-up Triage queue. Open a sender, filter, select several, and
          preview what each decision would do before you connect Gmail.
        </p>
        <div className="dm-simulator-orientation">
          <button
            type="button"
            aria-expanded={orientationOpen}
            aria-controls="dm-simulator-orientation-content"
            onClick={() => setOrientationOpen((open) => !open)}
          >
            Where this fits in your workspace
          </button>
          {orientationOpen ? (
            <ol id="dm-simulator-orientation-content">
              <li>Overview shows your progress and available review work.</li>
              <li>
                Clean up contains Senders, with search, filters, selection and a right-hand
                inspector, and Triage for daily review. Try either workspace below.
              </li>
              <li>
                Preview mail-moving actions, then check outcomes and available Undo in Activity.
              </li>
              <li>Automations contains rules you deliberately enable for future email.</li>
            </ol>
          ) : null}
        </div>
        <p className="dm-simulator-hero-note">
          No signup. The demo stays local to this browser and never touches Gmail.
        </p>
      </section>

      <nav className="dm-simulator-workspace-switch" aria-label="Choose demo workspace">
        <button
          type="button"
          aria-pressed={workspace === 'senders'}
          onClick={() => changeWorkspace('senders')}
        >
          <strong>Senders workspace</strong>
          <span>Inspector · filters · bulk actions · unsubscribe preview</span>
        </button>
        <button
          type="button"
          aria-pressed={workspace === 'triage'}
          onClick={() => changeWorkspace('triage')}
        >
          <strong>Daily Triage</strong>
          <span>Review queue · Focus or List · guided tour</span>
        </button>
      </nav>

      {workspace === 'senders' ? (
        <SendersSimulator />
      ) : (
        <>
          <header className="dm-simulator-triage-head">
            <div>
              <span>Clean up / A considered decision</span>
              <h2>Triage</h2>
              <p>Today’s review queue · One decision per sender · fictional sample</p>
            </div>
            <div className="dm-simulator-triage-controls">
              <div
                role="progressbar"
                aria-label={
                  isFocusReview
                    ? `Decision ${focusIndex + 1} of ${rows.length}`
                    : `${decisions.length} of ${DEMO_ROWS.length} decided`
                }
                aria-valuenow={decisions.length}
                aria-valuemin={0}
                aria-valuemax={DEMO_ROWS.length}
              >
                <span>
                  {isFocusReview ? focusIndex + 1 : decisions.length} of{' '}
                  {isFocusReview ? rows.length : DEMO_ROWS.length}
                </span>
              </div>
              <div role="group" aria-label="Review layout">
                {(['focus', 'list'] as const).map((layout) => (
                  <button
                    key={layout}
                    type="button"
                    aria-pressed={mode === 'explore' && reviewLayout === layout}
                    onClick={() => {
                      changeMode('explore');
                      setReviewLayout(layout);
                    }}
                  >
                    {layout === 'focus' ? 'Focus' : 'List'}
                  </button>
                ))}
              </div>
            </div>
          </header>
          <section className="dm-simulator-workspace" aria-label="Inbox simulator">
            <div className="dm-simulator-queue">
              {mode === 'guided' && currentScenario ? (
                <GuidedScenarioPanel
                  scenario={currentScenario}
                  currentIndex={effectiveIndex}
                  decidedIds={decidedIds}
                  ruleDecided={ruleDecided}
                  onSelect={setViewIndex}
                />
              ) : null}

              <div className="dm-simulator-queue-head">
                <div>
                  <span>
                    {mode === 'guided' ? 'Guided sender review' : 'Explore sample Triage'}
                  </span>
                  <strong>
                    {mode === 'guided'
                      ? `${completedGuideCount} of ${GUIDED_SCENARIOS.length} decisions complete`
                      : `${rows.length} decision${rows.length === 1 ? '' : 's'} remaining`}
                  </strong>
                </div>
                <div className="dm-simulator-queue-head-actions">
                  <CopySimulatorLink
                    step={mode === 'guided' && effectiveIndex !== -1 ? effectiveIndex + 1 : null}
                  />
                  <button
                    type="button"
                    className="dm-simulator-mode-button"
                    onClick={() => changeMode(mode === 'guided' ? 'explore' : 'guided')}
                  >
                    {mode === 'guided'
                      ? `Explore all ${DEMO_ROWS.length} senders`
                      : 'Take guided tour'}
                  </button>
                </div>
              </div>

              {mode === 'guided' && currentScenario === null ? (
                <DemoCompletion
                  decisions={guidedDecisions}
                  elapsedMs={elapsedMs}
                  onExplore={() => changeMode('explore')}
                  onReset={reset}
                />
              ) : mode === 'guided' && currentScenario?.kind === 'batch' && currentBatch ? (
                <DomainBatchCard
                  batch={currentBatch}
                  busy={pendingBatch != null}
                  onVerb={(verb) => chooseBatchAction(currentBatch, verb)}
                  onDismiss={() => setDismissedDomains((prev) => [...prev, currentBatch.domain])}
                />
              ) : mode === 'guided' && currentScenario?.kind === 'rule' ? (
                <RuleStepCard onPreview={() => setPendingRule(true)} />
              ) : mode === 'explore' && rows.length === 0 ? (
                <ExploreCompletion decisions={decisions} onReset={reset} />
              ) : mode === 'explore' && reviewLayout === 'focus' && focusedRow ? (
                <div className="dm-simulator-focus">
                  <TriageFocusCard
                    row={focusedRow}
                    whyOpen={expandedId === focusedRow.id}
                    onToggleWhy={() =>
                      setExpandedId((current) => (current === focusedRow.id ? null : focusedRow.id))
                    }
                    onAction={(verb) => chooseAction(focusedRow, verb)}
                  />
                  {rows.length > 1 ? (
                    <button
                      type="button"
                      className="dm-simulator-skip"
                      onClick={() => setFocusIndex((index) => (index + 1) % rows.length)}
                    >
                      Skip (→)
                    </button>
                  ) : null}
                </div>
              ) : (
                <div className="dm-simulator-rows">
                  {rows.map((row, index) => (
                    <TriageRow
                      key={row.id}
                      row={row}
                      expanded={expandedId === row.id}
                      hero={index === 0}
                      busy={pending?.row.id === row.id}
                      onToggleExpand={() =>
                        setExpandedId((current) => (current === row.id ? null : row.id))
                      }
                      onAction={(verb) => chooseAction(row, verb)}
                    />
                  ))}
                </div>
              )}
            </div>

            <aside className="dm-simulator-activity" aria-label="Sample activity">
              <div className="dm-simulator-activity-head">
                <div>
                  <span>Activity</span>
                  <strong>What actually happened</strong>
                  <small>Sample outcomes · separate Activity screen in the product</small>
                </div>
                {decisions.length > 0 ? (
                  <button type="button" onClick={reset}>
                    Start over
                  </button>
                ) : null}
              </div>

              {decisions.length === 0 ? (
                <p className="dm-simulator-activity-empty">
                  Choose an action. If mail would move, inspect the preview and confirm it. Outcomes
                  appear here only after the decision is recorded.
                </p>
              ) : (
                <ol>
                  {decisions
                    .slice()
                    .reverse()
                    .map((decision) => (
                      <li key={decision.at}>
                        <div>
                          <strong>
                            {decision.senderName} · {decision.verb}
                          </strong>
                          <p>{decisionSummary(decision)}</p>
                        </div>
                        {isActivityUndoable(decision) ? (
                          <button type="button" onClick={() => undo(decision)}>
                            {decision.verb === 'Unsubscribe'
                              ? 'Undo archived mail'
                              : 'Undo demo action'}
                          </button>
                        ) : null}
                      </li>
                    ))}
                </ol>
              )}

              {mode === 'explore' ? (
                <div className="dm-simulator-delete-note">
                  <Eyebrow tone="amber">Delete is always yours to choose</Eyebrow>
                  <p>{ACTION_REGISTRY.delete.copy.description}</p>
                </div>
              ) : null}
            </aside>
          </section>
        </>
      )}

      <section className="dm-simulator-next">
        <div>
          <h2>Every mail-moving decision has a preview.</h2>
          <p>{ACTION_SAFETY_SUMMARY}</p>
        </div>
        <div className="dm-simulator-next-actions">
          <TrackedCta
            className="dm-simulator-primary"
            href={permissionEntryUrl()}
            cta="connect_gmail"
            placement="demo"
          >
            Start free
          </TrackedCta>
          <a href="/methodology">See privacy and control details</a>
        </div>
        <p className="dm-simulator-next-oauth">{OAUTH_SCOPE_DISCLOSURE}</p>
        <aside className="dm-simulator-tier-note" aria-label="Plan availability">
          <strong>Senders and Triage are included on every plan.</strong>{' '}
          <span>
            Free includes {TIER_MANIFEST.free.cleanupActionsPerMonth} cleanup actions every month;
            paid plans are unlimited.
          </span>{' '}
          <a href="/pricing">Compare plans</a>
        </aside>
      </section>

      {/* D226 mandatory preview — the product's own sheet, not a copy.
          No `mailboxEmail`: the demo has no account. */}
      <ActionSheet
        open={pending != null}
        verb={pending?.verb ?? 'Archive'}
        row={pending?.row ?? null}
        inboxCount={pendingReachCount}
        wakeAt={pending?.wakeAt ?? null}
        detail={pendingDetail}
        reach={deleteReach}
        onCancel={() => setPending(null)}
        onConfirm={confirm}
      />

      {pendingBatch ? (
        <BatchActionSheet
          open
          verb={pendingBatch.verb}
          batch={pendingBatch.batch}
          preview={buildSyntheticBulkPreview(pendingBatch.batch)}
          wakeAt={pendingBatch.wakeAt}
          onCancel={() => setPendingBatch(null)}
          onConfirm={confirmBatch}
        />
      ) : null}

      {/* D226 mandatory preview for the Autopilot rule step. No
          `mailboxEmail` — the demo has no account. The preview is always
          `status: 'ready'` (built locally, nothing to fail or retry), so
          `onRetryPreview` is unreachable in this demo. Autopilot is Plus,
          not Pro (moved 2026-08-23) — `RuleStepCard` names the tier. */}
      {pendingRule ? (
        <ActivateRuleModal
          rule={SYNTHETIC_RULE}
          intent="enable"
          canRunUnattended
          pendingCount={0}
          pendingApproximate={false}
          preview={buildSyntheticRulePreview()}
          undoWindowDays={MIN_UNDO_WINDOW_DAYS}
          onRetryPreview={() => undefined}
          onWatchFirst={() => confirmRule('observe')}
          isActivating={false}
          error={null}
          onCancel={() => setPendingRule(false)}
          onConfirm={() => confirmRule('active')}
        />
      ) : null}
    </div>
  );
}

function GuidedScenarioPanel({
  scenario,
  currentIndex,
  decidedIds,
  ruleDecided,
  onSelect,
}: {
  scenario: GuidedScenario;
  currentIndex: number;
  decidedIds: ReadonlySet<string>;
  ruleDecided: boolean;
  /** Jump to any step, decided or not — looking ahead never fires an
   *  action; only actually using that step's controls does. */
  onSelect: (index: number) => void;
}) {
  return (
    <section className="dm-simulator-guide" aria-labelledby="dm-simulator-guide-title">
      <div className="dm-simulator-guide-copy">
        <Eyebrow tone="primary">
          Guided decision {currentIndex + 1} of {GUIDED_SCENARIOS.length}
        </Eyebrow>
        <h2 id="dm-simulator-guide-title">{scenario.title}</h2>
        <p>{scenario.body}</p>
        <p className="dm-simulator-guide-prompt">
          <strong>{scenario.prompt}</strong> You can choose differently—the decision stays yours.
        </p>
      </div>
      <ol className="dm-simulator-guide-progress" aria-label="Guided demo progress">
        {GUIDED_SCENARIOS.map((item, index) => {
          const completed = isScenarioComplete(item, decidedIds, ruleDecided);
          const current = index === currentIndex;
          return (
            <li
              key={scenarioKey(item)}
              data-state={completed ? 'complete' : current ? 'current' : 'upcoming'}
              aria-current={current ? 'step' : undefined}
            >
              <button
                type="button"
                onClick={() => onSelect(index)}
                aria-label={`Go to guided decision ${index + 1}: ${item.shortLabel}`}
              >
                <span aria-hidden="true">{completed ? '✓' : index + 1}</span>
                <strong>{item.shortLabel}</strong>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * Step 3's queue-area entry point — a lightweight offer to preview the
 * Autopilot preset preview entry point, mirroring
 * `DomainBatchCard`'s own role for step 1 (a card that OPENS the
 * D226-mandatory preview, rather than being the preview itself).
 *
 * Names the tier explicitly: Autopilot moved to Plus (not Pro) on
 * 2026-08-23, and a demo that gets this wrong contradicts the pricing
 * page it is trying to sell.
 */
function RuleStepCard({ onPreview }: { onPreview: () => void }) {
  return (
    <div
      style={{
        background: color.card,
        border: `1px dashed ${color.primaryBorder}`,
        borderRadius: 10,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <Eyebrow tone="primary">Autopilot · {tierGranting('autopilot')}</Eyebrow>
      <p style={{ margin: 0, fontSize: 13, color: color.fgSoft, lineHeight: 1.5 }}>
        Preview the existing low-engagement Archive preset against this sample mailbox. It matches
        the engine’s Archive verdict above its confidence threshold, independently of the manual
        batch you reviewed. You can watch first or turn it on after reviewing the dry run.
      </p>
      <div>
        <Button tone="primary" onClick={onPreview}>
          Preview the Autopilot rule
        </Button>
      </div>
    </div>
  );
}

function OutcomeSummary({ decisions }: { decisions: readonly DemoDecision[] }) {
  // "Cleared from Inbox" — never "freed" or "deleted": Archive/Later/Delete
  // all remove the message from Inbox view, but only Delete (via Gmail
  // Trash) is on any path to actually freeing storage (see step 4's own
  // scenario copy). This label must not blur that distinction.
  const clearedFromInbox = decisions.reduce((total, decision) => total + decision.affectedCount, 0);
  const undoable = decisions.filter(isActivityUndoable).length;
  const oneWay = decisions.filter((decision) => decision.verb === 'Unsubscribe').length;

  return (
    <dl className="dm-simulator-outcome" aria-label="Sample outcome">
      <div>
        <dt>Cleared from Inbox</dt>
        <dd>{clearedFromInbox.toLocaleString('en-US')}</dd>
      </div>
      <div>
        <dt>Undoable actions</dt>
        <dd>{undoable}</dd>
      </div>
      <div>
        <dt>One-way requests</dt>
        <dd>{oneWay}</dd>
      </div>
    </dl>
  );
}

/** Renders a measured millisecond delta as "Ns" or "Nm Ns" — never a
 *  hardcoded string (see the `startedAt`/`completedAt` state notes). */
function formatElapsedTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/**
 * Persistent header instance (moved out of the two completion screens —
 * those only ever appeared after finishing the guide, which made "share
 * the card I'm looking at" impossible mid-guide). `step` captures
 * whichever step the visitor currently has in view.
 */
function CopySimulatorLink({ step }: { step: number | null }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      tone="ghost"
      onClick={() => {
        if (!navigator.clipboard) return;
        void navigator.clipboard
          .writeText(simulatorShareUrl(siteUrl(), { step }))
          .then(() => {
            setCopied(true);
          })
          .catch(() => {
            // Clipboard access can be denied outside a secure context. Keep
            // the button retryable and never leak an unhandled rejection.
            setCopied(false);
          });
      }}
    >
      {copied ? 'Copied' : 'Copy demo link'}
    </Button>
  );
}

function DemoCompletion({
  decisions,
  elapsedMs,
  onExplore,
  onReset,
}: {
  decisions: readonly DemoDecision[];
  /** Measured, never hardcoded — `null` only for a session restored
   *  already-complete from storage (see the `elapsedMs` note above). */
  elapsedMs: number | null;
  onExplore: () => void;
  onReset: () => void;
}) {
  const plusAdds = capabilitiesAddedBy('plus', 'free');
  const proAdds = capabilitiesAddedBy('pro', 'plus');
  return (
    <div className="dm-simulator-complete">
      <Eyebrow tone="primary">Guided demo complete</Eyebrow>
      <h2>You saw the decision loop.</h2>
      <p>
        Suggestions stay suggestions. Mail-changing decisions show their exact effect first, and
        confirmed outcomes appear in Activity.
      </p>
      {elapsedMs !== null ? (
        <p className="dm-simulator-elapsed">{`Done in ${formatElapsedTime(elapsedMs)}, start to finish.`}</p>
      ) : null}
      <OutcomeSummary decisions={decisions} />
      {/* Never future mail (D245 global constraint) — the public FAQ says
          archiving a sender does not automatically archive future
          messages, and this is the canonical claim, not a paraphrase. */}
      <p className="dm-simulator-scope-note">{MANUAL_ACTION_SCOPE_CLAIM}</p>
      <div className="dm-simulator-plan-path" aria-label="How the plans extend Triage">
        <span>
          <strong>Every plan</strong>
          Review one sender at a time
        </span>
        <span>
          <strong>Plus</strong>
          {plusAdds.join(' · ')}
        </span>
        <span>
          <strong>Pro</strong>
          {proAdds.join(' · ')}
        </span>
      </div>
      <div className="dm-simulator-complete-actions">
        <TrackedCta href={permissionEntryUrl()} cta="connect_gmail" placement="demo">
          Start free →
        </TrackedCta>
        <Button tone="default" onClick={onExplore}>
          Explore all sample senders
        </Button>
        <Button tone="ghost" onClick={onReset}>
          Start again
        </Button>
      </div>
      <p className="dm-simulator-oauth-note">{OAUTH_SCOPE_DISCLOSURE}</p>
      {/* Next to the connect CTA above. "Approved" only — Google approved
          an OAuth verification; it did not certify or audit the product. */}
      <p className="dm-simulator-oauth-note">
        {`Google approved DeclutrMail's OAuth verification on ${CASA_VERIFICATION_APPROVED_ON} for the single restricted scope this connection would request, gmail.modify.`}
      </p>
    </div>
  );
}

function ExploreCompletion({
  decisions,
  onReset,
}: {
  decisions: readonly DemoDecision[];
  onReset: () => void;
}) {
  return (
    <div className="dm-simulator-complete">
      <Eyebrow tone="primary">All samples reviewed</Eyebrow>
      <h2>You explored every sender.</h2>
      <OutcomeSummary decisions={decisions} />
      <div className="dm-simulator-complete-actions">
        <TrackedCta href={permissionEntryUrl()} cta="connect_gmail" placement="demo">
          Start free →
        </TrackedCta>
        <Button tone="default" onClick={onReset}>
          Start again
        </Button>
      </div>
      <p className="dm-simulator-oauth-note">{OAUTH_SCOPE_DISCLOSURE}</p>
    </div>
  );
}
