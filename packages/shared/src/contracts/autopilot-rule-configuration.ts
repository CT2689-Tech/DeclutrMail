import { z } from 'zod';

export const AutopilotRuleConditionsSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('recommendation'),
      verdict: z.enum(['archive', 'unsubscribe', 'later']),
      confidence: z.number().min(0).max(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal('new_sender'),
      firstSeenWithinDays: z.number().int().min(1).max(365),
      fewerThanMessages: z.number().int().min(1).max(1000),
    })
    .strict(),
  z
    .object({
      kind: z.literal('dormant'),
      lastSeenAfterDays: z.number().int().min(0).max(3650),
      lastSeenWithinDays: z.number().int().min(1).max(3650).nullable(),
      readRateBelow: z.number().min(0.01).max(1),
      minMessages: z.number().int().min(5).max(10000),
    })
    .strict()
    .refine((v) => v.lastSeenWithinDays === null || v.lastSeenWithinDays > v.lastSeenAfterDays, {
      message: 'The end of the dormancy range must be after its start.',
      path: ['lastSeenWithinDays'],
    }),
]);
export type AutopilotRuleConditions = z.infer<typeof AutopilotRuleConditionsSchema>;

export const AutopilotRuleConfigurationSchema = z
  .object({
    version: z.number().int().positive(),
    name: z.string().trim().min(1).max(80),
    conditions: AutopilotRuleConditionsSchema,
    actionKind: z.enum(['archive', 'later', 'unsubscribe', 'delete']),
    reach: z.enum(['inbox_only', 'all_mail']).optional(),
  })
  .strict()
  .refine((v) => v.reach !== 'all_mail' || v.actionKind === 'delete', {
    message: 'Only Delete can include archived email.',
    path: ['reach'],
  });
export type AutopilotRuleConfiguration = z.infer<typeof AutopilotRuleConfigurationSchema>;

/** Empty stored conditions retain the installed preset's original behavior. */
export function defaultAutopilotConditions(
  key: string | null,
  threshold: number | null = null,
): AutopilotRuleConditions {
  switch (key) {
    case 'auto_archive_low_engagement':
      return { kind: 'recommendation', verdict: 'archive', confidence: threshold ?? 0.72 };
    case 'auto_unsubscribe_noisy':
      return { kind: 'recommendation', verdict: 'unsubscribe', confidence: threshold ?? 0.9 };
    case 'auto_screen_new_senders':
      return { kind: 'new_sender', firstSeenWithinDays: 7, fewerThanMessages: 3 };
    case 'newsletter_graveyard':
      return {
        kind: 'dormant',
        lastSeenAfterDays: 90,
        lastSeenWithinDays: 180,
        readRateBelow: 0.05,
        minMessages: 5,
      };
    case 'long_dormant_unsubscribe':
      return {
        kind: 'dormant',
        lastSeenAfterDays: 180,
        lastSeenWithinDays: null,
        readRateBelow: 0.05,
        minMessages: 5,
      };
    default:
      throw new Error('Unknown Autopilot preset.');
  }
}

/** The frozen pipeline admits configured, mailbox-scoped preset Delete only. */
export function isApprovalFirstDeletePreset(rule: {
  isPreset: boolean;
  presetKey: string | null;
  scope: string;
  actionKind: string;
  conditions: unknown;
  actionPayload: unknown;
}): boolean {
  if (!rule.isPreset || rule.actionKind !== 'delete' || rule.scope !== 'account') return false;
  const conditions = AutopilotRuleConditionsSchema.safeParse(rule.conditions);
  const payload = z
    .object({ reach: z.enum(['inbox_only', 'all_mail']).optional() })
    .safeParse(rule.actionPayload);
  if (!conditions.success || !payload.success) return false;
  try {
    const family = defaultAutopilotConditions(rule.presetKey);
    return (
      conditions.data.kind === family.kind &&
      (conditions.data.kind !== 'recommendation' ||
        family.kind !== 'recommendation' ||
        conditions.data.verdict === family.verdict)
    );
  } catch {
    return false;
  }
}
