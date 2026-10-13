import { RouteLoading } from '../route-loading';

export default function Loading() {
  return (
    <RouteLoading
      gap={24}
      kicker="Clean up / New senders"
      title="Screener"
      label="Loading new senders…"
      rows={3}
      rowHeight={72}
    />
  );
}
