'use client';

import { useState, type FormEvent } from 'react';

import { Button, tokens } from '@declutrmail/shared';

import { SettingsGroup } from '@/features/settings/settings-list';

import { postSupportRequest } from '@/lib/api/support-request';
import { track } from '@/lib/posthog';

const { color, font, radius, text } = tokens;

type Status = 'idle' | 'submitting' | 'confirmed' | 'error';

/**
 * "Contact support" — Settings → Help & glossary, below the product
 * glossary. Authed users only; queues a request to support@ via
 * `POST /api/support-request`. No attachment or ticket table —
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
      <SettingsGroup title="Contact support">
        <p
          role="status"
          style={{
            margin: 0,
            padding: '17px 16px',
            fontSize: text.md,
            color: color.fg,
          }}
        >
          Request received — we reply within 2 business days. You can also email{' '}
          <a href="mailto:support@declutrmail.com" style={{ color: color.primary }}>
            support@declutrmail.com
          </a>
          .
        </p>
      </SettingsGroup>
    );
  }

  return (
    <SettingsGroup title="Contact support">
      <form
        onSubmit={(e) => void submit(e)}
        style={{
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <style>{`.dm-support-field:focus-visible { box-shadow: 0 0 0 2px ${color.primary}; }`}</style>
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
          className="dm-support-field"
          style={{
            height: 44,
            padding: '0 14px',
            fontFamily: font.sans,
            fontSize: text.md,
            color: color.fg,
            background: color.fill,
            border: `1px solid ${status === 'error' ? color.dangerBorder : 'transparent'}`,
            borderRadius: radius.md,
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
          className="dm-support-field"
          style={{
            padding: '12px 14px',
            fontFamily: font.sans,
            fontSize: text.md,
            color: color.fg,
            background: color.fill,
            border: `1px solid ${status === 'error' ? color.dangerBorder : 'transparent'}`,
            borderRadius: radius.md,
            outline: 'none',
            resize: 'vertical',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Button type="submit" tone="primary" disabled={status === 'submitting'}>
            {status === 'submitting' ? 'Sending…' : 'Send message'}
          </Button>
          {status === 'error' ? (
            <span role="alert" style={{ fontSize: text.sm, color: color.danger }}>
              Couldn't send that — try again, or email{' '}
              <a href="mailto:support@declutrmail.com" style={{ color: color.danger }}>
                support@declutrmail.com
              </a>
              .
            </span>
          ) : null}
        </div>
      </form>
    </SettingsGroup>
  );
}
