/** WS2 copy filled for Home v1 (drop2-r9). Other sections land with their owning screens. */
export const WS2_COPY = {
  names: {
    home: 'Home',
    homeNextSteps: 'Suggested next steps',
  },
  home: {
    retrying: 'Retrying automatically at {time}',
    reconnect: 'Reconnect Gmail',
    empty: {
      title: 'Nothing cleared yet.',
      body: 'Start with the senders in your inbox. See how much each one sends and how much of it is marked read, then choose what to do with them.',
    },
    progress: {
      hero: {
        one: 'email cleared',
        other: 'emails cleared',
      },
    },
    link: {
      activity: 'See your activity',
    },
    failed: {
      eyebrow: 'Gmail account needs attention',
    },
    queued: {
      title: 'Your scan is waiting to start.',
      body: 'It starts on its own and keeps anything already scanned. You don\u2019t need to keep this page open.',
    },
    syncing: {
      title: 'Scanning your Gmail\u2026',
      body: 'You can close this tab and come back later.',
      stage: {
        fetching_metadata: 'Collecting sender details.',
        building_sender_index: 'Grouping email by sender.',
        computing_recommendations: 'Preparing suggestions.',
        finalizing: 'Finishing up.',
      },
    },
    next: {
      largest: {
        title: {
          one: 'Your largest sender',
          other: 'Your {k} largest senders',
        },
        body: 'About {size} of email (Gmail\u2019s estimates). Archiving doesn\u2019t change storage. Deleting moves email to Gmail Trash, which Gmail empties after 30 days.',
        cta: 'See largest senders',
      },
    },
  },
  locked: {
    compare: 'Compare plans',
  },
} as const;
