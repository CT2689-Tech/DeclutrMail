// D245 compatibility route. `/later` is canonical; old bookmarks and
// external links continue to land on the same authenticated surface.

import { permanentRedirect } from 'next/navigation';

export default function SnoozedCompatibilityPage() {
  permanentRedirect('/later');
}
