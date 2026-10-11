import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { HomePreview, parseHomePreviewState } from '@/features/home/home-preview';
import { homePreviewEnabled } from '@/features/home/home-preview-access';
import { ThemeScript } from '@/features/theme/theme-script';

export const metadata: Metadata = {
  title: 'Home preview — DeclutrMail',
  robots: { index: false, follow: false },
};

/** Fixture Home inside the app shell. Closed on production deploys. */
export default async function HomePreviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!homePreviewEnabled()) notFound();
  const params = await searchParams;
  const raw = params.state;
  const state = parseHomePreviewState(typeof raw === 'string' ? raw : undefined);
  return (
    <>
      <ThemeScript />
      <HomePreview state={state} />
    </>
  );
}
