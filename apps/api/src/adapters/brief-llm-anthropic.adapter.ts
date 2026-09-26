// apps/api/src/adapters/brief-llm-anthropic.adapter.ts — concrete
// BriefLlmPort implementation backed by Anthropic's Messages API
// (D62 — Haiku 4.5).
//
// Per D201, external-boundary adapters live in `apps/api/src/adapters/`.
// The brief snapshot worker accepts the port via DI
// (`BriefSnapshotDeps.llm`); the composition root wires this adapter
// when `ANTHROPIC_API_KEY` is set and skips it otherwise (the worker
// falls back to the deterministic template per D62).
//
// CONTRACT (mirrors `BriefLlmPort` in @declutrmail/workers):
//   - `generateNarrative()` MUST return `null` on any failure — network
//     error, non-2xx status, missing content block, content filter,
//     malformed response. No throws. The worker treats `null` as "use
//     the template" and records `brief_runs.generated_by = 'template'`.
//   - Input is the worker's pre-computed bounded payload: per-section
//     sender name + email + subject + Gmail snippet, plus
//     the noise sender counts. The adapter NEVER sees message bodies,
//     attachments, non-allowlisted headers, or anything outside D7's
//     storage + read allowlist.
//   - Output is a short optional note, never a replacement for the
//     source-linked message list.
//     The worker trims + stores it verbatim into
//     `brief_payload.narrative`.
//
// MODEL CHOICE: Haiku 4.5 (`claude-haiku-4-5`) per D62. Haiku 4.5 does
// not support adaptive thinking or the `effort` parameter — both are
// Opus-tier only. The call is a single Messages API request with a
// small system prompt + the rendered user prompt.
//
// PRIVACY (D7, D228): the prompt the adapter builds includes ONLY
// allowlisted metadata. The `BriefNarrativeInput` type at the contract
// layer is the gate; the adapter cannot smuggle anything else in
// because the worker doesn't pass it.

import Anthropic from '@anthropic-ai/sdk';
import type {
  BriefLlmPort,
  BriefNarrativeInput,
  BriefNarrativeItem,
  BriefNarrativeNoiseGroup,
} from '@declutrmail/workers';

import { LlmCircuitBreaker, providerErrorFields } from './llm-circuit-breaker.js';

/**
 * D62 — Anthropic Haiku 4.5. Same constant as the reasoning adapter for
 * D24; kept locally rather than imported so the two adapters can pin
 * independently if model selection ever diverges per surface.
 */
const HAIKU_MODEL_ID = 'claude-haiku-4-5';

/**
 * The narrative is short (at most two sentences, ≤55 words). 192 tokens is far
 * more than that needs; the headroom is kept deliberately so a model
 * that runs slightly long still returns a COMPLETE sentence rather than
 * a truncated one. The prompt, not the token cap, is what keeps it
 * brief — a cap tight enough to enforce length would cut mid-word.
 */
const MAX_OUTPUT_TOKENS = 192;

/**
 * D62 system prompt — "sharp executive assistant" voice.
 *
 * The Brief already shows its source-linked rows. The note may add a
 * small, well-supported observation, but cannot promote a subject or
 * snippet into an unverified security or financial claim. Long or
 * unfocused responses are discarded in `generateNarrative`.
 */
const SYSTEM_PROMPT = [
  'You are a sharp executive assistant. Below your text the reader already sees every Reply and FYI item with its sender and subject, and every Noise sender with a message count.',
  '',
  'Your job is to say what that list cannot.',
  '',
  'Rules:',
  '- Plain English prose, at most two sentences, within the word budget stated at the end of the user message. No lists, no headings, no markdown.',
  '- Name at most two senders, and only when a useful fact is explicitly stated in their subject or snippet.',
  '- Do not infer a sign-in attempt, unfamiliar device, fraud, deadline, purchase, subscription term, or required action from a sender name or a one-time-code subject.',
  '- If evidence is ambiguous, say that the message mentions a topic and invite the reader to check the message. Never assert an unstated event or consequence.',
  '- A sender whose subject line already says everything does not belong in your text. That is walking the list, not briefing.',
  '- Lead with the item that matters most.',
  '- Never state counts. The section headers already carry them.',
  '- Do not summarize the FYI or Noise sections. They are visible and self-explanatory.',
  '- Stay grounded in the senders, subjects, and snippets provided. Never invent details or urgency.',
  '- Never repeat figures from a snippet — no balances, amounts, or account numbers.',
  '- If nothing genuinely stands out, say exactly that in one short sentence.',
  '- Do not address the user directly. Calm and direct. No exclamation marks, no hype.',
].join('\n');

/**
 * The message list handles volume. A note above it should stay short
 * even on a busy day, or it recreates the unreadable wall of prose it
 * was meant to replace.
 */
const NARRATIVE_MAX_WORDS = 55;

export function narrativeWordBudget(_replyCount: number): number {
  return NARRATIVE_MAX_WORDS;
}

/**
 * Hard cap on per-section item lines in the prompt. The worker already
 * caps reply at 6 and fyi at 4 (D63), and noise is uncapped — the noise
 * truncation here prevents a long-tail mailbox (50+ noise senders) from
 * inflating the prompt past Haiku's caching threshold.
 */
const MAX_NOISE_LINES_IN_PROMPT = 10;

/**
 * Snippet length cap inside the prompt. The DB column is varchar(300)
 * already; trimming further keeps the prompt compact + predictable for
 * cost estimation.
 */
