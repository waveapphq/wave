"""A setting given null fails unless it is a data field; a null entry reaches the Block
(REQ-3.1.3.21, REQ-3.4.2.2, REQ-3.4.2.3)."""

import asyncio
import dataclasses
import re
import uuid
from collections.abc import Callable, Iterable, Iterator, Mapping
from typing import Any
from unittest.mock import AsyncMock

import pytest

import wavecore.plugins as plugin_package
from wavecore.api.services.workbench import _common as workbench_common
from wavecore.api.services.workbench import plugins as workbench_plugins
from wavecore.controls import registry as control_registry
from wavecore.controls.conditional import AssertControl
from wavecore.controls.loop import ForControl, ForEachControl
from wavecore.controls.variable_setter import VariableSetterControl
from wavecore.core import plugin_registry
from wavecore.core.execution import plugin_executor
from wavecore.core.expressions import errors
from wavecore.core.functions import executor as function_executor
from wavecore.core.secrets.masking import secret_param_names
from wavecore.models.controls.parameters import ControlParameter
from wavecore.models.enums import ControlId
from wavecore.models.plugins import PluginParameter
from wavecore.plugins.csv_parser import CSVParserPlugin
from wavecore.plugins.http_client import HTTPClientPlugin
from wavecore.plugins.k8s_apply import K8sApplyPlugin
from wavecore.plugins.k8s_events import K8sEventsPlugin
from wavecore.plugins.log import LogPlugin
from wavecore.plugins.opensearch import OpenSearchPlugin
from wavecore.plugins.python import PythonPlugin
from wavecore.plugins.sql_client import SQLClientPlugin
from wavecore.plugins.ssh_session_open import SSHSessionOpenPlugin
from wavecore.plugins.ssh_tunnel_open import SSHTunnelOpenPlugin

MARKS = ("accepts_null", "null_piece_prints")

DATA_FIELD_MARKS: dict[tuple[str, str], set[str]] = {
    ("for", "count"): {"accepts_null"},
    ("for-each", "collection"): {"accepts_null"},
    ("log", "message"): {"accepts_null", "null_piece_prints"},
}

ENTRY_MARK = "entries_accept_null"

SHAPES = [
    pytest.param(dict, id="plugin-dict"),
    pytest.param(PluginParameter, id="plugin-model"),
    pytest.param(ControlParameter, id="control-model"),
]


def exact(message: str) -> str:
    return f"^{re.escape(message)}$"


def refused(message: str) -> Any:
    """The gate's refusal, read exactly."""
    return pytest.raises(errors.NullValueError, match=exact(message))


def _declared(block: type) -> list[Any]:
    """The block's own parameter definitions: dicts for a plugin, models for a control."""
    metadata = block().metadata
    key = "parameter_schema" if "parameter_schema" in metadata else "parameters"
    return list(metadata[key])


def _name_of(parameter: Any) -> str:
    return str(parameter["name"] if isinstance(parameter, dict) else parameter.name)


def _policies(block: type) -> Any:
    return plugin_executor.null_policy_fields(_declared(block))


