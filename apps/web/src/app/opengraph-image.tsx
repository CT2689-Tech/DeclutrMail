import { ImageResponse } from 'next/og';

import { ogMarkDataUri } from '@/features/marketing/og/brand-mark';
import { ogFonts } from '@/features/marketing/og/fonts';

/**
 * Default Open Graph card (D134 SEO, D250 headline — reverses D223,
 * D1/D2 palette).
 *
 * Programmatic — rendered by Satori at request/build time so the card
 * always carries the locked headline. Lives at the app root so every
 * route (marketing + legal) inherits it until a page overrides.
 */

export const alt =
  'DeclutrMail — Clear thousands of emails by sender — and see exactly what moves.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const INK = '#0E1413';
const PAPER = '#FAFAF7';
const TEAL = '#006B5F';
const MUTED = '#646D69';

export default async function OpenGraphImage() {
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
          marginTop: 24,
        }}
      >
        {/* Masthead. The mark leads and the wordmark is set properly cased
            with Mail accented — ADR-0036 specifies `DeclutrMail`, and the
            capital M is load-bearing: it is the seam the accent lands on,
            which an all-caps setting destroys.

            Two sibling spans rather than one string with a nested span:
            Satori lays element children out as flex items, so this is what
            keeps the seam tight and the colours on the right halves. */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <img src={ogMarkDataUri('ink')} width={46} height={46} alt="" />
          <div
            style={{
              display: 'flex',
              marginLeft: 14,
              fontFamily: 'Fraunces',
              fontSize: 34,
              fontWeight: 800,
              // ADR-0036 locks -0.03em; resolved to px because
              // Satori does not reliably honour em for letterSpacing.
              letterSpacing: -1.02,
            }}
          >
            <span style={{ color: INK }}>Declutr</span>
            <span style={{ color: TEAL }}>Mail</span>
          </div>
        </div>
        <span style={{ fontSize: 26, color: MUTED, letterSpacing: 4 }}>
          FOR INBOXES YOU GAVE UP ON
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          justifyContent: 'center',
          // 72px fits the locked three-line headline inside 630px with
          // the eyebrow + badge footer (was 92px for the two-line D223).
          fontFamily: 'Fraunces',
          fontSize: 72,
          fontWeight: 800,
          color: INK,
          lineHeight: 1.08,
          letterSpacing: -2,
        }}
      >
        <span>Clear thousands of emails</span>
        <span>
          {/* Margins, not literal spaces: Satori lays element children
              out as flex items and drops the whitespace between them. */}
          by <span style={{ color: TEAL, margin: '0 18px' }}>sender</span> — and see
        </span>
        <span>exactly what moves.</span>
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
        <span>Full email contents stay in Gmail</span>
        <span>Keep · Archive · Unsubscribe · Later · Delete</span>
      </div>
    </div>,
    { ...size, fonts: await ogFonts() },
  );
}
