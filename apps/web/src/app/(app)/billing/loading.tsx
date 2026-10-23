import { RouteLoading } from '../route-loading';

export default function Loading() {
  return (
    <RouteLoading
      title="Plan & billing"
      maxWidth={1120}
      gap={28}
      label="Loading billing"
      rows={3}
      rowHeight={64}
    />
  );
}
