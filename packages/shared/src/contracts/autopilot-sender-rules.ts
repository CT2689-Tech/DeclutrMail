import { z } from 'zod';

/** Bounded, explicitly approved sender rules; no content-driven conditions. */
export const AUTOPILOT_SENDER_RULE_LIMIT = 50;
export const AUTOPILOT_RULE_SENDER_LIMIT = 100;
export const AUTOPILOT_RULE_PREVIEW_MESSAGE_LIMIT = 5_000;
export const AUTOPILOT_SENDER_SEARCH_PAGE_SIZE = 25;
export const AUTOPILOT_SENDER_RULE_PREVIEW_TTL_SECONDS = 300;

const senderKey = z.string().regex(/^[0-9a-f]{64}$/);
const senderKeys = z
  .array(senderKey)
  .min(1)
  .max(AUTOPILOT_RULE_SENDER_LIMIT)
  .refine((keys) => new Set(keys).size === keys.length, 'Choose each sender once.');
export const AutopilotSenderRuleActionSchema = z.enum(['archive', 'delete']);
export const AutopilotSenderRuleReachSchema = z.enum(['inbox_only', 'all_mail']);
export const AutopilotSenderRuleAgeSchema = z.union([
  z.null(),
  z.literal(30),
  z.literal(90),
  z.literal(180),
]);
export const AutopilotSenderRuleConditionsSchema = z
  .object({
    kind: z.literal('sender_list'),
    senderKeys,
    olderThanDays: AutopilotSenderRuleAgeSchema,
  })
  .strict();
const fields = {
  name: z.string().trim().min(1).max(80),
  senderKeys,
  action: AutopilotSenderRuleActionSchema,
  reach: AutopilotSenderRuleReachSchema,
  olderThanDays: AutopilotSenderRuleAgeSchema,
};
const validReach = (value: { action: string; reach: string }) =>
  value.action === 'delete' || value.reach === 'inbox_only';
export const AutopilotSenderRuleCreateSchema = z
  .object(fields)
  .strict()
  .refine(validReach, { message: 'Archive applies to inbox email.', path: ['reach'] });
export const AutopilotSenderRuleUpdateSchema = z
  .object({
    ...fields,
    version: z.number().int().positive(),
    mode: z.enum(['observe', 'paused']).optional(),
  })
  .strict()
  .refine(validReach, { message: 'Archive applies to inbox email.', path: ['reach'] });
export const AutopilotSenderRuleModeSchema = z
  .object({
    version: z.number().int().positive(),
    mode: z.enum(['observe', 'paused']),
  })
  .strict();
export const AutopilotSenderRuleRetireSchema = z
  .object({ version: z.number().int().positive() })
  .strict();
export const AutopilotSenderRulePreviewRequestSchema = z
  .object({
    version: z.number().int().positive(),
    action: AutopilotSenderRuleActionSchema.optional(),
    reach: AutopilotSenderRuleReachSchema.optional(),
    olderThanDays: AutopilotSenderRuleAgeSchema.optional(),
    excludedSenderKeys: z.array(senderKey).max(AUTOPILOT_RULE_SENDER_LIMIT).optional(),
  })
  .strict();
export const AutopilotSenderRuleExecuteRequestSchema = z
  .object({ previewId: z.string().uuid() })
  .strict();

export interface AutopilotRuleSender {
  id: string;
  senderKey: string;
  name: string | null;
  email: string | null;
  protected: boolean;
}
export interface AutopilotSenderRule {
  id: string;
  name: string;
  version: number;
  enabled: boolean;
  mode: 'observe' | 'paused';
  action: 'archive' | 'delete';
  reach: 'inbox_only' | 'all_mail';
  olderThanDays: 30 | 90 | 180 | null;
  senderKeys: string[];
  senders: AutopilotRuleSender[];
  matchingMessageCount: number;
  matchingSenderCount: number;
  protectedSenderCount: number;
  checkedAt: string;
  updatedAt: string;
}
export interface AutopilotSenderSearchPage {
  senders: AutopilotRuleSender[];
  nextCursor: string | null;
}
export interface AutopilotSenderRulePreview {
  previewId: string;
  ruleId: string;
  version: number;
  expiresAt: string;
  checkedAt: string;
  action: AutopilotSenderRule['action'];
  reach: AutopilotSenderRule['reach'];
  olderThanDays: AutopilotSenderRule['olderThanDays'];
  messageCount: number;
  totalEligibleCount: number;
  hasMore: boolean;
  protectedSenderCount: number;
  senders: (AutopilotRuleSender & { messageCount: number })[];
  excludedSenderKeys: string[];
}
export interface AutopilotSenderRuleExecuteResult {
  previewId: string;
  batchId: string;
  actionIds: string[];
  requestedCount: number;
  enqueueFailedCount: number;
}
export type AutopilotSenderRuleCreate = z.infer<typeof AutopilotSenderRuleCreateSchema>;
export type AutopilotSenderRuleUpdate = z.infer<typeof AutopilotSenderRuleUpdateSchema>;
export type AutopilotSenderRuleMode = z.infer<typeof AutopilotSenderRuleModeSchema>;
export type AutopilotSenderRulePreviewRequest = z.infer<
  typeof AutopilotSenderRulePreviewRequestSchema
>;
export const AutopilotSenderRulePatchSchema = z.union([
  AutopilotSenderRuleUpdateSchema,
  AutopilotSenderRuleModeSchema,
]);
export const AutopilotSenderRuleRetireRequestSchema = AutopilotSenderRuleRetireSchema;
export type AutopilotSenderRulePatch = z.infer<typeof AutopilotSenderRulePatchSchema>;
export type AutopilotSenderSearchResult = AutopilotSenderSearchPage;
