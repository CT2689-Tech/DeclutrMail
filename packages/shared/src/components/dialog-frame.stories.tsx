import { useState } from 'react';

import { useFocusTrap } from '../hooks/use-focus-trap';
import { color, text, typography } from '../tokens/tokens';
import { Button } from './button';
import { DialogFrame } from './dialog-frame';
import { TechnicalDetails } from './technical-details';

export default {
  title: 'Primitives/DialogFrame',
  component: DialogFrame,
  parameters: { layout: 'fullscreen' },
  tags: ['autodocs'],
};

function Demo({
  long = false,
  busy = false,
  failed = false,
}: {
  long?: boolean;
  busy?: boolean;
  failed?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const ref = useFocusTrap<HTMLDivElement>(open, { initialFocusSelector: '#dialog-demo-cancel' });
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open review</Button>
      {open && (
        <DialogFrame
          panelRef={ref}
          titleId="dialog-demo-title"
          onDismiss={busy ? undefined : () => setOpen(false)}
          footer={
            <>
              <Button
                id="dialog-demo-cancel"
                tone="ghost"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button tone="primary" disabled={busy}>
                {busy ? 'Creating bundle…' : 'Download bundle'}
              </Button>
            </>
          }
        >
          <h2 id="dialog-demo-title" style={{ ...typography.dialogTitle, margin: 0 }}>
            Review support records
          </h2>
          <p style={{ color: color.fgSoft, fontSize: text.sm, lineHeight: 1.5 }}>
            Choose the information to include. Full sender addresses stay excluded by default.
          </p>
          {long &&
            Array.from({ length: 18 }, (_, index) => (
              <p key={index} style={{ fontSize: text.sm, lineHeight: 1.5 }}>
                Record {index + 1}: Archive completed and can be undone from Activity.
              </p>
            ))}
          {failed && (
            <p role="alert" style={{ color: color.dangerText }}>
              The bundle could not be created. Review the options and try again.
            </p>
          )}
          <TechnicalDetails summary="What technical details can be included?" defaultOpen>
            <code>support-reference-with-a-long-identifier-that-must-wrap-within-the-dialog</code>
          </TechnicalDetails>
        </DialogFrame>
      )}
    </>
  );
}

export const Default = { render: () => <Demo /> };
export const LongDetails = { render: () => <Demo long /> };
export const Submitting = { render: () => <Demo busy /> };
export const Error = { render: () => <Demo failed /> };
export const Dark = {
  render: () => (
    <div data-theme="dark">
      <Demo long />
    </div>
  ),
};
