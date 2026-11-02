"""A Current value set before the run on a Function's own variable follows its declaration.

The same rule as a Test variable (REQ-3.1.3.5, REQ-3.2.1.6): a value staged on a local or an
output declared secret stays secret in every run output, whatever the request says; a value of
another type than declared, or a value marked both Expression and Template, is refused before
the run starts, as a Current edit is.
"""

from __future__ import annotations

import re
from collections.abc import Generator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.api.test_workbench_run_current import (  # noqa: F401
    _RUN_SCOPE,
    _create_test_on_disk,
    _finished,
    _fn_def_with_nodes,
    _local_fn_node_with_def,
    _log_messages,
    _log_node,
    _register_plugins_and_clear_sessions,
    _run,
    _seed,
    _seed_environment,
    _session,
    _session_status,
)


@pytest.fixture
def client() -> Generator[TestClient, None, None]:
    """Context-managed client so the background run task finishes on the loop."""
    from wavecore.api.app import app

    with TestClient(app) as test_client:
        yield test_client


MODES = [pytest.param(_RUN_SCOPE, id="run-scope"), pytest.param({}, id="whole-test")]


def _secret_fn_node(kind: str) -> dict[str, Any]:
    """Test-canvas instance ``fn-1`` declaring ``token`` secret as a local or an output."""
    definition = _fn_def_with_nodes(
        "keeps", [_log_node("keeps-log", "f'token={token}'")], "keeps-log"
    )
    declared = {"name": "token", "type": "string", "secret": True}
    if kind == "local":
        definition["variables"] = [{**declared, "value": "initial-token"}]
    else:
        definition["outputs"] = [{**declared, "default": "initial-token"}]
    return _local_fn_node_with_def("fn-1", definition)


def _typed_fn_node() -> dict[str, Any]:
    """Test-canvas instance ``fn-1`` with one integer local ``n``."""
    definition = _fn_def_with_nodes("typed", [_log_node("typed-log", "f'n={n}'")], "typed-log")
    definition["variables"] = [{"name": "n", "type": "integer", "value": 1}]
    return _local_fn_node_with_def("fn-1", definition)


class TestAStagedSecretStaysSecret:
    @pytest.mark.parametrize("mode", MODES)
    @pytest.mark.parametrize("kind", ["local", "output"])
    def test_a_staged_value_of_a_secret_declaration_is_masked(
        self, client: TestClient, mode: dict[str, Any], kind: str
    ) -> None:
        canary = f"staged-canary-{kind}"
        node = _secret_fn_node(kind)
        test_id = _create_test_on_disk(client, nodes=[node])
        env_id = _seed_environment()

        session_id = _finished(
            client,
            _run(
                client,
                test_id,
                env_id,
                node,
                **mode,
                function_variables=[
                    _seed(["fn-1"], {"token": {"type": "string", "value": canary}})
                ],
            ),
        )

        assert _session_status(session_id) == "passed", _session(session_id).get("error")
        messages = _log_messages(session_id)
        assert "token=********" in messages, messages
        assert not any(canary in message for message in messages), messages
        assert canary in _session(session_id)["secret_registry"].scan_values()


class TestAStagedValueIsRefusedBeforeTheRun:
    @pytest.mark.parametrize("mode", MODES)
    @pytest.mark.parametrize(
        ("staged", "message"),
        [
            pytest.param(
                {"type": "string", "value": "x"},
                r"^Type mismatch for variable 'n': expected 'integer', got 'string'$",
                id="another-type",
            ),
            pytest.param(
                {"type": "integer", "value": "1", "isExpression": True, "isTemplate": True},
                r"^is_expression and is_template are mutually exclusive$",
                id="both-kinds",
            ),
        ],
    )
    def test_the_run_never_starts(
        self, client: TestClient, mode: dict[str, Any], staged: dict[str, Any], message: str
    ) -> None:
        from wavecore.api.services.workbench._common import _workbench_sessions

        node = _typed_fn_node()
        test_id = _create_test_on_disk(client, nodes=[node])
        env_id = _seed_environment()

        resp = _run(
            client,
            test_id,
            env_id,
            node,
            **mode,
            function_variables=[_seed(["fn-1"], {"n": staged})],
        )

        assert resp.status_code == 400, resp.text
        assert re.match(message, resp.json()["error"]["message"]), resp.text
        assert _workbench_sessions == {}
