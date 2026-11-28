# syntax=docker/dockerfile:1
#
# One Dockerfile, one runtime image. The server is bundled by tsdown into self-contained
# dist/*.mjs files, so the image carries no node_modules:
#
#     build (pnpm install, server + web build) ──┬──> uroboros (Debian slim Node + static ffmpeg +
#                                                │             pinned yt-dlp + jellyfin-ffmpeg;
#                                                │             the last stage)
#                                                └──> dev      (the build stage plus the same tools,
#                                                              for compose.dev.yaml's hot reload)
#
#   docker build -t uroboros .                     # a bare build is the image
#
# Every replica serves HTTP and runs the job consumers, and applies pending migrations itself when
# it starts. `/app/migrate.mjs` in the same image is the manual tool
# (`CMD ["node", "/app/migrate.mjs"]`), for applying them by hand.

# Keep these in lockstep with .mise/config.toml (`mise run ratchet:pins`).
# renovate: datasource=docker depName=node
ARG NODE_VERSION=24.21.0
# renovate: datasource=npm depName=pnpm
ARG PNPM_VERSION=12.12.1
# Stamped into the image labels.
ARG VERSION=0.0.0-dev
ARG REVISION=unknown
# The transcoder (docs/transcoding.md): jellyfin-ffmpeg's Debian 13 package, by release tag and the
# .deb's sha256 (a custom manager in .renovaterc.json5 moves both). The package name carries the
# major version (jellyfin-ffmpeg8), so a new major is a reviewed edit, not just a bump.
ARG JELLYFIN_FFMPEG_VERSION=v8.1.3-2
ARG JELLYFIN_FFMPEG_SHA256=82bd7422530740af738891c54b548eadf9bb572ff875976eddbe231e6f02482b

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
# The local dependency patches pnpm-workspace.yaml names (patchedDependencies).
COPY patches patches
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/contract/package.json packages/contract/
COPY packages/ytdlp/package.json packages/ytdlp/
COPY tools/ratchet/package.json tools/ratchet/
RUN --mount=type=cache,target=/pnpm-store,sharing=locked \
    pnpm config set store-dir /pnpm-store && \
    pnpm install --frozen-lockfile --filter "@uroboros/server..." --filter "@uroboros/web..."
COPY tsconfig.base.json ./
COPY packages/contract packages/contract
COPY packages/ytdlp packages/ytdlp
COPY apps/server apps/server
COPY apps/web apps/web
RUN pnpm -F @uroboros/server build && pnpm -F @uroboros/web build
# The notices for every npm package the bundles and the SPA carry (fonts included), from the
# installed tree: src/notices/notices.ts, run on node's type stripping. Both images ship it under
# /usr/share/licenses/uroboros/ with Uroboros' own licence.
COPY LICENSE licenses/LICENSE
RUN pnpm licenses list --json --prod \
      --filter @uroboros/server --filter @uroboros/web --filter @uroboros/contract \
      --filter @uroboros/ytdlp > /tmp/licenses.json && \
    node apps/server/src/bin/notices.ts /tmp/licenses.json licenses/THIRD_PARTY_NOTICES.txt
COPY migrations migrations

# --- ffmpeg: yt-dlp's static GPL ffmpeg and ffprobe, from the mirror image built in the
# upstream-builder repository (apps/ffmpeg-ytdlp), pinned by tag and digest. This is its public
# copy on GHCR, so building needs no login (the forge's registry holds the same build). The image is
# FROM scratch and holds
# /usr/local/bin/{ffmpeg,ffprobe}, their licences and notices under /usr/share/licenses/ffmpeg/
# and the complete corresponding source in /usr/src/ffmpeg-ytdlp/, which the image does not copy:
# it stays in this pinned image (THIRD_PARTY.md). Renovate bumps the tag and digest together
# (.renovaterc.json5).
FROM ghcr.io/aaldebs99/ffmpeg-ytdlp:autobuild-2026-10-31-18-18@sha256:91ef3d3072f6b494907f98a7fec1ad1b8f4a4180a6d985202071a2a024003168 AS ffmpeg

# --- jellyfin-ffmpeg: the transcoder's package, fetched once and checked against its pinned
# sha256. The stages below install it from a bind mount, so the .deb never lands in a layer. It
# brings its own libraries and VA-API drivers (Mesa radeonsi, Intel iHD) under
# /usr/lib/jellyfin-ffmpeg/; NVENC uses the driver the NVIDIA container runtime mounts.
FROM scratch AS jellyfin-ffmpeg
ARG JELLYFIN_FFMPEG_VERSION
ARG JELLYFIN_FFMPEG_SHA256
ADD --checksum=sha256:${JELLYFIN_FFMPEG_SHA256} \
    https://github.com/jellyfin/jellyfin-ffmpeg/releases/download/${JELLYFIN_FFMPEG_VERSION}/jellyfin-ffmpeg8_${JELLYFIN_FFMPEG_VERSION#v}-trixie_amd64.deb \
    /jellyfin-ffmpeg.deb

