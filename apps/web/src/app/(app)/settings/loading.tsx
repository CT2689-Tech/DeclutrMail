import { RouteLoading } from '../route-loading';

export default function Loading() {
  return (
    <RouteLoading
      title="Settings"
      label="Loading settings"
      rows={5}
      rowHeight={56}
      maxWidth={720}
    />
  );
}
