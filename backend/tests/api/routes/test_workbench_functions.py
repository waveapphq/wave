"""Route-level tests for the publish + detach workbench Function endpoints.

Contract:

    POST /tests/{test_id}/functions/publish
        201 created; 400 validation; 404 Test or node not found; 409 name
        collision; 422 cycle. Optimistic concurrency via If-Match. Stale
        ETag returns 412 with code "PRECONDITION_REQUIRED".

    POST /tests/{test_id}/functions/detach
        200; 404 Test/node/library entry not found; 409 already local.
        Same If-Match semantics.

Each error message is asserted with anchored regex.
"""

from __future__ import annotations

import re
from collections.abc import Generator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.api.error_reply_support import assert_error_reply, assert_internal_error
from wavecore.api.services.functions import service as functions_service
from wavecore.api.services.tests import service as test_service

# Anchored regex helpers for the exact error strings.
NAME_REQUIRED_RE = re.compile(r"^Function name is required$")
NAME_TOO_LONG_RE = re.compile(r"^Function name '.+' exceeds 32 characters$")
NAME_IN_USE_RE = re.compile(r"^Function name '.+' is already in use$")
TEST_NOT_FOUND_RE = re.compile(r"^Test '.+' not found$")
NODE_NOT_FOUND_RE = re.compile(r"^Block '.+' not found in Test '.+'$")
NODE_NOT_LOCAL_RE = re.compile(r"^Block '.+' is not a local Function$")
NOT_PUBLISHED_REF_RE = re.compile(r"^Block '.+' is not a published Function reference$")
LIBRARY_MISSING_RE = re.compile(r"^Library entry '.+' does not exist$")
_INTERNAL_TEXT = "internal lifecycle route fault"


def _stale_message(test_id: str) -> str:
    return f"Test '{test_id}' was modified concurrently; reload and retry"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


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
    err = body.get("error", {})
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


def _make_local_function_node(*, node_id: str = "fn-1", fn_name: str = "Greet") -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "position": {"x": 0, "y": 0},
        "data": {
            "label": fn_name,
            "elementType": "function",
            "nodeType": "function",
            "functionLifecycle": "local",
            "localDefinition": {
                "name": fn_name,
                "description": "",
                "tags": [],
                "inputs": [],
                "outputs": [],
                "dependencies": {"functions": [], "plugins": ["log"]},
                "workflow": {
                    "nodes": [
                        {
                            "id": "inner_log",
                            "type": "workflowNode",
                            "data": {
                                "label": "inner_log",
                                "elementType": "log",
                                "nodeType": "plugin",
                                "version": "1.0.0",
                                "config": {
                                    "values": {"message": "'hi'", "level": "INFO"},
                                    "outputBindings": {},
                                },
                                "expressionFields": ["message"],
                            },
                        }
                    ],
                    "edges": [{"source": "start-node", "target": "inner_log"}],
                },
            },
            "config": {"values": {}, "outputBindings": {}, "profileBindings": []},
        },
    }


def _seed_test_with_local_function(node_id: str = "fn-1") -> str:
    fn_node = _make_local_function_node(node_id=node_id)
    created = test_service.create_test(
        {
            "name": "Container",
            "workflow": {
                "nodes": [fn_node],
                "edges": [{"source": "start-node", "target": node_id}],
            },
            "variables": {},
        }
    )
    return created["id"]


def _get_test_etag(client: TestClient, test_id: str) -> str:
    response = client.get(f"/tests/{test_id}")
    assert response.status_code == 200, response.text
    return response.headers["ETag"]


# ---------------------------------------------------------------------------
# Publish: happy path + status codes
# ---------------------------------------------------------------------------


class TestPublishRouteHappyPath:
    def test_returns_201_with_function_id_and_node(self, client: TestClient) -> None:
        test_id = _seed_test_with_local_function(node_id="fn-1")
        etag = _get_test_etag(client, test_id)

        response = client.post(
            f"/tests/{test_id}/functions/publish",
            json={
                "node_id": "fn-1",
                "name": "Greet",
                "description": "Greets the user.",
                "tags": ["demo"],
                "changelog": "Initial",
                "details": "",
            },
            headers={"If-Match": etag},
        )
        assert response.status_code == 201, response.text
        body = response.json()
        data = body.get("data") or body
        assert "function_id" in data
        assert data["version"] == "1.0.0"
        assert data["node"]["data"]["functionLifecycle"] == "shared"
        # A fresh ETag is returned for follow-up Test edits.
        assert response.headers.get("ETag")
        assert response.headers["ETag"] != etag


