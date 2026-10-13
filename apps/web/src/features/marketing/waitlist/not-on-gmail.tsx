'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';

import { WS3_COPY } from '@declutrmail/shared/copy/launch';
import type { WaitlistProviderClass } from '@declutrmail/shared/contracts';

import { ApiError } from '@/lib/api/client';
import { joinProviderWaitlist } from '@/lib/api/provider-waitlist';
import { track } from '@/lib/posthog';

const PROVIDER_OPTIONS = [
  ['outlook', WS3_COPY['ws3.notOnGmail.provider.options'][0]],
  ['m365', WS3_COPY['ws3.notOnGmail.provider.options'][1]],
  ['yahoo_aol', WS3_COPY['ws3.notOnGmail.provider.options'][2]],
  ['icloud', WS3_COPY['ws3.notOnGmail.provider.options'][3]],
  ['other', WS3_COPY['ws3.notOnGmail.provider.options'][4]],
] as const;

type PickedProvider = (typeof PROVIDER_OPTIONS)[number][0];

const CLASSES = new Set<WaitlistProviderClass>([
  'gmail',
  'google_workspace',
  'microsoft',
  'yahoo_aol',
  'icloud',
  'other',
  'unknown',
]);

export function NotOnGmail({ source }: { source: 'landing' | 'sign_in' }) {
  const [email, setEmail] = useState('');
  const [provider, setProvider] = useState<PickedProvider | ''>('');
  const [wouldPay, setWouldPay] = useState(false);
  const [contactOptIn, setContactOptIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [providerClass, setProviderClass] = useState<WaitlistProviderClass | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (done || busy) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError(WS3_COPY['ws3.notOnGmail.error.invalid']);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await joinProviderWaitlist({
        email: email.trim(),
        ...(provider ? { provider } : {}),
        ...(wouldPay ? { wouldPay: true } : {}),
        contactOptIn,
        source,
      });
      const klass = result.data.providerClass;
      const providerClassValue = klass && CLASSES.has(klass) ? klass : 'unknown';
      setProviderClass(providerClassValue);
      setDone(true);
      await track('provider_waitlist_joined', {
        provider: provider || 'unspecified',
        provider_class: providerClassValue,
        would_pay: wouldPay,
      });
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 429
          ? WS3_COPY['ws3.notOnGmail.error.rateLimited']
          : err instanceof ApiError && err.status === 400
            ? WS3_COPY['ws3.notOnGmail.error.invalid']
            : WS3_COPY['ws3.notOnGmail.error.generic'],
      );
    } finally {
      setBusy(false);
    }
  }

  const gmail = providerClass === 'gmail' || providerClass === 'google_workspace';

  return (
    <details className="dm-waitlist" id={source === 'landing' ? 'not-on-gmail' : undefined}>
      <summary style={{ minHeight: 24 }}>{WS3_COPY['ws3.notOnGmail.link']}</summary>
      {done ? (
        <div>
          <p>
            {contactOptIn ? WS3_COPY['ws3.notOnGmail.done.optIn'] : WS3_COPY['ws3.notOnGmail.done']}
          </p>
          {gmail ? (
            <p>
              {WS3_COPY['ws3.notOnGmail.gmailDetected']}{' '}
              <Link href="/sign-in">{WS3_COPY['ws3.notOnGmail.gmailDetected.cta']}</Link>
            </p>
          ) : null}
        </div>
      ) : (
        <form onSubmit={onSubmit}>
          <p className="dm-waitlist-title">{WS3_COPY['ws3.notOnGmail.title']}</p>
          <p>{WS3_COPY['ws3.notOnGmail.body']}</p>
          <label>
            {WS3_COPY['ws3.notOnGmail.email.label']}
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            {WS3_COPY['ws3.notOnGmail.provider.label']}
            <select
              name="provider"
              value={provider}
              onChange={(event) => setProvider(event.target.value as PickedProvider | '')}
            >
              <option value=""> </option>
              {PROVIDER_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              name="wouldPay"
              checked={wouldPay}
              onChange={(event) => setWouldPay(event.target.checked)}
            />
            {WS3_COPY['ws3.notOnGmail.wouldPay']}
          </label>
          <label>
            <input
              type="checkbox"
              name="contactOptIn"
              checked={contactOptIn}
              onChange={(event) => setContactOptIn(event.target.checked)}
            />
            {WS3_COPY['ws3.notOnGmail.optIn']}
          </label>
          <p>
            {WS3_COPY['ws3.notOnGmail.privacy'].split('Privacy Policy')[0]}
            <Link href="/privacy">Privacy Policy</Link>
            {WS3_COPY['ws3.notOnGmail.privacy'].split('Privacy Policy')[1]}
          </p>
          {error ? <p role="alert">{error}</p> : null}
          <button type="submit" disabled={busy || done}>
            {busy ? WS3_COPY['ws3.notOnGmail.busy'] : WS3_COPY['ws3.notOnGmail.submit']}
          </button>
        </form>
      )}
    </details>
  );
}
