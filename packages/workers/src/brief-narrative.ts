// packages/workers/src/brief-narrative.ts — Brief narrative generation
// port + deterministic template fallback + payload validation
// (D62, D63, D70).
//
// Separated from `brief-snapshot.worker.ts` so the LLM port contract,
// the bounded `BriefNarrativeInput` shape, and the Zod payload validator
// live in one place — the worker just orchestrates them.
//
// PRIVACY (D7, D228): `BriefNarrativeInput` is the gate. The fields the
// LLM port sees are ALL allowlisted metadata:
//   - sender display name + email
//   - subject  (Gmail message header — explicit allowlist)
//   - snippet  (Gmail's own short preview — explicit allowlist on
//              `mail_messages.snippet`, capped at varchar(300))
//   - message counts
//
// The `BriefNarrativeInput` type is the upstream contract — the port
// implementation cannot read anything else because the worker does not
// pass anything else. No bodies, no attachments, no non-allowlisted
// headers; the prompt builder enforces this at write time.
//
// CONTRACT (mirrors `ReasoningLlmPort` for D24 — same pattern):
//   - `generateNarrative()` MUST return `null` on any failure (network,
//     non-2xx, missing content, content filter, malformed response). No
//     throws. The worker treats `null` as "use the template" and records
//     `brief_runs.generated_by = 'template'`.
//   - The narrative is a 2-4 sentence executive-assistant briefing
//     covering the three D63 sections. The worker stores it verbatim
//     into `brief_payload.narrative`.

import { z } from 'zod';

export interface BriefItem {
  senderKey: string;
  senderName: string;
  senderEmail: string;
  subject: string;
  messageIds: string[];
}

export interface BriefSenderGroup {
  senderKey: string;
  senderName: string;
  messageCount: number;
  messageIds: string[];
}

export interface BriefPayload {
  reply: BriefItem[];
  fyi: BriefItem[];
  noise: BriefSenderGroup[];
  narrative: string;
}

/**
 * D62 — narrative provider port. `undefined` on the worker deps means
 * "no LLM available; always use the template." A wired implementation
 * MUST return `null` on failure (no throws); see contract above.
 */
export interface BriefLlmPort {
  generateNarrative(input: BriefNarrativeInput): Promise<string | null>;
}

/**
 * Bounded input the LLM port sees — same containment pattern as
 * `ReasoningInput` for D24. The worker pre-computes this from the D63
 * categorization + a per-message snippet lookup; the port cannot reach
 * back to the DB or smuggle non-allowlisted fields in.
 *
 * Snippets are NEVER persisted into `brief_payload` — they live only in
 * the in-process call to the port. The worker drops them before insert.
 */
export interface BriefNarrativeInput {
  /** D63 Reply section items + their Gmail snippets. */
  reply: BriefNarrativeItem[];
  /** D63 FYI section items + their Gmail snippets. */
  fyi: BriefNarrativeItem[];
  /** D63 Noise section sender groups (counts only — no snippet noise). */
  noise: BriefNarrativeNoiseGroup[];
}

/** One Reply/FYI item, enriched with the representative Gmail snippet. */
export interface BriefNarrativeItem {
  senderName: string;
  senderEmail: string;
  subject: string;
  /** Gmail's `snippet` — D7-allowlisted preview, capped at 300 chars. */
  snippet: string;
}

/** One Noise sender group — counts only for the narrative. */
export interface BriefNarrativeNoiseGroup {
  senderName: string;
  messageCount: number;
}

/**
 * Per-call timeout for `BriefLlmPort.generateNarrative()`. Defaults to
 * 10s — one Brief call per mailbox per day, so generosity here is fine;
 * the worker's bounded fan-out (8 mailboxes in parallel) keeps the
 * total wall clock tight. Override via `BRIEF_LLM_TIMEOUT_MS`.
 */
export const DEFAULT_BRIEF_LLM_TIMEOUT_MS = 10_000;

export function resolveBriefLlmTimeoutMs(raw: string | undefined): number {
  const n = raw ? Number.parseInt(raw, 10) : DEFAULT_BRIEF_LLM_TIMEOUT_MS;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_BRIEF_LLM_TIMEOUT_MS;
}

