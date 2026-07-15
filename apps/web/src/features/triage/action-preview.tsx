'use client';

import { MailboxActionContext } from '@/features/auth/mailbox-action-context';
import {
  ActionPreviewPresentation,
  type ActionPreviewPresentationProps,
} from './action-preview-presentation';

export type { PreviewCount } from './action-preview-presentation';

/**
 * Auth-aware app wrapper for the mandatory action preview.
 *
 * Keep authenticated account lookup here so public/demo consumers can import
 * `ActionPreviewPresentation` without pulling the preview's AuthProvider or
 * TanStack Query edge into their route-specific chunk. The props and rendered
 * order remain identical to the pre-split app component.
 */
export function ActionPreview({
  mailboxEmail,
  ...presentationProps
}: Omit<ActionPreviewPresentationProps, 'accountContext'> & {
  /** Explicit override for isolated previews; app surfaces use active auth context. */
  mailboxEmail?: string | undefined;
}) {
  return (
    <ActionPreviewPresentation
      {...presentationProps}
      accountContext={<MailboxActionContext mailboxEmail={mailboxEmail} />}
    />
  );
}
