import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FIRST_LANDING_SLOT_ORDER } from '../../copy/screen-decisions';
import { WS2_COPY } from '../../copy/launch/ws2';
import { BannerSlot, BANNER_SLOT_ORDER, resolveBanner } from './banner-slot';
import { ComingWithPro } from './coming-with-pro';
import { resolveFirstLanding, type LandingCandidate } from './first-landing-slot';
import { TrustLine } from './trust-line';

describe('launch primitives', () => {
  it('renders exactly one first-landing candidate for every combination', () => {
    const ids = FIRST_LANDING_SLOT_ORDER;
    expect(ids).toHaveLength(3);
    for (let mask = 0; mask < 8; mask += 1) {
      const candidates: LandingCandidate[] = ids.map((id, index) => ({
        id,
        ready: (mask & (1 << index)) !== 0,
        node: <span>{id}</span>,
      }));
      const html = renderToStaticMarkup(<>{resolveFirstLanding(candidates)}</>);
      const ready = candidates.filter((item) => item.ready);
      if (ready.length === 0) {
        expect(html).toBe('');
      } else {
        const winner = ids.find((id) => candidates.find((item) => item.id === id)?.ready);
        expect(html).toContain(`>${winner}<`);
        for (const id of ids) {
          if (id !== winner) expect(html).not.toContain(`>${id}<`);
        }
      }
    }
  });

  it('orders chrome banners and skips a lower one when a higher one is ready', () => {
    expect(BANNER_SLOT_ORDER).toEqual(['deletion_grace', 'past_due', 'reconnect', 'sync_error']);
    const html = renderToStaticMarkup(
      <BannerSlot
        candidates={[
          { id: 'sync_error', ready: true, node: <span>sync</span> },
          { id: 'past_due', ready: true, node: <span>past</span> },
        ]}
      />,
    );
    expect(html).toContain('past');
    expect(html).not.toContain('sync');
    expect(resolveBanner([])).toBeNull();
  });

  it('never renders a price, checkout, or contact promise on Coming with Pro', () => {
    const html = renderToStaticMarkup(
      <ComingWithPro
        proName="Pro"
        title="Daily Brief"
        pitch="A daily summary."
        joined={false}
        onJoin={() => undefined}
      />,
    );
    expect(html).toContain('Join the Pro waitlist');
    expect(html).not.toMatch(/\$\d/);
    expect(html).not.toContain('/pricing');
    expect(html).not.toContain('/billing');
    expect(html).not.toMatch(/we.ll (email|notify|let) you/i);
    const joined = renderToStaticMarkup(
      <ComingWithPro
        proName="Pro"
        title="Daily Brief"
        pitch="A daily summary."
        joined
        onJoin={() => undefined}
      />,
    );
    expect(joined).toContain('You’re on the Pro waitlist.');
    expect(joined).toContain(WS2_COPY.pro.joinedSub);
    expect(joined).not.toContain('Join the Pro waitlist');
  });

  it('puts the trust line on the privacy anchor', () => {
    const html = renderToStaticMarkup(<TrustLine />);
    expect(html).toContain('We never fetch or store full email contents.');
    expect(html).toContain('href="/settings/privacy#what-we-store"');
    expect(html).toContain('class="dm-tap-target"');
  });
});
