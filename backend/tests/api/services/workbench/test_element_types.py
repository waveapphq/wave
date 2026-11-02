"""Declared element types reach every run-time value (REQ-3.1.3.19, REQ-3.1.3.14).

Test variables, Suite / Regression / System variables, Variable Setter rows, typed
block settings, run-time overrides and session reads all go through the one
realizer; the session read reports the real run-time element types.
"""

from __future__ import annotations

import uuid
from collections.abc import Generator
from decimal import Decimal
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import plugins as _wb_plugins
from wavecore.api.services.workbench import service as workbench_service
from wavecore.api.services.workbench._common import DEFAULT_USER_ID
from wavecore.api.services.workbench.lazy_variables import LazyVariables
from wavecore.api.services.workbench.node_helpers import _execute_node, _extract_node_fields
from wavecore.controls.variable_setter import VariableSetterControl
from wavecore.core.table import Table
from wavecore.core.variables.decimal_value import WaveDecimal

TYPED_MAP = {"n": "16", "f": "1.0", "zip": "02134", "txt": "[1, 2]"}
TYPED_MAP_TYPES = {"n": "integer", "f": "float", "zip": "string", "txt": "string"}
REALIZED_MAP = {"n": 16, "f": Decimal("1.0"), "zip": "02134", "txt": "[1, 2]"}
STORED_TABLE = {
    "columns": [{"name": "n", "type": "integer"}, {"name": "zip", "type": "string"}],
    "rows": [["16", "02134"]],
}


@pytest.fixture(autouse=True)
def _clean_sessions() -> Generator[None, None, None]:
    _wb_common._clear_sessions_sync()
    yield
    _wb_common._clear_sessions_sync()


def _seed_session(session_id: str, variables: Any, **extra: Any) -> dict[str, Any]:
    session: dict[str, Any] = {
        "session_id": session_id,
        "status": "paused",
        "test_id": "test-1",
        "user_id": DEFAULT_USER_ID,
        "block_states": {},
        "variables": variables,
        **extra,
    }
    _wb_common._workbench_sessions[session_id] = session
    return session


class TestTestVariables:
    def test_a_literal_map_realizes_its_declared_elements(self) -> None:
        literals, _expr, _tmpl = workbench_service._flatten_variables(
            {"m": {"type": "map", "value": TYPED_MAP, "elementTypes": TYPED_MAP_TYPES}}
        )
        assert literals["m"] == REALIZED_MAP
        assert isinstance(literals["m"]["f"], WaveDecimal)

    def test_a_list_without_element_types_reads_by_shape(self) -> None:
        literals, _expr, _tmpl = workbench_service._flatten_variables(
            {"a": {"type": "array", "value": ["16", "[1]"]}}
        )
        assert literals["a"] == ["16", [1]]


class TestNamespaceVariables:
    def _inject(
        self,
        suite_vars: dict[str, Any],
        regression_vars: dict[str, Any],
        system_vars: dict[str, Any],
    ) -> dict[str, Any]:
        variables: dict[str, Any] = {}
        with (
            patch(
                "wavecore.api.services.variable_service.get_system_variables_raw",
                return_value={"variables": system_vars},
            ),
            patch(
                "wavecore.api.services.relations.service.get_suites_for_test",
                return_value=[{"id": "suite-1", "name": "Typed Suite"}],
            ),
            patch(
                "wavecore.api.services.suites.service.get_suite_variables_raw",
                return_value=suite_vars,
            ),
            patch(
                "wavecore.api.services.workbench.plugins._resolve_regression_list",
                return_value=[{"name": "Typed Regression", "variables": regression_vars}],
            ),
        ):
            _wb_plugins._inject_namespace_variables(variables, test_id="test-1")
        return variables

    def test_every_scope_realizes_declared_types(self) -> None:
        typed = {"type": "map", "value": TYPED_MAP, "elementTypes": TYPED_MAP_TYPES}
        variables = self._inject(
            {"m": typed, "count": {"type": "integer", "value": "5"}},
            {"m": typed},
            {"m": typed, "plain": "raw"},
        )
        assert variables["suite.m"] == REALIZED_MAP
        assert variables["suite"].count == 5
        assert variables["regression.m"] == REALIZED_MAP
        assert variables["system.m"] == REALIZED_MAP
        assert variables["system.plain"] == "raw"


