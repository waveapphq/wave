"""Block output core and table envelope tests (REQ-3.4.1.5, REQ-3.4.1.6, REQ-3.4.1.15).

The success/error/reason core the Block cores return, the fail-or-record dispatch that
writes its one WARN line through the log callable a core is handed, the Summary table
envelope and the value-typed table the SQL and OpenSearch cores build from rows.
"""

import inspect
import json
import re
import uuid
from datetime import date, datetime
from datetime import time as clock_time
from decimal import Decimal
from typing import Any

import pytest

from wavecore.connectivity import block_outputs
from wavecore.connectivity.block_outputs import block_failure, block_success
from wavecore.core.table import Table

_NOT_FOUND_MESSAGE = "K8s Pod 'web-1' not found in namespace 'apps'"
_CLUSTER_REASONS = ["NotFound", "AlreadyExists", "Forbidden", "Conflict"]
_BLOCK_ACTIONS = ["Read", "Apply", "Delete", "Scale", "Rollout"]
_APPLY_COLUMNS = [("RESOURCE", "string"), ("OUTCOME", "string")]
_ROLLOUT_COLUMNS = [("RESOURCE", "string"), ("OUTCOME", "string"), ("MESSAGE", "string")]
_SCALE_COLUMNS = [
    ("RESOURCE", "string"),
    ("OUTCOME", "string"),
    ("PREVIOUS", "integer"),
    ("REPLICAS", "integer"),
]
_COPY_COLUMNS = [("SOURCE", "string"), ("TARGET", "string"), ("SIZE", "integer")]
_APPLY_ROWS = [["configmap/probe-a", "created"], ["secret/db", "configured"]]
_ROLLOUT_ROWS = [["deployment.apps/web", "restarted", "deployment.apps/web restarted"]]
_SCALE_ROWS = [["deployment.apps/web", "scaled", 0, 3]]
_COPY_ROWS = [["/srv/probe.txt", "web-1:/srv/probe.txt", 12]]
_SUMMARY_SHAPES = [
    pytest.param(_APPLY_COLUMNS, _APPLY_ROWS, id="apply-delete"),
    pytest.param(_ROLLOUT_COLUMNS, _ROLLOUT_ROWS, id="rollout"),
    pytest.param(_SCALE_COLUMNS, _SCALE_ROWS, id="scale"),
    pytest.param(_COPY_COLUMNS, _COPY_ROWS, id="copy"),
]
_RESOURCE_SHAPES = [
    pytest.param(_APPLY_COLUMNS, id="apply-delete"),
    pytest.param(_ROLLOUT_COLUMNS, id="rollout"),
    pytest.param(_SCALE_COLUMNS, id="scale"),
]


def _exact(message: str) -> str:
    return f"^{re.escape(message)}$"


def _signature_of(function: Any, name: str) -> inspect.Parameter:
    return inspect.signature(function).parameters[name]


