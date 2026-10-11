/** Provider class for the "Not on Gmail?" waitlist. WS3 replaces this with an MX lookup. */
export type ProviderClass =
  'gmail' | 'google_workspace' | 'microsoft' | 'yahoo_aol' | 'icloud' | 'other' | 'unknown';

export async function classifyProvider(email: string): Promise<ProviderClass> {
  void email;
  return 'unknown';
}
