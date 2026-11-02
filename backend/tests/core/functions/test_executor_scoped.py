"""Unit tests for the drilled-in scoped Function run (REQ-3.2.1.1).

Run Scope from a drilled-in Function level runs only that Function as a
discrete unit:

- Same pipeline as a Function Block - fresh runtime scope, value-copied inputs,
  isolated execution, output collection.
- Each input starts from the value given for it: the Function Block's field resolved
  over the outer flow's last state, or the Current value set before the run.
- An input no value names starts on its declared default (a Required one too, on a run
  alone); with no given values at all the platform surfaces an advisory note that
  prior-run state was unavailable.
- Output bindings are NOT applied to the outer flow; the result document is shown in the
  workbench's execution panel for inspection.
"""

from __future__ import annotations

import re
from typing import Any

import pytest

from wavecore.core.functions.executor import ScopedStart

from .conftest import (
    local_function,
    make_echo_function,
    make_function_block,
    make_function_def,
    make_log_node,
)


def _reads_x() -> dict[str, Any]:
    return make_echo_function("x", {"type": "string", "required": True}, "x")


class TestPriorStatePresent:
    """When the start carries given values, the inputs come from them."""

    @pytest.mark.asyncio
    async def test_inputs_sourced_from_the_given_values(self, session_id: str) -> None:
        from wavecore.core.functions.executor import execute_scoped_function

        result = await execute_scoped_function(
            function_def=_reads_x(),
            start=ScopedStart(input_values={"x": "cached-value"}),
            session_id=session_id,
        )

        assert result.outputs.get("result") == "cached-value"
        assert result.advisory is None

    @pytest.mark.asyncio
    async def test_advisory_not_emitted_when_state_present(self, session_id: str) -> None:
        from wavecore.core.functions.executor import execute_scoped_function

        result = await execute_scoped_function(
            function_def=_reads_x(),
            start=ScopedStart(input_values={"x": "present"}),
            session_id=session_id,
        )

        assert result.advisory is None


class TestPriorStateAbsent:
    """When the start carries no given values, inputs fall back to declared defaults."""

    @staticmethod
    def _defaults_input(default: str) -> dict[str, Any]:
        return make_echo_function(
            "x", {"type": "string", "required": True, "default": default}, "x"
        )

    @pytest.mark.asyncio
    async def test_a_required_input_runs_on_its_stored_default(self, session_id: str) -> None:
        from wavecore.core.functions.executor import execute_scoped_function

        result = await execute_scoped_function(
            function_def=self._defaults_input("declared-default"), session_id=session_id
        )

        assert result.status == "passed", result.error
        assert result.outputs == {"result": "declared-default"}

    @pytest.mark.asyncio
    async def test_advisory_emitted_when_state_missing(self, session_id: str) -> None:
        from wavecore.core.functions.executor import execute_scoped_function

        result = await execute_scoped_function(
            function_def=self._defaults_input("d"), session_id=session_id
        )

        assert result.advisory == (
            "Clean scope state - the Function ran with declared default values for "
            "its inputs (no prior Test run to inherit from)."
        )


class TestOutputBindingsNotApplied:
    """A drilled-in run does NOT write its outputs back anywhere outside the Function."""

    @pytest.mark.asyncio
    async def test_the_given_values_are_not_changed_on_success(self, session_id: str) -> None:
        from wavecore.core.functions.executor import execute_scoped_function

        function_def = make_function_def(
            name="produces_output",
            inputs=[{"name": "untouched", "type": "string"}],
            outputs=[{"name": "result", "type": "string"}],
            nodes=[
                make_log_node("write", message="'side-effect'", output_bindings={"line": "result"})
            ],
            edges=[{"source": "start-node", "target": "write"}],
        )
        given: dict[str, Any] = {"untouched": "x"}

        result = await execute_scoped_function(
            function_def=function_def,
            start=ScopedStart(input_values=given),
            session_id=session_id,
        )

        assert result.outputs.get("result") == "side-effect"
        assert given == {"untouched": "x"}


