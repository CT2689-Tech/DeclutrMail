/**
 * Server product-events port (WS4b binds the writer).
 * Props are closed scalars. Never email addresses or mailbox content.
 */
export type ProductEventName =
  | 'signup_completed'
  | 'gmail_connected'
  | 'first_sync_ready'
  | 'first_sync_failed_terminal'
  | 'free_cap_hit'
  | 'checkout_created'
  | 'purchase_confirmed'
  | 'email_link_clicked'
  | 'signin_provider';

export interface ProductEventsPort {
  record(
    name: ProductEventName,
    props: Record<string, string | number | boolean>,
    userId?: string,
  ): void;
}