class _Log:
    """Records the (level, message) pairs a Block core writes through its log callable."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    def __call__(self, level: str, message: str) -> None:
        self.calls.append((level, message))


def _get_empties() -> dict[str, Any]:
    return {"result": {}, "names": [], "count": 0}


def _rebuilt(envelope: dict[str, Any]) -> Table:
    """The table a caller materializes from a summary envelope, minus its wire-type key."""
    return Table.from_dict({key: value for key, value in envelope.items() if key != "__wave_type"})


class TestBlockOutcome:
    """The output core and the on_error dispatch at their own seam."""

    def test_success_merges_the_core_after_the_unique_outputs(self) -> None:
        result = block_success({"logs": "line-1", "count": 1})

        assert result == {
            "logs": "line-1",
            "count": 1,
            "success": True,
            "error": "",
            "reason": "",
        }
        assert list(result) == ["logs", "count", "success", "error", "reason"]

    def test_success_sets_the_core_to_its_empty_values(self) -> None:
        result = block_success({})

        assert result["success"] is True
        assert result["error"] == ""
        assert result["reason"] == ""

    def test_success_does_not_mutate_the_outputs_it_is_given(self) -> None:
        outputs: dict[str, Any] = {"logs": "line-1"}

        block_success(outputs)

        assert outputs == {"logs": "line-1"}

    def test_record_returns_the_empty_defaults_with_the_failed_core(self) -> None:
        params = {"on_error": "record"}

        result = block_failure(
            params, _get_empties(), _NOT_FOUND_MESSAGE, "NotFound", _Log(), action="Read"
        )

        assert result == {
            "result": {},
            "names": [],
            "count": 0,
            "success": False,
            "error": _NOT_FOUND_MESSAGE,
            "reason": "NotFound",
            "__block_warning": True,
        }
        assert list(result) == [
            "result",
            "names",
            "count",
            "success",
            "error",
            "reason",
            "__block_warning",
        ]

    def test_record_keeps_success_false_as_a_boolean(self) -> None:
        params = {"on_error": "record"}

        result = block_failure(
            params, {"logs": ""}, _NOT_FOUND_MESSAGE, "NotFound", _Log(), action="Read"
        )

        assert result["success"] is False

    def test_record_does_not_mutate_the_empty_defaults(self) -> None:
        empties: dict[str, Any] = {"logs": ""}

        block_failure(
            {"on_error": "record"},
            empties,
            _NOT_FOUND_MESSAGE,
            "NotFound",
            _Log(),
            action="Read",
        )

        assert empties == {"logs": ""}

    @pytest.mark.parametrize("reason", _CLUSTER_REASONS)
    def test_cluster_reason_is_passed_through_verbatim(self, reason: str) -> None:
        params = {"on_error": "record"}

        result = block_failure(params, {}, _NOT_FOUND_MESSAGE, reason, _Log(), action="Read")

        assert result["reason"] == reason

    def test_an_unknown_reason_is_passed_through_unchanged(self) -> None:
        params = {"on_error": "record"}

        result = block_failure(
            params, {}, _NOT_FOUND_MESSAGE, "SomethingNew", _Log(), action="Read"
        )

        assert result["reason"] == "SomethingNew"

    def test_an_absent_reason_records_as_an_empty_string(self) -> None:
        params = {"on_error": "record"}

        result = block_failure(params, {}, _NOT_FOUND_MESSAGE, "", _Log(), action="Read")

        assert result["reason"] == ""

    def test_a_missing_reason_never_records_as_none(self) -> None:
        params = {"on_error": "record"}

        result = block_failure(params, {}, _NOT_FOUND_MESSAGE, None, _Log(), action="Read")

        assert result["reason"] == ""

    def test_fail_mode_raises_the_exact_message(self) -> None:
        params = {"on_error": "fail"}

        with pytest.raises(ValueError, match=_exact(_NOT_FOUND_MESSAGE)):
            block_failure(
                params, _get_empties(), _NOT_FOUND_MESSAGE, "NotFound", _Log(), action="Read"
            )

    def test_fail_is_the_default_when_on_error_is_absent(self) -> None:
        with pytest.raises(ValueError, match=_exact(_NOT_FOUND_MESSAGE)):
            block_failure({}, _get_empties(), _NOT_FOUND_MESSAGE, "NotFound", _Log(), action="Read")

    def test_only_record_records_and_any_other_value_raises(self) -> None:
        params = {"on_error": "continue"}

        with pytest.raises(ValueError, match=_exact(_NOT_FOUND_MESSAGE)):
            block_failure(
                params, _get_empties(), _NOT_FOUND_MESSAGE, "NotFound", _Log(), action="Read"
            )


class TestRecordedFailureIsAmber:
    """A recorded failure asks for the amber block status and says so at WARN."""

    def test_the_recorded_result_carries_the_warning_signal(self) -> None:
        result = block_failure(
            {"on_error": "record"}, {}, _NOT_FOUND_MESSAGE, "NotFound", _Log(), action="Read"
        )

        assert result["__block_warning"] is True

    def test_the_signal_is_the_last_key_so_the_outputs_keep_their_order(self) -> None:
        result = block_failure(
            {"on_error": "record"},
            {"logs": ""},
            _NOT_FOUND_MESSAGE,
            "NotFound",
            _Log(),
            action="Read",
        )

        assert list(result)[-1] == "__block_warning"

    def test_the_warn_line_names_the_reason_and_the_error_and_stops_there(self) -> None:
        log = _Log()

        block_failure(
            {"on_error": "record"}, {}, _NOT_FOUND_MESSAGE, "NotFound", log, action="Read"
        )

        assert log.calls == [("WARN", f"Read failed (NotFound): {_NOT_FOUND_MESSAGE}")]

    @pytest.mark.parametrize("reason", ["", None], ids=["empty", "absent"])
    def test_a_failure_with_no_cluster_reason_drops_the_parenthetical(
        self, reason: str | None
    ) -> None:
        log = _Log()

        block_failure({"on_error": "record"}, {}, _NOT_FOUND_MESSAGE, reason, log, action="Read")

        assert log.calls == [("WARN", f"Read failed: {_NOT_FOUND_MESSAGE}")]

    def test_the_level_is_warn_and_nothing_else(self) -> None:
        log = _Log()

        block_failure(
            {"on_error": "record"}, {}, _NOT_FOUND_MESSAGE, "NotFound", log, action="Read"
        )

        assert [level for level, _ in log.calls] == ["WARN"]

    @pytest.mark.parametrize("params", [{"on_error": "fail"}, {}], ids=["explicit", "default"])
    def test_fail_mode_raises_and_logs_nothing(self, params: dict[str, Any]) -> None:
        log = _Log()

        with pytest.raises(ValueError, match=_exact(_NOT_FOUND_MESSAGE)):
            block_failure(params, {}, _NOT_FOUND_MESSAGE, "NotFound", log, action="Read")

        assert log.calls == []


class TestRecordedFailureAction:
    """The WARN line heads with the block's own noun, not with the operation verb."""

    def test_the_action_is_keyword_only_and_has_no_default(self) -> None:
        parameter = _signature_of(block_failure, "action")

        assert parameter.kind is inspect.Parameter.KEYWORD_ONLY
        assert parameter.default is inspect.Parameter.empty

    @pytest.mark.parametrize("action", _BLOCK_ACTIONS)
    def test_the_line_names_the_action_then_the_reason(self, action: str) -> None:
        line = block_outputs._recorded_failure_line(action, _NOT_FOUND_MESSAGE, "NotFound")

        assert line == f"{action} failed (NotFound): {_NOT_FOUND_MESSAGE}"

    @pytest.mark.parametrize("action", _BLOCK_ACTIONS)
    def test_a_line_with_no_reason_drops_the_parenthetical(self, action: str) -> None:
        line = block_outputs._recorded_failure_line(action, _NOT_FOUND_MESSAGE, None)

        assert line == f"{action} failed: {_NOT_FOUND_MESSAGE}"

    @pytest.mark.parametrize("action", _BLOCK_ACTIONS)
    def test_the_dispatch_logs_the_action_it_was_handed(self, action: str) -> None:
        log = _Log()

        block_failure(
            {"on_error": "record"}, {}, _NOT_FOUND_MESSAGE, "NotFound", log, action=action
        )

        assert log.calls == [("WARN", f"{action} failed (NotFound): {_NOT_FOUND_MESSAGE}")]

    def test_the_action_never_reaches_the_recorded_outputs(self) -> None:
        result = block_failure(
            {"on_error": "record"},
            {},
            _NOT_FOUND_MESSAGE,
            "NotFound",
            _Log(),
            action="Apply",
        )

        assert set(result) == {"success", "error", "reason", "__block_warning"}

    @pytest.mark.parametrize("action", _BLOCK_ACTIONS)
    def test_fail_mode_raises_the_message_alone(self, action: str) -> None:
        with pytest.raises(ValueError, match=_exact(_NOT_FOUND_MESSAGE)):
            block_failure({}, {}, _NOT_FOUND_MESSAGE, "NotFound", _Log(), action=action)


