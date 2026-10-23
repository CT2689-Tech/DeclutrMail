/** Legacy review links retain their query scope and reach the Senders workspace. */
export function cleanupRedirects() {
  return [
    { source: '/triage', destination: '/senders?view=guided', permanent: false },
    { source: '/screener', destination: '/senders?view=first-review', permanent: false },
  ];
}
