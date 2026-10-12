// /help — single-page FAQ (D219; content drawn from D137).
//
// Public marketing route: static prose, no auth round-trip; the only
// client JS is the D159 page-view tracker island. Each question is a
// LegalSection with a stable slug so answers deep-link (`/help#undo-windows`,
// D219). One content array feeds BOTH the rendered Q&A and the FAQPage
// JSON-LD (parallel copies are how the two drift apart).
//
// CONTENT CONTRACT (CLAUDE.md §2.1, D7, D228): the storage answer
// quotes the locked privacy copy module from `@declutrmail/shared`
// verbatim — never paraphrased. Refund terms were founder-confirmed
// 2026-07-08 (D121): 30-day money-back guarantee on every paid plan;
// the answer states it and links /refunds for the full terms.

import type { Metadata } from 'next';

import { marketingPageMetadata } from '@/features/marketing/page-metadata';
import { loadPricingFlags } from '@/features/marketing/pricing/load-pricing-flags';

import { HelpPage } from './help-surface';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Help & FAQ — DeclutrMail',
  description:
    'What DeclutrMail stores, how Unsubscribe works, what Archive, Later, and Delete do in Gmail terms, undo windows, Autopilot modes, and how to reach support.',
  path: '/help',
});

export default async function HelpRoute() {
  const flags = await loadPricingFlags();
  return <HelpPage pricingV2={flags.pricingV2} />;
}
