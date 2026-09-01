// @declutrmail/shared/actions — reconciling the two populations every
// action preview puts on screen at once.
//
// A sender surface shows numbers from two ORTHOGONAL scopes:
//
//   - volume-scoped   — `monthlyVolume` (arrivals in the last 90 days,
//                       ANY label — the engine's window, ADR-0037) and
//                       `totalReceived` (messages RECEIVED
//                       from this sender, ANY label, within retention —
//                       NOT a lifetime total: it is recounted from
//                       `mail_messages` nightly, so deleted mail leaves
//                       it. ADR-0014 §Neutral mandates the word
//                       "received", never "all-time"; findings doc 7).
//   - state-scoped    — the composite preview buckets, which count mail
//                       CURRENTLY carrying `INBOX` (`senderInboxActionWhere`,
//                       @declutrmail/db). What a verb can actually move.
//
// They are independent: a sender can mail 71 times a month and have zero
// inbox mail. Both numbers are true, and NOTHING here explains why they
// differ — a Gmail filter with "Skip the Inbox" produces exactly this
// shape without a single message ever reaching the inbox. Rendered adjacently with no scope named, the reader
// infers a shared denominator that does not exist and reads a correct
// preview as a broken one (founder report 2026-07-27:
// "Shows 71/mo. Then below 'How far back', everything says 0").
//
// This module turns that silence into a sentence. It states no fact the
// caller did not pass in — an unknown arrival count is omitted, never
// coerced to 0 (the null-collapsed-to-sentinel shape this codebase keeps
// relearning). See `docs/execution/action-surface-findings-2026-07-26.md`
// finding 5.14 and systemic cause 5.

/**
 * Default time-window for Delete (spec v1.2 Decision 15): "6 months+",
 * the one primary verb whose default is a safer, narrower scope rather
 * than the whole inbox. Single source of truth — every Delete surface
 * (the senders confirm modal, the Screener decide preview) applies this
 * same default so the two cannot drift out of sync on what "Delete"
 * does when nobody has touched a window control (QA-delete-20260829-01,
 * 2026-08-30: Screener had no default at all, so identical fresh mail
 * was dead-on-open through Senders and friction-free through Screener).
 */
export const DEFAULT_DELETE_WINDOW_DAYS = 180;

/**
 * Which reconciliation, if any, the preview owes the reader. `none` is
 * the common case — the selected window matches mail, so the count
 * speaks for itself.
 */
export type InboxScopeNotice =
  | { kind: 'none' }
  /** No mail from this sender is in the inbox at all — no window helps. */
  | { kind: 'empty-inbox'; recentArrivals: number | null }
  /** The inbox has mail from this sender; THIS window excludes all of it. */
  | { kind: 'empty-window'; inboxTotal: number; olderThanDays: number };

export interface InboxScopeInput {
  /** Un-windowed INBOX-now count (`counts.all`). `undefined` = not resolved. */
  inboxTotal: number | undefined;
  /** INBOX-now count under the selected window. `undefined` = not resolved. */
  windowCount: number | undefined;
  /** Selected time window; `null` = no window (acts on the whole inbox). */
  olderThanDays: number | null;
  /**
   * Arrival-scoped 90-day volume — the senders list row's
   * `monthlyVolume` (ADR-0037), so this clause names the SAME window the
   * surface shows beside it. It was 30 days while every card said "N in
   * last 90d", which is how one sender read "396 in last 90d" and
   * "134 /mo" a click apart (founder report 2026-08-21). `null` when the
   * caller does not know it — the copy then omits the clause rather than
   * claiming zero.
   */
  recentArrivals: number | null;
}

/**
 * Classify the gap between what the sender sends and what the verb can
 * move. Silent unless the selected window matched nothing — a preview
 * that explains a non-zero count is just noise.
 */
