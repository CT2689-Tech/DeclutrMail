export const HOME_PREVIEW_STATES = [
  'full',
  'no-size',
  'caught-up',
  'empty',
  'syncing',
  'queued',
  'failed',
  'reconnect',
  'loading',
  'error',
] as const;

export type HomePreviewState = (typeof HOME_PREVIEW_STATES)[number];

/** Server-safe. The preview page calls this before rendering the client shell. */
export function parseHomePreviewState(value: string | undefined): HomePreviewState {
  return (HOME_PREVIEW_STATES as readonly string[]).includes(value ?? '')
    ? (value as HomePreviewState)
    : 'full';
}
