'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, tokens } from '@declutrmail/shared';
import type { SignupHeardFromPatch } from '@declutrmail/shared/contracts';

import { apiPatch } from '@/lib/api/client';
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
 */
export function HeardFromPrompt() {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const [otherDetail, setOtherDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || me.signupAttribution?.promptNeeded !== true) return null;

  const submit = async (patch: SignupHeardFromPatch) => {
    if (busy) return;
    setBusy(true);
    try {
      await apiPatch('/api/me/signup-heard-from', patch);
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      setDismissed(true);
    } catch {
      setBusy(false);
    }
  };

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
            onClick={() => void submit({ heardFrom: choice.value })}
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
        Other
        <input
          value={otherDetail}
          onChange={(event) => setOtherDetail(event.target.value)}
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
        <Button
          type="button"
          tone="ghost"
          disabled={busy}
          onClick={() => void submit({ heardFrom: 'skipped' })}
        >
          Skip
        </Button>
        <Button
          type="button"
          tone="primary"
          disabled={busy || otherDetail.trim().length === 0}
          onClick={() => void submit({ heardFrom: 'other', detail: otherDetail.trim() })}
        >
          Other
        </Button>
      </div>
    </section>
  );
}
