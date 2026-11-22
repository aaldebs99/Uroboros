# syntax=docker/dockerfile:1
#
# One Dockerfile, two runtime images. The server is bundled by tsdown into self-contained
# dist/*.mjs files, so the runtime images carry no node_modules:
#
#     build (pnpm install, server + web build) ──┬──> worker (Debian slim Node + static ffmpeg + pinned yt-dlp)
#                                                └──> api    (distroless cc + the pinned node; the last stage)
#
#   docker build -t uroboros-api .                 # a bare build is the api
#   docker build --target api    -t uroboros-api .
#   docker build --target worker -t uroboros-worker .
#
# `api` also runs the migrate Job: the same image with `CMD ["/app/migrate.mjs"]`.

# Keep these in lockstep with .mise/config.toml (`mise run ratchet:pins`).
# renovate: datasource=docker depName=node
ARG NODE_VERSION=24.21.0
# renovate: datasource=npm depName=pnpm
ARG PNPM_VERSION=12.12.1
# yt-dlp's patched static ffmpeg build (https://github.com/yt-dlp/FFmpeg-Builds), by release tag
# and the sha256 of that release's checksums.sha256 asset, which in turn lists the archives'
# hashes (scripts/image/install-ffmpeg.sh checks both). Renovate bumps the two lines together;
# its own annotation (`renovate-digest:`, not the plain one above) so the manager that owns
# single-value ARGs leaves them alone. Renovate is disabled for this pin (.renovaterc.json5):
# daily autobuild tags are pruned after about two weeks and month-end ones are kept about 23
# months, and ffmpeg is moving to an image mirrored from the upstream-builder repo. FFMPEG_COMMIT
# is the commit the tag points at, recorded in SOURCE.md.
# renovate-digest: datasource=github-release-attachments depName=yt-dlp/FFmpeg-Builds versioning=regex:^autobuild-(?<major>\d+)-(?<minor>\d+)-(?<patch>\d+)-(?<build>\d+)-\d+$
ARG FFMPEG_TAG=autobuild-2026-10-31-18-18
ARG FFMPEG_CHECKSUMS_SHA256=b0861bfd4092ff38f4fc12dfb55ee3fef557f00809d342a0ed328db0f351ccf7
ARG FFMPEG_COMMIT=58084b7cf4984303a34b610ba3ad8f04059d5d89
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
# The notices for every npm package the bundles and the SPA carry (fonts included), from the
# installed tree: src/notices/notices.ts, run on node's type stripping. Both images ship it under
# /usr/share/licenses/uroboros/ with Uroboros' own licence.
COPY LICENSE licenses/LICENSE
RUN pnpm licenses list --json --prod \
      --filter @uroboros/server --filter @uroboros/web --filter @uroboros/contract > /tmp/licenses.json && \
    node apps/server/src/bin/notices.ts /tmp/licenses.json licenses/THIRD_PARTY_NOTICES.txt
COPY migrations migrations

# --- node: the official image, only so the api stage can copy its binary (--from takes no ARG).
FROM node:${NODE_VERSION}-trixie-slim AS node

# --- ffmpeg: downloads, verifies and unpacks yt-dlp's static ffmpeg and ffprobe, so curl and xz
# stay out of the worker. Produces /usr/local/bin/{ffmpeg,ffprobe} and /usr/share/licenses/ffmpeg.
FROM node:${NODE_VERSION}-trixie-slim AS ffmpeg
ARG FFMPEG_TAG
ARG FFMPEG_CHECKSUMS_SHA256
ARG FFMPEG_COMMIT
COPY scripts/image/install-ffmpeg.sh /tmp/scripts/
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates curl xz-utils && \
    rm -rf /var/lib/apt/lists/* && \
    /tmp/scripts/install-ffmpeg.sh "${FFMPEG_TAG}" "${FFMPEG_CHECKSUMS_SHA256}" "${FFMPEG_COMMIT}"

# --- worker: Debian slim Node with tini as PID 1, python3, yt-dlp's static ffmpeg (from the ffmpeg stage, with
# its GPL licence and source pointer) and a venv holding the one downloader, yt-dlp, pinned with
# hashes in scripts/image/requirements.txt (Renovate's pip_requirements manager) and installed
# with --require-hashes. yt-dlp is the only downloader.
FROM node:${NODE_VERSION}-trixie-slim AS worker
COPY scripts/image/install-*.sh /tmp/scripts/
COPY scripts/image/requirements.txt /tmp/scripts/
RUN chmod +x /tmp/scripts/*.sh && \
    /tmp/scripts/install-apt-packages.sh && \
    /tmp/scripts/install-pip-packages.sh /tmp/scripts/requirements.txt /opt/yt-dlp && \
    rm -rf /tmp/scripts /var/lib/apt/lists/* && \
    groupadd --gid 65532 uroboros && \
    useradd --uid 65532 --gid uroboros --create-home --home-dir /home/uroboros --shell /usr/sbin/nologin uroboros
COPY --from=ffmpeg /usr/local/bin/ffmpeg /usr/local/bin/ffprobe /usr/local/bin/
COPY --from=ffmpeg /usr/share/licenses/ffmpeg/ /usr/share/licenses/ffmpeg/
COPY --from=build /src/licenses/ /usr/share/licenses/uroboros/
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
# tini is PID 1: node as PID 1 would neither reap the orphaned children of yt-dlp and ffmpeg nor get
# the kernel's default SIGTERM handling. tini forwards the signal and exits with node's code.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "/app/worker.mjs"]

# --- api: distroless cc (glibc, libstdc++, libgcc: what node links against), nonroot, with the
# ARG-pinned node binary copied from the official image, so the api runs exactly the Node that
# `mise run ratchet:pins` enforces. No shell, no package manager. The base is pinned by digest;
# Renovate's dockerfile manager bumps the tag and digest together.
# The CMD picks the process: api.mjs here, migrate.mjs for the migrate Job.
FROM gcr.io/distroless/cc-debian13:nonroot@sha256:cb87acc574abe719b6e5c547384defa2f7b1f24af9605d3f618cf852495d8be2 AS api
ARG VERSION
ARG REVISION
LABEL org.opencontainers.image.title="uroboros-api" \
      org.opencontainers.image.description="Uroboros API and migrate Job: a self-hosted media downloader" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"
COPY --from=node /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --from=build /src/apps/server/dist/ /app/
COPY --from=build /src/migrations/ /app/migrations/
COPY --from=build /src/apps/web/dist/ /app/web/
COPY --from=build /src/licenses/ /usr/share/licenses/uroboros/
# Listen on all interfaces inside the container (the default is loopback). Migrate reads the
# SQL files from UROBOROS_MIGRATIONS_DIR; without it, it looks for the repo root.
ENV NODE_ENV=production \
    UROBOROS_WEB_DIST=/app/web \
    UROBOROS_BIND=0.0.0.0:8080 \
    UROBOROS_MIGRATIONS_DIR=/app/migrations
# Numeric so Kubernetes' runAsNonRoot check can verify it without /etc/passwd.
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/node"]
CMD ["/app/api.mjs"]