class TestFailureLogCallable:
    """A verb has no logger object, only the log callable the engine hands it."""

    def test_the_log_callable_is_the_fifth_positional_parameter(self) -> None:
        parameter = _signature_of(block_failure, "log")

        assert parameter.kind is inspect.Parameter.POSITIONAL_OR_KEYWORD
        assert parameter.default is inspect.Parameter.empty

    def test_the_line_is_written_as_a_level_and_a_message_pair(self) -> None:
        recorded: list[tuple[str, str]] = []

        block_failure(
            {"on_error": "record"},
            {},
            _NOT_FOUND_MESSAGE,
            "NotFound",
            lambda level, message: recorded.append((level, message)),
            action="Read",
        )

        assert recorded == [("WARN", f"Read failed (NotFound): {_NOT_FOUND_MESSAGE}")]

    def test_a_plain_two_argument_function_is_log_enough(self) -> None:
        lines: list[str] = []

        def log(level: str, message: str) -> None:
            lines.append(f"{level} {message}")

        result = block_failure(
            {"on_error": "record"}, {}, _NOT_FOUND_MESSAGE, "NotFound", log, action="Read"
        )

        assert lines == [f"WARN Read failed (NotFound): {_NOT_FOUND_MESSAGE}"]
        assert result["__block_warning"] is True


