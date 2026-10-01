import { RouteLoading } from '../../route-loading';

export default function Loading() {
  return (
    <RouteLoading
      title="Protected senders"
      kicker="Settings / Protected senders"
      label="Loading protected senders"
      rows={3}
      rowHeight={64}
    />
  );
}
