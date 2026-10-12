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

/** "{n} emails" / "1 email", for the bulk title's {emailCount} token. */
function emailCountPhrase(emailCount: number): string {
  const forms = WS5_COPY['f1.part.emails'];
  if (!isPluralCopy(forms)) return '';
  return pluralCopy(forms, emailCount, { n: emailCount.toLocaleString('en-US') });
}

/**
 * Bulk titles pick `one` from the sender count, so one sender never reads
 * "1 senders". Archive and delete fill {emailCount} from `f1.part.emails`.
 */
export function bulkUnsubscribeTitle(
  mode: UnsubscribeBacklogMode,
  senderCount: number,
  emailCount: number,
): string {
  const k = senderCount.toLocaleString('en-US');
  const emailCountLabel = emailCountPhrase(emailCount);
  if (mode === 'delete') {
    const forms = WS5_COPY['f1.title.bulk.delete'];
    return isPluralCopy(forms)
      ? pluralCopy(forms, senderCount, { k, emailCount: emailCountLabel })
      : '';
  }
  if (mode === 'archive') {
    const forms = WS5_COPY['f1.title.bulk.archive'];
    return isPluralCopy(forms)
      ? pluralCopy(forms, senderCount, { k, emailCount: emailCountLabel })
      : '';
  }
  const forms = WS5_COPY['f1.title.bulk.unsubOnly'];
  return isPluralCopy(forms) ? pluralCopy(forms, senderCount, { k }) : '';
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
