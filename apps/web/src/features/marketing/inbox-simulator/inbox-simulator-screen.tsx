'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import {
  ACTION_SAFETY_SUMMARY,
  MANUAL_ACTION_SCOPE_CLAIM,
  OAUTH_SCOPE_DISCLOSURE,
  Button,
  Eyebrow,
  TIER_MANIFEST,
  type TierId,
  useFocusTrap,
} from '@declutrmail/shared';
import { ACTION_REGISTRY } from '@declutrmail/shared/actions';

import { ActionPreviewPresentation } from '@/features/triage/action-preview-presentation';
import { TrackedCta } from '@/features/marketing/landing/tracked-cta';
import { CAPABILITY_LABELS } from '@/features/marketing/pricing/pricing-model';
import { TRIAGE_QUEUE, type TriageDecisionRow } from '@/features/triage/data';
import { findDomainBatches, type DomainBatch } from '@/features/triage/domain-batch';
import { TriageRow } from '@/features/triage/triage-row';
import { VERB_ORDER, type ActionVerb } from '@/features/triage/types';
import { oauthStartUrl, siteUrl } from '@/features/marketing/landing/urls';
import { simulatorShareUrl } from '@/features/marketing/signup-ref';
import { track } from '@/lib/posthog';

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
const DEMO_STATE_KEYS = new Set(['version', 'mode', 'decisions']);
const STORAGE_KEY = 'dm.inbox-simulator.state.v3';
const LEGACY_STORAGE_KEY = 'dm.inbox-simulator.decisions.v2';

type DemoMode = 'guided' | 'explore';

interface DemoDecision {
  rowId: string;
  verb: ActionVerb;
  senderName: string;
  affectedCount: number;
  at: number;
}

interface PendingDecision {
  row: TriageDecisionRow;
  verb: ActionVerb;
}

