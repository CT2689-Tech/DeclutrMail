import {
  BRAND_VERIFICATION_APPROVED_ON,
  CASA_LOV_SUBMITTED_ON,
  CASA_VERIFICATION_APPROVED_ON,
  formatVerificationDate,
} from '@declutrmail/shared';
import { isPricingV2, renderPricingMarkdown } from '@declutrmail/shared/entitlements';
import {
  fillWs3,
  LAUNCH_STAGE,
  llmsAutopilotLine,
  llmsBetaLine,
  llmsKeyFacts,
  llmsPricingLine,
  llmsStorageAiLine,
  ws3Tokens,
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

const PREVIOUS_DESCRIBE =
  '- Preferred one-line description: Gmail cleanup by sender: preview the matching emails and planned changes before confirming manual Archive, Later, or Delete; opt into ongoing Autopilot rules on Plus or Pro.';

const PREVIOUS_NOT_AUTOMATIC =
  '- fully automatic by default. Manual actions require approval of a preview. On both Plus and Pro, Observe collects matches for batch approval; only a rule deliberately set to Active acts without asking.';

const PREVIOUS_HOW_IT_WORKS =
  'Gmail remains the reading/reply surface; manual actions affect the previewed messages; Autopilot presets (Plus and Pro) handle future matches, unattended only after deliberately activating a rule on either plan';

const PREVIOUS_HELP =
  'what is stored, how Unsubscribe works (per-sender; one-click vs manual mailto; bulk cleanup across senders on every plan, metered monthly on Free), what Archive/Later/Delete do in Gmail terms, undo windows, Autopilot Observe vs Active, disconnecting and account deletion';

/** Keep the previous sentence while a plan-name token is still empty. */
function filledLlmsFix(template: string): string {
  const tokens = ws3Tokens();
  if (template.includes('{plusName}') && tokens.plusName === '') return '';
  if (template.includes('{freeName}') && tokens.freeName === '') return '';
  const filled = fillWs3(template);
  return filled.includes('{') ? '' : filled;
}

function applyDeckFixes(body: string): string {
  const describe = filledLlmsFix(WS3_COPY['ws3.llms.fix.describe']);
  if (describe) body = body.replace(PREVIOUS_DESCRIBE, `- ${describe}`);
  const notAutomatic = filledLlmsFix(WS3_COPY['ws3.llms.fix.notAutomatic']);
  if (notAutomatic) body = body.replace(PREVIOUS_NOT_AUTOMATIC, `- ${notAutomatic}`);
  const howItWorks = filledLlmsFix(WS3_COPY['ws3.llms.fix.howItWorks']);
  if (howItWorks) body = body.replace(PREVIOUS_HOW_IT_WORKS, howItWorks);
  const help = filledLlmsFix(WS3_COPY['ws3.llms.fix.help']);
  if (help) body = body.replace(PREVIOUS_HELP, help);
  const storageAi = llmsStorageAiLine();
  if (storageAi) body = body.replace(WS3_COPY['ws3.llms.storageAi'], storageAi);
  return body;
}

/**
 * H1, blockquote, then plain paragraphs (disambiguation, storage), then
 * Key facts as the first H2. Later sections stay in source order.
 */
function withOpeningFacts(body: string, facts: string): string {
  const headingAt = body.indexOf('\n## ');
  const opening = (headingAt < 0 ? body : body.slice(0, headingAt)).trimEnd();
  const rest = headingAt < 0 ? '' : body.slice(headingAt + 1).trim();
  const lines = opening.split('\n');
  let quoteEnd = -1;
  for (const [index, line] of lines.entries()) {
    if (line.startsWith('>')) quoteEnd = index;
  }
  const disambiguation = WS3_COPY['ws3.llms.disambiguation'];
  const quoted =
    quoteEnd < 0
      ? [...lines, '', disambiguation]
      : [...lines.slice(0, quoteEnd + 1), '', disambiguation, ...lines.slice(quoteEnd + 1)];
  const prose = quoted
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
  const keyFacts = `## ${WS3_COPY['ws3.llms.keyFacts.title']}\n\n${facts}`;
  return rest ? `${prose}\n\n${keyFacts}\n\n${rest}` : `${prose}\n\n${keyFacts}`;
}

const CHANGELOG_LINE =
  '- [Pricing changelog](https://declutrmail.com/pricing/changelog): dated record of pricing changes';

/** The changelog page redirects while `PRICING_V2` is off, so crawlers see it only then. */
function withPricingChangelog(body: string): string {
  if (!isPricingV2()) return body;
  const marker = '- [Pricing](https://declutrmail.com/pricing):';
  const at = body.indexOf(marker);
  if (at === -1) return `${body}\n${CHANGELOG_LINE}\n`;
  const lineEnd = body.indexOf('\n', at);
  if (lineEnd === -1) return `${body}\n${CHANGELOG_LINE}`;
  return `${body.slice(0, lineEnd + 1)}${CHANGELOG_LINE}\n${body.slice(lineEnd + 1)}`;
}

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
  body = applyDeckFixes(body);
  const pricingLine = llmsPricingLine().replace(/^Pricing:\s*/, '');
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
  body = withPricingChangelog(withLaunchLinks(body));
  const facts = llmsKeyFacts()
    .map((fact) => `- ${fact}`)
    .join('\n');
  const pricing = renderPricingMarkdown().trim();
  const pricingSection = pricing === '' ? '\n' : `\n\n## Pricing\n\n${pricing}\n`;
  return `${withOpeningFacts(body.trim(), facts)}${pricingSection}`;
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
