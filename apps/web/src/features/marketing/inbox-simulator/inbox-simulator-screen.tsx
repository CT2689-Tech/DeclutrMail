'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  ACTION_SAFETY_SUMMARY,
  Button,
  Eyebrow,
  TIER_MANIFEST,
  useFocusTrap,
} from '@declutrmail/shared';
import { ACTION_REGISTRY } from '@declutrmail/shared/actions';

import { ActionPreviewPresentation } from '@/features/triage/action-preview-presentation';
import { TrackedCta } from '@/features/marketing/landing/tracked-cta';
import { TRIAGE_QUEUE, type TriageDecisionRow } from '@/features/triage/data';
import { TriageRow } from '@/features/triage/triage-row';
import { VERB_ORDER, type ActionVerb } from '@/features/triage/types';
import { oauthStartUrl } from '@/features/marketing/landing/urls';
import { track } from '@/lib/posthog';

const DEMO_ROWS = TRIAGE_QUEUE.slice(0, 7);
const DEMO_ROW_BY_ID = new Map(DEMO_ROWS.map((row) => [row.id, row] as const));
const DEMO_VERBS: ReadonlySet<string> = new Set(VERB_ORDER);
const DEMO_DECISION_KEYS = new Set(['rowId', 'verb', 'senderName', 'affectedCount', 'at']);
const STORAGE_KEY = 'dm.inbox-simulator.decisions.v2';

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
function parseStoredDecisions(stored: string): DemoDecision[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed) || parsed.length > DEMO_ROWS.length) return [];

  const restored: DemoDecision[] = [];
  const seenRows = new Set<string>();
  const seenTimestamps = new Set<number>();
  for (const candidate of parsed) {
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) return [];

    const record = candidate as Record<string, unknown>;
    const keys = Object.keys(record);
    if (
      keys.length !== DEMO_DECISION_KEYS.size ||
      keys.some((key) => !DEMO_DECISION_KEYS.has(key))
    ) {
      return [];
    }
    if (typeof record.rowId !== 'string' || seenRows.has(record.rowId)) return [];
    const row = DEMO_ROW_BY_ID.get(record.rowId);
    if (!row || !isActionVerb(record.verb) || record.senderName !== row.senderName) return [];
    if (row.protectionReason !== null && record.verb !== 'Keep') return [];
    if (row.unsubscribeMethod === 'none' && record.verb === 'Unsubscribe') return [];

    if (
      typeof record.affectedCount !== 'number' ||
      !Number.isSafeInteger(record.affectedCount) ||
      record.affectedCount < 0
    ) {
      return [];
    }
    const expectedCount =
      record.verb === 'Archive' || record.verb === 'Later' ? syntheticInboxCount(row) : 0;
    if (record.affectedCount !== expectedCount) return [];

    if (
      typeof record.at !== 'number' ||
      !Number.isSafeInteger(record.at) ||
      record.at <= 0 ||
      seenTimestamps.has(record.at)
    ) {
      return [];
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
  }
}

function isActivityUndoable(decision: DemoDecision): boolean {
  return decision.verb === 'Archive' || decision.verb === 'Later';
}

