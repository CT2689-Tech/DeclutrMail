import { RouteLoading } from '../route-loading';

export default function Loading() {
  return (
    <RouteLoading
      gap={32}
      kicker="Automations / Your rules"
      title="Autopilot"
      label="Loading Autopilot rules"
      rows={3}
      rowHeight={72}
      rowRadius={20}
    />
  );
}