interface StoredDemoState {
  version: 3;
  mode: DemoMode;
  decisions: DemoDecision[];
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

/** The Amazon batch's own facts, derived rather than retyped — a fixture
 *  edit (another sender, a changed verdict) keeps this copy honest. */
const amazonBatch = requireDemoBatch('amazon.com');
const amazonMessageTotal = amazonBatch.eligibleRows.reduce((sum, row) => sum + row.totalAllTime, 0);
const amazonVerdictCount = new Set(amazonBatch.eligibleRows.map((row) => row.verdict)).size;

export const GUIDED_SCENARIOS: readonly GuidedScenario[] = [
  {
    kind: 'batch',
    domain: amazonBatch.domain,
    shortLabel: 'Scale',
    title: 'One decision covers thousands of messages.',
    body: `This inbox has ${amazonBatch.rows.length} senders from ${amazonBatch.domain}, holding ${amazonMessageTotal.toLocaleString('en-US')} messages between them. The engine does not even agree with itself — ${amazonVerdictCount} different recommendations across the group — and one decision below covers all of it.`,
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
    title: 'A one-time decision does not repeat itself.',
    body: MANUAL_ACTION_SCOPE_CLAIM,
    prompt: 'See the Autopilot rule this decision would create.',
  },
  {
    kind: 'row',
    row: requireDemoRow('t-groupon'),
    shortLabel: 'Free the space',
    title: 'Archive and Unsubscribe never remove a message.',
    body: 'Everything archived or unsubscribed so far is still in this account — just out of the inbox. Delete is the one action that actually removes mail, and it still goes through Gmail Trash first.',
    prompt: 'Try Delete — the one action that actually clears space.',
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
 * same predicate the batch confirm itself fans out to.
 *
 * The rule step always reads incomplete: nothing can record one yet
 * (Plan 4 Task 4 wires `ActivateRuleModal`'s confirm). That is honest
 * for this branch's current scope, not a stub — no interaction claims
 * to finish it.
 */
function isScenarioComplete(scenario: GuidedScenario, decidedIds: ReadonlySet<string>): boolean {
  switch (scenario.kind) {
    case 'row':
      return decidedIds.has(scenario.row.id);
    case 'batch':
      return requireDemoBatch(scenario.domain).eligibleRows.every((row) => decidedIds.has(row.id));
    case 'rule':
      return false;
  }
}

function syntheticInboxCount(row: TriageDecisionRow): number {
  if (row.last90dMessages === 0) return Math.min(row.totalAllTime, 6);
  return Math.max(1, Math.min(row.last90dMessages, row.totalAllTime));
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
    const expectedCount =
      record.verb === 'Archive' || record.verb === 'Later' || record.verb === 'Delete'
        ? syntheticInboxCount(row)
        : 0;
    if (record.affectedCount !== expectedCount) return null;

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
      affectedCount: expectedCount,
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
    record.version !== 3 ||
    (record.mode !== 'guided' && record.mode !== 'explore')
  ) {
    return null;
  }

  const decisions = parseStoredDecisions(record.decisions);
  if (decisions === null) return null;
  return { version: 3, mode: record.mode, decisions };
}

function parseLegacyState(stored: string): StoredDemoState | null {
  try {
    const decisions = parseStoredDecisions(JSON.parse(stored));
    return decisions === null ? null : { version: 3, mode: 'guided', decisions };
  } catch {
    return null;
  }
}

function hasCompletedGuide(decisions: readonly DemoDecision[]): boolean {
  const decidedIds = new Set(decisions.map((decision) => decision.rowId));
  return GUIDED_SCENARIOS.every((scenario) => isScenarioComplete(scenario, decidedIds));
}

/** The row to auto-expand next, or `null` when the current step is not a
 *  single row (a batch card and the rule preview manage their own focus). */
function firstUndecidedRow(
  mode: DemoMode,
  decisions: readonly DemoDecision[],
): TriageDecisionRow | null {
  const decidedIds = new Set(decisions.map((decision) => decision.rowId));
  if (mode === 'explore') {
    return DEMO_ROWS.find((row) => !decidedIds.has(row.id)) ?? null;
  }
  const current = GUIDED_SCENARIOS.find((scenario) => !isScenarioComplete(scenario, decidedIds));
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
      return 'Sample unsubscribe request recorded. A delivered request cannot be recalled.';
    case 'Delete':
      return `${decision.affectedCount} sample messages moved to Gmail Trash.`;
  }
}

function isActivityUndoable(decision: DemoDecision): boolean {
  return decision.verb === 'Archive' || decision.verb === 'Later' || decision.verb === 'Delete';
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
  const [decisions, setDecisions] = useState<DemoDecision[]>([]);
  const [mode, setMode] = useState<DemoMode>('guided');
  const [expandedId, setExpandedId] = useState<string | null>(
    GUIDED_SCENARIOS[0]?.kind === 'row' ? GUIDED_SCENARIOS[0].row.id : null,
  );
  const [pending, setPending] = useState<PendingDecision | null>(null);
  const [hydrated, setHydrated] = useState(false);
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
        setMode(restored.mode);
        setExpandedId(firstUndecidedRow(restored.mode, restored.decisions)?.id ?? null);
        guidedCompletionTracked.current = hasCompletedGuide(restored.decisions);
      }
      if (legacyStored) localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // A corrupt or unavailable local store never blocks the demo.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      const stored: StoredDemoState = { version: 3, mode, decisions };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // Private browsing and quota errors leave the current session usable.
    }
  }, [decisions, hydrated, mode]);

  const decidedIds = useMemo(
    () => new Set(decisions.map((decision) => decision.rowId)),
    [decisions],
  );
  const currentGuideIndex = GUIDED_SCENARIOS.findIndex(
    (scenario) => !isScenarioComplete(scenario, decidedIds),
  );
  const currentScenario =
    currentGuideIndex === -1 ? null : (GUIDED_SCENARIOS[currentGuideIndex] ?? null);
  // How many guided steps are done, counting only a consecutive run from
  // the start — the guide can only ever be walked in order, so this and
  // "count every individually-complete scenario" agree on every state
  // this UI can reach. They diverge only for a hand-crafted localStorage
  // payload that marks a LATER step done while an earlier one is not;
  // treating that as "0 done, currently on step 1" (not "1 of 4") is the
  // reading that matches what the screen actually shows.
  const completedGuideCount =
    currentGuideIndex === -1 ? GUIDED_SCENARIOS.length : currentGuideIndex;
  const rows =
    mode === 'guided'
      ? currentScenario?.kind === 'row'
        ? [currentScenario.row]
        : []
      : DEMO_ROWS.filter((row) => !decidedIds.has(row.id));
  const guidedDecisions = decisions.filter((decision) => GUIDED_ROW_IDS.has(decision.rowId));

  const recordDecision = (row: TriageDecisionRow, verb: ActionVerb) => {
    if (decisionLock.current === row.id || decidedIds.has(row.id)) return;
    decisionLock.current = row.id;
    queueMicrotask(() => {
      if (decisionLock.current === row.id) decisionLock.current = null;
    });

    const affectedCount =
      verb === 'Archive' || verb === 'Later' || verb === 'Delete' ? syntheticInboxCount(row) : 0;
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
    setExpandedId(firstUndecidedRow(mode, nextDecisions)?.id ?? null);
    setPending(null);

    void track('demo_decision_confirmed', {
      verb: verb.toLowerCase() as Lowercase<ActionVerb>,
      decision_index: decisions.length + 1,
      affected_messages: affectedCount,
    });
    if (!guidedCompletionTracked.current && hasCompletedGuide(nextDecisions)) {
      guidedCompletionTracked.current = true;
      const guidedOutcome = nextDecisions.filter((decision) => GUIDED_ROW_IDS.has(decision.rowId));
      void track('demo_completed', {
        decisions_completed: guidedOutcome.length,
        affected_messages: guidedOutcome.reduce(
          (total, decision) => total + decision.affectedCount,
          0,
        ),
      });
    }
  };

  const confirm = () => {
    if (!pending) return;
    recordDecision(pending.row, pending.verb);
  };

  const chooseAction = (row: TriageDecisionRow, verb: ActionVerb) => {
    setExpandedId(row.id);
    if (verb === 'Keep') {
      // Keep is policy-only in the real product: no mail moves, so there
      // is no affected-message preview to approve.
      recordDecision(row, verb);
      return;
    }
    setPending({ row, verb });
    void track('demo_preview_opened', {
      verb: verb.toLowerCase() as Lowercase<ActionVerb>,
      decision_index: decisions.length + 1,
    });
  };

  const undo = (decision: DemoDecision) => {
    const nextDecisions = decisions.filter((item) => item.at !== decision.at);
    setDecisions(nextDecisions);
    setExpandedId(decision.rowId);
  };

  const reset = () => {
    void track('demo_reset', { decisions_completed: decisions.length });
    guidedCompletionTracked.current = false;
    setDecisions([]);
    setMode('guided');
    setPending(null);
    setExpandedId(GUIDED_SCENARIOS[0]?.kind === 'row' ? GUIDED_SCENARIOS[0].row.id : null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // The in-memory reset still completes.
    }
  };

  const changeMode = (nextMode: DemoMode) => {
    setMode(nextMode);
    setPending(null);
    setExpandedId(firstUndecidedRow(nextMode, decisions)?.id ?? null);
  };

  return (
    <div className="dm-simulator">
      <section className="dm-simulator-hero">
        <Eyebrow tone="primary">Interactive demo · No sign-in</Eyebrow>
        <h1>Make four inbox decisions before you connect Gmail.</h1>
        <p>
          Follow four made-up examples, then explore freely. Nothing is uploaded or touches Gmail,
          and the sample suggestions are not an analysis of your mail.
        </p>
        <div className="dm-simulator-trust">
          <span>No signup</span>
          <span>Local to this browser</span>
          <span>No email data is used</span>
        </div>
        <aside className="dm-simulator-tier-note" aria-label="Plan availability">
          <strong>Triage is included on every plan.</strong>
          <span>
            Free includes {TIER_MANIFEST.free.cleanupActionsPerMonth} cleanup actions every month;
            paid plans are unlimited.
          </span>
          <a href="/pricing">Compare plans</a>
        </aside>
      </section>

      <section className="dm-simulator-workspace" aria-label="Inbox simulator">
        <div className="dm-simulator-queue">
          {mode === 'guided' && currentScenario ? (
            <GuidedScenarioPanel
              scenario={currentScenario}
              currentIndex={currentGuideIndex}
              decidedIds={decidedIds}
            />
          ) : null}

          <div className="dm-simulator-queue-head">
            <div>
              <span>{mode === 'guided' ? 'Guided sender review' : 'Explore sample Triage'}</span>
              <strong>
                {mode === 'guided'
                  ? `${completedGuideCount} of ${GUIDED_SCENARIOS.length} decisions complete`
                  : `${rows.length} decision${rows.length === 1 ? '' : 's'} remaining`}
              </strong>
            </div>
            <button
              type="button"
              className="dm-simulator-mode-button"
              onClick={() => changeMode(mode === 'guided' ? 'explore' : 'guided')}
            >
              {mode === 'guided' ? `Explore all ${DEMO_ROWS.length} senders` : 'Return to guide'}
            </button>
          </div>

          {mode === 'guided' && currentScenario === null ? (
            <DemoCompletion
              decisions={guidedDecisions}
              onExplore={() => changeMode('explore')}
              onReset={reset}
            />
          ) : mode === 'explore' && rows.length === 0 ? (
            <ExploreCompletion decisions={decisions} onReset={reset} />
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
                        Undo demo action
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

      <section className="dm-simulator-next">
        <div>
          <Eyebrow tone="primary">Before anything changes</Eyebrow>
          <h2>The preview you saw here is always part of the product.</h2>
          <p>{ACTION_SAFETY_SUMMARY}</p>
        </div>
        <div className="dm-simulator-next-actions">
          <TrackedCta
            className="dm-simulator-primary"
            href={oauthStartUrl()}
            cta="connect_gmail"
            placement="demo"
          >
            Review my Gmail senders →
          </TrackedCta>
          <a href="/methodology">See privacy and control details</a>
        </div>
        <p>{OAUTH_SCOPE_DISCLOSURE}</p>
      </section>

      {pending ? (
        <DemoPreviewDialog
          pending={pending}
          onCancel={() => setPending(null)}
          onConfirm={confirm}
        />
      ) : null}
    </div>
  );
}

function GuidedScenarioPanel({
  scenario,
  currentIndex,
  decidedIds,
}: {
  scenario: GuidedScenario;
  currentIndex: number;
  decidedIds: ReadonlySet<string>;
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
          const completed = isScenarioComplete(item, decidedIds);
          const current = index === currentIndex;
          return (
            <li
              key={scenarioKey(item)}
              data-state={completed ? 'complete' : current ? 'current' : 'upcoming'}
              aria-current={current ? 'step' : undefined}
            >
              <span aria-hidden="true">{completed ? '✓' : index + 1}</span>
              <strong>{item.shortLabel}</strong>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function OutcomeSummary({ decisions }: { decisions: readonly DemoDecision[] }) {
  const messagesMoved = decisions.reduce((total, decision) => total + decision.affectedCount, 0);
  const undoable = decisions.filter(isActivityUndoable).length;
  const oneWay = decisions.filter((decision) => decision.verb === 'Unsubscribe').length;

  return (
    <dl className="dm-simulator-outcome" aria-label="Sample outcome">
      <div>
        <dt>Messages moved</dt>
        <dd>{messagesMoved.toLocaleString('en-US')}</dd>
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

function CopySimulatorLink() {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      tone="ghost"
      onClick={() => {
        if (!navigator.clipboard) return;
        void navigator.clipboard
          .writeText(simulatorShareUrl(siteUrl()))
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
  onExplore,
  onReset,
}: {
  decisions: readonly DemoDecision[];
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
      <OutcomeSummary decisions={decisions} />
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
        <TrackedCta href={oauthStartUrl()} cta="connect_gmail" placement="demo">
          Review my Gmail senders →
        </TrackedCta>
        <CopySimulatorLink />
        <Button tone="default" onClick={onExplore}>
          Explore all sample senders
        </Button>
        <Button tone="ghost" onClick={onReset}>
          Start again
        </Button>
      </div>
      <p className="dm-simulator-oauth-note">{OAUTH_SCOPE_DISCLOSURE}</p>
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
        <TrackedCta href={oauthStartUrl()} cta="connect_gmail" placement="demo">
          Review my Gmail senders →
        </TrackedCta>
        <CopySimulatorLink />
        <Button tone="default" onClick={onReset}>
          Start again
        </Button>
      </div>
      <p className="dm-simulator-oauth-note">{OAUTH_SCOPE_DISCLOSURE}</p>
    </div>
  );
}

function DemoPreviewDialog({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: PendingDecision;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useFocusTrap<HTMLDivElement>(true);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div className="dm-simulator-dialog-layer">
      <button
        type="button"
        className="dm-simulator-dialog-scrim"
        aria-label="Cancel preview"
        onClick={onCancel}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dm-simulator-dialog-title"
        className="dm-simulator-dialog"
      >
        <div className="dm-simulator-dialog-head">
          <Eyebrow
            tone={pending.verb === 'Unsubscribe' || pending.verb === 'Delete' ? 'amber' : 'primary'}
          >
            Preview · made-up inbox
          </Eyebrow>
          <h2 id="dm-simulator-dialog-title">Approve the sample action</h2>
        </div>
        <ActionPreviewPresentation
          verb={pending.verb}
          row={pending.row}
          archiveHistoric={false}
          inboxCount={syntheticInboxCount(pending.row)}
          mode="modal"
        />
        <p className="dm-simulator-dialog-note">
          {pending.verb === 'Unsubscribe'
            ? 'This demo records the outcome locally. In the product, a delivered unsubscribe request cannot be recalled.'
            : 'This demo changes only local sample state. A real action waits for server confirmation before Activity shows success.'}
        </p>
        <div className="dm-simulator-dialog-actions">
          <Button tone="default" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            tone={
              pending.verb === 'Delete'
                ? 'danger'
                : pending.verb === 'Unsubscribe'
                  ? 'warn'
                  : 'primary'
            }
            onClick={onConfirm}
          >
            Confirm sample {pending.verb}
          </Button>
        </div>
      </div>
    </div>
  );
}
