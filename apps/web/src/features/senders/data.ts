/**
 * Senders feature — domain model + the selectors/predicates every
 * senders surface reads.
 *
 * ## The one-model rule (2026-07-16 wire unification)
 *
 * `Sender` IS the wire row (`SenderListRow`) plus a small set of
 * derived presentation fields. `enrichSenderRow` builds it with a
 * spread, so every field the BE sends rides through by construction —
 * a new wire field can never be silently dropped, and a nullable wire
 * field can never be coerced into a fake fact on its way to a card.
 * (The previous hand-mapped adapter did both: `repliedCount` vanished,
 * `readRate: null` rendered as "Never read".)
 *
 * Derived fields are additive-only: the `DerivedSenderFields` keys are
 * type-asserted to never shadow a wire field, so a derived value can't
 * quietly replace a real one either.
 */

import {
  getActionDescriptor,
  type ActionVerb as RegistryActionVerb,
  type SelectorType,
} from '@declutrmail/shared/actions';
import { satisfiesActionTier, type TierId } from '@declutrmail/shared/entitlements';
import type { GmailCategory, LastReviewWire, SenderListRow } from '@/lib/api/senders';

/**
 * Component-side names for wire types — kept as aliases so the many
 * existing consumers don't churn. The wire module is the source of
 * truth for the shapes.
 */
export type SenderGroup = GmailCategory;
export type VolumeTrend = NonNullable<SenderListRow['volumeTrend']>;
export type SenderLastReview = LastReviewWire;

/**
 * Presentation fields derived from wire values at enrich time. Additive
 * only — see the no-shadow assertion below the type.
 */
interface DerivedSenderFields {
  /** Display name with the email-address fallback applied once. */
  name: string;
  /** Whole days since `lastSeenAt` — drives "Last seen" renders. */
  lastDays: number;
  /** Whole months since `firstSeenAt` — rough relationship age. */
  firstSeenMo: number;
}

/**
 * Compile-time guard: a derived key must never shadow a wire key. If
 * this line errors, a derived field would silently replace a real wire
 * value in the spread — rename the derived field instead.
 */
type _DerivedShadowsWire = Extract<keyof DerivedSenderFields, keyof SenderListRow>;
const _assertNoShadow: _DerivedShadowsWire extends never ? true : never = true;
void _assertNoShadow;

/**
 * The one sender model every senders surface consumes. Wire row +
 * derived presentation fields; nullable wire fields stay nullable all
 * the way to the render (a `null` readRate is "we don't know", never
 * "never read").
 */
export type Sender = SenderListRow & DerivedSenderFields;

/** Computes whole days between an ISO date and "now" — clamped to 0. */
export function daysSince(iso: string, now: number): number {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 0;
  return Math.max(0, Math.floor((now - then) / (1000 * 60 * 60 * 24)));
}

/** Computes whole months between an ISO date and "now" — clamped to 0. */
export function monthsSince(iso: string, now: number): number {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 0;
  return Math.max(0, Math.floor((now - then) / (1000 * 60 * 60 * 24 * 30)));
}

/**
 * Wire row → `Sender`. The spread carries EVERY wire field verbatim;
 * only the three derived fields are computed. This is the single seam
 * between the senders wire contract and the senders UI.
 */
export function enrichSenderRow(row: SenderListRow, now: number = Date.now()): Sender {
  return {
    ...row,
    name: row.displayName || row.email,
    lastDays: daysSince(row.lastSeenAt, now),
    firstSeenMo: monthsSince(row.firstSeenAt, now),
  };
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

// ─── Capability predicates ──────────────────────────────────────
// Unsubscribe never applies to people, nothing destructive for a
// standing-protected sender.

/**
 * A sender is shielded from destructive / bulk actions when it carries a
 * standing Protect policy.
 * The single predicate every "can this be bulk-acted?" surface reads, so
 * the row chip, the action CTAs, the KPI count, and the intent bucket can
 * never disagree.
 */
export function isStandingProtected(s: Pick<Sender, 'protectionFlags'>): boolean {
  return s.protectionFlags.isProtected;
}

export function canUnsubscribe(s: Sender): boolean {
  return (
    !isStandingProtected(s) &&
    s.gmailCategory !== 'primary' &&
    (s.unsubscribeMethod === 'one_click' || s.unsubscribeMethod === 'mailto')
  );
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

/**
 * Whether the workspace tier may invoke this verb through the requested
 * selector. Reads the same Action Registry capability the API enforces,
 * so Free's five single-sender actions cannot accidentally unlock the
 * Plus multi-select workflow in the Senders UI.
 */
export function canUseActionSelector(
  tier: TierId,
  verb: Exclude<ActionVerb, 'Protect'>,
  selector: SelectorType,
): boolean {
  const registryVerb = VERB_TO_REGISTRY[verb];
  if (registryVerb === undefined) return false;
  const capability = getActionDescriptor(registryVerb).capabilities[selector];
  return capability !== null && satisfiesActionTier(tier, capability.tier);
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
