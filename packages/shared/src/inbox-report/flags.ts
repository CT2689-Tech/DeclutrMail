/** Dev, test, and Vercel preview default on. Production stays off until the launch switch. */
export function isInboxReportEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.NEXT_PUBLIC_INBOX_REPORT_ENABLED ?? env.INBOX_REPORT_ENABLED;
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  const deploy = env.NEXT_PUBLIC_TELEMETRY_ENVIRONMENT ?? env.VERCEL_ENV;
  if (deploy === 'preview') return true;
  if (deploy === 'production') return false;
  return env.NODE_ENV !== 'production';
}

/** Share card stays off until it is explicitly switched on. */
export function isInboxReportShareEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.NEXT_PUBLIC_INBOX_REPORT_SHARE_ENABLED ?? env.INBOX_REPORT_SHARE_ENABLED;
  return raw === '1' || raw === 'true';
}

/** Read-only size-by-sender stays off until the launch switch. */
export function isSenderSizeViewEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.NEXT_PUBLIC_SENDER_SIZE_VIEW ?? env.SENDER_SIZE_VIEW;
  return raw === '1' || raw === 'true';
}
