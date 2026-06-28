import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { DataExportController } from './export.controller.js';
import type { DataExportService } from './export.service.js';

/**
 * Controller-level coverage for the mid-stream failure path. The 200 +
 * Content-Disposition headers flush before the first row, so a DB error
 * mid-stream must NOT produce a clean, truncated 200 — it must abort the
 * transfer (broken download) and leave a server-side log line.
 */
function collect(stream: NodeJS.ReadableStream): Promise<{ body: string; error: unknown }> {
  return new Promise((resolve) => {
    const chunks: string[] = [];
    stream.on('data', (c) => chunks.push(c.toString()));
    stream.on('error', (error) => resolve({ body: chunks.join(''), error }));
    stream.on('end', () => resolve({ body: chunks.join(''), error: null }));
  });
}

describe('DataExportController mid-stream failure', () => {
  it('aborts the stream and logs when the export throws after the headers flush', async () => {
    async function* boom(): AsyncGenerator<string> {
      yield '{"partial":true';
      throw new Error('db connection dropped');
    }
    const exporter = {
      streamJson: () => boom(),
      streamCsv: () => boom(),
    } as unknown as DataExportService;
    const controller = new DataExportController(exporter);
    const errSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const file = controller.export({ userId: 'u1', workspaceId: 'w1' }, 'json');
    const { body, error } = await collect(file.getStream());

    // Truncated bytes (not a valid document) + a transport-level abort.
    expect(body).toBe('{"partial":true');
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('db connection dropped');
    expect(errSpy).toHaveBeenCalledOnce();
    errSpy.mockRestore();
  });
});
