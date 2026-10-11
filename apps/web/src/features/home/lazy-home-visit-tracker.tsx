'use client';
import dynamic from 'next/dynamic';
const UnavailableTracker = () => null;
// Visits enhance Home. A failed optional download must leave the app usable.
export const LazyHomeVisitTracker = dynamic(
  () =>
    import('./api/use-home-visit')
      .then((module) => module.HomeVisitTracker)
      .catch(() => UnavailableTracker),
  { ssr: false },
);
