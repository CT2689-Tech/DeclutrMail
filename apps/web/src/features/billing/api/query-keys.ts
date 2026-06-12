/**
 * Billing query keys (D119). Exported as the invalidation contract —
 * the cancel mutation writes back through these so the plan card
 * updates without a refetch.
 */

export const billingKeys = {
  all: ['billing'] as const,
  subscription: () => [...billingKeys.all, 'subscription'] as const,
};
