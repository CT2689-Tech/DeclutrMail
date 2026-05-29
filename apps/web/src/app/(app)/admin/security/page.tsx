import { AdminSecurityEventsScreen } from '@/features/admin-security/security-events-screen';

/**
 * /admin/security route — operator audit log (D181 read).
 *
 * Thin route shell — layout, data fetching, state branches, and 404
 * handling live in `AdminSecurityEventsScreen` so they can be
 * exercised by tests and Storybook without dragging in the Next
 * router or the AdminAllowlistGuard.
 *
 * Server-side auth: BE route `/api/security-events` is gated by
 * `JwtGuard` + `AdminAllowlistGuard`. Non-allowlisted users receive
 * 404 from the BE; the screen renders the not-found surface and
 * never reveals the route's purpose.
 */
export default function AdminSecurityPage() {
  return <AdminSecurityEventsScreen />;
}
