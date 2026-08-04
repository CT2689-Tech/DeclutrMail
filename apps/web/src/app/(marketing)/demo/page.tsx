import { permanentRedirect } from 'next/navigation';

// 308 on purpose (SEO sweep 2026-08-04): launch posts mint /demo links,
// and a temporary redirect consolidates no signal to /inbox-simulator.
export default function DemoRedirectPage() {
  permanentRedirect('/inbox-simulator');
}
