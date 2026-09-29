import { RouteLoading } from '../route-loading';

export default function Loading() {
  return (
    <RouteLoading
      gap={24}
      kicker="Catch up / Your daily edition"
      title="Daily Brief"
      label="Loading today’s Brief"
      rows={5}
      rowHeight={72}
    />
  );
}
