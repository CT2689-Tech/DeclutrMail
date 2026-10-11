import Link from 'next/link';

import { CASA_VERIFICATION_APPROVED_ON, formatVerificationDate } from '@declutrmail/shared';
import { fillWs3, TRUST_ROW_VARIANT, WS3_COPY } from '@declutrmail/shared/copy/launch';

/**
 * One trust line. The date is `CASA_VERIFICATION_APPROVED_ON`, formatted at render.
 */
export function TrustRow({ variant = TRUST_ROW_VARIANT }: { variant?: 'full' | 'short' }) {
  const template = variant === 'short' ? WS3_COPY['ws3.trust.short'] : WS3_COPY['ws3.trust.long'];
  const text = fillWs3(template, {
    OAUTH_DATE: formatVerificationDate(CASA_VERIFICATION_APPROVED_ON),
  });
  return (
    <p className="dm-trust-row">
      <Link href="/security#verification" aria-label={WS3_COPY['ws3.trust.aria']}>
        {text}
      </Link>
    </p>
  );
}
