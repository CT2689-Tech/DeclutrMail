'use client';

import { Button } from '@declutrmail/shared';
import { SettingsRow } from '../settings-list';

/**
 * Settings → Actions → replay the verb tour (D38).
 *
 * D38 gives the onboarding tour exactly one showing, so the only way
 * back to it is a manual re-trigger from Settings — this row. It
 * carries no "seen / not seen" status: the tour is available on demand
 * either way, and a status line would only invite the user to reason
 * about a flag that changes nothing they can act on.
 *
 * Dumb component: the container owns the dialog state.
 */
export function VerbTourCard({ onReplay }: { onReplay: () => void }) {
  return (
    <SettingsRow label="What the five decisions do">
      <Button tone="default" size="sm" onClick={onReplay}>
        Replay the tour
      </Button>
    </SettingsRow>
  );
}
