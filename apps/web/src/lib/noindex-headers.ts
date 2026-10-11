/** App and onboarding routes. Marketing routes are not in this list. */
export const NOINDEX_SOURCES = [
  '/home',
  '/home/:path*',
  '/senders',
  '/senders/:path*',
  '/brief',
  '/brief/:path*',
  '/settings',
  '/settings/:path*',
  '/triage',
  '/triage/:path*',
  '/autopilot',
  '/autopilot/:path*',
  '/followups',
  '/followups/:path*',
  '/later',
  '/later/:path*',
  '/quiet',
  '/quiet/:path*',
  '/billing',
  '/billing/:path*',
  '/screener',
  '/screener/:path*',
  '/activity',
  '/activity/:path*',
  '/admin/:path*',
  '/onboarding',
  '/onboarding/:path*',
] as const;

export function noindexHeaderRules(): Array<{
  source: string;
  headers: Array<{ key: string; value: string }>;
}> {
  return NOINDEX_SOURCES.map((source) => ({
    source,
    headers: [{ key: 'X-Robots-Tag', value: 'noindex' }],
  }));
}
