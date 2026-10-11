import { EMPTY_COMPOSE, type ComposeState } from './filters';

export const LAUNCH_FILTERS = [
  { id: 'mostly_unread_90', label: 'Mostly unread (90 days)' },
  { id: 'has_unsubscribe', label: 'Has unsubscribe link' },
] as const;

export type LaunchFilterId = (typeof LAUNCH_FILTERS)[number]['id'];

/** Compose a saved filter writes into the URL. Activity is cleared so the axis is the whole list. */
export function composeForLaunchFilter(id: LaunchFilterId): ComposeState {
  switch (id) {
    case 'mostly_unread_90':
      return { ...EMPTY_COMPOSE, mostlyUnread: true };
    case 'has_unsubscribe':
      return { ...EMPTY_COMPOSE, unsubReady: true };
    default: {
      const _never: never = id;
      return _never;
    }
  }
}

/** The query string `useComposeState` writes for that compose. */
export function launchFilterSearch(id: LaunchFilterId): string {
  const compose = composeForLaunchFilter(id);
  const params = new URLSearchParams();
  params.set('activity', 'all');
  if (compose.unsubReady === true) params.set('unsub_ready', 'true');
  if (compose.mostlyUnread === true) params.set('mostly_unread', 'true');
  return params.toString();
}
