'use client';

import { TrackedCta } from '../landing/tracked-cta';
import { useSessionHint } from './use-session-hint';

export function PublicAuthActions() {
  const signedIn = useSessionHint();
  return (
    <div className="dm-public-actions">
      {signedIn ? (
        <TrackedCta className="dm-public-start" href="/home" cta="open_app" placement="nav">
          Open DeclutrMail
        </TrackedCta>
      ) : (
        <>
          <TrackedCta
            className="dm-public-sign-in"
            href="/sign-in?returning=1"
            cta="connect_gmail"
            placement="nav_sign_in"
          >
            Sign in
          </TrackedCta>
          <TrackedCta
            className="dm-public-start"
            href="/sign-in"
            cta="connect_gmail"
            placement="nav"
          >
            Start free
          </TrackedCta>
        </>
      )}
    </div>
  );
}
