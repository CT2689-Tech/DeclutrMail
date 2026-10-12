'use client';

import type { ReactNode } from 'react';
import { EmptyState } from '../empty-state';

/**
 * Calm end state. One title, an optional count, and one action.
 * The screen fires `caught_up_viewed`; this primitive does not.
 */
export function CaughtUp({
  title,
  description,
  count,
  action,
}: {
  title: string;
  description?: string;
  count?: string;
  action?: ReactNode;
}) {
  return (
    <EmptyState
      title={title}
      {...(description == null ? {} : { description })}
      {...(action == null ? {} : { action })}
      {...(count == null
        ? {}
        : {
            icon: (
              <span style={{ fontVariantNumeric: 'tabular-nums' }} aria-hidden="true">
                {count}
              </span>
            ),
          })}
    />
  );
}
