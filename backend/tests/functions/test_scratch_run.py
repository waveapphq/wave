"""Standalone Function run/debug from the library View (REQ-3.2.1.1, REQ-3.2.1.2).

The library View opens a Published Function with no parent Test and can Run /
Debug it in isolation. The backend stages an ephemeral "scratch" Test wrapping
the single Function instance (a Shared ref for a published version, a
local-embedded body for an edit-mode draft) and runs it through the EXISTING
scoped-function run path, so:

- inputs are materialized from their Current values, else their declared
  defaults (no caller Test to inherit from), and the scoped-run advisory surfaces;
- the response is the same session shape as ``POST /workbench/run``;
- the scratch Test is hidden from ``GET /tests`` and is swept when the View
  session is cleared.

Endpoints:
- POST   /functions/{id}/run          -> 200 session | 400 | 404 | 422
- DELETE /functions/view-session/{id} -> 200 (best-effort; unknown id is a no-op)

Exact error strings (anchored, asserted with re.match):
    ^Function '<id>' not found$
    ^Function '<id>' version '<v>' not found$
    ^'version' is required$
    ^Function draft has <n> validation error(s)$
    ^Variable '<name>' is not declared by this Function$
"""

from __future__ import annotations

import asyncio
import copy
import re
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient

from .conftest import make_function_payload

# Anchored error strings.
FN_NOT_FOUND_RE = re.compile(r"^Function '.+' not found$")
VERSION_NOT_FOUND_RE = re.compile(r"^Function '.+' version '.+' not found$")
VERSION_REQUIRED_RE = re.compile(r"^'version' is required$")
DRAFT_INVALID_RE = re.compile(r"^Function draft has \d+ validation error\(s\)$")

# A valid-UUID environment; the shared conftest seeds a non-UUID env that the
# route's validate_uuid would reject (mirrors test_workbench_function_runs.py).
_VALID_ENVIRONMENT_ID = "10000000-0000-0000-0000-000000000099"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def client() -> Any:
    """Context-managed TestClient so background run tasks finish on the same loop.

    Overrides the plain (non-context-managed) ``client`` fixture from
    tests/functions/conftest.py - the scratch run spawns an asyncio task that
    must survive past the request, exactly like the workbench run endpoint.
    """
    from wavecore.api.app import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def _clear_workbench_sessions() -> Any:
    """Reset workbench session state around each test.

    The scratch run guards against a pre-existing active session; without a
    clean slate a prior test's session makes the next run 409. (The Log plugin
    + core controls are already registered by the conftest autouse fixture.)
    """
    from wavecore.api.services.workbench import _common as _wb_common

    _wb_common._clear_sessions_sync()
    yield
    _wb_common._clear_sessions_sync()


# ---------------------------------------------------------------------------
# Builders
# ---------------------------------------------------------------------------


def _log_body(message: str = "'standalone'") -> dict[str, Any]:
    """A one-node Function body that logs a literal (no I/O bindings needed)."""
    return {
        "nodes": [
            {
                "id": "inner-log",
                "type": "workflowNode",
                "data": {
                    "label": "inner",
                    "elementType": "log",
                    "nodeType": "plugin",
                    "version": "1.0.0",
                    "config": {
                        "values": {"message": message, "level": "INFO"},
                        "profileBindings": [],
                        "outputBindings": {},
                    },
                    "displayName": "inner",
                    "expressionFields": ["message"],
                    "templateFields": [],
                    "variableExpressionKeys": [],
                },
            }
        ],
        "edges": [{"source": "start-node", "target": "inner-log"}],
    }


