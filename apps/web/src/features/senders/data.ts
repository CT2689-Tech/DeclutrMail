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
 * (The previous hand-mapped adapter did both: `wroteToCount` vanished,
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
import {
  SELECTOR_TIERS,
  TIER_MANIFEST,
  satisfiesActionTier,
  type TierId,
} from '@declutrmail/shared/entitlements';
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

/**
 * Whole CALENDAR days between an ISO date and "now", in the reader's own
 * timezone — clamped to 0.
 *
 * Calendar days, not elapsed 24-hour blocks, because `0` renders as the word
 * "today". Elapsed hours made that false for most of every night: mail that
 * arrived at 14:00 yesterday is 11 hours old at 01:00, which floors to 0 and
 * printed "today" for a message from the previous day. Nobody reads "today"
 * as "since this time yesterday".
 *
 * The comparison has to happen HERE and not on the server, because only the
 * browser knows which calendar day the reader is in. A server computing this
 * in UTC would be wrong for every reader west of it after their local
 * midnight, and wrong for everyone east of it before theirs.
 */
export function daysSince(iso: string, now: number): number {
  const then = new Date(iso);
  if (!Number.isFinite(then.getTime())) return 0;
  // Midnight-to-midnight in local time. Building the dates through the local
  // Y/M/D constructor is what makes DST-crossing spans come out whole: the
  // raw millisecond gap across a clock change is 23 or 25 hours, which
  // truncating division would round the wrong way.
  const thenMidnight = new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime();
  const nowDate = new Date(now);
  const nowMidnight = new Date(
    nowDate.getFullYear(),
    nowDate.getMonth(),
    nowDate.getDate(),
  ).getTime();
  return Math.max(0, Math.round((nowMidnight - thenMidnight) / 86_400_000));
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

/**
 * The secondary identity line under a sender's name — the full address.
 *
 * Senders are keyed by ADDRESS, not domain (`sender_key =
 * sha256("v1|" + normalized_email)`, D12 / ADR-0011), so one brand can
 * legitimately own several rows. Rendering only the domain made those
 * rows visually identical — two `Redfin` / `redfin.com` cards read as a
 * duplicate bug (founder smoke 2026-08-19, recurrence of the 2026-07-07
 * hover-only fix). The address is what actually distinguishes them, so
 * it is shown outright rather than hidden in a `title` tooltip that
 * touch can never reach.
 *
 * Falls back to the domain when there is no From-header display name:
 * `name` is already the address in that case (see `enrichSenderRow`),
 * and printing it twice tells the reader nothing new.
 */
export function senderAddressLine(
  sender: Pick<SenderListRow, 'displayName' | 'email' | 'domain'>,
): string {
  return sender.displayName.trim() === '' ? sender.domain : sender.email;
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
    hint: 'Conversations and direct email — always come through.',
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
    hint: 'Transactional and recurring service email. Receipts and statements are auto-protected; newsletter-style updates can be acted on.',
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

/**
 * EXPLICIT single-sender capability.
 *
 * D245 excludes Protected senders from **bulk and automatic**
 * mail-changing actions — not from an explicit click the user aimed at
 * one sender. These four predicates therefore carry no protection term;
 * `canBulk*` below does, and every bulk/automatic path reads those.
 *
 * The server has always agreed: `actions.service.ts` answers a protected
 * single-sender action with 409 `PROTECTED_SENDER` whose message is
 * written as a confirm — "This sender is Protected. Confirm to archive
 * anyway." — and accepts an `override` flag to proceed. It expected a UI
 * that offers "anyway"; the client greyed the button out instead, so the
 * 409 was unreachable and `override` had no production caller.
 *
 * Auto-protection fires on ≥3 replies (plus starred / Gmail-important),
 * so the blocked set was every sender the user actually corresponds
 * with — the whole product went read-only for exactly those.
 */
export function canUnsubscribe(s: Sender): boolean {
  // Channel requirement only: no List-Unsubscribe header means there is
  // nothing to send, which is a fact about the sender rather than a
  // policy. The former `gmailCategory !== 'primary'` term is gone — it
  // had no server, worker, or scoring counterpart and greyed the button
  // with no reason text. `deriveDefaultPrimary` already declines to
  // RECOMMEND Unsubscribe for those senders, which is the right place
  // for a soft signal.
  return s.unsubscribeMethod === 'one_click' || s.unsubscribeMethod === 'mailto';
}

export function canArchive(_s: Sender): boolean {
  return true;
}

/** "Later" moves a sender's current inbox mail to the
 * DeclutrMail/Later label. */
export function canLater(_s: Sender): boolean {
  return true;
}

/** Delete (Gmail Trash, 30-day recovery, plus the tier undo window). */
export function canDelete(_s: Sender): boolean {
  return true;
}

/**
 * BULK capability — `can*` AND not standing-protected.
 *
 * This is the D245 guardrail: Protected senders are excluded from bulk
 * and automatic mail-changing actions. Every multi-select surface MUST
 * filter on these, never on the bare `can*` predicates, or a protected
 * sender re-enters a bulk. The server enforces it again
 * (`actions.service.ts` skips protected keys and reports them in
 * `skipped`), but a client that offered them would state a count it
 * cannot deliver.
 */
export function canBulkUnsubscribe(s: Sender): boolean {
  return canUnsubscribe(s) && !isStandingProtected(s);
}

export function canBulkArchive(s: Sender): boolean {
  return canArchive(s) && !isStandingProtected(s);
}

export function canBulkLater(s: Sender): boolean {
  return canLater(s) && !isStandingProtected(s);
}

export function canBulkDelete(s: Sender): boolean {
  return canDelete(s) && !isStandingProtected(s);
}

/** Compact large-number display: 12480 → "12.5k". */
export function fmtCompact(n: number): string {
  if (n < 1000) return n.toLocaleString('en-US');
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
  // "Deleted", not just "Moved" — every other verb's past-tense label
  // names its own verb; Delete's dropped it (QA-undo-20260828-04).
  Delete: 'Deleted to Gmail Trash',
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
/**
 * The plan that unlocks multi-sender bulk, from the pricing config —
 * copy must never write a plan name as a literal (A3 Leak 2). With
 * bulk on Free this line renders for nobody; it stays derived so a
 * future retier keeps the copy truthful automatically.
 */
export function multiSenderPlanName(): string {
  return TIER_MANIFEST[SELECTOR_TIERS['multi-sender']].name;
}

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
  /**
   * ELIGIBLE senders before the monthly cleanup quota capped this
   * request — not the selection total. Set only when the cap actually
   * bit, and paired with copy that says "eligible": on a selection that
   * was ALSO eligibility-narrowed the two differ (3 selected, 1
   * protected, 2 eligible, 1 affordable), and calling 2 the selection
   * total misreports what the user did.
   *
   * Rides the request for the same reason `skipped` does (D226 honesty):
   * the preview must cover exactly what will run, and must say why it
   * covers fewer senders than the selection bar showed. Capping BEFORE
   * the preview query — rather than truncating at mutation time — is
   * what keeps the two in agreement.
   */
  quotaCappedFrom?: number;
  /**
   * How many senders this request will actually act on.
   *
   * STATED, not derived. The modal used to infer it as `selectedCount -
   * skipped`, which held only while eligibility was the one reason a
   * request could cover fewer senders than the selection. The quota cap
   * is a second reason, and any future narrowing would be a third — each
   * one silently invalidating an arithmetic identity nobody wrote down.
   * The caller knows the number; it should say it.
   */
  actionableCount?: number;
}

/** Which curated slice the focused review session is working on. */
export type ReviewKind = 'promo' | 'quiet' | 'protect';

/** The closed set of per-row decisions a review session can record. */
export type DecisionId = 'keep' | 'later' | 'unsub' | 'lock' | 'skip';

/**
 * `YYYY-MM-DD` for a message row's received-at.
 *
 * Ordered year-first rather than a locale format so it cannot be misread
 * as D/M vs M/D — the point of showing it is that the reader can match it
 * against Gmail, and an ambiguous date defeats that.
 *
 * Built from LOCAL calendar parts, deliberately: `toISOString().slice(0,10)`
 * is UTC and lands a day off from what Gmail shows anyone west of it.
 * Callers must therefore be client-only (interaction-opened surfaces) or
 * gate on `useNow()`, or the local zone can desync a server render.
 *
 * Returns '' for an unparseable value so the row still renders its
 * subject instead of "Invalid Date".
 */
export function shortDate(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const date = new Date(ms);
  const two = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}
