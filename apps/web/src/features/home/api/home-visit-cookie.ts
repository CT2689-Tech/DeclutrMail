const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Device visit id, mailbox-scoped so a switch does not reuse the previous window. */
export const HOME_VISIT_COOKIE = 'dm_home_visit';

const IDLE_SEC = 30 * 60;

function visitCookieValue(mailboxId: string, visitId: string): string {
  return `${mailboxId}:${visitId}`;
}

export function readHomeVisitCookie(cookieHeader: string, mailboxId: string): string | null {
  const target = `${HOME_VISIT_COOKIE}=`;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(target)) continue;
    const value = decodeURIComponent(trimmed.slice(target.length));
    const sep = value.lastIndexOf(':');
    if (sep <= 0) return null;
    const scopedMailbox = value.slice(0, sep);
    const visitId = value.slice(sep + 1);
    if (scopedMailbox !== mailboxId || !UUID.test(visitId)) return null;
    return visitId;
  }
  return null;
}

export function writeHomeVisitCookie(mailboxId: string, visitId: string): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${HOME_VISIT_COOKIE}=${encodeURIComponent(visitCookieValue(mailboxId, visitId))}; Path=/; Max-Age=${IDLE_SEC}; SameSite=Lax`;
}
