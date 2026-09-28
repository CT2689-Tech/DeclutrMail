import { RouteLoading } from '../route-loading';

export default function Loading() {
  return (
    <RouteLoading
      gap={32}
      kicker="Catch up / Conversations"
      title="Follow-ups"
      label="Loading follow-ups"
      rows={4}
      rowHeight={56}
    />
  );
}
