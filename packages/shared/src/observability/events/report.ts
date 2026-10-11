/**
 * Domain owner: report: WS5.
 *
 * Append new report events here. Do not rename existing events.
 */
export const REPORT_EVENT_NAMES = [] as const;

export type ReportEventName = never;

// WS5 appends members. An empty interface is the closed starting point
// other workstreams extend; a Record alias would clash with EventPayloads.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ReportEventPayloads {}
