// Storybook CSF3 stories for the D147 cookie-preferences card — the
// banner's change/withdrawal counterpart (GDPR Art. 7(3)).
//
// The card reflects the consent stored in the Storybook origin's
// localStorage + mirror cookie, so each story seeds (or clears) the
// stores before mounting. Selecting an option in the canvas writes a
// real choice into that origin's storage — remount re-seeds it.
//
// Mirrors the local-shim pattern of `cookie-consent-banner.stories.tsx`.

import { CookiePreferences } from './cookie-preferences';

type StoryMeta<C extends (...args: never) => unknown> = {
  title: string;
  component: C;
  parameters?: Record<string, unknown>;
  tags?: readonly string[];
};

type Story = {
  parameters?: Record<string, unknown>;
  render?: () => ReturnType<typeof CookiePreferences>;
};

const meta: StoryMeta<typeof CookiePreferences> = {
  title: 'Consent/CookiePreferences',
  component: CookiePreferences,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'D147 cookie-preferences card — the standing surface to change or withdraw the ' +
          'cookie-banner choice (GDPR Art. 7(3)). Essential cookies are always on; the two ' +
          'radios govern optional PostHog analytics only, applied on select with no Save step. ' +
          'Withdrawing stops capture immediately and resets the analytics identity. Mounted in ' +
          'Settings and on the public /cookies page.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

function seedConsent(choice: 'all' | 'essential' | null): void {
  if (choice === null) {
    localStorage.removeItem('dm-cookie-consent');
    document.cookie = 'dm_cookie_consent=; Max-Age=0; Path=/';
    return;
  }
  localStorage.setItem('dm-cookie-consent', choice);
  document.cookie = `dm_cookie_consent=${choice}; Path=/`;
}

/** No choice stored yet — renders the effective default, essential-only. */
export const NoChoiceYet: Story = {
  render: () => {
    seedConsent(null);
    return <CookiePreferences />;
  },
};

/** "Accept all" stored — analytics consented; downgrading withdraws. */
export const AcceptedAll: Story = {
  render: () => {
    seedConsent('all');
    return <CookiePreferences />;
  },
};

/** Explicit "Essential only" stored — analytics off. */
export const EssentialOnly: Story = {
  render: () => {
    seedConsent('essential');
    return <CookiePreferences />;
  },
};
