import { ImageResponse } from 'next/og';

/**
 * Default Open Graph card (D134 SEO, D223 headline, D1/D2 palette).
 *
 * Programmatic — rendered by Satori at request/build time so the card
 * always carries the locked headline. Lives at the app root so every
 * route (marketing + legal) inherits it until a page overrides.
 */

export const alt = 'DeclutrMail — Control Gmail by sender, not by email.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const INK = '#0E1413';
const PAPER = '#FAFAF7';
const TEAL = '#006B5F';
const MUTED = '#646D69';

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: PAPER,
        padding: '64px 72px',
        position: 'relative',
      }}
    >
      {/* Newspaper double rule */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 10,
          background: INK,
          display: 'flex',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 0,
          right: 0,
          height: 2,
          background: 'rgba(14,20,19,0.25)',
          display: 'flex',
        }}
      />

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 26,
          color: MUTED,
          letterSpacing: 4,
          marginTop: 24,
        }}
      >
        <span>DECLUTRMAIL</span>
        <span style={{ color: TEAL }}>GMAIL CLEANUP, BY SENDER</span>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          justifyContent: 'center',
          fontSize: 92,
          fontWeight: 700,
          color: INK,
          lineHeight: 1.05,
          letterSpacing: -3,
        }}
      >
        <span>Control Gmail by</span>
        <span>
          <span style={{ color: TEAL }}>sender</span>, not by email.
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderTop: `2px solid rgba(14,20,19,0.18)`,
          paddingTop: 28,
          fontSize: 27,
          color: MUTED,
        }}
      >
        <span>
          Full bodies fetched: <span style={{ color: TEAL, marginLeft: 10 }}>0</span>
        </span>
        <span>One decision per sender · undo on everything</span>
      </div>
    </div>,
    size,
  );
}
