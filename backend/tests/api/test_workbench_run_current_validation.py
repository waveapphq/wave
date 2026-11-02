"""Run-current validates the SUPPLIED in-memory body (REQ-3.2.1.1).

When ``POST /workbench/run`` carries an in-memory ``workflow``, the run gate
validates that body (the on-disk validate-by-id path cannot see unsaved edits)
with the same strictness and messages as the current run gate:

    non-fatal errors -> ^Cannot run test: validation errors: .*$
    fatal errors     -> ^Cannot run test: fatal validation errors: .*$
    no exec block    -> ^Test must have at least one workflow block defined$

All three map to the existing ``ValidationException`` -> HTTP 400 (the same
status the current run gate already returns for these; 422 belongs to the
scratch-run draft path, not this gate).
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Generator
from typing import Any

import pytest
from fastapi.testclient import TestClient

VALIDATION_ERRORS_RE = re.compile(r"^Cannot run test: validation errors: .*$")
FATAL_ERRORS_RE = re.compile(r"^Cannot run test: fatal validation errors: .*$")
NO_BLOCK_RE = re.compile(r"^Test must have at least one workflow block defined$")

_VALID_ENVIRONMENT_ID = "10000000-0000-0000-0000-000000000051"


@pytest.fixture
def client() -> Generator[TestClient, None, None]:
    from wavecore.api.app import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def _register_plugins_and_clear_sessions() -> Generator[None, None, None]:
    from wavecore.api.services.workbench import _common as _wb_common
    from wavecore.controls.registry import _registry, register_all_core_controls
    from wavecore.core.plugin_registry import clear_registry, register_plugin
    from wavecore.plugins.log import LogPlugin

    _registry.clear()
    register_all_core_controls(_registry)
    clear_registry()
    register_plugin(LogPlugin())
    _wb_common._clear_sessions_sync()
    yield
    _wb_common._clear_sessions_sync()


def _seed_environment() -> str:
    from wavecore.api.services.environments import service as environment_service

    environment = {
        "id": _VALID_ENVIRONMENT_ID,
        "name": "Run-Current Validation Environment",
        "tags": [],
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
    }
    # Write the file too: a listing reconciles against the storage directory,
    # so a cache-only environment would not survive one.
    environment_service._save_environment(environment)
    environment_service._environments.setdefault(_VALID_ENVIRONMENT_ID, environment)
    return _VALID_ENVIRONMENT_ID


def _log_node(node_id: str, message: str) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "position": {"x": 0, "y": 0},
        "data": {
            "label": node_id,
            "elementType": "log",
            "nodeType": "plugin",
            "version": "1.0.0",
            "config": {
                "values": {"message": message, "level": "INFO"},
                "profileBindings": [],
                "outputBindings": {},
            },
            "displayName": node_id,
            "expressionFields": ["message"],
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    }


def _create_test_on_disk(
    client: TestClient,
    *,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]] | None = None,
    variables: dict[str, Any] | None = None,
) -> str:
    primary = nodes[0]["id"] if nodes else None
    payload = {
        "id": str(uuid.uuid4()),
        "name": "Validation Container",
        "version": "1.0.0",
        "description": "",
        "tags": [],
        "variables": variables or {},
        "workflow": {
            "nodes": nodes,
            "edges": (
                edges
                if edges is not None
                else ([{"source": "start-node", "target": primary}] if primary else [])
            ),
        },
    }
    resp = client.post("/tests", json=payload)
    assert resp.status_code in (200, 201), resp.text
    return resp.json()["data"]["id"]


def _save_test_directly(nodes: list[dict[str, Any]]) -> str:
    """Persist a Test straight to storage, bypassing the save-validation gate.

    POST /tests rejects an undeclared-variable body, so an intentionally-invalid
    on-disk Test must be written directly (mirrors the edit-mode route tests)."""
    from wavecore.api.services.tests import service as test_service

    primary = nodes[0]["id"]
    test_id = str(uuid.uuid4())
    test_service._save_test(
        {
            "id": test_id,
            "name": "Invalid Disk Container",
            "version": "1.0.0",
            "workflow": {
                "nodes": nodes,
                "edges": [{"source": "start-node", "target": primary}],
            },
            "variables": {},
        }
    )
    return test_id


def _first_error_message(body: dict[str, Any]) -> str:
    err = body.get("error") or {}
    details = err.get("details") or []
    if isinstance(details, list):
        for item in details:
            if isinstance(item, dict) and item.get("message"):
                return item["message"]
            if isinstance(item, str):
                return item
    return err.get("message", "")


class TestRunCurrentRejectsInvalidBody:
    """A structurally-invalid in-memory body is rejected with the run-gate message."""

    def test_undeclared_variable_in_body_returns_400(self, client: TestClient) -> None:
        # On-disk test is valid; the dirty in-memory body references an
        # undeclared variable (a non-fatal validation error).
        test_id = _create_test_on_disk(client, nodes=[_log_node("ok", "'ok'")])
        env_id = _seed_environment()
        resp = client.post(
            "/workbench/run",
            json={
                "test_id": test_id,
                "environment_id": env_id,
                "workflow": {
                    "nodes": [_log_node("bad", "ghost")],
                    "edges": [{"source": "start-node", "target": "bad"}],
                },
            },
        )
        assert resp.status_code == 400, resp.text
        assert VALIDATION_ERRORS_RE.match(_first_error_message(resp.json())), resp.text

    def test_cyclic_body_returns_400_fatal(self, client: TestClient) -> None:
        test_id = _create_test_on_disk(client, nodes=[_log_node("ok", "'ok'")])
        env_id = _seed_environment()
        resp = client.post(
            "/workbench/run",
            json={
                "test_id": test_id,
                "environment_id": env_id,
                "workflow": {
                    "nodes": [_log_node("a", "'a'"), _log_node("b", "'b'")],
                    "edges": [
                        {"source": "start-node", "target": "a"},
                        {"source": "a", "target": "b"},
                        {"source": "b", "target": "a"},
                    ],
                },
            },
        )
        assert resp.status_code == 400, resp.text
        assert FATAL_ERRORS_RE.match(_first_error_message(resp.json())), resp.text

    def test_empty_body_returns_400_no_block(self, client: TestClient) -> None:
        test_id = _create_test_on_disk(client, nodes=[_log_node("ok", "'ok'")])
        env_id = _seed_environment()
        resp = client.post(
            "/workbench/run",
            json={
                "test_id": test_id,
                "environment_id": env_id,
                "workflow": {"nodes": [], "edges": []},
            },
        )
        assert resp.status_code == 400, resp.text
        assert NO_BLOCK_RE.match(_first_error_message(resp.json())), resp.text


class TestRunCurrentValidatesSuppliedNotDisk:
    """Validation targets the supplied body, so a valid in-memory body runs even
    when the on-disk test is invalid."""

    def test_valid_in_memory_body_runs_despite_invalid_disk(self, client: TestClient) -> None:
        # On-disk test is invalid (undeclared variable), seeded directly so it
        # bypasses the save gate. A plain run-by-id would fail the run gate; the
        # dirty in-memory body is valid and must run.
        test_id = _save_test_directly(nodes=[_log_node("disk-bad", "ghost")])
        env_id = _seed_environment()
        resp = client.post(
            "/workbench/run",
            json={
                "test_id": test_id,
                "environment_id": env_id,
                "workflow": {
                    "nodes": [_log_node("mem-ok", "'ok'")],
                    "edges": [{"source": "start-node", "target": "mem-ok"}],
                },
            },
        )
        assert resp.status_code == 200, resp.text


_UNDECLARED_GHOST = (
    "Cannot run test: validation errors: "
    "Variable 'ghost' is used in 1 block(s) but not declared in variable manager"
)
_BOGUS_LIMIT_TYPE = (
    "Cannot run test: validation errors: Invalid variable type: 'bogus' "
    "(must be one of: array, boolean, float, integer, map, string, table)"
)
_NO_SINGLE_BLOCK = "block_draft requires single_node_id"
_TARGET_NOT_FOUND = "block not found in workflow"


def _draft_run(
    client: TestClient,
    test_id: str,
    nodes: list[dict[str, Any]] | None,
    *,
    edges: list[dict[str, Any]] | None = None,
    variables: dict[str, Any] | None = None,
    single_node_id: str | None = "target",
    block_draft: bool = True,
) -> Any:
    """POST the editor's Run of one block: Run Current with the block's draft in the body."""
    body: dict[str, Any] = {
        "test_id": test_id,
        "environment_id": _seed_environment(),
        "breakpoints": [],
        "debug_options": {"pause_on_first_block": False, "pause_on_errors": False},
        "block_draft": block_draft,
    }
    if single_node_id is not None:
        body["single_node_id"] = single_node_id
    if nodes is not None:
        body["workflow"] = {
            "nodes": nodes,
            "edges": (
                edges
                if edges is not None
                else [
                    {"source": source, "target": node["id"]}
                    for source, node in zip(
                        ["start-node", *(n["id"] for n in nodes)], nodes, strict=False
                    )
                ]
            ),
        }
    if variables is not None:
        body["variables"] = variables
    return client.post("/workbench/run", json=body)


def _with_data(node: dict[str, Any], **data: Any) -> dict[str, Any]:
    """The node with its data keys replaced."""
    return {**node, "data": {**node["data"], **data}}


def _with_bindings(node: dict[str, Any], bindings: dict[str, str]) -> dict[str, Any]:
    """The node with its output bindings replaced."""
    config = {**node["data"]["config"], "outputBindings": bindings}
    return _with_data(node, config=config)


_BOGUS_LIMIT = {"limit": {"type": "bogus", "value": "1"}}


class TestEditorDraftRunGate:
    """The editor's Run is refused only for what that block runs with (PYRUN-21)."""

    def test_a_finding_on_another_block_does_not_refuse_the_run(self, client: TestClient) -> None:
        test_id = _create_test_on_disk(client, nodes=[_log_node("target", "'ok'")])

        resp = _draft_run(
            client, test_id, [_log_node("target", "'ok'"), _log_node("other", "ghost")]
        )

        assert resp.status_code == 200, resp.text

    def test_a_finding_on_the_block_refuses_the_run(self, client: TestClient) -> None:
        test_id = _create_test_on_disk(client, nodes=[_log_node("target", "'ok'")])

        resp = _draft_run(
            client, test_id, [_log_node("target", "ghost"), _log_node("other", "'ok'")]
        )

        assert resp.status_code == 400, resp.text
        assert _first_error_message(resp.json()) == _UNDECLARED_GHOST

    def test_a_body_that_cannot_run_at_all_still_refuses_the_run(self, client: TestClient) -> None:
        test_id = _create_test_on_disk(client, nodes=[_log_node("target", "'ok'")])

        resp = _draft_run(
            client,
            test_id,
            [_log_node("target", "'a'"), _log_node("other", "'b'")],
            edges=[
                {"source": "start-node", "target": "target"},
                {"source": "target", "target": "other"},
                {"source": "other", "target": "target"},
            ],
        )

        assert resp.status_code == 400, resp.text
        assert FATAL_ERRORS_RE.match(_first_error_message(resp.json())), resp.text

    @pytest.mark.parametrize(
        "target",
        [
            _log_node("target", "limit + 1"),
            _with_data(
                _log_node("target", "run {{ limit }}"),
                expressionFields=[],
                templateFields=["message"],
            ),
            _with_bindings(_log_node("target", "'ok'"), {"message": "limit"}),
        ],
        ids=["expression", "template", "output binding"],
    )
    def test_a_finding_on_a_variable_the_block_uses_refuses_the_run(
        self, client: TestClient, target: dict[str, Any]
    ) -> None:
        test_id = _create_test_on_disk(client, nodes=[_log_node("target", "'ok'")])

        resp = _draft_run(client, test_id, [target], variables=_BOGUS_LIMIT)

        assert resp.status_code == 400, resp.text
        assert _first_error_message(resp.json()) == _BOGUS_LIMIT_TYPE

    def test_a_finding_on_a_variable_the_block_never_uses_does_not_refuse_the_run(
        self, client: TestClient
    ) -> None:
        test_id = _create_test_on_disk(client, nodes=[_log_node("target", "'ok'")])

        resp = _draft_run(
            client,
            test_id,
            [_with_data(_log_node("target", "'ok'"), templateFields=["nowhere.deep"])],
            variables=_BOGUS_LIMIT,
        )

        assert resp.status_code == 200, resp.text

    def test_the_saved_test_is_gated_the_same_way_when_no_body_is_sent(
        self, client: TestClient
    ) -> None:
        test_id = _save_test_directly(
            nodes=[_log_node("target", "'ok'"), _log_node("other", "ghost")]
        )

        resp = _draft_run(client, test_id, None)

        assert resp.status_code == 200, resp.text

    def test_a_block_missing_from_the_body_is_named_as_not_found(self, client: TestClient) -> None:
        test_id = _create_test_on_disk(client, nodes=[_log_node("target", "'ok'")])

        resp = _draft_run(client, test_id, [_log_node("other", "ghost")], single_node_id="nowhere")

        assert resp.status_code == 404, resp.text
        assert _first_error_message(resp.json()) == _TARGET_NOT_FOUND

    def test_block_draft_without_a_single_block_is_refused(self, client: TestClient) -> None:
        test_id = _create_test_on_disk(client, nodes=[_log_node("target", "'ok'")])

        resp = _draft_run(client, test_id, [_log_node("target", "'ok'")], single_node_id=None)

        assert resp.status_code == 400, resp.text
        assert _first_error_message(resp.json()) == _NO_SINGLE_BLOCK

    def test_run_current_without_block_draft_is_still_refused_for_another_block(
        self, client: TestClient
    ) -> None:
        test_id = _create_test_on_disk(client, nodes=[_log_node("target", "'ok'")])

        resp = _draft_run(
            client,
            test_id,
            [_log_node("target", "'ok'"), _log_node("other", "ghost")],
            block_draft=False,
        )

        assert resp.status_code == 400, resp.text
        assert _first_error_message(resp.json()) == _UNDECLARED_GHOST


pytestmark = pytest.mark.usefixtures("temp_storage_path")
