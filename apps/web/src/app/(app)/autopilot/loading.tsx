import { RouteLoading } from '../route-loading';

export default function Loading() {
  return (
    <RouteLoading
      title="Autopilot"
      label="Loading Autopilot rules"
      rows={3}
      rowHeight={72}
      rowRadius={20}
      gap={32}
    />
  );
}
