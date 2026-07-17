'use client';

import type { MouseEvent } from 'react';
import { useEffect, useState } from 'react';
import { Button, tokens, useLocalState } from '@declutrmail/shared';
import type { ActionRequest, GroupMeta, Sender } from '../data';
import { SenderListRow } from './sender-list-row';

const { color, font } = tokens;

const INITIAL = 25;
const STEP = 50;

/** A collapsible category bloc holding its sender rows. */
export function SenderGroup({
  group,
  items,
  selectedIds,
  onToggleSelect,
  onAction,
}: {
  group: GroupMeta;
  items: Sender[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string, evt: MouseEvent) => void;
  onAction: (req: ActionRequest) => void;
}) {
  const [openMap, setOpenMap] = useLocalState<Record<string, boolean>>('senders.groupOpen', {});
  const open = openMap[group.key] !== false;
  const toggle = () => setOpenMap((m) => ({ ...m, [group.key]: !open }));

  const [visibleCount, setVisibleCount] = useState(INITIAL);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const fingerprint = `${items.length}|${items[0]?.id ?? '_'}`;
  useEffect(() => {
    setVisibleCount(INITIAL);
    setExpanded(new Set());
  }, [fingerprint]);

  const monthly = items.reduce((sum, s) => sum + (s.monthlyVolume ?? 0), 0);
  const visible = items.slice(0, visibleCount);
  const remaining = Math.max(0, items.length - visibleCount);

  return (
    <div
      style={{
        background: color.card,
        border: `1px solid ${color.line}`,
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      <div
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
        }}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-label={`${group.label} — ${open ? 'collapse' : 'expand'}`}
        style={{
          display: 'grid',
          gridTemplateColumns: '22px 1fr auto',
          gap: 16,
          alignItems: 'center',
          padding: '14px 18px',
          cursor: 'pointer',
          borderBottom: open ? `1px solid ${color.lineSoft}` : 'none',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 22,
            height: 22,
            borderRadius: 5,
            background: open ? color.fg : color.paper,
            color: open ? color.fgInverse : color.fgSoft,
            fontFamily: font.mono,
            fontSize: 12,
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'background 0.15s, color 0.15s, transform 0.15s',
          }}
        >
          ›
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
          <span
            style={{ fontSize: 15.5, fontWeight: 700, letterSpacing: '-0.012em', color: color.fg }}
          >
            {group.label}
          </span>
          <span style={{ fontSize: 12.5, color: color.fgSoft }}>
            {group.hint}
            <span
              style={{ marginLeft: 8, color: color.fgMuted, fontFamily: font.mono, fontSize: 11 }}
            >
              · {monthly.toLocaleString()}/mo
            </span>
          </span>
        </div>
        <div
          style={{
            fontFamily: font.mono,
            fontSize: 11,
            color: color.fgMuted,
            textAlign: 'right',
            lineHeight: 1.3,
          }}
        >
          <span
            style={{
              display: 'block',
              fontFamily: font.display,
              fontSize: 18,
              fontWeight: 600,
              color: color.fg,
              letterSpacing: '-0.018em',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {items.length}
          </span>
          {items.length === 1 ? 'sender' : 'senders'}
        </div>
      </div>

      {open && (
        <div>
          {visible.map((s) => (
            <SenderListRow
              key={s.id}
              s={s}
              selected={selectedIds.has(s.id)}
              onToggleSelect={(evt) => onToggleSelect(s.id, evt)}
              expanded={expanded.has(s.id)}
              onToggleExpand={() =>
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(s.id)) next.delete(s.id);
                  else next.add(s.id);
                  return next;
                })
              }
              onAction={onAction}
            />
          ))}
          {remaining > 0 && (
            <div
              style={{
                padding: '14px 16px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: color.paper,
                borderTop: `1px solid ${color.line}`,
              }}
            >
              <span style={{ fontFamily: font.mono, fontSize: 11, color: color.fgMuted }}>
                Showing <strong style={{ color: color.fg, fontWeight: 700 }}>{visibleCount}</strong>{' '}
                of {items.length} in {group.label}
              </span>
              <Button
                size="sm"
                onClick={() => setVisibleCount((c) => Math.min(items.length, c + STEP))}
              >
                Show {Math.min(STEP, remaining)} more
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
