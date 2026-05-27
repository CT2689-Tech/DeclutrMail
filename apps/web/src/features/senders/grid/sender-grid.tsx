'use client';

/**
 * `SenderGrid` — grid layout of sender cards (D49 default view).
 *
 * Renders `Sender[]` as a responsive `auto-fit` grid of cards. Used
 * when `view === 'grid'` in `useSendersStore` (D49 — grid is
 * default, table is per-session toggle).
 *
 * No intent grouping here — the intent chips (`activeIntent` filter)
 * still apply at the parent level, and the parent decides which
 * subset of senders to feed in. The grid renders a flat list so the
 * `auto-fit` layout can fill the row evenly regardless of intent
 * cardinality.
 */

import type { ActionRequest, Sender } from '../data';
import { SenderCard } from './sender-card';

export interface SenderGridProps {
  senders: Sender[];
  /** Selected ids — controlled by parent (shift-click range + bulk bar). */
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onAction: (req: ActionRequest) => void;
}

export function SenderGrid({ senders, selectedIds, onToggleSelect, onAction }: SenderGridProps) {
  return (
    <div
      data-testid="sender-grid"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
        gap: 12,
      }}
    >
      {senders.map((sender) => (
        <SenderCard
          key={sender.id}
          sender={sender}
          selected={selectedIds.has(sender.id)}
          onToggleSelect={onToggleSelect}
          onAction={onAction}
        />
      ))}
    </div>
  );
}
