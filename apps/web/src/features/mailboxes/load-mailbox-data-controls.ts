/**
 * The mailbox data dialog's code, fetched on demand. The account menu
 * starts it as soon as the menu opens — so "Manage connection and data"
 * does not stall on a slow connection — and renders the dialog through
 * `next/dynamic` with this same import.
 */
export function loadMailboxDataControls() {
  return import('./mailbox-data-controls-dialog');
}
