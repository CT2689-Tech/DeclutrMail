// /autopilot — preset rule review surface (D99–D105, D192, D197).
//
// Pro-only per the D19 manifest. Without the TierGate this page fired
// the rules query on free tier and rendered the API's 402 as a broken
// "We couldn't load Autopilot (HTTP 402)" error card (2026-07-10
// dogfood) — the gate renders the D68 upgrade placeholder instead and
// stops the under-tier fetch from ever firing.

import { TierGate } from '@/features/billing/tier-gate';
import { AutopilotRoute } from '@/features/autopilot/autopilot-screen';

export const metadata = {
  title: 'Autopilot — DeclutrMail',
};

export default function AutopilotPage() {
  return (
    <TierGate
      capability="autopilot"
      title="Autopilot"
      pitch="Rules that watch slices of your inbox and propose cleanups — suggestions, not actions. Every rule starts in Observe mode; nothing moves until you approve it."
      bullets={[
        'Five preset rules cover the common cleanup patterns',
        'Every match lands as a suggestion you approve or dismiss',
        'Pause all rules across every inbox with one switch',
      ]}
    >
      <AutopilotRoute />
    </TierGate>
  );
}
