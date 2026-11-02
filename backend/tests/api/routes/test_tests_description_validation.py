"""Tests for node `description` length validation on POST/PUT /tests.

Covers:
- A node description > 64 characters is auto-trimmed to 64 on save (matches
  the structural-autofix contract used for other recoverable node-level
  errors). The /validate flow still surfaces the same error with a
  `fix_action="Trim description to 64 characters"` so the modal can offer
  the fix for tests already on disk in the over-length state.
- Description of exactly 64 chars is accepted unchanged.
- An absent description is accepted.
- The error message is verbatim - no truncation, no substitution.
"""

from typing import Any

import pytest
from fastapi.testclient import TestClient

from wavecore.api.services.tests import service as test_service


def _reset_storage_and_registry() -> None:
    """Reset test storage and re-register controls/plugins (matches test_validation_pipeline.py)."""
    from wavecore.controls.registry import _registry, register_all_core_controls
    from wavecore.core.plugin_registry import clear_registry, register_plugin
    from wavecore.plugins.http_client import HTTPClientPlugin

    test_service._clear_storage()
    _registry.clear()
    register_all_core_controls(_registry)
    clear_registry()
    register_plugin(HTTPClientPlugin())


def _make_workflow_node(
    *,
    node_id: str = "node-1",
    element_type: str = "http-client",
    node_type: str = "plugin",
    label: str = "HTTP Probe",
    version: str = "1.0.0",
    description: str | None = None,
) -> dict[str, Any]:
    """Build a node dict including an optional description (post-rename shape)."""
    data: dict[str, Any] = {
        "elementType": element_type,
        "nodeType": node_type,
        "version": version,
        "label": label,
        "config": {
            "values": {"method": "GET", "url": "http://example.com"},
        },
    }
    if description is not None:
        data["description"] = description
    return {
        "id": node_id,
        "type": "workflowNode",
        "position": {"x": 100, "y": 200},
        "data": data,
    }


_EXPECTED_ERROR_MESSAGE = "Block description must be at most 64 characters"
_EXPECTED_FIX_ACTION = "Trim description to 64 characters"


class TestPostTestsDescriptionLength:
    """POST /tests rejects per-node description > 64 chars with the exact message."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def setup_method(self) -> None:
        _reset_storage_and_registry()

    def _extract_messages(self, payload: dict[str, Any]) -> list[str]:
        """Pull error messages out of either the flat or detail-envelope shape."""
        messages: list[str] = []
        err = payload.get("error", {})
        if "message" in err:
            messages.append(err["message"])
        for detail in err.get("details", []):
            if isinstance(detail, dict) and "message" in detail:
                messages.append(detail["message"])
        return messages

    def test_description_65_chars_autofixed_to_64_on_save(self, client: TestClient) -> None:
        """On save, an over-length description is auto-trimmed to 64 characters
        (matches the structural-autofix contract used for other recoverable
        node-level errors). The validation flow surfaces the same error with a
        `fix_action` so the /validate + /fix UX still works for tests already
        on disk in the over-length state."""
        node = _make_workflow_node(description="x" * 65)
        response = client.post(
            "/tests",
            json={
                "name": "Desc Over 64",
                "workflow": {"nodes": [node], "edges": []},
                "variables": {},
            },
        )

        assert response.status_code == 201
        created = response.json()["data"]
        saved_desc = created["workflow"]["nodes"][0]["data"]["description"]
        assert saved_desc == "x" * 64

    def test_description_exactly_64_chars_accepted(self, client: TestClient) -> None:
        node = _make_workflow_node(description="x" * 64)
        response = client.post(
            "/tests",
            json={
                "name": "Desc Exactly 64",
                "workflow": {"nodes": [node], "edges": []},
                "variables": {},
            },
        )
        assert response.status_code == 201

    def test_description_under_64_chars_accepted(self, client: TestClient) -> None:
        node = _make_workflow_node(description="A normal short description.")
        response = client.post(
            "/tests",
            json={
                "name": "Desc Under 64",
                "workflow": {"nodes": [node], "edges": []},
                "variables": {},
            },
        )
        assert response.status_code == 201

    def test_description_absent_accepted(self, client: TestClient) -> None:
        node = _make_workflow_node(description=None)
        response = client.post(
            "/tests",
            json={
                "name": "Desc Absent",
                "workflow": {"nodes": [node], "edges": []},
                "variables": {},
            },
        )
        assert response.status_code == 201

    def test_description_empty_string_accepted(self, client: TestClient) -> None:
        """Empty-string description is equivalent to absent - accepted, not rejected."""
        node = _make_workflow_node(description="")
        response = client.post(
            "/tests",
            json={
                "name": "Desc Empty",
                "workflow": {"nodes": [node], "edges": []},
                "variables": {},
            },
        )
        assert response.status_code == 201

    def test_description_unicode_65_codepoints_autofixed(self, client: TestClient) -> None:
        """The 64 limit is in characters (codepoints), not bytes - a 65-codepoint
        string is auto-trimmed to 64 codepoints on save."""
        node = _make_workflow_node(description="é" * 65)
        response = client.post(
            "/tests",
            json={
                "name": "Desc Unicode Over",
                "workflow": {"nodes": [node], "edges": []},
                "variables": {},
            },
        )
        assert response.status_code == 201
        saved_desc = response.json()["data"]["workflow"]["nodes"][0]["data"]["description"]
        assert saved_desc == "é" * 64


class TestPutTestsDescriptionLength:
    """PUT /tests/{id} applies the same description-length rule."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def setup_method(self) -> None:
        _reset_storage_and_registry()

    def _create_baseline_test(self, client: TestClient) -> str:
        node = _make_workflow_node(description=None)
        response = client.post(
            "/tests",
            json={
                "name": "Baseline",
                "workflow": {"nodes": [node], "edges": []},
                "variables": {},
            },
        )
        assert response.status_code == 201
        return response.json()["data"]["id"]

    def test_put_autofixes_description_65_chars(self, client: TestClient) -> None:
        """PUT, like POST, auto-trims an over-length description to 64 chars."""
        test_id = self._create_baseline_test(client)
        bad_node = _make_workflow_node(description="x" * 65)
        response = client.put(
            f"/tests/{test_id}",
            json={
                "name": "Baseline",
                "workflow": {"nodes": [bad_node], "edges": []},
            },
        )
        assert response.status_code == 200
        saved_desc = response.json()["data"]["workflow"]["nodes"][0]["data"]["description"]
        assert saved_desc == "x" * 64

    def test_put_accepts_description_64_chars(self, client: TestClient) -> None:
        test_id = self._create_baseline_test(client)
        good_node = _make_workflow_node(description="x" * 64)
        response = client.put(
            f"/tests/{test_id}",
            json={
                "name": "Baseline",
                "workflow": {"nodes": [good_node], "edges": []},
            },
        )
        assert response.status_code == 200

    def test_put_accepts_absent_description(self, client: TestClient) -> None:
        test_id = self._create_baseline_test(client)
        node = _make_workflow_node(description=None)
        response = client.put(
            f"/tests/{test_id}",
            json={
                "name": "Baseline",
                "workflow": {"nodes": [node], "edges": []},
            },
        )
        assert response.status_code == 200


