"""Export / import the FULL version history of a Function.

``export_function`` / ``export_functions_batch`` serialize every published
version (the document gains ``versions: [{version, definition, metadata}, ...]``
alongside the latest-definition fields), and import round-trips every version
rather than just the current latest.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient

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
        "name": "multi",
        "description": "multi-version fn",
        "tags": ["demo"],
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


def _seed_three_versions(name: str = "multi") -> str:
    """Seed a Function with 1.0.0, 1.1.0 (adds optional input), 2.0.0."""
    fn_id = str(uuid.uuid4())
    _storage.save_new_version(fn_id, "1.0.0", _body(), _metadata("v1"), name=name)
    _storage.save_new_version(fn_id, "1.1.0", _body(opt_input=True), _metadata("v1.1"), name=name)
    _storage.save_new_version(fn_id, "2.0.0", _body(opt_input=True), _metadata("v2"), name=name)
    return fn_id


# ---------------------------------------------------------------------------
# Export emits all versions
# ---------------------------------------------------------------------------


class TestExportEmitsAllVersions:
    def test_single_export_carries_every_version(self) -> None:
        fn_id = _seed_three_versions()
        body, _filename, _ct = import_export.export_function(fn_id, fmt="yaml")
        doc = yaml.safe_load(body)
        # Still the latest-definition document (backward compatible with the
        # existing single-export contract).
        assert doc["name"] == "multi"
        # ...now also carrying the full version history.
        versions = {entry["version"] for entry in (doc.get("versions") or [])}
        assert versions == {"1.0.0", "1.1.0", "2.0.0"}

    def test_each_version_entry_has_definition_and_metadata(self) -> None:
        fn_id = _seed_three_versions()
        body, _filename, _ct = import_export.export_function(fn_id, fmt="yaml")
        doc = yaml.safe_load(body)
        by_version = {entry["version"]: entry for entry in (doc.get("versions") or [])}
        assert "1.1.0" in by_version, by_version
        entry = by_version["1.1.0"]
        assert "definition" in entry and "metadata" in entry, entry
        # The 1.1.0 body added the optional input y.
        input_names = {item["name"] for item in entry["definition"]["inputs"]}
        assert "y" in input_names
        assert entry["metadata"]["changelog"] == "v1.1"

    def test_json_export_carries_every_version(self) -> None:
        import json

        fn_id = _seed_three_versions()
        body, _filename, _ct = import_export.export_function(fn_id, fmt="json")
        doc = json.loads(body)
        versions = {entry["version"] for entry in (doc.get("versions") or [])}
        assert versions == {"1.0.0", "1.1.0", "2.0.0"}

    def test_route_export_includes_versions(self, client: TestClient) -> None:
        fn_id = _seed_three_versions()
        resp = client.get(f"/functions/{fn_id}/export")
        assert resp.status_code == 200, resp.text
        doc = yaml.safe_load(resp.content)
        versions = {entry["version"] for entry in (doc.get("versions") or [])}
        assert versions == {"1.0.0", "1.1.0", "2.0.0"}


# ---------------------------------------------------------------------------
# Import restores all versions
# ---------------------------------------------------------------------------


class TestImportRestoresAllVersions:
    def test_round_trip_restores_every_version(self) -> None:
        fn_id = _seed_three_versions()
        body, filename, _ct = import_export.export_function(fn_id, fmt="yaml")
        # Remove the original so the re-import is a clean create (no name conflict).
        _storage.delete_function_file(fn_id)

        result = import_export.import_functions(body, filename)
        assert result["total_imported"] == 1, result
        new_id = result["imported"][0]["id"]
        restored = {entry["version"] for entry in _storage.list_versions(new_id)["versions"]}
        assert restored == {"1.0.0", "1.1.0", "2.0.0"}

    def test_imported_versions_are_loadable(self) -> None:
        fn_id = _seed_three_versions()
        body, filename, _ct = import_export.export_function(fn_id, fmt="yaml")
        _storage.delete_function_file(fn_id)

        result = import_export.import_functions(body, filename)
        new_id = result["imported"][0]["id"]
        for version in ("1.0.0", "1.1.0", "2.0.0"):
            definition = _storage.load_version(new_id, version)
            assert definition["name"] == "multi"


# ---------------------------------------------------------------------------
# Import sets the index times from the document
# ---------------------------------------------------------------------------


def _record(version: str, published_at: str) -> dict[str, Any]:
    """One entry of an export document's ``versions`` list."""
    metadata = {**_metadata(f"v{version}"), "published_at": published_at}
    return {"version": version, "definition": _body(), "metadata": metadata}


