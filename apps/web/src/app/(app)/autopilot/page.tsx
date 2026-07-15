// /autopilot — preset rule review surface (D99–D105, D192, D197).
//
// Active execution stays Pro-only per the D19 manifest. Under-tier users
// mount only the capability-exempt preset-catalog read; suggestions and
// every mutation remain unmounted and server-gated.

import { AutopilotEntitlementSurface } from '@/features/autopilot/autopilot-entitlement-surface';

export const metadata = {
  title: 'Autopilot — DeclutrMail',
};

export default function AutopilotPage() {
  return <AutopilotEntitlementSurface />;
}
