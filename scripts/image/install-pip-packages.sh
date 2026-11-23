#!/usr/bin/env bash
# Installs the image's Python packages into a venv, so nothing touches the system Python.
# yt-dlp (with its [default] extras) is the only downloader.
set -euo pipefail

REQUIREMENTS="${1:?Usage: install-pip-packages.sh <requirements.txt> [<venv-dir>]}"
VENV="${2:-/opt/yt-dlp}"

python3 -m venv "${VENV}"
# Every package pinned and checked against its hashes (scripts/image/requirements.txt).
"${VENV}/bin/pip" install --no-cache-dir --require-hashes -r "${REQUIREMENTS}"
# The venv's own pip is not needed at run time, and a smaller venv has less to patch.
"${VENV}/bin/pip" uninstall --yes pip
