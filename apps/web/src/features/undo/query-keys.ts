/**
 * Mailbox-aware TanStack Query keys for the global undo surface.
 *
 * The root key is the cross-feature invalidation contract: action polling
 * does not need to know which mailbox-specific tray is currently mounted.
 * App chrome supplies the active mailbox id so a switch can never reuse the
 * previous mailbox's cached capabilities while the global cache reset lands.
 */
export const undoKeys = {
  all: ['undo'] as const,
  tray: (mailboxId?: string) => ['undo', 'tray', { mailboxId: mailboxId ?? null }] as const,
};
