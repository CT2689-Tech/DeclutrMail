import { RouteLoading } from '../route-loading';

export default function Loading() {
  return (
    <RouteLoading
      gap={32}
      kicker="Catch up / Coming back to you"
      title="Later"
      label="Loading Later senders"
      rows={4}
      rowHeight={56}
    />
  );
}
