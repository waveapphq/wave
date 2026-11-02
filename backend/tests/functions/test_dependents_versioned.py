"""Tests for version-aware Function dependents.

Contract:

- GET /functions/{id}/dependents            -> every Test/Function that
  references the Function at ANY version (existing behavior, preserved).
- GET /functions/{id}/dependents?version=v  -> only the Tests/Functions whose
  referencing node is pinned to version ``v`` (``data.functionVersion``).

The version filter is exact: a dependent pinned to a different version is not
returned, and a version-less reference is not returned for a specific version.
"""

import re
import uuid
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient

from wavecore.api.services.functions import _storage

from .conftest import make_function_payload

NOT_FOUND_RE = re.compile(r"^Function '.+' not found$")


def _all_error_messages(body: dict) -> list[str]:
    err = body["error"]
    messages: list[str] = []
    if err.get("message"):
        messages.append(err["message"])
    details = err.get("details") or []
    if isinstance(details, list):
        for item in details:
            if isinstance(item, dict) and "message" in item:
                messages.append(item["message"])
    return messages


def _create_function(client: TestClient, **overrides: Any) -> str:
    response = client.post("/functions", json=make_function_payload(**overrides))
    assert response.status_code == 201, response.text
    return response.json()["data"]["id"]


def _write_test_pinned(library_id: str, version: str | None, *, name: str) -> str:
    """Write a Test whose function node references ``library_id`` at ``version``."""
    from wavecore.api.services.storage_paths import get_tests_storage_path

    test_id = str(uuid.uuid4())
    test_dir: Path = get_tests_storage_path() / test_id
    test_dir.mkdir(parents=True, exist_ok=True)
    # Mirror the real persisted canvas shape: top-level `type: workflowNode`
    # with the element kind + id under `data`.
    node_data: dict[str, Any] = {
        "nodeType": "function",
        "elementType": "function",
        "functionId": library_id,
        "config": {"values": {}, "outputBindings": {}, "profileBindings": []},
    }
    if version is not None:
        node_data["functionVersion"] = version
    definition: dict[str, Any] = {
        "id": test_id,
        "name": name,
        "version": "1.0.0",
        "workflow": {
            "nodes": [{"id": str(uuid.uuid4()), "type": "workflowNode", "data": node_data}],
            "edges": [],
        },
        "variables": {},
        "metadata": {},
    }
    with open(test_dir / "test.yaml", "w", encoding="utf-8") as f:
        yaml.safe_dump(definition, f, sort_keys=False)
    return test_id


def _write_function_pinned(library_id: str, version: str, *, name: str) -> str:
    """Persist a Function whose body references ``library_id`` at ``version``."""
    from wavecore.api.services.functions import _storage

    caller_id = str(uuid.uuid4())
    definition: dict[str, Any] = {
        "name": name,
        "inputs": [],
        "outputs": [],
        "dependencies": {"functions": [library_id], "plugins": []},
        "workflow": {
            "nodes": [
                {
                    "id": str(uuid.uuid4()),
                    "type": "workflowNode",
                    "data": {
                        "nodeType": "function",
                        "elementType": "function",
                        "functionId": library_id,
                        "functionVersion": version,
                    },
                }
            ],
            "edges": [],
        },
    }
    metadata = {
        "description": "",
        "tags": [],
        "changelog": "",
        "details": "",
        "published_at": "2026-01-01T00:00:00Z",
        "published_by": "wave",
    }
    _storage.save_new_version(caller_id, "1.0.0", definition, metadata, name=name)
    return caller_id


def _ids(entries: list[dict[str, Any]]) -> set[str]:
    return {entry["id"] for entry in entries}


# ---------------------------------------------------------------------------
# Tests as version-pinned dependents
# ---------------------------------------------------------------------------


