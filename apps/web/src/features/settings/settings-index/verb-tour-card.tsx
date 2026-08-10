'use client';

import { Button, Card, tokens } from '@declutrmail/shared';

const { color, font } = tokens;

/**
 * Settings → Actions → replay the verb tour (D38).
 *
 * D38 gives the onboarding tour exactly one showing, so the only way
 * back to it is a manual re-trigger from Settings — this card. It
 * carries no "seen / not seen" status: the tour is available on demand
 * either way, and a status line would only invite the user to reason
 * about a flag that changes nothing they can act on.
 *
 * Dumb component: the container owns the dialog state.
 */
export function VerbTourCard({ onReplay }: { onReplay: () => void }) {
  return (
    <Card padding={0}>
      <div style={{ padding: '18px 20px', fontFamily: font.sans }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: color.fg }}>
          What the five decisions do
        </h3>
        <p
          style={{
            fontSize: 13,
            color: color.fgSoft,
            lineHeight: 1.55,
            margin: '8px 0 0',
          }}
        >
          Keep, Archive, Unsubscribe, Later, and Delete — what each one does to a sender&rsquo;s
          mail, and the key that triggers it. Shown once during setup; open it again whenever you
          want.
        </p>
        <div style={{ marginTop: 12 }}>
          <Button tone="default" size="sm" onClick={onReplay}>
            Replay the tour
          </Button>
        </div>
      </div>
    </Card>
  );
}
