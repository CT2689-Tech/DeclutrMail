/**
 * Sender Detail — fixtures and pure helpers.
 *
 * Fixtures here are deterministic (seeded by sender id) so Storybook
 * variants stay stable across builds. When the real API lands this
 * file shrinks to helpers; fixtures move to MSW handlers.
 */

import type { Sender, SenderGroup } from '../data';
import type {
  DecisionHistoryRow,
  ProtectionReason,
  Recommendation,
  RecentMessage,
  SenderDetail,
  SenderStats,
  TimeseriesPoint,
  Verdict,
} from './types';

/** Gmail-side category label per sender group — surfaced in the header. */
const GMAIL_CATEGORY: Record<SenderGroup, string> = {
  primary: 'Gmail: Primary',
  promotions: 'Gmail: Promotions',
  social: 'Gmail: Social',
  updates: 'Gmail: Updates',
  forums: 'Gmail: Forums',
};

/** Recent-subject seeds per group — same pool the prototype used. */
const SUBJECT_POOL: Record<SenderGroup, string[]> = {
  primary: [
    'Re: lunch next week?',
    'Quick question on the deck',
    'Thanks!',
    'Calendar invite: sync',
    'Re: proposal v3',
  ],
  promotions: [
    '48 hours only — 40% off',
    'Your cart misses you',
    'New arrivals just dropped',
    'Final hours: free shipping',
    'Weekend flash sale',
  ],
  social: [
    'You have 5 new notifications',
    '3 people viewed your profile',
    'Trending in your network',
    'New connection request',
    'Weekly digest',
  ],
  updates: [
    'Your receipt from this week',
    'Weekly workspace summary',
    'Statement is ready',
    "What's new in your account",
    'Action required: review the changes',
  ],
  forums: [
    'Top questions this week',
    'New replies in your thread',
    'This week: 12 new posts',
    'Someone mentioned you',
    'Digest #34',
  ],
};

const SNIPPETS: Record<SenderGroup, string[]> = {
  primary: [
    'Hey — wanted to follow up on the thread from earlier this week. Let me know what you think when you get a chance.',
    'Quick one: do you have bandwidth Friday for a 30-minute sync on the launch checklist?',
    'Thanks for sending the deck — looks great. Two small notes inline.',
  ],
  promotions: [
    "Don't miss our biggest sale of the season. Up to 40% off everything sitewide — ends Sunday.",
    "We saved your cart — these styles are running low. Tap to check out before they're gone.",
    "Just landed: the new collection you've been waiting for. Members get 24-hour early access.",
  ],
  social: [
    'See what 5 people have done in your network this week, plus 12 new updates from people you follow.',
    'You appeared in 3 searches this week. Recruiters from 2 companies viewed your profile.',
    'Top posts in your network, hand-picked based on what people like you are reading.',
  ],
  updates: [
    'Your weekly receipt is attached. Charges totaled $42.18 across 3 transactions. View details inside.',
    "Here's a summary of activity in your workspace this week: 14 new comments, 3 documents shared.",
    'Your monthly statement is ready. Available to download from the account dashboard.',
  ],
  forums: [
    "The week's top 5 questions, with accepted answers from the community. Plus 3 unanswered you might know.",
    'Two new replies on a thread you started, and one mention by another member you should see.',
    'This week: 12 new posts, 4 high-traffic threads, and the monthly community digest.',
  ],
};

/**
 * Compact size label — 1024 → "1KB", 8742 → "9KB", 2_500_000 → "2.4MB".
 *
 * `null` (pre-ADR-0021 row or Gmail-omitted `sizeEstimate`) renders an
 * em-dash so the absence reads honestly instead of as "0B". `0`
 * collapses to the same em-dash for the same reason — a real
 * zero-byte message would be Gmail's mistake, not ours, and the
 * em-dash still says "no useful size" without lying about the value.
 */
