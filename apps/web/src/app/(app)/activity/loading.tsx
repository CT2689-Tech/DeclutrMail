import { RouteLoading } from '../route-loading';

export default function Loading() {
  return (
    <RouteLoading
      gap={20}
      kicker="Your history / Every outcome in view"
      title="Activity"
      label="Loading activity"
      rows={6}
      rowHeight={56}
    />
  );
}
