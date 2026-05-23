import { notFound } from 'next/navigation';
import { SenderDetailPage } from '@/features/senders/detail/sender-detail-page';
import { getSenderDetailById } from '@/features/senders/detail/data';

/**
 * Sender Detail route — `/senders/:id`. Resolves the demo dataset
 * synchronously today; swaps to a TanStack Query fetch (D200) when
 * the read API lands.
 */
export default async function SenderDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = getSenderDetailById(id);
  if (detail == null) notFound();
  return <SenderDetailPage state={{ kind: 'ready', detail }} />;
}
