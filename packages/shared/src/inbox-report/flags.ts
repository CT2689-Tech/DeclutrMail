/** Dev and test default on. Production stays off until the launch switch. */
export function isInboxReportEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.NEXT_PUBLIC_INBOX_REPORT_ENABLED ?? env.INBOX_REPORT_ENABLED;
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  return env.NODE_ENV !== 'production';
}
