import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ONBOARDING_PRESET_CATALOG } from '../../../api/src/onboarding/onboarding.types';
import { PRESET_RULES_ALL_FIVE } from '../features/autopilot/fixtures';
import { autopilotKeys } from '../features/autopilot/api/query-keys';
import { StepFirstSenderReview, StepPresetPick } from '../features/onboarding/step-preset-pick';

const params = new URLSearchParams(location.search);
const theme = params.get('theme');
if (theme) document.documentElement.dataset.theme = theme;
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity, enabled: false } },
});
client.setQueryData(autopilotKeys.rules(), PRESET_RULES_ALL_FIVE);
const noop = () => {};

// Real onboarding choices; synthetic cache, no submitted changes or network.
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <span id="dm-app-theme" hidden />
    {params.get('screen') === 'presets' ? (
      <StepPresetPick presets={ONBOARDING_PRESET_CATALOG} onSubmitted={noop} />
    ) : (
      <StepFirstSenderReview onSubmitted={noop} />
    )}
  </QueryClientProvider>,
);
