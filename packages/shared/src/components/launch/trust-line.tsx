import { PRIVACY_BADGE_HEADLINE } from '../../copy/privacy';

/**
 * Trust line under a progress or decision surface.
 * The link label matches the report trust link; the arrow is visual.
 */
export function TrustLine() {
  return (
    <p>
      {PRIVACY_BADGE_HEADLINE}{' '}
      <a className="dm-tap-target" href="/settings/privacy#what-we-store">
        What we store and share <span aria-hidden="true">→</span>
      </a>
    </p>
  );
}
