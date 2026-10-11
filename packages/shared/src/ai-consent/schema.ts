import { z } from 'zod';

export const AiConsentViewSchema = z.object({
  explanations: z.enum(['unset', 'allowed', 'off', 'paused', 'review']),
  brief: z.enum(['unset', 'allowed', 'off', 'paused', 'review', 'declined']),
  reask: z.boolean(),
});

export const AiConsentDecisionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('allow'),
    card: z.enum(['all', 'withBrief', 'upgrade']),
  }),
  z.object({
    action: z.literal('not_now'),
    card: z.enum(['all', 'withBrief', 'upgrade']),
  }),
  z.object({
    action: z.literal('revoke'),
    scope: z.enum(['explanations', 'brief']).optional(),
  }),
]);
