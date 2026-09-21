import { tokens } from '@declutrmail/shared';

import { RouteLoading } from '../route-loading';

/** Focus mode's single card — the default Triage view. */
export default function Loading() {
  return (
    <RouteLoading
      title="Triage"
      label="Loading triage queue"
      rows={1}
      rowHeight={440}
      rowRadius={tokens.radius['2xl']}
      maxWidth={688}
      gap={20}
      headerHeight={44}
    />
  );
}
