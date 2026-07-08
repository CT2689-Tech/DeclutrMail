'use client';

import { tokens } from '@declutrmail/shared';

const { color, font } = tokens;

/**
 * "Where's Delete?" — one-line note under the triage queue.
 *
 * Founder-ratified verb matrix: Triage keeps exactly the four daily
 * verbs K/A/U/L (D29 + D227); Delete (ADR-0019's fifth canonical verb)
 * lives on the Senders and Sender Detail surfaces, where a sender's
 * full history can be targeted with the D226 preview + Trash-window
 * recovery. This note keeps that split from reading as a missing
 * feature.
 */
export function WhyNoDelete() {
  return (
    <p
      role="note"
      style={{
        margin: 0,
        fontSize: 11.5,
        color: color.fgMuted,
        lineHeight: 1.5,
        fontFamily: font.sans,
      }}
    >
      Looking for Delete? Triage keeps to the four daily verbs — deleting a sender&rsquo;s mail
      lives on{' '}
      <a
        href="/senders"
        style={{
          color: color.fgSoft,
          textDecoration: 'underline',
          textUnderlineOffset: 2,
          textDecorationColor: color.lineSoft,
        }}
      >
        Senders
      </a>{' '}
      and Sender Detail.
    </p>
  );
}