class TestSummaryTableEnvelope:
    """The Summary table every write verb returns, as an envelope the caller materializes."""

    def test_the_value_is_a_table_envelope(self) -> None:
        assert block_outputs.summary_table(_APPLY_COLUMNS, [])["__wave_type"] == "table"

    def test_the_envelope_carries_only_the_three_wire_keys(self) -> None:
        envelope = block_outputs.summary_table(_APPLY_COLUMNS, _APPLY_ROWS)

        assert set(envelope) == {"__wave_type", "columns", "rows"}

    def test_the_columns_keep_the_order_they_were_declared_in(self) -> None:
        envelope = block_outputs.summary_table(_SCALE_COLUMNS, [])

        assert [column["name"] for column in envelope["columns"]] == [
            "RESOURCE",
            "OUTCOME",
            "PREVIOUS",
            "REPLICAS",
        ]

    def test_the_declared_column_types_are_the_ones_the_caller_named(self) -> None:
        envelope = block_outputs.summary_table(_SCALE_COLUMNS, [])

        assert [column["type"] for column in envelope["columns"]] == [
            "string",
            "string",
            "integer",
            "integer",
        ]

    def test_a_column_type_no_table_knows_is_carried_verbatim(self) -> None:
        envelope = block_outputs.summary_table([("AGE", "duration")], [])

        assert envelope["columns"] == [{"name": "AGE", "type": "duration"}]

    def test_the_rows_keep_the_order_they_were_given_in(self) -> None:
        envelope = block_outputs.summary_table(_APPLY_COLUMNS, _APPLY_ROWS)

        assert envelope["rows"] == [
            ["configmap/probe-a", "created"],
            ["secret/db", "configured"],
        ]

    def test_an_integer_cell_of_zero_stays_the_number_zero(self) -> None:
        envelope = block_outputs.summary_table(_SCALE_COLUMNS, _SCALE_ROWS)

        assert envelope["rows"] == [["deployment.apps/web", "scaled", 0, 3]]

    def test_a_row_shorter_than_the_columns_is_carried_unpadded(self) -> None:
        envelope = block_outputs.summary_table(_SCALE_COLUMNS, [["deployment.apps/web"]])

        assert envelope["rows"] == [["deployment.apps/web"]]

    def test_a_cell_the_declared_type_would_refuse_is_carried_anyway(self) -> None:
        envelope = block_outputs.summary_table(_SCALE_COLUMNS, [["web", "scaled", "two", 3]])

        assert envelope["rows"] == [["web", "scaled", "two", 3]]

    def test_no_rows_still_declares_the_columns(self) -> None:
        envelope = block_outputs.summary_table(_APPLY_COLUMNS, [])

        assert envelope["rows"] == []
        assert [column["name"] for column in envelope["columns"]] == ["RESOURCE", "OUTCOME"]

    def test_no_columns_and_no_rows_is_an_empty_table_envelope(self) -> None:
        empty = {"__wave_type": "table", "columns": [], "rows": []}

        assert block_outputs.summary_table([], []) == empty


