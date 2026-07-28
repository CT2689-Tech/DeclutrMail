import { Body, Container, Head, Hr, Html, Preview, Section, Text } from '@react-email/components';
import { render } from '@react-email/render';
import type { ReactElement, ReactNode } from 'react';

import { PRIVACY_BADGE_HEADLINE } from '@declutrmail/shared/copy';

/** Rendered email — what the EmailSendWorker job carries. */
export interface RenderedEmail {
  subject: string;
  text: string;
  /** Absent for the plain-text-locked kinds (D126 P3, D189). */
  html?: string;
}

/**
 * The locked From header (D162). Domain `send.declutrmail.com` is
 * verified in Resend; the display name keeps inbox rows scannable.
 */
export const EMAIL_FROM = 'DeclutrMail <hello@send.declutrmail.com>';

/**
 * Brand palette (D1/D2 warm-newsprint + deep teal), inlined as literals.
 * Email clients strip <style> blocks and CSS custom properties, so
 * `tokens.css` cannot reach this surface — these mirror its light-theme
 * values and `apps/web/src/app/opengraph-image.tsx`, which is the other
 * surface that has to hard-code them for the same reason.
 */
export const INK = '#0e1413';
export const PAPER = '#fafaf7';
export const CARD = '#ffffff';
export const TEAL = '#006b5f';
export const MUTED = '#646d69';
export const SOFT = '#4b5552';
export const RULE = 'rgba(14, 20, 19, 0.14)';

const SANS = "'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

/**
 * Display face for hero numerals (ADR-0016's `hero` variant). Fraunces
 * is self-hosted via next/font on the web and cannot load in an email
 * client, so the stack has to fall through to an installed serif.
 *
 * Times New Roman is the fallback rather than Georgia deliberately:
 * Georgia's DEFAULT figures are old-style, so "97,253" renders with the
 * 2/5/3 dropping below the baseline of the 9/7 — which reads as a
 * rendering bug at display size. Times New Roman defaults to lining
 * figures. `lining-nums` is also requested below, but Georgia ships no
 * lining set for it to select, so the font choice is what actually
 * fixes it.
 */
export const DISPLAY = "'Fraunces', 'Times New Roman', Times, serif";

/**
 * ADR-0016: every numeric surface is `tabular-nums`, and hero numerals
 * additionally need `lining-nums` to survive a serif fallback.
 */
export const HERO_NUMERAL = {
  color: INK,
  fontFamily: DISPLAY,
  fontSize: '44px',
  fontVariantNumeric: 'lining-nums tabular-nums',
  fontWeight: 300,
  letterSpacing: '-0.03em',
  lineHeight: '48px',
} as const;

/**
 * Brand chrome — the ONLY place it lives, so a copy or colour change is
 * one edit rather than one per template.
 *
 * The masthead reproduces the newspaper double rule + letterspaced
 * wordmark from the OG card, which is the brand's signature device.
 * It is built from bordered blocks, not flexbox or background images:
 * Outlook ignores flex, and Gmail blocks remote images until the reader
 * opts in — chrome that only appears after "display images" is chrome
 * that mostly does not appear.
 *
 * Every email closes on the D228 trust line. It is the product's whole
 * wedge and it is true of all four kinds, so it is shell-level rather
 * than per-template.
 */
export function Shell(props: {
  preview: string;
  children: ReactNode;
  footer: string;
}): ReactElement {
  return (
    <Html lang="en">
      <Head />
      <Preview>{props.preview}</Preview>
      <Body style={{ backgroundColor: PAPER, fontFamily: SANS, margin: 0, padding: '32px 0' }}>
        <Container style={{ maxWidth: '560px', padding: '0 16px' }}>
          {/* Newspaper double rule. */}
          <Section style={{ backgroundColor: INK, fontSize: '1px', lineHeight: '6px' }}>
            &nbsp;
          </Section>
          <Section
            style={{
              backgroundColor: 'rgba(14, 20, 19, 0.25)',
              fontSize: '1px',
              lineHeight: '2px',
              marginTop: '5px',
            }}
          >
            &nbsp;
          </Section>

          <Text
            style={{
              color: MUTED,
              fontSize: '11px',
              fontWeight: 600,
              letterSpacing: '0.18em',
              margin: '14px 0 0',
              textTransform: 'uppercase',
            }}
          >
            DeclutrMail
            <span style={{ color: TEAL }}> · Gmail cleanup, by sender</span>
          </Text>

          <Section
            style={{
              backgroundColor: CARD,
              border: `1px solid ${RULE}`,
              borderRadius: '10px',
              marginTop: '18px',
              padding: '32px',
            }}
          >
            {props.children}
          </Section>

          <Hr style={{ borderColor: RULE, margin: '22px 0 12px' }} />

          <Text
            style={{
              color: MUTED,
              fontSize: '12px',
              letterSpacing: '0.04em',
              margin: 0,
            }}
          >
            {PRIVACY_BADGE_HEADLINE}
          </Text>

          <Text style={{ color: MUTED, fontSize: '12px', lineHeight: '18px', margin: '10px 0 0' }}>
            {props.footer}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

/**
 * Primary CTA. Deep teal, never the pure black an unstyled email
 * button defaults to — black belongs to the masthead rule, and a black
 * button on the warm-newsprint ground reads as a system dialog.
 */
export const CTA_BUTTON = {
  backgroundColor: TEAL,
  borderRadius: '6px',
  color: '#ffffff',
  display: 'inline-block',
  fontSize: '14px',
  fontWeight: 600,
  letterSpacing: '0.01em',
  padding: '12px 22px',
  textDecoration: 'none',
} as const;

/** Body copy — one scale for every template. */
export const BODY_TEXT = {
  color: SOFT,
  fontSize: '15px',
  lineHeight: '23px',
} as const;

/**
 * Kicker above the headline. Carries the subject line into the body so
 * the card opens on what the mail is ABOUT, mirroring the masthead's
 * letterspaced caps.
 */
export function Eyebrow(props: { children: ReactNode }): ReactElement {
  return (
    <Text
      style={{
        color: MUTED,
        fontSize: '11px',
        fontWeight: 600,
        letterSpacing: '0.14em',
        margin: '0 0 14px',
        textTransform: 'uppercase',
      }}
    >
      {props.children}
    </Text>
  );
}

/** `render()` is async in React Email 4 — every caller must await. */
export async function renderShell(el: ReactElement): Promise<string> {
  return render(el);
}

/** "1 message" / "24,310 messages" — en-US grouping, premium-calm. */
export function formatCount(count: number, singular: string, plural: string): string {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}

/** The grouped numeral alone, for hero treatments that style it apart. */
export function formatNumber(count: number): string {
  return new Intl.NumberFormat('en-US').format(count);
}
