"""Unit tests for workbench session-variables service functions (REQ-3.2.2.18).

Covers ``get_session_variables`` and ``_serialize_runtime_value`` directly,
plus the run-start capture of declared-secret variable names onto the
session dict.
"""

from __future__ import annotations

import asyncio
import json
import re
import uuid
from collections.abc import Generator
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient

from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import service as workbench_service
from wavecore.api.services.workbench._common import DEFAULT_USER_ID
from wavecore.api.services.workbench.lazy_variables import LazyVariables
from wavecore.core.profile_object import ProfileObject
from wavecore.core.regression_object import RegressionObject
from wavecore.core.suite_object import SuiteObject
from wavecore.core.system_object import SystemObject
from wavecore.core.table import Table

_VALID_ENVIRONMENT_ID = "10000000-0000-0000-0000-000000000060"


@pytest.fixture(autouse=True)
def _clean_sessions() -> Generator[None, None, None]:
    _wb_common._clear_sessions_sync()
    yield
    _wb_common._clear_sessions_sync()


def _seed_session(
    session_id: str,
    *,
    variables: Any = None,
    status: str = "running",
    secret_variable_names: list[str] | None = None,
    function_scopes: dict[tuple[str, ...], Any] | None = None,
    function_scope_types: dict[tuple[str, ...], dict[str, str]] | None = None,
) -> dict[str, Any]:
    session: dict[str, Any] = {
        "session_id": session_id,
        "status": status,
        "test_id": "test-1",
        "user_id": DEFAULT_USER_ID,
        "block_states": {},
    }
    if variables is not None:
        session["variables"] = variables
    if secret_variable_names is not None:
        session["secret_variable_names"] = secret_variable_names
    if function_scopes is not None:
        session["function_scopes"] = function_scopes
    if function_scope_types is not None:
        session["function_scope_types"] = function_scope_types
    _wb_common._workbench_sessions[session_id] = session
    return session


class TestGetSessionVariables:
    """Direct calls against ``workbench_service.get_session_variables``."""

    def test_raises_lookup_error_for_unknown_session_exact_message(self) -> None:
        unknown_id = str(uuid.uuid4())
        with pytest.raises(LookupError, match=rf"^Workbench session '{unknown_id}' not found$"):
            workbench_service.get_session_variables(unknown_id)

    def test_returns_all_realized_variables_with_types(self) -> None:
        session_id = str(uuid.uuid4())
        _seed_session(
            session_id,
            variables=LazyVariables({"name": "wave", "count": 3, "flags": [True, False]}),
        )

        result = workbench_service.get_session_variables(session_id)

        assert result == {
            "variables": {
                "name": {"value": "wave", "type": "string"},
                "count": {"value": 3, "type": "integer"},
                "flags": {
                    "value": [True, False],
                    "type": "array",
                    "elementTypes": ["boolean", "boolean"],
                },
            }
        }

    def test_names_filter_returns_subset_and_omits_unknown(self) -> None:
        session_id = str(uuid.uuid4())
        _seed_session(session_id, variables=LazyVariables({"alpha": 1, "beta": 2}))

        result = workbench_service.get_session_variables(session_id, names=["beta", "missing"])

        assert set(result["variables"].keys()) == {"beta"}

    def test_names_none_returns_all(self) -> None:
        session_id = str(uuid.uuid4())
        _seed_session(session_id, variables=LazyVariables({"alpha": 1, "beta": 2}))

        result = workbench_service.get_session_variables(session_id, names=None)

        assert set(result["variables"].keys()) == {"alpha", "beta"}

    def test_pending_expressions_omitted_and_not_evaluated(self) -> None:
        session_id = str(uuid.uuid4())
        lazy = LazyVariables({"base": 1}, expr_map={"derived": ("base + 1", "integer")})
        _seed_session(session_id, variables=lazy)

        result = workbench_service.get_session_variables(session_id)

        assert "derived" not in result["variables"]
        assert lazy.has_pending_expressions()
        assert "derived" in set(lazy.pending_expression_names())

    def test_declared_secret_masked_with_type_preserved(self) -> None:
        session_id = str(uuid.uuid4())
        _seed_session(
            session_id,
            variables=LazyVariables({"token": "abc123", "pin": 9999, "plain": "open"}),
            secret_variable_names=["token", "pin"],
        )

        result = workbench_service.get_session_variables(session_id)

        assert result["variables"]["token"] == {"value": "********", "type": "string"}
        assert result["variables"]["pin"] == {"value": "********", "type": "integer"}
        assert result["variables"]["plain"] == {"value": "open", "type": "string"}

    def test_table_value_serialized_via_table_to_dict(self) -> None:
        session_id = str(uuid.uuid4())
        table = Table(columns=[("k", "string"), ("v", "integer")])
        table.add_row(["a", 1])
        _seed_session(session_id, variables=LazyVariables({"grid": table}))

        result = workbench_service.get_session_variables(session_id)

        assert result["variables"]["grid"] == {
            "value": {
                "columns": [{"name": "k", "type": "string"}, {"name": "v", "type": "integer"}],
                "rows": [["a", 1]],
            },
            "type": "table",
        }

    def test_session_without_variables_key_returns_empty(self) -> None:
        session_id = str(uuid.uuid4())
        _seed_session(session_id, variables=None)

        result = workbench_service.get_session_variables(session_id)

        assert result == {"variables": {}}

    def test_plain_dict_variables_supported(self) -> None:
        """Sessions seeded with a plain dict (no LazyVariables) still serve values."""
        session_id = str(uuid.uuid4())
        _seed_session(session_id, variables={"direct": "value"})

        result = workbench_service.get_session_variables(session_id)

        assert result["variables"]["direct"] == {"value": "value", "type": "string"}

    def test_namespace_objects_and_dotted_aliases_excluded(self) -> None:
        """Engine-injected expression-context entries are not user variables."""
        session_id = str(uuid.uuid4())
        _seed_session(
            session_id,
            variables=LazyVariables(
                {
                    "greeting": "hello",
                    "system": SystemObject({"region": "eu"}),
                    "system.region": "eu",
                    "suite": SuiteObject({"retries": 3}, suite_name="Suite A"),
                    "suite.retries": 3,
                    "regression": RegressionObject({"cycle": "r1"}, regression_name="R1"),
                    "regression.cycle": "r1",
                    "db": ProfileObject(
                        {"host": "srv-a"}, alias="db", profile_name="DB", profile_type="sql"
                    ),
                    "db.host": "srv-a",
                }
            ),
        )

        result = workbench_service.get_session_variables(session_id)

        assert set(result["variables"].keys()) == {"greeting"}

    def test_names_filter_cannot_reach_injected_entries(self) -> None:
        session_id = str(uuid.uuid4())
        _seed_session(
            session_id,
            variables=LazyVariables(
                {"greeting": "hello", "system": SystemObject({}), "system.region": "eu"}
            ),
        )

        result = workbench_service.get_session_variables(
            session_id, names=["system", "system.region", "greeting"]
        )

        assert set(result["variables"].keys()) == {"greeting"}


