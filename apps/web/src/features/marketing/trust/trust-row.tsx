import { useId } from 'react';
import Link from 'next/link';

import { CASA_VERIFICATION_APPROVED_ON, formatVerificationDate } from '@declutrmail/shared';
import { fillWs3, TRUST_ROW_VARIANT, WS3_COPY } from '@declutrmail/shared/copy/launch';

// Styles are loaded by the public route group through public-styles.css.

/**
 * One trust line. The date is `CASA_VERIFICATION_APPROVED_ON`, formatted at render.
 * Wide screens keep the chosen deck variant. Narrow screens show the short
 * deck line and let it wrap in full. The link carries `dm-trust-link` so
 * prose rules (`.dm-story a:not([class])`, `.dm-read-body a`) do not restyle it.
 */
export function TrustRow({ variant = TRUST_ROW_VARIANT }: { variant?: 'full' | 'short' }) {
  const oauthDate = formatVerificationDate(CASA_VERIFICATION_APPROVED_ON);
  const wide = fillWs3(
    variant === 'short' ? WS3_COPY['ws3.trust.short'] : WS3_COPY['ws3.trust.long'],
    { OAUTH_DATE: oauthDate },
  );
  const narrow = fillWs3(WS3_COPY['ws3.trust.short'], { OAUTH_DATE: oauthDate });
  const descriptionId = useId();
  return (
    <p className="dm-trust-row">
      <Link
        className="dm-trust-link"
        href="/security#verification"
        aria-describedby={descriptionId}
      >
        <svg
          className="dm-trust-badge"
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 16 16"
        >
          <path
            fill="currentColor"
            d="M8 1.2 13.2 3v4.2c0 3.2-2.2 5.5-5.2 6.6C5 12.7 2.8 10.4 2.8 7.2V3L8 1.2Zm-.2 9.1 3.6-3.6-.9-.9-2.7 2.7-1.3-1.3-.9.9 2.2 2.2Z"
          />
        </svg>
        <span className="dm-trust-row-copy">
          <span className="dm-trust-row-wide">{wide}</span>
          <span className="dm-trust-row-narrow">{narrow}</span>
        </span>
      </Link>
      <span id={descriptionId} className="dm-trust-describedby">
        {WS3_COPY['ws3.trust.aria']}
      </span>
    </p>
  );
}
