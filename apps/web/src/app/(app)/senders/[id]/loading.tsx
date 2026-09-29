import { SenderDetailSkeleton } from '@declutrmail/shared';

/**
 * Opening a sender used to fall through to the Senders list skeleton
 * (`senders/loading.tsx` is the nearest boundary), so the first frame
 * showed the wrong screen. This is the detail page's own geometry.
 */
export default function Loading() {
  return (
    <div
      role="status"
      aria-label="Loading sender"
      style={{
        boxSizing: 'border-box',
        maxWidth: 760,
        margin: '0 auto',
        padding: '20px clamp(16px, 4vw, 24px) 28px',
      }}
    >
      <SenderDetailSkeleton />
    </div>
  );
}
