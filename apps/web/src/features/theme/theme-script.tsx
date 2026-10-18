// The pre-paint theme resolver, as a component (D175 CSP split).
//
// It used to live once in the root layout, which is what made the root
// layout read `headers()` for a nonce — and that single read opted EVERY
// route out of static prerendering. Option A′ (founder, 2026-08-14) moves
// the read down into the authed groups, so the tag now has three call
// sites with different nonce needs:
//
//   `(marketing)` — no nonce. Its CSP is `script-src 'self'
//     'unsafe-inline'` with no 'strict-dynamic', which authorizes
//     the inline resolver without a separate request. A nonce would be
//     worse than useless: it would be stale on prerendered HTML.
//   `(app)` and `/onboarding` — nonce REQUIRED. Their CSP keeps
//     'strict-dynamic', which makes CSP3 browsers ignore host-source
//     expressions, so 'self' stops authorizing even a same-origin
//     external script. Without the nonce the theme never resolves.
//
// Parser-blocking on purpose (no `async`/`defer`, first node in <body>)
// so a stored dark preference applies before first paint.

import { isFeatureEnabled } from '@/lib/flags';
import { THEME_INIT_SOURCE } from './theme-init-source';

export function ThemeScript({
  nonce,
  inline = false,
}: {
  nonce?: string | undefined;
  inline?: boolean;
}) {
  // darkMode flag off ⇒ skip the resolver entirely: `data-theme` is
  // never set, so the app renders light even for users with a stored
  // dark preference (ADR-0025 kill-switch semantics).
  if (!isFeatureEnabled('darkMode')) return null;
  if (inline) {
    return (
      <script
        nonce={nonce}
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: THEME_INIT_SOURCE }}
      />
    );
  }
  // suppressHydrationWarning: browsers hide the nonce attribute from DOM
  // reads, so the client always sees "" — a known, harmless mismatch on
  // any nonced tag.
  return <script src="/theme-init.js" nonce={nonce} suppressHydrationWarning />;
}
