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
//   - Output is the LLM's 2-4 sentence executive-assistant briefing.
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

/**
 * D62 — Anthropic Haiku 4.5. Same constant as the reasoning adapter for
 * D24; kept locally rather than imported so the two adapters can pin
 * independently if model selection ever diverges per surface.
 */
const HAIKU_MODEL_ID = 'claude-haiku-4-5';

/**
 * The narrative is short (2-4 sentences). 384 tokens gives comfortable
 * headroom for a three-section summary without letting the model
 * wander.
 */
const MAX_OUTPUT_TOKENS = 384;

/**
 * D62 system prompt — "sharp executive assistant" voice. The narrative
 * frames the three D63 sections in plain English. Rules are explicit so
 * the model doesn't drift toward marketing copy or fabricate counts.
 */
const SYSTEM_PROMPT = [
  "You are a sharp executive assistant writing a morning briefing about yesterday's email.",
  '',
  'Rules:',
  '- Write 2-4 sentences. Plain English. No lists, no headings, no markdown.',
  '- Reference the three sections: Reply (needs response), FYI (facts to know), Noise (bulk-archivable).',
  '- Stay grounded in the senders, subjects, and snippets provided. Never invent details.',
  '- Mention specific senders by name when calling out the most important item — at most two name-drops.',
  '- Do not address the user directly. Write in the third person about the email landscape.',
  '- Keep the tone calm and direct. No exclamation marks, no hype.',
].join('\n');

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
}

/**
 * BriefLlmAnthropicAdapter — implements `BriefLlmPort` against the
 * Messages API. Stateless; safe to share across the worker's bounded
 * concurrency pool.
 */
export class BriefLlmAnthropicAdapter implements BriefLlmPort {
  constructor(private readonly deps: BriefLlmAnthropicAdapterDeps) {}

  async generateNarrative(input: BriefNarrativeInput): Promise<string | null> {
    const userPrompt = renderBriefUserPrompt(input);
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
      // so observability can correlate fallbacks with API health.
      console.warn(
        JSON.stringify({
          level: 'warn',
          kind: 'brief.adapter_error',
          adapter: 'BriefLlmAnthropicAdapter',
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
): BriefLlmAnthropicAdapter | null {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey });
  return new BriefLlmAnthropicAdapter({ client });
}
