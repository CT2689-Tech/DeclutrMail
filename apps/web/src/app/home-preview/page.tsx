import type { Metadata } from 'next';
import '@/features/theme/app-light-theme.css';
import { notFound } from 'next/navigation';

import { HomePreview } from '@/features/home/home-preview';
import { homePreviewEnabled } from '@/features/home/home-preview-access';
import { parseHomePreviewState } from '@/features/home/home-preview-state';
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
      <span id="dm-app-theme" hidden />
      <ThemeScript />
      <HomePreview state={state} />
    </>
  );
}
