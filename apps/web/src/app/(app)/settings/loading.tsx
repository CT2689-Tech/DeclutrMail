import { RouteLoading } from '../route-loading';

export default function Loading() {
  return (
    <RouteLoading
      gap={32}
      kicker="Settings"
      title="Settings"
      label="Loading settings"
      rows={5}
      rowHeight={56}
    />
  );
}