# --- dev: the build stage (node, pnpm, the installed workspace) plus the image's tools, so the
# hot-reload stack (compose.dev.yaml) downloads like the real thing. Runs `tsx watch` as root over
# the mounted sources; never published.
FROM build AS dev
COPY scripts/image/install-*.sh /tmp/scripts/
COPY scripts/image/requirements.txt /tmp/scripts/
ARG JELLYFIN_FFMPEG_VERSION
RUN --mount=type=bind,from=jellyfin-ffmpeg,source=/jellyfin-ffmpeg.deb,target=/tmp/jellyfin-ffmpeg.deb \
    chmod +x /tmp/scripts/*.sh && \
    /tmp/scripts/install-apt-packages.sh && \
    /tmp/scripts/install-pip-packages.sh /tmp/scripts/requirements.txt /opt/yt-dlp && \
    /tmp/scripts/install-jellyfin-ffmpeg.sh /tmp/jellyfin-ffmpeg.deb "${JELLYFIN_FFMPEG_VERSION}" && \
    rm -rf /tmp/scripts /var/lib/apt/lists/*
COPY --from=ffmpeg /usr/local/bin/ffmpeg /usr/local/bin/ffprobe /usr/local/bin/
ENV YTDLP_PATH=/opt/yt-dlp/bin/yt-dlp
ENTRYPOINT ["/usr/bin/tini", "--"]

# --- uroboros: the image. Debian slim Node with tini as PID 1, python3, yt-dlp's static ffmpeg (from the ffmpeg
# stage, with its licences and notices; glibc and libgcc_s, the only libraries it needs, come from
# this base), a venv holding the one downloader, yt-dlp, with curl_cffi for browser impersonation,
# pinned with hashes in scripts/image/requirements.txt (Renovate's pip_requirements manager) and
# installed with --require-hashes, and jellyfin-ffmpeg for transcoding (/usr/lib/jellyfin-ffmpeg/). yt-dlp is
# the only downloader; its ffmpeg serves downloads, jellyfin-ffmpeg only playback sessions.
FROM node:${NODE_VERSION}-trixie-slim AS uroboros
ARG JELLYFIN_FFMPEG_VERSION
COPY scripts/image/install-*.sh /tmp/scripts/
COPY scripts/image/requirements.txt /tmp/scripts/
RUN --mount=type=bind,from=jellyfin-ffmpeg,source=/jellyfin-ffmpeg.deb,target=/tmp/jellyfin-ffmpeg.deb \
    chmod +x /tmp/scripts/*.sh && \
    /tmp/scripts/install-apt-packages.sh && \
    /tmp/scripts/install-pip-packages.sh /tmp/scripts/requirements.txt /opt/yt-dlp && \
    /tmp/scripts/install-jellyfin-ffmpeg.sh /tmp/jellyfin-ffmpeg.deb "${JELLYFIN_FFMPEG_VERSION}" && \
    rm -rf /tmp/scripts /var/lib/apt/lists/* && \
    groupadd --gid 65532 uroboros && \
    useradd --uid 65532 --gid uroboros --create-home --home-dir /home/uroboros --shell /usr/sbin/nologin uroboros && \
    install -d -o 65532 -g 65532 /media
COPY --from=ffmpeg /usr/local/bin/ffmpeg /usr/local/bin/ffprobe /usr/local/bin/
COPY --from=ffmpeg /usr/share/licenses/ffmpeg/ /usr/share/licenses/ffmpeg/
COPY --from=build /src/licenses/ /usr/share/licenses/uroboros/
# curl_cffi's wheel links libcurl, BoringSSL and others into its module but ships only its own
# licence; theirs come from the repository (scripts/image/licenses/curl_cffi/SOURCE.md).
COPY scripts/image/licenses/curl_cffi/ /usr/share/licenses/curl_cffi/
ARG VERSION
ARG REVISION
LABEL org.opencontainers.image.title="uroboros" \
      org.opencontainers.image.description="Uroboros: a self-hosted media downloader (web UI, API and download jobs in one process)" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"
WORKDIR /app
COPY --from=build /src/apps/server/dist/ /app/
COPY --from=build /src/migrations/ /app/migrations/
COPY --from=build /src/apps/web/dist/ /app/web/
# Listen on all interfaces inside the container (the default is loopback). The server (and the
# manual migrate) read the SQL files from UROBOROS_MIGRATIONS_DIR; without it, they look for the
# repo root.
ENV NODE_ENV=production \
    YTDLP_PATH=/opt/yt-dlp/bin/yt-dlp \
    UROBOROS_WEB_DIST=/app/web \
    UROBOROS_BIND=0.0.0.0:8080 \
    UROBOROS_MIGRATIONS_DIR=/app/migrations
# Numeric, so a runtime can verify it is not root without /etc/passwd.
USER 65532:65532
WORKDIR /home/uroboros
EXPOSE 8080
# tini is PID 1: node as PID 1 would neither reap the orphaned children of yt-dlp and ffmpeg nor get
# the kernel's default SIGTERM handling. tini forwards the signal and exits with node's code.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "/app/server.mjs"]
