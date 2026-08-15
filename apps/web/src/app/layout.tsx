import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Fraunces, Geist, Geist_Mono } from 'next/font/google';
import '@declutrmail/shared/tokens.css';
import { siteUrl } from '@/features/marketing/landing/urls';
import { Providers } from './providers';

const geist = Geist({
  subsets: ['latin'],
  variable: '--dm-font-sans',
  display: 'swap',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--dm-font-mono',
  display: 'swap',
});

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--dm-font-display',
  display: 'swap',
});

export const metadata: Metadata = {
  // Site-wide base so per-page relative canonical / og:url values
  // resolve against the canonical origin (D128 — declutrmail.com).
  metadataBase: new URL(siteUrl()),
  title: 'DeclutrMail',
  description: 'A Gmail sender-control companion with live previews and Activity undo.',
};

/**
 * NOTHING IN THIS FILE MAY READ `headers()`, `cookies()` OR
 * `searchParams` (Option A′, founder 2026-08-14).
 *
 * The root layout is the one node every route shares, so a single
 * per-request read here opts the WHOLE app out of static prerendering.
 * It used to make two — the D175 CSP nonce and the D117 billing rail —
 * which is why not one HTML page was prerendered. Both now live in the
 * layer that actually needs them:
 *
 *   nonce  → `(app)/layout.tsx` + `onboarding/layout.tsx` (server
 *            boundaries above the client shells), which pass it to
 *            `<ThemeScript>`. The `(marketing)` group needs no nonce —
 *            its CSP authorizes the script by 'self'.
 *   region → `(app)/layout.tsx` for the in-app price surfaces, and the
 *            two marketing pages that quote a price (`/`, `/pricing`),
 *            each wrapping its own `BillingCurrencyProvider`.
 *
 * Adding a per-request read back here silently un-statics 30+ public
 * pages, with no test failure to warn you. `prerender-static-routes.test.ts`
 * is the guard.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: theme-init.js sets `data-theme` before
    // hydration, so the client html attributes legitimately differ
    // from the server-rendered ones.
    <html
      lang="en"
      className={`${geist.variable} ${geistMono.variable} ${fraunces.variable}`}
      suppressHydrationWarning
    >
      <body>
        {/* The theme resolver is rendered by each route group, not here —
            two of the three groups need it nonced and this layout may
            not read the nonce. See `features/theme/theme-script.tsx`. */}
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
