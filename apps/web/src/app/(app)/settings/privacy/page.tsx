// /settings/privacy — Privacy & Data sub-page (D116, D217, D228).
//
// The dedicated trust surface: the D228 privacy badge ("We never fetch or
// store full email contents." + the explicit storage list), indexed mailboxes, undo
// retention, the DPDP data export (JSON/CSV of allowlisted columns
// only), leave-cleanly pointers, and the CASA evidence row.

import { PrivacyDataRoute } from '@/features/settings/privacy-data/privacy-data-screen';
import {
  PrivacyDataContent,
  PRIVACY_DATA_EXPORT_COPY,
} from '@/features/settings/privacy-data/privacy-data-content';

export const metadata = {
  title: 'Privacy & Data — DeclutrMail',
};

/** Privacy content is available immediately; the retention row owns billing loading. */
export default function SettingsPrivacyPage() {
  return (
    <PrivacyDataRoute
      privacyContent={<PrivacyDataContent />}
      exportCopy={PRIVACY_DATA_EXPORT_COPY}
    />
  );
}
