import { triageVerdict, type TriageVerdict } from '@declutrmail/db';

import type { CascadeResult, CascadeRuleId } from './score-cascade.js';

/**
 * Reasoning (D24) — human-readable explanation of a `CascadeResult`.
 *
 * The verdict is deterministic (D21 cascade); the reasoning is the only
 * part the LLM touches, and even then in a strictly bounded way:
 *
 *   1. The PROMPT sees only sender metadata + cascade facts (display
 *      name, domain, monthly volume, read rate, Gmail category, the
 *      rule label). NEVER message bodies, NEVER subjects, NEVER
 *      snippets. D7 / D228 / D24 all converge here.
 *
 *   2. On LLM unavailability (no port wired, port throws, port returns
 *      empty), `renderTemplate` is the deterministic fallback — and the
 *      `triage_decisions.generated_by` column records `'template'` so
 *      observability can tell.
 *
 * The template copy follows D24's spec verbatim:
 *
 *     "{name} sends {N}/mo. You open {pct}%. Recommended: {verdict}."
 *
 * For Phase A and Phase B (no scoring) the template degrades gracefully —
 * "{name} sends {N}/mo." is kept and the second clause swaps to the
 * cascade's audit phrase (e.g. "Kept because you've replied to them.").
 */

/**
 * Per-rule audit phrase — the second clause of the template.
 *
 * `satisfies Record<CascadeRuleId, string>` makes the map exhaustive: a
 * new cascade rule added to `CascadeRuleId` without a phrase entry here
 * is a compile error, not a silent fallthrough.
 */
const RULE_PHRASE = {
  protect_user_defined: "Kept because you've marked them as protected.",
  protect_replied: "Protected because you've replied to this sender at least three times.",
  protect_starred: "Protected because you've starred a message from this sender this year.",
  protect_gmail_important:
    'Protected because Gmail marked at least three messages from this sender important this year.',
  replied_at_least_once: "Kept because you've replied to them.",
  gmail_primary: 'Kept because Gmail puts them in your Primary inbox.',
  starred_recently: "Kept because you've starred a message from them this year.",
  high_read_rate: 'Kept because you open more than half of their messages.',
  long_relationship_engaged: 'Kept because of a long, engaged relationship.',
  insufficient_signal: 'Recommended: decide later — not enough signal yet.',
  score_archive: 'Recommended: archive to keep them out of your inbox.',
  score_unsubscribe: 'Recommended: unsubscribe to stop the stream.',
  score_inconclusive: 'Recommended: decide later — signals are mixed.',
  score_no_unsub_channel: 'Recommended: decide later — this sender offers no unsubscribe link.',
  score_quiet_stream:
    'Recommended: decide later — too quiet a stream to be worth unsubscribing from.',
} as const satisfies Record<CascadeRuleId, string>;

/**
 * The verb shown in the "Recommended:" sentence (matches K/A/U/L copy).
 *
 * `satisfies` (instead of `: Record<TriageVerdict, string>`) means a new
 * verdict literal added to the `TriageVerdict` union causes a compile
 * error AT THIS MAP — exhaustiveness is enforced where it matters. D227
 * pins the four verbs (Keep · Archive · Unsubscribe · Later) so this
 * map is the single source of truth for the user-facing label.
 */
export const VERDICT_LABEL = {
  keep: 'Keep',
  archive: 'Archive',
  unsubscribe: 'Unsubscribe',
  later: 'Later',
} as const satisfies Record<TriageVerdict, string>;

/**
 * Render the deterministic template (D24 fallback). Stable, body-free,
 * LLM-free.
 *
 * `displayName` falls back to the bare email's local-part when empty —
 * the prior pattern in `senders.display_name` defaults to `''` for bare
 * addresses, and a missing name in the template reads as a bug to the
 * user.
 */