class TestSummaryTableShapes:
    """The four shipped column shapes, so a later column change is caught here first."""

    def test_the_apply_and_delete_shape_is_resource_and_outcome(self) -> None:
        envelope = block_outputs.summary_table(_APPLY_COLUMNS, _APPLY_ROWS)

        assert envelope["columns"] == [
            {"name": "RESOURCE", "type": "string"},
            {"name": "OUTCOME", "type": "string"},
        ]

    def test_the_rollout_shape_adds_a_message_column(self) -> None:
        envelope = block_outputs.summary_table(_ROLLOUT_COLUMNS, _ROLLOUT_ROWS)

        assert envelope["columns"] == [
            {"name": "RESOURCE", "type": "string"},
            {"name": "OUTCOME", "type": "string"},
            {"name": "MESSAGE", "type": "string"},
        ]

    def test_the_scale_shape_ends_with_two_integer_counts(self) -> None:
        envelope = block_outputs.summary_table(_SCALE_COLUMNS, _SCALE_ROWS)

        assert envelope["columns"] == [
            {"name": "RESOURCE", "type": "string"},
            {"name": "OUTCOME", "type": "string"},
            {"name": "PREVIOUS", "type": "integer"},
            {"name": "REPLICAS", "type": "integer"},
        ]

    def test_the_copy_shape_is_source_target_and_size(self) -> None:
        envelope = block_outputs.summary_table(_COPY_COLUMNS, _COPY_ROWS)

        assert envelope["columns"] == [
            {"name": "SOURCE", "type": "string"},
            {"name": "TARGET", "type": "string"},
            {"name": "SIZE", "type": "integer"},
        ]

    @pytest.mark.parametrize("columns", _RESOURCE_SHAPES)
    def test_every_resource_shape_leads_with_resource_and_outcome(
        self, columns: list[tuple[str, str]]
    ) -> None:
        envelope = block_outputs.summary_table(columns, [])

        assert [column["name"] for column in envelope["columns"]][:2] == ["RESOURCE", "OUTCOME"]


class TestSummaryTableRoundTrip:
    """The envelope rides the wire as JSON and rebuilds the table the write verbs returned."""

    @pytest.mark.parametrize(("columns", "rows"), _SUMMARY_SHAPES)
    def test_the_envelope_survives_a_json_round_trip(
        self, columns: list[tuple[str, str]], rows: list[list[Any]]
    ) -> None:
        envelope = block_outputs.summary_table(columns, rows)

        assert json.loads(json.dumps(envelope)) == envelope

    @pytest.mark.parametrize(("columns", "rows"), _SUMMARY_SHAPES)
    def test_the_rebuilt_table_declares_the_columns_the_verb_named(
        self, columns: list[tuple[str, str]], rows: list[list[Any]]
    ) -> None:
        table = _rebuilt(block_outputs.summary_table(columns, rows))

        assert table.col_names() == [name for name, _type in columns]
        assert table.col_types() == [col_type for _name, col_type in columns]

    @pytest.mark.parametrize(("columns", "rows"), _SUMMARY_SHAPES)
    def test_the_rebuilt_table_carries_the_cells_the_verb_gave_it(
        self, columns: list[tuple[str, str]], rows: list[list[Any]]
    ) -> None:
        table = _rebuilt(block_outputs.summary_table(columns, rows))

        assert [list(entry.values()) for entry in table.to_list()] == rows


