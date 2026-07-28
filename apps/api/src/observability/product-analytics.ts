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

export function captureServerEvent(
  event: string,
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
