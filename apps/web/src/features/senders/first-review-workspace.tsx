'use client';

import type { ReactNode } from 'react';
import {
  editorialColumnStyle,
  editorialTitleStyle,
  EditorialKicker,
} from '@/features/editorial/page';
import { ScreenerRoute } from '@/features/screener/screener-route';

/**
 * The first-review view retains the actual Screener capability gate, reads,
 * and decision lifecycle. This is not a filter of the general Senders list.
 */
export function FirstReviewWorkspace({
  navigation,
  active = true,
}: {
  navigation?: ReactNode;
  active?: boolean;
}) {
  return (
    <div style={{ ...editorialColumnStyle, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <header>
        <EditorialKicker>Your mailbox</EditorialKicker>
        <h1 style={editorialTitleStyle}>Senders</h1>
      </header>
      {navigation}
      <ScreenerRoute presentation="senders" active={active} />
    </div>
  );
}