class TestResultDocument:
    """The scoped run returns a result document with status + outputs."""

    @pytest.mark.asyncio
    async def test_status_passed_on_clean_run(self, session_id: str) -> None:
        from wavecore.core.functions.executor import execute_scoped_function

        function_def = make_function_def(
            name="ok",
            outputs=[{"name": "r", "type": "string"}],
            nodes=[make_log_node("n", message="'x'", output_bindings={"line": "r"})],
            edges=[{"source": "start-node", "target": "n"}],
        )

        result = await execute_scoped_function(function_def=function_def, session_id=session_id)

        assert result.status == "passed"

    @pytest.mark.asyncio
    async def test_status_failed_on_body_error(self, session_id: str) -> None:
        from wavecore.core.functions.executor import execute_scoped_function

        function_def = make_function_def(
            name="fails",
            nodes=[make_log_node("bad", message="undefined_local")],
            edges=[{"source": "start-node", "target": "bad"}],
        )

        result = await execute_scoped_function(function_def=function_def, session_id=session_id)

        assert result.status == "failed"
        assert result.error == "Variable 'undefined_local' is not defined"


def _enum(value_type: str, allowed: list[Any], default: Any) -> dict[str, Any]:
    return {"type": value_type, "required": True, "enumValues": allowed, "default": default}


REQUIRED_WITH_A_DEFAULT = [
    pytest.param({"type": "string", "required": True, "default": "d"}, "d", id="string"),
    pytest.param({"type": "integer", "required": True, "default": "4"}, "4", id="integer"),
    pytest.param({"type": "boolean", "required": True, "default": False}, "False", id="boolean"),
    pytest.param(_enum("string", ["low", "high"], "high"), "high", id="enum"),
]


class TestARunAloneTakesARequiredInputDefault:
    """A run alone fills a Required input nothing gives from its default; a Current value
    wins over it, and with no default the run stops naming the input (REQ-3.1.2.10)."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize(("declaration", "logged"), REQUIRED_WITH_A_DEFAULT)
    async def test_a_required_input_with_no_current_value_takes_its_default(
        self, session_id: str, declaration: dict[str, Any], logged: str
    ) -> None:
        from wavecore.core.functions.executor import execute_scoped_function

        result = await execute_scoped_function(
            function_def=make_echo_function("must", declaration), session_id=session_id
        )

        assert result.status == "passed", result.error
        assert result.outputs == {"result": logged}

    @pytest.mark.asyncio
    async def test_a_run_scope_whose_values_skip_the_input_takes_the_default(
        self, session_id: str
    ) -> None:
        from wavecore.core.functions.executor import execute_scoped_function

        function_def = make_function_def(
            name="two_inputs",
            inputs=[
                {"name": "must", "type": "string", "required": True, "default": "d"},
                {"name": "other", "type": "string"},
            ],
            outputs=[{"name": "result", "type": "string"}],
            nodes=[make_log_node("echo", message="must", output_bindings={"line": "result"})],
            edges=[{"source": "start-node", "target": "echo"}],
        )

        result = await execute_scoped_function(
            function_def=function_def,
            start=ScopedStart(input_values={"other": "x"}),
            session_id=session_id,
        )

        assert result.status == "passed", result.error
        assert result.outputs == {"result": "d"}

    @pytest.mark.asyncio
    async def test_a_current_value_wins_over_the_default(self, session_id: str) -> None:
        from wavecore.core.functions.executor import execute_scoped_function

        result = await execute_scoped_function(
            function_def=make_echo_function(
                "must", {"type": "string", "required": True, "default": "d"}
            ),
            start=ScopedStart(input_values={"must": "current"}),
            session_id=session_id,
        )

        assert result.status == "passed", result.error
        assert result.outputs == {"result": "current"}

    @pytest.mark.asyncio
    async def test_a_null_default_counts_as_no_default(self, session_id: str) -> None:
        from wavecore.core.functions.executor import execute_scoped_function

        result = await execute_scoped_function(
            function_def=make_echo_function(
                "must", {"type": "string", "required": True, "default": None}
            ),
            session_id=session_id,
        )

        assert result.status == "failed"
        assert re.match(r"^'must' is null$", result.error or "")
        assert result.stopped_before_body is True


class TestAHeldNullInput:
    """A restored scope that holds null for an input fails like a given null, unless the input
    is optional with no default (REQ-3.1.3.21)."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "declaration",
        [
            pytest.param({"type": "string", "required": True, "default": "d"}, id="required"),
            pytest.param({"type": "string", "default": "d"}, id="optional-with-default"),
            pytest.param(_enum("string", ["low", "high"], "low"), id="enum"),
        ],
    )
    async def test_a_held_null_is_refused(
        self, session_id: str, declaration: dict[str, Any]
    ) -> None:
        from wavecore.core.functions.executor import execute_scoped_function, new_runtime_scope

        scope = new_runtime_scope()
        scope["must"] = None

        result = await execute_scoped_function(
            function_def=make_echo_function("must", declaration),
            start=ScopedStart(scope=scope, restored=True),
            session_id=session_id,
        )

        assert result.status == "failed"
        assert re.match(r"^'must' is null$", result.error or "")
        assert result.stopped_before_body is True

    @pytest.mark.asyncio
    async def test_an_optional_input_with_no_default_keeps_a_held_null(
        self, session_id: str
    ) -> None:
        from wavecore.core.functions.executor import execute_scoped_function, new_runtime_scope

        scope = new_runtime_scope()
        scope["must"] = None

        result = await execute_scoped_function(
            function_def=make_echo_function("must", {"type": "string"}),
            start=ScopedStart(scope=scope, restored=True),
            session_id=session_id,
        )

        assert result.status == "passed", result.error
        assert result.outputs == {"result": "null"}

    @pytest.mark.asyncio
    async def test_a_held_value_is_kept(self, session_id: str) -> None:
        from wavecore.core.functions.executor import execute_scoped_function, new_runtime_scope

        scope = new_runtime_scope()
        scope["must"] = "held"

        result = await execute_scoped_function(
            function_def=make_echo_function("must", {"type": "string", "required": True}),
            start=ScopedStart(scope=scope, restored=True),
            session_id=session_id,
        )

        assert result.status == "passed", result.error
        assert result.outputs == {"result": "held"}