class TestVariableSetter:
    def test_a_literal_map_row_realizes_its_element_types(self) -> None:
        params: dict[str, Any] = {"variables": {"m": dict(TYPED_MAP), "e": {"n": 1}}}
        _wb_plugins._coerce_setter_variables(
            params,
            {"m": "map", "e": "map"},
            {"m": TYPED_MAP_TYPES, "e": {"n": "string"}},
            {"e"},
        )
        assert params["variables"]["m"] == REALIZED_MAP
        assert params["variables"]["e"] == {"n": 1}

    def test_a_literal_table_row_stored_typed_runs_as_a_test_variable_table(self) -> None:
        params: dict[str, Any] = {"variables": {"vt": dict(STORED_TABLE)}}
        _wb_plugins._coerce_setter_variables(params, {"vt": "table"})
        literals, _expr, _tmpl = workbench_service._flatten_variables(
            {"vt": {"type": "table", "value": dict(STORED_TABLE)}}
        )
        realized = params["variables"]["vt"]
        assert isinstance(realized, Table)
        assert realized.to_dict() == literals["vt"].to_dict()
        assert realized.to_list() == [{"n": 16, "zip": "02134"}]

    def test_a_literal_table_row_of_row_maps_runs_as_a_table(self) -> None:
        params: dict[str, Any] = {"variables": {"vt": [{"n": 16, "zip": "02134"}]}}
        _wb_plugins._coerce_setter_variables(params, {"vt": "table"})
        realized = params["variables"]["vt"]
        assert isinstance(realized, Table)
        assert realized.to_list() == [{"n": 16, "zip": "02134"}]

    def test_an_expression_table_row_holding_the_stored_form_runs_as_a_table(self) -> None:
        params: dict[str, Any] = {"variables": {"vt": dict(STORED_TABLE)}}
        _wb_plugins._coerce_setter_variables(params, {"vt": "table"}, {}, {"vt"})
        assert params["variables"]["vt"].to_list() == [{"n": 16, "zip": "02134"}]

    @pytest.mark.asyncio
    async def test_a_table_row_stored_typed_is_read_by_row_and_column_after_the_set(
        self,
    ) -> None:
        variables: dict[str, Any] = {"vt": None}
        with patch(
            "wavecore.controls.registry.get_control_implementation",
            return_value=VariableSetterControl,
        ):
            await _wb_plugins._execute_control(
                control_type="variable-setter",
                version="1.0.0",
                parameters={"variables": {"vt": dict(STORED_TABLE)}},
                variables=variables,
                expression_fields=set(),
                setter_rows=_wb_plugins.SetterRows(types={"vt": "table"}),
            )
        assert variables["vt"][0]["zip"] == "02134"
        assert variables["vt"].row_count() == 1

    @pytest.mark.parametrize(
        ("value", "said"),
        [
            ("1e3", "is not a valid integer"),
            (" 30", "is not a valid integer"),
            ("12345678901234567890", "allows at most 19 digits, got 20"),
        ],
        ids=["exponent", "space", "20-digits"],
    )
    def test_a_literal_number_row_that_breaks_the_rule_stops_the_block(
        self, value: str, said: str
    ) -> None:
        params: dict[str, Any] = {"variables": {"n": value}}

        with pytest.raises(TypeError, match=f"^Value for variable 'n' {said}$"):
            _wb_plugins._coerce_setter_variables(params, {"n": "integer"})

    def test_a_literal_number_row_is_parsed_exactly(self) -> None:
        params: dict[str, Any] = {"variables": {"n": "1234567890123456789", "f": "2.50"}}

        _wb_plugins._coerce_setter_variables(params, {"n": "integer", "f": "float"})

        assert params["variables"] == {"n": 1234567890123456789, "f": Decimal("2.50")}
        assert str(params["variables"]["f"]) == "2.50"

    def test_a_literal_typed_element_that_breaks_the_rule_stops_the_block(self) -> None:
        params: dict[str, Any] = {"variables": {"ids": ["1", "x"]}}

        with pytest.raises(
            TypeError, match=r"^Value for variable 'ids' at item 2 is not a valid integer$"
        ):
            _wb_plugins._coerce_setter_variables(
                params, {"ids": "array"}, {"ids": ["integer", "integer"]}
            )

    def test_expression_and_template_rows_keep_their_conversion(self) -> None:
        params: dict[str, Any] = {"variables": {"e": "1e3", "t": " 30 "}}

        _wb_plugins._coerce_setter_variables(
            params, {"e": "integer", "t": "integer"}, {}, {"e"}, {"t"}
        )

        assert params["variables"] == {"e": 1000, "t": 30}

    def test_a_row_without_a_declared_type_is_left_alone(self) -> None:
        params: dict[str, Any] = {"variables": {"x": "7"}}
        _wb_plugins._coerce_setter_variables(params, {}, {"x": ["integer"]})
        assert params["variables"]["x"] == "7"

    @pytest.mark.asyncio
    async def test_the_node_forwards_its_element_types_to_the_control(self) -> None:
        node = {
            "id": "node-1",
            "data": {
                "label": "Set",
                "elementType": "variable-setter",
                "nodeType": "control",
                "version": "1.0.0",
                "config": {"values": {"variables": {"m": dict(TYPED_MAP)}}},
                "variableTypes": {"m": "map"},
                "variableElementTypes": {"m": TYPED_MAP_TYPES},
            },
        }
        fields = _extract_node_fields(node)
        assert fields["variable_element_types"] == {"m": TYPED_MAP_TYPES}
        with patch(
            "wavecore.api.services.workbench.plugins._execute_control",
            new=AsyncMock(return_value=None),
        ) as control:
            await _execute_node(fields, {}, "s-1", "node-1")
        assert control.call_args.kwargs["setter_rows"].element_types == {"m": TYPED_MAP_TYPES}


