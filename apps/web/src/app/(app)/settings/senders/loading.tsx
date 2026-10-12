import { RouteLoading } from '../../route-loading';

export default function Loading() {
  return (
    <RouteLoading
      title="Protected senders"
      kicker="Settings"
      label="Loading protected senders"
      rows={3}
      rowHeight={64}
    />
  );
}
