import {
  ACTION_PREVIEW_CLAIM,
  Logo,
  OAUTH_SCOPE_DISCLOSURE,
  PRIVACY_NEVER_ITEMS,
  PRIVACY_NEVER_LABEL,
  PRIVACY_STORAGE_ITEMS,
  PRIVACY_STORAGE_LABEL,
} from '@declutrmail/shared';

import { TrackedCta } from '../landing/tracked-cta';
import { oauthStartUrl } from '../landing/urls';

// The preview promise, first sentence only — the rest of the shared claim
// (a re-check when the action runs) belongs to the preview itself.
const PREVIEW_PROMISE = ACTION_PREVIEW_CLAIM.split(/(?<=\.)\s+/)[0];

/**
 * /sign-in — the OAuth decision point. One centred card: the headline,
 * the Google button, and the full scope disclosure beside it; the storage
 * list one click away; the demo as the quiet alternative.
 */
export function AuthEntry({
  authResult,
  returnTo,
}: {
  authResult?: 'inbox_limit';
  returnTo?: string;
}) {
  return (
    <div className="dm-auth-entry">
      <section className="dm-auth-entry-card" aria-labelledby="dm-auth-entry-title">
        <Logo variant="mark" size={40} />
        <h1 id="dm-auth-entry-title">Know what you are sharing before you connect.</h1>
        <p className="dm-auth-entry-lede">
          Gmail remains where you read, reply, search, and compose.
        </p>

        {authResult === 'inbox_limit' ? (
          <div className="dm-auth-entry-alert" role="alert">
            <strong>This Gmail can’t reconnect yet.</strong>
            <p>
              Every Gmail connection your plan allows is already in use. Sign in with any connected
              Gmail to disconnect it, or upgrade to connect more.
            </p>
            <TrackedCta href="/pricing" cta="see_pricing" placement="hero">
              Compare plans
            </TrackedCta>
          </div>
        ) : null}

        <TrackedCta
          className="dm-auth-entry-google"
          href={oauthStartUrl(returnTo)}
          cta="connect_gmail"
          placement="hero"
        >
          <GoogleMark />
          Continue with Google
        </TrackedCta>

        <p className="dm-auth-entry-scope">{OAUTH_SCOPE_DISCLOSURE}</p>

        <details className="dm-auth-entry-storage">
          <summary>See what DeclutrMail stores</summary>
          <div>
            <p>{PRIVACY_STORAGE_LABEL}</p>
            <ul>
              {PRIVACY_STORAGE_ITEMS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p>{PRIVACY_NEVER_LABEL}</p>
            <ul>
              {PRIVACY_NEVER_ITEMS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className="dm-auth-entry-storage-note">
              Account, preference, action, service-provider, and billing records are described in
              the <a href="/privacy#what-we-store">privacy policy</a>. See{' '}
              <a href="/security">how access is protected</a>.
            </p>
          </div>
        </details>

        <ol className="dm-auth-entry-next" aria-label="After you connect">
          <li>
            <strong>DeclutrMail groups your email by sender.</strong> The first scan runs on its own
            — we email you when your inbox is ready.
          </li>
          <li>
            <strong>You review senders before email moves.</strong> {PREVIEW_PROMISE}
          </li>
        </ol>

        <p className="dm-auth-entry-fine">
          No card required for Free. Disconnect from Settings or your Google Account at any time.
        </p>
      </section>

      <p className="dm-auth-entry-alt">
        Not ready to connect?{' '}
        <TrackedCta href="/inbox-simulator" cta="try_demo" placement="final">
          Try the demo
        </TrackedCta>
      </p>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.482h4.844a4.14 4.14 0 0 1-1.797 2.716v2.258h2.909c1.702-1.567 2.684-3.874 2.684-6.615Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.91-2.258c-.806.54-1.835.86-3.046.86-2.344 0-4.328-1.585-5.037-3.714H.956v2.332A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.963 10.708A5.42 5.42 0 0 1 3.682 9c0-.593.102-1.169.281-1.708V4.96H.956A9 9 0 0 0 0 9c0 1.452.347 2.827.956 4.04l3.007-2.332Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.507.454 3.44 1.345l2.582-2.582C13.463.892 11.427 0 9 0A9 9 0 0 0 .956 4.96l3.007 2.332C4.672 5.163 6.656 3.58 9 3.58Z"
      />
    </svg>
  );
}
