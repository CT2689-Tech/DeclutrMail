// The isolated journey specs, split across two CI lanes by measured run
// time (~90 s / ~85 s of tests, CI run 44992821491). Each entry is a spec
// file and the minimum number of its journeys that must execute. CI runs
// `e2e:<lane>` and asserts that lane against exactly its own files;
// `e2e:journeys` still runs every file locally. report.test.mjs pins the
// package scripts to this list, so a spec cannot be added to one and not
// the other.
export const journeyLanes = {
  'journeys-1': [
    ['home-next-step.spec.ts', 1],
    ['scan-recovery.spec.ts', 2],
    ['journey-recovery.spec.ts', 4],
    ['cookie-consent.spec.ts', 2],
    ['public-journeys.spec.ts', 3],
    ['confirm-request.spec.ts', 3],
  ],
  'journeys-2': [
    ['triage-keep.spec.ts', 1],
    ['sender-policy.spec.ts', 1],
    ['protection-review.spec.ts', 1],
    ['followups-dismiss.spec.ts', 1],
    ['autopilot-pages.spec.ts', 2],
    ['later-recovery.spec.ts', 1],
    ['quiet-hours.spec.ts', 1],
    ['brief-preview.spec.ts', 1],
    ['senders-search-typing.spec.ts', 3],
    ['unsubscribe-backlog.spec.ts', 4],
    ['manual-delete-previews.spec.ts', 4],
    ['reconnect-action-feedback.spec.ts', 1],
    ['connect-app.spec.ts', 3],
  ],
};

export function expectedJourneys(lane) {
  if (lane === undefined) return new Map(Object.values(journeyLanes).flat());
  if (!Object.hasOwn(journeyLanes, lane)) throw new Error(`Unknown journey lane: ${lane}`);
  return new Map(journeyLanes[lane]);
}
