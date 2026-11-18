import { permanentRedirect } from 'next/navigation';

// 308 on purpose (SEO sweep 2026-11-17): outreach replies link
// `/alternatives` for "alternative to X" questions, and the per-tool pages
// live under it, so the bare segment must not 404. /compare is the hub that
// lists every alternatives page.
export default function AlternativesIndexRedirectPage() {
  permanentRedirect('/compare');
}
