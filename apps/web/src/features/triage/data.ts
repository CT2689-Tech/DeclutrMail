/**
 * Triage feature — row types + pure helpers.
 *
 * A row is what the triage API returns: a join between
 * `triage_decisions` (D20 — verdict + confidence + reasoning) and
 * `senders` (display name + Gmail category + unsubscribe method). The
 * demo fixtures live in `fixtures.ts`, so a module that needs a helper
 * from here does not also ship the engine and the fixture senders.
 *
 * Privacy (D7 / D228): no body fields. Each decision references its
 * sender by `senderKey` and surfaces only metadata — sender identity,
 * Gmail category, volume / read aggregates, the engine's verdict, and
 * the reasoning copy (D24 — Haiku output or deterministic template).
 *
 * D222 reminder: we record VERDICTs, never categories. The Gmail
 * `gmailCategory` field is Gmail's own classification, not a learned
 * prediction.
 *
 * D227 reminder: verdicts are stored as the lowercase enum
 * (`keep | archive | unsubscribe | later`) — the user-facing labels
 * (Keep / Archive / Unsubscribe / Later) are derived at render time.
 */

import type { TriageVerdict } from './types';
import { daysSince } from '@/features/senders/data';

/** Gmail-side category — surfaces in row chrome (read-only). Mirrored
 * from the canonical `gmail_category` pg_enum via the shared contracts
 * package so a migration that widens the enum widens this type. */
export type { GmailCategory } from '@declutrmail/shared/contracts';
import type { GmailCategory } from '@declutrmail/shared/contracts';

/**
 * RFC 8058 unsubscribe capability per sender (mirrors
 * `senders.unsubscribe_method`). `one_click` automates cleanly;
 * `mailto` defers per D230 ("Mailto unsubscribe is manual at launch");
 * `none` falls back to manual.
 */
export type UnsubscribeMethod = 'one_click' | 'mailto' | 'none';

/**
 * The wire value, which is NULLABLE (D248): null means the sender index
 * has not derived a method yet. That is "not checked", not "no channel"
 * — the row must never claim we looked when we did not.
 */
export type StoredUnsubscribeMethod = UnsubscribeMethod | null;

/**
 * Why a sender's verdict is locked to Keep — surfaces in the row.
 *
 * These are the TRIAGE WIRE spellings, which is the point: this union
 * used to say `user-marked` while `TriageReadService.mapProtectionReason`
 * has always sent `manual`, so every user-protected row in production
 * carried a value outside its own type. Nothing caught it because the
 * fixtures used the type's spelling rather than the wire's.
 *
 * Display goes through `normalizeProtectionReason` in
 * `@declutrmail/shared/copy`, which resolves all three live dialects.
 */
export type ProtectionReason = 'manual' | 'replied' | 'starred' | 'gmail-important';

/**
 * One row in the triage queue — sender identity + engine verdict +
 * supporting signals + protection posture.
 *
 * Field naming mirrors the BE projection, so the live queue and the
 * fixtures in `fixtures.ts` share this one type.
 */
export interface TriageDecisionRow {
  /** Stable id — `${senderKey}` in real data; opaque token in fixtures. */
  id: string;
  /**
   * `senders.id` uuid — the selector `POST /api/actions` takes (the BE
   * resolves it to `sender_key` server-side, which also enforces
   * ownership). Carried on the row so confirming a verb never needs a
   * second lookup (D226 wiring). Opaque token in fixtures.
   */
  senderId: string;
  /** sha256("v1|" + normalized_email), hex — matches `senders.sender_key`. */
  senderKey: string;
  senderName: string;
  senderEmail: string;
  senderDomain: string;
  /**
   * Whether the server already holds a brand mark for `senderDomain`
   * (ADR-0034). `false` means `Avatar` renders the monogram and makes NO
   * request — the point of the field, since a triage queue of unresolved
   * domains otherwise burns one 204 round trip per row on the coldest
   * cache in the product.
   */
  brandMark: boolean;
  gmailCategory: GmailCategory;
  /** Best unsubscribe method seen across the sender's messages, or
   *  null when the sender index has not derived one yet (D248). */
  unsubscribeMethod: StoredUnsubscribeMethod;

