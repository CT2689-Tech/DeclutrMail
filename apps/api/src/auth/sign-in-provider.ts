/** Closed kind for `signin_provider`. The hosted domain is never a value. */
export type SignInProviderKind = 'gmail' | 'workspace';

/**
 * Classify a verified Google identity.
 *
 * A non-empty `hd` claim is Workspace, including when the address is
 * @gmail.com. Otherwise only gmail.com and googlemail.com are `gmail`.
 * Anything else is omitted. The domain string is not returned.
 */
export function signInProviderKind(input: {
  email: string;
  hostedDomain?: string;
}): SignInProviderKind | null {
  const hosted = input.hostedDomain?.trim();
  if (hosted) return 'workspace';
  const email = input.email.trim().toLowerCase();
  if (email.endsWith('@gmail.com') || email.endsWith('@googlemail.com')) return 'gmail';
  return null;
}

/** Attach `providerKind` only when classification succeeds. */
export function withProviderKind<T extends { email: string }>(
  result: T,
  hostedDomain: string | undefined,
): T & { providerKind?: SignInProviderKind } {
  const kind = signInProviderKind(
    hostedDomain === undefined ? { email: result.email } : { email: result.email, hostedDomain },
  );
  return kind === null ? result : { ...result, providerKind: kind };
}
