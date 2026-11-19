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
  | 'signin_provider'
  // The MCP connector's funnel (ADR-0048): connect, use, prepare, open
  // the confirm page, start or be refused, disconnect.
  | 'connector_app_connected'
  | 'connector_app_disconnected'
  | 'connector_tool_called'
  | 'connector_request_prepared'
  | 'connector_confirm_viewed'
  | 'connector_request_started'
  | 'connector_request_refused';

export interface ProductEventsPort {
  record(
    name: ProductEventName,
    props: Record<string, string | number | boolean>,
    userId?: string,
  ): void;
}
