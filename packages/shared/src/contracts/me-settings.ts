import { z } from 'zod';

import { ActionSheetPrefsSchema } from './action-sheet-prefs';
import { EmailPrefsSchema } from './email-prefs';

/**
 * GET /api/me/settings response `data` (D34 + D116 + D165).
 *
 * One read for the Settings index — the per-key PATCH endpoints
 * (`/api/me/email-prefs`, `/api/me/action-sheet-prefs`) each return
 * their own slice; the FE folds the result back into this query's
 * cache. USER-scoped (no mailbox guard): settings must render with
 * zero connected mailboxes.
 */
export const MeSettingsSchema = z.object({
  emailPrefs: EmailPrefsSchema,
  actionSheetPrefs: ActionSheetPrefsSchema,
});

export type MeSettings = z.infer<typeof MeSettingsSchema>;