class TestVersionedTestDependents:
    def test_version_filter_selects_only_matching_test(self, client: TestClient) -> None:
        fn_id = _create_function(client, name="used_by_tests")
        t_v1 = _write_test_pinned(fn_id, "1.0.0", name="pins_v1")
        t_v2 = _write_test_pinned(fn_id, "2.0.0", name="pins_v2")

        v1 = client.get(f"/functions/{fn_id}/dependents?version=1.0.0")
        assert v1.status_code == 200, v1.text
        v1_tests = _ids(v1.json()["data"]["tests"])
        assert t_v1 in v1_tests
        assert t_v2 not in v1_tests

        v2 = client.get(f"/functions/{fn_id}/dependents?version=2.0.0")
        v2_tests = _ids(v2.json()["data"]["tests"])
        assert t_v2 in v2_tests
        assert t_v1 not in v2_tests

    def test_no_version_returns_all_pinned_tests(self, client: TestClient) -> None:
        fn_id = _create_function(client, name="used_by_tests_all")
        t_v1 = _write_test_pinned(fn_id, "1.0.0", name="all_v1")
        t_v2 = _write_test_pinned(fn_id, "2.0.0", name="all_v2")

        response = client.get(f"/functions/{fn_id}/dependents")
        all_tests = _ids(response.json()["data"]["tests"])
        assert {t_v1, t_v2} <= all_tests

    def test_version_less_reference_excluded_from_version_filter(self, client: TestClient) -> None:
        fn_id = _create_function(client, name="used_unpinned")
        unpinned = _write_test_pinned(fn_id, None, name="no_pin")

        filtered = client.get(f"/functions/{fn_id}/dependents?version=1.0.0")
        assert unpinned not in _ids(filtered.json()["data"]["tests"])

        unfiltered = client.get(f"/functions/{fn_id}/dependents")
        assert unpinned in _ids(unfiltered.json()["data"]["tests"])


# ---------------------------------------------------------------------------
# Functions as version-pinned dependents
# ---------------------------------------------------------------------------


class TestVersionedFunctionDependents:
    def test_version_filter_selects_only_matching_function(self, client: TestClient) -> None:
        fn_id = _create_function(client, name="used_by_functions")
        g_v1 = _write_function_pinned(fn_id, "1.0.0", name="caller_v1")
        g_v2 = _write_function_pinned(fn_id, "2.0.0", name="caller_v2")

        v1 = client.get(f"/functions/{fn_id}/dependents?version=1.0.0")
        v1_functions = _ids(v1.json()["data"]["functions"])
        assert g_v1 in v1_functions
        assert g_v2 not in v1_functions

        v2 = client.get(f"/functions/{fn_id}/dependents?version=2.0.0")
        v2_functions = _ids(v2.json()["data"]["functions"])
        assert g_v2 in v2_functions
        assert g_v1 not in v2_functions

    def test_no_version_returns_all_pinned_functions(self, client: TestClient) -> None:
        fn_id = _create_function(client, name="used_by_functions_all")
        g_v1 = _write_function_pinned(fn_id, "1.0.0", name="fall_v1")
        g_v2 = _write_function_pinned(fn_id, "2.0.0", name="fall_v2")

        response = client.get(f"/functions/{fn_id}/dependents")
        all_functions = _ids(response.json()["data"]["functions"])
        assert {g_v1, g_v2} <= all_functions


# ---------------------------------------------------------------------------
# Not found
# ---------------------------------------------------------------------------


class TestVersionedDependentsNotFound:
    def test_missing_function_returns_404_with_version(self, client: TestClient) -> None:
        missing_id = str(uuid.uuid4())
        response = client.get(f"/functions/{missing_id}/dependents?version=1.0.0")
        assert response.status_code == 404
        assert any(NOT_FOUND_RE.match(m) for m in _all_error_messages(response.json()))


# ---------------------------------------------------------------------------
# Batched per-version dependents: one request, one storage pass.
# ---------------------------------------------------------------------------


