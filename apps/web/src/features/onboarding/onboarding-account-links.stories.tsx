import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { OnboardingAccountLinks } from './onboarding-account-links';

const meta = {
  title: 'Onboarding/Account recovery links',
  component: OnboardingAccountLinks,
} satisfies Meta<typeof OnboardingAccountLinks>;
export default meta;
export const Default: StoryObj<typeof meta> = {};