# ---------------------------------------------------------------------------
# Publish: 400 validation
# ---------------------------------------------------------------------------


class TestPublishRouteValidation:
    def test_missing_name_returns_400(self, client: TestClient) -> None:
        test_id = _seed_test_with_local_function()
        etag = _get_test_etag(client, test_id)
        response = client.post(
            f"/tests/{test_id}/functions/publish",
            json={"node_id": "fn-1", "name": "", "description": "", "tags": []},
            headers={"If-Match": etag},
        )
        assert response.status_code == 400
        assert any(NAME_REQUIRED_RE.match(m) for m in _all_error_messages(response.json()))

    def test_name_over_32_chars_returns_400(self, client: TestClient) -> None:
        test_id = _seed_test_with_local_function()
        etag = _get_test_etag(client, test_id)
        response = client.post(
            f"/tests/{test_id}/functions/publish",
            json={
                "node_id": "fn-1",
                "name": "X" * 33,
                "description": "",
                "tags": [],
            },
            headers={"If-Match": etag},
        )
        assert response.status_code == 400
        assert any(NAME_TOO_LONG_RE.match(m) for m in _all_error_messages(response.json()))


# ---------------------------------------------------------------------------
# Publish: 409 name collision
# ---------------------------------------------------------------------------


class TestPublishRouteNameCollision:
    def test_duplicate_name_returns_409(self, client: TestClient) -> None:
        functions_service.create_function(
            {
                "name": "Taken Name",
                "description": "",
                "tags": [],
                "inputs": [],
                "outputs": [],
                "dependencies": {"functions": [], "plugins": []},
                "workflow": {"nodes": [], "edges": []},
            }
        )
        test_id = _seed_test_with_local_function()
        etag = _get_test_etag(client, test_id)

        response = client.post(
            f"/tests/{test_id}/functions/publish",
            json={
                "node_id": "fn-1",
                "name": "TAKEN NAME",
                "description": "",
                "tags": [],
            },
            headers={"If-Match": etag},
        )
        assert response.status_code == 409
        assert any(NAME_IN_USE_RE.match(m) for m in _all_error_messages(response.json()))


# ---------------------------------------------------------------------------
# Publish: 404 lookup
# ---------------------------------------------------------------------------


class TestPublishRouteLookupErrors:
    def test_unknown_test_returns_404(self, client: TestClient) -> None:
        response = client.post(
            "/tests/00000000-0000-0000-0000-000000000000/functions/publish",
            json={"node_id": "fn-x", "name": "Greet", "description": "", "tags": []},
            headers={"If-Match": '"unknown"'},
        )
        assert response.status_code == 404
        assert any(TEST_NOT_FOUND_RE.match(m) for m in _all_error_messages(response.json()))

    def test_unknown_node_returns_404(self, client: TestClient) -> None:
        test_id = _seed_test_with_local_function(node_id="fn-real")
        etag = _get_test_etag(client, test_id)
        response = client.post(
            f"/tests/{test_id}/functions/publish",
            json={
                "node_id": "fn-missing",
                "name": "Greet",
                "description": "",
                "tags": [],
            },
            headers={"If-Match": etag},
        )
        assert response.status_code == 404
        assert any(NODE_NOT_FOUND_RE.match(m) for m in _all_error_messages(response.json()))

    def test_non_local_node_returns_409(self, client: TestClient) -> None:
        plugin_node = {
            "id": "plug-1",
            "type": "workflowNode",
            "position": {"x": 0, "y": 0},
            "data": {
                "label": "plug",
                "nodeType": "plugin",
                "elementType": "log",
                "version": "1.0.0",
                "config": {
                    "values": {"message": "'hi'", "level": "INFO"},
                    "outputBindings": {},
                },
                "expressionFields": ["message"],
            },
        }
        created = test_service.create_test(
            {
                "name": "Container",
                "workflow": {
                    "nodes": [plugin_node],
                    "edges": [{"source": "start-node", "target": "plug-1"}],
                },
                "variables": {},
            }
        )
        test_id = created["id"]
        etag = _get_test_etag(client, test_id)

        response = client.post(
            f"/tests/{test_id}/functions/publish",
            json={"node_id": "plug-1", "name": "Greet", "description": "", "tags": []},
            headers={"If-Match": etag},
        )
        assert response.status_code == 409
        assert any(NODE_NOT_LOCAL_RE.match(m) for m in _all_error_messages(response.json()))