export function fmtSize(bytes: number | null | undefined): string {
  if (bytes == null || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/** Relative-time formatter — same shape as the parent module's. */
export function relTime(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.round(days / 7)}w ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

/** Relative time for an ISO-8601 string. */
export function relTimeFromIso(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  const days = Math.max(0, Math.floor((now.getTime() - then) / (1000 * 60 * 60 * 24)));
  return relTime(days);
}

/**
 * Deterministic PRNG seeded by the sender id — every fixture derived
 * from a sender produces the same numbers across builds. Avoids the
 * Storybook flicker that an unseeded `Math.random` would cause.
 */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFor(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Fixture-only suggestion derivation for stories and mock handlers. */
function inferVerdict(s: Sender, isProtected: boolean): Verdict {
  if (isProtected) return 'keep';
  if (s.group === 'primary') return 'keep';
  const { read, monthly, spike } = s;
  if (read === 0 && monthly >= 25) return 'archive';
  if (read === 0 && monthly >= 8) return 'unsubscribe';
  if (read < 0.2 && spike) return 'unsubscribe';
  if (read < 0.2 && monthly >= 4) return 'later';
  if (read >= 0.2 && read < 0.6 && monthly >= 6) return 'later';
  return 'keep';
}

/** Confidence is derived from the strength of the signal, not learned. */
function inferConfidence(s: Sender, verdict: Verdict): number {
  if (verdict === 'keep') return 0.6;
  if (s.read === 0 && s.monthly >= 25) return 0.94;
  if (s.spike != null && s.read < 0.1) return 0.91;
  if (s.read === 0 && s.monthly >= 8) return 0.88;
  if (s.read < 0.2 && s.monthly >= 4) return 0.78;
  return 0.66;
}

function buildReasoning(s: Sender, verdict: Verdict): string {
  const read = Math.round(s.read * 100);
  const action = verdict[0]!.toUpperCase() + verdict.slice(1);
  return `${action} is suggested from ${s.monthly} messages received in the last 30 days and ${read}% marked read.`;
}

function buildSignals(s: Sender): string[] {
  const out = [
    `${s.monthly} messages received in the last 30 days`,
    `${Math.round(s.read * 100)}% marked read in the last 30 days`,
    s.lastDays === 0
      ? 'Last message received today'
      : `Last message received ${s.lastDays} days ago`,
  ];
  if (s.repliedCount !== undefined) out.push(`You replied ${s.repliedCount} times`);
  return out;
}

function buildRecommendation(s: Sender, isProtected: boolean): Recommendation | null {
  if (isProtected) return null;
  const verdict = inferVerdict(s, isProtected);
  if (verdict === 'keep' && s.group !== 'primary') {
    // For non-Primary senders with no strong signal, Keep may appear only
    // inside the collapsed optional-suggestion disclosure.
    return {
      verdict,
      confidence: inferConfidence(s, verdict),
      reasoning: buildReasoning(s, verdict),
      signals: buildSignals(s),
    };
  }
  if (verdict === 'keep') return null;
  return {
    verdict,
    confidence: inferConfidence(s, verdict),
    reasoning: buildReasoning(s, verdict),
    signals: buildSignals(s),
  };
}

function buildRecentMessages(s: Sender): RecentMessage[] {
  const rand = mulberry32(seedFor(s.id));
  const pool = SUBJECT_POOL[s.group];
  const snipPool = SNIPPETS[s.group];
  const now = Date.now();
  const dayMs = 1000 * 60 * 60 * 24;
  const count = Math.min(8, Math.max(3, Math.round(s.monthly / 6)));
  const out: RecentMessage[] = [];
  for (let i = 0; i < count; i++) {
    const subj = pool[(seedFor(s.id) + i) % pool.length] ?? pool[0] ?? '(no subject)';
    const snip = snipPool[(seedFor(s.id) + i) % snipPool.length] ?? snipPool[0] ?? '';
    const ageDays = Math.max(
      0,
      s.lastDays + i * Math.max(1, Math.round(30 / Math.max(1, s.monthly))),
    );
    const sizeBytes = Math.round(2000 + rand() * 36000);
    const hasAttachment = rand() > 0.78;
    const unread = i < s.unread;
    out.push({
      id: `${s.id}-m${i}`,
      providerMessageId: `${s.id}-pmid-${i.toString(16).padStart(4, '0')}`,
      threadId: `${s.id}-thr-${i.toString(16).padStart(4, '0')}`,
      subject: subj,
      snippet: snip,
      receivedAt: new Date(now - ageDays * dayMs).toISOString(),
      sizeBytes,
      hasAttachment,
      unread,
    });
  }
  return out;
}

function buildStats(s: Sender): SenderStats {
  return {
    monthlyVolume: s.monthly,
    readRate: s.read,
    relationshipMonths: s.firstSeenMo,
    lastSeenDays: s.lastDays,
    // Fixture senders inherit their trend bucket directly; default to
    // `steady` when the fixture didn't specify one so existing stories
    // render a sensible chip.
    volumeTrend: s.volumeTrend ?? 'steady',
  };
}

function buildTimeseries(s: Sender): TimeseriesPoint[] {
  const rand = mulberry32(seedFor(s.id) + 17);
  const out: TimeseriesPoint[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const yearMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    // Volume tracks current cadence with mild seasonality.
    const base = s.monthly * (0.6 + rand() * 0.6);
    const spikeMultiplier = i === 0 && s.spike != null ? s.spike : 1;
    const volume = Math.max(0, Math.round(base * spikeMultiplier));
    const opens = Math.max(0, Math.round(volume * (s.read * (0.7 + rand() * 0.6))));
    out.push({ yearMonth, volume, opens });
  }
  return out;
}

function buildHistory(s: Sender): DecisionHistoryRow[] {
  const rand = mulberry32(seedFor(s.id) + 31);
  const now = Date.now();
  const dayMs = 1000 * 60 * 60 * 24;
  const candidates: Omit<DecisionHistoryRow, 'id' | 'at' | 'opId'>[] = [];

  // Latest action reflects the sender's current posture.
  if (s.protected === true) {
    candidates.push({ source: 'You', action: 'Protected' });
  } else if (s.read === 0 && s.monthly >= 20) {
    candidates.push({ source: 'Triage', action: 'Archived', count: Math.round(s.monthly * 6) });
  } else if (s.read < 0.2 && s.monthly >= 6) {
    candidates.push({ source: 'Autopilot', action: 'Moved to Later', count: s.monthly });
  } else if (s.group === 'primary') {
    candidates.push({ source: 'You', action: 'Kept' });
  } else {
    candidates.push({ source: 'You', action: 'Kept' });
  }

  // A handful of older entries for context.
  const olderPool: Omit<DecisionHistoryRow, 'id' | 'at' | 'opId'>[] = [
    { source: 'Triage', action: 'Kept' },
    { source: 'Autopilot', action: 'Moved to Later', count: s.monthly },
    { source: 'Screener', action: 'Kept' },
    { source: 'Manual', action: 'Restored' },
    { source: 'System', action: 'Protected' },
    { source: 'Manual', action: 'Unprotected' },
    { source: 'Triage', action: 'Archived', count: Math.round(s.monthly * 3) },
  ];
  for (const c of olderPool) candidates.push(c);

  const ten = candidates.slice(0, 10);
  return ten.map((row, idx) => {
    const ageDays = idx === 0 ? Math.max(1, s.lastDays + 2) : idx * 7 + Math.round(rand() * 5);
    const at = new Date(now - ageDays * dayMs).toISOString();
    const opId = `op_${s.id}_${idx.toString(16).padStart(6, '0')}`;
    const base: DecisionHistoryRow = { id: `${s.id}-h${idx}`, at, opId, ...row };
    if (idx === 0 && ageDays <= 6) {
      base.undoExpiresAt = new Date(now - ageDays * dayMs + 7 * dayMs).toISOString();
    }
    return base;
  });
}

/**
 * Build a complete fixture `SenderDetail` from a sender + posture
 * overrides. Production API adapters must map live DTOs directly and
 * never call this synthetic story/mock helper.
 */
export function buildSenderDetail(
  sender: Sender,
  overrides: Partial<{
    isProtected: boolean;
    protectionReason: ProtectionReason;
    recentMessages: RecentMessage[];
    history: DecisionHistoryRow[];
  }> = {},
): SenderDetail {
  const isProtected = overrides.isProtected ?? sender.protected === true;
  const protectionReason: ProtectionReason | null = isProtected
    ? (overrides.protectionReason ?? (sender.protected ? 'starred' : 'user-marked'))
    : null;

  return {
    sender,
    // Synthesised email from the fixture's name+domain — matches the
    // wire convention well enough for stories + tests. Real callers
    // override via the adapter path.
    email: `${sender.name.toLowerCase().replace(/[^a-z0-9]+/g, '.')}@${sender.domain}`,
    // Fixture senders have no standing policy by default; stories that
    // need the Unsub-queued pill flip this through their overrides.
    policyType: null,
    // No tracked unsub execution / mailto channel in fixtures (D9
    // Wave 2) — the adapter path overlays the wire values.
    unsubStatus: null,
    unsubscribeMethod: null,
    unsubscribeMailtoUrl: null,
    gmailCategory: GMAIL_CATEGORY[sender.group],
    isProtected,
    protectionReason,
    recommendation: buildRecommendation(sender, isProtected),
    recentMessages: overrides.recentMessages ?? buildRecentMessages(sender),
    stats: buildStats(sender),
    timeseries: buildTimeseries(sender),
    history: overrides.history ?? buildHistory(sender),
  };
}
