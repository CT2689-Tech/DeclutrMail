'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, tokens } from '@declutrmail/shared';
import type { SignupHeardFromPatch } from '@declutrmail/shared/contracts';

import { apiPatch } from '@/lib/api/client';
import { CONSENT_CHANGE_EVENT, readStoredConsent } from '@/lib/cookie-consent';
import { ME_QUERY_KEY } from './api/me-contract';
import { useAuth } from './auth-provider';

const { color, font, shadow } = tokens;

const CHOICES = [
  { value: 'hn', label: 'Hacker News' },
  { value: 'ph', label: 'Product Hunt' },
  { value: 'reddit', label: 'Reddit' },
  { value: 'simulator', label: 'Inbox simulator' },
  { value: 'x', label: 'X' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'friend', label: 'Friend or colleague' },
] as const;

/**
 * Skippable first-login self-report. Not a sixth onboarding step — it
 * sits on authed chrome and does not block sync or triage.
 *
 * QUEUED BEHIND THE CONSENT BANNER, and that is a layout fix, not a
 * preference. Both cards are `position: fixed` at `bottom: 16` with
 * `width: calc(100vw - 32px); max-width: 400px`, anchored to opposite
 * sides. Below a 832px viewport those two rectangles are the same
 * rectangle, and the banner's higher z-index (150 vs 140) puts it on top
 * — on a phone the prompt is simply invisible underneath it. Both mount
 * on the onboarding layout AND the app chrome, so a first login is
 * exactly when they collide. Consent is the required ask and goes first;
 * this one appears once a choice is stored. Read post-mount and synced on
 * the consent event, the same way the banner itself does it, so the
 * server render and the first client paint agree.
 */
export function HeardFromPrompt() {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const [otherDetail, setOtherDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [failed, setFailed] = useState(false);
  const [consentSettled, setConsentSettled] = useState(false);

  useEffect(() => {
    const sync = () => setConsentSettled(readStoredConsent() !== null);
    sync();
    window.addEventListener(CONSENT_CHANGE_EVENT, sync);
    return () => window.removeEventListener(CONSENT_CHANGE_EVENT, sync);
  }, []);

  if (!consentSettled || dismissed || me.signupAttribution?.promptNeeded !== true) return null;

  const submit = async (patch: SignupHeardFromPatch) => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await apiPatch('/api/me/signup-heard-from', patch);
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      setDismissed(true);
    } catch {
      // Say so rather than silently resetting the buttons: the previous
      // version left the card looking untouched, so a repeatable failure
      // read as a dead control.
      setFailed(true);
      setBusy(false);
    }
  };

  return (
    <HeardFromPromptView
      busy={busy}
      failed={failed}
      otherDetail={otherDetail}
      onOtherDetailChange={setOtherDetail}
      onChoose={(heardFrom) => void submit({ heardFrom })}
      onSkip={() => void submit({ heardFrom: 'skipped' })}
      onSubmitOther={(detail) => void submit({ heardFrom: 'other', detail })}
    />
  );
}

/**
 * Presentational half — props only, no auth/consent/query.
 *
 * Split out for the same reason `NoActiveMailboxView` is: every state
 * (idle / busy / failed) has to be reachable in a story without mounting
 * `AuthProvider` (D210).
 */
export function HeardFromPromptView({
  busy,
  failed,
  otherDetail,
  onOtherDetailChange,
  onChoose,
  onSkip,
  onSubmitOther,
}: {
  busy: boolean;
  failed: boolean;
  otherDetail: string;
  onOtherDetailChange: (value: string) => void;
  onChoose: (heardFrom: (typeof CHOICES)[number]['value']) => void;
  onSkip: () => void;
  onSubmitOther: (detail: string) => void;
}) {
  return (
    <section
      aria-label="How did you first hear about us?"
      data-testid="heard-from-prompt"
      style={{
        position: 'fixed',
        bottom: 16,
        left: 16,
        zIndex: 140,
        width: 'calc(100vw - 32px)',
        maxWidth: 400,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        background: color.card,
        border: `1px solid ${color.border}`,
        borderRadius: 10,
        boxShadow: shadow.pop,
        fontFamily: font.sans,
      }}
    >
      <p style={{ margin: 0, fontSize: 14, color: color.fg }}>How did you first hear about us?</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {CHOICES.map((choice) => (
          <Button
            key={choice.value}
            type="button"
            tone="ghost"
            size="sm"
            disabled={busy}
            onClick={() => onChoose(choice.value)}
          >
            {choice.label}
          </Button>
        ))}
      </div>
      <label
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          fontSize: 12,
          color: color.fgMuted,
        }}
      >
        Something else
        <input
          value={otherDetail}
          placeholder="Where did you hear about us?"
          onChange={(event) => onOtherDetailChange(event.target.value)}
          maxLength={200}
          disabled={busy}
          style={{
            fontFamily: font.sans,
            fontSize: 14,
            padding: '6px 8px',
            border: `1px solid ${color.border}`,
            borderRadius: 6,
            background: color.bg,
            color: color.fg,
          }}
        />
      </label>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button type="button" tone="ghost" disabled={busy} onClick={onSkip}>
          Skip
        </Button>
        <Button
          type="button"
          tone="primary"
          disabled={busy || otherDetail.trim().length === 0}
          onClick={() => onSubmitOther(otherDetail.trim())}
        >
          Send
        </Button>
      </div>
      {failed ? (
        <p role="status" style={{ margin: 0, fontSize: 12, color: color.danger }}>
          That didn&apos;t save. Try again.
        </p>
      ) : null}
    </section>
  );
}
