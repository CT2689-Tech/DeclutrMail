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
 * The ONLY event names any server-side code may send to PostHog.
 *
 * This is a consent gate expressed in the type system, not an approval
 * list. Analytics consent (D147) is per-browser `localStorage` with
 * decline as the default and is deliberately never synced to the user
 * record, so no server process can read it — and we publish that PostHog
 * "is initialized only after you accept it" and that Essential-only
 * "stops analytics immediately". Anything emitted from here therefore
 * reaches PostHog for people who refused it, and anonymising the payload
 * does not help: the promise is that PostHog does not RUN.
 *
 * So ADDING A NAME HERE IS A PRIVACY DECISION, not a typing chore. A
 * server-side sync event was written and removed for exactly this reason.
 * F004 in FINDINGS.md carries the open question of whether even the two
 * below should remain — they are listed because they ship today, not
 * because they have been cleared.
 *
 * The union is what makes that reviewable: without it this parameter is a
 * bare `string`, and a new server-side emitter is one call away with
 * nothing to stop or even flag it.
 */
export const SERVER_EMITTABLE_EVENTS = ['email.delivered', 'email.bounced'] as const;
export type ServerEmittableEvent = (typeof SERVER_EMITTABLE_EVENTS)[number];

export function captureServerEvent(
  event: ServerEmittableEvent,
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
