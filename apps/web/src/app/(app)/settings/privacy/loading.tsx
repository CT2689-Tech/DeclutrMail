import { RouteLoading } from '../../route-loading';

export default function Loading() {
  return (
    <RouteLoading
      title="Privacy & data"
      kicker="Settings / Your data"
      label="Loading privacy & data"
      rows={3}
      rowHeight={64}
    />
  );
}
