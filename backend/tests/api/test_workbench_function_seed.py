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

from tests.api.error_reply_support import assert_internal_error
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


_FAULT_TEXT = "engine detail /srv/wave/data/tests/declared.yaml"


def _faulty_read(*_args: Any, **_kwargs: Any) -> Any:
    raise ValueError(_FAULT_TEXT)


class TestAFaultWhileAValueIsReadIsNotABadRequest:
    """A fault inside the value reader answers the generic 500, never its own text."""

    @pytest.mark.parametrize("mode", MODES)
    def test_a_fault_reading_a_staged_value_answers_500(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch, mode: dict[str, Any]
    ) -> None:
        from wavecore.api.services.workbench import service as workbench_service
        from wavecore.api.services.workbench._common import _workbench_sessions

        node = _typed_fn_node()
        test_id = _create_test_on_disk(client, nodes=[node])
        env_id = _seed_environment()
        monkeypatch.setattr(workbench_service, "declared_start", _faulty_read)

        resp = _run(
            client,
            test_id,
            env_id,
            node,
            **mode,
            function_variables=[_seed(["fn-1"], {"n": {"type": "integer", "value": 2}})],
        )

        assert_internal_error(resp, _FAULT_TEXT)
        assert _workbench_sessions == {}

    def test_a_fault_reading_a_test_variable_answers_500(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from wavecore.api.services.workbench import service as workbench_service
        from wavecore.api.services.workbench._common import _workbench_sessions

        node = _typed_fn_node()
        test_id = _create_test_on_disk(
            client, nodes=[node], variables={"count": {"type": "integer", "value": 1}}
        )
        env_id = _seed_environment()
        monkeypatch.setattr(workbench_service, "declared_start", _faulty_read)

        resp = _run(client, test_id, env_id, node)

        assert_internal_error(resp, _FAULT_TEXT)
        assert _workbench_sessions == {}

    def test_a_fault_loading_a_function_on_the_path_answers_500(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from wavecore.api.services.workbench import functions as workbench_functions
        from wavecore.api.services.workbench._common import _workbench_sessions

        node = _typed_fn_node()
        test_id = _create_test_on_disk(client, nodes=[node])
        env_id = _seed_environment()

        def _faulty_load(*_args: Any, **_kwargs: Any) -> Any:
            raise RuntimeError(_FAULT_TEXT)

        monkeypatch.setattr(workbench_functions, "_load_function_definition", _faulty_load)

        resp = _run(
            client, test_id, env_id, node, function_path=["fn-1"], single_node_id="typed-log"
        )

        assert_internal_error(resp, _FAULT_TEXT)
        assert _workbench_sessions == {}
