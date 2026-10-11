import { RouteLoading } from '../route-loading';

export default function Loading() {
  return (
    <RouteLoading
      title="Plan & billing"
      kicker="Plan & billing"
      label="Loading billing"
      rows={3}
      rowHeight={64}
    />
  );
}