/**
 * D70 calm empty-state copy — verbatim from the plan. Used for both the
 * narrative AND the section arrays (which are empty).
 *
 * Exported so the Anthropic adapter (which must NOT be called on empty
 * days — no point spending a Haiku call to say "you got 0 emails") can
 * also be tested for that branch from one source of truth.
 */
export const EMPTY_BRIEF_NARRATIVE =
  "Your inbox was quiet yesterday.\n\nEnjoy the morning — we'll be back tomorrow.";

/** D70 — fully-formed empty payload, used when yesterday had zero messages. */
export const EMPTY_BRIEF_PAYLOAD: BriefPayload = {
  reply: [],
  fyi: [],
  noise: [],
  narrative: EMPTY_BRIEF_NARRATIVE,
};

/**
 * Deterministic D62 template — used when the LLM port is unavailable,
 * returns null, or times out. Same "executive assistant" voice as the
 * Haiku prompt, just stable + body-free.
 *
 * One-sentence summary per non-empty section. The empty-day branch is
 * handled separately by `EMPTY_BRIEF_PAYLOAD` (the worker short-circuits
 * before calling either template OR LLM when there are zero messages).
 */
export function renderTemplateNarrative(payload: {
  reply: readonly BriefItem[];
  fyi: readonly BriefItem[];
  noise: readonly BriefSenderGroup[];
}): string {
  const replyCount = payload.reply.length;
  const fyiCount = payload.fyi.length;
  const noiseCount = payload.noise.reduce((sum, g) => sum + g.messageCount, 0);

  if (replyCount === 0 && fyiCount === 0 && noiseCount === 0) {
    return EMPTY_BRIEF_NARRATIVE;
  }
  const parts: string[] = [];
  if (replyCount > 0) {
    parts.push(`${replyCount} ${replyCount === 1 ? 'email needs a reply' : 'emails need replies'}`);
  }
  if (fyiCount > 0) {
    parts.push(`${fyiCount} FYI${fyiCount === 1 ? '' : 's'}`);
  }
  if (noiseCount > 0) {
    parts.push(`${noiseCount} ${noiseCount === 1 ? 'message' : 'messages'} you can archive`);
  }
  return `${parts.join(', ')}.`;
}

/**
 * D63 — Zod schema for `brief_payload`. Validates the EXACT three-
 * section shape (reply / fyi / noise) plus the narrative string. The
 * worker runs this immediately before insert as a defense-in-depth gate
 * — even a future refactor that mis-shapes the payload would be caught
 * here instead of corrupting `brief_runs.brief_payload`.
 *
 * Caps:
 *   - reply: max 6 (D63)
 *   - fyi:   max 4 (D63)
 *   - noise: uncapped (D63)
 *
 * The schema mirrors the `BriefPayload` / `BriefItem` / `BriefSenderGroup`
 * TypeScript types in `@declutrmail/db`. `.strict()` rejects any extra
 * keys so a typo can't introduce a stowaway field (e.g., a `snippet`
 * field leaking into the stored payload).
 */
export const briefItemSchema = z
  .object({
    senderKey: z.string().min(1),
    senderName: z.string(),
    senderEmail: z.string(),
    subject: z.string(),
    messageIds: z.array(z.string()),
  })
  .strict();

export const briefSenderGroupSchema = z
  .object({
    senderKey: z.string().min(1),
    senderName: z.string(),
    messageCount: z.number().int().nonnegative(),
    messageIds: z.array(z.string()),
  })
  .strict();

/** D63 reply cap. Exported so tests + worker share the constant. */
export const BRIEF_REPLY_MAX = 6;
/** D63 FYI cap. */
export const BRIEF_FYI_MAX = 4;

export const briefPayloadSchema = z
  .object({
    reply: z.array(briefItemSchema).max(BRIEF_REPLY_MAX),
    fyi: z.array(briefItemSchema).max(BRIEF_FYI_MAX),
    noise: z.array(briefSenderGroupSchema),
    narrative: z.string(),
  })
  .strict();
