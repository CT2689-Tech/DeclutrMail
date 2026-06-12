/**
 * TanStack Query keys for the Quiet surface (D200).
 *
 * Quiet-hours config is PER MAILBOX (D95), so the key is parameterised
 * by mailbox id — the screen renders one card per connected mailbox,
 * each backed by its own query.
 */

export const quietKeys = {
  all: ['quiet'] as const,
  /** One mailbox's quiet-hours config + activeNow. */
  hours: (mailboxId: string) => ['quiet', 'hours', mailboxId] as const,
};