class TestAnEnumInputRunsAlone:
    """A Function with an enum input runs alone on its default or on a Current allowed value;
    a null Current value fails the run (REQ-3.1.2.11)."""

    @pytest.mark.asyncio
    async def test_the_default_is_used_as_the_input_type(self, session_id: str) -> None:
        from wavecore.core.functions.executor import execute_scoped_function

        result = await execute_scoped_function(
            function_def=make_echo_function("level", _enum("integer", [1, 2], 2), "str(level + 1)"),
            session_id=session_id,
        )

        assert result.status == "passed", result.error
        assert result.outputs == {"result": "3"}

    @pytest.mark.asyncio
    async def test_a_current_allowed_value_is_used(self, session_id: str) -> None:
        from wavecore.core.functions.executor import execute_scoped_function

        result = await execute_scoped_function(
            function_def=make_echo_function("level", _enum("integer", [1, 2], 2), "str(level + 1)"),
            start=ScopedStart(input_values={"level": 1}),
            session_id=session_id,
        )

        assert result.status == "passed", result.error
        assert result.outputs == {"result": "2"}

    @pytest.mark.asyncio
    async def test_a_null_current_value_is_refused(self, session_id: str) -> None:
        from wavecore.core.functions.executor import execute_scoped_function

        result = await execute_scoped_function(
            function_def=make_echo_function("level", _enum("string", ["low", "high"], "low")),
            start=ScopedStart(input_values={"level": None}),
            session_id=session_id,
        )

        assert result.status == "failed"
        assert re.match(r"^'level' is null$", result.error or "")


