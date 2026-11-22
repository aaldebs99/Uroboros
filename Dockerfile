# syntax=docker/dockerfile:1
#
# One Dockerfile, two runtime images. The server is bundled by tsdown into self-contained
# dist/*.mjs files, so the runtime images carry no node_modules:
#
#     build (pnpm install, server + web build) ──┬──> api    (distroless Node, nonroot; the default last stage)
#                                                └──> worker (Debian slim Node + ffmpeg + pinned yt-dlp)
#
#   docker build --target api    -t uroboros-api .
#   docker build --target worker -t uroboros-worker .
#
# `api` also runs the migrate Job: the same image with `CMD ["/app/migrate.mjs"]`.

# Keep these in lockstep with .mise/config.toml (`mise run ratchet:pins`).
# renovate: datasource=docker depName=node
ARG NODE_VERSION=24.21.0
# renovate: datasource=npm depName=pnpm
ARG PNPM_VERSION=12.12.1
# Stamped into the image labels.
ARG VERSION=0.0.0-dev
ARG REVISION=unknown

# --- build: install the workspace from the lockfile and build the server bundles and the SPA.
# pnpm is installed from the npm registry (sha512-verified by npm), not via corepack: Node
# stopped bundling corepack in v25, so this keeps working across the next node bump. Scripts are
# off; pnpm 12 ships as a native binary and needs none.
FROM node:${NODE_VERSION}-trixie-slim AS build
ARG PNPM_VERSION
WORKDIR /src
RUN npm install --global --ignore-scripts --no-fund --no-audit "pnpm@${PNPM_VERSION}"
# Manifests first so `pnpm install` is cached across source-only changes. pnpm-workspace.yaml
# carries the supply-chain soak (`minimumReleaseAge`, 3 days, in step with .renovaterc.json5)
# and the install-script policy (`allowBuilds`); --frozen-lockfile installs exactly what
# pnpm-lock.yaml records and never resolves a version.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/contract/package.json packages/contract/
COPY tools/ratchet/package.json tools/ratchet/
RUN --mount=type=cache,target=/pnpm-store,sharing=locked \
    pnpm config set store-dir /pnpm-store && \
    pnpm install --frozen-lockfile --filter "@uroboros/server..." --filter "@uroboros/web..."
COPY tsconfig.base.json ./
COPY packages/contract packages/contract
COPY apps/server apps/server
COPY apps/web apps/web
RUN pnpm -F @uroboros/server build && pnpm -F @uroboros/web build
COPY migrations migrations

# --- api: distroless Node 24, nonroot. No shell, no package manager; the entrypoint is node.
# The api image's CMD picks the process: api.mjs here, migrate.mjs for the migrate Job.
FROM gcr.io/distroless/nodejs24-debian13:nonroot AS api
ARG VERSION
ARG REVISION
LABEL org.opencontainers.image.title="uroboros-api" \
      org.opencontainers.image.description="Uroboros API and migrate Job: a self-hosted media downloader" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"
WORKDIR /app
COPY --from=build /src/apps/server/dist/ /app/
COPY --from=build /src/migrations/ /app/migrations/
COPY --from=build /src/apps/web/dist/ /app/web/
# Listen on all interfaces inside the container (the default is loopback). Migrate reads the
# SQL files from UROBOROS_MIGRATIONS_DIR; without it, it looks for the repo root.
ENV NODE_ENV=production \
    UROBOROS_WEB_DIST=/app/web \
    UROBOROS_BIND=0.0.0.0:8080 \
    UROBOROS_MIGRATIONS_DIR=/app/migrations
# Numeric so Kubernetes' runAsNonRoot check can verify it without /etc/passwd.
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/nodejs/bin/node"]
CMD ["/app/api.mjs"]

# --- worker: Debian slim Node with ffmpeg, python3 and a venv holding the one downloader,
# yt-dlp, pinned with hashes in scripts/image/requirements.txt (Renovate's pip_requirements
# manager) and installed with --require-hashes. yt-dlp is the only downloader.
FROM node:${NODE_VERSION}-trixie-slim AS worker
COPY scripts/image/install-*.sh /tmp/scripts/
COPY scripts/image/requirements.txt /tmp/scripts/
RUN chmod +x /tmp/scripts/*.sh && \
    /tmp/scripts/install-apt-packages.sh && \
    /tmp/scripts/install-pip-packages.sh /tmp/scripts/requirements.txt /opt/yt-dlp && \
    rm -rf /tmp/scripts /var/lib/apt/lists/* && \
    groupadd --gid 65532 uroboros && \
    useradd --uid 65532 --gid uroboros --create-home --home-dir /home/uroboros --shell /usr/sbin/nologin uroboros
ARG VERSION
ARG REVISION
LABEL org.opencontainers.image.title="uroboros-worker" \
      org.opencontainers.image.description="Uroboros worker: runs yt-dlp and ffmpeg download jobs" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"
WORKDIR /app
COPY --from=build /src/apps/server/dist/ /app/
ENV NODE_ENV=production \
    YTDLP_PATH=/opt/yt-dlp/bin/yt-dlp
# Numeric so Kubernetes' runAsNonRoot check can verify it without /etc/passwd.
USER 65532:65532
WORKDIR /home/uroboros
CMD ["node", "/app/worker.mjs"]
