import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { Inter, JetBrains_Mono, Fraunces } from 'next/font/google';
import '@declutrmail/shared/tokens.css';
import { isFeatureEnabled } from '@/lib/flags';
import { siteUrl } from '@/features/marketing/landing/urls';
import { Providers } from './providers';

const inter = Inter({
  subsets: ['latin'],
  variable: '--dm-font-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
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
  description: 'Gmail cleanup — clear previews and plan-based Activity Undo.',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // CSP nonce plumbing (D175). `src/middleware.ts` mints a per-request
  // nonce and stamps it into the `Content-Security-Policy` request
  // header; Next.js applies it to its own framework <script> tags
  // automatically — but ONLY during dynamic rendering. Reading
  // `headers()` here opts every route out of static prerendering, so no
  // page can ever ship build-time HTML whose inline bootstrap scripts
  // carry a stale (or missing) nonce. Any future inline <Script> must
  // read the nonce the same way: `(await headers()).get('x-nonce')`.
  // https://nextjs.org/docs/app/guides/content-security-policy
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    // suppressHydrationWarning: theme-init.js sets `data-theme` before
    // hydration, so the client html attributes legitimately differ
    // from the server-rendered ones.
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} ${fraunces.variable}`}
      suppressHydrationWarning
    >
      <body>
        {/* Theme resolver — parser-blocking on purpose so a stored dark
            preference applies before first paint (no light flash).
            Nonced: script-src is 'strict-dynamic', which ignores 'self'
            host-source in CSP3 — without the nonce this static asset
            would be blocked (see src/middleware.ts D175 notes).
            suppressHydrationWarning: browsers hide the nonce attribute
            from DOM reads, so the client always sees "" — a known,
            harmless mismatch on any nonced tag. */}
        {/* darkMode flag off ⇒ skip the resolver entirely: data-theme is
            never set, so the app renders light even for users with a
            stored dark preference (ADR-0025 kill-switch semantics). */}
        {isFeatureEnabled('darkMode') && (
          <script src="/theme-init.js" nonce={nonce} suppressHydrationWarning />
        )}
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
