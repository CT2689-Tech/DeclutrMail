import { ANALYTICS_PRIVACY_CLAIM, Card, tokens } from '@declutrmail/shared';
import { CookiePreferenceControls } from './cookie-preference-controls';

const { color, font } = tokens;

/** Static consent guidance stays server-rendered on the public Cookies page. */
export function CookiePreferences() {
  return (
    <Card padding={0}>
      <div
        role="radiogroup"
        aria-label="Cookie preferences"
        data-testid="cookie-preferences"
        style={{
          padding: '18px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          fontFamily: font.sans,
        }}
      >
        <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: color.fg }}>
          Cookie preferences
        </h3>
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: color.fgSoft }}>
          Essential cookies for sign-in and billing are always on — the service does not work
          without them. This setting covers optional analytics only.
        </p>
        <CookiePreferenceControls
          analyticsDetail={`Also allow PostHog analytics so we can see which features matter. ${ANALYTICS_PRIVACY_CLAIM}`}
        />
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: color.fgMuted }}>
          Changes apply immediately and are saved on this device. Switching to Essential only stops
          PostHog and clears its ID.
        </p>
      </div>
    </Card>
  );
}
