"""A setting that accepts a value of any type: the Log message (REQ-3.4.2.2, REQ-3.4.2.3).

An expression giving a whole value of another type is not refused by the declared type, and
the Log prints it in WAVE's print form (REQ-3.1.3.23); every other text setting keeps
refusing a value of the wrong type.
"""

import re
from collections.abc import Iterator
from typing import Any

import pytest

import wavecore.plugins as plugin_package
from wavecore.controls import registry as control_registry
from wavecore.core.execution import plugin_executor
from wavecore.core.expressions.errors import ExpressionTypeError
from wavecore.core.table import Table
from wavecore.models.controls.parameters import ControlParameter
from wavecore.models.plugins import PluginParameter
from wavecore.plugins.log import LogPlugin

SHAPES = [
    pytest.param(dict, id="plugin-dict"),
    pytest.param(PluginParameter, id="plugin-model"),
    pytest.param(ControlParameter, id="control-model"),
]


def _hosts_table() -> Table:
    table = Table(columns=[("host", "string"), ("port", "integer")])
    table.add_row(["web-1", 1])
    return table


WHOLE_VALUES = [
    pytest.param(True, "true", id="boolean-true"),
    pytest.param(False, "false", id="boolean-false"),
    pytest.param(42, "42", id="integer"),
    pytest.param(1.5, "1.5", id="float"),
    pytest.param([1, None], "[1,null]", id="list-with-null"),
    pytest.param({"a": None}, '{"a":null}', id="map-with-null"),
    pytest.param(
        _hosts_table(),
        '{"columns":[{"name":"host","type":"string"},'
        '{"name":"port","type":"integer"}],"rows":[["web-1",1]]}',
        id="table",
    ),
]


def exact(message: str) -> str:
    return f"^{re.escape(message)}$"


def _every_parameter() -> Iterator[tuple[str, Any]]:
    """Every parameter of every core plugin and control, as the models their catalog reads."""
    for name in plugin_package.__all__:
        plugin = getattr(plugin_package, name)()
        for parameter in plugin.get_plugin_model().parameters:
            yield str(plugin.metadata["id"]), parameter
    controls = control_registry.ControlImplementationRegistry()
    control_registry.register_all_core_controls(controls)
    for control_id in controls.list_control_ids():
        for version in controls.list_versions(control_id):
            control = controls.get(control_id, version)
            assert control is not None
            for parameter in control().metadata["parameter_schema"]:
                yield control_id.value, parameter


def _resolve_log(values: dict[str, Any], expressions: set[str], variables: dict[str, Any]) -> Any:
    """Resolve a Log block's settings the way a run does, with its own field policies."""
    metadata = LogPlugin().metadata
    types, trim_fields, references, _wire = plugin_executor.derive_parameter_metadata(
        metadata["parameters"]
    )
    return plugin_executor.resolve_parameters(
        values,
        expressions,
        dict(variables),
        types,
        trim_fields=trim_fields,
        reference_fields=references,
        null_policies=plugin_executor.null_policy_fields(metadata["parameters"]),
    )


class _InfoLogger:
    """Records each INFO line the plugin writes."""

    def __init__(self) -> None:
        self.messages: list[str] = []

    def info(self, msg: str) -> None:
        self.messages.append(msg)


class TestTheAnyTypeMark:
    """One per-field declaration, off unless the block's definition turns it on."""

    @pytest.mark.parametrize("model", [PluginParameter, ControlParameter])
    def test_a_parameter_does_not_accept_any_type_unless_it_declares_so(self, model: type) -> None:
        assert model(name="value", type="string").accepts_any_type is False

    @pytest.mark.parametrize("model", [PluginParameter, ControlParameter])
    def test_a_parameter_keeps_the_any_type_mark_it_declares(self, model: type) -> None:
        assert model(name="value", type="string", accepts_any_type=True).accepts_any_type is True

    def test_the_log_message_is_the_one_setting_of_any_block_that_accepts_any_type(self) -> None:
        marked = {
            (block, parameter.name)
            for block, parameter in _every_parameter()
            if parameter.accepts_any_type
        }

        assert marked == {("log", "message")}


@pytest.mark.parametrize("shape", SHAPES)
class TestThePolicyReadsTheMarkFromEitherShape:
    """A plugin's dict metadata and a control's models give the same policy."""

    def test_an_unmarked_setting_does_not_accept_any_type(self, shape: Any) -> None:
        policies = plugin_executor.null_policy_fields([shape(name="value", type="string")])

        assert policies["value"].accepts_any_type is False

    def test_a_marked_setting_accepts_any_type(self, shape: Any) -> None:
        policies = plugin_executor.null_policy_fields(
            [shape(name="value", type="string", accepts_any_type=True)]
        )

        assert policies["value"].accepts_any_type is True


class TestAnExpressionOfAnyTypeReachesTheLogMessage:
    """The run-time type check lets any whole value through the marked field only."""

    @pytest.mark.parametrize(("value", "_text"), WHOLE_VALUES)
    def test_a_whole_value_of_any_type_is_not_refused(self, value: Any, _text: str) -> None:
        resolved = _resolve_log({"message": "value"}, {"message"}, {"value": value})

        assert resolved["message"] is value

    def test_text_reaches_the_message_as_it_is(self) -> None:
        resolved = _resolve_log({"message": "value"}, {"message"}, {"value": "null"})

        assert resolved["message"] == "null"

    def test_a_null_message_still_takes_null(self) -> None:
        resolved = _resolve_log({"message": "value"}, {"message"}, {"value": None})

        assert resolved["message"] is None

    def test_an_unmarked_text_setting_still_refuses_a_boolean(self) -> None:
        with pytest.raises(
            ExpressionTypeError, match=exact("Parameter 'level' expects string, got bool")
        ):
            _resolve_log({"message": "'hi'", "level": "flag"}, {"level"}, {"flag": True})

    def test_an_unmarked_text_setting_still_refuses_a_list(self) -> None:
        policies = plugin_executor.null_policy_fields([{"name": "url", "type": "string"}])

        with pytest.raises(
            ExpressionTypeError, match=exact("Parameter 'url' expects string, got list")
        ):
            plugin_executor.resolve_parameters(
                {"url": "items"},
                {"url"},
                {"items": [1, None]},
                {"url": "string"},
                null_policies=policies,
            )


class TestTheLogLinePrintsTheWholeValue:
    """Resolved, validated and run, the Log writes the value in WAVE's print form."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize(("value", "text"), WHOLE_VALUES)
    async def test_a_whole_value_prints_in_the_print_form(self, value: Any, text: str) -> None:
        plugin = LogPlugin()
        logger = _InfoLogger()
        resolved = _resolve_log({"message": "value"}, {"message"}, {"value": value})

        await plugin.validate(resolved)
        await plugin.execute({"parameters": resolved, "logger": logger})

        assert logger.messages == [text]
