import Link from 'next/link';

/** Stable support anchors shared by pre-purchase FAQ and account help. */
export function SupportTasks() {
  return (
    <nav className="dm-support-tasks" aria-label="Help by task">
      <Link href="/help#undo-windows">
        Recover a change<small>Find Activity Undo and Gmail recovery limits</small>
      </Link>
      <Link href="/help#disconnect-mailbox">
        Manage a Gmail connection<small>Disconnect or check your Google access</small>
      </Link>
      <Link href="/refunds#cancellation">
        Cancel or request a refund<small>Understand the difference and find the next step</small>
      </Link>
      <Link href="/contact">
        Contact support<small>Product help, billing questions, privacy and data requests</small>
      </Link>
    </nav>
  );
}
