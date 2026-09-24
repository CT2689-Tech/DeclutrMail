/** Public examples demonstrate real action flows using explicitly synthetic mail. */
export function demoForTopic(topic: string): { href: string; label: string } {
  if (/unsubscribe|promotional|leave-me-alone|unroll-me/.test(topic)) {
    return { href: '/inbox-simulator?step=2', label: 'Try an unsubscribe preview' };
  }
  if (/auto-archive|autopilot|gmail-filters|sanebox/.test(topic)) {
    return { href: '/inbox-simulator?step=3', label: 'Preview an automation rule' };
  }
  if (/delete|storage|undo|reversible/.test(topic)) {
    return { href: '/inbox-simulator?step=4', label: 'Explore Delete and recovery' };
  }
  return { href: '/inbox-simulator?workspace=senders', label: 'Try a sender review' };
}