def _seed_scoped_session(session_id: str) -> dict[str, Any]:
    """A Test variable 'x' beside Function instances fn-1 and fn-1/fn-2, each with its own 'x'."""
    return _seed_session(
        session_id,
        status="paused",
        variables=LazyVariables({"x": 1}),
        function_scopes={
            ("fn-1",): LazyVariables(
                {"x": 10, "label": "a"}, expr_map={"later": ("x + 1", "integer")}
            ),
            ("fn-1", "fn-2"): LazyVariables({"x": 20}),
        },
        function_scope_types={
            ("fn-1",): {"x": "integer", "label": "string", "later": "integer"},
            ("fn-1", "fn-2"): {"x": "integer"},
        },
    )


def _scope_not_found(path: str, session_id: str) -> str:
    return f"Function scope '{path}' not found in workbench session '{session_id}'"


_STANDALONE_DEFINITION: dict[str, Any] = {
    "name": "standalone_fn",
    "inputs": [{"name": "who", "type": "string", "required": False, "default": "hi"}],
    "outputs": [],
    "variables": [{"name": "count", "type": "integer", "value": 1}],
    "workflow": {"nodes": [], "edges": []},
}


async def _finished_standalone_session() -> str:
    """A library-View session whose run of the Function on its own has finished."""
    started = workbench_service.start_standalone_function_run(
        function_def=dict(_STANDALONE_DEFINITION),
        function_name="standalone_fn",
        function_id=str(uuid.uuid4()),
        environment_id=str(uuid.uuid4()),
    )
    session_id: str = started["session_id"]
    await asyncio.wait_for(_wb_common._active_tasks[session_id], timeout=10.0)
    session = _wb_common._workbench_sessions[session_id]
    assert session["status"] == "passed", session.get("error")
    return session_id


