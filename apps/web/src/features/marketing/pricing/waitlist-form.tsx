'use client';

import { useState, type FormEvent } from 'react';

import { tokens } from '@declutrmail/shared';
import type { TierId } from '@declutrmail/shared/entitlements';

import { joinWaitlist } from '@/lib/api/waitlist';
import { track } from '@/lib/posthog';

const { color, font, radius } = tokens;

/**
 * Inline waitlist capture (D19 — Team "Coming Q3 2026" row).
 *
 * States: idle → submitting → confirmed | error. The server answers
 * 202 with one constant body for new AND duplicate emails (no
 * email-exists oracle), so the confirmed state is the same either way
 * by construction — the UI never branches on "already signed up".
 *
 * The "optimistic" feel comes from the submitting state (input +
 * button lock immediately); the confirmed copy renders only after the
 * server's 202 — never before.
 */
export function WaitlistForm({ tierInterest, source }: { tierInterest: TierId; source: string }) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'confirmed' | 'error'>('idle');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (status === 'submitting') return;
    setStatus('submitting');
    try {
      await joinWaitlist({ email: email.trim(), tierInterest, source });
      setStatus('confirmed');
      // D159 — fires only after the server accepted; never the email.
      void track('waitlist_joined', { tier_interest: tierInterest, source });
    } catch {
      setStatus('error');
    }
  }

  if (status === 'confirmed') {
    return (
      <p
        role="status"
        style={{
          margin: 0,
          fontFamily: font.sans,
          fontSize: 13,
          fontWeight: 600,
          color: color.primary,
        }}
      >
        You’re on the list — we’ll email you when Team opens.
      </p>
    );
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}
    >
      <input
        type="email"
        required
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          if (status === 'error') setStatus('idle');
        }}
        placeholder="you@company.com"
        aria-label="Work email for the Team waitlist"
        disabled={status === 'submitting'}
        style={{
          height: 32,
          width: 220,
          maxWidth: '100%',
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
      <button
        type="submit"
        disabled={status === 'submitting'}
        style={{
          height: 32,
          padding: '0 14px',
          fontFamily: font.sans,
          fontSize: 13,
          fontWeight: 600,
          color: '#FFFFFF',
          background: status === 'submitting' ? color.fgMuted : color.fg,
          border: `1px solid ${status === 'submitting' ? color.fgMuted : color.fg}`,
          borderRadius: radius.sm,
          cursor: status === 'submitting' ? 'wait' : 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {status === 'submitting' ? 'Joining…' : 'Join the waitlist'}
      </button>
      {status === 'error' ? (
        <span role="alert" style={{ fontFamily: font.sans, fontSize: 12.5, color: color.danger }}>
          Couldn’t reach the server — please try again.
        </span>
      ) : null}
    </form>
  );
}
