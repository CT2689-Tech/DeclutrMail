import { actionHelpCopy, VERB_REGISTRY } from '@declutrmail/shared/actions';
import { fillWs3, WS1_COPY, WS3_COPY } from '@declutrmail/shared/copy/launch';
import { BRIEF_NAME } from '@declutrmail/shared/copy/screen-decisions';
import { fillStory, MIN_UNDO_WINDOW_DAYS, TIER_MANIFEST } from '@declutrmail/shared/entitlements';
import {
  CASA_VERIFICATION_APPROVED_ON,
  formatVerificationDate,
  Logo,
  PRIVACY_BADGE_HEADLINE,
  PRIVACY_NEVER_ITEMS,
  PRIVACY_NEVER_LABEL,
  PRIVACY_STORAGE_ITEMS,
  PRIVACY_STORAGE_LABEL,
} from '@declutrmail/shared';

import { HeroWorkspace } from './hero-workspace';
import { TrackedCta } from './tracked-cta';

/**
 * Landing body sections. All server-rendered; zero client JS beyond the
 * tracked links.
 *
 * Each block states its idea once: the steps carry Undo, Privacy carries
 * the storage boundary and the verification wording, pricing carries the
 * plans.
 */

const PILLARS = [
  {
    title: 'See the whole sender',
    body: 'Inbox count, recent volume and recent subjects together, before you decide.',
  },
  {
    title: 'Preview before moving mail',
    body: 'The count, where the email goes and how to undo it. Then you confirm.',
  },
  {
    title: 'Keep the final say',
    body: 'You choose whether a rule only watches or acts. Protected senders stay out of bulk changes.',
  },
] as const;

export function Pillars() {
  return (
    <section className="dm-home-pillars dm-mkt-shell" aria-label="Product principles">
      {PILLARS.map((pillar, index) => (
        <div key={pillar.title}>
          <span className="dm-home-pillar-index">{String(index + 1).padStart(2, '0')}</span>
          <p className="dm-home-pillar-title">{pillar.title}</p>
          <p>{pillar.body}</p>
        </div>
      ))}
    </section>
  );
}

/** The sender list and inspector, labelled as a fictional sample. */
export function ProductCloseUp() {
  return (
    <section
      id="product-tour"
      className="dm-home-section dm-home-closeup dm-mkt-shell"
      aria-labelledby="dm-home-closeup-title"
    >
      <div className="dm-home-head dm-home-head-split">
        <div>
          <p className="dm-home-kicker">The product, up close</p>
          <h2 id="dm-home-closeup-title" className="dm-home-h2">
            See the sender. <em>Know what will change.</em>
          </h2>
        </div>
        <TrackedCta
          href="/inbox-simulator?workspace=senders"
          cta="try_demo"
          placement="demo"
          className="dm-home-text-link"
        >
          Open the demo <span aria-hidden="true">→</span>
        </TrackedCta>
      </div>
      <HeroWorkspace />
    </section>
  );
}

const STEPS = [
  { title: 'Inspect', body: WS3_COPY['ws3.home.walkthrough.openDetails'] },
  { title: 'Preview', body: 'See the matching count and the planned Gmail change.' },
  { title: 'Result', body: 'Confirm, and Activity records the result.' },
  {
    title: 'Undo',
    body: `Archive, Later and Delete have ${MIN_UNDO_WINDOW_DAYS} days of Activity Undo.`,
  },
] as const;

