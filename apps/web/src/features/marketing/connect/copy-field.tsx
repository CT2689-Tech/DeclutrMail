'use client';

import { useState } from 'react';

/**
 * A read-only value with a Copy button: the connector URL, or a setup
 * command. The text stays selectable, so a browser that refuses the
 * clipboard still leaves the value one triple-click away.
 */
export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="dm-connect-copy">
      <code>{value}</code>
      <button
        type="button"
        aria-label={copied ? `${label} copied` : `Copy ${label}`}
        onClick={() => {
          if (!navigator.clipboard) return;
          void navigator.clipboard
            .writeText(value)
            .then(() => setCopied(true))
            .catch(() => {
              // Clipboard access can be denied outside a secure context;
              // keep the button retryable and the value selectable.
              setCopied(false);
            });
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