export function renderTemplate(displayName: string, result: CascadeResult): string {
  const name = displayName.trim() || 'This sender';
  const monthlyVol = result.facts.monthlyVolume;
  const readPct = result.facts.readRatePct;
  // No `??` fallback. Both lookups are total at compile time:
  //   - `RULE_PHRASE` satisfies `Record<CascadeRuleId, string>`
  //   - `VERDICT_LABEL` satisfies `Record<TriageVerdict, string>`
  // A new rule id or verdict is a compile error at the map above, not a
  // runtime fallthrough here.
  const phrase = RULE_PHRASE[result.ruleId];

  // For Phase A "Keep" rules the read% / monthly volume aren't the point
  // — the audit phrase is. The two-clause shape keeps the template
  // recognisable across verdicts ("{name} sends {N}/mo. {phrase}").
  return `${name} sends ${monthlyVol}/mo. You open ${readPct}%. ${phrase}`;
}

/**
 * LLM port (D24) — Haiku for explanation only. The composition root
 * (`apps/api/worker.ts`) wires a real implementation; the worker accepts
 * `undefined` to mean "no LLM available; always use the template."
 *
 * Implementations MUST:
 *   - NEVER receive message bodies or snippets. The `prompt` they see
 *     is the renderer's bounded string already.
 *   - Return `null` on any failure (timeout, rate limit, content filter,
 *     non-2xx). The worker falls back to the template on `null`. No
 *     throws — the LLM is a soft path.
 *   - Return the LLM's 1-2 sentence explanation as a UTF-8 string. The
 *     worker stores it verbatim into `triage_decisions.reasoning`.
 */
export interface ReasoningLlmPort {
  /**
   * Generate a 1-2 sentence explanation for one (sender, cascade result).
   * Returns `null` if the LLM call fails for any reason — the worker
   * falls back to the template.
   */
  explain(input: ReasoningInput): Promise<string | null>;
}

/**
 * The bounded payload the LLM port sees. By passing pre-computed facts
 * instead of raw `mail_messages` / `senders` rows, the port impl cannot
 * accidentally read body fields.
 */
export interface ReasoningInput {
  displayName: string;
  domain: string;
  verdict: TriageVerdict;
  confidence: number;
  ruleLabel: CascadeResult['ruleId'];
  facts: CascadeResult['facts'];
  gmailCategory: 'primary' | 'promotions' | 'social' | 'updates' | 'forums';
}

/**
 * Per-call timeout for `ReasoningLlmPort.explain()`. Defaults to 5_000ms;
 * one stall must not block a whole per-mailbox sweep. On timeout the
 * worker treats the call as if the port returned `null` and falls back
 * to the deterministic template — preserving the port's "no throws"
 * contract from the consumer side. Override via `REASONING_TIMEOUT_MS`.
 */
export const DEFAULT_EXPLAIN_TIMEOUT_MS = 5_000;

/**
 * Bounded fan-out across senders. Default 4 in-flight LLM calls per
 * sweep; configurable up to 16 via `REASONING_CONCURRENCY`. The cap
 * keeps the worker from saturating Haiku's rate limit and from blowing
 * the per-mailbox memory footprint.
 */
export const DEFAULT_REASONING_CONCURRENCY = 4;
export const MAX_REASONING_CONCURRENCY = 16;

/**
 * Run `task()` with a hard time-out. Resolves to `'timeout'` if `ms`
 * elapses first; otherwise resolves to the task's value. Never throws
 * from the timeout path (the port's "no throws" contract).
 *
 * Generic `T` is the success type; the union return lets the worker
 * branch without `try/catch` and without losing type info.
 */
export async function runWithTimeout<T>(
  task: () => Promise<T>,
  ms: number,
): Promise<{ kind: 'ok'; value: T } | { kind: 'timeout' }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<{ kind: 'timeout' }>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'timeout' }), ms);
  });
  try {
    const taskPromise = task().then((value) => ({ kind: 'ok' as const, value }));
    return await Promise.race([taskPromise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Tiny in-repo concurrency limiter — no external dep. Returns a function
 * that wraps an async task: at most `max` wrapped tasks run concurrently,
 * the rest queue FIFO. Mirrors `p-limit`'s shape for the one method we
 * need.
 *
 * Test-only observability: `activeCount` exposes the current in-flight
 * count so the concurrency cap test can assert the cap was respected at
 * peak.
 */
export interface ConcurrencyLimiter {
  <T>(task: () => Promise<T>): Promise<T>;
  readonly activeCount: number;
}
export function createLimiter(max: number): ConcurrencyLimiter {
  if (max < 1) throw new Error(`createLimiter: max must be >= 1 (got ${max})`);
  let active = 0;
  const queue: Array<() => void> = [];
  const next = (): void => {
    if (active >= max) return;
    const release = queue.shift();
    if (release) release();
  };
  const limit = <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = (): void => {
        active += 1;
        task()
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            next();
          });
      };
      if (active < max) run();
      else queue.push(run);
    });
  Object.defineProperty(limit, 'activeCount', { get: () => active });
  return limit as ConcurrencyLimiter;
}