export function describeInboxScope(input: InboxScopeInput): InboxScopeNotice {
  const { inboxTotal, windowCount, olderThanDays, recentArrivals } = input;
  // Nothing to reconcile until the live preview resolves. Fail silent,
  // never speculative: D226's whole point is that the preview states
  // what IS, and "not yet known" is not a story about the inbox.
  if (inboxTotal === undefined || windowCount === undefined) return { kind: 'none' };
  if (windowCount > 0) return { kind: 'none' };
  // Empty window is only a distinct story when a window is actually
  // narrowing something. With `olderThanDays === null` the window count
  // IS the inbox total, so a zero can only mean an empty inbox.
  if (inboxTotal > 0 && olderThanDays !== null) {
    return { kind: 'empty-window', inboxTotal, olderThanDays };
  }
  return { kind: 'empty-inbox', recentArrivals };
}

/**
 * Explain a window chip row whose buckets are TIED — e.g. github.com
 * rendering `All inbox 2,908 · 30 days+ 2,908 · 3 months+ 2,908 ·
 * 6 months+ 2,908 · 1 year+ 59`. Four identical chips read as a broken
 * control; the real reason is that the sender's newest inbox message is
 * older than those windows, so none of them excludes anything.
 *
 * Deliberately EXPLAINS rather than collapses. Merging the tied chips
 * would look tidier and would be wrong: the windows are only equal
 * *right now*. Gmail is re-resolved at execution (the panel says so), so
 * "All inbox" and "6 months+" can diverge between preview and run, and
 * silently substituting one for the other would broaden a destructive
 * action beyond what the user picked.
 *
 * Returns `null` unless at least two windows tie — a chip row where every
 * step actually narrows something needs no explanation.
 */
export function tiedWindowNoticeCopy(
  counts: readonly { label: string; count: number | undefined }[],
  newestInboxDays: number | null,
  // Codex round-1 review of QA-senders-20260901-06: the caller passes
  // `newestInboxDays: null` for every bulk preview (a per-sender age has
  // no single value across senders), which always fell through to a
  // hardcoded singular "This sender has nothing newer" — false for a
  // 5-sender tied row. Mirrors `inboxScopeNoticeCopy`'s subject param.
  subject: 'this sender' | 'these senders' = 'this sender',
): string | null {
  const known = counts.filter(
    (c): c is { label: string; count: number } => typeof c.count === 'number',
  );
  if (known.length < 2) return null;
  const top = known[0]!;
  // Only a tie that STARTS at the widest window is worth explaining —
  // that is the "nothing is new enough to exclude" shape.
  const tied = known.filter((c) => c.count === top.count);
  if (tied.length < 2 || top.count === 0) return null;
  const widest = tied[tied.length - 1]!;
  // QA-senders-20260901-06: same two facts (the tie's cause, and its
  // extent), 13 words instead of 24 — lead with the cause.
  const ageLead =
    newestInboxDays === null
      ? subject === 'this sender'
        ? 'This sender has nothing newer'
        : 'These senders have nothing newer'
      : `Nothing newer than ${newestInboxDays.toLocaleString('en-US')} day${newestInboxDays === 1 ? '' : 's'}`;
  return `${ageLead}, so every window through ${widest.label} matches the same ${top.count.toLocaleString('en-US')}.`;
}

/**
 * Render a notice as one sentence, or `null` when there is nothing to
 * say. `verbLabel` is the canonical K/A/U/L/D display label (CLAUDE.md
 * §2.2) so the copy names the verb the reader is about to confirm —
 * which on a composite is the SECONDARY, not the primary. `subject`
 * pluralizes for a bulk request; "this sender" would be false copy on a
 * sheet covering twelve of them.
 */
