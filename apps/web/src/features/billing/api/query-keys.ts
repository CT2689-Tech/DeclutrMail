/**
 * Billing query keys (D119). Exported as the invalidation contract —
 * the cancel mutation writes back through these so the plan card
 * updates without a refetch.
 */

export const billingKeys = {
  all: ['billing'] as const,
  subscription: () => [...billingKeys.all, 'subscription'] as const,
  /**
   * D119/ADR-0035 invoice list. Deliberately its own key rather than a
   * field on the subscription read: it fans out to one provider
   * round-trip per subscription row, so it must not ride the poll that
   * the payment-processing and refund-settling states run.
   */
  invoices: () => [...billingKeys.all, 'invoices'] as const,
};
