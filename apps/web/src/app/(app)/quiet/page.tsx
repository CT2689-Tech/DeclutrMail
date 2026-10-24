import { redirect } from 'next/navigation';

/** Preserve existing bookmarks after Schedule moved into Autopilot settings. */
export default function QuietPage() {
  redirect('/autopilot/settings');
}