export function inboxScopeNoticeCopy(
  notice: InboxScopeNotice,
  verbLabel: string,
  subject: 'this sender' | 'these senders' = 'this sender',
  options: {
    /**
     * ADR-0028 — set when the surface offers a reach control that lets
     * this verb act beyond the inbox. The tail then says "by default"
     * instead of "only": "Delete only acts on mail still in the inbox"
     * is FALSE one sentence before "Switch to Inbox + archived…"
     * (design-system gate, 2026-07-28). Both Delete surfaces — the
     * senders confirm modal and the Screener decide preview — now carry
     * the reach chips and pass this; a surface with no reach control
     * omits it and keeps the absolute wording, which is true there.
     */
    verbActsBeyondInbox?: boolean;
  } = {},
): string | null {
  if (notice.kind === 'none') return null;

  if (notice.kind === 'empty-inbox') {
    const opener = `Nothing from ${subject} is in your inbox right now.`;
    const tail = options.verbActsBeyondInbox
      ? `${verbLabel} acts on inbox email by default.`
      : `${verbLabel} only acts on email still in the inbox.`;
    // Only name arrivals we were actually given a number for.
    if (notice.recentArrivals === null || notice.recentArrivals === 0) {
      return `${opener} ${tail}`;
    }
    // States the two OBSERVED facts and no transition between them.
    //
    // Earlier drafts said the arrivals were "already archived or deleted"
    // and then "already moved out of it". Both are unprovable: DeclutrMail
    // stores only the CURRENT `label_ids` — `mail_messages` has no label
    // history column — so it cannot know a message was ever in the inbox,
    // let alone what moved it. A Gmail filter with "Skip the Inbox"
    // yields arrivals > 0 and INBOX = 0 with no transition at all, and
    // that is the actual cause on the sender that prompted this work
    // (`ealerts.bankofamerica.com`: 71 arrivals, 71/71 still UNREAD under
    // a custom label, never in the inbox — so "you archived these" would
    // have been flatly wrong). Measured the same day: of 2,025 recent
    // non-INBOX messages, 19 were SPAM and 1 TRASH.
    //
    // "though" carries the tension the reader needs without asserting a
    // cause, a destination, or a history.
    const arrivals = `${notice.recentArrivals.toLocaleString('en-US')} arrived in the last 90 days`;
    return `${opener.replace(/\.$/, '')} — though ${arrivals}. ${tail}`;
  }

  const { inboxTotal, olderThanDays } = notice;
  const one = inboxTotal === 1;
  // Name the SAME unit the window control itself is labelled in — every
  // reach surface that offers this window (`confirm-action-modal.tsx`'s
  // `TIME_WINDOW_PRESETS`) uses these four calendar-ish buckets, never a
  // raw day count. A day figure next to a chip that reads "6 months+" is a
  // unit mismatch the reader has to translate themselves; falls back to a
  // day count only for a value outside the known presets.
  const presetLabel = WINDOW_PRESET_LABELS[olderThanDays];
  const threshold =
    presetLabel !== undefined
      ? `the ${presetLabel} window`
      : `${olderThanDays.toLocaleString('en-US')} day${olderThanDays === 1 ? '' : 's'}`;
  return (
    `${inboxTotal.toLocaleString('en-US')} email${one ? '' : 's'} from ${subject} ${one ? 'is' : 'are'} in your inbox, ` +
    `but ${one ? `it is not older than ${threshold}` : `none are older than ${threshold}`}. ` +
    `Widen the window to include ${one ? 'it' : 'them'}.`
  );
}

/** Day-count → the same preset label every window chip renders for it. */
export const WINDOW_PRESET_LABELS: Record<number, string> = {
  30: '30 days+',
  90: '3 months+',
  180: '6 months+',
  365: '1 year+',
};

/**
 * The two populations of a sender's mail, side by side: what is in the
 * inbox now, and what the mailbox holds for them everywhere else.
 *
 * Both counts come from ONE `GET /api/actions/preview` response — the
 * `inbox_only` and `all_mail` reaches of the same predicate family
 * (`senderActionWhere`, @declutrmail/db), resolved concurrently against
 * the same snapshot. Nothing here is derived from a second source, so
 * the two numbers cannot drift the way the context strip's
 * arrival-scoped figures can.
 *
 * Why every verb and not just Delete: the reach CHIPS are Delete-only
 * (ADR-0028 — only Delete may act past the inbox), but "where is my
 * mail?" is a question every preview provokes and only Delete's chips
 * happened to answer. A Later preview reading "0 emails currently
 * match" beside a strip reading "200 in last 90d · 6,668 received"
 * sent the founder to Gmail to find out that all of it sits under a
 * label (2026-08-25). Stating the split is a fact, not a widening: it
 * does not give Later a reach it must never have — Later on 6,275
 * archived emails would resurface every one of them at wake time.
 */
