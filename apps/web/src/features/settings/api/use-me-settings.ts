/**
 * Settings hooks (U23 — D34/D165) — the FE side of:
 *
 *   - GET   /api/me/settings           — combined `{ emailPrefs,
 *     actionSheetPrefs }` read.
 *   - PATCH /api/me/action-sheet-prefs — D34 per-verb skip-sheet write.
 *   - PATCH /api/me/email-prefs        — D165 reminder toggle write.
 *
 * USER-scoped (like account-deletion): preferences roam mailboxes and
 * must render with zero connected accounts, so the key lives outside
 * the mailbox-scoped feature families (`resetMailboxScopedCache`'s
 * blanket invalidate refetches it harmlessly — the data is identical
 * across mailboxes).
 *
 * D34 ↔ triage-store bridge: the action sheet reads the Zustand triage
 * store (`rememberPreference`, keyed by the UI verb `Archive` /
 * `Unsubscribe` / `Later`); the server stores wire keys (`archive` /
 * `unsubscribe` / `later`). `useHydrateActionSheetPrefs()` mirrors the
 * server value into the store so the sheet behaves per the persisted
 * preference on any device; mutations write through both.
 */

import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ActionSheetPrefs,
  ActionSheetPrefsPatch,
  EmailPrefs,
  EmailPrefsPatch,
  MeSettings,
} from '@declutrmail/shared/contracts';

import { apiGet, apiPatch } from '@/lib/api/client';
import { track } from '@/lib/posthog';
import { useTriageStore, type SheetableVerb } from '@/features/triage/store';

export const ME_SETTINGS_QUERY_KEY = ['me-settings'] as const;

/** Wire key (contract) ↔ UI verb (triage store) mapping. */
const WIRE_TO_VERB: Record<keyof ActionSheetPrefs, SheetableVerb> = {
  archive: 'Archive',
  unsubscribe: 'Unsubscribe',
  later: 'Later',
};

export const VERB_TO_WIRE: Record<SheetableVerb, keyof ActionSheetPrefs> = {
  Archive: 'archive',
  Unsubscribe: 'unsubscribe',
  Later: 'later',
};

export function useMeSettings() {
  return useQuery({
    queryKey: ME_SETTINGS_QUERY_KEY,
    queryFn: async (): Promise<MeSettings> => {
      const env = await apiGet<MeSettings>('/api/me/settings');
      return env.data;
    },
    // Preferences only change through this device's own mutations (or
    // another device's — minute-level staleness is fine for settings).
    staleTime: 60_000,
  });
}

/**
 * Mirror the persisted D34 prefs into the triage Zustand store whenever
 * the server value (re)loads. Mounted by the Triage screen and the
 * Settings screen — both surfaces act on the same store, so the sheet
 * skips (or stops skipping) immediately after either changes it.
 */
export function useHydrateActionSheetPrefs(): void {
  const settings = useMeSettings();
  const setRememberPreference = useTriageStore((s) => s.setRememberPreference);

  const prefs = settings.data?.actionSheetPrefs;
  useEffect(() => {
    if (!prefs) return;
    for (const wire of Object.keys(WIRE_TO_VERB) as (keyof ActionSheetPrefs)[]) {
      setRememberPreference(WIRE_TO_VERB[wire], prefs[wire]);
    }
  }, [prefs, setRememberPreference]);
}

/**
 * PATCH /api/me/action-sheet-prefs (D34). Writes through to BOTH the
 * query cache and the triage store so the very next action reflects
 * the new preference without a refetch. Fires the
 * `settings_pref_changed` event on success — pass `source` so the
 * settings card and the sheet's remember-toggle stay distinguishable.
 */
export function useUpdateActionSheetPrefs(source: 'settings' | 'action_sheet') {
  const qc = useQueryClient();
  const setRememberPreference = useTriageStore((s) => s.setRememberPreference);

  return useMutation({
    mutationFn: async (
      patch: ActionSheetPrefsPatch,
    ): Promise<{ actionSheetPrefs: ActionSheetPrefs }> => {
      const env = await apiPatch<{ actionSheetPrefs: ActionSheetPrefs }>(
        '/api/me/action-sheet-prefs',
        patch,
      );
      return env.data;
    },
    onSuccess: (data, patch) => {
      qc.setQueryData<MeSettings>(ME_SETTINGS_QUERY_KEY, (prev) =>
        prev ? { ...prev, actionSheetPrefs: data.actionSheetPrefs } : prev,
      );
      for (const wire of Object.keys(WIRE_TO_VERB) as (keyof ActionSheetPrefs)[]) {
        setRememberPreference(WIRE_TO_VERB[wire], data.actionSheetPrefs[wire]);
      }
      // One event per key the PATCH actually carried (usually one).
      for (const wire of Object.keys(patch) as (keyof ActionSheetPrefs)[]) {
        const enabled = patch[wire];
        if (enabled === undefined) continue;
        void track('settings_pref_changed', {
          pref: 'action_sheet_skip',
          verb: wire,
          enabled,
          source,
        });
      }
    },
  });
}

/** PATCH /api/me/email-prefs (D165) — the reminders toggle. */
export function useUpdateEmailPrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: EmailPrefsPatch): Promise<{ emailPrefs: EmailPrefs }> => {
      const env = await apiPatch<{ emailPrefs: EmailPrefs }>('/api/me/email-prefs', patch);
      return env.data;
    },
    onSuccess: (data, patch) => {
      qc.setQueryData<MeSettings>(ME_SETTINGS_QUERY_KEY, (prev) =>
        prev ? { ...prev, emailPrefs: data.emailPrefs } : prev,
      );
      if (patch.reminders !== undefined) {
        void track('settings_pref_changed', {
          pref: 'email_reminders',
          verb: null,
          enabled: patch.reminders,
          source: 'settings',
        });
      }
    },
  });
}
