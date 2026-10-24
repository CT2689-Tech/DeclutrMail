import { RouteLoading } from '../../route-loading';

export default function Loading() {
  return (
    <RouteLoading
      gap={24}
      kicker="Autopilot / Settings"
      title="Autopilot settings"
      label="Loading Schedule"
      rows={2}
      rowHeight={120}
    />
  );
}
