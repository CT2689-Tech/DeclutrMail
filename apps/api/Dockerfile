# DeclutrMail API + worker Cloud Run image.
#
# Single image, two Cloud Run services share it — `command` + `args` are
# overridden at deploy time to switch entrypoint (main.ts vs worker.ts).
# Half the Artifact Registry storage, half the CI build time.
#
# Runtime model: TypeScript compiled JIT by `@swc-node/register`. Same
# loader as `pnpm dev` — no separate prod build step to maintain.
# Cold-start cost: ~200ms vs pre-compiled JS. Accepted because D193 sets
# `min_instances=1` at launch (cold path is rare).
#
# Image base: node:22-alpine — matches `engines.node >= 22` in package.json.

# ─── deps ────────────────────────────────────────────────────────────
# Install ALL workspace deps once, leveraging Docker's layer cache:
# changes to source code don't bust the deps layer.
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat \
  && corepack enable \
  && corepack prepare pnpm@10 --activate
# Copy ONLY package manifests (cache-friendly).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY packages/workers/package.json packages/workers/
COPY packages/events/package.json packages/events/
COPY packages/config/package.json packages/config/
RUN pnpm install --frozen-lockfile --prod=false --shamefully-hoist
# `--prod=false` keeps @swc-node + @swc/core (currently devDeps) — the
# JIT loader needs them at runtime. Pre-launch trade-off; ADR-worthy if
# image size becomes a concern.
#
# `--shamefully-hoist` flattens all transitive deps into the root
# `node_modules`. This is the simplest way to get a single hoisted tree
# that the runtime stage can copy with one `COPY --from=deps`. Without
# it pnpm's isolated linker scatters per-package `node_modules` dirs
# that we'd need to copy individually — error-prone.

# ─── runtime ─────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache libc6-compat \
  && corepack enable \
  && corepack prepare pnpm@10 --activate
# Copy node_modules from deps stage + source tree from build context.
COPY --from=deps /app/node_modules ./node_modules
COPY tsconfig.base.json package.json pnpm-workspace.yaml ./
COPY apps/api/src ./apps/api/src
COPY apps/api/tsconfig.json apps/api/package.json apps/api/
COPY packages/db ./packages/db
COPY packages/shared ./packages/shared
COPY packages/workers ./packages/workers
COPY packages/events ./packages/events
COPY packages/config ./packages/config
# Cloud Run sets PORT=8080; apps/api/src/main.ts reads
# `process.env.PORT ?? 4000`. EXPOSE is documentation-only at Cloud Run
# (the platform routes via the PORT env var).
WORKDIR /app/apps/api
EXPOSE 8080
# Default CMD = API. Worker service overrides via gcloud's
# `--command`/`--args`. Both services share this image.
CMD ["node", "--import", "@swc-node/register/esm-register", "src/main.ts"]
