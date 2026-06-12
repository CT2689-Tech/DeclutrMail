/**
 * DI tokens for the Snoozed surface (D78–D80) — declared in their own
 * module-free file so the read service, write service, and module can
 * all import them without a circular reference.
 */

/** `Queue<SnoozeWakeJobData> | null` — wake-now producer (fail-open). */
export const SNOOZE_WAKE_QUEUE_TOKEN = Symbol('SNOOZE_WAKE_QUEUE');

/** `SnoozeLabelMapStore | null` — Later-label-id mapping reader. */
export const SNOOZE_LABEL_MAP_TOKEN = Symbol('SNOOZE_LABEL_MAP');
