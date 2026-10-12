const DAY_MS = 24 * 60 * 60 * 1000;

/** Day-one Triage drops the today framing. A missing timestamp is not day one. */
export function triageDaySubtitle(
  onboardedAt: string | null | undefined,
  nowMs: number,
): 'A few senders to start · one choice each' | 'Today’s senders · one choice each' {
  if (onboardedAt) {
    const at = Date.parse(onboardedAt);
    if (Number.isFinite(at) && nowMs >= at && nowMs - at < DAY_MS) {
      return 'A few senders to start · one choice each';
    }
  }
  return 'Today’s senders · one choice each';
}