const SNIPPET_PROMPT_CAP = 160;

export interface BriefLlmAnthropicAdapterDeps {
  /**
   * Pre-constructed SDK client. The composition root owns the API key
   * + base URL; tests inject a mock client.
   */
  client: Anthropic;
  /**
   * Pauses calls after the provider refuses the account. The composition
   * root shares one with the reasoning adapter (same account); omitted,
   * the adapter gets its own.
   */
  breaker?: LlmCircuitBreaker;
}

/**
 * BriefLlmAnthropicAdapter — implements `BriefLlmPort` against the
 * Messages API. Safe to share across the worker's bounded concurrency
 * pool; its only state is the breaker.
 */
export class BriefLlmAnthropicAdapter implements BriefLlmPort {
  private readonly breaker: LlmCircuitBreaker;

  constructor(private readonly deps: BriefLlmAnthropicAdapterDeps) {
    this.breaker = deps.breaker ?? new LlmCircuitBreaker();
  }

  async generateNarrative(input: BriefNarrativeInput): Promise<string | null> {
    if (this.breaker.isBlocked()) return null;
    const userPrompt = renderBriefUserPrompt(input);
    try {
      const response = await this.deps.client.messages.create({
        model: HAIKU_MODEL_ID,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      });
      const narrative = extractText(response);
      if (narrative === null || narrative.split(/\s+/).length > NARRATIVE_MAX_WORDS) return null;
      return narrative;
    } catch (err) {
      // No throws — the port's contract is "soft path". A refusal is
      // logged by the breaker; anything else is logged here.
      const source = { adapter: 'BriefLlmAnthropicAdapter', model: HAIKU_MODEL_ID };
      if (this.breaker.recordFailure(err, source) === null) {
        console.warn(
          JSON.stringify({
            level: 'warn',
            kind: 'brief.adapter_error',
            ...source,
            ...providerErrorFields(err),
          }),
        );
      }
      return null;
    }
  }
}

/**
 * Render the bounded user prompt from `BriefNarrativeInput`. Pure
 * function — no clock, no env, no I/O — so the test suite can lock the
 * exact string the adapter sends to Anthropic.
 *
 * Every field referenced is allowlisted metadata per D7/D62.
 */
export function renderBriefUserPrompt(input: BriefNarrativeInput): string {
  const lines: string[] = [];
  lines.push(`Reply section (${input.reply.length} item${input.reply.length === 1 ? '' : 's'}):`);
  if (input.reply.length === 0) {
    lines.push('  (none)');
  } else {
    for (const item of input.reply) lines.push(formatItem(item));
  }
  lines.push('');
  lines.push(`FYI section (${input.fyi.length} item${input.fyi.length === 1 ? '' : 's'}):`);
  if (input.fyi.length === 0) {
    lines.push('  (none)');
  } else {
    for (const item of input.fyi) lines.push(formatItem(item));
  }
  lines.push('');
  const totalNoiseMessages = input.noise.reduce((sum, g) => sum + g.messageCount, 0);
  lines.push(
    `Noise section (${input.noise.length} sender${input.noise.length === 1 ? '' : 's'}, ${totalNoiseMessages} message${
      totalNoiseMessages === 1 ? '' : 's'
    }):`,
  );
  if (input.noise.length === 0) {
    lines.push('  (none)');
  } else {
    const truncated = input.noise.slice(0, MAX_NOISE_LINES_IN_PROMPT);
    for (const group of truncated) lines.push(formatNoise(group));
    if (input.noise.length > truncated.length) {
      lines.push(`  …and ${input.noise.length - truncated.length} more senders.`);
    }
  }
  lines.push('');
  lines.push(`Word budget: at most ${narrativeWordBudget(input.reply.length)} words.`);
  lines.push('Write the morning briefing now.');
  return lines.join('\n');
}

function formatItem(item: BriefNarrativeItem): string {
  const senderLabel = item.senderName.trim() || item.senderEmail || '(unknown sender)';
  const subject = item.subject.trim() || '(no subject)';
  const snippet = truncateSnippet(item.snippet);
  const snippetSegment = snippet ? ` — "${snippet}"` : '';
  return `  - ${senderLabel}: ${subject}${snippetSegment}`;
}

function formatNoise(group: BriefNarrativeNoiseGroup): string {
  const name = group.senderName.trim() || '(unknown sender)';
  const count = group.messageCount;
  return `  - ${name} (${count} message${count === 1 ? '' : 's'})`;
}

function truncateSnippet(snippet: string): string {
  const cleaned = snippet.trim().replace(/\s+/g, ' ');
  if (cleaned.length <= SNIPPET_PROMPT_CAP) return cleaned;
  return `${cleaned.slice(0, SNIPPET_PROMPT_CAP - 1)}…`;
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

/**
 * Construct the adapter from process env. Returns `null` when
 * `ANTHROPIC_API_KEY` is unset — the composition root passes `null`
 * to the worker as `llm`, which is the documented "no LLM available;
 * always use the template" path per D62.
 */
export function buildBriefLlmAdapter(
  env: NodeJS.ProcessEnv = process.env,
  breaker?: LlmCircuitBreaker,
): BriefLlmAnthropicAdapter | null {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey });
  return new BriefLlmAnthropicAdapter({ client, ...(breaker ? { breaker } : {}) });
}