class TestTypedBlockSettings:
    def test_node_fields_carry_realized_typed_settings(self) -> None:
        node = {
            "id": "node-2",
            "data": {
                "label": "SQL",
                "elementType": "sql-client",
                "nodeType": "plugin",
                "version": "1.0.0",
                "expressionFields": ["driver_options.app"],
                "elementTypes": {"driver_options": {"timeout": "float", "cached": "integer"}},
                "config": {
                    "values": {
                        "driver_options": {"timeout": "2.5", "cached": "16", "app": "'x' + 'y'"},
                    }
                },
            },
        }
        fields = _extract_node_fields(node)
        assert fields["config_values"]["driver_options"] == {
            "timeout": Decimal("2.5"),
            "cached": 16,
            "app": "'x' + 'y'",
        }
        assert fields["expression_fields"] == {"driver_options.app"}


@pytest.fixture
def sql_plugin(monkeypatch: pytest.MonkeyPatch) -> Any:
    """The real SQL block, registered for this test only."""
    from wavecore.core import plugin_registry
    from wavecore.plugins.sql_client import SQLClientPlugin

    plugin = SQLClientPlugin()
    monkeypatch.setitem(
        plugin_registry._registry._plugins, "sql-client", {plugin.metadata["version"]: plugin}
    )
    return plugin


DECIMAL_OPTIONS = {"timeout": WaveDecimal("16.5"), "nested": [WaveDecimal("0.5")], "cached": 16}


def _body_block_fields(
    plugin: Any, values: dict[str, Any], *, expression_fields: list[str] | None = None
) -> dict[str, Any]:
    """A remote body Block's fields as the run reads them from the stored node."""
    return _extract_node_fields(
        {
            "id": "body-1",
            "data": {
                "label": "SQL",
                "elementType": "sql-client",
                "nodeType": "plugin",
                "version": plugin.metadata["version"],
                "expressionFields": expression_fields or [],
                "templateFields": [],
                "config": {"values": values},
            },
        }
    )


