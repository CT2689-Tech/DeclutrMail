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

describe('DataExportController format routing', () => {
  function makeController() {
    async function* dataset(name: string): AsyncGenerator<string> {
      yield `${name}\n`;
    }
    const exporter = {
      streamJson: vi.fn(() => dataset('json')),
      streamCsv: vi.fn(() => dataset('messages')),
      streamSendersCsv: vi.fn(() => dataset('senders')),
      streamDecisionsCsv: vi.fn(() => dataset('decisions')),
    };
    return {
      exporter,
      controller: new DataExportController(exporter as unknown as DataExportService),
    };
  }

  it.each([
    ['senders-csv', 'streamSendersCsv', 'declutrmail-senders-', 'senders\n'],
    ['decisions-csv', 'streamDecisionsCsv', 'declutrmail-decisions-', 'decisions\n'],
  ] as const)(
    'format=%s pipes the matching dataset with a text/csv attachment',
    async (format, method, filenamePrefix, expectedBody) => {
      const { exporter, controller } = makeController();
      const file = controller.export({ userId: 'u1', workspaceId: 'w1' }, format);
      const { body, error } = await collect(file.getStream());

      expect(error).toBeNull();
      expect(body).toBe(expectedBody);
      expect(exporter[method]).toHaveBeenCalledWith('w1');
      const headers = file.getHeaders();
      expect(headers.type).toBe('text/csv; charset=utf-8');
      expect(headers.disposition).toContain(`attachment; filename="${filenamePrefix}`);
      expect(headers.disposition).toContain('.csv"');
    },
  );
});

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
