/**
 * Domain owner: ops: WS4.
 *
 * Append new ops events here. Do not rename existing events.
 */
import type { PageSurface } from './vocabulary.js';

export const OPS_EVENT_NAMES = [
  'sync_started',
  'sync_completed',
  'sync_now_clicked',
  'web_vital_reported',
] as const;

export type OpsEventName = (typeof OPS_EVENT_NAMES)[number];

/**
 * Consent-gated PostHog super-properties. Not event names: do not append
 * these to `OPS_EVENT_NAMES`.
 */
export const OPS_SUPER_PROPERTIES = ['display_mode'] as const;

export interface OpsEventPayloads {
  /**
   * Both sync events are emitted ONLY from the browser. Call sites:
   * the onboarding/secondary-connect gate (`useSyncGateFunnel`), the
   * in-app mailbox-readiness observer (same transitions as the D116
   * ready toast), and `last_synced_at` advances on an already-ready
   * mailbox (incremental / Sync-now). Session pairing dedupes overlapping
   * observers. There is no server-side emitter and one is not permitted:
   * analytics consent (D147) is per-browser localStorage that a worker
   * cannot read, and we publish that PostHog runs only after the user
   * accepts. See `docs/observability/event-taxonomy.md` and F004.
   *
   * Per-run counts (`messagesSynced`, stage timings) still live in
   * `sync_runs` / `worker.succeeded`, not here — the poll has none.
   */
  sync_started: {
    /**
     * Always `null`. The D224 status poll carries no sync id, and no
     * `syncs` table exists for one to reference.
     */
    sync_id: null;
    mailbox_id: string;
    trigger: 'initial' | 'manual' | 'pubsub' | 'cron';
  };

  sync_completed: {
    /** Always `null` — see `sync_started.sync_id`. */
    sync_id: null;
    mailbox_id: string;
    /** Always -1: the D224 status poll carries no counts. */
    messages_indexed: number;
    /**
     * Wall-clock ms of the OBSERVED wait (first in-progress poll →
     * terminal). NOT the server-side sync duration, which this emitter
     * cannot see.
     */
    duration_ms: number;
    outcome: 'success' | 'partial' | 'failed';
  };

  sync_now_clicked: {
    mailbox_id: string;
    source: 'app_shell' | 'senders' | 'activity' | 'brief' | 'sender_detail';
  };

  web_vital_reported: {
    /** Bounded route family; raw paths and dynamic identifiers are never sent. */
    surface:
      PageSurface | 'admin_security' | 'admin_acquisition' | 'settings_help' | 'demo' | 'other';
    metric: 'CLS' | 'FCP' | 'INP' | 'LCP' | 'TTFB';
    /** Milliseconds except CLS, which is a unitless score. Rounded to 3 decimals. */
    value: number;
    rating: 'good' | 'needs_improvement' | 'poor' | 'unknown';
    navigation_type:
      | 'navigate'
      | 'reload'
      | 'back_forward'
      | 'back_forward_cache'
      | 'prerender'
      | 'restore'
      | 'unknown';
  };
}
