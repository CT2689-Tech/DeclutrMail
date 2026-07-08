import { z } from 'zod';

/**
 * Saved sender filter views (D51 — spec v1.2 Decision 4's "Saved
 * filters" resurrection).
 *
 * Stored under `users.preferences.senderViews` (jsonb bag — no new
 * table, same pattern as `actionSheetPrefs` / `emailPrefs`). Each view
 * is a named snapshot of the Senders ComposeStrip's filter axes + sort,
 * applied client-side by writing the compose URL state.
 *
 * Shared between the API (GET /api/me/settings + PATCH
 * /api/me/sender-views) and the FE Views menu so both sides validate
 * the same shape with the same cap. USER-scoped: views roam mailboxes
 * (they describe a scope recipe, not mailbox rows).
 */

/** Hard cap on stored views — full-replace PATCHes above this 400. */
export const SENDER_VIEWS_CAP = 10;

/** One view's compose axes — mirrors the FE `ComposeState` shape. */
const SenderViewComposeSchema = z
  .object({
    activity: z.enum(['active', 'quiet', 'dormant']).nullable(),
    activityNegate: z.boolean(),
    /** Tri-state: `true` require / `false` negate / `null` off. */
    unsubReady: z.boolean().nullable(),
    replied: z.boolean().nullable(),
    protectedFlag: z.boolean().nullable(),
    windowDays: z.number().int().min(1).max(3650).nullable(),
    domain: z.string().max(120).nullable(),
    /** D51 "unsub'd, still emailing" — on/off. */
    unsubIgnored: z.boolean(),
  })
  .strict();

export const SavedSenderViewSchema = z
  .object({
    /** Display name — unique per user (enforced at the PATCH route). */
    name: z.string().trim().min(1).max(40),
    compose: SenderViewComposeSchema,
    /** Sort snapshot — the Slice-1 sortable columns only. */
    sort: z.enum(['total', 'last_seen', 'first_seen', 'name']),
    direction: z.enum(['asc', 'desc']),
  })
  .strict();

export type SavedSenderView = z.infer<typeof SavedSenderViewSchema>;

export const SenderViewsSchema = z.array(SavedSenderViewSchema).max(SENDER_VIEWS_CAP);

/**
 * PATCH /api/me/sender-views request body — FULL-REPLACE set-state (the
 * list is small and capped; add/rename/delete are all one idempotent
 * write). Duplicate names 400 at the route.
 */
export const SenderViewsPutSchema = z
  .object({
    views: SenderViewsSchema,
  })
  .strict();

export type SenderViewsPut = z.infer<typeof SenderViewsPutSchema>;

/**
 * Read the saved views out of a raw `users.preferences` bag, falling
 * back to `[]` for a missing or malformed `senderViews` key. Never
 * throws — a corrupt bag degrades to "no saved views", not a 500.
 */
export function parseSenderViews(preferences: unknown): SavedSenderView[] {
  if (typeof preferences !== 'object' || preferences === null) return [];
  const raw = (preferences as Record<string, unknown>).senderViews;
  const parsed = SenderViewsSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}
