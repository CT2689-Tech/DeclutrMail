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
  const age =
    newestInboxDays === null
      ? 'this sender has nothing newer'
      : `this sender's newest inbox email is ${newestInboxDays.toLocaleString('en-US')} day${newestInboxDays === 1 ? '' : 's'} old`;
  return `Every window through ${widest.label} matches the same ${top.count.toLocaleString('en-US')} — ${age}, so those windows exclude nothing.`;
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
  const days = `${olderThanDays.toLocaleString('en-US')} day${olderThanDays === 1 ? '' : 's'}`;
  return (
    `${inboxTotal.toLocaleString('en-US')} email${one ? '' : 's'} from ${subject} ${one ? 'is' : 'are'} in your inbox, ` +
    `but ${one ? `it is not older than ${days}` : `none are older than ${days}`}. ` +
    `Widen the window to include ${one ? 'it' : 'them'}.`
  );
}
