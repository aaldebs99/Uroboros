#!/usr/bin/env bash
# What the worker image needs besides node: ffmpeg (yt-dlp merges and converts with it), python3
# and its venv module (yt-dlp lives in a venv, see install-pip-packages.sh). Node's slim image
# ships none of them. Each script cleans up after itself: a later RUN removing the lists cannot
# take them out of the layer this one wrote.
set -euo pipefail

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates \
    ffmpeg \
    python3 \
    python3-venv
rm -rf /var/lib/apt/lists/*
