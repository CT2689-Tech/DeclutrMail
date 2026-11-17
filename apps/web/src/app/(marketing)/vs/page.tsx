import { permanentRedirect } from 'next/navigation';

// 308 on purpose (SEO sweep 2026-11-17): readers trim `/vs/<tool>` URLs
// back to `/vs`, which 404'd. /compare is the hub for every head-to-head page.
export default function VsIndexRedirectPage() {
  permanentRedirect('/compare');
}
