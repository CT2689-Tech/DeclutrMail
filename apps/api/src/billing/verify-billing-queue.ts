import { pathToFileURL } from 'node:url';
import { Queue } from 'bullmq';
import {
  createRedisConnection,
  EMAIL_SEND_QUEUE,
  readBillingQueueCompatibility,
  readEmailPrefsQueueCompatibility,
} from '@declutrmail/workers';

/** Standalone private diagnostic; never imports the API/worker bootstrap. */
export async function verifyBillingQueue(): Promise<{ workers: number }> {
  if (process.env.BILLING_NOTICE_PROBE !== 'true' || !process.env.BILLING_NOTICE_REDIS_URL)
    throw new Error('Billing queue probe configuration unavailable');
  let connection: ReturnType<typeof createRedisConnection> | undefined;
  let queue: Queue | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    connection = createRedisConnection(process.env.BILLING_NOTICE_REDIS_URL);
    connection.on('error', () => {});
    queue = new Queue(EMAIL_SEND_QUEUE, { connection, skipMetasUpdate: true });
    queue.on('error', () => {});
    return await Promise.race([
      Promise.all([
        readBillingQueueCompatibility(queue),
        readEmailPrefsQueueCompatibility(queue),
      ]).then(([, prefs]) => prefs),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Billing queue probe deadline')), 25_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    connection?.disconnect();
    await queue?.close().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const proof = await verifyBillingQueue();
    console.log(
      JSON.stringify({
        billingQueueCompatible: true,
        emailPrefsCompatible: true,
        workers: proof.workers,
      }),
    );
  } catch {
    console.error('Billing queue compatibility unverified; no producer deployment');
    process.exitCode = 1;
  }
}
