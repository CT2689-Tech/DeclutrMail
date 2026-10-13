import { WS2_COPY } from '@declutrmail/shared/copy/launch';

import { SettingsRouteFallback } from '@/features/settings/settings-index/settings-route-fallback';

export default function Loading() {
  return <SettingsRouteFallback label={WS2_COPY.simplify.settings.loading} />;
}