class TestDependentsByVersion:
    def test_buckets_references_by_pinned_version_in_one_call(self, client: TestClient) -> None:
        lib = _create_function(client, name="lib")
        t_v1 = _write_test_pinned(lib, "1.0.0", name="pins_v1")
        t_v2 = _write_test_pinned(lib, "2.0.0", name="pins_v2")
        g_v2 = _write_function_pinned(lib, "2.0.0", name="caller_v2")

        response = client.get(f"/functions/{lib}/dependents/by-version")
        assert response.status_code == 200
        data = response.json()["data"]
        assert _ids(data["1.0.0"]["tests"]) == {t_v1}
        assert _ids(data["2.0.0"]["tests"]) == {t_v2}
        assert _ids(data["2.0.0"]["functions"]) == {g_v2}

    def test_missing_function_returns_404(self, client: TestClient) -> None:
        response = client.get(f"/functions/{uuid.uuid4()}/dependents/by-version")
        assert response.status_code == 404
        assert any(NOT_FOUND_RE.match(m) for m in _all_error_messages(response.json()))


class TestDependentsScanEdges:
    def test_referenced_versions_ignores_unrelated_nodes(self) -> None:
        # A non-function node and a function node pinning a DIFFERENT id.
        definition = {
            "workflow": {
                "nodes": [
                    {"data": {"nodeType": "plugin"}},
                    {
                        "data": {
                            "nodeType": "function",
                            "functionId": "other",
                            "functionVersion": "1.0.0",
                        }
                    },
                ]
            }
        }
        assert _storage._entity_referenced_versions(definition, "target") == set()

    def test_references_function_node_skips_non_function_nodes(self) -> None:
        definition = {"workflow": {"nodes": [{"data": {"nodeType": "plugin"}}]}}
        assert _storage._entity_references_function_node(definition, "target") is False

    def test_scan_by_version_skips_non_directory_entries(self) -> None:
        functions_root = _storage._functions_dir()
        functions_root.mkdir(parents=True, exist_ok=True)
        (functions_root / "stray.txt").write_text("not a function directory")
        result = _storage.scan_dependents_by_version("nobody")
        assert isinstance(result, dict)


def _seed_tests_root() -> Path:
    """The Tests storage directory, created and empty."""
    from wavecore.api.services.storage_paths import get_tests_storage_path

    tests_root = get_tests_storage_path()
    tests_root.mkdir(parents=True, exist_ok=True)
    return tests_root


class TestATestDirectoryTheProductCannotRead:
    """A test directory left half removed on disk must not break the Functions page.

    Both dependents walks read every entry under the Tests directory, so a
    directory whose manifest is gone, or a stray file sitting next to the
    directories, has to be passed over rather than raise.
    """

    def test_a_directory_with_no_manifest_is_skipped(self) -> None:
        tests_root = _seed_tests_root()
        (tests_root / "half-removed").mkdir(exist_ok=True)

        assert _storage.scan_dependents("nobody") == {"tests": [], "functions": []}

    def test_a_directory_with_no_manifest_is_skipped_when_bucketing_by_version(self) -> None:
        tests_root = _seed_tests_root()
        (tests_root / "half-removed").mkdir(exist_ok=True)

        assert _storage.scan_dependents_by_version("nobody") == {}

    def test_a_stray_file_beside_the_test_directories_is_skipped(self) -> None:
        tests_root = _seed_tests_root()
        (tests_root / "stray.txt").write_text("not a test directory")

        assert _storage.scan_dependents("nobody") == {"tests": [], "functions": []}
        assert _storage.scan_dependents_by_version("nobody") == {}

    def test_an_empty_manifest_is_skipped(self) -> None:
        tests_root = _seed_tests_root()
        truncated = tests_root / "truncated"
        truncated.mkdir(exist_ok=True)
        (truncated / "test.yaml").write_text("")

        assert _storage.scan_dependents("nobody") == {"tests": [], "functions": []}
        assert _storage.scan_dependents_by_version("nobody") == {}


pytestmark = pytest.mark.usefixtures("temp_storage_path")
