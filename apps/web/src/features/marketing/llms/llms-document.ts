import { CASA_VERIFICATION_APPROVED_ON } from '@declutrmail/shared';
import { renderPricingMarkdown } from '@declutrmail/shared/entitlements';
import {
  LAUNCH_STAGE,
  llmsAutopilotLine,
  llmsBetaLine,
  llmsKeyFacts,
  llmsPricingLine,
  WS3_COPY,
} from '@declutrmail/shared/copy/launch';

import { COMPARISONS } from '../comparison/comparison-data';
import { comparisonFaqs } from '../comparison/comparison-faqs';
import { LLMS_SOURCE } from './llms-source';

const LAUNCH_SLUGS = ['mailstrom', 'inboxpurge', 'mailmop'] as const;

function withLaunchLinks(body: string): string {
  const block = LAUNCH_SLUGS.map((slug) => {
    const page = COMPARISONS.find((comparison) => comparison.slug === slug);
    return page ? `- [DeclutrMail vs ${page.name}](https://declutrmail.com/vs/${slug})` : '';
  })
    .filter(Boolean)
    .join('\n');
  const anchor = '- [DeclutrMail vs Meta Muse]';
  const index = body.indexOf(anchor);
  if (index < 0) return `${body}\n${block}\n`;
  const lineEnd = body.indexOf('\n', index);
  return `${body.slice(0, lineEnd)}\n${block}${body.slice(lineEnd)}`;
}

export function renderLlmsTxt(): string {
  let body = LLMS_SOURCE.replaceAll('21 April 2026', CASA_VERIFICATION_APPROVED_ON);
  body = body.replace(
    'Autopilot rules on Plus and Pro find future matches. Both plans support Observe, which waits for batch approval, and Active, which acts on future matches only after you preview and deliberately turn on a rule.',
    llmsAutopilotLine(),
  );
  body = body.replace(
    '- [Pricing](https://declutrmail.com/pricing): Free, Plus, and Pro plans; paid plans carry a 30-day money-back guarantee — see the refund policy for terms',
    `- [Pricing](https://declutrmail.com/pricing): ${llmsPricingLine()}`,
  );
  if (LAUNCH_STAGE === 'ga') {
    body = body.replace(
      '- [Open beta](https://declutrmail.com/beta): sign in with Google and review senders, no invite or waitlist needed',
      `- [Get started](https://declutrmail.com/beta): ${llmsBetaLine().replace(/^Get started: /, '')}`,
    );
  }
  body = withLaunchLinks(body);
  const facts = llmsKeyFacts()
    .map((fact) => `- ${fact}`)
    .join('\n');
  const header = `${WS3_COPY['ws3.llms.disambiguation']}\n\n## ${WS3_COPY['ws3.llms.keyFacts.title']}\n\n${facts}\n\n`;
  const pricing = renderPricingMarkdown();
  return `${header}${body.trim()}\n\n## Pricing\n\n${pricing}\n`;
}

export function renderLlmsFullTxt(): string {
  const pages = COMPARISONS.map((comparison) => {
    const faqs = comparisonFaqs(comparison)
      .map((faq) => `### ${faq.q}\n\n${faq.a}`)
      .join('\n\n');
    return `## ${comparison.title}\n\n${comparison.verdict}\n\n${faqs}`;
  }).join('\n\n');
  return `${renderLlmsTxt()}\n${pages}\n`;
}

export function llmsResponse(body: string): Response {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
