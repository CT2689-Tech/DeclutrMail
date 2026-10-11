import { isInboxReportEnabled } from '@declutrmail/shared/inbox-report';

/**
 * The same gate the API uses. Public env is read as direct `process.env`
 * members so a Next preview build inlines `NEXT_PUBLIC_TELEMETRY_ENVIRONMENT`.
 */
export function inboxReportEnabled(): boolean {
  return isInboxReportEnabled({
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_INBOX_REPORT_ENABLED: process.env.NEXT_PUBLIC_INBOX_REPORT_ENABLED,
    INBOX_REPORT_ENABLED: process.env.INBOX_REPORT_ENABLED,
    NEXT_PUBLIC_TELEMETRY_ENVIRONMENT: process.env.NEXT_PUBLIC_TELEMETRY_ENVIRONMENT,
    VERCEL_ENV: process.env.VERCEL_ENV,
  });
}
