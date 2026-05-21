import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Inter, JetBrains_Mono, Fraunces } from 'next/font/google';
import '@declutrmail/shared/tokens.css';

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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} ${fraunces.variable}`}>
      <body>{children}</body>
    </html>
  );
}
