'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { EditorialPrototype } from './editorial';
import { PrecisionPrototype } from './precision';
import {
  sampleSenders,
  type PrototypeAction,
  type PrototypeProps,
  type PrototypeTheme,
  type PrototypeVariant,
  type PrototypeView,
  type SampleSender,
} from './fixture';
import { ConfirmActionModal, type ConfirmOptions } from '@/features/senders/confirm-action-modal';
import {
  applySampleAction,
  buildSamplePreview,
  countSampleInbox,
  initialSampleMail,
  restoreSampleMail,
  toActionSender,
  type SampleMail,
} from './action-fixtures';
import { useSenderWorkspace } from './sender-workspace';
import { Icon } from './prototype-ui';
import styles from './prototype-controls.module.css';

type Modal =
  | { kind: 'action'; action: PrototypeAction; sender: SampleSender }
  | { kind: 'info'; title: string; description: string };
type Recovery = {
  sender: SampleSender;
  cleared: number;
  action: PrototypeAction;
  affected: SampleMail[];
  unsubscribeRequested: boolean;
};

/** Two distinct visual systems across the same three surfaces. No API calls or persistence. */
export function DesignPrototype() {
  const query = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const variant: PrototypeVariant =
    query.get('variant') === 'precision' ? 'precision' : 'editorial';
  const view: PrototypeView =
    query.get('view') === 'senders'
      ? 'senders'
      : query.get('view') === 'website'
        ? 'website'
        : 'overview';
  const theme: PrototypeTheme = query.get('theme') === 'dark' ? 'dark' : 'light';
  const [senders, setSenders] = useState<SampleSender[]>(sampleSenders);
  const workspace = useSenderWorkspace(senders);
  const [selectedId, setSelectedId] = useState(sampleSenders[0].id);
  const [cleared, setCleared] = useState(1248);
  const [result, setResult] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [mail, setMail] = useState(initialSampleMail);
  const selected = senders.find((sender) => sender.id === selectedId) ?? sampleSenders[0];
  const actionRequest = useMemo(
    () =>
      modal?.kind === 'action'
        ? { verb: modal.action, senders: [toActionSender(modal.sender)] }
        : null,
    [modal],
  );
  const actionPreview = useMemo(
    () => (modal?.kind === 'action' ? buildSamplePreview(modal.sender, mail) : undefined),
    [modal, mail],
  );

  const updateQuery = useCallback(
    (values: Record<string, string>) => {
      const next = new URLSearchParams(query.toString());
      Object.entries(values).forEach(([key, value]) => next.set(key, value));
      router.replace(`${pathname}?${next}`, { scroll: values.view !== undefined });
    },
    [query, router, pathname],
  );

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        modal ||
        event.altKey ||
        event.metaKey ||
        event.ctrlKey ||
        target.closest('input,textarea,select,button,a,[contenteditable="true"],[role="tab"]')
      )
        return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        updateQuery({ variant: variant === 'editorial' ? 'precision' : 'editorial' });
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [modal, updateQuery, variant]);

  function executeSample(sender: SampleSender, action: PrototypeAction, options: ConfirmOptions) {
    const outcome = applySampleAction(mail, sender.id, action, options);
    setMail(outcome.mail);
    setSenders((current) =>
      current.map((row) => ({ ...row, inbox: countSampleInbox(outcome.mail, row.id) })),
    );
    if (outcome.cleanupAction && outcome.affected.length > 0) {
      setRecovery({
        sender,
        cleared,
        action: outcome.cleanupAction,
        affected: outcome.affected,
        unsubscribeRequested: outcome.unsubscribeRequested,
      });
      if (outcome.cleanupAction !== 'Later')
        setCleared((current) => current + outcome.affected.length);
    } else setRecovery(null);
    const cleanup =
      outcome.cleanupAction === 'Archive'
        ? 'archived'
        : outcome.cleanupAction === 'Delete'
          ? 'moved to Gmail Trash'
          : 'moved to Later';
    const parts = [
      outcome.unsubscribeRequested ? `Unsubscribe request simulated for ${sender.name}.` : '',
      outcome.cleanupAction
        ? `${outcome.affected.length} matching emails ${cleanup}.`
        : action === 'Keep'
          ? `Keep recorded for ${sender.name}. Email and protection are unchanged.`
          : 'Existing email is unchanged.',
    ];
    setResult(`Sample: ${parts.filter(Boolean).join(' ')}`);
    setModal(null);
  }

  function undoSample() {
    if (!recovery) return;
    const restored = restoreSampleMail(mail, recovery.affected);
    setMail(restored);
    setSenders((current) =>
      current.map((sender) => ({ ...sender, inbox: countSampleInbox(restored, sender.id) })),
    );
    setCleared(recovery.cleared);
    setResult(
      `Sample: ${recovery.affected.length} emails restored to their previous locations.${recovery.unsubscribeRequested ? ' The unsubscribe request is not recalled.' : ''}`,
    );
    setRecovery(null);
  }

  const props: PrototypeProps = {
    workspace,
    view,
    theme,
    senders,
    selected,
    cleared,
    lastResult: result,
    navigate: (next) => updateQuery({ view: next, detail: '' }),
    selectSender: (id) => setSelectedId(id),
    previewAction: (action) =>
      action === 'Keep'
        ? executeSample(selected, action, {})
        : setModal({ kind: 'action', action, sender: selected }),
    toggleProtection: () => {
      setSenders((current) =>
        current.map((sender) =>
          sender.id === selected.id ? { ...sender, protected: !sender.protected } : sender,
        ),
      );
      setResult(
        `Sample: ${selected.name} ${selected.protected ? 'is no longer protected' : 'is protected from bulk cleanup and automation'}.`,
      );
    },
    openFullDetails: () =>
      updateQuery({ view: 'senders', detail: query.get('detail') === 'full' ? '' : 'full' }),
    fullDetails: query.get('detail') === 'full',
    showInfo: (title, description) => setModal({ kind: 'info', title, description }),
  };

  return (
    <div className={styles.root} data-theme={theme} data-direction={variant}>
      <div className={styles.studyNotice}>
        <span className={styles.noticeDot} /> DESIGN STUDY{' '}
        <span>Fictional mailbox · no Gmail changes</span>
        <button
          onClick={() => {
            setSenders(sampleSenders);
            setMail(initialSampleMail());
            setCleared(1248);
            setRecovery(null);
            setResult('Sample mailbox reset.');
          }}
        >
          Reset sample
        </button>
      </div>
      {variant === 'editorial' ? (
        <EditorialPrototype {...props} />
      ) : (
        <PrecisionPrototype {...props} />
      )}
      {result && (
        <div className={styles.toast} role="status">
          <Icon name="check" size={18} />
          <span>{result}</span>
          {recovery && (
            <button onClick={undoSample}>
              Undo {recovery.action} for {recovery.sender.name}
            </button>
          )}
          <button aria-label="Dismiss sample result" onClick={() => setResult(null)}>
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
      <nav className={styles.controls} aria-label="Design comparison">
        <div className={styles.directionControl}>
          <button
            aria-label="Previous design direction"
            onClick={() =>
              updateQuery({ variant: variant === 'editorial' ? 'precision' : 'editorial' })
            }
          >
            <span style={{ display: 'flex', transform: 'rotate(180deg)' }}>
              <Icon name="chevron" size={17} />
            </span>
          </button>
          <span>
            <small>DIRECTION {variant === 'editorial' ? '01' : '02'}</small>
            <strong>{variant === 'editorial' ? 'Warm editorial' : 'Precision workspace'}</strong>
          </span>
          <button
            aria-label="Next design direction"
            onClick={() =>
              updateQuery({ variant: variant === 'editorial' ? 'precision' : 'editorial' })
            }
          >
            <Icon name="chevron" size={17} />
          </button>
        </div>
        <div className={styles.viewControl}>
          {(['overview', 'senders', 'website'] as const).map((next) => (
            <button
              key={next}
              aria-current={view === next ? 'page' : undefined}
              onClick={() => updateQuery({ view: next, detail: '' })}
            >
              {next === 'overview'
                ? 'Overview'
                : next === 'senders'
                  ? 'Sender details'
                  : 'Homepage'}
            </button>
          ))}
        </div>
        <button
          className={styles.themeControl}
          aria-label={`Preview ${theme === 'light' ? 'dark' : 'light'} theme`}
          onClick={() => updateQuery({ theme: theme === 'light' ? 'dark' : 'light' })}
        >
          <Icon name={theme === 'light' ? 'moon' : 'sun'} size={19} />
        </button>
      </nav>
      {modal?.kind === 'action' && (
        <div className={styles.productionPreview}>
          <ConfirmActionModal
            request={actionRequest}
            compositePreview={actionPreview}
            onCancel={() => setModal(null)}
            onConfirm={(options) => executeSample(modal.sender, modal.action, options)}
          />
          <div className={styles.previewDisclaimer}>
            Sample data · production action controls · no Gmail changes
          </div>
        </div>
      )}
      {modal?.kind === 'info' && (
        <PrototypeDialog close={() => setModal(null)}>
          <div className={styles.modalEyebrow}>DESIGN STUDY</div>
          <h2 id="prototype-dialog-title">{modal.title}</h2>
          <p>{modal.description}</p>
          <p className={styles.disclaimer}>
            This screen is outside the three-screen comparison. The existing product remains
            available separately.
          </p>
          <button className={styles.confirm} onClick={() => setModal(null)}>
            Back to the study
          </button>
        </PrototypeDialog>
      )}
    </div>
  );
}

function PrototypeDialog({ close, children }: { close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby="prototype-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom
          )
            close();
        }
      }}
    >
      <button className={styles.closeDialog} aria-label="Close preview" onClick={close}>
        <Icon name="close" size={20} />
      </button>
      {children}
    </dialog>
  );
}
