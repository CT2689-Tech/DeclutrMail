/**
 * Senders feature — domain model, fixed demo dataset, and the
 * selectors that drive the weekly hero, cohort rail, and filters.
 *
 * The prototype generated senders at "mailbox scale" via a dev
 * switcher; the rebuild ships one fixed, realistic mailbox instead.
 */

import {
  getActionDescriptor,
  type ActionVerb as RegistryActionVerb,
} from '@declutrmail/shared/actions';
import type { UnsubscribeLifecycleStatus } from '@declutrmail/shared/contracts';

export type SenderGroup = 'primary' | 'promotions' | 'social' | 'updates' | 'forums';

/**
 * Bucketed volume-trend label — mirrors the BE `VolumeTrendBucket`
 * wire enum. Drives the trend chip on the row evidence line and the
 * trend cell on the detail stats strip. Bucketed (not raw %) to avoid
 * false precision on small baselines.
 */
export type VolumeTrend = 'new' | 'up' | 'down' | 'steady' | 'quiet' | 'dormant';

/**
 * Last-review summary surfaced on the detail header eyebrow. The
 * `verdict` mirrors the canonical engine output (lowercase enum). The
 * UI maps it to the K/A/U/L user-facing verb at render time so the
 * underlying enum and the user-visible label stay decoupled (D227).
 */
export interface SenderLastReview {
  /** ISO-8601 — when the engine produced this decision. */
  at: string;
  /** Engine verdict — closed enum mirroring `triage_decisions.verdict`. */
  verdict: 'keep' | 'archive' | 'unsubscribe' | 'later';
  /** Provenance — LLM call vs deterministic template fallback. */
  generatedBy: 'llm_haiku' | 'template';
  /**
   * Engine confidence, 0..1. Retained as decision-history metadata;
   * D245 forbids it from choosing or styling the primary action.
   * Optional for backward compatibility with older wire payloads.
   */
  confidence?: number;
}

export interface Sender {
  id: string;
  name: string;
  domain: string;
  /**
   * Full sender address (`senders.email`). Optional because fixture /
   * Weekly-Hero shapes predate it; when present it disambiguates
   * duplicate display names ("Amazon.com" ×5) via hover titles —
   * the D7 allowlist already covers sender identity.
   */
  email?: string;
  /** Emails per month (recent cadence). */
  monthly: number;
  /**
   * Total emails EVER received from this sender — the real
   * `senders.total_received` aggregate (D7-safe count). Optional because
   * the Weekly-Hero wire doesn't carry it; absent ⇒ render "—", never a
   * fabricated figure.
   */
  total?: number;
  group: SenderGroup;
  /** Read rate, 0–1. */
  read: number;
  /** 4-week volume series for the sparkline. */
  spark: number[];
  /** Days since the most recent message. */
  lastDays: number;
  /** Currently unread in the inbox from this sender. */
  unread: number;
  /**
   * Count of outbound messages from the user to this sender, derived
   * from Gmail's Sent label match. Pure fact (no inference). Surfaced
   * on Sender Card stat strip as "You replied". Optional because the
   * wire field lands in Phase 1 BE — absent ⇒ render em-dash via
   * NumericDisplay's degraded-input guard.
   */
  repliedCount?: number;
  /** Months since first seen — rough relationship age. */
  firstSeenMo: number;
  /** Auto-protected (receipts / statements) — never bulk-acted. */
  protected?: boolean;
  /**
   * Standing-policy unsub state — `true` when the user has clicked
   * Unsubscribe and the BE has written `sender_policies.policy_type =
   * 'unsubscribe'` (D38 + 2026-06-05 founder brainstorm). Drives the
   * unsub pill on the sender card; `unsubStatus` refines the copy.
   * Optional because Weekly-Hero + storybook fixtures don't carry it;
   * absent ⇒ no pill.
   */
  unsubPending?: boolean;
  /**
   * Truthful unsubscribe lifecycle (D9/D245). A remote endpoint accepting
   * a request is not presented as proof that future mail stopped; manual
   * Gmail progress and unavailable channels have their own states.
   */
  unsubStatus?: UnsubscribeLifecycleStatus | null;
  /**
   * List-Unsubscribe method from the sender's headers — mirrors the
   * wire `SenderListRow.unsubscribeMethod`. `'one_click'` is the
   * `unsub_ready` fact behind the ADR-0019 primary-CTA rule;
   * `'mailto'` is manual at launch (D230) so it never auto-recommends.
   * Optional because Weekly-Hero + legacy fixtures don't carry it;
   * absent ⇒ not unsub-ready.
   */
  unsubscribeMethod?: 'one_click' | 'mailto' | 'none' | null;
  /** Volume spike multiplier vs. the sender's usual rate. */
  spike?: number;
  /**
   * Bucketed MoM volume trend. `null` when the sender has no
   * timeseries history — the row falls back to the cadence-only
   * evidence line in that case.
   */
  volumeTrend?: VolumeTrend | null;
  /**
   * Most-recent triage decision summary. `null` when never reviewed
   * — the detail header surfaces "Never reviewed" in that case.
   */
  lastReview?: SenderLastReview | null;
  /**
   * Lifetime inbound count override for fixture stories (ADR-0014).
   * When omitted, `fixtureToSenderListRow` derives a synthetic count
   * from `monthly × firstSeenMo` so the story renders a coherent
   * "this sender at this cadence for this long" total. Stress-case
   * stories that need a specific value (e.g. a 5,000-message hero
   * card) set this directly.
   */
  totalReceived?: number;
}

