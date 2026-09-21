import { RouteLoading } from '../route-loading';

export default function Loading() {
  return <RouteLoading title="Daily Brief" label="Loading today’s Brief" rows={5} rowHeight={72} />;
}
