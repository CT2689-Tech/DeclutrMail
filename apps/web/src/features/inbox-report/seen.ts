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
  /** Move job whose Activity row can carry an undo token. */
  actionId?: string;
  /** Which status route `actionId` belongs to. */
  actionHandle?: 'action' | 'batch';
  /**
   * Fix-set sender ids this result closed. Absent on rows stored before
   * the field existed; those stay until Undo clears them.
   */
  senderKeys?: string[];
  /** `generatedAt` of the report this result was confirmed against. */
  fixGeneratedAt?: string;
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
      actionId?: unknown;
      actionHandle?: unknown;
      senderKeys?: unknown;
      fixGeneratedAt?: unknown;
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
    const actionId =
      typeof parsed.actionId === 'string' && parsed.actionId !== '' ? parsed.actionId : undefined;
    const actionHandle =
      parsed.actionHandle === 'action' || parsed.actionHandle === 'batch'
        ? parsed.actionHandle
        : undefined;
    const senderKeys = Array.isArray(parsed.senderKeys)
      ? parsed.senderKeys.filter((id): id is string => typeof id === 'string' && id !== '')
      : undefined;
    const fixGeneratedAt =
      typeof parsed.fixGeneratedAt === 'string' && parsed.fixGeneratedAt !== ''
        ? parsed.fixGeneratedAt
        : undefined;
    return {
      archived: parsed.archived,
      senders: parsed.senders,
      verb,
      ...(bytes !== undefined ? { bytes } : {}),
      ...(requested !== undefined ? { requested } : {}),
      ...(manual !== undefined ? { manual } : {}),
      ...(actionId !== undefined && actionHandle !== undefined ? { actionId, actionHandle } : {}),
      ...(senderKeys !== undefined && senderKeys.length > 0 ? { senderKeys } : {}),
      ...(fixGeneratedAt !== undefined ? { fixGeneratedAt } : {}),
    };
  } catch {
    return null;
  }
}

export function writeReportCelebration(mailboxId: string, celebration: ReportCelebration): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(celebrationKey(mailboxId), JSON.stringify(celebration));
}

/** Drop the stored result. The banner lives in localStorage; the same key is removed from sessionStorage. */
export function clearReportCelebration(mailboxId: string): void {
  const key = celebrationKey(mailboxId);
  if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
  if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(key);
}

/**
 * A stored result still describes this report when it recorded no fix set,
 * when this is the snapshot it was confirmed against, or when every sender
 * it closed is still out of the fix set. A later report that lists one of
 * those senders again does not match.
 */
export function reportCelebrationMatchesFix(
  celebration: ReportCelebration,
  fix: { senderKeys: readonly string[]; generatedAt: string },
): boolean {
  const stored = celebration.senderKeys;
  if (stored === undefined || stored.length === 0) return true;
  if (celebration.fixGeneratedAt !== undefined && celebration.fixGeneratedAt === fix.generatedAt) {
    return true;
  }
  const open = new Set(fix.senderKeys);
  return stored.every((id) => !open.has(id));
}
