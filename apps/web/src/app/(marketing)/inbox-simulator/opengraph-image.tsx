import { ImageResponse } from 'next/og';

/**
 * Route-level Open Graph card for /inbox-simulator.
 *
 * The simulator is the link that gets shared into threads where the reader
 * has not heard of the product, and the default brand card unfurls as a
 * headline — so the thing being shared looked like an ad for a company
 * rather than a demo of a mechanism. This card unfurls as the mechanism
 * itself: an action preview, with the count and the exact Gmail changes
 * visible before approval.
 *
 * The sender and count are the illustrative pair the how-to guides already
 * use (`Sale Signal`, 84 current messages), shown here under Archive
 * because that is the reversible action. Synthetic either way, and the
 * card says so, because the page labels every example the same way.
 *
 * Wiring note: this card's public URL carries a build-time suffix and a
 * cache-busting query, so it cannot be pinned by hand. The page instead
 * passes `routeOwnCard: true` to `marketingPageMetadata`, which omits the
 * default card so Next attaches THIS one to og:image and twitter:image.
 * See `features/marketing/page-metadata.ts` for why every other page
 * still pins the default explicitly.
 */

export const alt =
  'DeclutrMail inbox simulator — an action preview showing the exact message count and Gmail label changes before approval, on synthetic data.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const INK = '#0E1413';
const PAPER = '#FAFAF7';
const CARD = '#FFFFFF';
const TEAL = '#006B5F';
const MUTED = '#646D69';
const LINE = 'rgba(14,20,19,0.14)';

export default function InboxSimulatorOpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: PAPER,
        padding: '56px 64px',
        position: 'relative',
      }}
    >
      {/* Same newspaper double rule as the default card, so a reader who
          has seen one recognises the other. */}
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
          fontSize: 24,
          color: MUTED,
          letterSpacing: 4,
          marginTop: 20,
        }}
      >
        <span>DECLUTRMAIL</span>
        <span style={{ color: TEAL }}>INTERACTIVE DEMO — NO SIGNUP</span>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          fontSize: 58,
          fontWeight: 700,
          color: INK,
          lineHeight: 1.06,
          letterSpacing: -1.8,
          marginTop: 26,
        }}
      >
        <span>See exactly what moves</span>
        <span>
          before <span style={{ color: TEAL, margin: '0 16px' }}>anything</span> moves.
        </span>
      </div>

      {/* The action preview, which is the product's actual guarantee. */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          background: CARD,
          border: `2px solid ${LINE}`,
          borderRadius: 18,
          padding: '26px 30px',
          marginTop: 30,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 22,
            color: MUTED,
            letterSpacing: 2,
          }}
        >
          <span>ARCHIVE · SALE SIGNAL</span>
          <span>SYNTHETIC DATA</span>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            fontSize: 46,
            fontWeight: 700,
            color: INK,
            marginTop: 14,
          }}
        >
          <span>84 messages</span>
          <span style={{ color: MUTED, fontSize: 30, fontWeight: 400, marginLeft: 18 }}>
            match right now
          </span>
        </div>
        {/* An unfurled card travels without its page, so the undo qualifier
            travels with the claim — `action-semantics.ts` Archive verbatim,
            not the "Reversible from Activity" shorthand that reads as
            unlimited undo. */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            fontSize: 26,
            color: MUTED,
            marginTop: 12,
          }}
        >
          <span>Removes the Inbox label. Nothing is deleted.</span>
          <span>Undo from Activity during your plan’s Undo window.</span>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderTop: `2px solid rgba(14,20,19,0.18)`,
          paddingTop: 22,
          marginTop: 26,
          fontSize: 25,
          color: MUTED,
        }}
      >
        <span>
          Full bodies fetched: <span style={{ color: TEAL, marginLeft: 10 }}>0</span>
        </span>
        <span>Keep · Archive · Unsubscribe · Later · Delete</span>
      </div>
    </div>,
    size,
  );
}