def _document(fn_id: str, name: str, records: list[dict[str, Any]], **extra: Any) -> dict[str, Any]:
    """An export document whose latest version is the first record."""
    document = {**_body(), "id": fn_id, "name": name, "version": records[0]["version"]}
    document["versions"] = records
    document.update(extra)
    return document


def _index_times(fn_id: str) -> tuple[str, str]:
    definition, _etag = _storage.load_function(fn_id)
    return definition["metadata"]["created_at"], definition["metadata"]["updated_at"]


class TestIndexTimes:
    def test_the_index_times_come_from_the_documents_metadata(self) -> None:
        fn_id = str(uuid.uuid4())
        document = _document(
            fn_id,
            "timed",
            [_record("1.1.0", "2025-06-01T00:00:00Z"), _record("1.0.0", "2025-05-01T00:00:00Z")],
            metadata={"created_at": "2025-01-15T00:00:00Z", "updated_at": "2025-09-30T00:00:00Z"},
        )

        result = import_export.import_functions(yaml.safe_dump(document).encode(), "timed.yaml")

        assert result["total_imported"] == 1, result
        assert _index_times(fn_id) == ("2025-01-15T00:00:00Z", "2025-09-30T00:00:00Z")

    def test_without_them_the_oldest_and_the_newest_publish_times_are_used(self) -> None:
        fn_id = str(uuid.uuid4())
        document = _document(
            fn_id,
            "timed",
            [_record("1.1.0", "2025-06-01T00:00:00Z"), _record("1.0.0", "2025-05-01T00:00:00Z")],
        )

        result = import_export.import_functions(yaml.safe_dump(document).encode(), "timed.yaml")

        assert result["total_imported"] == 1, result
        assert _index_times(fn_id) == ("2025-05-01T00:00:00Z", "2025-06-01T00:00:00Z")

    @pytest.mark.parametrize(
        ("stored", "incoming"),
        [
            pytest.param(
                ("2025-02-01T00:00:00Z", "2025-05-01T00:00:00Z"),
                ("2025-01-01T00:00:00Z", "2025-08-01T00:00:00Z"),
                id="both come from the file",
            ),
            pytest.param(
                ("2025-01-01T00:00:00Z", "2025-08-01T00:00:00Z"),
                ("2025-02-01T00:00:00Z", "2025-05-01T00:00:00Z"),
                id="both come from the library",
            ),
        ],
    )
    def test_an_overwrite_keeps_the_earlier_created_and_the_later_updated_time(
        self, stored: tuple[str, str], incoming: tuple[str, str]
    ) -> None:
        fn_id = str(uuid.uuid4())
        for version, published_at in zip(("1.0.0", "1.1.0"), stored, strict=True):
            metadata = {**_metadata(f"v{version}"), "published_at": published_at}
            _storage.save_new_version(fn_id, version, _body(), metadata, name="timed")
        document = _document(
            fn_id,
            "timed",
            [_record("2.0.0", "2025-04-01T00:00:00Z")],
            metadata={"created_at": incoming[0], "updated_at": incoming[1]},
        )

        result = import_export.import_functions(
            yaml.safe_dump(document).encode(), "timed.yaml", {"timed": "overwrite"}
        )

        assert result["imported"][0]["action"] == "overwritten", result
        assert _index_times(fn_id) == ("2025-01-01T00:00:00Z", "2025-08-01T00:00:00Z")
