'use client';

import { useState, type FormEvent } from 'react';

import { Button, Card, tokens } from '@declutrmail/shared';

import { postSupportRequest } from '@/lib/api/support-request';
import { track } from '@/lib/posthog';

const { color, font, radius } = tokens;

type Status = 'idle' | 'submitting' | 'confirmed' | 'error';

/**
 * "Contact support" — Settings → Help & glossary, below the product
 * glossary. Authed users only; sends one email to support@ via
 * `POST /api/support-request`. No attachment, no ticket persistence —
 * see docs/superpowers/specs/2026-09-01-contact-support-form-design.md.
 */
export function ContactSupportForm() {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<Status>('idle');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (status === 'submitting') return;
    setStatus('submitting');
    try {
      await postSupportRequest({ subject, message });
      setStatus('confirmed');
      setSubject('');
      setMessage('');
      void track('support_request_submitted', {});
    } catch {
      setStatus('error');
    }
  }

  if (status === 'confirmed') {
    return (
      <Card padding={0}>
        <div style={{ padding: '18px 20px', fontFamily: font.sans }}>
          <p
            role="status"
            style={{ margin: 0, fontSize: 13, fontWeight: 600, color: color.primary }}
          >
            Message sent — we reply within 2 business days.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card padding={0}>
      <form
        onSubmit={(e) => void submit(e)}
        style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}
      >
        <h3
          style={{
            fontSize: 15,
            fontWeight: 600,
            margin: 0,
            color: color.fg,
            fontFamily: font.sans,
          }}
        >
          Contact support
        </h3>
        <p style={{ fontSize: 12.5, color: color.fgSoft, lineHeight: 1.5, margin: 0 }}>
          Send a message straight to our team — we reply within 2 business days.
        </p>
        <input
          type="text"
          required
          value={subject}
          onChange={(e) => {
            setSubject(e.target.value);
            if (status === 'error') setStatus('idle');
          }}
          placeholder="Subject"
          aria-label="Subject"
          maxLength={150}
          disabled={status === 'submitting'}
          style={{
            height: 34,
            padding: '0 10px',
            fontFamily: font.sans,
            fontSize: 13,
            color: color.fg,
            background: color.card,
            border: `1px solid ${status === 'error' ? color.dangerBorder : color.border}`,
            borderRadius: radius.sm,
            outline: 'none',
          }}
        />
        <textarea
          required
          minLength={10}
          maxLength={5000}
          rows={5}
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            if (status === 'error') setStatus('idle');
          }}
          placeholder="What's going on?"
          aria-label="Message"
          disabled={status === 'submitting'}
          style={{
            padding: '8px 10px',
            fontFamily: font.sans,
            fontSize: 13,
            color: color.fg,
            background: color.card,
            border: `1px solid ${status === 'error' ? color.dangerBorder : color.border}`,
            borderRadius: radius.sm,
            outline: 'none',
            resize: 'vertical',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Button type="submit" tone="primary" disabled={status === 'submitting'}>
            {status === 'submitting' ? 'Sending…' : 'Send message'}
          </Button>
          {status === 'error' ? (
            <span role="alert" style={{ fontSize: 12.5, color: color.danger }}>
              Couldn't send that — try again, or email{' '}
              <a href="mailto:support@declutrmail.com" style={{ color: color.danger }}>
                support@declutrmail.com
              </a>
              .
            </span>
          ) : null}
        </div>
      </form>
    </Card>
  );
}
