// apps/api/src/adapters/anthropic-haiku.adapter.ts — concrete
// ReasoningLlmPort implementation backed by Anthropic's Messages API
// (D24, D62 — Haiku 4.5).
//
// Per D201, external-boundary adapters live in `apps/api/src/adapters/`.
// The score worker accepts the port via DI (`ScoreWorkerDeps.llm`); the
// composition root wires this adapter when `ANTHROPIC_API_KEY` is set
// and skips it otherwise (the worker falls back to the deterministic
// template per D24).
//
// CONTRACT (mirrors ReasoningLlmPort in @declutrmail/workers):
//   - `explain()` MUST return `null` on any failure — network error,
//     non-2xx status, missing content block, content filter, malformed
//     response. No throws. The worker treats `null` as "use the
//     template" and records `triage_decisions.generated_by = 'template'`.
//   - The `ReasoningInput` is the worker's pre-computed bounded payload:
//     display name, domain, verdict, confidence, rule label, the numeric
//     facts, Gmail category. The adapter NEVER sees message bodies,
//     subjects, snippets, or any other content covered by D7's storage
//     allowlist.
//   - Output is the LLM's 1-2 sentence explanation as a UTF-8 string,
//     stored verbatim into `triage_decisions.reasoning`.
//
// MODEL CHOICE: Haiku 4.5 (`claude-haiku-4-5`) per D62. Haiku 4.5 does
// not support adaptive thinking or the `effort` parameter — both are
// Opus-tier only. The call is a single Messages API request with a
// small system prompt + the rendered user prompt.
//
// PRIVACY (D7, D228): the prompt the adapter builds includes ONLY
// allowlisted metadata — sender display name + domain, engine verdict
// + confidence + rule label, monthly volume + read-rate percent, Gmail
// category. No body, no snippet, no subject, no non-allowlisted header.
// The `ReasoningInput` type at the contract layer is the gate; the
// adapter cannot smuggle anything in because it has nothing else to read.

import Anthropic from '@anthropic-ai/sdk';
import type { ReasoningInput, ReasoningLlmPort } from '@declutrmail/workers';

/**
 * D62 — Anthropic Haiku 4.5. The bare alias auto-resolves to the
 * latest stable Haiku 4.5 release; date-suffixed IDs are reserved for
 * pinning when reproducibility matters (none of our use cases require it).
 *
 * Canonical model catalog (verified 2026-05-26):
 *   https://platform.claude.com/docs/en/api/csharp/beta/messages → "Fast Models"
 *   - claude-haiku-4-5             (bare alias, used here)
 *   - claude-haiku-4-5-20251001    (pinned date, available if we ever
 *                                    need reproducibility)
 *
 * NOTE for reviewers: an earlier review pass questioned this id against
 * the older `claude-3-5-haiku-20241022` (Haiku 3.5, deprecated). Haiku
 * 4.5 shipped 2025-10-01 — the 4-5 id is the current canonical Haiku.
 * Re-verify against the URL above before flagging.
 */
const HAIKU_MODEL_ID = 'claude-haiku-4-5';

/**
 * 1-2 sentence cap. Haiku 4.5 emits roughly 4 chars per token; 256
 * tokens leaves comfortable headroom for the audit copy without
 * letting the model wander into paragraphs. The worker's
 * `runWithTimeout` is the wall-clock guard; this cap is just the
 * response-shape guard.
 */
const MAX_OUTPUT_TOKENS = 256;

/**
 * D62 voice — verbatim from the bundle's `screens/brief.jsx:23-49`
 * prompt shape. "Sharp executive assistant" tone, explicit rules,
 * metadata-only inputs. The system prompt is intentionally stable
 * (no per-request interpolation) so prompt caching can kick in once
 * we cross the 4096-token Haiku cacheable-prefix floor — today the
 * system text is short enough that caching is a no-op, but the shape
 * is forward-compatible.
 */
