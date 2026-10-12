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

const celebrationKey = (mailboxId: string) => `dm-inbox-report-celebration:${mailboxId}`;

export function readReportCelebration(
  mailboxId: string,
): { archived: number; senders: number } | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(celebrationKey(mailboxId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { archived?: unknown; senders?: unknown };
    if (typeof parsed.archived !== 'number' || typeof parsed.senders !== 'number') return null;
    return { archived: parsed.archived, senders: parsed.senders };
  } catch {
    return null;
  }
}

export function writeReportCelebration(
  mailboxId: string,
  celebration: { archived: number; senders: number },
): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(celebrationKey(mailboxId), JSON.stringify(celebration));
}
