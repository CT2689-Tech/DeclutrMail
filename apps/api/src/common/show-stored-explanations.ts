import { loadAiConsentForMailbox } from '@declutrmail/db';
import {
  briefConsentActive,
  briefLlmEnabled,
  explainLlmEnabled,
  explanationsConsentActive,
} from '@declutrmail/shared/ai-consent';

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

/**
 * Same fail-closed rule for a stored Brief narrative. Revocation is
 * visible on the next read: this checks the row, not the last worker tick.
 */
export async function showStoredBrief(db: unknown, mailboxAccountId: string): Promise<boolean> {
  if (!briefLlmEnabled()) return false;
  try {
    const row = await loadAiConsentForMailbox(db, mailboxAccountId);
    return briefConsentActive(row);
  } catch {
    return false;
  }
}
