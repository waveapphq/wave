"""The plugin and control executors name their console lines by the block (EXEC-25).

Covers:
- _execute_plugin / _execute_plugin_with_session / _execute_control take the block's Name
  as `block_label`; they take no `description` and no `display_name`.
- The logger each executor builds carries the Source: the type's palette name alone when
  the Name matches it, else `{type} : {Name}`.
- Every line a plugin block or a control block writes carries that Source, and the
  Description never appears in it.
"""

import uuid
from collections.abc import Iterator
from inspect import signature
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from wavecore.api.services import log_streaming_service
from wavecore.api.services.workbench import _common as wb_common
from wavecore.api.services.workbench.node_helpers import _execute_node, _extract_node_fields
from wavecore.api.services.workbench.plugins import (
    _execute_control,
    _execute_plugin,
    _execute_plugin_with_session,
)

LONG_DESCRIPTION = "Calls the billing procedure and keeps what it returns for the checks below"


@pytest.fixture
def blocks() -> Iterator[None]:
    """The core controls and the Log plugin, registered as the engine reads them."""
    from wavecore.controls.registry import _registry, register_all_core_controls
    from wavecore.core.plugin_registry import clear_registry, register_plugin
    from wavecore.plugins.log import LogPlugin

    _registry.clear()
    register_all_core_controls(_registry)
    clear_registry()
    register_plugin(LogPlugin())
    yield
    clear_registry()


def _prime_session() -> str:
    session_id = str(uuid.uuid4())
    wb_common._workbench_sessions[session_id] = {
        "session_id": session_id,
        "status": "running",
        "block_states": {},
        "variables": {},
    }
    return session_id


def _block_node(
    element_type: str,
    node_type: str,
    label: str,
    values: dict[str, Any],
    *,
    expression_fields: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "id": "node-1",
        "type": "workflowNode",
        "data": {
            "label": label,
            "description": LONG_DESCRIPTION,
            "elementType": element_type,
            "nodeType": node_type,
            "version": "1.0.0",
            "config": {"values": values, "outputBindings": {}},
            "expressionFields": expression_fields or [],
            "templateFields": [],
            "variableExpressionKeys": [],
            "variableTypes": {},
        },
    }


async def _run_block(
    node: dict[str, Any], variables: dict[str, Any] | None = None
) -> list[dict[str, Any]]:
    """Run one block through the engine's node dispatch; return the lines it wrote."""
    session_id = _prime_session()
    try:
        await _execute_node(_extract_node_fields(node), variables or {}, session_id, "node-1")
        return list(log_streaming_service.get_logs(session_id))
    finally:
        wb_common._workbench_sessions.pop(session_id, None)


def _mock_plugin(name: str | None) -> MagicMock:
    plugin = MagicMock()
    plugin.metadata = {"parameters": [], **({"name": name} if name else {})}
    plugin.validate = AsyncMock()
    plugin.initialize = AsyncMock()
    plugin.execute = AsyncMock(return_value={"status": "ok"})
    plugin.cleanup = AsyncMock()
    return plugin


async def _plugin_logger_source(plugin_type: str, name: str | None, block_label: str | None) -> Any:
    """The source the plugin executor hands the block's logger."""
    with patch(
        "wavecore.api.services.workbench.plugins.SessionLogger",
        new=MagicMock(),
    ) as logger_cls:
        await _execute_plugin_with_session(
            plugin=_mock_plugin(name),
            plugin_type=plugin_type,
            parameters={},
            variables={},
            session_id="s-1",
            block_id="b-1",
            block_label=block_label,
            expression_fields=None,
            template_fields=None,
        )
        return logger_cls.call_args.kwargs["source"]


async def _control_logger_source(name: str | None, block_label: str | None) -> Any:
    """The source the control executor hands the block's logger."""
    with (
        patch("wavecore.controls.registry.get_control_implementation") as get_impl,
        patch(
            "wavecore.api.services.workbench.plugins.SessionLogger",
            new=MagicMock(),
        ) as logger_cls,
        patch(
            "wavecore.core.execution.plugin_executor.resolve_parameters",
            new=MagicMock(return_value={}),
        ),
    ):
        control_instance = MagicMock()
        control_instance.metadata = {"parameter_schema": [], **({"name": name} if name else {})}
        control_instance.validate = AsyncMock()
        control_instance.execute = AsyncMock(return_value={"status": "ok"})
        get_impl.return_value = MagicMock(return_value=control_instance)

        await _execute_control(
            control_type="delay",
            version="1.0.0",
            parameters={},
            variables={},
            session_id="s-1",
            block_id="b-1",
            block_label=block_label,
            expression_fields=None,
            template_fields=None,
        )
        return logger_cls.call_args.kwargs["source"]


class TestExecutePluginSignature:
    """The executors take the block's Name; the Description is not theirs to read."""

    def test_execute_plugin_signature_takes_the_block_label(self) -> None:
        params = signature(_execute_plugin).parameters
        assert "block_label" in params
        assert "description" not in params
        assert "display_name" not in params

    def test_execute_plugin_with_session_signature_takes_the_block_label(self) -> None:
        params = signature(_execute_plugin_with_session).parameters
        assert "block_label" in params
        assert "description" not in params
        assert "display_name" not in params

    def test_execute_control_signature_takes_the_block_label(self) -> None:
        params = signature(_execute_control).parameters
        assert "block_label" in params
        assert "description" not in params
        assert "display_name" not in params


