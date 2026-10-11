import {
  BRAND_VERIFICATION_APPROVED_ON,
  CASA_LOV_SUBMITTED_ON,
  CASA_VERIFICATION_APPROVED_ON,
  formatVerificationDate,
} from '@declutrmail/shared';
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

const PREVIOUS_AUTOPILOT =
  'Autopilot rules on Plus and Pro find future matches. Both plans support Observe, which waits for batch approval, and Active, which acts on future matches only after you preview and deliberately turn on a rule.';

const PREVIOUS_PRICING =
  '- [Pricing](https://declutrmail.com/pricing): Free, Plus, and Pro plans; paid plans carry a 30-day money-back guarantee — see the refund policy for terms';

/** OAuth approval, brand verification, and the CASA letter are three facts. */
export function llmsSecurityFacts(): string {
  return [
    `Google OAuth verification for gmail.modify approved ${formatVerificationDate(CASA_VERIFICATION_APPROVED_ON)}`,
    `brand verification approved ${formatVerificationDate(BRAND_VERIFICATION_APPROVED_ON)}`,
    `CASA Tier 2 letter of validation submitted ${formatVerificationDate(CASA_LOV_SUBMITTED_ON)}`,
  ].join('; ');
}

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
  let body = LLMS_SOURCE.replaceAll('LLMS_SECURITY_FACTS', llmsSecurityFacts());
  const autopilot = llmsAutopilotLine();
  if (autopilot) body = body.replace(PREVIOUS_AUTOPILOT, autopilot);
  const pricingLine = llmsPricingLine();
  if (pricingLine)
    body = body.replace(
      PREVIOUS_PRICING,
      `- [Pricing](https://declutrmail.com/pricing): ${pricingLine}`,
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
  const pricing = renderPricingMarkdown().trim();
  const pricingSection = pricing === '' ? '\n' : `\n\n## Pricing\n\n${pricing}\n`;
  return `${header}${body.trim()}${pricingSection}`;
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
