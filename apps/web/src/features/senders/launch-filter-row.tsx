'use client';

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
      aria-label="Saved filters"
      style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
    >
      {LAUNCH_FILTERS.map((filter) => (
        <button key={filter.id} type="button" onClick={() => apply(filter.id, mailboxId, onApply)}>
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
