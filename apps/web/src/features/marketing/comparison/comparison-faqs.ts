import {
  fillComplete,
  fillWs3,
  passListed,
  priceFaqAnswer,
  privacyFaqAnswer,
  VS_FAQ_Q2_STYLE,
  WS3_COPY,
} from '@declutrmail/shared/copy/launch';
import { isPricingV2 } from '@declutrmail/shared/entitlements';

import type { ComparisonDefinition, ComparisonSlug } from './comparison-data';

const USE_CASE: Record<ComparisonSlug, string> = {
  'clean-email': WS3_COPY['ws3.vs.clean-email.useCase'],
  trimbox: WS3_COPY['ws3.vs.trimbox.useCase'],
  sanebox: WS3_COPY['ws3.vs.sanebox.useCase'],
  'leave-me-alone': WS3_COPY['ws3.vs.leave-me-alone.useCase'],
  'unroll-me': WS3_COPY['ws3.vs.unroll-me.useCase'],
  'gmail-filters': WS3_COPY['ws3.vs.gmail-filters.useCase'],
  gmail: WS3_COPY['ws3.vs.gmail.useCase'],
  'meta-muse': WS3_COPY['ws3.vs.meta-muse.useCase'],
  mailstrom: WS3_COPY['ws3.vs.mailstrom.useCase'],
  inboxpurge: WS3_COPY['ws3.vs.inboxpurge.useCase'],
  mailmop: WS3_COPY['ws3.vs.mailmop.useCase'],
};

const FAQ_ANSWER: Record<Exclude<ComparisonSlug, 'inboxpurge'>, string> = {
  'clean-email': WS3_COPY['ws3.vs.clean-email.faqAnswer'],
  trimbox: WS3_COPY['ws3.vs.trimbox.faqAnswer'],
  sanebox: WS3_COPY['ws3.vs.sanebox.faqAnswer'],
  'leave-me-alone': WS3_COPY['ws3.vs.leave-me-alone.faqAnswer'],
  'unroll-me': WS3_COPY['ws3.vs.unroll-me.faqAnswer'],
  'gmail-filters': WS3_COPY['ws3.vs.gmail-filters.faqAnswer'],
  gmail: WS3_COPY['ws3.vs.gmail.faqAnswer'],
  'meta-muse': WS3_COPY['ws3.vs.meta-muse.faqAnswer'],
  mailstrom: WS3_COPY['ws3.vs.mailstrom.faqAnswer'],
  mailmop: WS3_COPY['ws3.vs.mailmop.faqAnswer'],
};

function useCaseAnswer(slug: ComparisonSlug, passEnabled: boolean): string {
  if (slug === 'inboxpurge') {
    return passEnabled
      ? WS3_COPY['ws3.vs.inboxpurge.faqAnswer']
      : WS3_COPY['ws3.vs.inboxpurge.faqAnswer.passOff'];
  }
  return FAQ_ANSWER[slug];
}

const VERDICT: Record<ComparisonSlug, string> = {
  'clean-email': WS3_COPY['ws3.vs.clean-email.verdict'],
  trimbox: WS3_COPY['ws3.vs.trimbox.verdict'],
  sanebox: WS3_COPY['ws3.vs.sanebox.verdict'],
  'leave-me-alone': WS3_COPY['ws3.vs.leave-me-alone.verdict'],
  'unroll-me': WS3_COPY['ws3.vs.unroll-me.verdict'],
  'gmail-filters': WS3_COPY['ws3.vs.gmail-filters.verdict'],
  gmail: WS3_COPY['ws3.vs.gmail.verdict'],
  'meta-muse': WS3_COPY['ws3.vs.meta-muse.verdict'],
  mailstrom: WS3_COPY['ws3.vs.mailstrom.verdict'],
  inboxpurge: WS3_COPY['ws3.vs.inboxpurge.verdict'],
  mailmop: WS3_COPY['ws3.vs.mailmop.verdict'],
};

export function deckVerdict(slug: ComparisonSlug): string {
  return VERDICT[slug];
}

export function comparisonFaqs(
  comparison: ComparisonDefinition,
  passEnabled = passListed(),
  pricingV2 = isPricingV2(),
): readonly { q: string; a: string }[] {
  const competitor = comparison.name;
  const useCase = USE_CASE[comparison.slug];
  const question = fillWs3(WS3_COPY['ws3.vs.faq.useCase.q'], { Competitor: competitor, useCase });
  const privacyQuestion =
    VS_FAQ_Q2_STYLE === 'glossary'
      ? 'Does DeclutrMail read my emails?'
      : WS3_COPY['ws3.vs.faq.privacy.q'];
  return [
    { q: question, a: fillComplete(useCaseAnswer(comparison.slug, passEnabled)) },
    { q: privacyQuestion, a: privacyFaqAnswer() },
    { q: WS3_COPY['ws3.vs.faq.price.q'], a: priceFaqAnswer(passEnabled, pricingV2) },
  ].filter((faq) => faq.a !== '');
}

export function comparisonFaqJsonLd(
  comparison: ComparisonDefinition,
  passEnabled = passListed(),
  pricingV2 = isPricingV2(),
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: comparisonFaqs(comparison, passEnabled, pricingV2).map((faq) => ({
      '@type': 'Question',
      name: faq.q,
      acceptedAnswer: { '@type': 'Answer', text: faq.a },
    })),
  };
}
