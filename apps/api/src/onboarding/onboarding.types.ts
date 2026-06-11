import type { AutopilotPresetKey } from '@declutrmail/db';
import type {
  OnboardingPresetCatalogItem,
  OnboardingPresetKey,
} from '@declutrmail/shared/contracts';

/**
 * Compile-time contract check (D106-D113): the shared-contract preset
 * union must stay byte-identical to the DB union. If either side adds
 * or renames a key, BOTH assignments below stop compiling.
 */
type _ContractCoversDb = AutopilotPresetKey extends OnboardingPresetKey ? true : never;
type _DbCoversContract = OnboardingPresetKey extends AutopilotPresetKey ? true : never;
const _contractCoversDb: _ContractCoversDb = true;
const _dbCoversContract: _DbCoversContract = true;
void _contractCoversDb;
void _dbCoversContract;

/**
 * Step-4 preset catalog (D110) — the ONBOARDING-facing display copy
 * for the 5 D101 presets. Server-owned so the FE renders one source.
 *
 * §2.2 (D227): copy uses only the Keep/Archive/Unsubscribe/Later/Delete
 * verbs; "Screener" (the feature name) is allowed, the verb "Screen"
 * is not — which is why `auto_screen_new_senders` is NOT labeled with
 * its `automation_rules.name` default here.
 *
 * D10 observe-first framing lives in the UI around the catalog, not in
 * the per-rule copy.
 */
export const ONBOARDING_PRESET_CATALOG: OnboardingPresetCatalogItem[] = [
  {
    key: 'auto_archive_low_engagement',
    name: 'Auto-archive low-engagement',
    description:
      'Archives mail from senders you almost never open, once the engine is highly confident.',
    verb: 'archive',
  },
  {
    key: 'auto_unsubscribe_noisy',
    name: 'Auto-unsubscribe noisy senders',
    description: 'Unsubscribes from high-volume senders the engine is very confident you ignore.',
    verb: 'unsubscribe',
  },
  {
    key: 'auto_screen_new_senders',
    name: 'Send new senders to the Screener',
    description: 'First-time senders wait in the Screener (as Later) until you decide on them.',
    verb: 'later',
  },
  {
    key: 'newsletter_graveyard',
    name: 'Newsletter graveyard',
    description: 'Unsubscribes from newsletters you have not read in over 90 days.',
    verb: 'unsubscribe',
  },
  {
    key: 'long_dormant_unsubscribe',
    name: 'Long-dormant unsubscribe',
    description: 'Unsubscribes from senders silent for 180+ days that you never read.',
    verb: 'unsubscribe',
  },
];
