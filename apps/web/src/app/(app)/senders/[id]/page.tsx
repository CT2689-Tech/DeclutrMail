import { SenderDetailRoute } from '@/features/senders/detail/sender-detail-page';

/**
 * Sender Detail route — `/senders/:id`.
 *
 * The page itself is a client component (mounts TanStack Query hooks).
 * This server entry just unwraps the dynamic-route params promise and
 * forwards the id; all data resolution happens client-side.
 */
export default async function SenderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SenderDetailRoute id={id} />;
}