def _resolve_plugin(
    block: type,
    values: dict[str, Any],
    *,
    expressions: Iterable[str] = (),
    variables: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Resolve a plugin block's settings the way a run does, with its own null policies."""
    fields = block().metadata["parameters"]
    types, trim_fields, references, wire_format = plugin_executor.derive_parameter_metadata(fields)
    expression_fields = set(expressions)
    return plugin_executor.resolve_parameters(
        values,
        expression_fields,
        dict(variables or {}),
        types,
        map_expression_keys=plugin_executor.build_map_expression_keys(expression_fields),
        trim_fields=trim_fields,
        reference_fields=references,
        wire_format_fields=wire_format,
        typed_value_fields=plugin_executor.typed_value_fields(fields),
        null_policies=plugin_executor.null_policy_fields(fields),
    )


def _resolve_control(
    block: type,
    values: dict[str, Any],
    *,
    expressions: Iterable[str] = (),
    variables: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Resolve a control's settings the way a run does, with its own null policies."""
    schema = block().metadata["parameter_schema"]
    fields = set(expressions)
    return plugin_executor.resolve_parameters(
        values,
        fields,
        dict(variables or {}),
        {parameter.name: parameter.type for parameter in schema},
        map_expression_keys=plugin_executor.build_map_expression_keys(fields),
        reference_fields={parameter.name for parameter in schema if parameter.variable_ref},
        null_policies=plugin_executor.null_policy_fields(schema),
    )


def _core_controls() -> Iterator[tuple[str, type]]:
    controls = control_registry.ControlImplementationRegistry()
    control_registry.register_all_core_controls(controls)
    for control_id in controls.list_control_ids():
        for version in controls.list_versions(control_id):
            control = controls.get(control_id, version)
            assert control is not None
            yield control_id.value, control


def _every_parameter() -> Iterator[tuple[str, Any]]:
    """Every parameter of every core plugin and control, as the models their catalog reads."""
    for name in plugin_package.__all__:
        plugin = getattr(plugin_package, name)()
        for parameter in plugin.get_plugin_model().parameters:
            yield str(plugin.metadata["id"]), parameter
    for control_id, control in _core_controls():
        for parameter in control().metadata["parameter_schema"]:
            yield control_id, parameter


def _declared_keys() -> Iterator[tuple[str, str, set[str]]]:
    """Every setting of every core plugin and control with the keys its declaration carries."""
    for name in plugin_package.__all__:
        metadata = getattr(plugin_package, name)().metadata
        for row in metadata["parameters"]:
            keys = set(row) if isinstance(row, dict) else set(row.model_dump())
            yield str(metadata["id"]), _name_of(row), keys
    for control_id, control in _core_controls():
        for parameter in control().metadata["parameter_schema"]:
            yield control_id, parameter.name, set(parameter.model_dump())


def _marks_by_setting() -> dict[tuple[str, str], set[str]]:
    return {
        (block, parameter.name): {mark for mark in MARKS if getattr(parameter, mark)}
        for block, parameter in _every_parameter()
    }


class TestOnePolicyPerSetting:
    """The policies are a pure reading of the block's definition, one per declared setting."""

    @pytest.mark.parametrize("block", [HTTPClientPlugin, ForControl], ids=["plugin", "control"])
    def test_every_declared_setting_has_a_policy(self, block: type) -> None:
        names = {_name_of(parameter) for parameter in _declared(block)}

        assert set(_policies(block)) == names


class TestTheMarks:
    """Two whole-field declarations, off unless the block's definition turns one on."""

    @pytest.mark.parametrize("model", [PluginParameter, ControlParameter])
    def test_a_parameter_carries_no_mark_unless_it_declares_one(self, model: type) -> None:
        parameter = model(name="value", type="string")

        assert [getattr(parameter, mark) for mark in MARKS] == [False, False]

    @pytest.mark.parametrize("mark", MARKS)
    @pytest.mark.parametrize("model", [PluginParameter, ControlParameter])
    def test_a_parameter_keeps_the_one_mark_it_declares(self, model: type, mark: str) -> None:
        parameter = model(name="value", type="string", **{mark: True})

        assert {name for name in MARKS if getattr(parameter, name)} == {mark}

    @pytest.mark.parametrize(("block", "setting"), sorted(DATA_FIELD_MARKS))
    def test_a_data_field_carries_its_marks(self, block: str, setting: str) -> None:
        assert _marks_by_setting()[(block, setting)] == DATA_FIELD_MARKS[(block, setting)]

    def test_no_other_setting_of_any_plugin_or_control_carries_a_mark(self) -> None:
        marked = {key: marks for key, marks in _marks_by_setting().items() if marks}

        assert marked == DATA_FIELD_MARKS


class TestNoEntryMark:
    """No field declares whether its entries take null: each Block decides that itself."""

    @pytest.mark.parametrize("model", [PluginParameter, ControlParameter])
    def test_a_field_model_has_no_entry_mark(self, model: type) -> None:
        assert ENTRY_MARK not in model.model_fields

    def test_a_null_policy_covers_the_whole_field_only(self) -> None:
        names = {field.name for field in dataclasses.fields(plugin_executor.NullPolicy)}

        assert ENTRY_MARK not in names

    def test_no_plugin_or_control_setting_declares_an_entry_mark(self) -> None:
        marked = sorted(
            (block, setting) for block, setting, keys in _declared_keys() if ENTRY_MARK in keys
        )

        assert marked == []


@pytest.mark.parametrize("shape", SHAPES)
class TestPoliciesFromEitherShape:
    """A plugin's dict metadata and a control's models give the same policies."""

    def test_an_unmarked_setting_refuses_null(self, shape: Any) -> None:
        policies = plugin_executor.null_policy_fields([shape(name="value", type="string")])

        with refused("'value' is null"):
            plugin_executor.check_field_null("value", None, policies["value"])

    def test_a_setting_that_accepts_null_takes_it(self, shape: Any) -> None:
        policies = plugin_executor.null_policy_fields(
            [shape(name="value", type="string", accepts_null=True)]
        )

        assert plugin_executor.check_field_null("value", None, policies["value"]) is None


class TestCheckFieldNull:
    """A whole value that is null fails and names the setting, unless it accepts null."""

    def test_a_setting_given_null_is_refused_by_its_name(self) -> None:
        with refused("'session' is null"):
            plugin_executor.check_field_null("session", None, _policies(K8sEventsPlugin)["session"])

    def test_the_refusal_is_a_null_value_error_and_an_expression_failure(self) -> None:
        with pytest.raises(errors.ExpressionEvaluationError) as raised:
            plugin_executor.check_field_null("session", None, _policies(K8sEventsPlugin)["session"])

        assert isinstance(raised.value, errors.NullValueError)

    @pytest.mark.parametrize(
        "value", ["", 0, False, [], {}], ids=["empty-text", "zero", "false", "no-items", "no-keys"]
    )
    def test_a_value_that_holds_nothing_is_not_null(self, value: Any) -> None:
        policy = _policies(HTTPClientPlugin)["body"]

        assert plugin_executor.check_field_null("body", value, policy) is None

    def test_a_data_field_takes_null(self) -> None:
        policy = _policies(LogPlugin)["message"]

        assert plugin_executor.check_field_null("message", None, policy) is None


class TestCheckEntryNulls:
    """The refusal a Block calls for a null entry: a map value names its key; a row or a plain
    list item names its number, counted from 1."""

    def test_a_null_map_entry_is_refused_by_its_key(self) -> None:
        headers = {"Accept": "*/*", "X-Trace": None}

        with refused("'X-Trace' in 'headers' is null"):
            plugin_executor.check_entry_nulls("headers", headers)

    def test_a_null_list_row_is_refused_by_its_row_number(self) -> None:
        rows = [{"value": "@timestamp"}, {"value": None}]

        with refused("Row 2 in 'fields' is null"):
            plugin_executor.check_entry_nulls("fields", rows)

    def test_a_null_plain_list_item_is_refused_by_its_row_number(self) -> None:
        suites = ["TLS_AES_128_GCM_SHA256", None]

        with refused("Row 2 in 'cipher_suites' is null"):
            plugin_executor.check_entry_nulls("cipher_suites", suites)

    def test_a_null_item_after_a_record_is_refused_by_its_row_number(self) -> None:
        with refused("Row 2 in 'items' is null"):
            plugin_executor.check_entry_nulls("items", [{"id": 1}, None])

    @pytest.mark.parametrize(
        ("setting", "value"),
        [
            pytest.param("headers", {"X-Empty": ""}, id="map-entry"),
            pytest.param("fields", [{"value": ""}], id="list-row"),
            pytest.param("cipher_suites", [""], id="plain-item"),
        ],
    )
    def test_an_empty_entry_is_not_null(self, setting: str, value: Any) -> None:
        assert plugin_executor.check_entry_nulls(setting, value) is None

    def test_a_file_part_with_no_value_is_not_a_null_row(self) -> None:
        parts = [
            {"kind": "file", "name": "upload", "source": "testdata://report.bin"},
            {"kind": "text", "name": "comment", "value": "hi"},
        ]

        assert plugin_executor.check_entry_nulls("parts", parts) is None

    @pytest.mark.parametrize("value", ["text", 7], ids=["text", "number"])
    def test_a_value_with_no_entries_has_nothing_to_refuse(self, value: Any) -> None:
        assert plugin_executor.check_entry_nulls("headers", value) is None


class TestRequiredSettings:
    """A required setting given null by an expression fails at run time and names it."""

    def test_a_required_setting_given_null_by_an_expression_is_refused(self) -> None:
        with refused("'session' is null"):
            _resolve_plugin(
                K8sEventsPlugin,
                {"session": "k8s_session"},
                expressions={"session"},
                variables={"k8s_session": None},
            )


DEFAULTED = [
    pytest.param(
        SSHSessionOpenPlugin,
        "port",
        {"host": "target.local", "username": "wave"},
        id="ssh-session-open-port",
    ),
    pytest.param(
        SSHTunnelOpenPlugin,
        "local_port",
        {"session_id": "ssh-1", "remote_host": "db.local", "remote_port": 5432},
        id="ssh-tunnel-open-local-port",
    ),
]


@pytest.mark.parametrize(("block", "setting", "rest"), DEFAULTED)
class TestSettingsWithADefault:
    """Given null a defaulted setting fails; left empty it still takes its default (SSH-10)."""

    def test_given_null_by_an_expression_it_is_refused(
        self, block: type, setting: str, rest: dict[str, Any]
    ) -> None:
        with refused(f"'{setting}' is null"):
            _resolve_plugin(
                block,
                {**rest, setting: "chosen"},
                expressions={setting},
                variables={"chosen": None},
            )

    def test_left_empty_it_is_nothing_given(
        self, block: type, setting: str, rest: dict[str, Any]
    ) -> None:
        assert _resolve_plugin(block, {**rest, setting: None}) == {**rest, setting: None}

    def test_left_out_it_is_nothing_given(
        self, block: type, setting: str, rest: dict[str, Any]
    ) -> None:
        assert _resolve_plugin(block, dict(rest)) == rest


FALLBACKS = [
    pytest.param(SQLClientPlugin, "port", id="sql-port"),
    pytest.param(K8sEventsPlugin, "namespace", id="k8s-namespace"),
    pytest.param(HTTPClientPlugin, "body", id="http-body"),
]


@pytest.mark.parametrize(("block", "setting"), FALLBACKS)
class TestSettingsTheBlockFallsBackFor:
    """A setting whose fallback the block picks counts as one with a default."""

    def test_given_null_by_an_expression_it_is_refused(self, block: type, setting: str) -> None:
        with refused(f"'{setting}' is null"):
            _resolve_plugin(
                block, {setting: "chosen"}, expressions={setting}, variables={"chosen": None}
            )

    def test_left_empty_it_is_nothing_given(self, block: type, setting: str) -> None:
        assert _resolve_plugin(block, {setting: None}) == {setting: None}


class TestOptionalSettingsWithNoDeclaredDefault:
    """A block setting with no declared default still refuses null (CSV-5)."""

    @pytest.mark.parametrize(
        ("block", "setting"),
        [
            pytest.param(CSVParserPlugin, "csv_content", id="csv-content"),
            pytest.param(HTTPClientPlugin, "headers", id="http-headers-as-a-whole"),
        ],
    )
    def test_given_null_by_an_expression_it_is_refused(self, block: type, setting: str) -> None:
        with refused(f"'{setting}' is null"):
            _resolve_plugin(
                block, {setting: "chosen"}, expressions={setting}, variables={"chosen": None}
            )


class TestLoopSettings:
    """A For count and a For Each collection take null (zero runs); a range mode start, end or
    step given null fails at the gate and names the setting."""

    def test_a_for_count_given_null_resolves_to_null(self) -> None:
        resolved = _resolve_control(
            ForControl,
            {"mode": "count", "count": "repeat"},
            expressions={"count"},
            variables={"repeat": None},
        )

        assert resolved == {"mode": "count", "count": None}

    def test_a_for_each_collection_holding_null_resolves_to_null(self) -> None:
        resolved = _resolve_control(
            ForEachControl, {"collection": "items"}, variables={"items": None}
        )

        assert resolved == {"collection": None}

    @pytest.mark.parametrize(
        ("block", "setting"),
        [
            pytest.param(ForControl, "count", id="for-count"),
            pytest.param(ForEachControl, "collection", id="for-each-collection"),
        ],
    )
    def test_the_loop_setting_takes_null(self, block: type, setting: str) -> None:
        assert _policies(block)[setting].accepts_null is True

    @pytest.mark.parametrize("setting", ["start", "end", "step"])
    def test_a_range_setting_given_null_is_refused(self, setting: str) -> None:
        values = {"mode": "range", "start": 0, "end": 3, "step": 1, setting: "chosen"}

        with refused(f"'{setting}' is null"):
            _resolve_control(ForControl, values, expressions={setting}, variables={"chosen": None})


class TestEmptyExpressions:
    """An expression with nothing typed is nothing given, never a null."""

    @pytest.mark.parametrize("text", ["", "   "], ids=["empty", "blank"])
    @pytest.mark.parametrize(
        ("block", "setting"),
        [
            pytest.param(K8sEventsPlugin, "session", id="required"),
            pytest.param(SSHSessionOpenPlugin, "port", id="defaulted"),
        ],
    )
    def test_an_empty_expression_is_nothing_given(
        self, block: type, setting: str, text: str
    ) -> None:
        assert _resolve_plugin(block, {setting: text}, expressions={setting}) == {setting: None}

    def test_an_empty_entry_expression_is_nothing_given(self) -> None:
        resolved = _resolve_plugin(
            HTTPClientPlugin, {"headers": {"X-Trace": ""}}, expressions={"headers.X-Trace"}
        )

        assert set(resolved["headers"]) == {"X-Trace"}


class TestLiteralNothingGiven:
    """A literal None in stored settings is nothing given; the gate judges only what an
    expression or a variable reference produced."""

    @pytest.mark.parametrize(
        ("block", "setting"),
        [
            pytest.param(K8sEventsPlugin, "session", id="required"),
            pytest.param(CSVParserPlugin, "csv_content", id="optional"),
            pytest.param(CSVParserPlugin, "table", id="reference"),
        ],
    )
    def test_a_literal_none_is_nothing_given(self, block: type, setting: str) -> None:
        assert _resolve_plugin(block, {setting: None}) == {setting: None}


class TestVariableReferences:
    """A setting that names a variable fails when that variable holds null."""

    def test_a_reference_whose_variable_holds_null_is_refused(self) -> None:
        with refused("'table' is null"):
            _resolve_plugin(CSVParserPlugin, {"table": "orders"}, variables={"orders": None})


class TestDataFields:
    """The data fields take null as a whole; every other setting refuses a whole null."""

    def test_the_log_message_takes_null(self) -> None:
        resolved = _resolve_plugin(
            LogPlugin,
            {"message": "note", "level": "INFO"},
            expressions={"message"},
            variables={"note": None},
        )

        assert resolved == {"message": None, "level": "INFO"}

    @pytest.mark.parametrize(
        ("block", "setting"),
        [
            pytest.param(PythonPlugin, "input_vars", id="python-input-vars"),
            pytest.param(SQLClientPlugin, "parameters", id="sql-parameters"),
            pytest.param(SQLClientPlugin, "arguments", id="sql-arguments"),
        ],
    )
    def test_a_whole_null_is_refused(self, block: type, setting: str) -> None:
        with refused(f"'{setting}' is null"):
            _resolve_plugin(
                block, {setting: "chosen"}, expressions={setting}, variables={"chosen": None}
            )

    def test_a_variable_setter_given_null_as_a_whole_is_refused(self) -> None:
        with refused("'variables' is null"):
            _resolve_control(
                VariableSetterControl,
                {"variables": "rows"},
                expressions={"variables"},
                variables={"rows": None},
            )

    def test_the_value_a_check_tests_is_not_judged(self) -> None:
        check = {
            "type": "literal",
            "variable": "status",
            "value_type": "string",
            "operator": "equals",
            "reference_value": "done",
        }

        resolved = _resolve_control(
            AssertControl, {"assertions": [check]}, variables={"status": None}
        )

        assert resolved == {"assertions": [check]}


NULL_ENTRY_EXPRESSIONS = [
    pytest.param(
        HTTPClientPlugin,
        {"headers": {"kept": "x", "X-Trace": "chosen"}},
        "headers.X-Trace",
        {"headers": {"kept": "x", "X-Trace": None}},
        id="http-header",
    ),
    pytest.param(
        K8sApplyPlugin,
        {"data": {"kept": "x", "app.conf": "chosen"}},
        "data.app.conf",
        {"data": {"kept": "x", "app.conf": None}},
        id="k8s-apply-data",
    ),
    pytest.param(
        PythonPlugin,
        {"input_vars": {"kept": "x", "COUNT": "chosen"}},
        "input_vars.COUNT",
        {"input_vars": {"kept": "x", "COUNT": None}},
        id="python-input-variable",
    ),
    pytest.param(
        HTTPClientPlugin,
        {"parts": [{"kind": "text", "name": "title", "value": "chosen"}]},
        "parts.0.value",
        {"parts": [{"kind": "text", "name": "title", "value": None}]},
        id="http-text-part",
    ),
    pytest.param(
        OpenSearchPlugin,
        {"fields": [{"value": "@timestamp"}, {"value": "chosen"}]},
        "fields.1.value",
        {"fields": [{"value": "@timestamp"}, {"value": None}]},
        id="opensearch-field-row",
    ),
]

STORED_NULL_ENTRIES = [
    pytest.param(HTTPClientPlugin, {"headers": {"kept": "x", "X-Trace": None}}, id="map-entry"),
    pytest.param(
        HTTPClientPlugin,
        {"parts": [{"kind": "text", "name": "title", "value": None}]},
        id="text-part-row",
    ),
    pytest.param(OpenSearchPlugin, {"stats": [{"value": None}]}, id="opensearch-stat-row"),
    pytest.param(SQLClientPlugin, {"driver_options": {"application_name": None}}, id="sql-map"),
]

WHOLE_EXPRESSIONS_WITH_NULL_ENTRIES = [
    pytest.param(HTTPClientPlugin, "headers", {"Accept": "*/*", "X-Trace": None}, id="map"),
    pytest.param(OpenSearchPlugin, "fields", [{"value": None}], id="rows"),
    pytest.param(HTTPClientPlugin, "retryable_status_codes", ["502", None], id="plain-items"),
]


class TestNullEntriesReachTheBlock:
    """The shared resolve passes a null list item or map value on as null; the Block decides
    what it means (REQ-3.1.3.21)."""

    @pytest.mark.parametrize(("block", "values", "entry", "expected"), NULL_ENTRY_EXPRESSIONS)
    def test_an_entry_expression_that_gives_null_reaches_the_block_as_null(
        self, block: type, values: dict[str, Any], entry: str, expected: dict[str, Any]
    ) -> None:
        resolved = _resolve_plugin(block, values, expressions={entry}, variables={"chosen": None})

        assert resolved == expected

    @pytest.mark.parametrize(("block", "values"), STORED_NULL_ENTRIES)
    def test_a_stored_null_entry_reaches_the_block_as_null(
        self, block: type, values: dict[str, Any]
    ) -> None:
        assert _resolve_plugin(block, values) == values

    @pytest.mark.parametrize("text", ["", "   "], ids=["empty", "blank"])
    def test_an_entry_expression_left_blank_reaches_the_block_as_null(self, text: str) -> None:
        resolved = _resolve_plugin(
            HTTPClientPlugin,
            {"headers": {"kept": "x", "X-Trace": text}},
            expressions={"headers.X-Trace"},
        )

        assert resolved == {"headers": {"kept": "x", "X-Trace": None}}

    @pytest.mark.parametrize(("block", "setting", "value"), WHOLE_EXPRESSIONS_WITH_NULL_ENTRIES)
    def test_a_whole_expression_holding_null_entries_reaches_the_block(
        self, block: type, setting: str, value: Any
    ) -> None:
        resolved = _resolve_plugin(
            block, {setting: "chosen"}, expressions={setting}, variables={"chosen": value}
        )

        assert resolved == {setting: value}

    def test_an_opensearch_query_map_from_an_expression_keeps_its_null_values(self) -> None:
        query = {"query": {"match_all": {}}, "search_after": None}

        resolved = _resolve_plugin(
            OpenSearchPlugin,
            {"query": "chosen"},
            expressions={"query"},
            variables={"chosen": query},
        )

        assert resolved == {"query": {"query": {"match_all": {}}, "search_after": None}}

    def test_the_stored_settings_are_left_as_they_were(self) -> None:
        values = {"headers": {"X-Trace": "chosen"}, "parts": [{"kind": "text", "value": "chosen"}]}

        _resolve_plugin(
            HTTPClientPlugin,
            values,
            expressions={"headers.X-Trace", "parts.0.value"},
            variables={"chosen": None},
        )

        assert values == {
            "headers": {"X-Trace": "chosen"},
            "parts": [{"kind": "text", "value": "chosen"}],
        }


class TestExpressionVariablesMayHoldNull:
    """The type check stays separate from the gate and lets null through."""

    @pytest.mark.parametrize(
        "declared", ["integer", ["array", "map", "table"]], ids=["one-type", "several-types"]
    )
    def test_the_type_check_lets_null_through(self, declared: str | list[str]) -> None:
        assert plugin_executor.check_expression_type("count", None, declared) is None


@pytest.fixture
def register_plugin(monkeypatch: pytest.MonkeyPatch) -> Callable[[type], dict[str, AsyncMock]]:
    """Register a real plugin block for this test, each step it would run mocked."""

    def register(block: type) -> dict[str, AsyncMock]:
        plugin = block()
        monkeypatch.setitem(
            plugin_registry._registry._plugins,
            str(plugin.metadata["id"]),
            {str(plugin.metadata["version"]): plugin},
        )
        steps = {step: AsyncMock(return_value={}) for step in ("validate", "initialize", "execute")}
        for step, mock in steps.items():
            monkeypatch.setattr(plugin, step, mock)
        monkeypatch.setattr(plugin, "cleanup", AsyncMock())
        return steps

    return register


@pytest.fixture
def core_controls(
    monkeypatch: pytest.MonkeyPatch,
) -> control_registry.ControlImplementationRegistry:
    """The core controls in a registry of this test's own."""
    controls = control_registry.ControlImplementationRegistry()
    control_registry.register_all_core_controls(controls)
    monkeypatch.setattr(control_registry, "_registry", controls)
    return controls


@pytest.fixture
def run_session() -> Iterator[str]:
    """A live workbench session the Function flow runs its Blocks in."""
    session_id = f"null-gate-{uuid.uuid4()}"
    workbench_common._workbench_sessions[session_id] = {
        "session_id": session_id,
        "status": "running",
        "block_states": {},
        "variables": {},
        "scope_failed": False,
        "breakpoints": set(),
        "debug_options": None,
        "pause_event": asyncio.Event(),
        "paused_node_id": None,
        "skipped_node_ids": [],
        "websocket_topic": f"workbench:{session_id}",
        "log_topic": f"log:{session_id}",
    }
    yield session_id
    workbench_common._clear_sessions_sync()


def _mocked_steps(
    controls: control_registry.ControlImplementationRegistry,
    control_id: ControlId,
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[AsyncMock, AsyncMock]:
    control = controls.get(control_id, "1.0.0")
    assert control is not None
    validate, execute = AsyncMock(), AsyncMock(return_value={})
    monkeypatch.setattr(control, "validate", validate)
    monkeypatch.setattr(control, "execute", execute)
    return validate, execute


def _function_running(element_type: str, values: dict[str, Any], expressions: list[str]) -> Any:
    """A Function whose Function flow is one plugin Block."""
    node = {
        "id": "body-block",
        "type": "workflowNode",
        "data": {
            "label": "body-block",
            "elementType": element_type,
            "nodeType": "plugin",
            "version": "1.0.0",
            "expressionFields": expressions,
            "config": {"values": values, "outputBindings": {}},
        },
    }
    return {
        "id": "gate-fn",
        "name": "gate",
        "inputs": [],
        "outputs": [],
        "variables": [],
        "workflow": {
            "nodes": [node],
            "edges": [{"source": "start-node", "target": "body-block"}],
        },
    }


async def _run_function_flow(function_def: Any, session_id: str) -> Any:
    return await function_executor.execute_function(
        function_def=function_def, inputs={}, session_id=session_id
    )


SSH_OPEN_VALUES = {"host": "target.local", "username": "wave", "port": "None"}
LOG_VALUES = {"message": "None", "level": "INFO"}
RANGE_VALUES = {"mode": "range", "start": 0, "end": 3, "step": 1}

RANGE_SETTINGS_GIVEN_NULL = [
    pytest.param(
        ControlId.FOR,
        {**RANGE_VALUES, setting: "chosen"},
        {setting},
        {"chosen": None},
        f"'{setting}' is null",
        id=f"for-range-{setting}",
    )
    for setting in ("start", "end", "step")
]

LOOPS_GIVEN_NULL = [
    pytest.param(
        ControlId.FOR,
        {"mode": "count", "count": "repeat"},
        {"count"},
        {"repeat": None},
        {"__loop_start": 0, "__loop_end": 0, "index": 0},
        id="for-count",
    ),
    pytest.param(
        ControlId.FOR_EACH,
        {"collection": "items"},
        set(),
        {"items": None},
        {"__collection": [], "index": 0},
        id="for-each-collection",
    ),
]


def _spied_steps(
    controls: control_registry.ControlImplementationRegistry,
    control_id: ControlId,
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[AsyncMock, AsyncMock]:
    """The control's own validate and execute, recorded as they run."""
    control = controls.get(control_id, "1.0.0")
    assert control is not None
    instance = control()
    validate = AsyncMock(side_effect=instance.validate)
    execute = AsyncMock(side_effect=instance.execute)
    monkeypatch.setattr(control, "validate", validate)
    monkeypatch.setattr(control, "execute", execute)
    return validate, execute


class TestTheRunPathsGate:
    """Every run path resolves a block with the block's own policies: a null setting fails
    before the block runs, and a data field still takes null."""

    async def test_a_workbench_plugin_block_fails_before_it_runs(
        self, register_plugin: Callable[[type], dict[str, AsyncMock]]
    ) -> None:
        steps = register_plugin(SSHSessionOpenPlugin)

        with refused("'port' is null"):
            await workbench_plugins._execute_plugin(
                plugin_type="ssh-session-open",
                version="1.0.0",
                parameters=dict(SSH_OPEN_VALUES),
                variables={},
                session_id=str(uuid.uuid4()),
                expression_fields={"port"},
            )

        for step in steps.values():
            step.assert_not_awaited()

    async def test_a_workbench_plugin_data_field_takes_null(
        self, register_plugin: Callable[[type], dict[str, AsyncMock]]
    ) -> None:
        steps = register_plugin(LogPlugin)

        await workbench_plugins._execute_plugin(
            plugin_type="log",
            version="1.0.0",
            parameters=dict(LOG_VALUES),
            variables={},
            session_id=str(uuid.uuid4()),
            expression_fields={"message"},
        )

        steps["validate"].assert_awaited_once_with({"message": None, "level": "INFO"})

    @pytest.mark.parametrize(
        ("control_id", "values", "expressions", "variables", "message"), RANGE_SETTINGS_GIVEN_NULL
    )
    async def test_a_workbench_control_block_fails_before_it_runs(
        self,
        core_controls: control_registry.ControlImplementationRegistry,
        monkeypatch: pytest.MonkeyPatch,
        control_id: ControlId,
        values: dict[str, Any],
        expressions: set[str],
        variables: dict[str, Any],
        message: str,
    ) -> None:
        validate, execute = _mocked_steps(core_controls, control_id, monkeypatch)

        with refused(message):
            await workbench_plugins._execute_control(
                control_id.value, "1.0.0", values, variables, expression_fields=expressions
            )

        validate.assert_not_awaited()
        execute.assert_not_awaited()

    @pytest.mark.parametrize(
        ("control_id", "values", "expressions", "variables", "zero_runs"), LOOPS_GIVEN_NULL
    )
    async def test_a_workbench_loop_given_null_runs_zero_times(
        self,
        core_controls: control_registry.ControlImplementationRegistry,
        monkeypatch: pytest.MonkeyPatch,
        control_id: ControlId,
        values: dict[str, Any],
        expressions: set[str],
        variables: dict[str, Any],
        zero_runs: dict[str, Any],
    ) -> None:
        validate, execute = _spied_steps(core_controls, control_id, monkeypatch)

        result = await workbench_plugins._execute_control(
            control_id.value, "1.0.0", values, variables, expression_fields=expressions
        )

        validate.assert_awaited_once()
        execute.assert_awaited_once()
        assert {key: result[key] for key in zero_runs} == zero_runs

    async def test_a_workbench_variable_setter_row_takes_null(
        self,
        core_controls: control_registry.ControlImplementationRegistry,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        validate, _execute = _mocked_steps(core_controls, ControlId.VARIABLE_SETTER, monkeypatch)

        await workbench_plugins._execute_control(
            "variable-setter",
            "1.0.0",
            {"variables": {"target": "None"}},
            {},
            setter_rows=workbench_plugins.SetterRows(expression_keys={"target"}),
        )

        validate.assert_awaited_once_with({"variables": {"target": None}})

    async def test_a_function_flow_block_fails_before_it_runs(
        self, register_plugin: Callable[[type], dict[str, AsyncMock]], run_session: str
    ) -> None:
        steps = register_plugin(SSHSessionOpenPlugin)

        result = await _run_function_flow(
            _function_running("ssh-session-open", dict(SSH_OPEN_VALUES), ["port"]), run_session
        )

        assert (result.status, result.error) == ("failed", "'port' is null")
        for step in steps.values():
            step.assert_not_awaited()

    async def test_a_function_flow_data_field_takes_null(
        self, register_plugin: Callable[[type], dict[str, AsyncMock]], run_session: str
    ) -> None:
        steps = register_plugin(LogPlugin)

        result = await _run_function_flow(
            _function_running("log", dict(LOG_VALUES), ["message"]), run_session
        )

        assert (result.status, result.error) == ("passed", None)
        steps["validate"].assert_awaited_once_with({"message": None, "level": "INFO"})


_STAND_IN_BY_TYPE: dict[str, Any] = {
    "integer": 1,
    "float": 1.5,
    "boolean": True,
    "array": ["x"],
    "map": {"k": "x"},
}


def _required_rest(metadata: Mapping[str, Any], setting: str) -> dict[str, Any]:
    """A non-null value for every other setting the block may require."""
    rest: dict[str, Any] = {}
    for row in metadata["parameters"]:
        required = row.get("required") or row.get("required_when") or row.get("required_when_all")
        if row["name"] == setting or not required:
            continue
        declared = row["type"][0] if isinstance(row["type"], list) else row["type"]
        enum_values = row.get("enum_values")
        rest[row["name"]] = enum_values[0] if enum_values else _STAND_IN_BY_TYPE.get(declared, "x")
    return rest


def _secret_settings() -> list[Any]:
    """Every credential setting each core plugin declares, read from the plugin's own metadata."""
    rows: list[Any] = []
    for name in plugin_package.__all__:
        block = getattr(plugin_package, name)
        metadata = block().metadata
        declared = {
            parameter["name"]: parameter
            for parameter in metadata["parameters"]
            if isinstance(parameter, dict)
        }
        for setting in sorted(secret_param_names(metadata)):
            rows.append(
                pytest.param(
                    block,
                    setting,
                    declared[setting]["type"],
                    _required_rest(metadata, setting),
                    id=f"{metadata['id']}-{setting}",
                )
            )
    return rows


SECRET_SETTINGS = _secret_settings()


async def _run_workbench_block(block: type, parameters: dict[str, Any]) -> Any:
    metadata = block().metadata
    return await workbench_plugins._execute_plugin(
        plugin_type=str(metadata["id"]),
        version=str(metadata["version"]),
        parameters=parameters,
        variables={},
        session_id=str(uuid.uuid4()),
    )


@pytest.mark.parametrize(("block", "setting", "declared_type", "rest"), SECRET_SETTINGS)
class TestSecretSettings:
    """A credential setting holding a literal null fails before the block runs and names the
    setting (REQ-3.1.3.21, REQ-3.1.3.18); empty text is a deliberately empty credential."""

    async def test_a_workbench_block_fails_before_it_runs(
        self,
        register_plugin: Callable[[type], dict[str, AsyncMock]],
        block: type,
        setting: str,
        declared_type: str,
        rest: dict[str, Any],
    ) -> None:
        steps = register_plugin(block)

        with refused(f"'{setting}' is null"):
            await _run_workbench_block(block, {**rest, setting: None})

        for step in steps.values():
            step.assert_not_awaited()

    async def test_a_function_flow_block_fails_before_it_runs(
        self,
        register_plugin: Callable[[type], dict[str, AsyncMock]],
        run_session: str,
        block: type,
        setting: str,
        declared_type: str,
        rest: dict[str, Any],
    ) -> None:
        steps = register_plugin(block)
        function_def = _function_running(str(block().metadata["id"]), {**rest, setting: None}, [])

        result = await _run_function_flow(function_def, run_session)

        assert (result.status, result.error) == ("failed", f"'{setting}' is null")
        for step in steps.values():
            step.assert_not_awaited()

    async def test_an_empty_credential_runs(
        self,
        register_plugin: Callable[[type], dict[str, AsyncMock]],
        block: type,
        setting: str,
        declared_type: str,
        rest: dict[str, Any],
    ) -> None:
        steps = register_plugin(block)
        empty: Any = {} if declared_type == "map" else ""

        await _run_workbench_block(block, {**rest, setting: empty})

        steps["execute"].assert_awaited_once()
