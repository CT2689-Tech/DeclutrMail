# Pass refunds need a complete retry and receipt story

**Caught by:** sandbox flow audit and independent architecture review.

A Pass grant could be revoked before its workspace tier was refreshed. Retrying
then found the revoked row, returned no owners and acknowledged the refund while
paid access remained. A second interleaving let a newly inserted unrevoked grant
satisfy the same fallback lookup. Both are pinned by failure/interleaving tests:
recover owners for already-revoked grants, but leave new unrevoked arrivals
retryable. Keep the original revoked timestamp and paid receipt.

Paddle also retains a refunded transaction's original completed status. That
status alone cannot describe payment history. The bounded repair includes refund
aggregates on existing scoped reads, validates integer amounts/currency, and
shows full/partial refunds while preserving original amounts and invoice PDFs.
The real sandbox pending0/approved1900 aggregate observations are in the flow audit.
