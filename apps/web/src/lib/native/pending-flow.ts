// The one native sign-in or connect flow this app started and is waiting on.
//
// The system browser hands control back through a custom-scheme link that any
// installed app or web page can fire, so a return is honored only while a flow
// that this app started is pending. Stored in localStorage rather than memory
// because the OS may reclaim the WebView while the browser sheet is up; the
// verifier has to survive that to redeem the code on the way back.

const KEY = 'dm.native.pending';
/** Consent is bounded server-side at ten minutes; a pending flow is no older. */
const MAX_AGE_MS = 10 * 60 * 1000;

export type PendingFlow =
  { kind: 'signin'; verifier: string; startedAt: number } | { kind: 'connect'; startedAt: number };

export function savePending(flow: PendingFlow): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(flow));
  } catch {
    // Storage blocked or full: the flow cannot complete a return, and the
    // caller has already been told by the missing pending read below.
  }
}

/** The pending flow, or null when there is none, it is stale, or it is unreadable. */
export function readPending(now = Date.now()): PendingFlow | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<PendingFlow> | null;
    if (
      !parsed ||
      typeof parsed.startedAt !== 'number' ||
      now - parsed.startedAt > MAX_AGE_MS ||
      parsed.startedAt > now + 60_000
    ) {
      return null;
    }
    if (parsed.kind === 'connect') return { kind: 'connect', startedAt: parsed.startedAt };
    if (parsed.kind === 'signin' && typeof parsed.verifier === 'string') {
      return { kind: 'signin', verifier: parsed.verifier, startedAt: parsed.startedAt };
    }
    return null;
  } catch {
    return null;
  }
}

export function clearPending(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing stored that could be cleared.
  }
}