export interface MailLocationInput {
  /** Un-windowed INBOX-now count (`counts.all`). `undefined` = not resolved. */
  inboxNow: number | undefined;
  /**
   * Un-windowed all-mail count (`allMail.counts.all`) — everything the
   * mailbox holds for this sender except Trash, Spam, Drafts and Chat
   * (`ALL_MAIL_EXCLUDED_LABELS`). `undefined` against an API predating
   * the field, which is why the copy is omitted rather than guessed.
   */
  allMailNow: number | undefined;
  /**
   * `senders.total_received` — the figure the surface already prints as
   * "N received". Any-label, within retention, so it INCLUDES the Trash
   * and Spam that `allMailNow` excludes; the difference is the third
   * population and the reason the header's number is larger. `null` when
   * the caller has not got it, and the clause is then omitted.
   *
   * Safe to subtract only because both sides are counts of the same
   * `mail_messages` rows written in the same transactions — the sender
   * upsert and the message insert are atomic on both sync paths — so the
   * two differ by the label predicate and nothing else. ADR-0014
   * §Neutral mandates the word "received", never "all-time".
   */
  receivedTotal: number | null;
}

/**
 * One sentence placing the sender's mail, or `null` when there is
 * nothing to place.
 *
 * Reads as a partition that sums to the "N received" already on screen:
 * `0 emails in your inbox · 6,275 elsewhere in Gmail · 393 in Trash or Spam`.
 * That closure is the point — the founder's report was three true
 * numbers on one card with no visible denominator between them.
 *
 * "elsewhere in Gmail" and not "archived": `mail_messages` stores only
 * CURRENT `label_ids` and has no label history, so the only provable
 * claim is that these messages do not carry INBOX right now — never
 * that anyone archived them. Same reason `inboxScopeNoticeCopy` refuses
 * to say "you already archived these".
 */
export function mailLocationCopy(input: MailLocationInput): string | null {
  const { inboxNow, allMailNow, receivedTotal } = input;
  // Fail silent until BOTH reaches have resolved — half the split is
  // not a location, it is a number with an implied denominator, which
  // is the exact reading failure this module exists to stop.
  if (inboxNow === undefined || allMailNow === undefined) return null;
  if (allMailNow === 0) return null;
  const n = (v: number) => v.toLocaleString('en-US');
  const plural = (v: number) => (v === 1 ? 'email' : 'emails');
  // `all_mail` is a superset of `inbox_only` by construction, and
  // `total_received` a superset of both. Clamp anyway: a negative
  // segment would be a nonsense number rendered with total confidence,
  // and clamping degrades to "omitted", which is merely uninformative.
  const elsewhere = Math.max(0, allMailNow - inboxNow);
  const binned = receivedTotal === null ? 0 : Math.max(0, receivedTotal - allMailNow);
  const parts = [`${n(inboxNow)} ${plural(inboxNow)} in your inbox`];
  if (elsewhere > 0) {
    parts.push(
      `${n(elsewhere)} ${plural(elsewhere)} elsewhere in Gmail (archived or under a label)`,
    );
  }
  // Named only when it exists. A "0 in Trash or Spam" segment is a fact
  // nobody asked for, and printing the gap when there is none is how a
  // reconciliation turns back into noise.
  if (binned > 0) {
    parts.push(`${n(binned)} ${plural(binned)} in Trash or Spam`);
  }
  // QA-senders-20260901-06: a single part has nothing to reconcile — it
  // just restates the headline count two lines above it. Say nothing,
  // the same way an unresolved reach or a genuinely empty mailbox does
  // above, rather than dressing up "no gap" as a sentence.
  if (parts.length === 1) return null;
  return `Where this sender's mail is now: ${parts.join(' \u00b7 ')}.`;
}
