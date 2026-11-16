"""Keeping an entity cache true to the storage directory it mirrors.

The YAML files under an entity's storage directory are the record. A cache is an
accessory that must follow them, including when files are added or removed by
something other than the product. Entity types that hold one record per
directory share this reconcile; each one supplies its own directory, filename,
cache and view.
"""

import logging
import os
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
from typing import Any

import yaml

from wavecore.api.services.storage_paths import entity_dir, is_entity_id

# Entity labels already reconciled inside the current `reconcile_once` scope.
_reconciled: ContextVar[set[str] | None] = ContextVar("wave_reconciled_entities", default=None)


@contextmanager
def reconcile_once() -> Iterator[None]:
    """Reconcile each entity cache at most once for the duration of this scope.

    One request must not pay the same directory scan once per helper that
    happens to list the same entity type.
    """
    token = _reconciled.set(set())
    try:
        yield
    finally:
        _reconciled.reset(token)


def scan_entity_ids(storage_dir: Path, filename: str) -> set[str]:
    """Ids whose record file is present under the storage directory."""
    with os.scandir(storage_dir) as entries:
        return {
            entry.name for entry in entries if os.path.exists(os.path.join(entry.path, filename))
        }


class DirectoryCache:
    """One entity type's in-memory cache, reconciled against its directory.

    ``cache`` is a callable so the live module binding is read on every call.
    """

    def __init__(
        self,
        *,
        label: str,
        filename: str,
        storage_dir: Callable[[], Path],
        cache: Callable[[], dict[str, Any]],
        logger: logging.Logger,
        view: Callable[[dict[str, Any]], Any] | None = None,
        defect: Callable[[dict[str, Any]], str | None] | None = None,
    ) -> None:
        self._label = label
        self._filename = filename
        self._storage_dir = storage_dir
        self._cache = cache
        self._logger = logger
        self._view = view
        self._defect = defect
        # Ids whose file is on disk but could not be read; keeps the warning to one per file.
        self._unreadable: set[str] = set()
        self._loaded = False

    def record_path(self, entity_id: str) -> Path:
        """Where this entity's record file lives."""
        return entity_dir(self._storage_dir(), entity_id) / self._filename

    def exists(self, entity_id: str) -> bool:
        """Whether the directory still holds this entity's record file."""
        return is_entity_id(entity_id) and self.record_path(entity_id).exists()

    def read(self, entity_id: str) -> dict[str, Any] | None:
        """Read one stored record, or None when its file cannot become one.

        Every way one file can fail (unparsable, undecodable, denied, truncated,
        not a record at all, removed mid-scan) is a skip, so one bad file never
        takes down a listing the other files can answer. A file still on disk
        that was skipped is logged once, so nothing drops out without a trace.
        """
        if not is_entity_id(entity_id):
            return None
        path = self.record_path(entity_id)
        try:
            with open(path, encoding="utf-8") as handle:
                document: Any = yaml.safe_load(handle)
        except (OSError, UnicodeDecodeError, yaml.YAMLError) as exc:
            reason = f"{type(exc).__name__}: {exc}"
        else:
            defect = self._document_defect(document)
            if defect is None:
                self._unreadable.discard(entity_id)
                record: dict[str, Any] = document
                return record
            reason = defect
        self._report(entity_id, path, reason)
        return None

    def reconcile(self) -> None:
        """Sync the cache with the storage directory, which is the record."""
        done = _reconciled.get()
        if done is not None:
            if self._label in done:
                return
            done.add(self._label)
        storage_dir = self._storage_dir()
        storage_dir.mkdir(parents=True, exist_ok=True)
        on_disk = scan_entity_ids(storage_dir, self._filename)
        cache = self._cache()
        self._unreadable.intersection_update(on_disk)
        for stale_id in cache.keys() - on_disk:
            del cache[stale_id]
        for entity_id in on_disk - cache.keys():
            document = self.read(entity_id)
            if document is not None:
                cache[document["id"]] = self._view(document) if self._view else document
        self._loaded = True

    def ensure_loaded(self) -> None:
        """Fill the cache the first time; never scan again once it is warm.

        Derived counts read the cache through here. The directory scan belongs
        in the list functions, which is where a caller expects to pay for it.
        """
        if not self._loaded:
            self.reconcile()

    def forget(self, entity_id: str) -> None:
        """Drop an entity the directory no longer holds."""
        self._cache().pop(entity_id, None)
        self._unreadable.discard(entity_id)

    def clear(self) -> None:
        """Forget everything, for a fresh load or a test reset."""
        self._cache().clear()
        self._unreadable.clear()
        self._loaded = False

    def _document_defect(self, document: Any) -> str | None:
        if not isinstance(document, dict):
            article = "an" if self._label[0] in "aeiou" else "a"
            return f"not {article} {self._label} document ({type(document).__name__})"
        if not isinstance(document.get("id"), str):
            return "no id"
        return self._defect(document) if self._defect else None

    def _report(self, entity_id: str, path: Path, reason: str) -> None:
        if path.exists() and entity_id not in self._unreadable:
            self._unreadable.add(entity_id)
            self._logger.warning("Skipping unreadable %s file %s (%s)", self._label, path, reason)
