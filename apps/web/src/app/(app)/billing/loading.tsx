import { RouteLoading } from '../route-loading';

export default function Loading() {
  return (
    <RouteLoading
      title="Billing"
      kicker="Account / Your plan"
      label="Loading billing"
      rows={3}
      rowHeight={64}
    />
  );
}
