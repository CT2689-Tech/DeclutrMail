import { Body, Container, Head, Hr, Html, Preview, Text } from '@react-email/components';
import { render } from '@react-email/render';
import type { ReactElement, ReactNode } from 'react';

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

const font = '"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';

/**
 * Brand chrome lives here and nowhere else, so a copy or colour change
 * is one edit rather than one per template. Colours are inlined rather
 * than tokenised: email clients strip <style> blocks and CSS custom
 * properties, so `tokens.css` cannot reach this surface.
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
      <Body style={{ backgroundColor: '#fafafa', fontFamily: font, margin: 0, padding: '24px 0' }}>
        <Container
          style={{
            backgroundColor: '#ffffff',
            border: '1px solid #eaeaea',
            borderRadius: '8px',
            maxWidth: '520px',
            padding: '32px',
          }}
        >
          {props.children}
          <Hr style={{ borderColor: '#eaeaea', margin: '28px 0 16px' }} />
          <Text style={{ color: '#666666', fontSize: '12px', lineHeight: '18px', margin: 0 }}>
            {props.footer}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

/** `render()` is async in React Email 4 — every caller must await. */
export async function renderShell(el: ReactElement): Promise<string> {
  return render(el);
}

/** "1 message" / "24,310 messages" — en-US grouping, premium-calm. */
export function formatCount(count: number, singular: string, plural: string): string {
  const formatted = new Intl.NumberFormat('en-US').format(count);
  return `${formatted} ${count === 1 ? singular : plural}`;
}
