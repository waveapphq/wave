"""History-preserving overwrite on Function import (REQ-3.1.2.5).

Replace resolution must upsert the incoming version(s) onto the existing entry
instead of wiping its directory: versions present in the library but absent from
the imported file are KEPT, so the entry's available versions after a replace are
``existing UNION imported``. A hand-authored single-version file can therefore
never silently truncate a multi-version library entry, and a full-history export
re-imported under replace reproduces the entry exactly.

This rests on a new storage primitive ``save_or_replace_version`` (write-or-
overwrite a version yaml + upsert the available-versions index), which replaces
the destructive ``delete_function_file`` + ``save_new_version`` overwrite path.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
import yaml

from wavecore.api.services.functions import _storage, import_export

pytestmark = pytest.mark.usefixtures("temp_storage_path")


# ---------------------------------------------------------------------------
# Builders / seeding
# ---------------------------------------------------------------------------


def _body(*, opt_input: bool = False) -> dict[str, Any]:
    inputs: list[dict[str, Any]] = [{"name": "x", "type": "string", "required": True}]
    if opt_input:
        inputs.append({"name": "y", "type": "integer", "required": False})
    return {
        "inputs": inputs,
        "outputs": [{"name": "result", "type": "string"}],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {"nodes": [], "edges": []},
    }


def _metadata(changelog: str) -> dict[str, Any]:
    return {
        "description": "multi-version fn",
        "tags": ["demo"],
        "changelog": changelog,
        "details": "",
        "published_at": "2026-01-01T00:00:00Z",
        "published_by": "wave",
    }


def _seed_multi(name: str = "Multi") -> str:
    """Seed a Function with 1.0.0, 1.1.0 (adds optional input), 2.0.0."""
    fn_id = str(uuid.uuid4())
    _storage.save_new_version(fn_id, "1.0.0", _body(), _metadata("v1"), name=name)
    _storage.save_new_version(fn_id, "1.1.0", _body(opt_input=True), _metadata("v1.1"), name=name)
    _storage.save_new_version(fn_id, "2.0.0", _body(opt_input=True), _metadata("v2"), name=name)
    return fn_id


def _import_doc(name: str, fn_id: str, version: str, **extra: Any) -> dict[str, Any]:
    doc: dict[str, Any] = {
        "id": fn_id,
        "name": name,
        "description": "multi-version fn",
        "tags": ["demo"],
        "inputs": _body().get("inputs"),
        "outputs": _body().get("outputs"),
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {"nodes": [], "edges": []},
        "version": version,
    }
    doc.update(extra)
    return doc


def _yaml_bytes(doc: dict[str, Any]) -> bytes:
    return yaml.safe_dump(doc, sort_keys=False).encode()


def _available(fn_id: str) -> set[str]:
    return {entry["version"] for entry in _storage.list_versions(fn_id)["versions"]}


# ---------------------------------------------------------------------------
# Overwrite upserts versions; library-only versions survive
# ---------------------------------------------------------------------------


class TestOverwritePreservesHistory:
    def test_single_version_overwrite_keeps_prior_versions(self) -> None:
        fn_id = _seed_multi("Multi")
        doc = _import_doc(name="Multi", fn_id=fn_id, version="3.0.0")
        result = import_export.import_functions(
            _yaml_bytes(doc), "multi.yaml", {"Multi": "overwrite"}
        )
        assert result["imported"][0]["action"] == "overwritten", result
        assert _available(fn_id) == {"1.0.0", "1.1.0", "2.0.0", "3.0.0"}

    def test_available_is_union_of_existing_and_imported(self) -> None:
        # The imported file carries a partial history [1.0.0, 3.0.0]; the
        # library's 1.1.0 and 2.0.0 (absent from the file) must survive.
        fn_id = _seed_multi("Multi")
        doc = _import_doc(name="Multi", fn_id=fn_id, version="3.0.0")
        doc["versions"] = [
            {"version": "1.0.0", "definition": _body(), "metadata": _metadata("v1")},
            {"version": "3.0.0", "definition": _body(opt_input=True), "metadata": _metadata("v3")},
        ]
        import_export.import_functions(_yaml_bytes(doc), "multi.yaml", {"Multi": "overwrite"})
        existing = {"1.0.0", "1.1.0", "2.0.0"}
        imported = {"1.0.0", "3.0.0"}
        assert _available(fn_id) == existing | imported

    def test_overwrite_does_not_lose_any_prior_version_yaml(self) -> None:
        fn_id = _seed_multi("Multi")
        doc = _import_doc(name="Multi", fn_id=fn_id, version="3.0.0")
        import_export.import_functions(_yaml_bytes(doc), "multi.yaml", {"Multi": "overwrite"})
        for version in ("1.0.0", "1.1.0", "2.0.0"):
            assert _storage.load_version(fn_id, version)["name"] == "Multi"


class TestFullHistoryOverwriteLossless:
    def test_full_history_reimport_is_lossless(self) -> None:
        fn_id = _seed_multi("Multi")
        body, filename, _ct = import_export.export_function(fn_id, fmt="yaml")
        result = import_export.import_functions(body, filename, {"Multi": "overwrite"})
        assert result["imported"][0]["action"] == "overwritten", result
        assert _available(fn_id) == {"1.0.0", "1.1.0", "2.0.0"}


# ---------------------------------------------------------------------------
# save_or_replace_version storage primitive
# ---------------------------------------------------------------------------


class TestSaveOrReplaceVersionPrimitive:
    def test_writes_new_version_and_indexes_it(self) -> None:
        fn_id = str(uuid.uuid4())
        _storage.save_or_replace_version(fn_id, "1.0.0", _body(), _metadata("v1"), name="Solo")
        assert _storage.load_version(fn_id, "1.0.0")["name"] == "Solo"
        assert _storage.list_versions(fn_id)["latest"] == "1.0.0"

    def test_overwrites_existing_version_without_conflict(self) -> None:
        fn_id = str(uuid.uuid4())
        _storage.save_new_version(fn_id, "1.0.0", _body(), _metadata("first"), name="Solo")
        # Re-saving the same (id, version) replaces in place instead of raising
        # the write-once ConflictException save_new_version enforces.
        _storage.save_or_replace_version(
            fn_id, "1.0.0", _body(opt_input=True), _metadata("second"), name="Solo"
        )
        reloaded = _storage.load_version(fn_id, "1.0.0")
        assert "y" in {param["name"] for param in reloaded["inputs"]}
        assert _available(fn_id) == {"1.0.0"}

    def test_unions_versions_in_index(self) -> None:
        fn_id = str(uuid.uuid4())
        _storage.save_new_version(fn_id, "1.0.0", _body(), _metadata("v1"), name="Solo")
        _storage.save_or_replace_version(fn_id, "2.0.0", _body(), _metadata("v2"), name="Solo")
        assert _available(fn_id) == {"1.0.0", "2.0.0"}
