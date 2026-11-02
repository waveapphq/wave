"""Read-merge-write of one YAML settings file, atomic and locked per file (REQ-4.7.8)."""

import contextlib
import os
import tempfile
import threading
from collections.abc import Iterator, Mapping
from pathlib import Path
from typing import Any

import yaml

from wavecore.api.config.instance_settings import merge_over_defaults

_registry_guard = threading.Lock()
_locks: dict[str, threading.RLock] = {}


def _lock_for(path: Path) -> threading.RLock:
    key = str(path.resolve())
    with _registry_guard:
        lock = _locks.get(key)
        if lock is None:
            lock = _locks[key] = threading.RLock()
        return lock


@contextlib.contextmanager
def locked(path: Path) -> Iterator[None]:
    """Hold the process-wide re-entrant lock of one settings file."""
    with _lock_for(path):
        yield


def read(path: Path, defaults: Mapping[str, Any]) -> dict[str, Any]:
    """Stored keys over a copy of ``defaults``; a nested mapping default merges one level deeper."""
    with locked(path):
        if not path.exists():
            return merge_over_defaults(defaults, {})
        stored = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(stored, Mapping):
        raise ValueError("the file does not hold a YAML mapping")
    return merge_over_defaults(defaults, stored)


def write_text_atomic(path: Path, text: str, mode: int | None = None) -> None:
    """Replace ``path`` with ``text`` as UTF-8 through a synced temp file beside it."""
    handle, temp_name = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="") as stream:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        if mode is not None:
            os.chmod(temp_name, mode)
        os.replace(temp_name, path)
    except BaseException:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temp_name)
        raise


def write(path: Path, values: Mapping[str, Any]) -> None:
    """Write ``values`` as UTF-8 YAML through a temp file beside ``path``."""
    with locked(path):
        path.parent.mkdir(parents=True, exist_ok=True)
        write_text_atomic(path, yaml.safe_dump(dict(values), allow_unicode=True, sort_keys=False))
