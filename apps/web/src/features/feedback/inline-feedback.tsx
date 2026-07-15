'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { tokens } from '@declutrmail/shared';
import type {
  ProductFeedbackRating,
  ProductFeedbackRequest,
  ProductFeedbackResult,
} from '@declutrmail/shared/contracts';

import { postProductFeedback } from '@/lib/api/product-feedback';
import { track } from '@/lib/posthog';

const { color, font } = tokens;

type InlineFeedbackProps =
  | {
      surface: 'activity';
      referenceId: string;
      initialRating: 'expected' | 'surprising' | null;
    }
  | {
      surface: 'brief';
      referenceId: string;
      initialRating: 'useful' | 'not_useful' | 'wrong_reason' | null;
    }
  | {
      surface: 'followups';
      referenceId: string;
      initialRating: 'useful' | 'not_followup' | null;
    };

const CONFIG = {
  activity: {
    question: 'Did this match what you expected?',
    options: [
      { value: 'expected', label: 'Expected' },
      { value: 'surprising', label: 'Surprising' },
    ],
  },
  brief: {
    question: 'How was this Brief?',
    options: [
      { value: 'useful', label: 'Useful' },
      { value: 'not_useful', label: 'Not useful' },
      { value: 'wrong_reason', label: 'Something looks wrong' },
    ],
  },
  followups: {
    question: 'Is this a useful follow-up?',
    options: [
      { value: 'useful', label: 'Useful' },
      { value: 'not_followup', label: 'Not a follow-up' },
    ],
  },
} as const;

/** Accessible, bounded feedback for one canonical product observation. */
export function InlineFeedback(props: InlineFeedbackProps) {
  const [selected, setSelected] = useState<ProductFeedbackRating | null>(props.initialRating);
  const [savedNow, setSavedNow] = useState(false);
  const config = CONFIG[props.surface];

  useEffect(() => setSelected(props.initialRating), [props.initialRating]);

  const mutation = useMutation<ProductFeedbackResult, Error, ProductFeedbackRequest>({
    mutationFn: async (request) => (await postProductFeedback(request)).data,
    onSuccess: (result, request) => {
      setSelected(result.rating);
      setSavedNow(true);
      if (request.surface === 'activity') {
        void track('product_feedback_submitted', {
          surface: 'activity',
          rating: request.rating,
        });
      } else if (request.surface === 'brief') {
        void track('product_feedback_submitted', {
          surface: 'brief',
          rating: request.rating,
        });
      } else {
        void track('product_feedback_submitted', {
          surface: 'followups',
          rating: request.rating,
        });
      }
    },
    onError: () => setSavedNow(false),
  });

  const select = (rating: ProductFeedbackRating) => {
    setSavedNow(false);
    const request = { surface: props.surface, referenceId: props.referenceId, rating };
    mutation.mutate(request as ProductFeedbackRequest);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
      <div
        role="group"
        aria-label={config.question}
        style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
      >
        <span style={{ fontSize: 11.5, color: color.fgMuted }}>{config.question}</span>
        {config.options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected === option.value}
            disabled={mutation.isPending}
            onClick={() => select(option.value)}
            style={{
              minHeight: 32,
              padding: '5px 9px',
              borderRadius: 7,
              border: `1px solid ${selected === option.value ? color.fg : color.line}`,
              background: selected === option.value ? color.mutedBg : color.card,
              color: color.fg,
              fontFamily: font.sans,
              fontSize: 11.5,
              fontWeight: 600,
              cursor: mutation.isPending ? 'wait' : 'pointer',
              opacity: mutation.isPending ? 0.65 : 1,
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
      <span
        role={mutation.isError ? 'alert' : 'status'}
        aria-live="polite"
        style={{ minHeight: 14, fontSize: 11, color: color.fgMuted }}
      >
        {mutation.isError
          ? "Couldn't save feedback. Nothing changed — try again."
          : savedNow
            ? 'Feedback saved.'
            : ''}
      </span>
    </div>
  );
}
