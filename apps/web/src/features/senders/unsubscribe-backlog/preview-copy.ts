import { fillCopy, isPluralCopy, pluralCopy, WS5_COPY } from '@declutrmail/shared/copy/launch';

export type UnsubscribeBacklogMode = 'unsub_only' | 'archive' | 'delete';

/** Deck destination for the backlog the preview counted. Null count is still loading. */
export function backlogDestination(mode: UnsubscribeBacklogMode, n: number | null): string {
  if (mode === 'archive' || mode === 'delete') {
    if (n === null) return WS5_COPY['f1.preview.backlog.loading'];
    return backlogMailLine(mode, n);
  }
  return WS5_COPY['f1.preview.backlog.unsubOnly'];
}

/** Future-mail sentence for one sender. Null when the channel is unknown. */
export function futureMailLine(name: string, method: string | null | undefined): string | null {
  if (method === 'mailto') return fillCopy(WS5_COPY['f1.preview.future.mailto'], { Sender: name });
  if (method === 'none') return fillCopy(WS5_COPY['f1.preview.future.none'], { Sender: name });
  if (method === 'one_click') return fillCopy(WS5_COPY['f1.preview.future'], { Sender: name });
  return null;
}

export function backlogMailLine(mode: UnsubscribeBacklogMode, n: number): string {
  const shown = n.toLocaleString('en-US');
  if (mode === 'archive' && isPluralCopy(WS5_COPY['f1.preview.backlog.archive'])) {
    return pluralCopy(WS5_COPY['f1.preview.backlog.archive'], n, { n: shown });
  }
  if (mode === 'delete' && isPluralCopy(WS5_COPY['f1.preview.backlog.delete'])) {
    return pluralCopy(WS5_COPY['f1.preview.backlog.delete'], n, { n: shown });
  }
  return WS5_COPY['f1.preview.backlog.unsubOnly'];
}

/**
 * Bulk titles count senders, never emails, and do not change with the
 * segment. `one` is a single sender, so it never reads "1 senders".
 */
export function bulkUnsubscribeTitle(
  _mode: UnsubscribeBacklogMode,
  senderCount: number,
  _emailCount: number,
): string {
  return pluralCopy(WS5_COPY['preview.title.bulk.unsub'], senderCount, {
    k: senderCount.toLocaleString('en-US'),
  });
}

/** Count titles do not need a sender name. One unnamed sender uses the `one` form. */
export function unnamedUnsubscribeTitle(mode: UnsubscribeBacklogMode, emailCount: number): string {
  return bulkUnsubscribeTitle(mode, 1, emailCount);
}

/** Every selected sender is Protected. `one` names {Sender}. */
export function allProtectedSelectionCopy(count: number, senderName: string): string {
  const forms = WS5_COPY['f1.selection.allProtected'];
  if (!isPluralCopy(forms)) return '';
  return pluralCopy(forms, count, { k: count.toLocaleString('en-US'), Sender: senderName });
}

/** Some, not all, of the selection is Protected. The bulk path leaves them. */
export function someProtectedSelectionCopy(protectedCount: number): string {
  const forms = WS5_COPY['f1.selection.someProtected'];
  if (!isPluralCopy(forms)) return '';
  return pluralCopy(forms, protectedCount, { k: protectedCount.toLocaleString('en-US') });
}

/** One sender. The segment does not change the title, and the title does not count email. */
export function unsubscribeTitle(
  _mode: UnsubscribeBacklogMode,
  _senderName: string,
  _n: number,
): string {
  return WS5_COPY['preview.title.unsubThisSender'];
}

export function unsubscribeHonesty(mode: UnsubscribeBacklogMode): string {
  if (mode === 'delete') return WS5_COPY['f1.honesty.delete'];
  if (mode === 'archive') return WS5_COPY['f1.honesty.archive'];
  return WS5_COPY['f1.honesty.unsubOnly'];
}

export function unsubscribeButton(
  mode: UnsubscribeBacklogMode,
  _emailCount: number | null = null,
  protectedSender = false,
): string {
  switch (mode) {
    case 'delete':
      return protectedSender
        ? WS5_COPY['f1.button.delete.protected']
        : WS5_COPY['f1.button.delete'];
    case 'archive':
      return protectedSender
        ? WS5_COPY['f1.button.archive.protected']
        : WS5_COPY['f1.button.archive'];
    case 'unsub_only':
      return protectedSender
        ? WS5_COPY['f1.button.unsubOnly.protected']
        : WS5_COPY['f1.button.unsubOnly'];
    default: {
      const unreachable: never = mode;
      return unreachable;
    }
  }
}