# ---------------------------------------------------------------------------
# Publish: 412 stale ETag
# ---------------------------------------------------------------------------


class TestPublishRouteStaleEtag:
    def test_stale_etag_returns_412_with_code(self, client: TestClient) -> None:
        test_id = _seed_test_with_local_function()
        response = client.post(
            f"/tests/{test_id}/functions/publish",
            json={"node_id": "fn-1", "name": "Greet", "description": "", "tags": []},
            headers={"If-Match": '"stale-etag-not-matching"'},
        )
        assert_error_reply(response, 412, "PRECONDITION_REQUIRED", _stale_message(test_id))


# ---------------------------------------------------------------------------
# Detach: happy path + status codes
# ---------------------------------------------------------------------------


def _seed_test_with_shared_function(client: TestClient) -> tuple[str, str]:
    """Helper: publish a local Function so we can drive a detach test against it.

    Returns (test_id, fn_node_id).
    """
    test_id = _seed_test_with_local_function(node_id="fn-shared")
    etag = _get_test_etag(client, test_id)
    response = client.post(
        f"/tests/{test_id}/functions/publish",
        json={
            "node_id": "fn-shared",
            "name": "ToBeDetached",
            "description": "",
            "tags": [],
        },
        headers={"If-Match": etag},
    )
    assert response.status_code == 201, response.text
    return test_id, "fn-shared"


