import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { Inter, JetBrains_Mono, Fraunces } from 'next/font/google';
import '@declutrmail/shared/tokens.css';
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
  title: 'DeclutrMail',
  description: 'Gmail cleanup — decided once per sender, reversible for 7 days.',
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
  await headers();
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} ${fraunces.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
