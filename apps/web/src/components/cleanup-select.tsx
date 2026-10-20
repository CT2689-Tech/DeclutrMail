import type { SelectHTMLAttributes } from 'react';
import styles from './cleanup-select.module.css';

/** Native cleanup picker with one consistent, decorative dropdown indicator. */
export function CleanupSelect({
  className,
  style,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={styles.root}>
      <select
        {...props}
        className={`dm-field ${styles.field}${className ? ` ${className}` : ''}`}
        style={{ ...style, paddingInlineEnd: 40 }}
      />
      <svg
        className={styles.chevron}
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </span>
  );
}
