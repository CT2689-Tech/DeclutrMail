import { PostHog } from 'posthog-node';

/**
 * Server-side product analytics (D159, D126 Part 1).
 *
 * Fail-OPEN, unlike EmailService: a telemetry outage must never take
 * down a webhook or a request path. Every failure is swallowed after a
 * console warning.
 *
 * Privacy (D7): callers pass counts, kinds and outcomes. Never a
 * recipient address, never message content. The `distinctId` is the
 * internal user id where one is known, never an email address.
 */
let client: PostHog | null = null;
let initialised = false;

function resolve(): PostHog | null {
  if (initialised) return client;
  initialised = true;
  const key = process.env.POSTHOG_API_KEY;
  if (!key) {
    console.warn(JSON.stringify({ level: 'warn', kind: 'analytics.disabled_no_key' }));
    return (client = null);
  }
  client = new PostHog(key, {
    host: process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com',
    flushAt: 1,
    flushInterval: 0,
  });
  return client;
}

/** Test seam — bypasses env resolution. */
export function __setClientForTest(next: PostHog | null): void {
  client = next;
  initialised = true;
}

/**
 * The server-side PostHog calls that ALREADY EXIST, frozen so no more can
 * be added. **This is a debt list, not an allowlist.**
 *
 * The rule is that server-side code emits to PostHog NOT AT ALL. Analytics
 * consent (D147) is per-browser `localStorage` with decline as the default
 * and is deliberately never synced to the user record, so no server
 * process can read it — and we publish that PostHog "is initialized only
 * after you accept it" and that Essential-only "stops analytics
 * immediately". Anything sent from here reaches PostHog for people who
 * refused it, and anonymising the payload does not help: the promise is
 * that PostHog does not RUN.
 *
 * The two names below are therefore an OPEN VIOLATION of that rule, not an
 * exception carved out of it. They predate this reading and they still
 * ship; removing them changes live behaviour on a published-policy
 * question, which is the founder's call, so F004 in FINDINGS.md tracks
 * them. Anyone reading this type should expect the list to shrink to
 * empty, never to grow.
 *
 * Freezing it is what makes the debt bounded. Without the union this
 * parameter is a bare `string` and a third violation is one call away with
 * nothing to stop or even flag it — which is exactly how a server-side
 * sync event got written here before being removed.
 */
export const UNREMEDIATED_SERVER_EVENTS = ['email.delivered', 'email.bounced'] as const;
export type UnremediatedServerEvent = (typeof UNREMEDIATED_SERVER_EVENTS)[number];

export function captureServerEvent(
  event: UnremediatedServerEvent,
  properties: Record<string, unknown>,
  distinctId = 'server',
): void {
  try {
    resolve()?.capture({ distinctId, event, properties });
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        kind: 'analytics.capture_failed',
        event,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

/** Flush on shutdown so short-lived processes don't drop events. */
export async function shutdownAnalytics(): Promise<void> {
  try {
    await client?.shutdown();
  } catch {
    // Shutdown failures are not worth surfacing.
  }
}
