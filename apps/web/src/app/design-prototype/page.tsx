import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { DesignPrototype } from '@/features/design-prototype/design-prototype';

export const metadata: Metadata = {
  title: 'Design study — DeclutrMail',
  robots: { index: false, follow: false },
};

/** Development-only cross-surface study: app and public site share one comparison. */
export default function DesignPrototypePage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <Suspense fallback={<p style={{ padding: 32 }}>Opening the design study…</p>}>
      <DesignPrototype />
    </Suspense>
  );
}
