#!/bin/bash
# Fill backend/vendor/wheels/ with the prebuilt wheels backend/vendor/wheels.lock pins, each
# checked against its sha256. Remote Execution carries them to a remote host (SQL-15).
#
# Usage: ./scripts/fetch-remote-wheels.sh    (PYTHON=... picks the interpreter, default python3)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOCK="$PROJECT_ROOT/backend/vendor/wheels.lock"
WHEELS_DIR="$PROJECT_ROOT/backend/vendor/wheels"
PYTHON="${PYTHON:-python3}"

mkdir -p "$WHEELS_DIR"

"$PYTHON" - "$LOCK" "$WHEELS_DIR" <<'PY'
import hashlib
import json
import os
import sys
import tempfile
import urllib.request

lock_path, wheels_dir = sys.argv[1], sys.argv[2]
with open(lock_path, encoding="utf-8") as handle:
    rows = json.load(handle)["wheels"]
releases = {}


def digest(path):
    sha = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            sha.update(chunk)
    return sha.hexdigest()


def download_url(file):
    # A wheel file name starts with its distribution and version; PyPI lists the release's files.
    name, version = file.split("-")[:2]
    if (name, version) not in releases:
        url = f"https://pypi.org/pypi/{name}/{version}/json"
        with urllib.request.urlopen(url, timeout=60) as reply:
            listed = json.load(reply)["urls"]
        releases[(name, version)] = {item["filename"]: item["url"] for item in listed}
    return releases[(name, version)][file]


fetched = 0
for row in rows:
    target = os.path.join(wheels_dir, row["file"])
    if os.path.isfile(target) and digest(target) == row["sha256"]:
        continue
    handle, partial = tempfile.mkstemp(prefix=".fetch-", suffix=".part", dir=wheels_dir)
    os.close(handle)
    try:
        urllib.request.urlretrieve(download_url(row["file"]), partial)
        found = digest(partial)
        if found != row["sha256"]:
            sys.exit(f"{row['file']}: sha256 {found} does not match the lock's {row['sha256']}")
        os.chmod(partial, 0o644)
        os.replace(partial, target)
    finally:
        if os.path.exists(partial):
            os.remove(partial)
    fetched += 1
    print(f"fetched {row['file']}")

print(f"{len(rows)} wheels verified in {wheels_dir} ({fetched} fetched)")
PY
