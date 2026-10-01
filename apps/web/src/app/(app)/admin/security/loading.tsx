import { RouteLoading } from '../../route-loading';

export default function Loading() {
  return (
    <RouteLoading
      title="Loading"
      kicker="Your account"
      label="Loading account page"
      rows={3}
      rowHeight={64}
    />
  );
}
