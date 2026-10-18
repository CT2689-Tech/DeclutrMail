'use client';

import { tokens } from '@declutrmail/shared';
import { track } from '@/lib/posthog';
import type { ComposeState } from './filters';
import { composeForLaunchFilter, LAUNCH_FILTERS, type LaunchFilterId } from './launch-filters';

export function LaunchFilterRow({
  mailboxId,
  onApply,
}: {
  mailboxId: string | null;
  onApply: (next: ComposeState) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Filter shortcuts"
      style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
    >
      <span style={{ alignSelf: 'center', color: tokens.color.fgMuted, fontSize: tokens.text.sm }}>
        Filter shortcuts
      </span>
      {LAUNCH_FILTERS.map((filter) => (
        <button
          key={filter.id}
          type="button"
          style={{
            background: 'transparent',
            color: tokens.color.fgSoft,
            border: `1px solid ${tokens.color.line}`,
            borderRadius: tokens.radius.pill,
            padding: '6px 12px',
            font: 'inherit',
            fontSize: tokens.text.sm,
            cursor: 'pointer',
          }}
          className="dm-tap-44"
          aria-label={`Apply filter: ${filter.label}`}
          onClick={() => apply(filter.id, mailboxId, onApply)}
        >
          {filter.label}
        </button>
      ))}
    </div>
  );
}

function apply(
  id: LaunchFilterId,
  mailboxId: string | null,
  onApply: (next: ComposeState) => void,
): void {
  onApply(composeForLaunchFilter(id));
  if (!mailboxId) return;
  void track('compose_filter_changed', {
    axis: 'volume',
    op: 'set',
    active_axes: 1,
    mailbox_id: mailboxId,
    filter_id: id,
  });
}
