/**
 * Screener feature — wire types + Storybook/test fixtures (D71–D77).
 *
 * `ScreenerQueueRow` mirrors the BE shape
 * (`apps/api/src/screener/screener.types.ts`) so the JSON envelope
 * passes straight into `<ScreenerScreen state={...}/>` — same
 * fixture-shape-compatible arrangement as the Triage feature.
 *
 * "Screener" is the feature name (D227-allowed). The decision verbs
 * are the canonical K/A/U/L/D set — the D227-banned internal enum word
 * never appears in any rendered copy.
 */

/** Engine verdict union — mirrors the `triage_verdict` pg enum (D227). */
export type ScreenerRecommendationVerdict = 'keep' | 'archive' | 'unsubscribe' | 'later';

/** The five decide verbs (lowercase wire values, K/A/U/L/D). */
export type ScreenerDecideVerb = 'keep' | 'archive' | 'unsubscribe' | 'later' | 'delete';

export interface ScreenerQueueRow {
  /** `screener_quarantine.id` — the queue row identity. */
  id: string;
  /** `senders.id` — the action-pipeline selector (D226 wiring). */
  senderId: string;
  senderKey: string;
  senderName: string;
  senderEmail: string;
  senderDomain: string;
  /** ISO timestamp the sender was first seen (D71 "8 min ago"). */
  firstSeenAt: string;
  /** ISO timestamp the row entered the queue. */
  queuedAt: string;
  /** Messages received from this sender so far (D73 expanded body). */
  messageCount: number;
  /** Latest message's subject — D71 sample subject. Empty when none. */
  sampleSubject: string;
  unsubscribeMethod: 'one_click' | 'mailto' | 'none';
  /** Engine recommendation — null when the engine hasn't scored yet. */
  recommendation: {
    verdict: ScreenerRecommendationVerdict;
    confidence: number;
    reasoning: string;
  } | null;
}

/** Decide response — mirrors the BE `ScreenerDecideResult`. */
export interface ScreenerDecideResult {
  senderId: string;
  verb: ScreenerDecideVerb;
  resolved: boolean;
  execution:
    | { kind: 'policy'; activityLogId: string }
    | {
        kind: 'unsubscribe';
        method: 'one_click' | 'mailto' | 'none';
        executionActionId: string | null;
        mailtoUrl: string | null;
        activityLogId: string;
      }
    | { kind: 'enqueued'; actionId: string; status: string; requestedCount: number };
}

/** Screen-level state union (D200 — one shape per render branch). */
export type ScreenerScreenState =
  | { kind: 'loading' }
  | { kind: 'error'; error: unknown; retry: () => void }
  | { kind: 'empty' }
  | { kind: 'ready'; rows: ScreenerQueueRow[] };

/** A real unsubscribe request needs a published one-click or mailto channel. */
export function canScreenerUnsubscribe(row: ScreenerQueueRow): boolean {
  return row.unsubscribeMethod === 'one_click' || row.unsubscribeMethod === 'mailto';
}

/** Relative "first seen" copy (D71 — "8 min ago", "Yesterday"). */
export function firstSeenLabel(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  const diffMs = Math.max(0, now.getTime() - then);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? '1 month ago' : `${months} months ago`;
}

/* ────────────────────────────── fixtures ────────────────────────────── */

const HOUR = 3_600_000;

/** Fixture rows for Storybook variants + render tests. */
export const SCREENER_QUEUE: ScreenerQueueRow[] = [
  {
    id: 'q-1',
    senderId: '11111111-1111-4111-8111-111111111111',
    senderKey: 'a'.repeat(64),
    senderName: 'Lumen Field Updates',
    senderEmail: 'updates@lumenfield.example',
    senderDomain: 'lumenfield.example',
    firstSeenAt: new Date(Date.now() - 8 * 60_000).toISOString(),
    queuedAt: new Date(Date.now() - 8 * 60_000).toISOString(),
    messageCount: 1,
    sampleSubject: 'Welcome — confirm your seat preferences',
    unsubscribeMethod: 'one_click',
    recommendation: {
      verdict: 'archive',
      confidence: 0.65,
      reasoning: 'Brand-new sender with a marketing footprint — archive keeps it reversible.',
    },
  },
  {
    id: 'q-2',
    senderId: '22222222-2222-4222-8222-222222222222',
    senderKey: 'b'.repeat(64),
    senderName: 'Dr. Mehta Clinic',
    senderEmail: 'frontdesk@mehtaclinic.example',
    senderDomain: 'mehtaclinic.example',
    firstSeenAt: new Date(Date.now() - 26 * HOUR).toISOString(),
    queuedAt: new Date(Date.now() - 25 * HOUR).toISOString(),
    messageCount: 2,
    sampleSubject: 'Your appointment on Friday, 10:30',
    unsubscribeMethod: 'none',
    recommendation: {
      verdict: 'keep',
      confidence: 0.7,
      reasoning: 'Too new to judge — looks personal, so keeping is the safe call.',
    },
  },
  {
    id: 'q-3',
    senderId: '33333333-3333-4333-8333-333333333333',
    senderKey: 'c'.repeat(64),
    senderName: 'Nimbus Deals',
    senderEmail: 'deals@nimbus.example',
    senderDomain: 'nimbus.example',
    firstSeenAt: new Date(Date.now() - 3 * 24 * HOUR).toISOString(),
    queuedAt: new Date(Date.now() - 3 * 24 * HOUR).toISOString(),
    messageCount: 2,
    sampleSubject: '48 hours only: everything 40% off',
    unsubscribeMethod: 'mailto',
    recommendation: null,
  },
];
