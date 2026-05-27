// /settings — Settings root.
//
// One sub-page lives today (`/settings/senders` — standing sender
// policies). The root page introduces the section and points at the
// shipped sub-page so the sidebar nav resolves to something useful.
//
// When more sub-pages land (account, notifications, billing redirect,
// data export), this file becomes a real index with multiple cards.

import { RoutePlaceholder } from '@/features/route-placeholder/route-placeholder';

export const metadata = {
  title: 'Settings — DeclutrMail',
};

export default function SettingsPage() {
  return (
    <RoutePlaceholder
      status="Settings"
      title="Sender policies are live"
      description={
        <>
          The standing-policies surface — VIP, Protect, Always Archive — is shipped. The rest of the
          settings index (notifications, data export, account) lands in subsequent slices.
        </>
      }
      decisions={[]}
      primaryCta={{ href: '/settings/senders', label: 'Open sender policies' }}
      secondaryCta={{ href: '/autopilot', label: 'Open Autopilot' }}
    />
  );
}
