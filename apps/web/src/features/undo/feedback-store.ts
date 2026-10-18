import { create } from 'zustand';
import type { InFlightActionGroup } from '@/lib/api/actions';

export type AcceptedAction = Pick<
  InFlightActionGroup,
  'groupId' | 'verb' | 'mixedVerbs' | 'senderCount' | 'senderIds' | 'startedAt'
>;
const scopeKey = (mailboxId?: string) => mailboxId ?? 'active-mailbox';
const EMPTY: AcceptedAction[] = [];

/** Client handles awaiting discovery; server groups/outcomes remain in Query. */
export const useActionFeedbackStore = create<{
  scopes: Record<string, AcceptedAction[]>;
}>()(() => ({ scopes: {} }));

export function pendingActionFeedback(mailboxId?: string): AcceptedAction[] {
  return useActionFeedbackStore.getState().scopes[scopeKey(mailboxId)] ?? EMPTY;
}

export function acceptActionFeedback(mailboxId: string | undefined, action: AcceptedAction): void {
  const key = scopeKey(mailboxId);
  useActionFeedbackStore.setState(({ scopes }) => ({
    scopes: {
      ...scopes,
      [key]: [...(scopes[key] ?? []).filter((item) => item.groupId !== action.groupId), action],
    },
  }));
}

export function observeActionFeedback(
  mailboxId: string | undefined,
  ids: ReadonlySet<string>,
): void {
  const key = scopeKey(mailboxId);
  useActionFeedbackStore.setState((state) => {
    const current = state.scopes[key];
    return !current?.some((item) => ids.has(item.groupId))
      ? state
      : {
          scopes: { ...state.scopes, [key]: current.filter((item) => !ids.has(item.groupId)) },
        };
  });
}
