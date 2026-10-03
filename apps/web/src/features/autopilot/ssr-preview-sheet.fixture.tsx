import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button, PreviewSheet } from '@declutrmail/shared';
import { RulePreviewSample } from './rule-preview-panel';
import { RULE_PREVIEW_RESULT } from './fixtures';

// This isolated SSR subprocess renders web JSX (normally compiled by Next).
// tsx preserves that package's classic JSX runtime, unlike shared's automatic one.
Object.assign(globalThis, { React });

process.stdout.write(
  renderToStaticMarkup(
    <PreviewSheet
      layout="review"
      title="Turn on Newsletter graveyard?"
      subtitle="Review the matching senders before turning on this rule."
      onClose={() => undefined}
      context="Gmail account: synthetic@example.com"
      note="Unsubscribe requests can’t be undone."
      primary={{ label: 'Watch first', onClick: () => undefined }}
      details={
        <RulePreviewSample
          ruleName="Newsletter graveyard"
          layout="table"
          page={{ page: 1, pageSize: 25, total: 50 }}
          controls={
            <div className="dm-autopilot-page-buttons">
              <Button tone="ghost" size="sm" inert>
                Previous
              </Button>
              <Button tone="ghost" size="sm">
                Next
              </Button>
            </div>
          }
          result={{
            ...RULE_PREVIEW_RESULT,
            sample: Array.from({ length: 25 }, (_, index) => ({
              senderKey: index.toString(16).padStart(64, '0'),
              senderName: `Sender ${index + 1}`,
              senderEmail: `newsletter-${index + 1}@example.com`,
              inboxCount: index,
              reason: 'Read rate 0% across all 586 messages, last seen 128d ago',
            })),
          }}
        />
      }
    >
      <p>50 senders actionable now</p>
    </PreviewSheet>,
  ),
);