/**
 * Read the reasoning-concurrency knob from env. Defaults to
 * `DEFAULT_REASONING_CONCURRENCY` when unset; clamped to
 * `[1, MAX_REASONING_CONCURRENCY]` to defend against a typo.
 */
export function resolveReasoningConcurrency(raw: string | undefined): number {
  const n = raw ? Number.parseInt(raw, 10) : DEFAULT_REASONING_CONCURRENCY;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_REASONING_CONCURRENCY;
  return Math.min(n, MAX_REASONING_CONCURRENCY);
}

/**
 * Default + ceiling for the LLM-call rate cap (calls per minute).
 *
 * The concurrency limiter above caps IN-FLIGHT calls; the rate limiter
 * in `score.worker.ts` (a `packages/workers/src/rate-limiter.ts`
 * sliding-window instance) caps the SUSTAINED CALL RATE. Both matter
 * because Anthropic enforces both: concurrent connections AND
 * requests-per-minute. On Tier 1 the org cap is 50 RPM (verified
 * 2026-06-09 — see [[reasoning.adapter_error]] 429 storm in prod),
 * so a sweep over 6000+ senders with concurrency=4 and sub-second
 * explain() latency burns through the budget in seconds and then
 * drops every call onto the template fallback path.
 *
 * `DEFAULT_REASONING_RATE_PER_MIN = 40` sits BELOW Anthropic Tier 1's
 * 50 RPM org cap to leave headroom for the brief-snapshot +
 * followup-check workers that also call the same org's Anthropic key.
 *
 * SINGLE-INSTANCE STATE. The limiter lives in worker-process memory.
 * Cloud Run worker scales `min=1, max=3` (D193); a multi-instance
 * limit must be coordinated through Redis (BullMQ rate-limiter or a
 * shared token bucket) — out of scope until multi-tenant sweep volume
 * makes this a hot path. With single user / single mailbox today this
 * is acceptable; revisit when `max_instances` is actually consumed.
 */
export const DEFAULT_REASONING_RATE_PER_MIN = 40;
export const MAX_REASONING_RATE_PER_MIN = 1000;

/**
 * Read the reasoning rate-per-minute knob from env. Returns `Infinity`
 * (no pacing) when env is unset — the test-default — so the worker test
 * suite runs at full speed without touching `process.env`. Composition
 * root opts into pacing by setting `REASONING_RATE_PER_MIN=40` in the
 * Cloud Run worker env (see `docs/runbooks/prod-infra-bootstrap.md`).
 * Clamped to `[1, MAX_REASONING_RATE_PER_MIN]` on parse success.
 */
export function resolveReasoningRatePerMin(raw: string | undefined): number {
  if (raw === undefined || raw === '') return Infinity;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_REASONING_RATE_PER_MIN;
  return Math.min(n, MAX_REASONING_RATE_PER_MIN);
}

/**
 * Read the per-call timeout knob from env. Defaults to
 * `DEFAULT_EXPLAIN_TIMEOUT_MS` when unset or non-finite. No upper
 * clamp — a deployment can tolerate longer waits if it chooses.
 */
export function resolveExplainTimeoutMs(raw: string | undefined): number {
  const n = raw ? Number.parseInt(raw, 10) : DEFAULT_EXPLAIN_TIMEOUT_MS;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_EXPLAIN_TIMEOUT_MS;
}

/**
 * Marker re-export so consumers (and the exhaustiveness test) can read
 * the runtime enum array without re-importing from `@declutrmail/db`.
 */
export const VERDICT_RUNTIME_VALUES = triageVerdict.enumValues;
