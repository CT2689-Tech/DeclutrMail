import type { ReactNode } from 'react';

import { PrivacyBadge } from '@declutrmail/shared';

import { TrackedCta } from '@/features/marketing/landing/tracked-cta';
import { oauthStartUrl } from '@/features/marketing/landing/urls';

/**
 * Shared editorial frame for the two long-form product-story pages.
 *
 * Site navigation and the footer come from the marketing route-group layout;
 * this component owns only the hero and long-form page rhythm.
 */
export function ProductStoryShell({
  eyebrow,
  title,
  lede,
  heroAside,
  children,
}: {
  eyebrow: string;
  title: string;
  lede: string;
  heroAside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="dm-story">
      <article>
        <div className="dm-story-hero dm-story-shell">
          <div>
            <p className="dm-story-eyebrow">{eyebrow}</p>
            <h1>{title}</h1>
            <p className="dm-story-hero-lede">{lede}</p>
            <div className="dm-story-hero-actions">
              <a className="dm-story-button dm-story-button-primary" href="#walkthrough">
                See the walkthrough
              </a>
              <TrackedCta
                className="dm-story-button"
                href={oauthStartUrl()}
                cta="connect_gmail"
                placement="hero"
              >
                Connect your Gmail
              </TrackedCta>
            </div>
          </div>
          {heroAside ?? (
            <div className="dm-story-badge-paper">
              <PrivacyBadge variant="card" />
            </div>
          )}
        </div>

        {children}
      </article>
    </div>
  );
}

export function StorySection({
  id,
  number,
  title,
  intro,
  children,
  tone = 'paper',
}: {
  id: string;
  number: string;
  title: string;
  intro?: ReactNode;
  children: ReactNode;
  tone?: 'paper' | 'ink';
}) {
  return (
    <section id={id} className={`dm-story-section dm-story-section-${tone}`}>
      <div className="dm-story-shell">
        <p className="dm-story-eyebrow">№ {number}</p>
        <h2>{title}</h2>
        {intro ? <div className="dm-story-section-intro">{intro}</div> : null}
        {children}
      </div>
    </section>
  );
}

export function FinalStoryCta({ title, body }: { title: string; body: string }) {
  return (
    <section className="dm-story-final dm-story-shell">
      <p className="dm-story-eyebrow">Next step</p>
      <h2>{title}</h2>
      <p>{body}</p>
      <div className="dm-story-hero-actions">
        <TrackedCta
          className="dm-story-button dm-story-button-primary"
          href={oauthStartUrl()}
          cta="connect_gmail"
          placement="final"
        >
          Connect your Gmail
        </TrackedCta>
        <TrackedCta className="dm-story-button" href="/pricing" cta="see_pricing" placement="final">
          Compare plans
        </TrackedCta>
      </div>
    </section>
  );
}
