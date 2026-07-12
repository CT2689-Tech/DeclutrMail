import type { Metadata } from 'next';

import { AuthEntry } from '@/features/marketing/auth-entry/auth-entry';
import '@/features/marketing/auth-entry/auth-entry.css';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Sign in with Google — DeclutrMail',
  description:
    'Connect Gmail after reviewing DeclutrMail’s metadata boundary, OAuth scope, initial sync, and action-preview flow.',
  path: '/sign-in',
});

export default function SignInPage() {
  return <AuthEntry />;
}