_IDENT = uuid.UUID("12345678-1234-5678-1234-567812345678")
_CELL_COLUMNS = [
    "amount",
    "ratio",
    "qty",
    "active",
    "name",
    "at",
    "day",
    "clock",
    "blob",
    "doc",
    "tags",
    "nothing",
    "mixed",
    "ident",
]
_CELL_ROWS: list[list[Any]] = [
    [
        Decimal("12.50"),
        1.5,
        1,
        True,
        "a",
        datetime(2026, 9, 23, 10, 30),
        date(2026, 9, 23),
        clock_time(10, 30),
        b"\x01\xab",
        {"a": 1},
        [1, "x"],
        None,
        1,
        _IDENT,
    ],
    [
        Decimal("1E+2"),
        2,
        None,
        False,
        "b",
        None,
        None,
        None,
        bytearray(b"\xff"),
        {"when": date(2026, 1, 1)},
        [],
        None,
        "a",
        None,
    ],
]


class TestValueColumnType:
    """A column's type comes from the values it holds (SQL-9, OS-8)."""

    @pytest.mark.parametrize(
        ("cells", "expected"),
        [
            pytest.param([], "string", id="no-cells"),
            pytest.param([None, None], "string", id="only-none"),
            pytest.param([True, False, None], "boolean", id="booleans"),
            pytest.param([1, 2, None], "integer", id="integers"),
            pytest.param([1, 1.5], "float", id="an-int-and-a-float"),
            pytest.param([1.0], "float", id="a-whole-float"),
            pytest.param([Decimal("12.50")], "float", id="a-decimal"),
            pytest.param([Decimal("100"), 2], "float", id="a-whole-decimal-and-an-int"),
            pytest.param([1, "a"], "string", id="a-number-and-text"),
            pytest.param([True, 1], "string", id="a-bool-and-an-int"),
            pytest.param(["a"], "string", id="text"),
            pytest.param([date(2026, 9, 23)], "string", id="a-date"),
            pytest.param([b"\x01"], "string", id="bytes"),
            pytest.param([{"a": 1}], "string", id="a-document"),
        ],
    )
    def test_the_type_the_values_share(self, cells: list[Any], expected: str) -> None:
        assert block_outputs.value_column_type(cells) == expected


class TestRenderedCell:
    """A cell as text: exact decimals, ISO times, hex bytes, JSON documents, else str()."""

    @pytest.mark.parametrize(
        ("value", "text"),
        [
            pytest.param(Decimal("12.50"), "12.50", id="decimal-keeps-its-scale"),
            pytest.param(Decimal("1E+2"), "100", id="decimal-exponent-written-out"),
            pytest.param(Decimal("-0.001"), "-0.001", id="small-negative-decimal"),
            pytest.param(datetime(2026, 9, 23, 10, 30), "2026-09-23T10:30:00", id="datetime"),
            pytest.param(date(2026, 9, 23), "2026-09-23", id="date"),
            pytest.param(clock_time(10, 30), "10:30:00", id="time"),
            pytest.param(b"\x01\xab", "01ab", id="bytes"),
            pytest.param(bytearray(b"\xff"), "ff", id="bytearray"),
            pytest.param(memoryview(b"\x00\x10"), "0010", id="memoryview"),
            pytest.param({"a": 1}, '{"a": 1}', id="dict"),
            pytest.param({"when": date(2026, 1, 1)}, '{"when": "2026-01-01"}', id="dict-of-date"),
            pytest.param([1, "x"], '[1, "x"]', id="list"),
            pytest.param([], "[]", id="empty-list"),
            pytest.param(_IDENT, str(_IDENT), id="uuid"),
            pytest.param(1, "1", id="int"),
            pytest.param(1.5, "1.5", id="float"),
            pytest.param(True, "True", id="bool"),
            pytest.param("a", "a", id="text"),
        ],
    )
    def test_the_text_of_a_value(self, value: Any, text: str) -> None:
        assert block_outputs.rendered_cell(value) == text


