// /home — the authed landing screen: one number, one label, one button.
//
import { headers } from 'next/headers';
import { HomeScreen } from '@/features/home/home-screen';
import { ServerHomeBoundary } from '@/features/home/server-home-boundary';

export const metadata = {
  title: 'Home — DeclutrMail',
};

export default async function HomePage() {
  const cookieHeader = (await headers()).get('cookie') ?? '';
  return (
    <ServerHomeBoundary cookieHeader={cookieHeader}>
      <HomeScreen />
    </ServerHomeBoundary>
  );
}
