// Storybook CSF3 stories for LaunchOfferCard (D119 redesign, D210).

import { CheckoutLaunchError } from './checkout-error';
import { LaunchOfferCard } from './launch-offer-card';

type StoryMeta<C extends (...args: never) => unknown> = {
  title: string;
  component: C;
};

type Story<C extends (props: never) => unknown> = {
  args?: Partial<Parameters<C>[0]>;
};

const meta: StoryMeta<typeof LaunchOfferCard> = {
  title: 'Features/Billing/LaunchOfferCard',
  component: LaunchOfferCard,
};

export default meta;

const plus = {
  testId: 'launch-offer-plus',
  name: 'Plus',
  badge: 'Recommended',
  recommended: true,
  amount: '$59',
  per: 'a year',
  hint: 'about $4.92 a month',
  features: [
    'No monthly limit',
    'Up to 2 Gmail accounts',
    'Screener: new senders wait for your review, and their email keeps arriving',
    'Autopilot rules for new email from senders you’ve decided on',
  ],
  terms: [
    '$59 billed yearly from today until you cancel.',
    'Final amount with tax shown at checkout.',
    '14-day money-back on any purchase, once per customer.',
  ],
  ctaLabel: 'Get Plus',
  onBuy: () => undefined,
};

export const Recommended: Story<typeof LaunchOfferCard> = { args: plus };

export const Highlighted: Story<typeof LaunchOfferCard> = { args: { ...plus, highlighted: true } };

export const Opening: Story<typeof LaunchOfferCard> = {
  args: { ...plus, pending: true, ctaLabel: 'Opening checkout…' },
};

/** Another checkout or plan change is still settling, so this one waits. */
export const Disabled: Story<typeof LaunchOfferCard> = { args: { ...plus, disabled: true } };

export const CheckoutFailed: Story<typeof LaunchOfferCard> = {
  args: {
    ...plus,
    error: new CheckoutLaunchError(true).message,
  },
};

export const PayOnce: Story<typeof LaunchOfferCard> = {
  args: {
    testId: 'launch-offer-pass',
    name: 'Backlog Pass',
    badge: 'Pay once',
    amount: '$19',
    per: 'once',
    hint: 'Never renews',
    features: [
      'No monthly limit for 30 days',
      'For one Gmail account',
      'The Screener and Autopilot while it lasts',
    ],
    terms: [
      'Final amount with tax shown at checkout.',
      '14-day money-back on any purchase, once per customer.',
    ],
    ctaLabel: 'Get Backlog Pass',
    onBuy: () => undefined,
  },
};