export interface GroupMeta {
  key: SenderGroup;
  label: string;
  hint: string;
}

/** Gmail-native taxonomy. Real people → Primary; receipts → Updates. */
export const GROUPS: GroupMeta[] = [
  {
    key: 'primary',
    label: 'Primary',
    hint: 'Conversations and 1-to-1 mail — always come through.',
  },
  {
    key: 'promotions',
    label: 'Promotions',
    hint: 'Deals and marketing — the best candidates to unsubscribe.',
  },
  {
    key: 'social',
    label: 'Social',
    hint: 'Notifications from social networks and communities.',
  },
  {
    key: 'updates',
    label: 'Updates',
    hint: 'Transactional and recurring service mail. Receipts and statements are auto-protected; newsletter-style updates can be acted on.',
  },
  {
    key: 'forums',
    label: 'Forums',
    hint: 'Mailing lists, group threads, discussion digests.',
  },
];

export const GROUP_BY_KEY: Record<SenderGroup, GroupMeta> = Object.fromEntries(
  GROUPS.map((g) => [g.key, g]),
) as Record<SenderGroup, GroupMeta>;

/** The fixed demo mailbox — a realistic spread across all five groups. */
export const SENDERS: Sender[] = [
  // ── Primary (real people) ───────────────────────────────────
  {
    id: 'sarah',
    name: 'Sarah Chen',
    domain: 'google.com',
    monthly: 17,
    group: 'primary',
    read: 1,
    spark: [13, 17, 13, 17],
    lastDays: 0,
    unread: 2,
    firstSeenMo: 18,
  },
  {
    id: 'marcus',
    name: 'Marcus Kelly',
    domain: 'company.io',
    monthly: 9,
    group: 'primary',
    read: 1,
    spark: [4, 9, 9, 9],
    lastDays: 1,
    unread: 1,
    firstSeenMo: 9,
  },
  {
    id: 'alex',
    name: 'AlexFraser',
    domain: 'fastmail.com',
    monthly: 4,
    group: 'primary',
    read: 1,
    spark: [4, 0, 4, 4],
    lastDays: 6,
    unread: 0,
    firstSeenMo: 36,
  },
  {
    id: 'priya',
    name: 'Priya Raman',
    domain: 'hey.com',
    monthly: 6,
    group: 'primary',
    read: 0.95,
    spark: [5, 6, 7, 6],
    lastDays: 2,
    unread: 1,
    firstSeenMo: 14,
  },
  {
    id: 'dan',
    name: 'Dan Whitfield',
    domain: 'proton.me',
    monthly: 3,
    group: 'primary',
    read: 1,
    spark: [2, 3, 3, 3],
    lastDays: 4,
    unread: 0,
    firstSeenMo: 27,
  },

  // ── Promotions ──────────────────────────────────────────────
  {
    id: 'groupon',
    name: 'Groupon',
    domain: 'groupon.com',
    monthly: 52,
    group: 'promotions',
    read: 0,
    spark: [16, 22, 28, 52],
    spike: 3,
    lastDays: 0,
    unread: 41,
    firstSeenMo: 28,
  },
  {
    id: 'oldnavy',
    name: 'Old Navy',
    domain: 'oldnavy.com',
    monthly: 48,
    group: 'promotions',
    read: 0,
    spark: [12, 14, 18, 48],
    spike: 3,
    lastDays: 0,
    unread: 36,
    firstSeenMo: 22,
  },
  {
    id: 'medium',
    name: 'Medium Daily',
    domain: 'medium.com',
    monthly: 60,
    group: 'promotions',
    read: 0.07,
    spark: [22, 28, 36, 60],
    spike: 2.8,
    lastDays: 0,
    unread: 52,
    firstSeenMo: 12,
  },
  {
    id: 'etsy',
    name: 'Etsy',
    domain: 'etsy.com',
    monthly: 41,
    group: 'promotions',
    read: 0.04,
    spark: [12, 14, 22, 41],
    spike: 2.6,
    lastDays: 0,
    unread: 31,
    firstSeenMo: 52,
  },
  {
    id: 'doordash',
    name: 'DoorDash',
    domain: 'doordash.com',
    monthly: 38,
    group: 'promotions',
    read: 0,
    spark: [26, 30, 34, 38],
    lastDays: 1,
    unread: 29,
    firstSeenMo: 18,
  },
  {
    id: 'uber',
    name: 'Uber Eats',
    domain: 'uber.com',
    monthly: 26,
    group: 'promotions',
    read: 0,
    spark: [24, 26, 24, 26],
    lastDays: 2,
    unread: 21,
    firstSeenMo: 41,
  },
  {
    id: 'wayfair',
    name: 'Wayfair',
    domain: 'wayfair.com',
    monthly: 33,
    group: 'promotions',
    read: 0,
    spark: [14, 18, 24, 33],
    spike: 2.2,
    lastDays: 0,
    unread: 25,
    firstSeenMo: 30,
  },
  {
    id: 'nike',
    name: 'Nike',
    domain: 'nike.com',
    monthly: 19,
    group: 'promotions',
    read: 0.05,
    spark: [16, 17, 18, 19],
    lastDays: 1,
    unread: 12,
    firstSeenMo: 44,
  },
  {
    id: 'sephora',
    name: 'Sephora',
    domain: 'sephora.com',
    monthly: 22,
    group: 'promotions',
    read: 0.11,
    spark: [18, 20, 21, 22],
    lastDays: 0,
    unread: 14,
    firstSeenMo: 38,
  },
  {
    id: 'booking',
    name: 'Booking.com',
    domain: 'booking.com',
    monthly: 15,
    group: 'promotions',
    read: 0.18,
    spark: [12, 13, 14, 15],
    lastDays: 3,
    unread: 7,
    firstSeenMo: 50,
  },
  {
    id: 'substack',
    name: 'Letters of Note',
    domain: 'substack.com',
    monthly: 8,
    group: 'promotions',
    read: 0.85,
    spark: [8, 8, 7, 8],
    lastDays: 3,
    unread: 1,
    firstSeenMo: 14,
  },
  {
    id: 'spotify',
    name: 'Spotify',
    domain: 'spotify.com',
    monthly: 4,
    group: 'promotions',
    read: 0.62,
    spark: [4, 3, 4, 4],
    lastDays: 4,
    unread: 1,
    firstSeenMo: 56,
  },
  {
    id: 'duolingo',
    name: 'Duolingo',
    domain: 'duolingo.com',
    monthly: 8,
    group: 'promotions',
    read: 0.18,
    spark: [7, 8, 8, 8],
    lastDays: 5,
    unread: 3,
    firstSeenMo: 20,
  },

  // ── Social ──────────────────────────────────────────────────
  {
    id: 'linkedin',
    name: 'LinkedIn',
    domain: 'linkedin.com',
    monthly: 64,
    group: 'social',
    read: 0,
    spark: [44, 52, 58, 64],
    lastDays: 0,
    unread: 47,
    firstSeenMo: 38,
  },
  {
    id: 'twitter',
    name: 'X (Twitter)',
    domain: 'x.com',
    monthly: 34,
    group: 'social',
    read: 0,
    spark: [22, 26, 30, 34],
    lastDays: 1,
    unread: 18,
    firstSeenMo: 64,
  },
  {
    id: 'reddit',
    name: 'Reddit',
    domain: 'reddit.com',
    monthly: 19,
    group: 'social',
    read: 0.15,
    spark: [21, 18, 19, 19],
    lastDays: 2,
    unread: 11,
    firstSeenMo: 30,
  },
  {
    id: 'instagram',
    name: 'Instagram',
    domain: 'instagram.com',
    monthly: 28,
    group: 'social',
    read: 0.08,
    spark: [20, 23, 26, 28],
    lastDays: 0,
    unread: 16,
    firstSeenMo: 48,
  },
  {
    id: 'meetup',
    name: 'Meetup',
    domain: 'meetup.com',
    monthly: 6,
    group: 'social',
    read: 0.55,
    spark: [6, 7, 6, 6],
    lastDays: 8,
    unread: 1,
    firstSeenMo: 44,
  },
  {
    id: 'nextdoor',
    name: 'Nextdoor',
    domain: 'nextdoor.com',
    monthly: 12,
    group: 'social',
    read: 0.3,
    spark: [10, 11, 12, 12],
    lastDays: 4,
    unread: 5,
    firstSeenMo: 22,
  },

  // ── Updates ─────────────────────────────────────────────────
  {
    id: 'github',
    name: 'GitHub',
    domain: 'github.com',
    monthly: 13,
    group: 'updates',
    read: 1,
    spark: [12, 13, 13, 13],
    lastDays: 0,
    unread: 0,
    firstSeenMo: 72,
  },
  {
    id: 'notion',
    name: 'Notion',
    domain: 'notion.so',
    monthly: 17,
    group: 'updates',
    read: 0.5,
    spark: [13, 16, 17, 17],
    lastDays: 1,
    unread: 8,
    firstSeenMo: 32,
  },
  {
    id: 'stripe',
    name: 'Stripe',
    domain: 'stripe.com',
    monthly: 13,
    group: 'updates',
    read: 0.9,
    spark: [13, 13, 13, 13],
    lastDays: 0,
    unread: 1,
    firstSeenMo: 48,
    protected: true,
  },
  {
    id: 'amex',
    name: 'American Express',
    domain: 'americanexpress.com',
    monthly: 9,
    group: 'updates',
    read: 0.7,
    spark: [8, 9, 9, 9],
    lastDays: 5,
    unread: 2,
    firstSeenMo: 96,
    protected: true,
  },
  {
    id: 'calendly',
    name: 'Calendly',
    domain: 'calendly.com',
    monthly: 17,
    group: 'updates',
    read: 0.9,
    spark: [13, 17, 17, 17],
    lastDays: 0,
    unread: 1,
    firstSeenMo: 24,
    protected: true,
  },
  {
    id: 'chase',
    name: 'Chase',
    domain: 'chase.com',
    monthly: 7,
    group: 'updates',
    read: 0.75,
    spark: [7, 7, 7, 7],
    lastDays: 2,
    unread: 1,
    firstSeenMo: 84,
    protected: true,
  },
  {
    id: 'ifttt',
    name: 'IFTTT',
    domain: 'ifttt.com',
    monthly: 22,
    group: 'updates',
    read: 0.1,
    spark: [18, 20, 22, 22],
    lastDays: 0,
    unread: 14,
    firstSeenMo: 60,
  },
  {
    id: 'paypal',
    name: 'PayPal',
    domain: 'paypal.com',
    monthly: 6,
    group: 'updates',
    read: 0,
    spark: [5, 6, 6, 6],
    lastDays: 11,
    unread: 4,
    firstSeenMo: 110,
    protected: true,
  },
  {
    id: 'grammarly',
    name: 'Grammarly',
    domain: 'grammarly.com',
    monthly: 14,
    group: 'updates',
    read: 0.12,
    spark: [11, 12, 13, 14],
    lastDays: 1,
    unread: 9,
    firstSeenMo: 26,
  },
  {
    id: 'dropbox',
    name: 'Dropbox',
    domain: 'dropbox.com',
    monthly: 5,
    group: 'updates',
    read: 0.4,
    spark: [5, 5, 5, 5],
    lastDays: 9,
    unread: 2,
    firstSeenMo: 70,
  },

  // ── Forums ──────────────────────────────────────────────────
  {
    id: 'stack',
    name: 'Stack Overflow',
    domain: 'stackoverflow.email',
    monthly: 9,
    group: 'forums',
    read: 0,
    spark: [9, 9, 9, 9],
    lastDays: 2,
    unread: 9,
    firstSeenMo: 84,
  },
  {
    id: 'hn',
    name: 'Hacker Newsletter',
    domain: 'hackernewsletter.com',
    monthly: 4,
    group: 'forums',
    read: 0.92,
    spark: [4, 4, 4, 4],
    lastDays: 3,
    unread: 0,
    firstSeenMo: 70,
  },
  {
    id: 'django',
    name: 'django-users',
    domain: 'googlegroups.com',
    monthly: 46,
    group: 'forums',
    read: 0.04,
    spark: [38, 42, 44, 46],
    spike: 1.6,
    lastDays: 0,
    unread: 39,
    firstSeenMo: 102,
  },
  {
    id: 'indiehackers',
    name: 'Indie Hackers',
    domain: 'indiehackers.com',
    monthly: 11,
    group: 'forums',
    read: 0.45,
    spark: [10, 11, 11, 11],
    lastDays: 4,
    unread: 3,
    firstSeenMo: 19,
  },
  {
    id: 'designweekly',
    name: 'Design Weekly',
    domain: 'designweekly.email',
    monthly: 5,
    group: 'forums',
    read: 0.5,
    spark: [5, 4, 5, 5],
    lastDays: 6,
    unread: 1,
    firstSeenMo: 33,
  },
];

