/**
 * Private-beta invite gate (buildout F7).
 *
 * Gates NEW USER CREATION on the unauthenticated Google OAuth login
 * flow. Existing users — including emails connected as secondary
 * mailboxes, whose owner is an existing user — always pass; the gate
 * fires ONLY at the point a brand-new user row would be bootstrapped
 * (`AuthSignupOrchestrator.connect`, branch 3 of identity resolution).
 *
 * Env contract (.env.example):
 *   BETA_GATE_ENABLED  — the gate is active ONLY when exactly 'true'.
 *                        Unset / any other value → open signup, so the
 *                        default is ZERO behavior change until the
 *                        founder flips it in the deploy env.
 *   BETA_INVITE_EMAILS — comma-separated allowlist. Matching is
 *                        case-insensitive and whitespace-trimmed;
 *                        empty entries are ignored. With the gate
 *                        enabled and this unset, EVERY new signup is
 *                        denied (fail-closed).
 */
export function betaGateAllowsSignup(email: string): boolean {
  if (process.env.BETA_GATE_ENABLED !== 'true') return true;
  const invited = (process.env.BETA_INVITE_EMAILS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  return invited.includes(email.trim().toLowerCase());
}

/**
 * Sentinel thrown by `AuthSignupOrchestrator.connect` when the beta
 * gate denies a brand-new signup — BEFORE any side effect (no
 * workspace/user bootstrap, no token encryption, no mailbox row, no
 * session). The OAuth callback controller catches it and 302s to the
 * public `/beta` waitlist page instead of bubbling an error response.
 */
export class BetaGateDeniedError extends Error {
  constructor() {
    super('Private beta: this email is not on the invite list.');
    this.name = 'BetaGateDeniedError';
  }
}
