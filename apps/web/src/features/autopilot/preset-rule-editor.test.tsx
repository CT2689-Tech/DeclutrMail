import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PresetRuleEditor } from './preset-rule-editor';
import { PRESET_RULES_ALL_FIVE } from './fixtures';

const dormant = PRESET_RULES_ALL_FIVE.find((r) => r.presetKey === 'newsletter_graveyard')!;

describe('existing preset customization', () => {
  it('edits real dormancy conditions and action on the same rule revision', async () => {
    const save = vi.fn().mockResolvedValue(null);
    render(
      <PresetRuleEditor
        rule={{ ...dormant, version: 4 }}
        saving={false}
        onSave={save}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Last email more than (days ago)'), {
      target: { value: '120' },
    });
    fireEvent.change(screen.getByLabelText('Lifetime read rate below (%)'), {
      target: { value: '10' },
    });
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'archive' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          version: 4,
          actionKind: 'archive',
          conditions: {
            kind: 'dormant',
            lastSeenAfterDays: 120,
            lastSeenWithinDays: 180,
            readRateBelow: 0.1,
            minMessages: 5,
          },
        }),
      ),
    );
  });

  it('offers approval-first Delete and explicit archived reach, then narrows when switching to Archive', async () => {
    const save = vi.fn().mockResolvedValue(null);
    render(
      <PresetRuleEditor
        rule={{ ...dormant, version: 4 }}
        saving={false}
        onSave={save}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'delete' } });
    expect(screen.getByLabelText('Include')).toHaveValue('inbox_only');
    fireEvent.change(screen.getByLabelText('Include'), { target: { value: 'all_mail' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ actionKind: 'delete', reach: 'all_mail', version: 4 }),
      ),
    );
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'archive' } });
    expect(screen.getByLabelText('Include')).toHaveValue('inbox_only');
    expect(screen.getByLabelText('Include')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
    await waitFor(() =>
      expect(save).toHaveBeenLastCalledWith(
        expect.objectContaining({ actionKind: 'archive', reach: 'inbox_only' }),
      ),
    );
  });

  it('retains the draft on conflict and never silently adopts a refetched revision', async () => {
    const save = vi.fn().mockResolvedValue('Approved work is waiting.');
    const { rerender } = render(
      <PresetRuleEditor
        rule={{ ...dormant, version: 1 }}
        saving={false}
        onSave={save}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Rule name'), { target: { value: 'My cleanup' } });
    rerender(
      <PresetRuleEditor
        rule={{ ...dormant, version: 2, name: 'Other edit' }}
        saving={false}
        onSave={save}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Approved work');
    expect(screen.getByLabelText('Rule name')).toHaveValue('My cleanup');
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ version: 1, name: 'My cleanup' }));
  });

  it('rejects a reversed dormancy range and cancels without a write', async () => {
    const save = vi.fn();
    const cancel = vi.fn();
    render(<PresetRuleEditor rule={dormant} saving={false} onSave={save} onCancel={cancel} />);
    fireEvent.change(screen.getByLabelText('Last email more than (days ago)'), {
      target: { value: '200' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Check the conditions');
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(cancel).toHaveBeenCalledOnce();
  });
});
