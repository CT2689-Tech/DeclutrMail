import { loadAiConsentForMailbox } from '@declutrmail/db';
import { explainLlmEnabled, explanationsConsentActive } from '@declutrmail/shared/ai-consent';

/** Fail closed. A kill switch or a lookup error hides stored AI prose. */
export async function showStoredExplanations(
  db: unknown,
  mailboxAccountId: string,
): Promise<boolean> {
  if (!explainLlmEnabled()) return false;
  try {
    const row = await loadAiConsentForMailbox(db, mailboxAccountId);
    return explanationsConsentActive(row);
  } catch {
    return false;
  }
}
