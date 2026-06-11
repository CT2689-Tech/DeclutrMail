/**
 * Onboarding transport contracts (D106-D113).
 *
 * Shared between the NestJS `OnboardingModule` controller and the
 * `apps/web` onboarding step machine so the wire shape is typed
 * end-to-end (D202 pattern, same arrangement as `sync-status.ts`).
 *
 * Privacy (D7 / D228): every field here is flow metadata — step
 * progress, preset identifiers, ISO timestamps. No message content of
 * any kind. The first-triage candidate rows themselves ride the
 * existing Triage queue projection (`TriageQueueRow`), which is
 * already privacy-audited; this module only adds the small scalar
 * meta block around them.
 */

import { z } from 'zod';

/**
 * The 5 V2 Autopilot preset identifiers (D101 + D124).
 *
 * MIRRORS `AUTOPILOT_PRESET_KEYS` in
 * `packages/db/src/schema/automation-rules.ts` — the DB union is
 * canonical. Duplicated here because `@declutrmail/shared` must stay
 * importable by the browser bundle without dragging in drizzle. The
 * equivalence is contract-tested in
 * `apps/api/src/onboarding/onboarding.service.spec.ts`.
 */
export const ONBOARDING_PRESET_KEYS = [
  'auto_archive_low_engagement',
  'auto_unsubscribe_noisy',
  'auto_screen_new_senders',
  'newsletter_graveyard',
  'long_dormant_unsubscribe',
] as const;

export const OnboardingPresetKeySchema = z.enum(ONBOARDING_PRESET_KEYS);
export type OnboardingPresetKey = z.infer<typeof OnboardingPresetKeySchema>;

/**
 * One entry of the step-4 preset catalog (D110). Display copy is
 * server-owned so the FE renders a single source — names here are the
 * ONBOARDING-facing labels and MUST respect §2.2 (K/A/U/L/D verbs
 * only; "Screener" the feature name is allowed, the verb "Screen" is
 * not).
 */
export const OnboardingPresetCatalogItemSchema = z
  .object({
    key: OnboardingPresetKeySchema,
    /** Onboarding display name (§2.2-safe). */
    name: z.string().min(1),
    /** One-line plain-language description of what the rule does. */
    description: z.string().min(1),
    /** The K/A/U/L verb the rule emits, for the verb chip. */
    verb: z.enum(['keep', 'archive', 'unsubscribe', 'later']),
  })
  .strict();
export type OnboardingPresetCatalogItem = z.infer<typeof OnboardingPresetCatalogItemSchema>;

/**
 * GET /api/onboarding/state — the durable onboarding flags the step
 * machine derives the current step from (D106).
 *
 * - `onboardedAt` null ⇒ the flow is incomplete; the web app routes
 *   the user back into it (D113).
 * - `presetPicks` null ⇒ step 4 not submitted yet. `[]` is a valid
 *   submission ("start with no rules") and advances the machine —
 *   null vs empty is load-bearing.
 * - `skipped` ⇒ the user used the D106 skip affordance; production
 *   may gate certain features for skip-onboarded users.
 */
export const OnboardingStateSchema = z
  .object({
    onboardedAt: z.string().datetime({ offset: true }).nullable(),
    skipped: z.boolean(),
    presetPicks: z.array(OnboardingPresetKeySchema).nullable(),
    presets: z.array(OnboardingPresetCatalogItemSchema),
  })
  .strict();
export type OnboardingState = z.infer<typeof OnboardingStateSchema>;

/**
 * POST /api/onboarding/preset-picks request body (D110).
 *
 * The full desired set — the server reconciles ALL 5 preset rules to
 * `enabled = (key ∈ presetKeys)` so a re-submission is idempotent and
 * deterministic. Duplicates rejected.
 */
export const OnboardingPresetPicksRequestSchema = z
  .object({
    presetKeys: z
      .array(OnboardingPresetKeySchema)
      .max(ONBOARDING_PRESET_KEYS.length)
      .refine((keys) => new Set(keys).size === keys.length, {
        message: 'presetKeys must not contain duplicates.',
      }),
  })
  .strict();
export type OnboardingPresetPicksRequest = z.infer<typeof OnboardingPresetPicksRequestSchema>;

/**
 * POST /api/onboarding/preset-picks response. `rulesSeeded=false`
 * means the mailbox's preset rules have not been seeded yet (the
 * post-sync seeder hasn't run) — the picks are durably persisted in
 * `users.preferences` and the seeder applies them when it runs, so
 * the choice is never lost either way.
 */
export const OnboardingPresetPicksResultSchema = z
  .object({
    presetKeys: z.array(OnboardingPresetKeySchema),
    /** How many `automation_rules` rows were reconciled right now. */
    rulesReconciled: z.number().int().min(0),
    /** Whether the preset rules existed at submit time. */
    rulesSeeded: z.boolean(),
  })
  .strict();
export type OnboardingPresetPicksResult = z.infer<typeof OnboardingPresetPicksResultSchema>;

/** POST /api/onboarding/complete request body (D113 / D106 skip). */
export const OnboardingCompleteRequestSchema = z
  .object({
    /** True when completion came from the D106 skip affordance. */
    skipped: z.boolean().optional(),
  })
  .strict();
export type OnboardingCompleteRequest = z.infer<typeof OnboardingCompleteRequestSchema>;

/**
 * GET /api/onboarding/first-triage `meta` block (D112).
 *
 * `data` is the pinned candidate rows still awaiting a decision (the
 * existing TriageQueueRow projection). `pinned` is how many senders
 * were locked in for the practice run (≤3; can be 0 for a tiny
 * mailbox); `decided` counts pinned senders that no longer await a
 * decision. Step 5 completes when `decided === pinned`.
 */
export const OnboardingFirstTriageMetaSchema = z
  .object({
    pinned: z.number().int().min(0).max(3),
    decided: z.number().int().min(0).max(3),
  })
  .strict();
export type OnboardingFirstTriageMeta = z.infer<typeof OnboardingFirstTriageMetaSchema>;