export function InboxSimulatorScreen() {
  const [decisions, setDecisions] = useState<DemoDecision[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(DEMO_ROWS[0]?.id ?? null);
  const [pending, setPending] = useState<PendingDecision | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setDecisions(parseStoredDecisions(stored));
    } catch {
      // A corrupt or unavailable local store never blocks the demo.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(decisions));
    } catch {
      // Private browsing and quota errors leave the current session usable.
    }
  }, [decisions, hydrated]);

  const decidedIds = useMemo(
    () => new Set(decisions.map((decision) => decision.rowId)),
    [decisions],
  );
  const rows = DEMO_ROWS.filter((row) => !decidedIds.has(row.id));

  const confirm = () => {
    if (!pending) return;
    const affectedCount =
      pending.verb === 'Archive' || pending.verb === 'Later' ? syntheticInboxCount(pending.row) : 0;
    const at = Math.max(
      Date.now(),
      decisions.reduce((next, decision) => Math.max(next, decision.at + 1), 0),
    );
    setDecisions((current) => [
      ...current,
      {
        rowId: pending.row.id,
        senderName: pending.row.senderName,
        verb: pending.verb,
        affectedCount,
        at,
      },
    ]);
    void track('demo_decision_confirmed', {
      verb: pending.verb.toLowerCase() as Lowercase<ActionVerb>,
      decision_index: decisions.length + 1,
      affected_messages: affectedCount,
    });
    const next = rows.find((row) => row.id !== pending.row.id);
    setExpandedId(next?.id ?? null);
    setPending(null);
  };

  const undo = (decision: DemoDecision) => {
    setDecisions((current) => current.filter((item) => item.at !== decision.at));
    setExpandedId(decision.rowId);
  };

  const reset = () => {
    void track('demo_reset', { decisions_completed: decisions.length });
    setDecisions([]);
    setPending(null);
    setExpandedId(DEMO_ROWS[0]?.id ?? null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // The in-memory reset still completes.
    }
  };

  return (
    <div className="dm-simulator">
      <section className="dm-simulator-hero">
        <Eyebrow tone="primary">Interactive demo · Plus/Pro Triage</Eyebrow>
        <h1>Try the sender review before you connect Gmail.</h1>
        <p>
          This walkthrough uses the production Triage row, recommendation, action, and preview
          components with synthetic sender metadata. Nothing is uploaded, and nothing touches Gmail.
          The sample recommendations are illustrative—not an analysis of your mail.
        </p>
        <div className="dm-simulator-trust">
          <span>No signup</span>
          <span>Local to this browser</span>
          <span>Full bodies fetched: 0</span>
        </div>
        <aside className="dm-simulator-tier-note" aria-label="Plan availability">
          <strong>This demo shows Plus and Pro Triage.</strong>
          <span>
            Free uses the same cleanup verbs in Senders and includes{' '}
            {TIER_MANIFEST.free.cleanupActionsLifetime} lifetime cleanup actions.
          </span>
          <a href="/pricing">Compare plans</a>
        </aside>
      </section>

      <section className="dm-simulator-workspace" aria-label="Inbox simulator">
        <div className="dm-simulator-queue">
          <div className="dm-simulator-queue-head">
            <div>
              <span>Sample Triage</span>
              <strong>
                {rows.length} decision{rows.length === 1 ? '' : 's'} remaining
              </strong>
            </div>
            <span>{decisions.length} reviewed</span>
          </div>

          {rows.length === 0 ? (
            <div className="dm-simulator-complete">
              <Eyebrow tone="primary">Sample complete</Eyebrow>
              <h2>You saw the full loop.</h2>
              <p>
                Sender signals led to a decision, the preview made the scope explicit, and the
                outcome landed in Activity. A real inbox uses live Gmail counts at confirmation.
              </p>
              <TrackedCta href={oauthStartUrl()} cta="connect_gmail" placement="demo">
                Run this on your Gmail →
              </TrackedCta>
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
                  onAction={(verb) => {
                    setExpandedId(row.id);
                    setPending({ row, verb });
                    void track('demo_preview_opened', {
                      verb: verb.toLowerCase() as Lowercase<ActionVerb>,
                      decision_index: decisions.length + 1,
                    });
                  }}
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
                Reset
              </button>
            ) : null}
          </div>

          {decisions.length === 0 ? (
            <p className="dm-simulator-activity-empty">
              Choose a verb, inspect the preview, then confirm. Outcomes appear here only after
              confirmation.
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

          <div className="dm-simulator-delete-note">
            <Eyebrow tone="amber">Delete lives in Senders</Eyebrow>
            <p>{ACTION_REGISTRY.delete.copy.description}</p>
          </div>
        </aside>
      </section>

      <section className="dm-simulator-next">
        <div>
          <Eyebrow tone="primary">The safety contract</Eyebrow>
          <h2>A preview is part of the product, not demo theater.</h2>
          <p>{ACTION_SAFETY_SUMMARY}</p>
        </div>
        <div className="dm-simulator-next-actions">
          <TrackedCta
            className="dm-simulator-primary"
            href={oauthStartUrl()}
            cta="connect_gmail"
            placement="demo"
          >
            Connect Gmail →
          </TrackedCta>
          <a href="/methodology">Read the methodology</a>
        </div>
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
          <Eyebrow tone={pending.verb === 'Unsubscribe' ? 'amber' : 'primary'}>
            Preview · synthetic inbox
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
          <Button tone={pending.verb === 'Unsubscribe' ? 'warn' : 'primary'} onClick={onConfirm}>
            Confirm sample {pending.verb}
          </Button>
        </div>
      </div>
    </div>
  );
}