  /** Engine verdict — D21 cascade output. */
  verdict: TriageVerdict;
  /** Engine confidence in `[0.00, 1.00]`. Whether it counts as a
   *  recommendation is verdict-aware — see `RECOMMEND_FLOOR` (D31). */
  confidence: number;
  /** D24 reasoning copy — LLM (Haiku) or template fallback. */
  reasoning: string;
  /**
   * Whose sentence `reasoning` is (D24). A row still on the template asks
   * for its LLM sentence (`useExplainReasons`); never rendered. OPTIONAL:
   * the demo fixtures and the public simulator have no engine behind them,
   * and an API predating the field makes no claim — neither asks.
   */
  generatedBy?: 'llm_haiku' | 'template';
  /**
   * ISO-8601 — when the engine produced this read (D25).
   *
   * OPTIONAL because the demo fixtures and the public inbox simulator
   * have no engine run behind them. Absent means "no age to state",
   * which is why the label renders only when it is present — a
   * fabricated "scored just now" on a hand-written fixture would be the
   * same lie this field exists to remove.
   */
  scoredAt?: string;
  /**
   * Whether that read is past its TTL. Absent = unknown (fixtures),
   * which is NOT the same as fresh: unknown neither labels the row nor
   * triggers a refresh.
   */
  stale?: boolean;
  /** Evidence shown as a bullet list in the expanded row. */
  signals: string[];

  /**
   * Why the verdict is locked to Keep. Non-null means the engine's
   * Phase A protection ran (manual or an exact strong-signal reason).
   * Protected rows stay out of automatic and bulk cleanup, while the
   * user's explicit row actions remain available with confirmation.
   */
  protectionReason: ProtectionReason | null;
  /**
   * Does the recorded `protectionReason` still hold?
   *
   * `false` means the evidence is gone and this row is being surfaced
   * for the user to keep or unprotect — NOT that anything was
   * withdrawn. `null` (unmeasurable) and `undefined` (an API predating
   * the field) both mean "no claim", and render exactly as `true`.
   */
  protectionEvidenceCurrent?: boolean | null;

  /**
   * Volume signal — `round(last90dMessages / 3)`, a 90-day-derived
   * average, not a measured rolling monthly count (Codex review,
   * QA-archive-20260828-01 — this doc comment previously called it a
   * "4-week average", which doesn't match the actual derivation below).
   */
  monthlyVolume: number;
  /**
   * Raw last-90-day message count. Lets the FE render an honest
   * rolling-window signal ("N in last 90d") instead of the derived
   * `monthlyVolume = round(last90 / 3)`, which rounds to 0 for senders
   * quiet within the window (FOUNDER 2026-06-06 smoke — every row read
   * "0/mo" because the only mail from those senders was older than 90d).
   */
  last90dMessages: number;
  /**
   * Inbound messages currently in the Inbox. The API includes this live
   * count; optional so illustrative fixtures and older API deployments do
   * not make a claim about the current mailbox state.
   */
  inboxCount?: number;
  /**
   * Read rate in `[0, 1]`, or `null` when the sender sent nothing in
   * the 90-day window — NOT 0.
   *
   * The BE has always typed this nullable; the FE typed it `number` and
   * every consumer did `Math.round(readRate * 100)`, which renders a
   * missing measurement as a confident "0% read". The expanded row card
   * showed exactly that. Unknown is a state, not a zero.
   */
  readRate: number | null;
  /** Days since the sender's most recent message. */
  /**
   * ISO timestamp of the sender's newest inbound message, or `null` when the
   * back end could not read one. The DAY COUNT is derived here, not sent —
   * "today" is a calendar claim and only this process knows the reader's
   * calendar. See `lastSeenLabel`.
   */
  lastSeenAt: string | null;
  /** Inbound messages currently present in DeclutrMail's mailbox index. */
  totalAllTime: number;
  /**
   * Unread inbound messages sitting in the INBOX right now — the subset
   * of what an Archive / Later / Delete would move that Gmail has
   * never marked read.
   *
   * For a Protected sender this is what the protection is SHIELDING
   * from bulk and automatic cleanup, which is what makes a wrong
   * protection expensive. Resolved server-side from the same message
   * set the action preview counts, so the two can never disagree.
   *
   * Optional — the wire read is an unvalidated cast, web and API
   * deploy independently, and an older API omits the field. Required
   * here typed away a real runtime state; consumers were safe only by
   * accident of statement order. Absent ⇒ show nothing, never a
   * fabricated 0 (the senders wire types the same field the same way,
   * for the same reason).
   */
  unreadInboxCount?: number;
}

/** Snapshot stats for the empty state copy — "today you Kept N senders, etc." */
export interface TriageSessionStats {
  decidedToday: number;
  archivedToday: number;
  unsubscribedToday: number;
  laterToday: number;
  /** Free-tier remaining decisions for the day (D33 upgrade nudge). */
  freeRemaining: number | null;
  /**
   * D33 tier-gated nudge — surfaces a subtle Plus or Pro link in
   * the empty state. `null` for Pro users (no nudge; D33: "Hidden
   * for Pro users"). See D17–D21 for the tier ladder.
   */
  tier: 'free' | 'plus' | 'pro';
}