/** The four-step loop, then the five decisions with their real semantics. */
export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="dm-home-band dm-home-how"
      aria-labelledby="dm-home-how-title"
    >
      <div className="dm-mkt-shell">
        <div className="dm-home-head">
          <p className="dm-home-kicker">How it works</p>
          <h2 id="dm-home-how-title" className="dm-home-h2">
            Five decisions. <em>A preview before anything moves.</em>
          </h2>
        </div>
        <ol className="dm-home-steps">
          {STEPS.map((step, index) => (
            <li key={step.title} data-current={step.title === 'Preview' ? 'true' : undefined}>
              <span className="dm-home-step-title">
                <span className="dm-home-step-number" aria-hidden="true">
                  {index + 1}
                </span>
                {step.title}
              </span>{' '}
              <span>{step.body}</span>
            </li>
          ))}
        </ol>
        <ul className="dm-home-verbs" aria-label="The five decisions">
          {VERB_REGISTRY.map((verb) => (
            <li key={verb.id}>
              <kbd>{verb.shortcut}</kbd> <strong>{verb.label}</strong>{' '}
              <span>{actionHelpCopy(verb.id)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Why the workspace sits beside Gmail instead of replacing it. */
export function Companion() {
  return (
    <section
      id="works-with-gmail"
      className="dm-home-section dm-home-companion dm-mkt-shell"
      aria-labelledby="dm-home-companion-title"
    >
      <div className="dm-home-head">
        <p className="dm-home-kicker">A companion to Gmail</p>
        <h2 id="dm-home-companion-title" className="dm-home-h2">
          Keep your inbox. <em>Get a better way to decide.</em>
        </h2>
        <p className="dm-home-lede">
          Your mail stays in your existing Gmail account. DeclutrMail works alongside it for
          cleanup.
        </p>
      </div>
      <div className="dm-home-companion-side">
        <div
          className="dm-home-companion-map"
          role="group"
          aria-label="Gmail and DeclutrMail work together"
        >
          <div className="dm-home-companion-tile">
            <span className="dm-home-companion-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="24" height="24">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="M3 7l9 6 9-6" />
              </svg>
            </span>
            <strong>Gmail</strong>
            <p>Read and reply</p>
          </div>
          <svg
            className="dm-home-companion-connector"
            viewBox="0 0 24 24"
            width="28"
            height="28"
            aria-hidden="true"
          >
            <path d="M4 9h16" />
            <path d="M16 5l4 4-4 4" />
            <path d="M20 15H4" />
            <path d="M8 19l-4-4 4-4" />
          </svg>
          <div className="dm-home-companion-tile dm-home-companion-tile-product">
            <span className="dm-home-companion-mark" aria-hidden="true">
              {/* Always a dark ground, so the tone is pinned (ADR-0036). */}
              <Logo variant="mark" tone="reversed" size={30} label={null} />
            </span>
            <strong>DeclutrMail</strong>
            <p>Review and clean up</p>
          </div>
        </div>
        {/* Optional, so dashed: the connector adds a way in, not a step. */}
        <a
          href="/connect"
          className="dm-home-companion-assistant"
          aria-label="Set up your AI assistant: every cleanup waits for you to confirm it"
        >
          <span className="dm-home-companion-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22">
              <path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-7l-4 3v-3H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
              <path d="M8 10h8" />
              <path d="M8 13h5" />
            </svg>
          </span>
          <span className="dm-home-companion-assistant-text">
            <strong>Or ask your AI assistant</strong>
            <span>
              Use DeclutrMail from Claude, ChatGPT or Cursor. Every cleanup waits for you to confirm
              it.
            </span>
          </span>
          <span className="dm-home-companion-assistant-cta">Set up</span>
        </a>
      </div>
    </section>
  );
}

/**
 * What a paid plan adds. Only buyable plans get feature cards: Pro is
 * not for sale yet (/pricing), so its two surfaces share one waitlist
 * card instead of selling what nobody can buy.
 */
export function EverydayTools() {
  const { plus, pro } = TIER_MANIFEST;
  return (
    <section
      id="everyday-tools"
      className="dm-home-section dm-home-tools dm-mkt-shell"
      aria-labelledby="dm-home-tools-title"
    >
      <div className="dm-home-head">
        <p className="dm-home-kicker">Stay clear</p>
        <h2 id="dm-home-tools-title" className="dm-home-h2">
          A clearer inbox is only the beginning.
        </h2>
      </div>
      <div className="dm-home-cards">
        <article className="dm-home-card">
          <span className="dm-home-tag">Screener · {plus.name}</span>
          <h3>Meet new senders first.</h3>
          <p>New senders wait for your review, and their email keeps arriving.</p>
          <a href="/how-it-works#beyond-manual">
            Explore Screener <span aria-hidden="true">→</span>
          </a>
        </article>
        <article className="dm-home-card">
          <span className="dm-home-tag">Autopilot · {plus.name}</span>
          <h3>Put chosen rules to work.</h3>
          <p>Rules for new email from senders you’ve decided on. Watch first, pause anytime.</p>
          <a href="/how-it-works#manual-versus-automation">
            Explore Autopilot <span aria-hidden="true">→</span>
          </a>
        </article>
        <article className="dm-home-card dm-home-card-soon">
          <span className="dm-home-tag">Coming with {pro.name}</span>
          <h3>{BRIEF_NAME} and Follow-ups.</h3>
          <p>{pro.name} isn’t available to buy yet.</p>
          <a href="/pricing#pro-waitlist">
            {fillStory(WS1_COPY['pricing.proRow.link'])} <span aria-hidden="true">→</span>
          </a>
        </article>
      </div>
    </section>
  );
}

/**
 * Privacy — the one place the page states the privacy promise, with the
 * full registry available on demand.
 *
 * The verification wording may not exceed what /security#verification
 * states: Google APPROVED an OAuth verification for one restricted scope.
 * It is not a certification of the product. It comes from the deck's long
 * trust line minus its closing privacy sentence, which the lede above
 * already states once.
 */
export function PrivacyDesk() {
  const verification = fillWs3(WS3_COPY['ws3.trust.long'], {
    OAUTH_DATE: formatVerificationDate(CASA_VERIFICATION_APPROVED_ON),
  })
    .replace(PRIVACY_BADGE_HEADLINE, '')
    .trim();
  return (
    <section id="privacy" className="dm-home-dark" aria-labelledby="dm-home-privacy-title">
      <div className="dm-mkt-shell">
        <div className="dm-home-head dm-home-head-split">
          <div>
            <p className="dm-home-kicker">Privacy &amp; control</p>
            <h2 id="dm-home-privacy-title" className="dm-home-h2">
              Know what we see. <em>Keep the final say.</em>
            </h2>
          </div>
          <p className="dm-home-privacy-promise">{PRIVACY_BADGE_HEADLINE}</p>
        </div>
        <div className="dm-home-privacy-points">
          <div>
            <h3>Only the details needed</h3>
            <p>Sender, subject, Gmail preview snippet and the signals used to show your options.</p>
          </div>
          <div>
            <h3>Access you can revoke</h3>
            <p>
              Disconnect Gmail, export your data or schedule permanent deletion of your account.
            </p>
          </div>
          <div>
            <h3>Your decisions remain yours</h3>
            <p>Review a live preview before mail moves. Turn on future rules separately.</p>
          </div>
        </div>
        <div className="dm-home-verification">
          <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
            <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
          <p id="dm-home-verification-text">{verification}</p>
          <div className="dm-home-verification-links">
            <a href="/privacy">Privacy policy</a>
            <a href="/security#verification" aria-describedby="dm-home-verification-text">
              Security details
            </a>
          </div>
          <details className="dm-home-inventory">
            <summary>Full data list</summary>
            <div className="dm-home-inventory-lists">
              {[
                { label: PRIVACY_STORAGE_LABEL, items: PRIVACY_STORAGE_ITEMS },
                { label: PRIVACY_NEVER_LABEL, items: PRIVACY_NEVER_ITEMS },
              ].map(({ label, items }) => (
                <div key={label}>
                  <strong>{label}</strong>
                  <ul>
                    {items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </details>
        </div>
      </div>
    </section>
  );
}
