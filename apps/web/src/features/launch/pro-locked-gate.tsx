'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ComingWithPro } from '@declutrmail/shared';
import { PRO_PURCHASABLE } from '@declutrmail/shared/copy/screen-decisions';
import { hasCapability, TIER_MANIFEST, type Capability } from '@declutrmail/shared/entitlements';

import { useTier } from '@/features/auth/api/use-tier';
import { TierGate } from '@/features/billing/tier-gate';
import { apiPost } from '@/lib/api/client';
import { track } from '@/lib/posthog';

const JOINED_KEY = 'dm.pro-waitlist.joined';

type WaitlistStatus = 'joined' | 'already_joined';

function readJoined(): boolean {
  try {
    return window.localStorage.getItem(JOINED_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberJoined(): void {
  try {
    window.localStorage.setItem(JOINED_KEY, '1');
  } catch {
    // Private mode still shows the joined message for this view.
  }
}

/**
 * Pro feature gate while Pro is not for sale. Children stay unmounted
 * so the feature fetch never starts. The priced TierGate returns only
 * when PRO_PURCHASABLE is flipped on.
 */
export function ProLockedGate({
  capability,
  source,
  title,
  pitch,
  children,
}: {
  capability: Capability;
  source: 'brief' | 'followups';
  title: string;
  pitch: string;
  children: ReactNode;
}) {
  const { tier } = useTier();
  const granted = hasCapability(tier, capability);
  const [joined, setJoined] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const inflight = useRef(false);

  useEffect(() => {
    setJoined(readJoined());
  }, []);

  if (granted) return <>{children}</>;
  if (PRO_PURCHASABLE) {
    return (
      <TierGate capability={capability} title={title} pitch={pitch}>
        {children}
      </TierGate>
    );
  }

  const onJoin = () => {
    if (inflight.current || joined) return;
    inflight.current = true;
    setBusy(true);
    setError(false);
    void apiPost<{ status: WaitlistStatus }>('/api/v1/waitlist', { kind: 'pro', source })
      .then((result) => {
        const status = result.data.status;
        if (status !== 'joined' && status !== 'already_joined') {
          setError(true);
          return;
        }
        rememberJoined();
        setJoined(true);
        void track('waitlist_joined', { tier_interest: 'pro', source });
      })
      .catch(() => {
        setError(true);
      })
      .finally(() => {
        inflight.current = false;
        setBusy(false);
      });
  };

  return (
    <ComingWithPro
      proName={TIER_MANIFEST.pro.name}
      title={title}
      pitch={pitch}
      joined={joined}
      busy={busy}
      error={error}
      onJoin={onJoin}
    />
  );
}