class TestGetSessionVariablesByScope:
    """``function_path`` reads one Function instance's scope (REQ-3.2.2.18, REQ-5.2.4.7)."""

    def test_function_path_returns_that_scopes_realized_values(self) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_scoped_session(session_id)

        result = workbench_service.get_session_variables(session_id, function_path=("fn-1",))

        assert result == {
            "variables": {
                "x": {"value": 10, "type": "integer"},
                "label": {"value": "a", "type": "string"},
            }
        }
        assert "later" in set(session["function_scopes"][("fn-1",)].pending_expression_names())

    def test_nested_function_path_reads_the_nested_scope(self) -> None:
        session_id = str(uuid.uuid4())
        _seed_scoped_session(session_id)

        result = workbench_service.get_session_variables(session_id, function_path=("fn-1", "fn-2"))

        assert result == {"variables": {"x": {"value": 20, "type": "integer"}}}

    def test_names_filter_applies_inside_the_function_scope(self) -> None:
        session_id = str(uuid.uuid4())
        _seed_scoped_session(session_id)

        result = workbench_service.get_session_variables(
            session_id, names=["label", "missing"], function_path=("fn-1",)
        )

        assert result == {"variables": {"label": {"value": "a", "type": "string"}}}

    def test_a_functions_list_map_and_table_are_read_in_full_from_its_scope(self) -> None:
        table = Table(columns=[("id", "integer"), ("label", "string")])
        table.add_row([1, "a"])
        session_id = str(uuid.uuid4())
        _seed_session(
            session_id,
            status="paused",
            variables=LazyVariables({"flags": [False], "cfg": {"port": "test"}}),
            function_scopes={
                ("fn-1",): LazyVariables(
                    {"flags": [True, False], "cfg": {"port": 8080}, "grid": table}
                )
            },
            function_scope_types={("fn-1",): {"flags": "array", "cfg": "map", "grid": "table"}},
        )

        result = workbench_service.get_session_variables(session_id, function_path=("fn-1",))

        assert result == {
            "variables": {
                "flags": {
                    "value": [True, False],
                    "type": "array",
                    "elementTypes": ["boolean", "boolean"],
                },
                "cfg": {
                    "value": {"port": 8080},
                    "type": "map",
                    "elementTypes": {"port": "integer"},
                },
                "grid": {
                    "value": {
                        "columns": [
                            {"name": "id", "type": "integer"},
                            {"name": "label", "type": "string"},
                        ],
                        "rows": [[1, "a"]],
                    },
                    "type": "table",
                },
            }
        }

    def test_function_scope_secret_is_masked_and_its_copy_scrubbed(self) -> None:
        from wavecore.core.secrets.registry import SecretRegistry

        registry = SecretRegistry()
        registry.mark_name("tok")
        registry.register("tok", "fn-s3cret-value-77", "declared")
        session_id = str(uuid.uuid4())
        session = _seed_session(
            session_id,
            variables=LazyVariables({}),
            function_scopes={
                ("fn-1",): LazyVariables(
                    {"tok": "fn-s3cret-value-77", "copy": "fn-s3cret-value-77", "plain": "open"}
                )
            },
            function_scope_types={
                ("fn-1",): {"tok": "string", "copy": "string", "plain": "string"}
            },
        )
        session["secret_registry"] = registry

        result = workbench_service.get_session_variables(session_id, function_path=("fn-1",))

        assert result["variables"]["tok"] == {"value": "********", "type": "string"}
        assert result["variables"]["copy"] == {"value": "********", "type": "string"}
        assert result["variables"]["plain"] == {"value": "open", "type": "string"}

    def test_unknown_path_raises_lookup_error_exact_message(self) -> None:
        session_id = str(uuid.uuid4())
        _seed_scoped_session(session_id)

        with pytest.raises(
            LookupError, match=rf"^{re.escape(_scope_not_found('fn-9', session_id))}$"
        ):
            workbench_service.get_session_variables(session_id, function_path=("fn-9",))

    def test_unknown_two_level_path_is_joined_with_a_slash(self) -> None:
        session_id = str(uuid.uuid4())
        _seed_scoped_session(session_id)

        with pytest.raises(
            LookupError, match=rf"^{re.escape(_scope_not_found('fn-1/fn-9', session_id))}$"
        ):
            workbench_service.get_session_variables(session_id, function_path=("fn-1", "fn-9"))

    def test_unknown_session_is_refused_before_the_path(self) -> None:
        unknown_id = str(uuid.uuid4())

        with pytest.raises(LookupError, match=rf"^Workbench session '{unknown_id}' not found$"):
            workbench_service.get_session_variables(unknown_id, function_path=("fn-1",))

    def test_no_path_keeps_the_test_scope_read(self) -> None:
        session_id = str(uuid.uuid4())
        _seed_scoped_session(session_id)

        result = workbench_service.get_session_variables(session_id)

        assert result == {"variables": {"x": {"value": 1, "type": "integer"}}}

    def test_empty_path_reads_the_test_scope(self) -> None:
        session_id = str(uuid.uuid4())
        _seed_scoped_session(session_id)

        result = workbench_service.get_session_variables(session_id, function_path=())

        assert result == {"variables": {"x": {"value": 1, "type": "integer"}}}

    async def test_standalone_session_empty_path_reads_the_functions_own_scope(self) -> None:
        session_id = await _finished_standalone_session()

        result = workbench_service.get_session_variables(session_id)

        assert result == {
            "variables": {
                "count": {"value": 1, "type": "integer"},
                "who": {"value": "hi", "type": "string"},
            }
        }

    async def test_standalone_session_unknown_path_names_only_the_path_that_was_sent(
        self,
    ) -> None:
        session_id = await _finished_standalone_session()

        with pytest.raises(
            LookupError, match=rf"^{re.escape(_scope_not_found('fn-9', session_id))}$"
        ):
            workbench_service.get_session_variables(session_id, function_path=("fn-9",))

    async def test_standalone_session_nested_path_reads_inside_the_instance(self) -> None:
        session_id = await _finished_standalone_session()
        session = _wb_common._workbench_sessions[session_id]
        nested = (workbench_service._STANDALONE_FUNCTION_NODE_ID, "inner")
        session["function_scopes"][nested] = LazyVariables({"depth": 2})
        session.setdefault("function_scope_types", {})[nested] = {"depth": "integer"}

        result = workbench_service.get_session_variables(session_id, function_path=("inner",))

        assert result == {"variables": {"depth": {"value": 2, "type": "integer"}}}


