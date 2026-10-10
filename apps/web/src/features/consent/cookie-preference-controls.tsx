'use client';

import { useEffect, useState } from 'react';
import {
  CONSENT_CHANGE_EVENT,
  readStoredConsent,
  storeConsent,
  type CookieConsent,
} from '@/lib/cookie-consent';
import { withdrawAnalyticsConsent } from '@/lib/posthog';

import styles from './cookie-preference-controls.module.css';

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
export function CookiePreferenceControls({ analyticsDetail }: { analyticsDetail: string }) {
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
        detail={analyticsDetail}
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
    <label className={styles.option} data-selected={checked ? 'true' : 'false'}>
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
        <span className={styles.title}>{title}</span>{' '}
        <span className={styles.detail}>— {detail}</span>
      </span>
    </label>
  );
}