/**
 * Loading / empty / ready / error — closed union, no `string` fallback.
 *
 * `error` carries the failed query's error (an `ApiError` in practice)
 * plus a `retry` callback the page composes from the queries' refetch.
 * Reads do NOT auto-retry 4xx (the `makeQueryClient` invariant — guard
 * 409s are designed states handled at layout level); the explicit
 * "Try again" affordance is the only retry path.
 */
export type TriageScreenState =
  | { kind: 'loading' }
  | { kind: 'empty'; stats: TriageSessionStats }
  | { kind: 'ready'; rows: TriageDecisionRow[]; stats: TriageSessionStats }
  | { kind: 'error'; error: unknown; retry: () => void };

// ─── Capability gates ─────────────────────────────────────────────
// Mirrors the senders feature: an explicit single-row action is offered
// for every verb, and Unsubscribe is hidden only when no
// `List-Unsubscribe` header was seen (a fact, not a policy).
//
// These previously returned false for any protected row, which
// contradicted this feature's OWN server contract verbatim —
// `triage.read-service.ts` states that forcing the Keep RECOMMENDATION
// for a protected sender is "display-layer only … every K/A/U/L action
// remains available on the row". The gate was also client-only: the
// server has no protected check on the triage act path, so it blocked
// nothing an HTTP client couldn't do anyway.
//
// D245 excludes Protected senders from BULK and AUTOMATIC actions; the
// autopilot workers enforce that and are untouched. Triage rows are
// explicit single-sender intent behind the mandatory D226 preview.

export function canArchive(_row: TriageDecisionRow): boolean {
  return true;
}

export function canLater(_row: TriageDecisionRow): boolean {
  return true;
}

/**
 * Unsubscribe is offered when the sender has any List-Unsubscribe
 * header — a fact about the sender, not a policy. `mailto` is rendered
 * with a "manual follow-up" hint per D230 — never auto-fired.
 */
export function canUnsubscribe(row: TriageDecisionRow): boolean {
  // Requires a REAL channel, matching the Senders and Screener
  // predicates. `!== 'none'` was equivalent while the wire could not be
  // null; now that it can (D248), an un-indexed sender would have read
  // as unsubscribable and 409'd on the intent route.
  return row.unsubscribeMethod === 'one_click' || row.unsubscribeMethod === 'mailto';
}

/**
 * Display value for the "last seen" stat — derived so it can never
 * contradict the quiet-90d copy that `last90dMessages` drives (the
 * 2026-07-02 audit's W3: a row read "Quiet 90d · 555 received" while
 * the stat card said "LAST SEEN today").
 *
 * When the sender has ZERO messages inside the rolling 90-day window,
 * any `lastDays < 90` is internally inconsistent — the aggregate window is
 * computed in SQL from real rows. The window wins: render "90d+" unless
 * `lastDays` already agrees.
 *
 * The back end no longer collapses an unreadable date to `0` (it sends `null`),
 * so this is now a consistency guard rather than the mitigation it started as.
 * It was never sufficient on its own: gated on an EMPTY 90-day window, it only
 * ever covered senders where a "today" would have looked absurd, and left the
 * 1-89 day band — where a wrong "today" reads as entirely plausible — rendering
 * the false value. 849 of the 954 rows that asserted a recency were wrong.
 */
export function lastSeenLabel(
  row: Pick<TriageDecisionRow, 'lastSeenAt' | 'last90dMessages'>,
  now: number = Date.now(),
): string {
  // Unknown renders as unknown — the word, not a glyph the reader has to
  // infer. Anything else here invents a recency for mail whose date we could
  // not read.
  if (row.lastSeenAt === null) return 'unknown';
  // CALENDAR days in the reader's timezone, derived here rather than sent.
  // The back end used to send elapsed 24-hour blocks, so a message from
  // 14:00 yesterday floored to 0 and rendered "today" all night.
  const lastDays = daysSince(row.lastSeenAt, now);
  if (row.last90dMessages === 0) {
    return lastDays >= 90 ? `${lastDays}d` : '90d+';
  }
  if (lastDays === 0) return 'today';
  if (lastDays === 1) return '1d';
  return `${lastDays}d`;
}

/** Compact "12.4k" formatter — matches senders/data.ts:fmtCompact. */
export function fmtCompact(n: number): string {
  if (n < 1000) return n.toLocaleString('en-US');
  if (n < 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  if (n < 1_000_000) return Math.round(n / 1000) + 'k';
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
}
