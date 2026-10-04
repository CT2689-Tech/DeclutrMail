/** Public examples demonstrate real action flows using explicitly synthetic mail. */
export function demoForTopic(topic: string): { href: string; label: string } {
  if (/unsubscribe|promotional|leave-me-alone|unroll-me/.test(topic)) {
    return { href: '/inbox-simulator?step=2', label: 'Preview Unsubscribe' };
  }
  if (/auto-archive|autopilot|gmail-filters|sanebox/.test(topic)) {
    return { href: '/inbox-simulator?step=3', label: 'Preview automation' };
  }
  if (/delete|storage|undo|reversible/.test(topic)) {
    return { href: '/inbox-simulator?step=4', label: 'Delete and recovery' };
  }
  return { href: '/inbox-simulator?workspace=senders', label: 'Try Senders' };
}
