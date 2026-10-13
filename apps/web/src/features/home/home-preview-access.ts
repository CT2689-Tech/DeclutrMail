/**
 * Home fixture route. Preview and local dev only.
 * A Vercel preview build runs with NODE_ENV=production, so the gate
 * follows VERCEL_ENV and treats a production deploy as closed.
 */
export function homePreviewEnabled(
  env: { vercelEnv?: string | undefined; nodeEnv?: string | undefined } = {
    vercelEnv: process.env.VERCEL_ENV,
    nodeEnv: process.env.NODE_ENV,
  },
): boolean {
  if (env.vercelEnv === 'preview') return true;
  if (env.vercelEnv === 'production') return false;
  return env.nodeEnv !== 'production';
}
