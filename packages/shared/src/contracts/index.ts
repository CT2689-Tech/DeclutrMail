// @declutrmail/shared/contracts — external-integration adapter
// contracts (D201). Pure TypeScript interfaces, no React; importable by
// the NestJS api/worker apps without pulling in the component tree.

export type { KmsProvider } from './kms-provider';

// D202 API response envelope — shared between NestJS controllers and
// FE TanStack Query hooks so the wire shape is typed end-to-end.
export type {
  DecodedCursor,
  Envelope,
  PaginatedEnvelope,
  PaginationMeta,
} from './envelope';
export { clampLimit, decodeCursor, encodeCursor, ok, paginated, withMeta } from './paginate';
