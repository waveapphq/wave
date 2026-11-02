"""
Result-envelope materialization contract tests (REQ-3.4.1.3, REQ-3.1.3.5).

A K8s verb runs on either locus and must answer in JSON-safe shapes only, so it
returns an envelope instead of a Table or rendered YAML. materialize turns that
envelope back into the runtime outputs a block binds: a table envelope becomes a
Table, a yaml envelope becomes YAML text, and every value the envelope declares
secret registers with the run BEFORE any output is handed back, so nothing that
reads the outputs can print an unregistered credential.

Everything else passes through untouched - detection is keyed on the
__wave_type tag alone, never on the shape of a value, so the HTTP response dict
the remote worker already returns is the very same object on the way out.
"""

import json
import re
from collections.abc import ItemsView, Iterator, KeysView, ValuesView
from decimal import Decimal
from typing import Any

import pytest
import yaml

from wavecore.core.remote_exec.materialize import materialize
from wavecore.core.table import Table

_NO_OUTPUTS_MESSAGE = "Remote result envelope carries no outputs"


class _Recorder:
    """A register_secret stub recording every call as (args, kwargs)."""

    def __init__(self, timeline: list[Any] | None = None) -> None:
        self.calls: list[tuple[tuple[Any, ...], dict[str, Any]]] = []
        self.timeline: list[Any] = timeline if timeline is not None else []

    def __call__(self, *args: Any, **kwargs: Any) -> None:
        self.calls.append((args, kwargs))
        self.timeline.append(("secret", args[0] if args else None))

    @property
    def values(self) -> list[Any]:
        """The first positional argument of every call, in call order."""
        return [args[0] for args, _kwargs in self.calls]


class _WatchedOutputs(dict[str, Any]):
    """An outputs mapping that stamps the timeline the first time it is read.

    Interleaving that stamp with the recorder's calls is what proves the
    ordering: counting registrations alone cannot tell secrets-first from
    secrets-last.
    """

    def __init__(self, timeline: list[Any], data: dict[str, Any]) -> None:
        super().__init__(data)
        self.timeline = timeline

    def _stamp(self) -> None:
        if "outputs-read" not in self.timeline:
            self.timeline.append("outputs-read")

    def __iter__(self) -> Iterator[str]:
        self._stamp()
        return super().__iter__()

    def __getitem__(self, key: str) -> Any:
        self._stamp()
        return super().__getitem__(key)

    def keys(self) -> KeysView[str]:
        self._stamp()
        return super().keys()

    def values(self) -> ValuesView[Any]:
        self._stamp()
        return super().values()

    def items(self) -> ItemsView[str, Any]:
        self._stamp()
        return super().items()

    def copy(self) -> dict[str, Any]:
        self._stamp()
        return super().copy()


def _table_envelope(columns: list[dict[str, str]], rows: list[list[Any]]) -> dict[str, Any]:
    """The table envelope a verb emits in place of a Table."""
    return {"__wave_type": "table", "columns": columns, "rows": rows}


def _yaml_envelope(value: Any) -> dict[str, Any]:
    """The yaml envelope a verb emits in place of rendered YAML text."""
    return {"__wave_type": "yaml", "value": value}


def _result_envelope(
    outputs: Any = None, secrets: Any = None, *, omit: tuple[str, ...] = ()
) -> dict[str, Any]:
    """The result envelope a verb returns; ``omit`` drops a key entirely."""
    envelope: dict[str, Any] = {"__wave_type": "result"}
    if "outputs" not in omit:
        envelope["outputs"] = {} if outputs is None else outputs
    if "secrets" not in omit:
        envelope["secrets"] = [] if secrets is None else secrets
    return envelope


def _envelope_carrying(outputs: Any) -> dict[str, Any]:
    """A result envelope carrying exactly the outputs value given, None included."""
    return {"__wave_type": "result", "outputs": outputs, "secrets": []}


def _exact(message: str) -> str:
    return f"^{re.escape(message)}$"


