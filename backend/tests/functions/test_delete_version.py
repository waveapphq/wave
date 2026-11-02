"""Tests for per-version Function delete.

Contract:

- DELETE /functions/{id}/versions/{version} -> 204 on success.
- Per-version delete is NEVER blocked by usage (a consuming Test surfaces the
  existing missing-version alert on load/save/run; deletion itself proceeds).
- Deleting the last remaining version removes the whole Function.
- service.delete_function_version wraps _storage.delete_version.

Anchored error strings:
    ^Function '<id>' version '<v>' not found$
    ^Function '<id>' not found$
"""

import re
import uuid
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient

from .conftest import make_function_payload

VERSION_NOT_FOUND_RE = re.compile(r"^Function '.+' version '.+' not found$")
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


def _add_version(function_id: str, version: str, *, name: str) -> None:
    """Persist an additional immutable version directly via storage."""
    from wavecore.api.services.functions import _storage

    definition = {
        "name": name,
        "inputs": [],
        "outputs": [],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {"nodes": [], "edges": []},
    }
    metadata = {
        "description": "",
        "tags": [],
        "changelog": f"version {version}",
        "details": "",
        "published_at": "2026-01-02T00:00:00Z",
        "published_by": "wave",
    }
    _storage.save_new_version(function_id, version, definition, metadata, name=name)


def _write_test_pinned(library_id: str, version: str, *, name: str) -> str:
    from wavecore.api.services.storage_paths import get_tests_storage_path

    test_id = str(uuid.uuid4())
    test_dir: Path = get_tests_storage_path() / test_id
    test_dir.mkdir(parents=True, exist_ok=True)
    definition: dict[str, Any] = {
        "id": test_id,
        "name": name,
        "version": "1.0.0",
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
        "variables": {},
        "metadata": {},
    }
    with open(test_dir / "test.yaml", "w", encoding="utf-8") as f:
        yaml.safe_dump(definition, f, sort_keys=False)
    return test_id


def _version_strings(client: TestClient, function_id: str) -> list[str]:
    data = client.get(f"/functions/{function_id}/versions").json()["data"]
    return [v["version"] for v in data["versions"]]


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


class TestDeleteVersionSuccess:
    def test_delete_non_last_version_returns_204_and_keeps_function(
        self, client: TestClient
    ) -> None:
        fn_id = _create_function(client, name="multi_ver")
        _add_version(fn_id, "2.0.0", name="multi_ver")

        response = client.delete(f"/functions/{fn_id}/versions/1.0.0")
        assert response.status_code == 204
        assert response.content in (b"", b"null")

        remaining = _version_strings(client, fn_id)
        assert "1.0.0" not in remaining
        assert "2.0.0" in remaining
        # The Function itself still resolves.
        assert client.get(f"/functions/{fn_id}").status_code == 200

    def test_delete_last_version_removes_function(self, client: TestClient) -> None:
        fn_id = _create_function(client, name="solo_ver")
        response = client.delete(f"/functions/{fn_id}/versions/1.0.0")
        assert response.status_code == 204
        assert client.get(f"/functions/{fn_id}").status_code == 404


# ---------------------------------------------------------------------------
# Never blocked by usage
# ---------------------------------------------------------------------------


class TestDeleteVersionNotBlockedByUsage:
    def test_delete_used_version_is_allowed(self, client: TestClient) -> None:
        fn_id = _create_function(client, name="used_ver")
        _add_version(fn_id, "2.0.0", name="used_ver")
        consuming_test = _write_test_pinned(fn_id, "1.0.0", name="consumer")

        response = client.delete(f"/functions/{fn_id}/versions/1.0.0")
        # Per-version delete is informational-only on usage; never a 409.
        assert response.status_code == 204
        # The consuming Test is left in place (it surfaces a missing-version
        # alert on its own load/save/run; the delete does not cascade).
        from wavecore.api.services.storage_paths import get_tests_storage_path

        assert (get_tests_storage_path() / consuming_test / "test.yaml").exists()


# ---------------------------------------------------------------------------
# Not found
# ---------------------------------------------------------------------------


class TestDeleteVersionNotFound:
    def test_missing_version_returns_404(self, client: TestClient) -> None:
        fn_id = _create_function(client, name="has_one_ver")
        response = client.delete(f"/functions/{fn_id}/versions/9.9.9")
        assert response.status_code == 404
        assert any(VERSION_NOT_FOUND_RE.match(m) for m in _all_error_messages(response.json()))

    def test_missing_function_returns_404(self, client: TestClient) -> None:
        missing_id = str(uuid.uuid4())
        response = client.delete(f"/functions/{missing_id}/versions/1.0.0")
        assert response.status_code == 404
        assert any(NOT_FOUND_RE.match(m) for m in _all_error_messages(response.json()))


# ---------------------------------------------------------------------------
# Service wrapper
# ---------------------------------------------------------------------------


class TestDeleteFunctionVersionService:
    def test_service_removes_the_version(self, client: TestClient) -> None:
        from wavecore.api.services.functions import service as function_service

        fn_id = _create_function(client, name="svc_ver")
        _add_version(fn_id, "2.0.0", name="svc_ver")

        function_service.delete_function_version(fn_id, "1.0.0")
        assert "1.0.0" not in _version_strings(client, fn_id)

    def test_service_raises_not_found_for_missing_version(self, client: TestClient) -> None:
        from wavecore.api.exceptions import NotFoundException
        from wavecore.api.services.functions import service as function_service

        fn_id = _create_function(client, name="svc_missing")
        with pytest.raises(NotFoundException):
            function_service.delete_function_version(fn_id, "9.9.9")


pytestmark = pytest.mark.usefixtures("temp_storage_path")
