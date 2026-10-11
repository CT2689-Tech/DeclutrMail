import { writeFileSync } from 'node:fs';
import {
  installRehearsalFailureHandlers,
  runOnce,
} from '../../../../scripts/helpers/rehearsal-failure.js';

const [mode, reportPath] = process.argv.slice(2);
const report: Record<string, unknown> = { phase: 'awaiting_synthetic_browser', cleanupRuns: 0 };
const persist = () => writeFileSync(reportPath!, JSON.stringify(report));
const shutdown = runOnce(async () => {
  report.cleanupRuns = (report.cleanupRuns as number) + 1;
  if (mode === 'hung-cleanup') await new Promise(() => undefined);
  persist();
});
installRehearsalFailureHandlers({
  onFailure: (failure) => {
    report.error = failure;
    report.errorPhase = report.phase;
  },
  phase: () => report.phase,
  shutdown,
  timeoutMs: mode === 'hung-cleanup' ? 200 : 5_000,
});
setTimeout(() => {
  if (mode === 'undefined-rejection' || mode === 'hung-cleanup') void Promise.reject(undefined);
  if (mode === 'uncaught') throw new Error('token test_SYNTHETIC_SECRET_123 for user@example.test');
  if (mode === 'double') {
    void Promise.reject(undefined);
    void Promise.reject(new Error('Second failure'));
  }
}, 10);
setTimeout(() => undefined, 60_000);