class TestDetachRouteHappyPath:
    def test_returns_200_with_updated_node(self, client: TestClient) -> None:
        test_id, node_id = _seed_test_with_shared_function(client)
        etag = _get_test_etag(client, test_id)

        response = client.post(
            f"/tests/{test_id}/functions/detach",
            json={"node_id": node_id},
            headers={"If-Match": etag},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        data = body.get("data") or body
        assert data["node"]["data"]["functionLifecycle"] == "local"
        assert "localDefinition" in data["node"]["data"]
        # ETag refreshes after the mutation.
        assert response.headers.get("ETag")
        assert response.headers["ETag"] != etag


# ---------------------------------------------------------------------------
# Detach: 404 lookup
# ---------------------------------------------------------------------------


class TestDetachRouteLookupErrors:
    def test_unknown_test_returns_404(self, client: TestClient) -> None:
        response = client.post(
            "/tests/00000000-0000-0000-0000-000000000000/functions/detach",
            json={"node_id": "fn-x"},
            headers={"If-Match": '"unknown"'},
        )
        assert response.status_code == 404
        assert any(TEST_NOT_FOUND_RE.match(m) for m in _all_error_messages(response.json()))

    def test_unknown_node_returns_404(self, client: TestClient) -> None:
        test_id, _node_id = _seed_test_with_shared_function(client)
        etag = _get_test_etag(client, test_id)
        response = client.post(
            f"/tests/{test_id}/functions/detach",
            json={"node_id": "fn-missing"},
            headers={"If-Match": etag},
        )
        assert response.status_code == 404
        assert any(NODE_NOT_FOUND_RE.match(m) for m in _all_error_messages(response.json()))

    def test_missing_library_entry_returns_404(self, client: TestClient) -> None:
        ghost_id = "00000000-0000-0000-0000-00000000beef"
        shared_node = {
            "id": "fn-ghost",
            "type": "workflowNode",
            "position": {"x": 0, "y": 0},
            "data": {
                "label": "Ghost",
                "elementType": "function",
                "nodeType": "function",
                "functionLifecycle": "shared",
                "functionId": ghost_id,
                "config": {"values": {}, "outputBindings": {}, "profileBindings": []},
            },
        }
        created = test_service.create_test(
            {
                "name": "Ghost",
                "workflow": {
                    "nodes": [shared_node],
                    "edges": [{"source": "start-node", "target": "fn-ghost"}],
                },
                "variables": {},
            }
        )
        test_id = created["id"]
        etag = _get_test_etag(client, test_id)
        response = client.post(
            f"/tests/{test_id}/functions/detach",
            json={"node_id": "fn-ghost"},
            headers={"If-Match": etag},
        )
        assert response.status_code == 404
        assert any(LIBRARY_MISSING_RE.match(m) for m in _all_error_messages(response.json()))


# ---------------------------------------------------------------------------
# Detach: 409 already local
# ---------------------------------------------------------------------------


class TestDetachRouteAlreadyLocal:
    def test_local_node_returns_409(self, client: TestClient) -> None:
        test_id = _seed_test_with_local_function()
        etag = _get_test_etag(client, test_id)
        response = client.post(
            f"/tests/{test_id}/functions/detach",
            json={"node_id": "fn-1"},
            headers={"If-Match": etag},
        )
        assert response.status_code == 409
        assert any(NOT_PUBLISHED_REF_RE.match(m) for m in _all_error_messages(response.json()))


# ---------------------------------------------------------------------------
# Detach: 412 stale ETag
# ---------------------------------------------------------------------------


class TestDetachRouteStaleEtag:
    def test_stale_etag_returns_412_with_code(self, client: TestClient) -> None:
        test_id, node_id = _seed_test_with_shared_function(client)
        response = client.post(
            f"/tests/{test_id}/functions/detach",
            json={"node_id": node_id},
            headers={"If-Match": '"stale-etag-not-matching"'},
        )
        assert_error_reply(response, 412, "PRECONDITION_REQUIRED", _stale_message(test_id))


# ---------------------------------------------------------------------------
# Invalid input / parsing branches (coverage)
# ---------------------------------------------------------------------------


class TestPublishRouteWithoutIfMatch:
    def test_publish_without_if_match_proceeds(self, client: TestClient) -> None:
        """When no If-Match header is sent, `_check_if_match` short-circuits
        and the publish proceeds normally."""
        test_id = _seed_test_with_local_function()
        response = client.post(
            f"/tests/{test_id}/functions/publish",
            json={"node_id": "fn-1", "name": "Greet", "description": "", "tags": []},
        )
        assert response.status_code == 201


class TestPublishRouteEtagAgainstMissingTest:
    def test_if_match_against_missing_test_passes_through(self, client: TestClient) -> None:
        """When the Test doesn't exist (404 path), `_check_if_match` short-
        circuits and returns None so the service-layer 404 fires consistently
        whether or not the caller sent an If-Match header. Exercises the
        `if test is None: return None` branch."""
        missing_test_id = "00000000-0000-0000-0000-000000000000"
        response = client.post(
            f"/tests/{missing_test_id}/functions/publish",
            json={"node_id": "fn-x", "name": "Greet", "description": "", "tags": []},
            headers={"If-Match": '"some-etag"'},
        )
        assert response.status_code == 404


class TestPublishRouteInvalidInputs:
    def test_invalid_test_uuid_returns_400(self, client: TestClient) -> None:
        response = client.post(
            "/tests/not-a-uuid/functions/publish",
            json={"node_id": "fn-1", "name": "Greet", "description": "", "tags": []},
        )
        assert_error_reply(
            response, 400, "VALIDATION_ERROR", "Invalid UUID format for test_id: 'not-a-uuid'"
        )

    def test_unparsable_body_treated_as_empty(self, client: TestClient) -> None:
        test_id = _seed_test_with_local_function()
        etag = _get_test_etag(client, test_id)
        # Empty body → empty node_id → 404 (publish_local_function looks the
        # node up first, before name validation).
        response = client.post(
            f"/tests/{test_id}/functions/publish",
            content=b"not json",
            headers={"Content-Type": "application/json", "If-Match": etag},
        )
        assert response.status_code == 404
        messages = _all_error_messages(response.json())
        assert any("not found in Test" in m for m in messages), messages

    @pytest.mark.parametrize("text", ['"node_id"', '["node_id"]', "5"])
    def test_a_body_that_is_not_an_object_is_treated_as_empty(
        self, client: TestClient, text: str
    ) -> None:
        test_id = _seed_test_with_local_function()
        etag = _get_test_etag(client, test_id)

        response = client.post(
            f"/tests/{test_id}/functions/publish",
            content=text,
            headers={"Content-Type": "application/json", "If-Match": etag},
        )

        assert response.status_code == 404, response.json()
        assert response.json()["error"]["message"] == f"Block '' not found in Test '{test_id}'"


class TestDetachRouteInvalidInputs:
    def test_invalid_test_uuid_returns_400(self, client: TestClient) -> None:
        response = client.post(
            "/tests/not-a-uuid/functions/detach",
            json={"node_id": "fn-1"},
        )
        assert_error_reply(
            response, 400, "VALIDATION_ERROR", "Invalid UUID format for test_id: 'not-a-uuid'"
        )

    def test_unparsable_body_treated_as_empty(self, client: TestClient) -> None:
        test_id, _node_id = _seed_test_with_shared_function(client)
        etag = _get_test_etag(client, test_id)
        # Empty body → empty node_id → 404.
        response = client.post(
            f"/tests/{test_id}/functions/detach",
            content=b"not json",
            headers={"Content-Type": "application/json", "If-Match": etag},
        )
        assert response.status_code == 404
        messages = _all_error_messages(response.json())
        assert any("not found in Test" in m for m in messages), messages

    @pytest.mark.parametrize("text", ['"node_id"', '["node_id"]', "5"])
    def test_a_body_that_is_not_an_object_is_treated_as_empty(
        self, client: TestClient, text: str
    ) -> None:
        test_id, _node_id = _seed_test_with_shared_function(client)
        etag = _get_test_etag(client, test_id)

        response = client.post(
            f"/tests/{test_id}/functions/detach",
            content=text,
            headers={"Content-Type": "application/json", "If-Match": etag},
        )

        assert response.status_code == 404, response.json()
        assert response.json()["error"]["message"] == f"Block '' not found in Test '{test_id}'"


# ---------------------------------------------------------------------------
# Service-layer exceptions surfacing through the routes (coverage)
# ---------------------------------------------------------------------------


class TestPublishRouteServiceErrors:
    def test_invalid_semver_version_returns_400(self, client: TestClient) -> None:
        test_id = _seed_test_with_local_function()
        etag = _get_test_etag(client, test_id)
        response = client.post(
            f"/tests/{test_id}/functions/publish",
            json={
                "node_id": "fn-1",
                "name": "Greet",
                "description": "",
                "tags": [],
                "version": "not-a-version",
            },
            headers={"If-Match": etag},
        )
        assert response.status_code == 400
        assert "is not a valid semver" in response.json()["error"]["message"]

    def test_body_with_unknown_plugin_returns_422(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Publish a local Function whose body references an unknown plugin.

        The Test save pipeline would normally reject the body before publish
        can run, so we seed the Test directly with `_save_test` to exercise
        the publish-path `UnprocessableEntityException` branch.
        """
        import uuid as _uuid
        from datetime import UTC
        from datetime import datetime as _dt

        test_id_ = str(_uuid.uuid4())
        now = _dt.now(UTC).isoformat()
        test_service._save_test(
            {
                "id": test_id_,
                "name": "Bad Plugin Container",
                "version": "1.0.0",
                "description": "",
                "workflow": {
                    "nodes": [
                        {
                            "id": "fn-bad",
                            "type": "workflowNode",
                            "position": {"x": 0, "y": 0},
                            "data": {
                                "label": "Bad",
                                "elementType": "function",
                                "nodeType": "function",
                                "functionLifecycle": "local",
                                "localDefinition": {
                                    "name": "Bad",
                                    "description": "",
                                    "tags": [],
                                    "inputs": [],
                                    "outputs": [],
                                    "dependencies": {"functions": [], "plugins": []},
                                    "workflow": {
                                        "nodes": [
                                            {
                                                "id": "inner_unknown",
                                                "type": "workflowNode",
                                                "data": {
                                                    "label": "inner_unknown",
                                                    "elementType": "this-plugin-does-not-exist",
                                                    "nodeType": "plugin",
                                                    "version": "1.0.0",
                                                    "config": {"values": {}, "outputBindings": {}},
                                                },
                                            }
                                        ],
                                        "edges": [
                                            {"source": "start-node", "target": "inner_unknown"}
                                        ],
                                    },
                                },
                                "config": {
                                    "values": {},
                                    "outputBindings": {},
                                    "profileBindings": [],
                                },
                            },
                        }
                    ],
                    "edges": [{"source": "start-node", "target": "fn-bad"}],
                },
                "variables": {},
                "metadata": {},
                "created_at": now,
                "updated_at": now,
            }
        )
        etag = _get_test_etag(client, test_id_)
        response = client.post(
            f"/tests/{test_id_}/functions/publish",
            json={
                "node_id": "fn-bad",
                "name": "Bad Plugin Fn",
                "description": "",
                "tags": [],
            },
            headers={"If-Match": etag},
        )
        assert response.status_code == 422

    def test_validation_exception_not_name_collision_propagates_400(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Force `create_function` to raise a generic `ValidationException` to
        exercise the `is already in use` branch's `else` arm in
        `publish_local_function`."""
        from wavecore.api.exceptions import ValidationException
        from wavecore.api.services.workbench import functions as wfunctions

        test_id = _seed_test_with_local_function()
        etag = _get_test_etag(client, test_id)
        original = wfunctions._functions_service.create_function

        def _raise_other(payload, **_kwargs):
            raise ValidationException(
                message="Some other validation error",
                details={"errors": [{"message": "Some other validation error"}]},
            )

        monkeypatch.setattr(wfunctions._functions_service, "create_function", _raise_other)
        try:
            response = client.post(
                f"/tests/{test_id}/functions/publish",
                json={"node_id": "fn-1", "name": "Greet", "description": "", "tags": []},
                headers={"If-Match": etag},
            )
            assert_error_reply(response, 400, "VALIDATION_ERROR", "Some other validation error")
        finally:
            monkeypatch.setattr(wfunctions._functions_service, "create_function", original)


class TestAnUnexpectedFaultInAFunctionLifecycleRoute:
    """A fault below publish or detach answers the generic 500 with a request id, never its text."""

    @pytest.mark.parametrize(
        ("suffix", "service_call", "fault"),
        [
            pytest.param(
                "publish", "publish_local_function", ValueError(_INTERNAL_TEXT), id="publish"
            ),
            pytest.param(
                "detach", "detach_published_instance", ValueError(_INTERNAL_TEXT), id="detach"
            ),
            pytest.param(
                "publish",
                "publish_local_function",
                functions_service.SaveValidationError([{"message": _INTERNAL_TEXT}]),
                id="publish-save-refusal-the-service-did-not-turn-into-a-422",
            ),
        ],
    )
    def test_it_answers_the_generic_500(
        self,
        client: TestClient,
        monkeypatch: pytest.MonkeyPatch,
        suffix: str,
        service_call: str,
        fault: Exception,
    ) -> None:
        from wavecore.api.services.workbench import functions as wfunctions

        def _raise(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
            raise fault

        monkeypatch.setattr(wfunctions, service_call, _raise)
        response = client.post(
            "/tests/5b1f0c2e-7a3d-4c8e-9f10-2d3c4b5a6e7f/functions/" + suffix,
            json={"node_id": "fn-1"},
        )

        assert_internal_error(response, _INTERNAL_TEXT)


class TestDetachRouteServiceErrors:
    def test_validation_exception_returns_400(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from wavecore.api.exceptions import ValidationException
        from wavecore.api.services.workbench import functions as wfunctions

        test_id, _node_id = _seed_test_with_shared_function(client)
        etag = _get_test_etag(client, test_id)

        def _raise(_t, _n):
            raise ValidationException(
                message="Forced detach validation",
                details={"errors": [{"message": "Forced detach validation"}]},
            )

        monkeypatch.setattr(wfunctions, "detach_published_instance", _raise)
        response = client.post(
            f"/tests/{test_id}/functions/detach",
            json={"node_id": "fn-shared"},
            headers={"If-Match": etag},
        )
        assert_error_reply(response, 400, "VALIDATION_ERROR", "Forced detach validation")
        assert response.json()["error"]["details"] == {
            "errors": [{"message": "Forced detach validation"}]
        }

    def test_unprocessable_entity_returns_422(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from wavecore.api.exceptions import UnprocessableEntityException
        from wavecore.api.services.workbench import functions as wfunctions

        test_id, _node_id = _seed_test_with_shared_function(client)
        etag = _get_test_etag(client, test_id)

        def _raise(_t, _n):
            raise UnprocessableEntityException(
                message="Forced unprocessable",
                details={"errors": [{"message": "Forced unprocessable"}]},
            )

        monkeypatch.setattr(wfunctions, "detach_published_instance", _raise)
        response = client.post(
            f"/tests/{test_id}/functions/detach",
            json={"node_id": "fn-shared"},
            headers={"If-Match": etag},
        )
        assert_error_reply(response, 422, "UNPROCESSABLE_ENTITY", "Forced unprocessable")


pytestmark = pytest.mark.usefixtures("temp_storage_path")