class TestDescriptionValidationSurface:
    """Direct validation-surface coverage: the rule emits the exact message AND
    a fix_action so the /validate + /fix UX can offer the trim to the user."""

    def setup_method(self) -> None:
        _reset_storage_and_registry()

    def _validate_workflow_with_description(self, description: str) -> list[dict[str, Any]]:
        """Pass a synthetic test dict directly to the validator (bypasses the
        save autofix so we can inspect the raw error entry)."""
        node = _make_workflow_node(description=description)
        test = {
            "id": "00000000-0000-0000-0000-000000000000",
            "name": "Direct Validate",
            "version": "1.0.0",
            "description": "",
            "workflow": {"nodes": [node], "edges": []},
            "variables": {},
            "metadata": {},
        }
        result = test_service._validate_test_data(test, context="load")
        return list(result.get("errors", []))

    def test_validation_emits_exact_message_and_fix_action(self) -> None:
        errors = self._validate_workflow_with_description("x" * 65)
        matches = [
            e
            for e in errors
            if e.get("code") == "DESCRIPTION_TOO_LONG"
            and e.get("message") == _EXPECTED_ERROR_MESSAGE
        ]
        assert matches, f"Expected DESCRIPTION_TOO_LONG with exact message; got {errors!r}"
        assert matches[0].get("fix_action") == _EXPECTED_FIX_ACTION

    def test_validation_silent_at_exactly_64(self) -> None:
        errors = self._validate_workflow_with_description("x" * 64)
        assert not any(e.get("code") == "DESCRIPTION_TOO_LONG" for e in errors)


class TestDescriptionValidationDoesNotMutateOtherFields:
    """The new validation must not break existing valid POST/PUT behavior."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def setup_method(self) -> None:
        _reset_storage_and_registry()

    def test_short_description_round_trips_after_create(self, client: TestClient) -> None:
        """A node with a valid description is persisted and returned with that description."""
        node = _make_workflow_node(description="Probe gateway")
        response = client.post(
            "/tests",
            json={
                "name": "Round Trip",
                "workflow": {"nodes": [node], "edges": []},
                "variables": {},
            },
        )
        assert response.status_code == 201
        created = response.json()["data"]
        assert created["workflow"]["nodes"][0]["data"]["description"] == "Probe gateway"

    def test_fix_description_length_noop_when_node_missing(self) -> None:
        """Defensive early-return: fixing a node id that isn't in the workflow is a noop."""
        nodes = [_make_workflow_node(node_id="present", description="x" * 100)]
        # Call with a node_id that does not exist in the workflow. Should not raise
        # and should leave the other node untouched.
        test_service._fix_node_description_length(nodes, "missing", "DESCRIPTION_TOO_LONG")
        assert nodes[0]["data"]["description"] == "x" * 100
