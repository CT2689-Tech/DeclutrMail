'use client';

import { editorialOnboardingActionStyle } from '@/features/editorial/page';

import { Button, PrivacyBadge, PRIVACY_BADGE_HEADLINE } from '@declutrmail/shared';

import { StepShell } from './step-shell';
import styles from './onboarding-appearance.module.css';

/**
 * Step 1 — the Promise screen (D107).
 *
 * Pre-OAuth, no inputs: the value promise plus the exact privacy
 * boundary BEFORE any Google consent screen. The locked promise stays
 * visible; the shared badge preserves the complete D245 field lists
 * in a native disclosure. Step 2 still explains access before OAuth.
 *
 * Renders UNAUTHED by design — this is where fresh visitors entering
 * the app funnel land, so there must be no `/api/auth/me` gate in
 * front of it (the page mounts AuthProvider only for steps 3+).
 */
export function StepPromise({ onConnect }: { onConnect: () => void }) {
  return (
    <StepShell
      phase="connect"
      title="A lighter inbox starts with one sender."
      sub="Review email by sender, then see how many emails will change and what will happen before you confirm."
    >
      <figure className={styles.senderExample} aria-label="Illustrative sender example">
        <div className={styles.exampleSender}>
          <span className={styles.senderMonogram} aria-hidden="true">
            S
          </span>
          <span>
            <strong>Sunday Notes</strong>
            <span className={styles.senderContext}>128 emails in Inbox</span>
          </span>
          <span className={styles.senderCount} aria-hidden="true">
            128
          </span>
        </div>
        <figcaption>Example only. Your senders appear after you connect.</figcaption>
      </figure>

      <section className={styles.promisePrivacy} aria-label="Gmail privacy">
        <h2>{PRIVACY_BADGE_HEADLINE}</h2>
        <details>
          <summary>See the full Gmail data list</summary>
          <PrivacyBadge
            headingLevel={3}
            style={{ border: 'none', boxShadow: 'none', padding: 0 }}
          />
        </details>
      </section>

      <Button tone="primary" size="xl" onClick={onConnect} style={editorialOnboardingActionStyle}>
        Connect Gmail
      </Button>

      <p className={styles.connectNext}>
        Next: review Google’s permission. Connecting won’t move email.
      </p>
      <p className={styles.promiseLegal}>
        <a href="/privacy">Privacy policy</a>
        {' · '}
        <a href="/terms">Terms</a>
      </p>
    </StepShell>
  );
}
