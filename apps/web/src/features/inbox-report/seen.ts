const key = (mailboxId: string) => `dm-inbox-report-dismissed:${mailboxId}`;

/** Per-mailbox dismiss flag. The preferences API only accepts known patches. */
export function isReportDismissed(mailboxId: string): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(key(mailboxId)) === '1';
}

export function setReportDismissed(mailboxId: string, dismissed: boolean): void {
  if (typeof localStorage === 'undefined') return;
  if (dismissed) localStorage.setItem(key(mailboxId), '1');
  else localStorage.removeItem(key(mailboxId));
}
