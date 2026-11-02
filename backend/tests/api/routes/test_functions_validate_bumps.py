"""Route-level tests for `POST /functions/{id}/validate-bumps` (REQ-3.1.2.2).

Contract:

    POST /functions/{function_id}/validate-bumps
        Request: {draft_definition: FunctionDefinition, source_version: str}
        Response: {allowed: [...], blocked: {patch?: str, minor?: str, major?: str}}
        Status: 200, 404, 422
        Errors:
          - ^Function '{function_id}' not found$ (404)
          - ^Function '{function_id}' version '{source_version}' not found$ (404)
          - ^Draft definition is malformed: {reason}$ (422)

The endpoint is what the FE's debounced `useAllowedBumps` hook calls as the
user types in the edit-mode publish dialog.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Generator
from typing import Any

import pytest
from fastapi.testclient import TestClient

# Anchored regex helpers for the exact error messages.
FUNCTION_NOT_FOUND_RE = re.compile(r"^Function '[0-9a-fA-F-]+' not found$")
VERSION_NOT_FOUND_RE = re.compile(r"^Function '[0-9a-fA-F-]+' version '[^']+' not found$")
DRAFT_MALFORMED_RE = re.compile(r"^Draft definition is malformed: .+$")


@pytest.fixture(autouse=True)
def _register_core_plugins_and_controls() -> Generator[None, None, None]:
    try:
        from wavecore.controls.registry import _registry, register_all_core_controls
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.log import LogPlugin
    except (ImportError, ModuleNotFoundError):
        yield
        return

    _registry.clear()
    register_all_core_controls(_registry)
    clear_registry()
    register_plugin(LogPlugin())
    yield
    _registry.clear()
    clear_registry()


@pytest.fixture
def client() -> TestClient:
    from wavecore.api.app import app

    return TestClient(app)


def _all_error_messages(body: dict) -> list[str]:
    err = body.get("error") or {}
    messages: list[str] = []
    if err.get("message"):
        messages.append(err["message"])
    details = err.get("details") or []
    if isinstance(details, list):
        for item in details:
            if isinstance(item, str):
                messages.append(item)
            elif isinstance(item, dict) and "message" in item:
                messages.append(item["message"])
    return messages


def _make_draft(**overrides: Any) -> dict[str, Any]:
    """Build a baseline draft definition body for the endpoint."""
    return {
        "name": overrides.pop("name", "greet"),
        "description": overrides.pop("description", "say hello"),
        "tags": overrides.pop("tags", ["demo"]),
        "inputs": overrides.pop("inputs", [{"name": "x", "type": "string", "required": True}]),
        "outputs": overrides.pop("outputs", [{"name": "result", "type": "string"}]),
        "dependencies": overrides.pop("dependencies", {"functions": [], "plugins": []}),
        "workflow": overrides.pop("workflow", {"nodes": [], "edges": []}),
        **overrides,
    }


def _seed_source_function(name: str = "greet", version: str = "1.0.0") -> str:
    """Seed a single-version Function whose v1.0.0 matches `_make_draft()`."""
    from wavecore.api.services.functions._storage import save_new_version

    fn_id = str(uuid.uuid4())
    save_new_version(
        fn_id,
        version,
        {
            "inputs": [{"name": "x", "type": "string", "required": True}],
            "outputs": [{"name": "result", "type": "string"}],
            "dependencies": {"functions": [], "plugins": []},
            "workflow": {"nodes": [], "edges": []},
        },
        {
            "description": "say hello",
            "tags": ["demo"],
            "changelog": "initial",
            "details": "",
            "published_at": "2026-01-01T00:00:00Z",
            "published_by": "wave",
        },
        name=name,
    )
    return fn_id


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


class TestValidateBumpsHappyPath:
    """200 with the matrix result for a registered (function, source_version)."""

    def test_no_changes_returns_all_allowed(self, client: TestClient) -> None:
        fn_id = _seed_source_function()
        response = client.post(
            f"/functions/{fn_id}/validate-bumps",
            json={"draft_definition": _make_draft(), "source_version": "1.0.0"},
        )
        assert response.status_code == 200, response.text
        data = response.json()["data"]
        assert set(data["allowed"]) == {"patch", "minor", "major"}
        assert data["blocked"] == {}

    def test_optional_input_addition_returns_minor_and_major(self, client: TestClient) -> None:
        fn_id = _seed_source_function()
        draft = _make_draft(
            inputs=[
                {"name": "x", "type": "string", "required": True},
                {"name": "y", "type": "integer", "required": False},
            ]
        )
        response = client.post(
            f"/functions/{fn_id}/validate-bumps",
            json={"draft_definition": draft, "source_version": "1.0.0"},
        )
        assert response.status_code == 200
        data = response.json()["data"]
        assert set(data["allowed"]) == {"minor", "major"}
        assert "patch" in data["blocked"]
        # The blocked reason is a non-empty string for tooltip rendering.
        assert isinstance(data["blocked"]["patch"], str)
        assert data["blocked"]["patch"]

    def test_required_input_addition_returns_major_only(self, client: TestClient) -> None:
        fn_id = _seed_source_function()
        draft = _make_draft(
            inputs=[
                {"name": "x", "type": "string", "required": True},
                {"name": "y", "type": "integer", "required": True},
            ]
        )
        response = client.post(
            f"/functions/{fn_id}/validate-bumps",
            json={"draft_definition": draft, "source_version": "1.0.0"},
        )
        assert response.status_code == 200
        data = response.json()["data"]
        assert set(data["allowed"]) == {"major"}
        assert set(data["blocked"]) == {"patch", "minor"}

    def test_name_change_returns_none_allowed_all_blocked(self, client: TestClient) -> None:
        """Name is locked entry-wide."""
        fn_id = _seed_source_function()
        draft = _make_draft(name="renamed_greet")
        response = client.post(
            f"/functions/{fn_id}/validate-bumps",
            json={"draft_definition": draft, "source_version": "1.0.0"},
        )
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["allowed"] == []
        assert set(data["blocked"]) == {"patch", "minor", "major"}


# ---------------------------------------------------------------------------
# 404: unknown function / unknown source version
# ---------------------------------------------------------------------------


class TestValidateBumpsLookupErrors:
    """404 with the canonical error messages."""

    def test_unknown_function_returns_404(self, client: TestClient) -> None:
        ghost_id = str(uuid.uuid4())
        response = client.post(
            f"/functions/{ghost_id}/validate-bumps",
            json={"draft_definition": _make_draft(), "source_version": "1.0.0"},
        )
        assert response.status_code == 404
        messages = _all_error_messages(response.json())
        assert any(m == f"Function '{ghost_id}' not found" for m in messages), messages
        assert any(FUNCTION_NOT_FOUND_RE.match(m) for m in messages)

    def test_known_function_unknown_source_version_returns_404(self, client: TestClient) -> None:
        fn_id = _seed_source_function()
        response = client.post(
            f"/functions/{fn_id}/validate-bumps",
            json={"draft_definition": _make_draft(), "source_version": "9.9.9"},
        )
        assert response.status_code == 404
        messages = _all_error_messages(response.json())
        expected = f"Function '{fn_id}' version '9.9.9' not found"
        assert any(m == expected for m in messages), messages
        assert any(VERSION_NOT_FOUND_RE.match(m) for m in messages)


# ---------------------------------------------------------------------------
# 422: malformed draft body
# ---------------------------------------------------------------------------


class TestValidateBumpsMalformedDraft:
    """422 with the `^Draft definition is malformed: {reason}$` message."""

    def test_missing_draft_returns_422(self, client: TestClient) -> None:
        fn_id = _seed_source_function()
        response = client.post(
            f"/functions/{fn_id}/validate-bumps",
            json={"source_version": "1.0.0"},
        )
        assert response.status_code == 422
        messages = _all_error_messages(response.json())
        assert any(DRAFT_MALFORMED_RE.match(m) for m in messages), messages

    def test_missing_source_version_returns_422(self, client: TestClient) -> None:
        fn_id = _seed_source_function()
        response = client.post(
            f"/functions/{fn_id}/validate-bumps",
            json={"draft_definition": _make_draft()},
        )
        assert response.status_code == 422
        messages = _all_error_messages(response.json())
        assert any(DRAFT_MALFORMED_RE.match(m) for m in messages), messages

    def test_draft_with_wrong_shape_returns_422(self, client: TestClient) -> None:
        """Draft is not a dict / does not have the required fields."""
        fn_id = _seed_source_function()
        response = client.post(
            f"/functions/{fn_id}/validate-bumps",
            json={"draft_definition": "not-a-dict", "source_version": "1.0.0"},
        )
        assert response.status_code == 422
        messages = _all_error_messages(response.json())
        assert any(DRAFT_MALFORMED_RE.match(m) for m in messages), messages


pytestmark = pytest.mark.usefixtures("temp_storage_path")
