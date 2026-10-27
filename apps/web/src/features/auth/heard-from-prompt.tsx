'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@declutrmail/shared';
import {
  SIGNUP_HEARD_FROM_CHOICES,
  type SignupHeardFromPatch,
} from '@declutrmail/shared/contracts';

import { AI_PROMPT_CHANGED, aiConsentBlocksHeardFrom } from '@/features/ai-consent/ai-prompt-queue';
import { readMeSettings } from '@/features/settings/api/me-settings-reader';
import { meSettingsQueryOptions } from '@/features/settings/api/query-options';
import { apiPatch } from '@/lib/api/client';
import { CONSENT_CHANGE_EVENT, readStoredConsent } from '@/lib/cookie-consent';
import { ME_QUERY_KEY } from './api/me-contract';
import { useAuth } from './auth-provider';
import styles from './heard-from-prompt.module.css';

type HeardFromChoice = (typeof SIGNUP_HEARD_FROM_CHOICES)[number];
const LEGACY_CHANNELS = new Set(['hn', 'ph', 'reddit', 'simulator', 'x', 'linkedin', 'friend']);

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
  const pathname = usePathname();
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const [otherDetail, setOtherDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [failed, setFailed] = useState(false);
  const [consentSettled, setConsentSettled] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [promptTick, setPromptTick] = useState(0);

  useEffect(() => {
    const sync = () => setConsentSettled(readStoredConsent() !== null);
    sync();
    window.addEventListener(CONSENT_CHANGE_EVENT, sync);
    return () => window.removeEventListener(CONSENT_CHANGE_EVENT, sync);
  }, []);

  useLayoutEffect(() => {
    const sync = () =>
      setSheetOpen(document.querySelector('[role="dialog"], [role="alertdialog"]') !== null);
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['role'],
    });
    return () => observer.disconnect();
  }, []);

  const onAiSurface = pathname === '/brief' || pathname === '/triage' || pathname === '/senders';
  const settings = useQuery({
    ...meSettingsQueryOptions(readMeSettings),
    enabled: onAiSurface && consentSettled,
  });

  useEffect(() => {
    const sync = () => setPromptTick((tick) => tick + 1);
    window.addEventListener(AI_PROMPT_CHANGED, sync);
    return () => window.removeEventListener(AI_PROMPT_CHANGED, sync);
  }, []);

  if (!consentSettled || dismissed || sheetOpen || me.signupAttribution?.promptNeeded !== true) {
    return null;
  }
  if (pathname === '/settings' || pathname.startsWith('/settings/')) return null;
  // Phone width makes this card as wide as the page. Billing leaves the
  // plan controls clear.
  if (pathname === '/billing') return null;

  // `promptTick` is the same-tab dismissal signal. The read below sees
  // the localStorage write only because that event re-rendered us.
  void promptTick;
  if (
    aiConsentBlocksHeardFrom({
      pathname,
      view: settings.data?.aiConsent,
      tier: me.tier ?? 'free',
      now: Date.now(),
      settingsPending: onAiSurface && settings.isLoading && settings.data == null,
    })
  ) {
    return null;
  }

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

  // The frontend can arrive before an API/migration rollout. Only offer
  // channels the serving API accepts; older APIs retain the original set.
  const supportedChannels = me.signupAttribution?.supportedChannels;
  const choices = SIGNUP_HEARD_FROM_CHOICES.filter((choice) =>
    supportedChannels
      ? supportedChannels.includes(choice.value)
      : LEGACY_CHANNELS.has(choice.value),
  );

  return (
    <HeardFromPromptView
      choices={choices}
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
  choices = SIGNUP_HEARD_FROM_CHOICES,
  initiallyExpanded = false,
  initiallyOther = false,
}: {
  busy: boolean;
  failed: boolean;
  otherDetail: string;
  onOtherDetailChange: (value: string) => void;
  onChoose: (heardFrom: (typeof SIGNUP_HEARD_FROM_CHOICES)[number]['value']) => void;
  onSkip: () => void;
  onSubmitOther: (detail: string) => void;
  choices?: readonly HeardFromChoice[];
  /** Presentation fixtures can open the same native disclosures without auth. */
  initiallyExpanded?: boolean;
  initiallyOther?: boolean;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded || Boolean(otherDetail));
  const [otherOpen, setOtherOpen] = useState(initiallyOther || Boolean(otherDetail));
  const otherInput = useRef<HTMLInputElement>(null);
  const focusOtherWhenMounted = useRef(false);

  const revealOther = () => {
    focusOtherWhenMounted.current = true;
    setOtherOpen(true);
    // The form mounts after this event. Its callback ref focuses only when
    // the user requests it, never when the optional prompt first appears.
    if (otherInput.current) {
      otherInput.current.focus();
      focusOtherWhenMounted.current = false;
    }
  };

  return (
    <section
      aria-label="How did you first hear about us?"
      data-testid="heard-from-prompt"
      className={styles.prompt}
    >
      <details open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
        <summary className={styles.summary}>
          <span>
            <span className={styles.optional}>Optional</span>
            <span className={styles.question}>How did you first hear about us?</span>
          </span>
          <svg
            className={styles.chevron}
            width="14"
            height="14"
            viewBox="0 0 14 14"
            aria-hidden="true"
          >
            <path d="m3 5 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </summary>
        <div className={styles.body}>
          <p className={styles.hint}>Choose one to save your answer.</p>
          <div className={styles.choices}>
            {choices.map((choice) => (
              <Button
                key={choice.value}
                type="button"
                tone="ghost"
                size="sm"
                style={CHOICE_STYLE}
                disabled={busy}
                onClick={() => onChoose(choice.value)}
              >
                {choice.label}
              </Button>
            ))}
            <Button
              type="button"
              tone="ghost"
              size="sm"
              style={CHOICE_STYLE}
              disabled={busy}
              ariaExpanded={otherOpen}
              onClick={revealOther}
            >
              Other
            </Button>
          </div>
          {otherOpen && (
            <form
              className={styles.otherForm}
              onSubmit={(event) => {
                event.preventDefault();
                const detail = otherDetail.trim();
                if (!busy && detail) onSubmitOther(detail);
              }}
            >
              <label>
                Where did you hear about us?
                <input
                  ref={(input) => {
                    otherInput.current = input;
                    if (input && focusOtherWhenMounted.current) {
                      input.focus();
                      focusOtherWhenMounted.current = false;
                    }
                  }}
                  value={otherDetail}
                  onChange={(event) => onOtherDetailChange(event.target.value)}
                  maxLength={200}
                  disabled={busy}
                />
              </label>
              <Button type="submit" tone="primary" size="lg" disabled={busy || !otherDetail.trim()}>
                Save answer
              </Button>
            </form>
          )}
        </div>
      </details>
      <Button
        type="button"
        tone="ghost"
        disabled={busy}
        onClick={onSkip}
        style={{ position: 'absolute', top: 14, right: 12, minHeight: 44 }}
      >
        Skip
      </Button>
      {busy ? (
        <p role="status" className={styles.status}>
          Saving your answer…
        </p>
      ) : failed ? (
        <p role="status" className={styles.error}>
          That didn’t save. Try again, or skip.
        </p>
      ) : null}
    </section>
  );
}

const CHOICE_STYLE = {
  minHeight: 44,
  height: 'auto',
  padding: '8px 12px',
  whiteSpace: 'normal',
  lineHeight: 1.35,
} as const;