def _create_published_function(
    client: TestClient,
    *,
    name: str = "standalone_fn",
) -> str:
    """Create a Published Function (v1.0.0) with one optional, defaulted input and
    a one-Log body. Returns its function id."""
    payload = make_function_payload(
        name=name,
        inputs=[{"name": "x", "type": "string", "required": False, "default": "hi"}],
        outputs=[],
        workflow=_log_body(),
    )
    resp = client.post("/functions", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()["data"]["id"]


def _draft_definition(name: str = "standalone_fn", message: str = "'draft-body'") -> dict[str, Any]:
    """An edit-mode draft body for the draft-run path."""
    return {
        "name": name,
        "description": "draft under edit",
        "tags": [],
        "inputs": [{"name": "x", "type": "string", "required": False, "default": "hi"}],
        "outputs": [],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": _log_body(message),
    }


def _all_error_messages(body: dict[str, Any]) -> list[str]:
    err = body.get("error") or {}
    messages: list[str] = []
    if err.get("message"):
        messages.append(err["message"])
    details = err.get("details") or []
    if isinstance(details, list):
        for item in details:
            if isinstance(item, str):
                messages.append(item)
            elif isinstance(item, dict) and item.get("message"):
                messages.append(item["message"])
    return messages


def _drain_session(client: TestClient, session_id: str) -> None:
    from wavecore.api.services.workbench._common import _active_tasks

    task = _active_tasks.get(session_id)
    if task is not None and not task.done():
        client.portal.call(lambda: asyncio.wait_for(task, timeout=10.0))


# ---------------------------------------------------------------------------
# Run a published version
# ---------------------------------------------------------------------------


class TestStandaloneRunPublishedVersion:
    """POST /functions/{id}/run with a published version returns a run session."""

    def test_returns_session_with_topic(self, client: TestClient) -> None:
        fn_id = _create_published_function(client)
        resp = client.post(
            f"/functions/{fn_id}/run",
            json={"version": "1.0.0", "environment_id": _VALID_ENVIRONMENT_ID},
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()["data"]
        assert data["session_id"]
        assert data["websocket_topic"] == f"workbench:{data['session_id']}"

    def test_run_reaches_terminal_state(self, client: TestClient) -> None:
        fn_id = _create_published_function(client)
        resp = client.post(
            f"/functions/{fn_id}/run",
            json={"version": "1.0.0", "environment_id": _VALID_ENVIRONMENT_ID},
        )
        assert resp.status_code == 200, resp.text
        session_id = resp.json()["data"]["session_id"]
        _drain_session(client, session_id)

        status_resp = client.get(f"/workbench/{session_id}/status")
        assert status_resp.status_code == 200, status_resp.text
        assert status_resp.json()["data"]["status"] in ("passed", "failed")

    def test_declared_defaults_surface_advisory(self, client: TestClient) -> None:
        """No caller Test means inputs come from declared defaults; the scoped-run
        advisory about absent prior state is surfaced."""
        fn_id = _create_published_function(client)
        resp = client.post(
            f"/functions/{fn_id}/run",
            json={"version": "1.0.0", "environment_id": _VALID_ENVIRONMENT_ID},
        )
        assert resp.status_code == 200, resp.text
        warnings = resp.json()["data"].get("warnings") or []
        advisory_present = any(
            "default" in str(w).lower()
            or "prior" in str(w).lower()
            or (isinstance(w, dict) and "default" in (w.get("message", "").lower()))
            for w in warnings
        )
        assert advisory_present, f"expected a declared-defaults advisory; got {warnings!r}"

    def test_validates_and_reuses_supplied_session_id(self, client: TestClient) -> None:
        """A caller-supplied session_id is UUID-validated and reused for the re-run."""
        fn_id = _create_published_function(client)
        first = client.post(
            f"/functions/{fn_id}/run",
            json={"version": "1.0.0", "environment_id": _VALID_ENVIRONMENT_ID},
        )
        assert first.status_code == 200, first.text
        session_id = first.json()["data"]["session_id"]
        _drain_session(client, session_id)

        second = client.post(
            f"/functions/{fn_id}/run",
            json={
                "version": "1.0.0",
                "environment_id": _VALID_ENVIRONMENT_ID,
                "session_id": session_id,
            },
        )
        assert second.status_code == 200, second.text
        assert second.json()["data"]["session_id"] == session_id


# ---------------------------------------------------------------------------
# Run an edit-mode draft body
# ---------------------------------------------------------------------------


class TestStandaloneRunDraft:
    """POST /functions/{id}/run with a draft body runs the unpublished body."""

    def test_draft_returns_session(self, client: TestClient) -> None:
        fn_id = _create_published_function(client)
        resp = client.post(
            f"/functions/{fn_id}/run",
            json={
                "version": "1.0.0",
                "draft": _draft_definition(),
                "environment_id": _VALID_ENVIRONMENT_ID,
            },
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["data"]["session_id"]

    def test_draft_run_reaches_terminal_state(self, client: TestClient) -> None:
        fn_id = _create_published_function(client)
        resp = client.post(
            f"/functions/{fn_id}/run",
            json={
                "version": "1.0.0",
                "draft": _draft_definition(),
                "environment_id": _VALID_ENVIRONMENT_ID,
            },
        )
        assert resp.status_code == 200, resp.text
        session_id = resp.json()["data"]["session_id"]
        _drain_session(client, session_id)
        status_resp = client.get(f"/workbench/{session_id}/status")
        assert status_resp.json()["data"]["status"] in ("passed", "failed")


# ---------------------------------------------------------------------------
# Debug payload accepted
# ---------------------------------------------------------------------------


class TestStandaloneDebug:
    """POST /functions/{id}/run accepts a debug payload (REQ-3.2.1.2)."""

    def test_debug_payload_returns_session(self, client: TestClient) -> None:
        fn_id = _create_published_function(client)
        resp = client.post(
            f"/functions/{fn_id}/run",
            json={
                "version": "1.0.0",
                "environment_id": _VALID_ENVIRONMENT_ID,
                "debug": {"breakpoints": []},
            },
        )
        assert resp.status_code == 200, resp.text
        session_id = resp.json()["data"]["session_id"]
        _drain_session(client, session_id)


# ---------------------------------------------------------------------------
# Every run names its version; a draft is made from that version
# ---------------------------------------------------------------------------


class TestStandaloneRunVersionRequired:
    """A run names the version it runs, or the version its draft was made from."""

    def test_neither_version_nor_draft_returns_422(self, client: TestClient) -> None:
        fn_id = _create_published_function(client)
        resp = client.post(
            f"/functions/{fn_id}/run",
            json={"environment_id": _VALID_ENVIRONMENT_ID},
        )
        assert resp.status_code == 422, resp.text
        assert any(VERSION_REQUIRED_RE.match(m) for m in _all_error_messages(resp.json()))

    def test_a_draft_without_its_version_returns_422(self, client: TestClient) -> None:
        fn_id = _create_published_function(client)
        resp = client.post(
            f"/functions/{fn_id}/run",
            json={"draft": _draft_definition(), "environment_id": _VALID_ENVIRONMENT_ID},
        )
        assert resp.status_code == 422, resp.text
        assert any(VERSION_REQUIRED_RE.match(m) for m in _all_error_messages(resp.json()))

    def test_a_draft_of_an_unknown_version_returns_404(self, client: TestClient) -> None:
        fn_id = _create_published_function(client)
        resp = client.post(
            f"/functions/{fn_id}/run",
            json={
                "version": "9.9.9",
                "draft": _draft_definition(),
                "environment_id": _VALID_ENVIRONMENT_ID,
            },
        )
        assert resp.status_code == 404, resp.text
        assert any(VERSION_NOT_FOUND_RE.match(m) for m in _all_error_messages(resp.json()))


# ---------------------------------------------------------------------------
# Not-found paths
# ---------------------------------------------------------------------------


class TestStandaloneRunNotFound:
    def test_unknown_function_returns_404(self, client: TestClient) -> None:
        missing = str(uuid.uuid4())
        resp = client.post(
            f"/functions/{missing}/run",
            json={"version": "1.0.0", "environment_id": _VALID_ENVIRONMENT_ID},
        )
        assert resp.status_code == 404, resp.text
        assert any(FN_NOT_FOUND_RE.match(m) for m in _all_error_messages(resp.json()))

    def test_unknown_version_returns_404(self, client: TestClient) -> None:
        fn_id = _create_published_function(client)
        resp = client.post(
            f"/functions/{fn_id}/run",
            json={"version": "9.9.9", "environment_id": _VALID_ENVIRONMENT_ID},
        )
        assert resp.status_code == 404, resp.text
        messages = _all_error_messages(resp.json())
        assert any(VERSION_NOT_FOUND_RE.match(m) for m in messages), messages


# ---------------------------------------------------------------------------
# Invalid draft
# ---------------------------------------------------------------------------


class TestStandaloneRunInvalidDraft:
    """A structurally invalid draft is rejected before any run is staged."""

    def test_invalid_draft_returns_422(self, client: TestClient) -> None:
        fn_id = _create_published_function(client)
        # Empty name + a malformed input -> at least one structural error.
        bad_draft = {
            "name": "",
            "description": "",
            "tags": [],
            "inputs": [{"name": "", "type": "string", "required": False}],
            "outputs": [],
            "dependencies": {"functions": [], "plugins": []},
            "workflow": _log_body(),
        }
        resp = client.post(
            f"/functions/{fn_id}/run",
            json={"version": "1.0.0", "draft": bad_draft, "environment_id": _VALID_ENVIRONMENT_ID},
        )
        assert resp.status_code == 422, resp.text
        assert any(DRAFT_INVALID_RE.match(m) for m in _all_error_messages(resp.json()))

    def test_a_draft_the_save_rules_refuse_is_refused_before_the_run(
        self, client: TestClient
    ) -> None:
        from wavecore.api.services.workbench._common import _workbench_sessions

        fn_id = _create_published_function(client)
        draft = _draft_definition()
        draft["workflow"]["nodes"][0]["data"]["config"]["values"] = {"level": "INFO"}

        resp = client.post(
            f"/functions/{fn_id}/run",
            json={"version": "1.0.0", "draft": draft, "environment_id": _VALID_ENVIRONMENT_ID},
        )

        assert resp.status_code == 422, resp.text
        error = resp.json()["error"]
        assert re.match(r"^Function draft has 1 validation error\(s\)$", error["message"])
        assert [(d["code"], d["message"]) for d in error["details"]["errors"]] == [
            ("REQUIRED_PARAM_MISSING", "Required parameter 'message' is missing")
        ]
        assert _workbench_sessions == {}


# ---------------------------------------------------------------------------
# A run uses a secret's value
# ---------------------------------------------------------------------------

_SECRET_VALUE = "plain-secret-canary-7"


def _secret_local_definition() -> dict[str, Any]:
    """A Function whose secret local is compared with its value by the body's Log."""
    return _alone_definition(
        name="secret_local_fn",
        variables=[{"name": "token", "type": "string", "value": _SECRET_VALUE, "secret": True}],
        message=f"f'match={{token == \"{_SECRET_VALUE}\"}}'",
    )


def _browser_draft(client: TestClient, fn_id: str) -> dict[str, Any]:
    """The draft the library View builds from the version it read (secrets masked)."""
    read = client.get(f"/functions/{fn_id}/versions/1.0.0")
    assert read.status_code == 200, read.text
    definition = read.json()["data"]["definition"]
    keys = ("name", "description", "tags", "inputs", "outputs", "dependencies", "workflow")
    return {**{key: definition[key] for key in keys}, "variables": definition["variables"]}


class TestStandaloneRunSecretValues:
    """A run alone holds a secret's value, never its sealed form or the masked placeholder."""

    def test_a_published_version_runs_with_the_secret_value(self, client: TestClient) -> None:
        session = _finished_session(client, _run_alone(client, _secret_local_definition()))

        assert session["status"] == "passed", session.get("error")
        assert "match=True" in _run_messages(session["session_id"])

    def test_a_draft_runs_with_the_secret_value_of_its_version(self, client: TestClient) -> None:
        fn_id = _publish(client, _secret_local_definition())
        draft = _browser_draft(client, fn_id)
        assert draft["variables"][0]["value"] == "********"

        resp = client.post(
            f"/functions/{fn_id}/run",
            json={"version": "1.0.0", "draft": draft, "environment_id": _VALID_ENVIRONMENT_ID},
        )
        session = _finished_session(client, resp)

        assert session["status"] == "passed", session.get("error")
        assert "match=True" in _run_messages(session["session_id"])


# ---------------------------------------------------------------------------
# Ephemeral scratch lifecycle
# ---------------------------------------------------------------------------


class TestScratchTestIsEphemeral:
    """The staged scratch Test is hidden from the Tests list and is swept."""

    def test_scratch_absent_from_list_tests(self, client: TestClient) -> None:
        from wavecore.api.services.tests import service as test_service

        fn_id = _create_published_function(client)
        assert test_service.list_tests()["total"] == 0

        resp = client.post(
            f"/functions/{fn_id}/run",
            json={"version": "1.0.0", "environment_id": _VALID_ENVIRONMENT_ID},
        )
        assert resp.status_code == 200, resp.text
        _drain_session(client, resp.json()["data"]["session_id"])

        # The scratch wrapper never surfaces in the user-visible Tests list.
        assert test_service.list_tests()["total"] == 0

    def test_sweep_view_session_returns_200(self, client: TestClient) -> None:
        fn_id = _create_published_function(client)
        resp = client.post(
            f"/functions/{fn_id}/run",
            json={"version": "1.0.0", "environment_id": _VALID_ENVIRONMENT_ID},
        )
        assert resp.status_code == 200, resp.text
        session_id = resp.json()["data"]["session_id"]
        _drain_session(client, session_id)

        sweep = client.delete(f"/functions/view-session/{session_id}")
        assert sweep.status_code == 200, sweep.text
        assert sweep.json()["success"] is True

    def test_sweep_unknown_session_is_idempotent(self, client: TestClient) -> None:
        sweep = client.delete(f"/functions/view-session/{uuid.uuid4()}")
        assert sweep.status_code == 200, sweep.text


# ---------------------------------------------------------------------------
# Current values of a run alone (FNCFG-8, REQ-3.1.2.10)
# ---------------------------------------------------------------------------

INPUT_IS_NULL_RE = re.compile(r"^'who' is null$")


def _who_tries_definition(name: str = "greet_alone") -> dict[str, Any]:
    """A Function with a Required string and a Required integer input, logged by its body."""
    return {
        "name": name,
        "description": "",
        "tags": [],
        "inputs": [
            {"name": "who", "type": "string", "required": True},
            {"name": "tries", "type": "integer", "required": True},
        ],
        "outputs": [],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": _log_body("f'who={who} tries={tries}'"),
    }


def _publish(client: TestClient, definition: dict[str, Any]) -> str:
    resp = client.post("/functions", json=make_function_payload(**definition))
    assert resp.status_code == 201, resp.text
    return resp.json()["data"]["id"]


def _run_messages(session_id: str) -> list[str]:
    from wavecore.api.services import log_streaming_service

    return [
        entry.get("message", "")
        for entry in log_streaming_service.get_logs(session_id)
        if isinstance(entry, dict)
    ]


def _session(session_id: str) -> dict[str, Any]:
    from wavecore.api.services.workbench._common import _workbench_sessions

    return _workbench_sessions[session_id]


class TestStandaloneRunCurrentValues:
    """Each input's Current value, sent as ``variables``, seeds the run alone."""

    def test_each_input_of_a_published_version_takes_its_current_value(
        self, client: TestClient
    ) -> None:
        fn_id = _publish(client, _who_tries_definition())
        resp = client.post(
            f"/functions/{fn_id}/run",
            json={
                "version": "1.0.0",
                "environment_id": _VALID_ENVIRONMENT_ID,
                "variables": {
                    "who": {"type": "string", "value": "ann"},
                    "tries": {"type": "integer", "value": 3},
                },
            },
        )
        assert resp.status_code == 200, resp.text
        session_id = resp.json()["data"]["session_id"]
        _drain_session(client, session_id)

        assert _session(session_id)["status"] == "passed", _session(session_id).get("error")
        assert "who=ann tries=3" in _run_messages(session_id)

    def test_each_input_of_a_draft_takes_its_current_value(self, client: TestClient) -> None:
        fn_id = _publish(client, _who_tries_definition())
        resp = client.post(
            f"/functions/{fn_id}/run",
            json={
                "version": "1.0.0",
                "draft": _who_tries_definition(),
                "environment_id": _VALID_ENVIRONMENT_ID,
                "variables": {
                    "who": {"type": "string", "value": "bob"},
                    "tries": {"type": "integer", "value": 7},
                },
            },
        )
        assert resp.status_code == 200, resp.text
        session_id = resp.json()["data"]["session_id"]
        _drain_session(client, session_id)

        assert _session(session_id)["status"] == "passed", _session(session_id).get("error")
        assert "who=bob tries=7" in _run_messages(session_id)

    def test_the_current_value_wins_over_the_input_default(self, client: TestClient) -> None:
        fn_id = _publish(
            client,
            {
                "name": "greet_default",
                "inputs": [{"name": "who", "type": "string", "required": False, "default": "hi"}],
                "workflow": _log_body("f'who={who}'"),
            },
        )
        resp = client.post(
            f"/functions/{fn_id}/run",
            json={
                "version": "1.0.0",
                "environment_id": _VALID_ENVIRONMENT_ID,
                "variables": {"who": {"type": "string", "value": "ann"}},
            },
        )
        assert resp.status_code == 200, resp.text
        session_id = resp.json()["data"]["session_id"]
        _drain_session(client, session_id)

        messages = _run_messages(session_id)
        assert "who=ann" in messages, messages
        assert "who=hi" not in messages, messages

    def test_a_required_input_given_no_value_stops_the_run_before_the_first_block(
        self, client: TestClient
    ) -> None:
        fn_id = _publish(client, _who_tries_definition())
        resp = client.post(
            f"/functions/{fn_id}/run",
            json={"version": "1.0.0", "environment_id": _VALID_ENVIRONMENT_ID},
        )
        assert resp.status_code == 200, resp.text
        session_id = resp.json()["data"]["session_id"]
        _drain_session(client, session_id)

        session = _session(session_id)
        assert session["status"] == "failed"
        assert INPUT_IS_NULL_RE.match(session.get("error") or ""), session.get("error")
        messages = _run_messages(session_id)
        assert not any(m.startswith("who=") for m in messages), messages


# ---------------------------------------------------------------------------
# A run alone: Required defaults, staged locals and outputs, enum inputs
# (REQ-3.1.2.10, REQ-3.1.2.11, REQ-3.2.1.6)
# ---------------------------------------------------------------------------

MUST_IS_NULL_RE = re.compile(r"^'must' is null$")


def _alone_definition(
    *,
    inputs: list[dict[str, Any]] | None = None,
    outputs: list[dict[str, Any]] | None = None,
    variables: list[dict[str, Any]] | None = None,
    message: str,
    name: str = "run_alone_fn",
) -> dict[str, Any]:
    """A Function whose one-Log body logs ``message``."""
    return {
        "name": name,
        "description": "",
        "tags": [],
        "inputs": inputs or [],
        "outputs": outputs or [],
        "variables": variables or [],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": _log_body(message),
    }


def _run_alone(
    client: TestClient,
    definition: dict[str, Any],
    *,
    source: str = "version",
    variables: dict[str, Any] | None = None,
    function_variables: list[dict[str, Any]] | None = None,
    published: dict[str, Any] | None = None,
) -> Any:
    """Publish ``published`` (else ``definition``) and run ``definition`` alone from that
    version or as a draft over it."""
    fn_id = _publish(client, published or definition)
    body: dict[str, Any] = {"environment_id": _VALID_ENVIRONMENT_ID}
    body["version"] = "1.0.0"
    if source == "draft":
        body["draft"] = definition
    if variables is not None:
        body["variables"] = variables
    if function_variables is not None:
        body["function_variables"] = function_variables
    return client.post(f"/functions/{fn_id}/run", json=body)


def _finished_session(client: TestClient, resp: Any) -> dict[str, Any]:
    assert resp.status_code == 200, resp.text
    session_id = resp.json()["data"]["session_id"]
    _drain_session(client, session_id)
    return _session(session_id)


def _local_function_block(node_id: str, definition: dict[str, Any]) -> dict[str, Any]:
    """A Function Block running a Local Function inside a Function body."""
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": node_id,
            "elementType": "function",
            "nodeType": "function",
            "version": "1.0.0",
            "functionLifecycle": "local",
            "localDefinition": definition,
            "config": {"values": {}, "profileBindings": [], "outputBindings": {}},
            "displayName": node_id,
        },
    }


def _outer_with_block(inner: dict[str, Any]) -> dict[str, Any]:
    """A Function whose body is one Function Block ``inner-fn`` running ``inner``."""
    outer = _alone_definition(name="outer_fn", message="'unused'")
    outer["workflow"] = {
        "nodes": [_local_function_block("inner-fn", inner)],
        "edges": [{"source": "start-node", "target": "inner-fn"}],
    }
    return outer


SOURCES = [pytest.param("version", id="published-version"), pytest.param("draft", id="draft")]


class TestStandaloneRunRequiredDefault:
    """A run alone fills a Required input with no Current value from its default."""

    @pytest.mark.parametrize("source", SOURCES)
    def test_a_required_input_with_a_default_and_no_current_value_takes_its_default(
        self, client: TestClient, source: str
    ) -> None:
        definition = _alone_definition(
            inputs=[{"name": "must", "type": "string", "required": True, "default": "d"}],
            message="f'must={must}'",
        )

        session = _finished_session(client, _run_alone(client, definition, source=source))

        assert session["status"] == "passed", session.get("error")
        assert "must=d" in _run_messages(session["session_id"])

    def test_a_current_value_wins_over_the_required_default(self, client: TestClient) -> None:
        definition = _alone_definition(
            inputs=[{"name": "must", "type": "string", "required": True, "default": "d"}],
            message="f'must={must}'",
        )

        session = _finished_session(
            client,
            _run_alone(client, definition, variables={"must": {"type": "string", "value": "cur"}}),
        )

        messages = _run_messages(session["session_id"])
        assert "must=cur" in messages, messages
        assert "must=d" not in messages, messages

    def test_with_neither_default_nor_current_value_the_run_stops_naming_the_input(
        self, client: TestClient
    ) -> None:
        definition = _alone_definition(
            inputs=[
                {"name": "must", "type": "string", "required": True},
                {"name": "other", "type": "string", "required": False, "default": "o"},
            ],
            message="f'must={must}'",
        )

        session = _finished_session(client, _run_alone(client, definition))

        assert session["status"] == "failed"
        assert MUST_IS_NULL_RE.match(session.get("error") or ""), session.get("error")
        messages = _run_messages(session["session_id"])
        assert not any(m.startswith("must=") for m in messages), messages

    def test_a_nested_function_block_never_fills_a_required_input_from_its_default(
        self, client: TestClient
    ) -> None:
        inner = _alone_definition(
            name="inner_fn",
            inputs=[{"name": "inner", "type": "string", "required": True, "default": "inner-d"}],
            message="f'inner={inner}'",
        )
        outer = _alone_definition(
            name="outer_fn",
            inputs=[{"name": "must", "type": "string", "required": True, "default": "d"}],
            message="f'must={must}'",
        )
        published = copy.deepcopy(outer)
        outer["workflow"]["nodes"].append(_local_function_block("inner-fn", inner))
        outer["workflow"]["edges"].append({"source": "inner-log", "target": "inner-fn"})

        # A saved version must give the Required input, so the unbound Block runs as a draft.
        session = _finished_session(
            client, _run_alone(client, outer, source="draft", published=published)
        )

        assert session["status"] == "failed"
        assert re.match(r"^'inner' is null$", session.get("error") or ""), session.get("error")
        messages = _run_messages(session["session_id"])
        assert "must=d" in messages, messages
        assert not any(m.startswith("inner=") for m in messages), messages


class TestStandaloneRunStagedLocalsAndOutputs:
    """The Function's own staged locals and outputs, sent as ``variables``, layer over their
    Initial values when the run starts; nested instances read ``function_variables``."""

    def test_staged_values_of_a_local_and_an_output_are_used(self, client: TestClient) -> None:
        definition = _alone_definition(
            outputs=[{"name": "out", "type": "string", "default": "initial-out"}],
            variables=[{"name": "note", "type": "string", "value": "initial-note"}],
            message="f'note={note} out={out}'",
        )

        session = _finished_session(
            client,
            _run_alone(
                client,
                definition,
                variables={
                    "note": {"type": "string", "value": "staged-note"},
                    "out": {"type": "string", "value": "staged-out"},
                },
            ),
        )

        assert session["status"] == "passed", session.get("error")
        assert "note=staged-note out=staged-out" in _run_messages(session["session_id"])
        assert session["scoped_result"]["outputs"] == {"out": "staged-out"}

    def test_a_staged_expression_of_a_local_is_evaluated_in_the_run(
        self, client: TestClient
    ) -> None:
        definition = _alone_definition(
            inputs=[{"name": "tries", "type": "integer", "required": False, "default": 1}],
            variables=[{"name": "doubled", "type": "integer", "value": 0}],
            message="f'doubled={doubled}'",
        )

        session = _finished_session(
            client,
            _run_alone(
                client,
                definition,
                variables={
                    "tries": {"type": "integer", "value": 3},
                    "doubled": {"type": "integer", "isExpression": True, "value": "tries * 2"},
                },
            ),
        )

        assert session["status"] == "passed", session.get("error")
        assert "doubled=6" in _run_messages(session["session_id"])

    def test_a_staged_integer_given_as_exact_text_runs_as_an_integer(
        self, client: TestClient
    ) -> None:
        definition = _alone_definition(
            inputs=[{"name": "big", "type": "integer", "required": False, "default": 0}],
            message="f'next={big + 1}'",
        )

        session = _finished_session(
            client,
            _run_alone(
                client,
                definition,
                variables={"big": {"type": "integer", "value": "9007199254740993"}},
            ),
        )

        assert session["status"] == "passed", session.get("error")
        assert "next=9007199254740994" in _run_messages(session["session_id"])

    def test_a_staged_literal_wins_over_a_computed_initial_value(self, client: TestClient) -> None:
        definition = _alone_definition(
            inputs=[{"name": "tries", "type": "integer", "required": False, "default": 1}],
            variables=[
                {"name": "doubled", "type": "integer", "isExpression": True, "value": "tries * 2"}
            ],
            message="f'doubled={doubled}'",
        )

        session = _finished_session(
            client,
            _run_alone(client, definition, variables={"doubled": {"type": "integer", "value": 5}}),
        )

        assert session["status"] == "passed", session.get("error")
        messages = _run_messages(session["session_id"])
        assert "doubled=5" in messages, messages
        assert "doubled=2" not in messages, messages

    def test_a_nested_instance_starts_from_its_staged_local(self, client: TestClient) -> None:
        inner = _alone_definition(
            name="inner_fn",
            variables=[{"name": "note", "type": "string", "value": "initial-inner"}],
            message="f'inner note={note}'",
        )

        session = _finished_session(
            client,
            _run_alone(
                client,
                _outer_with_block(inner),
                function_variables=[
                    {
                        "function_path": ["inner-fn"],
                        "variables": {"note": {"type": "string", "value": "staged-inner"}},
                    }
                ],
            ),
        )

        assert session["status"] == "passed", session.get("error")
        messages = _run_messages(session["session_id"])
        assert "inner note=staged-inner" in messages, messages
        assert "inner note=initial-inner" not in messages, messages

    def test_an_entry_for_a_path_the_run_never_enters_is_ignored(self, client: TestClient) -> None:
        inner = _alone_definition(
            name="inner_fn",
            variables=[{"name": "note", "type": "string", "value": "initial-inner"}],
            message="f'inner note={note}'",
        )

        session = _finished_session(
            client,
            _run_alone(
                client,
                _outer_with_block(inner),
                function_variables=[
                    {
                        "function_path": ["fn-9"],
                        "variables": {"x": {"type": "string", "value": "v"}},
                    },
                    {
                        "function_path": ["inner-fn"],
                        "variables": {"note": {"type": "string", "value": "staged-inner"}},
                    },
                ],
            ),
        )

        assert session["status"] == "passed", session.get("error")
        assert "inner note=staged-inner" in _run_messages(session["session_id"])


def _outer_binding_inner(bindings: dict[str, str], *, required: bool = False) -> dict[str, Any]:
    """``_outer_with_block`` whose Block holds the expressions ``bindings`` for the inner
    input ``who``."""
    inner = _alone_definition(
        name="inner_fn",
        inputs=[{"name": "who", "type": "string", "required": required}],
        variables=[{"name": "note", "type": "string", "value": "initial-note"}],
        message="f'inner who={who} note={note}'",
    )
    outer = _outer_with_block(inner)
    block = outer["workflow"]["nodes"][0]["data"]
    block["config"]["values"] = dict(bindings)
    block["expressionFields"] = list(bindings)
    return outer


_STAGED_INNER = [
    {
        "function_path": ["inner-fn"],
        "variables": {
            "who": {"type": "string", "value": "staged-who"},
            "note": {"type": "string", "value": "staged-note"},
        },
    }
]


class TestStandaloneRunNestedBlockGivesItsInputs:
    """A Function Block inside the Function gives every input of the instance it starts; a
    staged input value of that instance is not used, its staged local is (REQ-3.1.2.10)."""

    @pytest.mark.parametrize(
        ("bindings", "given"),
        [
            pytest.param({"who": "'bound'"}, "bound", id="bound"),
            pytest.param({}, "None", id="unbound"),
        ],
    )
    def test_the_blocks_value_wins_over_a_staged_input_value(
        self, client: TestClient, bindings: dict[str, str], given: str
    ) -> None:
        session = _finished_session(
            client,
            _run_alone(client, _outer_binding_inner(bindings), function_variables=_STAGED_INNER),
        )

        assert session["status"] == "passed", session.get("error")
        messages = _run_messages(session["session_id"])
        assert f"inner who={given} note=staged-note" in messages, messages
        assert not any("who=staged-who" in m for m in messages), messages

    def test_a_staged_value_never_fills_an_unbound_required_input(self, client: TestClient) -> None:
        # A saved version must give the Required input, so the unbound Block runs as a draft.
        session = _finished_session(
            client,
            _run_alone(
                client,
                _outer_binding_inner({}, required=True),
                source="draft",
                function_variables=_STAGED_INNER,
                published=_outer_binding_inner({"who": "'bound'"}, required=True),
            ),
        )

        assert session["status"] == "failed"
        assert INPUT_IS_NULL_RE.match(session.get("error") or ""), session.get("error")
        messages = _run_messages(session["session_id"])
        assert not any(m.startswith("inner who=") for m in messages), messages

    def test_a_staged_entry_marked_secret_is_masked_in_the_run(self, client: TestClient) -> None:
        secret = "staged-secret-canary-59"
        staged = {"type": "string", "value": secret, "secret": True}

        session = _finished_session(
            client,
            _run_alone(
                client,
                _outer_binding_inner({"who": "'bound'"}),
                function_variables=[{"function_path": ["inner-fn"], "variables": {"note": staged}}],
            ),
        )

        assert session["status"] == "passed", session.get("error")
        messages = _run_messages(session["session_id"])
        assert "inner who=bound note=********" in messages, messages
        assert not any(secret in m for m in messages), messages
        assert secret in session["secret_registry"].scan_values()


class TestStandaloneRunUndeclaredName:
    """A staged name the Function at its path does not declare is refused before the run."""

    def test_an_undeclared_name_of_the_function_is_refused(self, client: TestClient) -> None:
        definition = _alone_definition(
            variables=[{"name": "note", "type": "string", "value": "n"}], message="note"
        )

        resp = _run_alone(client, definition, variables={"x": {"type": "string", "value": "v"}})

        assert resp.status_code == 400, resp.text
        assert resp.json()["error"]["message"] == "Variable 'x' is not declared by this Function"

    def test_an_undeclared_name_of_a_nested_instance_is_refused(self, client: TestClient) -> None:
        inner = _alone_definition(
            name="inner_fn",
            variables=[{"name": "note", "type": "string", "value": "n"}],
            message="note",
        )

        resp = _run_alone(
            client,
            _outer_with_block(inner),
            function_variables=[
                {
                    "function_path": ["inner-fn"],
                    "variables": {"x": {"type": "string", "value": "v"}},
                }
            ],
        )

        assert resp.status_code == 400, resp.text
        assert resp.json()["error"]["message"] == "Variable 'x' is not declared by this Function"


def _level_definition(
    value_type: str, allowed: list[Any], default: Any, message: str
) -> dict[str, Any]:
    return _alone_definition(
        inputs=[
            {
                "name": "level",
                "type": value_type,
                "required": True,
                "enumValues": allowed,
                "default": default,
            }
        ],
        message=message,
    )


class TestStandaloneRunEnumInput:
    """A Function with an enum input runs alone on its default or a Current allowed value;
    a Current value outside the list fails the run (REQ-3.1.2.11)."""

    @pytest.mark.parametrize("source", SOURCES)
    def test_the_enum_default_is_used_with_no_current_value(
        self, client: TestClient, source: str
    ) -> None:
        definition = _level_definition("string", ["low", "high"], "low", "f'level={level}'")

        session = _finished_session(client, _run_alone(client, definition, source=source))

        assert session["status"] == "passed", session.get("error")
        assert "level=low" in _run_messages(session["session_id"])

    def test_an_integer_enum_default_runs_as_an_integer(self, client: TestClient) -> None:
        definition = _level_definition("integer", [1, 2], 2, "f'next={level + 1}'")

        session = _finished_session(client, _run_alone(client, definition))

        assert session["status"] == "passed", session.get("error")
        assert "next=3" in _run_messages(session["session_id"])

    def test_a_current_allowed_value_is_used(self, client: TestClient) -> None:
        definition = _level_definition("string", ["low", "high"], "low", "f'level={level}'")

        session = _finished_session(
            client,
            _run_alone(
                client, definition, variables={"level": {"type": "string", "value": "high"}}
            ),
        )

        assert session["status"] == "passed", session.get("error")
        assert "level=high" in _run_messages(session["session_id"])

    def test_a_current_value_outside_the_allowed_values_fails_the_run(
        self, client: TestClient
    ) -> None:
        definition = _level_definition("string", ["low", "high"], "low", "f'level={level}'")

        session = _finished_session(
            client,
            _run_alone(client, definition, variables={"level": {"type": "string", "value": "mid"}}),
        )

        assert session["status"] == "failed"
        assert session.get("error") == (
            "Parameter 'level' must be one of: low, high; Actual value was 'mid'."
        )
        assert not any(m.startswith("level=") for m in _run_messages(session["session_id"]))

    def test_an_integer_current_value_outside_the_allowed_values_fails_the_run(
        self, client: TestClient
    ) -> None:
        definition = _level_definition("integer", [1, 2], 2, "f'next={level + 1}'")

        session = _finished_session(
            client,
            _run_alone(client, definition, variables={"level": {"type": "integer", "value": 3}}),
        )

        assert session["status"] == "failed"
        assert session.get("error") == (
            "Parameter 'level' must be one of: 1, 2; Actual value was '3'."
        )
        assert not any(m.startswith("next=") for m in _run_messages(session["session_id"]))


pytestmark = pytest.mark.usefixtures("temp_storage_path")
