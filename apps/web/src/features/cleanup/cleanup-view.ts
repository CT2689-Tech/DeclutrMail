export type CleanupView = 'all' | 'guided' | 'first-review';

export function cleanupView(value: string | null | undefined): CleanupView {
  return value === 'guided' || value === 'first-review' ? value : 'all';
}

export function cleanupViewHref(view: CleanupView, search = ''): string {
  const params = new URLSearchParams(search);
  if (view === 'all') params.delete('view');
  else params.set('view', view);
  const query = params.toString();
  return `/senders${query ? `?${query}` : ''}`;
}
