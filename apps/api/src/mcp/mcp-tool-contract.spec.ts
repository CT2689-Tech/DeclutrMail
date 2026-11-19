import {
  GMAIL_DATA_INVENTORY,
  gmailDataInventoryItem,
  type GmailDataInventoryItem,
} from '@declutrmail/shared/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  MCP_FIELD_DATASETS,
  MCP_TOOL_NAMES,
  MCP_TOOLS,
  type McpFieldDataset,
} from './mcp-tool-contract.js';

/**
 * ADR-0048 rule 3: every field a tool can return maps to a dataset in
 * `gmail-data-inventory.ts` that is marked `ai-assistant`.
 *
 * The public storage list and the privacy page are generated from that
 * registry, so a field outside it would make a published claim false.
 * This walks the output schemas themselves — the same objects the
 * server parses every result through — so there is no second list to
 * forget.
 */

interface Field {
  path: string;
  dataset: McpFieldDataset | undefined;
}

interface Def {
  type: string;
  shape?: Record<string, z.ZodType>;
  element?: z.ZodType;
  innerType?: z.ZodType;
  options?: z.ZodType[];
}

/** Every leaf of a schema, with the dataset it (or a wrapper around it) is tagged with. */
function fields(schema: z.ZodType, path = ''): Field[] {
  const def = schema._zod.def as unknown as Def;
  const dataset = MCP_FIELD_DATASETS.get(schema)?.dataset;
  switch (def.type) {
    case 'object':
      // A tag on a whole object would wave its fields through unread.
      if (dataset) return [{ path: `${path} (an object must not be tagged)`, dataset: undefined }];
      return Object.entries(def.shape ?? {}).flatMap(([key, child]) =>
        fields(child, path ? `${path}.${key}` : key),
      );
    case 'array':
      return dataset ? [{ path, dataset }] : fields(def.element!, `${path}[]`);
    case 'nullable':
    case 'optional':
    case 'default':
      return dataset ? [{ path, dataset }] : fields(def.innerType!, path);
    case 'union':
      return dataset
        ? [{ path, dataset }]
        : (def.options ?? []).flatMap((option) => fields(option, path));
    default:
      return [{ path, dataset }];
  }
}

/** What is wrong with a tool's output schema, by field. Empty = sound. */
function violations(tool: string, schema: z.ZodType): string[] {
  return fields(schema).flatMap(({ path, dataset }) => {
    const name = `${tool}.${path}`;
    if (!dataset) return [`${name}: no dataset`];
    if (dataset === 'not-gmail-data') return [];
    const item: GmailDataInventoryItem | undefined = gmailDataInventoryItem(dataset);
    if (!item) return [`${name}: dataset "${dataset}" is not in the registry`];
    if (!item.exportedIn.includes('ai-assistant')) {
      return [`${name}: dataset "${dataset}" is not marked ai-assistant`];
    }
    return [];
  });
}

const ALL = MCP_TOOL_NAMES.map((name) => ({ name, schema: MCP_TOOLS[name].output as z.ZodType }));

describe('MCP tool output ↔ Gmail data registry (ADR-0048 rule 3)', () => {
  it('walks real fields: every tool has an output schema with at least one', () => {
    // Asserted first. Everything below filters this walk, so a walker that
    // stopped descending would report green having checked nothing.
    expect(ALL).toHaveLength(10);
    for (const { name, schema } of ALL) {
      expect(fields(schema).length, name).toBeGreaterThan(0);
    }
    expect(ALL.flatMap(({ schema }) => fields(schema)).length).toBeGreaterThan(80);
    expect(fields(MCP_TOOLS.get_sender.output).map((field) => field.path)).toEqual(
      expect.arrayContaining(['sender.address', 'recent[].subject', 'inbox_email.all']),
    );
  });

  it('maps every returned field to a registry dataset marked ai-assistant', () => {
    expect(ALL.flatMap(({ name, schema }) => violations(name, schema))).toEqual([]);
  });

  it('fails by name on a field with no dataset', () => {
    const schema = z.object({
      sender: z.object({ name: MCP_TOOLS.list_senders.output.shape.mailbox, snippet: z.string() }),
    });
    expect(violations('probe', schema)).toEqual(['probe.sender.snippet: no dataset']);
  });

  it('fails by name on a field whose dataset is not marked ai-assistant', () => {
    const preview = z.string();
    MCP_FIELD_DATASETS.add(preview, { dataset: 'gmail-preview' as McpFieldDataset });
    const made = z.string();
    MCP_FIELD_DATASETS.add(made, { dataset: 'no-such-dataset' as McpFieldDataset });
    expect(violations('probe', z.object({ rows: z.array(z.object({ preview, made })) }))).toEqual([
      'probe.rows[].preview: dataset "gmail-preview" is not marked ai-assistant',
      'probe.rows[].made: dataset "no-such-dataset" is not in the registry',
    ]);
  });

  it('refuses a tag on a whole object, which would hide its fields', () => {
    const blob = z.object({ anything: z.string() });
    MCP_FIELD_DATASETS.add(blob, { dataset: 'sender-identity' });
    expect(violations('probe', z.object({ blob }))).toEqual([
      'probe.blob (an object must not be tagged): no dataset',
    ]);
  });

  it('the registry marks ai-assistant on exactly the datasets a tool returns', () => {
    const returned = new Set(
      ALL.flatMap(({ schema }) => fields(schema))
        .map((field) => field.dataset)
        .filter((dataset) => dataset && dataset !== 'not-gmail-data'),
    );
    const marked = GMAIL_DATA_INVENTORY.filter((item) =>
      (item.exportedIn as readonly string[]).includes('ai-assistant'),
    ).map((item) => item.id);
    expect([...returned].sort()).toEqual([...marked].sort());
  });

  it('never marks snippets, message ids or other headers for an assistant', () => {
    for (const id of [
      'gmail-preview',
      'message-identifiers',
      'outbound-recipients',
      'oauth-credential',
    ]) {
      expect(gmailDataInventoryItem(id)?.exportedIn, id).not.toContain('ai-assistant');
    }
  });

  it('declares no field that could carry a snippet, a body or a Gmail id', () => {
    const paths = ALL.flatMap(({ name, schema }) =>
      fields(schema).map((field) => `${name}.${field.path}`),
    );
    expect(
      paths.filter((path) => /snippet|body|thread|message_id|header|label_ids/i.test(path)),
    ).toEqual([]);
  });

  it('gives every tool a title, a description and annotations (directory requirement)', () => {
    for (const name of MCP_TOOL_NAMES) {
      const tool = MCP_TOOLS[name];
      expect(tool.title.length, name).toBeGreaterThan(0);
      expect(tool.description.length, name).toBeGreaterThan(0);
      expect(typeof tool.annotations.readOnlyHint, name).toBe('boolean');
    }
    // The one tool that can change mail is the one marked destructive.
    expect(MCP_TOOL_NAMES.filter((name) => MCP_TOOLS[name].annotations.destructiveHint)).toEqual([
      'apply_cleanup',
    ]);
  });
});
