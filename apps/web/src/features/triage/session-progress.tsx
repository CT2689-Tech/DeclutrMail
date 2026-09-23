'use client';

import { tokens } from '@declutrmail/shared';

const { color, font, text } = tokens;

/** The queue backfills, so it has no fixed completion percentage. */
export function SessionProgress({
  decided,
  queued,
  focusPosition,
}: {
  /** Decisions confirmed by the server in this mailbox session. */
  decided: number;
  /** Senders in the current rolling queue. */
  queued: number;
  /** Current card's position within the visible Focus queue. */
  focusPosition?: number;
}) {
  if (queued === 0) return null;

  return (
    <div
      role="status"
      aria-label={`${decided} decided this session; ${queued} in queue${focusPosition == null ? '' : `; reviewing ${focusPosition} of ${queued}`}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontFamily: font.sans,
        fontSize: text.sm,
        fontWeight: 500,
        color: color.fgMuted,
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
      }}
    >
      <span>{decided} decided</span>
      <span aria-hidden="true">·</span>
      <span>
        {focusPosition == null ? `${queued} in queue` : `Reviewing ${focusPosition} of ${queued}`}
      </span>
    </div>
  );
}
