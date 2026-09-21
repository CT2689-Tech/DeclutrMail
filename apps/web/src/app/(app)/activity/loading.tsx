import { RouteLoading } from '../route-loading';

export default function Loading() {
  return (
    <RouteLoading title="Activity" label="Loading activity" rows={6} rowHeight={56} gap={16} />
  );
}
