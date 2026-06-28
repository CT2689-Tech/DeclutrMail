// /settings/privacy — Privacy & Data sub-page (D116, D217, D228).
//
// The dedicated trust surface: the D228 privacy badge ("Full bodies
// fetched: 0" + the explicit storage list), indexed mailboxes, undo
// retention, the DPDP data export (JSON/CSV of allowlisted columns
// only), leave-cleanly pointers, and the CASA evidence row.

import { PrivacyDataRoute } from '@/features/settings/privacy-data/privacy-data-screen';

export const metadata = {
  title: 'Privacy & Data — DeclutrMail',
};

export default function SettingsPrivacyPage() {
  return <PrivacyDataRoute />;
}
