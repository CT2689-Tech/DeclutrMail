import { RouteLoading } from '../route-loading';

export default function Loading() {
  return (
    <RouteLoading
      gap={24}
      kicker="Automations"
      title="Quiet hours"
      label="Loading quiet hours"
      rows={2}
      rowHeight={120}
    />
  );
}
