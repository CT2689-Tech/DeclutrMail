import { WS5_COPY } from '@declutrmail/shared/copy/launch';

/** Fresh preview counts only; received totals and cached row counts are not current mail. */
export interface DeleteEmptyContext {
  inboxTotal?: number | null | undefined;
  allMailTotal?: number | null | undefined;
  allMailWindowCount?: number | null | undefined;
  excludedSenders?: boolean | undefined;
  noIncludedSenders?: boolean | undefined;
  onAnyAge?: (() => void) | undefined;
  onIncludeArchived?: (() => void) | undefined;
  onUnsubscribeOnly?: (() => void) | undefined;
}

/** Called only for a settled zero at the selected age and reach. Changes preview filters only. */
export function deleteEmptyState(
  context: DeleteEmptyContext,
  includesArchived: boolean,
  olderThanDays: number | null,
): {
  title: string;
  hint?: string;
  action?: { label: string; onClick: () => void; focus: 'age' | 'reach' | 'unsubscribe' };
} {
  if (context.noIncludedSenders) {
    return {
      title: WS5_COPY['preview.empty.noSenders'],
      hint: WS5_COPY['preview.empty.selection'],
    };
  }
  if (context.inboxTotal === 0 && context.allMailTotal === 0) {
    return {
      title: WS5_COPY[context.excludedSenders ? 'preview.empty.included' : 'preview.empty.mailbox'],
      ...(context.onUnsubscribeOnly
        ? {
            action: {
              label: WS5_COPY['preview.empty.unsubOnly'],
              onClick: context.onUnsubscribeOnly,
              focus: 'unsubscribe',
            },
          }
        : { hint: WS5_COPY['preview.empty.cancel'] }),
    };
  }
  const scopeTotal = includesArchived ? context.allMailTotal : context.inboxTotal;
  if (
    olderThanDays !== null &&
    typeof scopeTotal === 'number' &&
    scopeTotal > 0 &&
    context.onAnyAge
  ) {
    return {
      title: WS5_COPY['preview.empty.age'],
      action: { label: WS5_COPY['preview.empty.anyAge'], onClick: context.onAnyAge, focus: 'age' },
    };
  }
  if (!includesArchived && typeof context.allMailTotal === 'number' && context.allMailTotal > 0) {
    if (
      (olderThanDays === null || (context.allMailWindowCount ?? 0) > 0) &&
      context.onIncludeArchived
    ) {
      return {
        title: WS5_COPY['preview.empty.archived'],
        action: {
          label: WS5_COPY['preview.empty.includeArchived'],
          onClick: context.onIncludeArchived,
          focus: 'reach',
        },
      };
    }
    if (olderThanDays !== null && context.onAnyAge && context.onIncludeArchived) {
      return {
        title: WS5_COPY['preview.empty.filters'],
        action: {
          label: WS5_COPY['preview.empty.showAll'],
          focus: 'age',
          onClick: () => {
            context.onAnyAge?.();
            context.onIncludeArchived?.();
          },
        },
      };
    }
  }
  return {
    title: WS5_COPY['preview.impact.none'],
    ...(context.onUnsubscribeOnly
      ? {
          action: {
            label: WS5_COPY['preview.empty.unsubOnly'],
            onClick: context.onUnsubscribeOnly,
            focus: 'unsubscribe' as const,
          },
        }
      : {
          hint: WS5_COPY[
            context.onAnyAge || context.onIncludeArchived
              ? 'preview.empty.changeFilters'
              : 'preview.empty.cancel'
          ],
        }),
  };
}