class TestResultEnvelope:
    """A result envelope registers its secrets, then yields its outputs."""

    def test_result_envelope_returns_its_outputs(self) -> None:
        envelope = _result_envelope({"success": True, "error": "", "reason": ""})

        assert materialize(envelope, _Recorder()) == {
            "success": True,
            "error": "",
            "reason": "",
        }

    def test_scalar_outputs_are_the_same_objects(self) -> None:
        names = ["a", "b"]
        outputs = materialize(_result_envelope({"names": names}), _Recorder())

        assert outputs["names"] is names

    def test_secrets_register_before_any_output_is_read(self) -> None:
        """The ordering guarantee: nothing reads the outputs until every
        declared secret is registered with the run."""
        timeline: list[Any] = []
        recorder = _Recorder(timeline)
        envelope = _result_envelope(
            _WatchedOutputs(
                timeline,
                {"result": _table_envelope([{"name": "NAME", "type": "string"}], [["pod-a"]])},
            ),
            ["planted-value", "cGxhbnRlZC12YWx1ZQ=="],
        )

        materialize(envelope, recorder)

        assert timeline == [
            ("secret", "planted-value"),
            ("secret", "cGxhbnRlZC12YWx1ZQ=="),
            "outputs-read",
        ]

    def test_missing_secrets_still_converts_outputs(self) -> None:
        recorder = _Recorder()
        envelope = _result_envelope(
            {"result": _yaml_envelope({"kind": "ConfigMap"})}, omit=("secrets",)
        )

        outputs = materialize(envelope, recorder)

        assert outputs == {"result": "kind: ConfigMap\n"}
        assert recorder.calls == []

    def test_none_secrets_registers_nothing(self) -> None:
        recorder = _Recorder()

        outputs = materialize(_result_envelope({"success": True}, None), recorder)

        assert outputs == {"success": True}
        assert recorder.calls == []

    def test_a_non_list_secrets_value_registers_nothing(self) -> None:
        """Defensive: a malformed secrets field is ignored, never raised on."""
        recorder = _Recorder()

        outputs = materialize(_result_envelope({"success": True}, "planted"), recorder)

        assert outputs == {"success": True}
        assert recorder.calls == []

    def test_table_and_yaml_outputs_convert_side_by_side(self) -> None:
        recorder = _Recorder()
        envelope = _result_envelope(
            {
                "success": True,
                "error": "",
                "reason": "",
                "names": ["a", "b"],
                "usage": _table_envelope(
                    [{"name": "NAME", "type": "string"}, {"name": "CPU", "type": "float"}],
                    [["pod-a", "0.5"]],
                ),
                "result": _yaml_envelope({"kind": "ConfigMap"}),
            },
            ["s1"],
        )

        outputs = materialize(envelope, recorder)

        assert isinstance(outputs["usage"], Table)
        assert outputs["result"] == "kind: ConfigMap\n"
        assert outputs["names"] == ["a", "b"]
        assert outputs["success"] is True
        assert recorder.values == ["s1"]

    def test_an_envelope_inside_a_list_output_is_left_alone(self) -> None:
        """Conversion is one level deep: a deeper walk would misfire on user data."""
        nested = _table_envelope([{"name": "NAME", "type": "string"}], [["pod-a"]])

        outputs = materialize(_result_envelope({"x": [nested]}), _Recorder())

        assert outputs["x"] == [nested]
        assert outputs["x"][0] is nested

    def test_an_envelope_inside_a_dict_output_is_left_alone(self) -> None:
        nested = _yaml_envelope({"kind": "ConfigMap"})

        outputs = materialize(_result_envelope({"x": {"inner": nested}}), _Recorder())

        assert outputs["x"] == {"inner": nested}

    def test_a_result_envelope_inside_outputs_is_not_unwrapped(self) -> None:
        inner = _result_envelope({"success": True}, ["inner-secret"])
        recorder = _Recorder()

        outputs = materialize(_result_envelope({"x": inner}), recorder)

        assert outputs["x"] is inner
        assert recorder.calls == []


class TestAResultEnvelopeWithNoOutputs:
    """No outputs mapping is no answer: the block fails with the reason, it never
    passes with whatever its variables held last time."""

    def test_a_missing_outputs_key_raises(self) -> None:
        envelope = _result_envelope(secrets=["planted"], omit=("outputs",))

        with pytest.raises(ValueError, match=_exact(_NO_OUTPUTS_MESSAGE)):
            materialize(envelope, _Recorder())

    @pytest.mark.parametrize(
        "outputs",
        [None, [], ["result"], "", "outputs", 0, 7, 1.5, (), Table(columns=[])],
    )
    def test_an_outputs_value_that_is_not_a_mapping_raises(self, outputs: Any) -> None:
        with pytest.raises(ValueError, match=_exact(_NO_OUTPUTS_MESSAGE)):
            materialize(_envelope_carrying(outputs), _Recorder())

    def test_the_secrets_it_already_declared_stay_registered(self) -> None:
        """A credential the envelope named is scrubbed even though the read failed."""
        recorder = _Recorder()
        envelope = _result_envelope(secrets=["planted"], omit=("outputs",))

        with pytest.raises(ValueError, match=_exact(_NO_OUTPUTS_MESSAGE)):
            materialize(envelope, recorder)

        assert recorder.values == ["planted"]

    def test_an_empty_outputs_mapping_is_still_a_valid_answer(self) -> None:
        assert materialize(_envelope_carrying({}), _Recorder()) == {}


