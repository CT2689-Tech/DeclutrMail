'use client';

import { useEffect } from 'react';
import type { JSX } from 'react';

/** WS5 fills this. WS2's FirstLandingSlot imports it. */
export function InboxReportFirstLanding(props: {
  mailboxId: string;
  onResolved(shown: boolean): void;
}): JSX.Element | null {
  const { mailboxId, onResolved } = props;
  useEffect(() => {
    onResolved(false);
  }, [mailboxId, onResolved]);
  return null;
}
