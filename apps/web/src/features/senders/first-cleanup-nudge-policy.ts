/** Unknown summary, incomplete mailbox or empty filtered list cannot promise a first cleanup. */
export function shouldShowFirstCleanupNudge(args: {
  mailboxReady: boolean;
  hasCompletedCleanup: boolean | undefined;
  visibleSenderCount: number;
}): boolean {
  return args.mailboxReady && args.hasCompletedCleanup === false && args.visibleSenderCount > 0;
}
