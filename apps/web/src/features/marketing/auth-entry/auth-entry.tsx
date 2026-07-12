import {
  ACTION_PREVIEW_CLAIM,
  PrivacyBadge,
  PRIVACY_NEVER_ITEMS,
  PRIVACY_STORAGE_ITEMS,
} from '@declutrmail/shared';

import { TrackedCta } from '../landing/tracked-cta';
import { oauthStartUrl } from '../landing/urls';

export function AuthEntry() {
  return (
    <div className="dm-auth-entry">
      <section className="dm-auth-entry-card">
        <div className="dm-auth-entry-copy">
          <p className="dm-auth-entry-eyebrow">Sign in with Google</p>
          <h1>Connect Gmail with the boundary visible.</h1>
          <p className="dm-auth-entry-lede">
            Gmail remains where you read, reply, search, and compose. DeclutrMail indexes a narrow
            set of metadata so you can review and act by sender.
          </p>

          <div className="dm-auth-entry-steps">
            <div>
              <span>1</span>
              <p>
                <strong>Google shows the consent screen.</strong>
                Review the requested <code>gmail.modify</code> scope before approving it.
              </p>
            </div>
            <div>
              <span>2</span>
              <p>
                <strong>DeclutrMail indexes metadata.</strong>
                Initial sync can take a few minutes for an older mailbox.
              </p>
            </div>
            <div>
              <span>3</span>
              <p>
                <strong>You review senders before mail moves.</strong>
                {ACTION_PREVIEW_CLAIM}
              </p>
            </div>
          </div>

          <TrackedCta
            className="dm-auth-entry-google"
            href={oauthStartUrl()}
            cta="connect_gmail"
            placement="hero"
          >
            <GoogleMark />
            Continue with Google
          </TrackedCta>
          <p className="dm-auth-entry-fine">
            No card required for Free. Disconnect from Settings or your Google Account at any time.
          </p>
        </div>

        <aside className="dm-auth-entry-boundary" aria-label="Gmail data boundary">
          <PrivacyBadge variant="card" />
          <div>
            <p>Published Gmail message fields</p>
            <ul>
              {PRIVACY_STORAGE_ITEMS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <p className="dm-auth-entry-boundary-note">
            Account, preference, action, processor, and billing records are described in the{' '}
            <a href="/privacy">privacy policy</a>.
          </p>
          <div>
            <p>Not fetched or stored</p>
            <ul>
              {PRIVACY_NEVER_ITEMS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <a href="/security">See how access is protected →</a>
        </aside>
      </section>

      <section className="dm-auth-entry-alt">
        <div>
          <p>Not ready to connect?</p>
          <h2>Use the same decision flow on a synthetic inbox first.</h2>
        </div>
        <TrackedCta href="/inbox-simulator" cta="try_demo" placement="final">
          Try the demo →
        </TrackedCta>
      </section>
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