class TestTableEnvelope:
    """A table envelope becomes the Table its verb would have built locally."""

    def test_bare_table_envelope_becomes_a_table(self) -> None:
        expected = Table(columns=[("NAME", "string"), ("CPU", "float")])
        expected.add_row(["pod-a", Decimal("0.5")])
        expected.add_row(["pod-b", Decimal("1.25")])
        envelope = _table_envelope(
            [{"name": "NAME", "type": "string"}, {"name": "CPU", "type": "float"}],
            [["pod-a", "0.5"], ["pod-b", "1.25"]],
        )

        table = materialize(envelope)

        assert isinstance(table, Table)
        assert table.to_dict() == expected.to_dict()

    def test_all_four_column_types_survive_the_envelope(self) -> None:
        expected = Table(
            columns=[
                ("NAME", "string"),
                ("REPLICAS", "integer"),
                ("CPU", "float"),
                ("READY", "boolean"),
            ]
        )
        expected.add_row(["pod-a", 3, Decimal("0.5"), True])
        envelope = _table_envelope(
            [
                {"name": "NAME", "type": "string"},
                {"name": "REPLICAS", "type": "integer"},
                {"name": "CPU", "type": "float"},
                {"name": "READY", "type": "boolean"},
            ],
            [["pod-a", 3, "0.5", True]],
        )

        table = materialize(envelope)

        assert table.col_names() == ["NAME", "REPLICAS", "CPU", "READY"]
        assert table.col_types() == ["string", "integer", "float", "boolean"]
        assert table.to_dict() == expected.to_dict()

    def test_none_cells_survive_the_envelope(self) -> None:
        envelope = _table_envelope(
            [{"name": "NAME", "type": "string"}, {"name": "CPU", "type": "float"}],
            [["pod-a", None], [None, None]],
        )

        table = materialize(envelope)

        assert table[0]["CPU"] is None
        assert table[1]["NAME"] is None

    def test_an_integer_digit_string_returns_as_an_int(self) -> None:
        envelope = _table_envelope([{"name": "REPLICAS", "type": "integer"}], [["42"]])

        table = materialize(envelope)

        assert table[0]["REPLICAS"] == 42
        assert isinstance(table[0]["REPLICAS"], int)

    def test_an_empty_table_envelope_becomes_an_empty_table(self) -> None:
        table = materialize(_table_envelope([], []))

        assert isinstance(table, Table)
        assert table.row_count() == 0
        assert table.col_names() == []

    def test_a_float_cell_survives_the_whole_json_round_trip_exactly(self) -> None:
        """Metrics-server reports CPU in nanocores: the exact decimal must
        survive Table -> to_dict -> JSON -> materialize -> Table, which a float
        round trip would not."""
        nanocores = Decimal("0.000000123456789")
        source = Table(columns=[("NAME", "string"), ("CPU", "float")])
        source.add_row(["pod-a", nanocores])
        envelope = _result_envelope({"usage": {"__wave_type": "table", **source.to_dict()}})

        outputs = materialize(json.loads(json.dumps(envelope)))

        assert outputs["usage"][0]["CPU"] == nanocores


class TestYamlEnvelope:
    """A yaml envelope renders exactly as the local verb rendered it."""

    def test_yaml_envelope_renders_with_safe_dump(self) -> None:
        value = {"kind": "ConfigMap", "metadata": {"name": "cm"}}

        assert materialize(_yaml_envelope(value)) == yaml.safe_dump(value, sort_keys=True)

    def test_yaml_envelope_sorts_keys_at_every_level_like_kubectl(self) -> None:
        value = {
            "kind": "ConfigMap",
            "apiVersion": "v1",
            "metadata": {"namespace": "apps", "name": "cm"},
        }

        rendered = materialize(_yaml_envelope(value))

        assert (
            rendered
            == "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: cm\n  namespace: apps\n"
        )

    def test_an_empty_mapping_renders_as_the_empty_string(self) -> None:
        """safe_dump({}) is "{}\\n", so the falsy guard carries the contract."""
        assert yaml.safe_dump({}, sort_keys=True) == "{}\n"
        assert materialize(_yaml_envelope({})) == ""

    def test_a_none_value_renders_as_the_empty_string(self) -> None:
        assert materialize(_yaml_envelope(None)) == ""

    def test_an_empty_list_renders_as_the_empty_string(self) -> None:
        assert materialize(_yaml_envelope([])) == ""

    def test_a_yaml_envelope_inside_outputs_renders(self) -> None:
        outputs = materialize(_result_envelope({"result": _yaml_envelope({"kind": "ConfigMap"})}))

        assert outputs["result"] == "kind: ConfigMap\n"