class TestThePluginLoggerSource:
    """_execute_plugin_with_session builds the block's logger with the block's Source."""

    async def test_a_name_that_differs_follows_the_type(self) -> None:
        assert await _plugin_logger_source("http-client", "HTTP Client", "AuthCall") == (
            "HTTP : AuthCall"
        )

    async def test_no_name_shows_the_type_alone(self) -> None:
        assert await _plugin_logger_source("http-client", "HTTP Client", None) == "HTTP"

    async def test_the_palette_name_shows_the_type_alone(self) -> None:
        assert await _plugin_logger_source("http-client", "HTTP Client", "HTTP") == "HTTP"

    async def test_the_catalog_name_shows_the_type_alone(self) -> None:
        assert await _plugin_logger_source("http-client", "HTTP Client", "HTTP Client") == "HTTP"

    async def test_a_type_outside_the_table_shows_its_catalog_name(self) -> None:
        assert await _plugin_logger_source("sql-client", "SQL", "SQL_1") == "SQL : SQL_1"

    async def test_a_plugin_with_no_catalog_name_shows_its_type_id(self) -> None:
        assert await _plugin_logger_source("custom", None, "Probe") == "custom : Probe"


class TestTheControlLoggerSource:
    """_execute_control builds the block's logger with the block's Source."""

    async def test_a_name_that_differs_follows_the_type(self) -> None:
        assert await _control_logger_source("Delay", "Wait gateway") == "Delay : Wait gateway"

    async def test_no_name_shows_the_type_alone(self) -> None:
        assert await _control_logger_source("Delay", None) == "Delay"

    async def test_the_catalog_name_shows_the_type_alone(self) -> None:
        assert await _control_logger_source("Delay", "Delay") == "Delay"

    async def test_a_control_with_no_catalog_name_shows_its_type_id(self) -> None:
        assert await _control_logger_source(None, "Wait gateway") == "delay : Wait gateway"


@pytest.mark.usefixtures("blocks")
class TestAPluginBlocksLines:
    """Every line a plugin block writes carries the block's Source."""

    async def test_every_line_carries_the_type_and_the_name(self) -> None:
        node = _block_node(
            "log",
            "plugin",
            "Greet the user",
            {"message": "'hello'", "level": "INFO"},
            expression_fields=["message"],
        )

        lines = await _run_block(node)

        assert [line["message"] for line in lines if line["message"] == "hello"] == ["hello"]
        assert {line["source"] for line in lines} == {"Log : Greet the user"}

    async def test_a_block_named_as_its_type_shows_the_type_alone(self) -> None:
        node = _block_node(
            "log",
            "plugin",
            "Log",
            {"message": "'hello'", "level": "INFO"},
            expression_fields=["message"],
        )

        lines = await _run_block(node)

        assert len(lines) > 1
        assert {line["source"] for line in lines} == {"Log"}

    async def test_the_description_is_in_no_source(self) -> None:
        node = _block_node(
            "log",
            "plugin",
            "Greet the user",
            {"message": "'hello'", "level": "INFO"},
            expression_fields=["message"],
        )

        lines = await _run_block(node)

        assert len(lines) > 1
        assert [line["source"] for line in lines if LONG_DESCRIPTION in line["source"]] == []


@pytest.mark.usefixtures("blocks")
class TestAControlBlocksLines:
    """Every line a control block writes carries the block's Source."""

    async def test_every_line_carries_the_palette_type_and_the_name(self) -> None:
        node = _block_node("variable-setter", "control", "Set the totals", {"variables": {"n": 1}})

        lines = await _run_block(node, {"n": 0})

        assert len(lines) == 1
        assert lines[0]["message"].startswith("Set variable 'n' = 1")
        assert lines[0]["source"] == "Var Setter : Set the totals"

    async def test_a_block_named_as_the_catalog_names_it_shows_the_palette_name(self) -> None:
        node = _block_node("variable-setter", "control", "Variable Setter", {"variables": {"n": 1}})

        lines = await _run_block(node, {"n": 0})

        assert [line["source"] for line in lines] == ["Var Setter"]

    async def test_the_description_is_in_no_source(self) -> None:
        node = _block_node("variable-setter", "control", "Set the totals", {"variables": {"n": 1}})

        lines = await _run_block(node, {"n": 0})

        assert len(lines) == 1
        assert [line["source"] for line in lines if LONG_DESCRIPTION in line["source"]] == []


class TestNoDisplayNameSymbol:
    """Negative: the plugins module exports no `display_name` named parameters."""

    def test_plugins_module_does_not_expose_display_name_param(self) -> None:
        """No public-ish callable in plugins.py accepts a `display_name` parameter."""
        from wavecore.api.services.workbench import plugins as plugins_module

        for name in dir(plugins_module):
            attr = getattr(plugins_module, name)
            if not callable(attr):
                continue
            try:
                params = signature(attr).parameters
            except (TypeError, ValueError):
                continue
            assert (
                "display_name" not in params
            ), f"plugins.{name} still has a `display_name` parameter; rename to `description`."
