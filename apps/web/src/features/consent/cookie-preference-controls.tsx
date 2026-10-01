'use client';

import { useEffect, useState } from 'react';
import { ANALYTICS_PRIVACY_CLAIM, tokens } from '@declutrmail/shared';
import {
  CONSENT_CHANGE_EVENT,
  readStoredConsent,
  storeConsent,
  type CookieConsent,
} from '@/lib/cookie-consent';
import { withdrawAnalyticsConsent } from '@/lib/posthog';

const { color, radius } = tokens;

/**
 * Cookie preferences — the D147 banner's change/withdrawal counterpart
 * (GDPR Art. 7(3): withdrawing consent must be as easy as giving it).
 * The banner shows once and never returns after a choice; this card is
 * the standing surface to revisit that choice. Mounted in Settings →
 * Privacy & data and on the public /cookies page.
 *
 * Apply-on-select (same interaction as the settings toggles — no Save
 * button): picking "Essential only" calls `withdrawAnalyticsConsent()`
 * (store flip + SDK identity reset; capture stops immediately), picking
 * "Accept all" stores the grant — the per-call consent gate in
 * `lib/posthog.ts` picks it up on the next `track()`.
 *
 * No stored choice renders as "Essential only" selected — that IS the
 * effective state (decline by default), and selecting it makes the
 * decline explicit (which also retires the banner).
 */
export function CookiePreferenceControls() {
  const [stored, setStored] = useState<CookieConsent | null>(null);

  // Storage is read post-mount, same as the banner — SSR and the first
  // client paint agree (essential-only selected), so hydration never
  // mismatches. The listener keeps the card honest when the choice is
  // made on ANOTHER surface in the same tab (the banner floats over
  // both pages this card mounts on).
  useEffect(() => {
    const sync = () => setStored(readStoredConsent());
    sync();
    window.addEventListener(CONSENT_CHANGE_EVENT, sync);
    return () => window.removeEventListener(CONSENT_CHANGE_EVENT, sync);
  }, []);

  const selected: CookieConsent = stored ?? 'essential';

  const select = (next: CookieConsent) => {
    if (next === stored) return;
    if (next === 'essential') {
      // Also covers the no-choice case: makes the default decline
      // explicit (stores it) without ever having granted anything.
      void withdrawAnalyticsConsent();
    } else {
      storeConsent('all');
    }
    setStored(next);
  };

  return (
    <>
      <ConsentRadio
        value="all"
        checked={selected === 'all'}
        onSelect={select}
        title="Accept all"
        detail={`Also allow PostHog analytics so we can see which features matter. ${ANALYTICS_PRIVACY_CLAIM}`}
      />
      <ConsentRadio
        value="essential"
        checked={selected === 'essential'}
        onSelect={select}
        title="Essential only"
        detail="No PostHog analytics — only the cookies needed for sign-in and billing."
      />
    </>
  );
}

function ConsentRadio({
  value,
  checked,
  onSelect,
  title,
  detail,
}: {
  value: CookieConsent;
  checked: boolean;
  onSelect: (choice: CookieConsent) => void;
  title: string;
  detail: string;
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 8,
        padding: '8px 10px',
        background: checked ? color.primarySoft : color.card,
        border: `1px solid ${checked ? color.primaryBorder : color.line}`,
        borderRadius: radius.md,
        cursor: 'pointer',
        fontSize: 12.5,
      }}
    >
      <input
        type="radio"
        name="cookie-consent"
        value={value}
        checked={checked}
        // onClick instead of onChange (with readOnly to keep React's
        // controlled-input contract): clicking "Essential only" while it
        // is merely the DEFAULT (no stored choice) must still store an
        // explicit decline, and a checked radio fires click but never
        // change. onChange alongside onClick would double-fire.
        readOnly
        onClick={() => onSelect(value)}
      />
      <span>
        <span style={{ fontWeight: 600, color: color.fg }}>{title}</span>{' '}
        <span style={{ color: color.fgMuted }}>— {detail}</span>
      </span>
    </label>
  );
}