class TestTypedCell:
    """Each cell by its column's type: None stays None, string columns hold text."""

    @pytest.mark.parametrize("kind", ["string", "integer", "float", "boolean"])
    def test_none_stays_none(self, kind: str) -> None:
        assert block_outputs.typed_cell(None, kind) is None

    @pytest.mark.parametrize(
        ("value", "text"),
        [
            pytest.param(1, "1", id="int"),
            pytest.param("a", "a", id="text"),
            pytest.param(Decimal("12.50"), "12.50", id="decimal"),
            pytest.param(date(2026, 9, 23), "2026-09-23", id="date"),
            pytest.param({"a": 1}, '{"a": 1}', id="dict"),
        ],
    )
    def test_a_string_column_renders_the_value(self, value: Any, text: str) -> None:
        assert block_outputs.typed_cell(value, "string") == text

    def test_a_decimal_in_a_float_column_rides_as_exact_text(self) -> None:
        assert block_outputs.typed_cell(Decimal("12.50"), "float") == "12.50"

    @pytest.mark.parametrize(
        ("value", "kind"),
        [
            pytest.param(1.5, "float", id="float"),
            pytest.param(2, "float", id="int-in-a-float-column"),
            pytest.param(7, "integer", id="integer"),
            pytest.param(True, "boolean", id="boolean"),
        ],
    )
    def test_a_native_value_in_its_own_column_is_kept(self, value: Any, kind: str) -> None:
        assert block_outputs.typed_cell(value, kind) is value


class TestTypedTable:
    """Rows to a Summary table envelope with each column typed by its values (SQL-9, OS-8)."""

    def test_types_and_cells_follow_the_values(self) -> None:
        envelope = block_outputs.typed_table(_CELL_COLUMNS, _CELL_ROWS)

        assert envelope == {
            "__wave_type": "table",
            "columns": [
                {"name": "amount", "type": "float"},
                {"name": "ratio", "type": "float"},
                {"name": "qty", "type": "integer"},
                {"name": "active", "type": "boolean"},
                {"name": "name", "type": "string"},
                {"name": "at", "type": "string"},
                {"name": "day", "type": "string"},
                {"name": "clock", "type": "string"},
                {"name": "blob", "type": "string"},
                {"name": "doc", "type": "string"},
                {"name": "tags", "type": "string"},
                {"name": "nothing", "type": "string"},
                {"name": "mixed", "type": "string"},
                {"name": "ident", "type": "string"},
            ],
            "rows": [
                [
                    "12.50",
                    1.5,
                    1,
                    True,
                    "a",
                    "2026-09-23T10:30:00",
                    "2026-09-23",
                    "10:30:00",
                    "01ab",
                    '{"a": 1}',
                    '[1, "x"]',
                    None,
                    "1",
                    str(_IDENT),
                ],
                [
                    "100",
                    2,
                    None,
                    False,
                    "b",
                    None,
                    None,
                    None,
                    "ff",
                    '{"when": "2026-01-01"}',
                    "[]",
                    None,
                    "a",
                    None,
                ],
            ],
        }

    def test_no_rows_types_every_column_as_string(self) -> None:
        assert block_outputs.typed_table(["a", "b"], []) == {
            "__wave_type": "table",
            "columns": [{"name": "a", "type": "string"}, {"name": "b", "type": "string"}],
            "rows": [],
        }

    def test_no_columns_and_no_rows_is_the_empty_envelope(self) -> None:
        assert block_outputs.typed_table([], []) == block_outputs.summary_table([], [])

    def test_the_envelope_survives_a_json_round_trip(self) -> None:
        envelope = block_outputs.typed_table(_CELL_COLUMNS, _CELL_ROWS)

        assert json.loads(json.dumps(envelope)) == envelope

    def test_float_cells_rebuild_as_exact_decimals(self) -> None:
        envelope = block_outputs.typed_table(["amount"], [[Decimal("12.50")], [Decimal("1E+2")]])

        table = _rebuilt(envelope)

        assert table.col_types() == ["float"]
        assert table.col("amount") == [Decimal("12.50"), Decimal("100")]
