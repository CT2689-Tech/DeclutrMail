/** Deterministic date label shared by the banner and deletion confirmation. */
export function formatDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone,
  }).format(new Date(iso));
}
