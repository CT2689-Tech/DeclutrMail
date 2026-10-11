import { RouteLoading } from '../route-loading';

export default function Loading() {
  return (
    <RouteLoading
      gap={24}
      kicker="Cleanup"
      title="Screener"
      label="Loading the Screener queue"
      rows={3}
      rowHeight={72}
    />
  );
}
