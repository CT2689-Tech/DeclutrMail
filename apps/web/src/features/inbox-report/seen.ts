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

/** Stored after a report Fix. Older builds omitted `verb`; those are archive. */
export interface ReportCelebration {
  archived: number;
  senders: number;
  /** Missing on values stored before the verb was persisted. Those are archive. */
  verb?: 'archive' | 'delete' | 'unsub_only';
  /** Gmail size-estimate sum for a Delete. Absent for archive and older rows. */
  bytes?: number;
  /** One-click requests in this confirmation. */
  requested?: number;
  /** Mailto senders who still need to press Send. */
  manual?: number;
}

export function readReportCelebration(mailboxId: string): ReportCelebration | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(celebrationKey(mailboxId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      archived?: unknown;
      senders?: unknown;
      verb?: unknown;
      bytes?: unknown;
      requested?: unknown;
      manual?: unknown;
    };
    if (typeof parsed.archived !== 'number' || typeof parsed.senders !== 'number') return null;
    const bytes =
      typeof parsed.bytes === 'number' && Number.isFinite(parsed.bytes) && parsed.bytes >= 0
        ? parsed.bytes
        : undefined;
    const requested =
      typeof parsed.requested === 'number' && parsed.requested >= 0 ? parsed.requested : undefined;
    const manual =
      typeof parsed.manual === 'number' && parsed.manual >= 0 ? parsed.manual : undefined;
    const verb =
      parsed.verb === 'delete' || parsed.verb === 'unsub_only' || parsed.verb === 'archive'
        ? parsed.verb
        : 'archive';
    return {
      archived: parsed.archived,
      senders: parsed.senders,
      verb,
      ...(bytes !== undefined ? { bytes } : {}),
      ...(requested !== undefined ? { requested } : {}),
      ...(manual !== undefined ? { manual } : {}),
    };
  } catch {
    return null;
  }
}

export function writeReportCelebration(mailboxId: string, celebration: ReportCelebration): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(celebrationKey(mailboxId), JSON.stringify(celebration));
}
