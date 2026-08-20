// Third-party inbox sweepers that mark mail READ on the user's behalf.
//
// WHY THIS EXISTS. Gmail exposes exactly one engagement bit — the absence
// of the `UNREAD` label — and any tool with API access can write it. On
// the founder's mailbox `Unroll.me/Unsubscribed` carries 20,819 of the
// 75,689 messages we count as read: 27.5% of the entire read signal was
// manufactured by a tool the user is not currently using.
//
// DIRECTION OF HARM, STATED PLAINLY. A sweeper only ever marks READ, so
// it INFLATES read rate, which SUPPRESSES unsubscribe recommendations.
// The contaminated signal therefore fails safe — it under-recommends
// cleanup on senders the user actually ignores. Removing the
// contamination is the one change in this workstream that increases
// pressure toward a destructive verb, which is why every affected sender
// must reach it through the normal preview-and-confirm path and none
// through a bulk one.
//
// WHAT THIS IS NOT. Read rate is CONTAMINATED, not fake, so it is
// decontaminated rather than deleted. Deleting it would make unsubscribe
// recommendations more aggressive for every sender at once, which is the
// wrong direction — the brake would come off entirely.
//
// D222: this classifies a LABEL the user's own mailbox carries, by exact
// vendor-name match. It predicts nothing about a message or a sender.
//
// PRIVACY (D7 / D228): vendor names and label-name patterns. No sender
// identity, no message content. Safe in the client bundle.

/** A known sweeper, and how its labels are recognised. */
export interface SweeperVendor {
  /** Stable id, also the value stored in `mailbox_labels.sweeper_vendor`. */
  id: string;
  /** Name shown to the user when disclosing the split. */
  displayName: string;
  /**
   * Label-name prefixes, matched case-insensitively against the full
   * Gmail label name. A prefix matches the label itself and any nested
   * label beneath it (`Unroll.me` also covers `Unroll.me/Unsubscribed`).
   */
  prefixes: readonly string[];
}

/**
 * The maintained list. Deliberately SHORT and exact-prefix: a fuzzy rule
 * here would silently discount read state the user produced themselves,
 * which is the opposite failure and a far worse one — it would push
 * senders the user genuinely reads toward Unsubscribe.
 *
 * Adding a vendor is a product decision, not a config tweak: it changes
 * what the cleanup ranking recommends. The observed one is Unroll.me;
 * the others are its direct competitors, which sweep the same way and
 * label the same way.
 */
export const SWEEPER_VENDORS: readonly SweeperVendor[] = [
  { id: 'unroll_me', displayName: 'Unroll.me', prefixes: ['unroll.me', 'unrollme'] },
  {
    id: 'leave_me_alone',
    displayName: 'Leave Me Alone',
    prefixes: ['leave me alone', 'leavemealone'],
  },
  { id: 'cleanfox', displayName: 'Cleanfox', prefixes: ['cleanfox'] },
  { id: 'clean_email', displayName: 'Clean Email', prefixes: ['clean email', 'cleanemail'] },
];

/**
 * The vendor whose sweeping a Gmail label name indicates, or `null`.
 *
 * Matching is on a `/`-delimited path segment boundary, not a bare
 * `startsWith`: `Unroll.me` and `Unroll.me/Unsubscribed` are the vendor's,
 * while a user's own `Unroll.me notes to self` is not — a label the user
 * created and reads under is theirs, and discounting its read state would
 * be the expensive direction to be wrong in.
 */
export function sweeperVendorForLabel(labelName: string): SweeperVendor | null {
  const name = labelName.trim().toLowerCase();
  for (const vendor of SWEEPER_VENDORS) {
    for (const prefix of vendor.prefixes) {
      if (name === prefix || name.startsWith(`${prefix}/`)) return vendor;
    }
  }
  return null;
}

/** Display name for a stored `sweeper_vendor` id; the id itself if unknown. */
export function sweeperDisplayName(vendorId: string): string {
  return SWEEPER_VENDORS.find((v) => v.id === vendorId)?.displayName ?? vendorId;
}
