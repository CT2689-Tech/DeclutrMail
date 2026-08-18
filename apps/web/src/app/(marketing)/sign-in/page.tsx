import type { Metadata } from 'next';

import { AuthEntry } from '@/features/marketing/auth-entry/auth-entry';
import '@/features/marketing/auth-entry/auth-entry.css';
import { marketingPageMetadata } from '@/features/marketing/page-metadata';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Sign in with Google — DeclutrMail',
  description:
    'See what Gmail permission DeclutrMail requests, what data it stores, and what happens before you confirm an action.',
  path: '/sign-in',
});

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const authResult = params.auth_result === 'inbox_limit' ? 'inbox_limit' : undefined;

  return <AuthEntry {...(authResult ? { authResult } : {})} />;
}