class TestPassThrough:
    """Detection is keyed on __wave_type alone; everything else is untouched."""

    def test_a_plain_dict_is_the_same_object(self) -> None:
        """The remote HTTP response dict must not be rebuilt on its way out."""
        response = {"status_code": 200, "body": "ok", "headers": {"X": "y"}}

        assert materialize(response) is response

    def test_a_columns_dict_without_the_type_tag_is_not_converted(self) -> None:
        looks_like_a_table = {
            "columns": [{"name": "NAME", "type": "string"}],
            "rows": [["pod-a"]],
        }

        assert materialize(looks_like_a_table) is looks_like_a_table

    def test_an_unknown_wave_type_is_returned_unchanged(self) -> None:
        unknown = {"__wave_type": "banana", "value": 1}

        assert materialize(unknown) is unknown

    def test_none_is_returned_unchanged(self) -> None:
        assert materialize(None) is None

    def test_scalars_are_returned_unchanged(self) -> None:
        assert materialize("a string") == "a string"
        assert materialize(42) == 42
        assert materialize(True) is True

    def test_a_list_is_the_same_object(self) -> None:
        values = [1, 2, 3]

        assert materialize(values) is values

    def test_a_table_instance_is_returned_unchanged(self) -> None:
        table = Table(columns=[("NAME", "string")])

        assert materialize(table) is table

    def test_an_arbitrary_object_is_returned_unchanged(self) -> None:
        sentinel = object()

        assert materialize(sentinel) is sentinel


class TestSecretRegistration:
    """REQ-3.1.3.5: envelope secrets reach the run registry, one call each."""

    def test_the_hook_may_be_omitted_entirely(self) -> None:
        outputs = materialize(_result_envelope({"success": True}, ["planted"]))

        assert outputs == {"success": True}

    def test_a_none_hook_still_converts_outputs(self) -> None:
        outputs = materialize(
            _result_envelope({"result": _yaml_envelope({"kind": "ConfigMap"})}, ["planted"]),
            None,
        )

        assert outputs == {"result": "kind: ConfigMap\n"}

    def test_a_non_callable_hook_still_converts_outputs(self) -> None:
        """A MagicMock attribute lookup can yield a non-callable; it must not explode."""
        outputs = materialize(
            _result_envelope({"result": _yaml_envelope({"kind": "ConfigMap"})}, ["planted"]),
            "not-callable",
        )

        assert outputs == {"result": "kind: ConfigMap\n"}

    def test_one_call_per_entry_in_list_order(self) -> None:
        recorder = _Recorder()

        materialize(_result_envelope({}, ["first", "second", "third"]), recorder)

        assert recorder.values == ["first", "second", "third"]

    def test_a_repeated_entry_registers_twice(self) -> None:
        recorder = _Recorder()

        materialize(_result_envelope({}, ["planted", "planted"]), recorder)

        assert len(recorder.calls) == 2

    def test_the_hook_is_called_with_exactly_one_argument(self) -> None:
        """The run hook's second argument marks a value revealed; an envelope
        secret has no reveal context and must never claim one."""
        recorder = _Recorder()

        materialize(_result_envelope({}, ["planted"]), recorder)

        args, kwargs = recorder.calls[0]
        assert args == ("planted",)
        assert kwargs == {}

    def test_a_non_string_entry_is_passed_verbatim(self) -> None:
        recorder = _Recorder()

        materialize(_result_envelope({}, [1234, None, {"k": "v"}]), recorder)

        assert recorder.values == [1234, None, {"k": "v"}]

    def test_an_empty_secrets_list_registers_nothing(self) -> None:
        recorder = _Recorder()

        materialize(_result_envelope({"success": True}, []), recorder)

        assert recorder.calls == []
