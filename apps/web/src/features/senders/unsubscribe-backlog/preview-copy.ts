import { fillCopy, isPluralCopy, pluralCopy, WS5_COPY } from '@declutrmail/shared/copy/launch';

export type UnsubscribeBacklogMode = 'unsub_only' | 'archive' | 'delete';

/** Future-mail sentence for one sender. Null when the channel is unknown. */
export function futureMailLine(name: string, method: string | null | undefined): string | null {
  if (method === 'mailto') return fillCopy(WS5_COPY['f1.preview.future.mailto'], { Sender: name });
  if (method === 'none') return fillCopy(WS5_COPY['f1.preview.future.none'], { Sender: name });
  if (method === 'one_click') return fillCopy(WS5_COPY['f1.preview.future'], { Sender: name });
  return null;
}

export function backlogMailLine(mode: UnsubscribeBacklogMode, n: number): string {
  if (mode === 'archive' && isPluralCopy(WS5_COPY['f1.preview.backlog.archive'])) {
    return pluralCopy(WS5_COPY['f1.preview.backlog.archive'], n, { n });
  }
  if (mode === 'delete' && isPluralCopy(WS5_COPY['f1.preview.backlog.delete'])) {
    return pluralCopy(WS5_COPY['f1.preview.backlog.delete'], n, { n });
  }
  return WS5_COPY['f1.preview.backlog.unsubOnly'];
}

/**
 * Count titles do not need a sender name. The bulk strings have no `one`
 * form, so a single unnamed sender reads "{k} senders".
 */
export function unnamedUnsubscribeTitle(mode: UnsubscribeBacklogMode, emailCount: number): string {
  const k = (1).toLocaleString('en-US');
  const n = emailCount.toLocaleString('en-US');
  if (mode === 'delete') return fillCopy(WS5_COPY['f1.title.bulk.delete'], { k, n });
  if (mode === 'archive') return fillCopy(WS5_COPY['f1.title.bulk.archive'], { k, n });
  return fillCopy(WS5_COPY['f1.title.bulk.unsubOnly'], { k });
}

export function unsubscribeTitle(
  mode: UnsubscribeBacklogMode,
  senderName: string,
  n: number,
): string {
  if (senderName.trim() === '') return unnamedUnsubscribeTitle(mode, n);
  if (mode === 'archive' && isPluralCopy(WS5_COPY['f1.title.archive'])) {
    return pluralCopy(WS5_COPY['f1.title.archive'], n, { n, Sender: senderName });
  }
  if (mode === 'delete' && isPluralCopy(WS5_COPY['f1.title.delete'])) {
    return pluralCopy(WS5_COPY['f1.title.delete'], n, { n, Sender: senderName });
  }
  return fillCopy(WS5_COPY['f1.title.unsubOnly'], { Sender: senderName });
}

export function unsubscribeHonesty(mode: UnsubscribeBacklogMode): string {
  if (mode === 'delete') return WS5_COPY['f1.honesty.delete'];
  if (mode === 'archive') return WS5_COPY['f1.honesty.archive'];
  return WS5_COPY['f1.honesty.unsubOnly'];
}

export function unsubscribeButton(mode: UnsubscribeBacklogMode): string {
  if (mode === 'delete') return WS5_COPY['f1.button.delete'];
  if (mode === 'archive') return WS5_COPY['f1.button.archive'];
  return WS5_COPY['f1.button.unsubOnly'];
}