class TestARunAloneReachesOnlyTheStartedInstance:
    """Only the instance a run alone starts in takes Required defaults; every Function Block
    inside it must give its Required inputs (REQ-3.1.2.10, REQ-3.2.1.1)."""

    @pytest.mark.asyncio
    async def test_a_nested_function_block_never_fills_a_required_input_from_its_default(
        self, session_id: str
    ) -> None:
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.core.functions.executor import execute_scoped_function, new_runtime_scope

        inner = make_function_def(
            name="g",
            inputs=[{"name": "inner", "type": "string", "required": True, "default": "inner-d"}],
            nodes=[make_log_node("g-log", message="inner")],
            edges=[{"source": "start-node", "target": "g-log"}],
        )
        outer = make_function_def(
            name="f",
            inputs=[{"name": "must", "type": "string", "required": True, "default": "outer-d"}],
            nodes=[
                make_log_node("f-log", message="must"),
                make_function_block("g-block", local_function(inner)),
            ],
            edges=[
                {"source": "start-node", "target": "f-log"},
                {"source": "f-log", "target": "g-block"},
            ],
        )
        scope = new_runtime_scope()

        result = await execute_scoped_function(
            function_def=outer, start=ScopedStart(scope=scope), session_id=session_id
        )

        assert result.status == "failed"
        assert re.match(r"^'inner' is null$", result.error or "")
        assert scope["must"] == "outer-d"
        assert _wb_common._workbench_sessions[session_id]["block_states"] == {
            "f-log": "passed",
            "g-block": "failed",
        }


def _level_function(allowed: list[str]) -> dict[str, Any]:
    return make_echo_function("level", _enum("string", allowed, allowed[0]))


def _flow_holding(block: dict[str, Any]) -> dict[str, Any]:
    return make_function_def(
        name="f",
        nodes=[block],
        edges=[{"source": "start-node", "target": block["id"]}],
    )


class TestAStaleEnumValueInAFunctionBlock:
    """A Function Block value no longer in a Local Function's allowed values fails the run
    when it starts; a Block on an older Published version runs on that version's list
    (REQ-3.1.2.11)."""

    @pytest.mark.asyncio
    async def test_a_local_function_refuses_a_value_its_list_dropped(self, session_id: str) -> None:
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.core.functions.executor import execute_scoped_function

        block = make_function_block(
            "g-block",
            local_function(_level_function(["low", "high"])),
            expressions={"level": "'mid'"},
        )

        result = await execute_scoped_function(
            function_def=_flow_holding(block), session_id=session_id
        )

        assert result.status == "failed"
        assert (
            result.error == "Parameter 'level' must be one of: low, high; Actual value was 'mid'."
        )
        assert _wb_common._workbench_sessions[session_id]["block_states"]["g-block"] == "failed"

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "expressions", [pytest.param({}, id="unset"), pytest.param({"level": ""}, id="blank")]
    )
    async def test_a_block_left_empty_by_the_dropped_value_fails_naming_the_input(
        self, session_id: str, expressions: dict[str, str]
    ) -> None:
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.core.functions.executor import execute_scoped_function

        block = make_function_block(
            "g-block", local_function(_level_function(["low", "high"])), expressions=expressions
        )

        result = await execute_scoped_function(
            function_def=_flow_holding(block), session_id=session_id
        )

        assert result.status == "failed"
        assert re.match(r"^'level' is null$", result.error or "")
        assert _wb_common._workbench_sessions[session_id]["block_states"]["g-block"] == "failed"

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("version", "status", "error"),
        [
            pytest.param("1.0.0", "passed", None, id="older-version-keeps-the-value"),
            pytest.param(
                "2.0.0",
                "failed",
                "Parameter 'level' must be one of: low, high; Actual value was 'mid'.",
                id="newer-version-refuses-it",
            ),
        ],
    )
    async def test_a_block_on_a_published_version_runs_on_that_version_list(
        self,
        monkeypatch: pytest.MonkeyPatch,
        session_id: str,
        version: str,
        status: str,
        error: str | None,
    ) -> None:
        from wavecore.api.services.functions import _storage as _function_storage
        from wavecore.api.services.workbench import _common as _wb_common
        from wavecore.core.functions.executor import execute_scoped_function

        versions = {
            "1.0.0": _level_function(["low", "mid", "high"]),
            "2.0.0": _level_function(["low", "high"]),
        }
        monkeypatch.setattr(
            _function_storage, "load_version", lambda _function_id, pinned: versions[pinned]
        )
        block = make_function_block(
            "g-block",
            {
                "functionLifecycle": "shared",
                "functionId": "33333333-3333-3333-3333-333333333333",
                "functionVersion": version,
            },
            expressions={"level": "'mid'"},
        )

        result = await execute_scoped_function(
            function_def=_flow_holding(block), session_id=session_id
        )

        assert result.status == status
        assert result.error == error
        assert _wb_common._workbench_sessions[session_id]["block_states"]["g-block"] == status
