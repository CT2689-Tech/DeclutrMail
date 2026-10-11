import { loadAiConsentForMailbox } from '@declutrmail/db';
import { briefConsentActive, explanationsConsentActive } from '@declutrmail/shared/ai-consent';

/** Fail closed. A lookup error hides stored AI prose. Consent is the only gate. */
export async function showStoredExplanations(
  db: unknown,
  mailboxAccountId: string,
): Promise<boolean> {
  try {
    const row = await loadAiConsentForMailbox(db, mailboxAccountId);
    return explanationsConsentActive(row);
  } catch {
    return false;
  }
}

/**
 * Same fail-closed rule for a stored Brief narrative. Revocation is
 * visible on the next read: this checks the row, not the last worker tick.
 */
export async function showStoredBrief(db: unknown, mailboxAccountId: string): Promise<boolean> {
  try {
    const row = await loadAiConsentForMailbox(db, mailboxAccountId);
    return briefConsentActive(row);
  } catch {
    return false;
  }
}
