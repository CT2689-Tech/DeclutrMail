/** Display-only translations of the exact preset strings in autopilot-presets.ts. */
export function describeMatchReason(reason: string): { label: string; technical: string | null } {
  const verdict =
    /^Engine verdict=(Archive|Unsubscribe) @(\d+\.\d{2}) above threshold (\d+\.\d{2})$/.exec(
      reason,
    );
  if (verdict) {
    const confidence = Number(verdict[2]);
    const threshold = Number(verdict[3]);
    // The matcher rounds both values to two decimals after its strict comparison.
    if (confidence <= 1 && threshold <= 1 && confidence >= threshold) {
      return {
        label: `At matching: ${verdict[1]} suggestion exceeded the rule's confidence threshold.`,
        technical: reason,
      };
    }
  }

  const dormant = /^Read rate (\d+)% across all (\d+) messages, last seen (\d+)d ago$/.exec(reason);
  if (dormant) {
    const [rate, messages, days] = dormant.slice(1).map(Number);
    if (rate! <= 100 && messages! > 0 && [rate, messages, days].every(Number.isSafeInteger)) {
      return {
        label: `At matching: ${messages} indexed ${plural(messages!, 'email')}; last seen ${days} ${plural(days!, 'day')} earlier.`,
        technical: reason,
      };
    }
  }

  const fresh = /^New sender \((?:(\d+)d old)?(?:, )?(?:(\d+) msgs)?\)$/.exec(reason);
  if (fresh && (fresh[1] || fresh[2])) {
    const days = fresh[1] === undefined ? null : Number(fresh[1]);
    const messages = fresh[2] === undefined ? null : Number(fresh[2]);
    if ([days, messages].every((value) => value === null || Number.isSafeInteger(value))) {
      return {
        label:
          'At matching: ' +
          [
            ...(days === null ? [] : [`first seen ${days} ${plural(days, 'day')} earlier`]),
            ...(messages === null ? [] : [`${messages} indexed ${plural(messages, 'email')}`]),
          ].join(' · '),
        technical: null,
      };
    }
  }

  // Legacy/custom/unknown formats have no safely established units or window.
  // Keep their exact evidence inspectable rather than guessing what it means.
  return {
    label: reason ? "Matches this rule's recorded conditions." : 'Match details unavailable.',
    technical: reason || null,
  };
}

function plural(value: number, noun: string): string {
  return value === 1 ? noun : `${noun}s`;
}
