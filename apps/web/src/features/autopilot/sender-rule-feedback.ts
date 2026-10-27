export function senderRuleFailureCopy(codes: readonly string[] | undefined): string | null {
  const messages: Record<string, string> = {
    AUTOPILOT_RULE_INACTIVE: 'The rule was paused or retired before this cleanup started.',
    AUTOPILOT_RULE_CHANGED: 'The rule changed. Refresh it and preview a new batch.',
    AUTOPILOT_RULE_INVALID: 'The rule needs another review. Edit it before previewing again.',
    AUTOPILOT_NOT_ENTITLED: 'Your plan no longer includes Autopilot. Review your plan to continue.',
    AUTOPILOT_MAILBOX_INACTIVE: 'This account disconnected. Reconnect it to continue.',
  };
  return codes?.map((code) => messages[code]).find(Boolean) ?? null;
}