const SYSTEM_PROMPT = [
  'You are a sharp executive assistant explaining why an email sender was sorted into a particular bucket.',
  '',
  'Rules:',
  '- Write 1-2 sentences. Plain English. No lists, no headings, no markdown.',
  '- Reference the numeric facts you are given (monthly volume, read rate, recommendation).',
  '- Match the recommendation: Keep / Archive / Unsubscribe / Later.',
  '- Never invent details not present in the input. No personalization beyond what is supplied.',
  '- Do not address the user. Write in the third person about the sender.',
].join('\n');

export interface AnthropicHaikuAdapterDeps {
  /**
   * Pre-constructed SDK client. The composition root owns the API key
   * + base URL; tests inject a mock client.
   */
  client: Anthropic;
}

/**
 * AnthropicHaikuAdapter — implements `ReasoningLlmPort` against the
 * Messages API. Stateless; safe to share across the worker's bounded
 * concurrency pool.
 */
export class AnthropicHaikuAdapter implements ReasoningLlmPort {
  constructor(private readonly deps: AnthropicHaikuAdapterDeps) {}

  async explain(input: ReasoningInput): Promise<string | null> {
    const userPrompt = renderUserPrompt(input);
    try {
      const response = await this.deps.client.messages.create({
        model: HAIKU_MODEL_ID,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      });
      return extractText(response);
    } catch (err) {
      // No throws — the port's contract is "soft path". Structured log
      // so observability can correlate fallbacks with API health, but
      // the worker only sees `null` and falls back to the template.
      console.warn(
        JSON.stringify({
          level: 'warn',
          kind: 'reasoning.adapter_error',
          adapter: 'AnthropicHaikuAdapter',
          model: HAIKU_MODEL_ID,
          error: err instanceof Error ? err.message : String(err),
          ...(err instanceof Anthropic.APIError ? { status: err.status, type: err.type } : {}),
        }),
      );
      return null;
    }
  }
}

/**
 * Render the bounded user prompt from `ReasoningInput`. Pure function
 * — no clock, no env, no I/O — so the test suite can lock the exact
 * string the adapter sends to Anthropic.
 *
 * Every field referenced is allowlisted metadata per D7/D24. The
 * `ReasoningInput` type contract is the upstream gate; this function
 * just formats.
 */
export function renderUserPrompt(input: ReasoningInput): string {
  const senderLabel = input.displayName.trim() || input.domain || 'This sender';
  const verdictLabel = capitalize(input.verdict);
  const confidencePct = Math.round(input.confidence * 100);
  return [
    `Sender: ${senderLabel}`,
    `Domain: ${input.domain || '(unknown)'}`,
    `Gmail category: ${input.gmailCategory}`,
    `Monthly volume: ${input.facts.monthlyVolume} messages`,
    `Read rate: ${input.facts.readRatePct}%`,
    `Engine rule: ${input.ruleLabel}`,
    `Recommendation: ${verdictLabel} (confidence ${confidencePct}%)`,
    '',
    'Explain in 1-2 sentences why this recommendation fits.',
  ].join('\n');
}

/**
 * Pull the first text block out of a Messages API response. Returns
 * `null` (port-contract failure) when:
 *   - `stop_reason` is `refusal` (safety-side guardrail fired)
 *   - `stop_reason` is `max_tokens` (truncated mid-sentence; better to
 *     fall back to the template than store a half-sentence)
 *   - No text block in `content[]` (response shape changed or only
 *     thinking/tool-use blocks landed)
 */
function extractText(response: Anthropic.Message): string | null {
  if (response.stop_reason === 'refusal') return null;
  if (response.stop_reason === 'max_tokens') return null;
  for (const block of response.content) {
    if (block.type === 'text') {
      const text = block.text.trim();
      if (text.length === 0) return null;
      return text;
    }
  }
  return null;
}

function capitalize(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Construct the adapter from process env. Returns `null` when
 * `ANTHROPIC_API_KEY` is unset — the composition root passes `null`
 * to the worker as `llm`, which is the documented "no LLM available;
 * always use the template" path.
 */
export function buildAnthropicHaikuAdapter(
  env: NodeJS.ProcessEnv = process.env,
): AnthropicHaikuAdapter | null {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey });
  return new AnthropicHaikuAdapter({ client });
}
