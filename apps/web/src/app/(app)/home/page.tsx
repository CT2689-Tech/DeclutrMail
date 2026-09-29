// /home — the authed landing screen: one number, one label, one button.
//
// Client-fetched on purpose. The screen is three small reads and no list,
// so there is nothing for server hydration to save.

import { HomeScreen } from '@/features/home/home-screen';

export const metadata = {
  title: 'Home — DeclutrMail',
};

export default function HomePage() {
  return <HomeScreen />;
}