class TestTypedSettingsAtThePluginEdge:
    """However a typed setting is written - literal rows, a per-entry expression, a bound
    profile's field - its floats reach the plugin as platform numbers (REQ-3.1.3.19)."""

    @pytest.mark.asyncio
    async def test_a_whole_row_expression_reaches_the_plugin_in_platform_numbers(
        self, sql_plugin: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        received: dict[str, Any] = {}

        async def _capture(context: dict[str, Any]) -> dict[str, Any]:
            received.update(context["parameters"])
            return {}

        monkeypatch.setattr(sql_plugin, "validate", AsyncMock())
        monkeypatch.setattr(sql_plugin, "execute", _capture)
        await _wb_plugins._execute_plugin(
            plugin_type="sql-client",
            version=sql_plugin.metadata["version"],
            parameters={"driver_options": "opts", "sql": "SELECT 1"},
            variables={"opts": DECIMAL_OPTIONS},
            session_id=str(uuid.uuid4()),
            expression_fields={"driver_options"},
        )
        assert received["driver_options"] == {"timeout": 16.5, "nested": [0.5], "cached": 16}
        assert type(received["driver_options"]["timeout"]) is float

    async def test_a_remote_body_block_resolves_to_platform_numbers(self, sql_plugin: Any) -> None:
        from wavecore.api.services.workbench.remote_exec import _resolve_remote_params

        resolved = _resolve_remote_params(
            _body_block_fields(
                sql_plugin,
                {"driver_options": {"timeout": "wait + 10"}},
                expression_fields=["driver_options.timeout"],
            ),
            {"wait": WaveDecimal("6.5")},
            "no-session",
        )
        assert resolved["driver_options"] == {"timeout": 16.5}
        assert type(resolved["driver_options"]["timeout"]) is float


SQL_ESCAPE = {"by": "database_type", "rules": {"postgresql": "json"}, "default": "dql"}


@pytest.fixture
def escaped_sql_plugin(sql_plugin: Any, monkeypatch: pytest.MonkeyPatch) -> Any:
    """The SQL block with an escape spec on its sql row, so its escape map is not empty."""
    metadata = sql_plugin.metadata
    metadata["parameters"] = [
        {**row, "template_escape": SQL_ESCAPE} if row["name"] == "sql" else row
        for row in metadata["parameters"]
    ]
    monkeypatch.setattr(type(sql_plugin), "metadata", property(lambda _self: metadata))
    return sql_plugin


@pytest.fixture
def resolve_calls(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    """The keywords of every resolve_parameters call; the real resolver still runs."""
    from wavecore.core.execution import plugin_executor

    real = plugin_executor.resolve_parameters
    calls: list[dict[str, Any]] = []

    def _spy(*args: Any, **kwargs: Any) -> Any:
        calls.append(kwargs)
        return real(*args, **kwargs)

    monkeypatch.setattr(plugin_executor, "resolve_parameters", _spy)
    return calls


class TestTemplateEscapesAtThePluginEdge:
    """A block's rows are resolved with the escape specs its metadata declares (OS-5)."""

    @pytest.mark.asyncio
    async def test_a_workbench_block_passes_its_escape_specs(
        self,
        escaped_sql_plugin: Any,
        resolve_calls: list[dict[str, Any]],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from wavecore.core.execution.plugin_executor import template_escape_fields

        monkeypatch.setattr(escaped_sql_plugin, "validate", AsyncMock())
        monkeypatch.setattr(escaped_sql_plugin, "execute", AsyncMock(return_value={}))
        await _wb_plugins._execute_plugin(
            plugin_type="sql-client",
            version=escaped_sql_plugin.metadata["version"],
            parameters={"sql": "SELECT 1"},
            variables={},
            session_id=str(uuid.uuid4()),
        )
        escapes = template_escape_fields(escaped_sql_plugin.metadata["parameters"])
        assert escapes == {"sql": SQL_ESCAPE}
        assert [call["template_escapes"] for call in resolve_calls] == [escapes]

    async def test_a_remote_body_block_passes_its_escape_specs(
        self, escaped_sql_plugin: Any, resolve_calls: list[dict[str, Any]]
    ) -> None:
        from wavecore.api.services.workbench.remote_exec import _resolve_remote_params
        from wavecore.core.execution.plugin_executor import template_escape_fields

        _resolve_remote_params(
            _body_block_fields(escaped_sql_plugin, {"sql": "SELECT 1"}), {}, "no-session"
        )
        escapes = template_escape_fields(escaped_sql_plugin.metadata["parameters"])
        assert escapes == {"sql": SQL_ESCAPE}
        assert [call["template_escapes"] for call in resolve_calls] == [escapes]


class TestSessionReadsAndOverrides:
    def test_a_session_read_reports_real_element_types(self) -> None:
        session_id = str(uuid.uuid4())
        _seed_session(
            session_id,
            LazyVariables({"m": {"n": 16, "f": WaveDecimal("1.0")}, "a": [True], "s": "x"}),
        )
        variables = workbench_service.get_session_variables(session_id)["variables"]
        assert variables["m"] == {
            "value": {"n": 16, "f": "1.0"},
            "type": "map",
            "elementTypes": {"n": "integer", "f": "float"},
        }
        assert variables["a"] == {"value": [True], "type": "array", "elementTypes": ["boolean"]}
        assert variables["s"] == {"value": "x", "type": "string"}

    def test_an_integer_past_a_doubles_exact_range_reads_as_its_exact_digits(self) -> None:
        session_id = str(uuid.uuid4())
        big = 1234567890123456789
        edge = 2**53 - 1
        _seed_session(
            session_id,
            LazyVariables(
                {
                    "m": {
                        "big": big,
                        "neg": -big,
                        "edge": edge,
                        "past": edge + 1,
                        "n": 16,
                        "b": True,
                    },
                    "a": [big, [big]],
                    "s": big,
                }
            ),
        )
        variables = workbench_service.get_session_variables(session_id)["variables"]
        assert variables["m"]["value"] == {
            "big": "1234567890123456789",
            "neg": "-1234567890123456789",
            "edge": 9007199254740991,
            "past": "9007199254740992",
            "n": 16,
            "b": True,
        }
        assert variables["m"]["elementTypes"] == {
            "big": "integer",
            "neg": "integer",
            "edge": "integer",
            "past": "integer",
            "n": "integer",
            "b": "boolean",
        }
        assert variables["a"]["value"] == ["1234567890123456789", ["1234567890123456789"]]
        assert variables["s"] == {"value": "1234567890123456789", "type": "integer"}

    def test_a_masked_map_reports_no_element_types(self) -> None:
        session_id = str(uuid.uuid4())
        _seed_session(
            session_id,
            LazyVariables({"secret_map": {"k": 1}}),
            secret_variable_names=["secret_map"],
        )
        entry = workbench_service.get_session_variables(session_id)["variables"]["secret_map"]
        assert entry == {"value": "********", "type": "map"}

    def test_a_literal_override_realizes_its_element_types(self) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_session(session_id, LazyVariables({}), variable_types={"m": "map"})
        result = workbench_service.set_variable_override(
            session_id,
            "m",
            value={"n": "20", "f": "1.0"},
            value_given=True,
            declared_type="map",
            element_types={"n": "integer", "f": "float"},
        )
        assert result == {"name": "m", "value": {"n": 20, "f": "1.0"}, "pending": False}
        assert session["variables"]["m"] == {"n": 20, "f": Decimal("1.0")}

    def test_the_override_route_accepts_element_types(self) -> None:
        from wavecore.api.app import app

        session_id = str(uuid.uuid4())
        session = _seed_session(session_id, LazyVariables({}), variable_types={"m": "array"})
        response = TestClient(app).patch(
            f"/workbench/{session_id}/variables/m",
            json={"type": "array", "value": ["7", "x"], "elementTypes": ["integer", "string"]},
        )
        assert response.status_code == 200, response.text
        assert session["variables"]["m"] == [7, "x"]
