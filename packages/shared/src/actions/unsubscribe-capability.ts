// @declutrmail/shared/actions — unsubscribe capability partition (D248).
//
// `senders.unsubscribe_method` is NULLABLE. NULL does NOT mean "this
// sender has no unsubscribe option" — it means the sender index has not
// derived one yet. The index writes `'none'` explicitly once it has
// looked and found no List-Unsubscribe header, so the two facts are
// distinguishable in the column and MUST stay distinguishable in every
// surface that reads it. Collapsing NULL into `'none'` asserts we looked
// when we did not; this module exists so no caller has to re-derive that
// rule (and so none can get it wrong again).

/**
 * The four states a sender's unsubscribe capability can be in.
 *
 *   - `one_click` — a supported RFC 8058 endpoint; DeclutrMail can send it.
 *   - `mailto`    — an opt-out address; the USER sends it (D230).
 *   - `none`      — checked, and the sender publishes no unsubscribe.
 *   - `unknown`   — not checked yet. Not the same fact as `none`.
 */
export const UNSUBSCRIBE_CAPABILITIES = ['one_click', 'mailto', 'none', 'unknown'] as const;
export type UnsubscribeCapability = (typeof UNSUBSCRIBE_CAPABILITIES)[number];

/** The nullable column shape as it arrives from the DB / the wire. */
export type StoredUnsubscribeMethod = 'one_click' | 'mailto' | 'none' | null;

/**
 * `senders.unsubscribe_method` → capability. The ONLY sanctioned way to
 * read the column: `undefined` (field absent on an older wire row) and
 * `null` (not derived) both resolve to `unknown`, never to `none`.
 */
export function unsubscribeCapabilityOf(
  method: StoredUnsubscribeMethod | undefined,
): UnsubscribeCapability {
  return method ?? 'unknown';
}

/** Only a one-click sender can be unsubscribed by DeclutrMail itself. */
export function isExecutableUnsubscribe(method: StoredUnsubscribeMethod | undefined): boolean {
  return unsubscribeCapabilityOf(method) === 'one_click';
}

export type UnsubscribeCapabilityCounts = Readonly<Record<UnsubscribeCapability, number>>;

/** Partition a selection over the four states. */
export function countUnsubscribeCapabilities(
  methods: ReadonlyArray<StoredUnsubscribeMethod | undefined>,
): UnsubscribeCapabilityCounts {
  const counts = { one_click: 0, mailto: 0, none: 0, unknown: 0 };
  for (const method of methods) {
    counts[unsubscribeCapabilityOf(method)] += 1;
  }
  return counts;
}

/**
 * Per-state preview lines — NEVER one aggregate number (D248). A single
 * figure spanning the four groups would claim an outcome the product
 * achieves for only one of them. Empty groups are omitted.
 */
export function unsubscribeCapabilityBreakdown(counts: UnsubscribeCapabilityCounts): string[] {
  const lines: string[] = [];
  if (counts.one_click > 0) {
    lines.push(`${senders(counts.one_click)} we can unsubscribe for you`);
  }
  if (counts.mailto > 0) {
    const n = counts.mailto;
    lines.push(`${senders(n)} ${n === 1 ? 'needs' : 'need'} an email you send yourself`);
  }
  if (counts.none > 0) {
    const n = counts.none;
    lines.push(`${senders(n)} ${n === 1 ? 'offers' : 'offer'} no unsubscribe`);
  }
  if (counts.unknown > 0) {
    lines.push(`${senders(counts.unknown)} we haven't checked yet`);
  }
  return lines;
}

/**
 * Why a sender cannot be unsubscribed right now, or `null` when it can.
 * Used by every disabled Unsubscribe control so the reason on screen is
 * the reason in the data.
 */
export function unsubscribeUnavailableReason(
  method: StoredUnsubscribeMethod | undefined,
): string | null {
  switch (unsubscribeCapabilityOf(method)) {
    case 'one_click':
    case 'mailto':
      return null;
    case 'none':
      return 'No unsubscribe channel found — Archive handles senders like this.';
    case 'unknown':
      return "We haven't checked this sender for an unsubscribe option yet — Archive works in the meantime.";
  }
}

/**
 * The three terminal outcomes `UnsubExecutionWorker` writes for a
 * one-click request. `unconfirmed` is its own outcome on purpose:
 * rounding it into accepted or failed is the same unknown-as-fact
 * substitution the `unknown` capability above exists to prevent.
 */
export const UNSUBSCRIBE_REQUEST_OUTCOMES = ['endpointAccepted', 'unconfirmed', 'failed'] as const;
export type UnsubscribeRequestOutcome = (typeof UNSUBSCRIBE_REQUEST_OUTCOMES)[number];

export type UnsubscribeOutcomeCounts = Readonly<Record<UnsubscribeRequestOutcome, number>>;

/**
 * Per-outcome receipt lines. "Accepted" is deliberate: a 2xx proves the
 * sender's endpoint took the request, not that the mail stops — so the
 * copy never says "unsubscribed".
 */
export function unsubscribeOutcomeBreakdown(counts: UnsubscribeOutcomeCounts): string[] {
  const lines: string[] = [];
  if (counts.endpointAccepted > 0) {
    lines.push(`${requests(counts.endpointAccepted)} accepted`);
  }
  if (counts.unconfirmed > 0) {
    lines.push(
      `${requests(counts.unconfirmed)} sent, ${counts.unconfirmed === 1 ? 'result' : 'results'} unconfirmed`,
    );
  }
  if (counts.failed > 0) {
    lines.push(`${requests(counts.failed)} failed`);
  }
  return lines;
}

/** The standing caveat that makes "accepted" mean what it means. */
export const UNSUBSCRIBE_ACCEPTED_CAVEAT =
  'Accepted means the sender took the request. Whether their email stops is up to them.';

function senders(n: number): string {
  return `${n} sender${n === 1 ? '' : 's'}`;
}

function requests(n: number): string {
  return `${n} request${n === 1 ? '' : 's'}`;
}