class TestSessionVariablesByScopeEndpoint:
    """GET /workbench/{session_id}/variables with ``function_path`` as a CSV of node ids."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_function_path_csv_reads_the_nested_scope(self, client: TestClient) -> None:
        session_id = str(uuid.uuid4())
        _seed_scoped_session(session_id)

        response = client.get(
            f"/workbench/{session_id}/variables", params={"function_path": "fn-1,fn-2"}
        )

        assert response.status_code == 200, response.text
        assert response.json()["data"] == {"variables": {"x": {"value": 20, "type": "integer"}}}

    def test_get_function_path_with_a_names_filter(self, client: TestClient) -> None:
        session_id = str(uuid.uuid4())
        _seed_scoped_session(session_id)

        response = client.get(
            f"/workbench/{session_id}/variables",
            params={"function_path": "fn-1", "names": "label,missing"},
        )

        assert response.status_code == 200, response.text
        assert response.json()["data"] == {"variables": {"label": {"value": "a", "type": "string"}}}

    def test_get_empty_function_path_reads_the_test_scope(self, client: TestClient) -> None:
        session_id = str(uuid.uuid4())
        _seed_scoped_session(session_id)

        response = client.get(f"/workbench/{session_id}/variables", params={"function_path": ""})

        assert response.status_code == 200, response.text
        assert response.json()["data"] == {"variables": {"x": {"value": 1, "type": "integer"}}}

    def test_get_unknown_function_path_404_exact_message(self, client: TestClient) -> None:
        session_id = str(uuid.uuid4())
        _seed_scoped_session(session_id)

        response = client.get(
            f"/workbench/{session_id}/variables", params={"function_path": "fn-9"}
        )

        assert response.status_code == 404
        body = response.json()
        assert body["success"] is False
        assert body["error"]["code"] == "NOT_FOUND"
        assert body["error"]["message"] == _scope_not_found("fn-9", session_id)

    def test_get_unknown_two_level_function_path_404_joined(self, client: TestClient) -> None:
        session_id = str(uuid.uuid4())
        _seed_scoped_session(session_id)

        response = client.get(
            f"/workbench/{session_id}/variables", params={"function_path": "fn-1,fn-9"}
        )

        assert response.status_code == 404
        assert response.json()["error"]["message"] == _scope_not_found("fn-1/fn-9", session_id)


class TestSerializeRuntimeValue:
    """Serialization matrix for ``workbench_service._serialize_runtime_value``."""

    def test_table_instance_serializes_to_columns_rows_dict(self) -> None:
        table = Table(columns=[("id", "integer"), ("label", "string")])
        table.add_row([7, "seven"])

        result = workbench_service._serialize_runtime_value(table)

        assert result == {
            "columns": [{"name": "id", "type": "integer"}, {"name": "label", "type": "string"}],
            "rows": [[7, "seven"]],
        }

    def test_zero_row_table_keeps_column_schema(self) -> None:
        table = Table(columns=[("only", "boolean")])

        result = workbench_service._serialize_runtime_value(table)

        assert result == {"columns": [{"name": "only", "type": "boolean"}], "rows": []}

    def test_dict_passes_through_unchanged(self) -> None:
        value = {"nested": {"deep": [1, 2]}}
        assert workbench_service._serialize_runtime_value(value) == value

    def test_list_passes_through_unchanged(self) -> None:
        value = [1, "two", {"three": 3}]
        assert workbench_service._serialize_runtime_value(value) == value

    def test_list_of_dicts_not_converted_to_table_shape(self) -> None:
        value = [{"a": 1}, {"a": 2}]
        assert workbench_service._serialize_runtime_value(value) == value

    @pytest.mark.parametrize("scalar", ["text", 42, 3.5, True, None])
    def test_scalars_pass_through_unchanged(self, scalar: Any) -> None:
        assert workbench_service._serialize_runtime_value(scalar) == scalar


def _seed_environment() -> str:
    from wavecore.api.services.environments import service as environment_service

    environment = {
        "id": _VALID_ENVIRONMENT_ID,
        "name": "Session Variables Test Environment",
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


def _create_test_on_disk(client: TestClient) -> str:
    payload = {
        "id": str(uuid.uuid4()),
        "name": "Secret Capture Container",
        "version": "1.0.0",
        "description": "",
        "tags": [],
        "variables": {},
        "workflow": {
            "nodes": [_log_node("only-log", "'run'")],
            "edges": [{"source": "start-node", "target": "only-log"}],
        },
    }
    resp = client.post("/tests", json=payload)
    assert resp.status_code in (200, 201), resp.text
    return str(resp.json()["data"]["id"])


def _run_with_variables(client: TestClient, variables: dict[str, Any]) -> str:
    test_id = _create_test_on_disk(client)
    env_id = _seed_environment()
    resp = client.post(
        "/workbench/run",
        json={
            "test_id": test_id,
            "environment_id": env_id,
            "workflow": {
                "nodes": [_log_node("only-log", "'run'")],
                "edges": [{"source": "start-node", "target": "only-log"}],
            },
            "variables": variables,
        },
    )
    assert resp.status_code == 200, resp.text
    session_id = str(resp.json()["data"]["session_id"])
    task = _wb_common._active_tasks.get(session_id)
    if task is not None and not task.done():
        client.portal.call(lambda: asyncio.wait_for(task, timeout=10.0))
    return session_id


class TestRunStartCapturesSecretNames:
    """``start_workbench_run`` captures declared-secret names on the session."""

    @pytest.fixture
    def client(self) -> Generator[TestClient, None, None]:
        from wavecore.api.app import app

        with TestClient(app) as test_client:
            yield test_client

    @pytest.fixture(autouse=True)
    def _register_plugins(self) -> Generator[None, None, None]:
        from wavecore.controls.registry import _registry, register_all_core_controls
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.log import LogPlugin

        _registry.clear()
        register_all_core_controls(_registry)
        clear_registry()
        register_plugin(LogPlugin())
        yield

    def test_secret_true_names_captured_on_session(self, client: TestClient) -> None:
        session_id = _run_with_variables(
            client,
            {
                "password": {"type": "string", "value": "hunter2", "secret": True},
                "api_key": {"type": "string", "value": "k-123", "secret": True},
                "visible": {"type": "string", "value": "open"},
            },
        )

        session = _wb_common._workbench_sessions[session_id]
        assert sorted(session["secret_variable_names"]) == ["api_key", "password"]

    def test_secret_false_and_missing_flags_not_captured(self, client: TestClient) -> None:
        session_id = _run_with_variables(
            client,
            {
                "explicit_false": {"type": "string", "value": "a", "secret": False},
                "no_flag": {"type": "string", "value": "b"},
            },
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["secret_variable_names"] == []

    def test_no_variables_yields_empty_secret_names(self, client: TestClient) -> None:
        session_id = _run_with_variables(client, {})

        session = _wb_common._workbench_sessions[session_id]
        assert session["secret_variable_names"] == []

    def test_secret_expression_variable_name_captured(self, client: TestClient) -> None:
        """The secret flag is honored on expression declarations too."""
        session_id = _run_with_variables(
            client,
            {
                "derived_secret": {
                    "type": "string",
                    "value": "'a' + 'b'",
                    "isExpression": True,
                    "secret": True,
                },
            },
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["secret_variable_names"] == ["derived_secret"]


class TestRunProducedSessionVariables:
    """``get_session_variables`` against a session produced by a REAL run.

    Real runs inject ``system`` (a SystemObject) and dotted access keys into
    the live variables map; hand-seeded sessions miss them.
    """

    @pytest.fixture
    def client(self) -> Generator[TestClient, None, None]:
        from wavecore.api.app import app

        with TestClient(app) as test_client:
            yield test_client

    @pytest.fixture(autouse=True)
    def _register_plugins(self) -> Generator[None, None, None]:
        from wavecore.controls.registry import _registry, register_all_core_controls
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.log import LogPlugin

        _registry.clear()
        register_all_core_controls(_registry)
        clear_registry()
        register_plugin(LogPlugin())
        yield

    def test_real_run_session_serves_user_variables_json_safe(self, client: TestClient) -> None:
        session_id = _run_with_variables(
            client,
            {"metrics": {"type": "array", "value": [1, 2]}},
        )

        live_variables = _wb_common._workbench_sessions[session_id]["variables"]
        assert isinstance(live_variables["system"], SystemObject)

        result = workbench_service.get_session_variables(session_id)

        assert "system" not in result["variables"]
        assert not any("." in name for name in result["variables"])
        assert result["variables"]["metrics"] == {
            "value": [1, 2],
            "type": "array",
            "elementTypes": ["integer", "integer"],
        }
        json.dumps(result)


class TestSerializeRuntimeValueDecimal:
    """A Decimal runtime value serializes to a plain decimal string."""

    def test_serialize_decimal_returns_plain_string(self) -> None:
        assert workbench_service._serialize_runtime_value(Decimal("1.08")) == "1.08"

    def test_serialize_decimal_avoids_exponent_notation(self) -> None:
        assert workbench_service._serialize_runtime_value(Decimal("1E+3")) == "1000"

    def test_serialize_high_precision_decimal_is_exact(self) -> None:
        assert (
            workbench_service._serialize_runtime_value(Decimal("-2123.123213123123699999"))
            == "-2123.123213123123699999"
        )

    def test_serialize_nested_array_decimal_is_converted_and_json_safe(self) -> None:
        # A Decimal nested in an array stays JSON-serializable.
        result = workbench_service._serialize_runtime_value([Decimal("1.5"), "x"])
        assert result == ["1.5", "x"]
        json.dumps(result)

    def test_serialize_nested_map_decimal_is_converted_and_json_safe(self) -> None:
        result = workbench_service._serialize_runtime_value(
            {"amt": Decimal("9.876543210987654321098765432")}
        )
        assert result == {"amt": "9.876543210987654321098765432"}
        json.dumps(result)

    def test_serialize_table_with_decimal_cell_is_json_safe(self) -> None:
        table = Table(columns=[("id", "integer"), ("amt", "float")])
        table.add_row([1234567890123456789, Decimal("9.876543210987654321098765432")])
        result = workbench_service._serialize_runtime_value(table)
        dumped = json.dumps(result)
        assert "9.876543210987654321098765432" in dumped
        assert "1234567890123456789" in dumped

    def test_serialize_deeply_nested_decimal_is_converted(self) -> None:
        result = workbench_service._serialize_runtime_value(
            {"deep": [Decimal("1.234567890123456789012345678")]}
        )
        assert result == {"deep": ["1.234567890123456789012345678"]}
        json.dumps(result)


class TestLiteralTypePredicateDecimal:
    """The float literal predicate accepts a Decimal (override path)."""

    def test_float_predicate_accepts_decimal(self) -> None:
        assert workbench_service._LITERAL_TYPE_PREDICATES["float"](Decimal("1.5")) is True


class TestLiteralTypePredicateTable:
    """The table literal predicate asks the shared table check, so it accepts
    both runtime forms and rejects a value that is not a table at all."""

    def test_table_predicate_accepts_a_live_table(self) -> None:
        table = Table(columns=[("id", "integer")])
        table.add_row([1])

        assert workbench_service._LITERAL_TYPE_PREDICATES["table"](table) is True

    def test_table_predicate_accepts_stored_list_form(self) -> None:
        assert workbench_service._LITERAL_TYPE_PREDICATES["table"]([{"id": 1}]) is True

    def test_table_predicate_accepts_stored_dict_form(self) -> None:
        stored = {"columns": [{"name": "id", "type": "integer"}], "rows": [[1]]}

        assert workbench_service._LITERAL_TYPE_PREDICATES["table"](stored) is True

    def test_table_predicate_rejects_an_array_of_scalars(self) -> None:
        assert workbench_service._LITERAL_TYPE_PREDICATES["table"]([1, 2, 3]) is False

    def test_table_predicate_rejects_a_plain_map(self) -> None:
        assert workbench_service._LITERAL_TYPE_PREDICATES["table"]({"id": 1}) is False

    def test_table_predicate_rejects_a_string(self) -> None:
        assert workbench_service._LITERAL_TYPE_PREDICATES["table"]("orders") is False


class TestGetSessionVariablesDecimalFloat:
    """A realized Decimal float variable is reported as a plain string typed
    "float" over the GET variables surface (REQ-3.1.3.14)."""

    def test_decimal_variable_reported_as_plain_string_float(self) -> None:
        session_id = str(uuid.uuid4())
        _seed_session(
            session_id,
            variables=LazyVariables({"price": Decimal("19.99")}),
        )

        result = workbench_service.get_session_variables(session_id)

        assert result["variables"]["price"] == {"value": "19.99", "type": "float"}
        json.dumps(result)


class TestFlattenVariablesLiteralCoercion:
    """Literal seeding coerces by declared type so float-string literals realize
    to an exact Decimal and high-precision integer strings to int - the workbench
    seeding path matches realize_declared_value (REQ-3.1.3.14)."""

    def test_float_literal_string_coerced_to_exact_decimal(self) -> None:
        literals, expr_map, _tmpl_map = workbench_service._flatten_variables(
            {"price": {"value": "-2123.123213123123699999", "type": "float"}}
        )
        assert isinstance(literals["price"], Decimal)
        assert literals["price"] == Decimal("-2123.123213123123699999")
        # Arithmetic with a float operand does not raise (str + float TypeError).
        assert literals["price"] + 0.01 == Decimal("-2123.113213123123699999")
        assert expr_map == {}

    def test_integer_literal_string_coerced_to_int(self) -> None:
        literals, _expr_map, _tmpl_map = workbench_service._flatten_variables(
            {"n": {"value": "1234567890123456789", "type": "integer"}}
        )
        assert literals["n"] == 1234567890123456789
        assert isinstance(literals["n"], int)

    def test_expression_float_var_stays_in_expr_map(self) -> None:
        literals, expr_map, _tmpl_map = workbench_service._flatten_variables(
            {
                "price": {"value": "1.5", "type": "float"},
                "total": {"value": "price + 0.01", "type": "float", "isExpression": True},
            }
        )
        assert isinstance(literals["price"], Decimal)
        assert "total" not in literals
        assert expr_map["total"] == ("price + 0.01", "float")


def _run_with_workflow(
    client: TestClient, variables: dict[str, Any], nodes: list[dict[str, Any]]
) -> str:
    """Run-current with a custom node list (mirrors _run_with_variables)."""
    test_id = _create_test_on_disk(client)
    env_id = _seed_environment()
    edges = [{"source": "start-node", "target": nodes[0]["id"]}]
    for previous, node in zip(nodes, nodes[1:], strict=False):
        edges.append({"source": previous["id"], "target": node["id"]})
    resp = client.post(
        "/workbench/run",
        json={
            "test_id": test_id,
            "environment_id": env_id,
            "workflow": {"nodes": nodes, "edges": edges},
            "variables": variables,
        },
    )
    assert resp.status_code == 200, resp.text
    session_id = str(resp.json()["data"]["session_id"])
    task = _wb_common._active_tasks.get(session_id)
    if task is not None and not task.done():
        client.portal.call(lambda: asyncio.wait_for(task, timeout=10.0))
    return session_id


class TestRunStartSeedsSecretRegistry:
    """``start_workbench_run`` creates + seeds the per-run SecretRegistry."""

    @pytest.fixture
    def client(self) -> Generator[TestClient, None, None]:
        from wavecore.api.app import app

        with TestClient(app) as test_client:
            yield test_client

    @pytest.fixture(autouse=True)
    def _register_plugins(self) -> Generator[None, None, None]:
        from wavecore.controls.registry import _registry, register_all_core_controls
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.log import LogPlugin

        _registry.clear()
        register_all_core_controls(_registry)
        clear_registry()
        register_plugin(LogPlugin())
        yield

    def test_declared_literal_secret_seeds_the_registry(self, client: TestClient) -> None:
        session_id = _run_with_variables(
            client,
            {
                "password": {"type": "string", "value": "hunter2secret", "secret": True},
                "visible": {"type": "string", "value": "open-value"},
            },
        )

        registry = _wb_common._workbench_sessions[session_id]["secret_registry"]
        assert registry.is_secret_name("password") is True
        assert registry.is_secret_name("visible") is False
        assert "hunter2secret" in registry.scan_values()
        assert "open-value" not in registry.scan_values()

    def test_secret_expression_registers_when_realized_by_the_run(self, client: TestClient) -> None:
        session_id = _run_with_workflow(
            client,
            {
                "derived_secret": {
                    "type": "string",
                    "value": "'hunt' + 'er2secret'",
                    "isExpression": True,
                    "secret": True,
                },
            },
            [_log_node("log-derived", "'v: ' + derived_secret")],
        )

        registry = _wb_common._workbench_sessions[session_id]["secret_registry"]
        assert "hunter2secret" in registry.scan_values()

    def test_run_console_log_is_masked_end_to_end(self, client: TestClient) -> None:
        from wavecore.api.services import log_streaming_service

        session_id = _run_with_workflow(
            client,
            {
                "password": {"type": "string", "value": "hunter2secret", "secret": True},
            },
            [_log_node("log-secret", "'value: ' + password")],
        )

        logs = log_streaming_service.get_logs(session_id)
        plugin_lines = [
            e["message"]
            for e in logs
            if e.get("blockId") == "log-secret" and e.get("source") == "Log : log-secret"
        ]
        # Masked across every line the node emits (message + harness Inputs/Outputs).
        assert "value: ********" in plugin_lines
        assert not any("hunter2secret" in line for line in plugin_lines)


class TestRegistryMarkedDisplayMasking:
    """Names marked secret mid-run mask in session variable reads."""

    def test_registry_marked_name_is_masked(self) -> None:
        from wavecore.core.secrets.registry import SecretRegistry

        registry = SecretRegistry()
        registry.mark_name("captured_token")
        session_id = str(uuid.uuid4())
        session = _seed_session(
            session_id,
            variables=LazyVariables({"captured_token": "tok-99-abc", "plain": "open"}),
        )
        session["secret_registry"] = registry

        result = workbench_service.get_session_variables(session_id)

        assert result["variables"]["captured_token"] == {
            "value": "********",
            "type": "string",
        }
        assert result["variables"]["plain"] == {"value": "open", "type": "string"}


class TestOverrideRegistersSecretValue:
    """A runtime override written into a secret variable registers its value."""

    def test_override_value_enters_the_run_registry(self) -> None:
        from wavecore.core.secrets.registry import SecretRegistry

        registry = SecretRegistry()
        registry.mark_name("token")
        session_id = str(uuid.uuid4())
        session = _seed_session(
            session_id,
            variables=LazyVariables({"token": "old-value"}, secret_registry=registry),
            status="passed",
            secret_variable_names=["token"],
        )
        session["secret_registry"] = registry
        session["variable_types"] = {"token": "string"}

        result = workbench_service.set_variable_override(
            session_id, "token", value="brand-new-s3cr3t", value_given=True, declared_type="string"
        )

        assert result == {"name": "token", "value": "********", "pending": False}
        assert "brand-new-s3cr3t" in registry.scan_values()


def _create_disk_test_with_variables(
    client: TestClient, variables: dict[str, Any], nodes: list[dict[str, Any]]
) -> str:
    """Persist a test whose variables block carries the given declarations."""
    edges = [{"source": "start-node", "target": nodes[0]["id"]}]
    for previous, node in zip(nodes, nodes[1:], strict=False):
        edges.append({"source": previous["id"], "target": node["id"]})
    payload = {
        "id": str(uuid.uuid4()),
        "name": f"Saved Secret Run {uuid.uuid4()}",
        "version": "1.0.0",
        "description": "",
        "tags": [],
        "variables": variables,
        "workflow": {"nodes": nodes, "edges": edges},
    }
    resp = client.post("/tests", json=payload)
    assert resp.status_code in (200, 201), resp.text
    return str(resp.json()["data"]["id"])


def _await_run(client: TestClient, resp: Any) -> str:
    assert resp.status_code == 200, resp.text
    session_id = str(resp.json()["data"]["session_id"])
    task = _wb_common._active_tasks.get(session_id)
    if task is not None and not task.done():
        client.portal.call(lambda: asyncio.wait_for(task, timeout=10.0))
    return session_id


class TestRunStartUsesRawStoredSecrets:
    """A saved secret runs as its stored value, never the mask, in every run type."""

    SECRET_VALUE = "k3y-real-88"

    @pytest.fixture
    def client(self) -> Generator[TestClient, None, None]:
        from wavecore.api.app import app

        with TestClient(app) as test_client:
            yield test_client

    @pytest.fixture(autouse=True)
    def _register_plugins(self) -> Generator[None, None, None]:
        from wavecore.controls.registry import _registry, register_all_core_controls
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.log import LogPlugin

        _registry.clear()
        register_all_core_controls(_registry)
        clear_registry()
        register_plugin(LogPlugin())
        yield

    def _disk_test(self, client: TestClient, message: str = "'run'") -> str:
        return _create_disk_test_with_variables(
            client,
            {
                "api_key": {"type": "string", "value": self.SECRET_VALUE, "secret": True},
                "note": {"type": "string", "value": "release-42"},
            },
            [_log_node("only-log", message)],
        )

    def test_clean_run_injects_the_stored_secret_value(self, client: TestClient) -> None:
        test_id = self._disk_test(client)
        env_id = _seed_environment()

        session_id = _await_run(
            client,
            client.post("/workbench/run", json={"test_id": test_id, "environment_id": env_id}),
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["variables"]["api_key"] == self.SECRET_VALUE
        registry = session["secret_registry"]
        assert self.SECRET_VALUE in registry.scan_values()
        assert "********" not in registry.scan_values()

    def test_clean_run_expression_compares_against_the_real_value(self, client: TestClient) -> None:
        from wavecore.api.services import log_streaming_service

        message = f"'KEY-INTACT' if api_key == '{self.SECRET_VALUE}' else 'KEY-DROPPED'"
        test_id = self._disk_test(client, message=message)
        env_id = _seed_environment()

        session_id = _await_run(
            client,
            client.post("/workbench/run", json={"test_id": test_id, "environment_id": env_id}),
        )

        logs = log_streaming_service.get_logs(session_id)
        plugin_lines = [
            e["message"]
            for e in logs
            if e.get("blockId") == "only-log" and e.get("source") == "Log : only-log"
        ]
        # The expression saw the real value, so every emitted line is KEY-INTACT,
        # never KEY-DROPPED (message + harness Inputs/Outputs).
        assert "KEY-INTACT" in plugin_lines
        assert not any("KEY-DROPPED" in line for line in plugin_lines)

    def _run_current(self, client: TestClient, test_id: str, variables: dict[str, Any]) -> str:
        nodes = [_log_node("only-log", "'run'")]
        return _await_run(
            client,
            client.post(
                "/workbench/run",
                json={
                    "test_id": test_id,
                    "environment_id": _seed_environment(),
                    "workflow": {
                        "nodes": nodes,
                        "edges": [{"source": "start-node", "target": "only-log"}],
                    },
                    "variables": variables,
                },
            ),
        )

    def test_run_current_placeholder_entry_restores_the_stored_value(
        self, client: TestClient
    ) -> None:
        test_id = self._disk_test(client)

        # A saved secret rides run-current as the masked read the FE holds.
        session_id = self._run_current(
            client,
            test_id,
            {
                "api_key": {"type": "string", "value": "********", "secret": True},
                "note": {"type": "string", "value": "release-42"},
            },
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["variables"]["api_key"] == self.SECRET_VALUE
        assert self.SECRET_VALUE in session["secret_registry"].scan_values()
        assert "********" not in session["secret_registry"].scan_values()

    def test_run_current_edited_secret_value_wins_over_disk(self, client: TestClient) -> None:
        test_id = self._disk_test(client)

        session_id = self._run_current(
            client,
            test_id,
            {
                "api_key": {"type": "string", "value": "rotated-77", "secret": True},
                "note": {"type": "string", "value": "release-42"},
            },
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["variables"]["api_key"] == "rotated-77"
        assert "rotated-77" in session["secret_registry"].scan_values()

    def test_run_current_plain_placeholder_value_is_not_substituted(
        self, client: TestClient
    ) -> None:
        test_id = self._disk_test(client)

        # No secret flag: a literal ******** value is the user's own data.
        session_id = self._run_current(
            client,
            test_id,
            {
                "api_key": {"type": "string", "value": "rotated-77", "secret": True},
                "note": {"type": "string", "value": "********"},
            },
        )

        session = _wb_common._workbench_sessions[session_id]
        assert session["variables"]["note"] == "********"


class TestSessionReadValueScrub:
    """A session read never serves a copy of a registered secret held by a plain variable."""

    def _session_with_copy(self) -> str:
        from wavecore.core.secrets.registry import SecretRegistry

        registry = SecretRegistry()
        registry.mark_name("token")
        registry.register("token", "tok-99-s3cret", "declared")
        session_id = str(uuid.uuid4())
        session = _seed_session(
            session_id,
            variables=LazyVariables(
                {
                    "token": "tok-99-s3cret",
                    "leak": "tok-99-s3cret",
                    "embedded": "Bearer tok-99-s3cret!",
                    "nested": {"auth": "tok-99-s3cret", "host": "example.local"},
                    "plain": "open",
                }
            ),
            secret_variable_names=["token"],
        )
        session["secret_registry"] = registry
        return session_id

    def test_unflagged_verbatim_copy_is_value_scrubbed(self) -> None:
        result = workbench_service.get_session_variables(self._session_with_copy())

        variables = result["variables"]
        assert variables["token"]["value"] == "********"
        assert variables["leak"]["value"] == "********"
        assert variables["embedded"]["value"] == "Bearer ********!"
        assert variables["nested"]["value"] == {"auth": "********", "host": "example.local"}
        assert variables["plain"]["value"] == "open"

    def test_override_echo_scrubs_registered_bytes_in_plain_variable(self) -> None:
        session_id = self._session_with_copy()
        session = _wb_common._workbench_sessions[session_id]
        session["status"] = "passed"
        session["variable_types"] = {"plain": "string"}

        result = workbench_service.set_variable_override(
            session_id,
            "plain",
            value="pre tok-99-s3cret post",
            value_given=True,
            declared_type="string",
        )

        assert result == {"name": "plain", "value": "pre ******** post", "pending": False}