// ─── Capability gates ──────────────────────────────────────────
// Don't show actions the user can't take: no Unsubscribe for real
// people, nothing destructive for a standing-protected sender.

/**
 * A sender is shielded from destructive / bulk actions when it carries a
 * standing Protect policy.
 * The single predicate every "can this be bulk-acted?" surface reads, so
 * the row chip, the action CTAs, the KPI count, and the intent bucket can
 * never disagree.
 */
export function isStandingProtected(s: Pick<Sender, 'protected'>): boolean {
  return s.protected === true;
}

export function canUnsubscribe(s: Sender): boolean {
  return !isStandingProtected(s) && s.group !== 'primary';
}

export function canArchive(s: Sender): boolean {
  return !isStandingProtected(s);
}

/** "Later" moves a sender's current inbox mail to the
 * DeclutrMail/Later label — safe for anyone not standing-protected. */
export function canLater(s: Sender): boolean {
  return !isStandingProtected(s);
}

/** Delete (Gmail Trash, 30-day recovery) — gated like the other
 * destructive verbs: blocked only for standing-protected senders
 * (D42/D43). */
export function canDelete(s: Sender): boolean {
  return !isStandingProtected(s);
}

/** Compact large-number display: 12480 → "12.5k". */
export function fmtCompact(n: number): string {
  if (n < 1000) return n.toLocaleString();
  if (n < 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  if (n < 1_000_000) return Math.round(n / 1000) + 'k';
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
}

/**
 * Above this, a "days since last seen" value is not a date — it's the
 * Unix epoch leaking through. Gmail reports `internalDate: 0` for some
 * spam messages (verified live 2026-07-03: 8 senders at 1970-01-01),
 * which adapts to ~20,600 days. 9,000d (~24.6y) sits far above any
 * real retention window and far below the epoch distance.
 */
export const EPOCH_GUARD_DAYS = 9000;

export function relTime(days: number): string {
  if (days > EPOCH_GUARD_DAYS) return 'unknown';
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.round(days / 7)}w ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

export function relTimeLabel(days: number): string {
  const t = relTime(days);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Gmail #search deep-link — verifies any claim with zero API calls. */
export function gmailSearchUrl(domain: string): string {
  return `https://mail.google.com/mail/u/0/#search/from%3A%40${encodeURIComponent(domain)}`;
}

// ─── Actions ───────────────────────────────────────────────────
// Canonical verbs (D227: Keep / Archive / Unsubscribe / Later) plus
// Protect — a distinct safety operation, not a triage verb.

export type ActionVerb = 'Keep' | 'Archive' | 'Unsubscribe' | 'Later' | 'Protect' | 'Delete';

/** Past-tense verb labels for toasts + receipts — single source. */
export const VERB_PAST: Record<ActionVerb, string> = {
  Keep: 'Kept',
  Archive: 'Archived',
  Unsubscribe: 'Requested unsubscribe from',
  Later: 'Moved to Later',
  Protect: 'Protected',
  // Spec v1.2 Decision 1 — Delete = Gmail Trash (recoverable 30 days).
  // Past-tense surfaces in the receipt strip after the worker completes.
  Delete: 'Moved to Gmail Trash',
};

/**
 * Bridge the senders-feature's capitalized verb labels to the lowercase
 * Action Registry verbs (ADR-0015) so every action surface sources its
 * button label + shortcut from the ONE registry instead of a local
 * hardcode (P4). `Protect` is a safety operation with no registry verb.
 */
const VERB_TO_REGISTRY: Partial<Record<ActionVerb, RegistryActionVerb>> = {
  Keep: 'keep',
  Archive: 'archive',
  Unsubscribe: 'unsubscribe',
  Later: 'later',
  Delete: 'delete',
};

/**
 * Registry-sourced display copy for a senders verb: the canonical button
 * label + its single-key shortcut (D227 K/A/U/L; `null` for verbs with
 * no canonical letter, e.g. `Protect`). The single seam the SelectionBar,
 * ConfirmActionModal, and cheatsheet read so the verb label/shortcut can
 * never drift between surfaces.
 */
export function verbDisplay(verb: ActionVerb): { label: string; shortcut: string | null } {
  const registryVerb = VERB_TO_REGISTRY[verb];
  if (registryVerb === undefined) return { label: verb, shortcut: null };
  const descriptor = getActionDescriptor(registryVerb);
  return { label: descriptor.copy.primary, shortcut: descriptor.shortcut };
}

export interface ActionRequest {
  verb: ActionVerb;
  senders: Sender[];
  /** Original user selection before any eligibility narrowing. */
  selectedCount?: number;
  /**
   * Senders the eligibility gate dropped from the user's selection
   * before this request was built (D226 honesty — the preview must say
   * why it covers fewer senders than the selection bar showed). Only
   * two gates exist: standing protection (every bulk verb, D42/D43)
   * and the people rule (Unsubscribe never applies to primary-group
   * senders). Omitted when the request covers the full selection.
   */
  skipped?: {
    protectedCount: number;
    peopleCount: number;
  };
}

/** Which curated slice the focused review session is working on. */
export type ReviewKind = 'promo' | 'quiet' | 'protect';

/** The closed set of per-row decisions a review session can record. */
export type DecisionId = 'keep' | 'later' | 'unsub' | 'lock' | 'skip';
