// Storybook CSF3 stories for the D147 cookie-consent banner.
//
// The banner is stateful by design: it renders only while no consent
// choice is stored (localStorage + mirror cookie). The story's render
// clears both stores before mounting so the canvas always shows the
// banner — but clicking either button in the canvas writes a real
// choice into the Storybook origin's storage (remount clears it again).
//
// Mirrors the local-shim pattern from `privacy-badge.stories.tsx` /
// `error.stories.tsx` (D210).

import { CookieConsentBanner } from './cookie-consent-banner';

type StoryMeta<C extends (...args: never) => unknown> = {
  title: string;
  component: C;
  parameters?: Record<string, unknown>;
  tags?: readonly string[];
};

type Story = {
  parameters?: Record<string, unknown>;
  render?: () => ReturnType<typeof CookieConsentBanner>;
};

const meta: StoryMeta<typeof CookieConsentBanner> = {
  title: 'Consent/CookieConsentBanner',
  component: CookieConsentBanner,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'D147 cookie-consent banner — the single consent surface for optional analytics ' +
          '(PostHog, D159). Copy is D147 verbatim; the two choices carry equal visual weight ' +
          'on purpose (no dark pattern), and there is no dismiss-X — ignoring the banner is ' +
          'declining, since analytics is off until "Accept all" is stored. Fixed bottom-left, ' +
          'below the toast layer.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

function clearStoredConsent(): void {
  localStorage.removeItem('dm-cookie-consent');
  document.cookie = 'dm_cookie_consent=; Max-Age=0; Path=/';
}

/** First visit — no choice stored yet, so the ask is visible. */
export const FirstVisit: Story = {
  render: () => {
    clearStoredConsent();
    return <CookieConsentBanner />;
  },
};
