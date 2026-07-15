import { describe, expect, it } from 'vitest';

import { GMAIL_DATA_INVENTORY } from './gmail-data-inventory';
import {
  DATA_EXPORT_FORMAT_MANIFEST,
  DATA_EXPORT_LIMITATION,
  DataExportFormatSchema,
} from './data-export';

describe('D245 data export manifest', () => {
  it('defines every accepted format exactly once', () => {
    expect(Object.keys(DATA_EXPORT_FORMAT_MANIFEST).sort()).toEqual(
      [...DataExportFormatSchema.options].sort(),
    );
  });

  it('derives included inventory ids from the cumulative registry', () => {
    for (const format of DataExportFormatSchema.options) {
      const expected = GMAIL_DATA_INVENTORY.filter((item) =>
        item.exportedIn.some((exportFormat) => exportFormat === format),
      ).map((item) => item.id);
      expect(DATA_EXPORT_FORMAT_MANIFEST[format].includedInventoryIds).toEqual(expected);
    }
  });

  it('does not overstate the current export as complete', () => {
    expect(DATA_EXPORT_LIMITATION).toMatch(/not a complete copy/i);
    for (const definition of Object.values(DATA_EXPORT_FORMAT_MANIFEST)) {
      expect(definition.completeAccountExport).toBe(false);
      expect(definition.description.length).toBeGreaterThan(20);
    }
  });
});
