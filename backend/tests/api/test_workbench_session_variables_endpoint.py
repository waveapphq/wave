"""End-to-end tests for GET /workbench/{session_id}/variables (REQ-3.2.2.18).

The endpoint serves the live workbench session's realized runtime variables
so complex-type inspect modals can fetch full values.

Error contract:
    - 404 body: ``^Workbench session '<session_id>' not found$``
    - 400 body: ``^Invalid UUID format for session_id: '<value>'$``
      (shared ``validate_uuid`` raises ValidationException = 400 app-wide)
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Generator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench._common import DEFAULT_USER_ID
from wavecore.api.services.workbench.lazy_variables import LazyVariables
from wavecore.core.profile_object import ProfileObject
from wavecore.core.regression_object import RegressionObject
from wavecore.core.suite_object import SuiteObject
from wavecore.core.system_object import SystemObject
from wavecore.core.table import Table

_NOT_FOUND_RE = re.compile(r"^Workbench session '[0-9a-f-]{36}' not found$")
_INVALID_UUID_RE = re.compile(r"^Invalid UUID format for session_id: 'not-a-uuid'$")


@pytest.fixture
def client() -> TestClient:
    from wavecore.api.app import app

    return TestClient(app)


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
) -> dict[str, Any]:
    """Insert a session dict directly into the in-memory session store."""
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
    _wb_common._workbench_sessions[session_id] = session
    return session


def _make_table() -> Table:
    table = Table(columns=[("id", "integer"), ("name", "string"), ("active", "boolean")])
    table.add_row([1, "alpha", True])
    table.add_row([2, "beta", False])
    return table


class TestSessionVariablesSuccess:
    """200 happy-path: realized variables with values and types."""

    def test_200_returns_realized_variables_with_values_and_types(self, client: TestClient) -> None:
        session_id = str(uuid.uuid4())
        _seed_session(
            session_id,
            variables=LazyVariables(
                {
                    "greeting": "hello",
                    "count": 42,
                    "ratio": 3.14,
                    "enabled": True,
                    "nothing": None,
                    "items": [1, "two", True],
                    "config": {"host": "localhost", "port": 8000},
                }
            ),
        )

        response = client.get(f"/workbench/{session_id}/variables")

        assert response.status_code == 200
        body = response.json()
        assert body["success"] is True
        variables = body["data"]["variables"]
        assert variables["greeting"] == {"value": "hello", "type": "string"}
        assert variables["count"] == {"value": 42, "type": "integer"}
        assert variables["ratio"] == {"value": 3.14, "type": "float"}
        assert variables["enabled"] == {"value": True, "type": "boolean"}
        assert variables["nothing"] == {"value": None, "type": "null"}
        assert variables["items"] == {
            "value": [1, "two", True],
            "type": "array",
            "elementTypes": ["integer", "string", "boolean"],
        }
        assert variables["config"] == {
            "value": {"host": "localhost", "port": 8000},
            "type": "map",
            "elementTypes": {"host": "string", "port": "integer"},
        }

    def test_table_instance_serialized_with_column_schema_and_types(
        self, client: TestClient
    ) -> None:
        session_id = str(uuid.uuid4())
        _seed_session(session_id, variables=LazyVariables({"results": _make_table()}))

        response = client.get(f"/workbench/{session_id}/variables")

        assert response.status_code == 200
        entry = response.json()["data"]["variables"]["results"]
        assert entry["type"] == "table"
        assert entry["value"] == {
            "columns": [
                {"name": "id", "type": "integer"},
                {"name": "name", "type": "string"},
                {"name": "active", "type": "boolean"},
            ],
            "rows": [[1, "alpha", True], [2, "beta", False]],
        }

    def test_zero_row_table_preserves_column_schema(self, client: TestClient) -> None:
        session_id = str(uuid.uuid4())
        empty_table = Table(columns=[("col_a", "string"), ("col_b", "float")])
        _seed_session(session_id, variables=LazyVariables({"empty": empty_table}))

        response = client.get(f"/workbench/{session_id}/variables")

        assert response.status_code == 200
        entry = response.json()["data"]["variables"]["empty"]
        assert entry["type"] == "table"
        assert entry["value"] == {
            "columns": [
                {"name": "col_a", "type": "string"},
                {"name": "col_b", "type": "float"},
            ],
            "rows": [],
        }

    def test_list_of_dicts_passes_through_unconverted(self, client: TestClient) -> None:
        """A list-of-row-objects table shape is NOT re-serialized."""
        session_id = str(uuid.uuid4())
        rows = [{"id": 1, "name": "alpha"}, {"id": 2, "name": "beta"}]
        _seed_session(session_id, variables=LazyVariables({"rows": rows}))

        response = client.get(f"/workbench/{session_id}/variables")

        assert response.status_code == 200
        entry = response.json()["data"]["variables"]["rows"]
        # A plain list is an array; only a Table instance reports "table".
        assert entry["type"] == "array"
        assert entry["value"] == rows

    def test_session_without_variables_key_returns_empty_map(self, client: TestClient) -> None:
        """A session staged before the engine attaches variables serves an empty map."""
        session_id = str(uuid.uuid4())
        _seed_session(session_id, variables=None)

        response = client.get(f"/workbench/{session_id}/variables")

        assert response.status_code == 200
        assert response.json()["data"]["variables"] == {}


class TestSessionVariablesNamesFilter:
    """Optional ``names`` CSV query filter."""

    def test_names_csv_filters_to_requested_variables(self, client: TestClient) -> None:
        session_id = str(uuid.uuid4())
        _seed_session(
            session_id,
            variables=LazyVariables({"alpha": 1, "beta": 2, "gamma": 3}),
        )

        response = client.get(f"/workbench/{session_id}/variables", params={"names": "alpha,gamma"})

        assert response.status_code == 200
        variables = response.json()["data"]["variables"]
        assert set(variables.keys()) == {"alpha", "gamma"}

    def test_unknown_names_silently_omitted(self, client: TestClient) -> None:
        session_id = str(uuid.uuid4())
        _seed_session(session_id, variables=LazyVariables({"alpha": 1}))

        response = client.get(
            f"/workbench/{session_id}/variables",
            params={"names": "alpha,never_declared,also_missing"},
        )

        assert response.status_code == 200
        variables = response.json()["data"]["variables"]
        assert set(variables.keys()) == {"alpha"}

    def test_all_unknown_names_returns_empty_map(self, client: TestClient) -> None:
        session_id = str(uuid.uuid4())
        _seed_session(session_id, variables=LazyVariables({"alpha": 1}))

        response = client.get(f"/workbench/{session_id}/variables", params={"names": "nope"})

        assert response.status_code == 200
        assert response.json()["data"]["variables"] == {}

    def test_no_names_param_returns_all_realized_variables(self, client: TestClient) -> None:
        session_id = str(uuid.uuid4())
        _seed_session(session_id, variables=LazyVariables({"alpha": 1, "beta": 2}))

        response = client.get(f"/workbench/{session_id}/variables")

        assert response.status_code == 200
        assert set(response.json()["data"]["variables"].keys()) == {"alpha", "beta"}


class TestSessionVariablesPendingExpressions:
    """Pending (unrealized) expression variables are absent and stay unevaluated."""

    def test_pending_expression_absent_from_response(self, client: TestClient) -> None:
        session_id = str(uuid.uuid4())
        lazy = LazyVariables({"literal": 7}, expr_map={"lazy_sum": ("literal + 1", "integer")})
        _seed_session(session_id, variables=lazy)

        response = client.get(f"/workbench/{session_id}/variables")

        assert response.status_code == 200
        variables = response.json()["data"]["variables"]
        assert "lazy_sum" not in variables
        assert variables["literal"] == {"value": 7, "type": "integer"}

    def test_pending_expression_not_evaluated_by_the_call(self, client: TestClient) -> None:
        """Reading variables for the response must not force expression realization."""
        session_id = str(uuid.uuid4())
        lazy = LazyVariables({"literal": 7}, expr_map={"lazy_sum": ("literal + 1", "integer")})
        _seed_session(session_id, variables=lazy)

        response = client.get(f"/workbench/{session_id}/variables")

        assert response.status_code == 200
        assert lazy.has_pending_expressions()
        assert "lazy_sum" in set(lazy.pending_expression_names())

    def test_requesting_pending_expression_by_name_does_not_evaluate_it(
        self, client: TestClient
    ) -> None:
        """A ``names`` filter naming a pending expression omits it without evaluating."""
        session_id = str(uuid.uuid4())
        lazy = LazyVariables({"literal": 7}, expr_map={"lazy_sum": ("literal + 1", "integer")})
        _seed_session(session_id, variables=lazy)

        response = client.get(f"/workbench/{session_id}/variables", params={"names": "lazy_sum"})

        assert response.status_code == 200
        assert response.json()["data"]["variables"] == {}
        assert lazy.has_pending_expressions()


class TestSessionVariablesSecrets:
    """Declared-secret names are masked with type preserved."""

    def test_declared_secret_string_masked(self, client: TestClient) -> None:
        session_id = str(uuid.uuid4())
        _seed_session(
            session_id,
            variables=LazyVariables({"password": "hunter2", "visible": "open"}),
            secret_variable_names=["password"],
        )

        response = client.get(f"/workbench/{session_id}/variables")

        assert response.status_code == 200
        variables = response.json()["data"]["variables"]
        assert variables["password"] == {"value": "********", "type": "string"}
        assert variables["visible"] == {"value": "open", "type": "string"}

    def test_declared_secret_non_string_type_preserved(self, client: TestClient) -> None:
        """Masking replaces the value but the type reflects the raw value."""
        session_id = str(uuid.uuid4())
        _seed_session(
            session_id,
            variables=LazyVariables({"pin": 1234}),
            secret_variable_names=["pin"],
        )

        response = client.get(f"/workbench/{session_id}/variables")

        assert response.status_code == 200
        variables = response.json()["data"]["variables"]
        assert variables["pin"] == {"value": "********", "type": "integer"}

    def test_session_without_secret_names_key_masks_nothing(self, client: TestClient) -> None:
        session_id = str(uuid.uuid4())
        _seed_session(session_id, variables=LazyVariables({"password": "hunter2"}))

        response = client.get(f"/workbench/{session_id}/variables")

        assert response.status_code == 200
        variables = response.json()["data"]["variables"]
        assert variables["password"] == {"value": "hunter2", "type": "string"}


class TestEngineInjectedEntriesExcluded:
    """Engine-injected expression-context entries never reach the response.

    Real runs inject namespace objects (``system`` / ``suite`` / ``regression``,
    profile aliases) plus flattened dotted access keys into the live variables
    map. They are evaluation machinery, not user variables - and the namespace
    objects are not JSON-serializable.
    """

    def _seed_production_shaped_session(self) -> str:
        session_id = str(uuid.uuid4())
        _seed_session(
            session_id,
            variables=LazyVariables(
                {
                    "greeting": "hello",
                    "metrics": [1, 2],
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
        return session_id

    def test_unfiltered_request_returns_200_with_only_user_variables(
        self, client: TestClient
    ) -> None:
        session_id = self._seed_production_shaped_session()

        response = client.get(f"/workbench/{session_id}/variables")

        assert response.status_code == 200
        variables = response.json()["data"]["variables"]
        assert set(variables.keys()) == {"greeting", "metrics"}
        assert variables["greeting"] == {"value": "hello", "type": "string"}
        assert variables["metrics"] == {
            "value": [1, 2],
            "type": "array",
            "elementTypes": ["integer", "integer"],
        }

    def test_names_filter_naming_injected_entries_silently_omits_them(
        self, client: TestClient
    ) -> None:
        session_id = self._seed_production_shaped_session()

        response = client.get(
            f"/workbench/{session_id}/variables",
            params={"names": "system,suite,regression,db,db.host,system.region,greeting"},
        )

        assert response.status_code == 200
        variables = response.json()["data"]["variables"]
        assert set(variables.keys()) == {"greeting"}


class TestSessionVariablesAnyStatus:
    """The endpoint serves variables for sessions in ANY status."""

    @pytest.mark.parametrize("session_status", ["running", "paused", "passed", "failed", "stopped"])
    def test_serves_variables_regardless_of_session_status(
        self, client: TestClient, session_status: str
    ) -> None:
        session_id = str(uuid.uuid4())
        _seed_session(
            session_id,
            variables=LazyVariables({"outcome": "final"}),
            status=session_status,
        )

        response = client.get(f"/workbench/{session_id}/variables")

        assert response.status_code == 200
        variables = response.json()["data"]["variables"]
        assert variables["outcome"] == {"value": "final", "type": "string"}


class TestSessionVariablesErrors:
    """Error paths with exact anchored message contracts."""

    def test_404_for_unknown_session_exact_message(self, client: TestClient) -> None:
        unknown_id = str(uuid.uuid4())

        response = client.get(f"/workbench/{unknown_id}/variables")

        assert response.status_code == 404
        body = response.json()
        assert body["success"] is False
        assert body["error"]["code"] == "NOT_FOUND"
        assert body["error"]["message"] == f"Workbench session '{unknown_id}' not found"
        assert _NOT_FOUND_RE.match(body["error"]["message"]) is not None

    def test_400_for_invalid_session_id_uuid_exact_message(self, client: TestClient) -> None:
        response = client.get("/workbench/not-a-uuid/variables")

        assert response.status_code == 400
        body = response.json()
        assert body["success"] is False
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert _INVALID_UUID_RE.match(body["error"]["message"]) is not None
