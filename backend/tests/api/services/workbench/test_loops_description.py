"""The lines a loop writes about itself carry the loop block's Source (EXEC-25), and the
try-catch error builder reads `description`.

Covers:
- for_loop._handle_iteration_result and while_loop._handle_while_body_outcome write the
  break line with the loop's Source: its type's palette name, then its Name. The
  Description and a legacy `displayName` never appear in it.
- A For Loop, a For Each and a While Loop each write "Loop completed", their break line
  and their control's own line with that same Source.
- try_catch._build_error_object reads `description` (not displayName) for the error.node field.
"""

import uuid
from typing import Any
from unittest.mock import patch

import pytest

from tests.api.services.workbench.parallel_harness import (  # noqa: F401
    edge,
    engine_registries,
    for_each_node,
    loop_signal_node,
    run_graph,
    setter_node,
)
from tests.api.services.workbench.slot_harness import LOOP_OUTPUTS, for_node, while_node
from wavecore.api.services import log_streaming_service
from wavecore.api.services.workbench.for_loop import _handle_iteration_result
from wavecore.api.services.workbench.try_catch import _build_error_object
from wavecore.api.services.workbench.while_loop import _handle_while_body_outcome

LONG_DESCRIPTION = "Sends the file again until the server takes it or the tries run out"

# Loop kind, the type name the palette shows.
LOOP_KINDS = [("for", "For Loop"), ("for-each", "For Each"), ("while", "While Loop")]
LOOP_IDS = [kind for kind, _type_name in LOOP_KINDS]


def _make_loop_node(
    node_id: str,
    *,
    element_type: str = "for",
    description: str | None = None,
    label: str = "Loop",
) -> dict[str, Any]:
    """Loop node with optional description (post-rename payload shape)."""
    data: dict[str, Any] = {"label": label, "elementType": element_type, "version": "1.0.0"}
    if description is not None:
        data["description"] = description
    return {"id": node_id, "type": "workflowNode", "data": data}


def _make_session(session_id: str = "s-1") -> dict[str, Any]:
    return {
        "session_id": session_id,
        "status": "running",
        "block_states": {},
    }


def _loop_graph(
    kind: str, label: str, *, breaks: bool = False
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """One loop named ``label`` whose body runs once, or breaks out of it."""
    loops = {
        "for": lambda: for_node("loop", 1),
        "for-each": lambda: for_each_node("loop", ["a"]),
        "while": lambda: while_node("loop", "rounds < 1"),
    }
    loop = loops[kind]()
    loop["data"]["label"] = label
    loop["data"]["description"] = LONG_DESCRIPTION
    if breaks:
        body = loop_signal_node("body", "break", "loop", "Leave")
    else:
        body = setter_node("body", "Tick", {"rounds": "rounds + 1"}, expressions=True)
    return [loop, body], [edge("start-node", "loop"), edge("loop", "body", "body")]


async def _loop_lines(kind: str, label: str, *, breaks: bool = False) -> list[dict[str, Any]]:
    """The lines the loop block wrote about itself, the engine's SYSTEM lines left out."""
    nodes, edges = _loop_graph(kind, label, breaks=breaks)
    session_id = f"loop-source-{kind}-{uuid.uuid4().hex[:8]}"
    session = await run_graph(session_id, nodes, edges, dict(LOOP_OUTPUTS))
    assert session["status"] == "passed", log_streaming_service.get_logs(session_id)
    return [
        entry
        for entry in log_streaming_service.get_logs(session_id)
        if entry.get("blockId") == "loop" and entry["source"] != "SYSTEM"
    ]


@pytest.mark.usefixtures("engine_registries")
class TestForLoopHandleIterationResultSource:
    """_handle_iteration_result writes the break line with the loop's Source."""

    def test_break_logs_the_type_and_the_name(self) -> None:
        node = _make_loop_node("for-1", label="Retry upload", description="Probe gateway")
        node_map = {"for-1": node}
        session = _make_session()

        with patch("wavecore.api.services.workbench.for_loop._add_execution_log") as mock_log:
            action = _handle_iteration_result(
                result="break",
                node_id="for-1",
                node_map=node_map,
                session=session,
                session_id="s-1",
            )

        assert action == "break"
        mock_log.assert_called_once()
        args, _ = mock_log.call_args
        # _add_execution_log(session_id, level, message, source, block_id=...)
        assert args[3] == "For Loop : Retry upload"

    def test_break_logs_the_type_alone_when_the_name_matches(self) -> None:
        node = _make_loop_node("for-1", label="For Loop", description="Probe gateway")
        node_map = {"for-1": node}
        session = _make_session()

        with patch("wavecore.api.services.workbench.for_loop._add_execution_log") as mock_log:
            _handle_iteration_result(
                result="break",
                node_id="for-1",
                node_map=node_map,
                session=session,
                session_id="s-1",
            )

        args, _ = mock_log.call_args
        assert args[3] == "For Loop"

    def test_break_reads_the_type_from_the_node(self) -> None:
        node = _make_loop_node("fe-1", element_type="for-each", label="Each order")
        node_map = {"fe-1": node}
        session = _make_session()

        with patch("wavecore.api.services.workbench.for_loop._add_execution_log") as mock_log:
            _handle_iteration_result(
                result="break",
                node_id="fe-1",
                node_map=node_map,
                session=session,
                session_id="s-1",
            )

        assert mock_log.call_args.args[3] == "For Each : Each order"

    def test_break_on_a_node_without_data_names_nothing(self) -> None:
        """Defensive: a `data` key that is None still logs the break."""
        node_map = {"for-1": {"id": "for-1", "type": "workflowNode", "data": None}}
        session = _make_session()
        with patch("wavecore.api.services.workbench.for_loop._add_execution_log") as mock_log:
            _handle_iteration_result(
                result="break",
                node_id="for-1",
                node_map=node_map,
                session=session,
                session_id="s-1",
            )
        assert mock_log.call_args.args[2] == "Break - loop exited"
        assert mock_log.call_args.args[3] == ""

    def test_continue_does_not_log_name(self) -> None:
        """continue result does not invoke _add_execution_log via this helper."""
        node = _make_loop_node("for-1", description="Probe")
        node_map = {"for-1": node}
        session = _make_session()
        with patch("wavecore.api.services.workbench.for_loop._add_execution_log") as mock_log:
            _handle_iteration_result(
                result="ok",
                node_id="for-1",
                node_map=node_map,
                session=session,
                session_id="s-1",
            )
        mock_log.assert_not_called()

    def test_break_does_not_read_displayName(self) -> None:
        """Even if a legacy `displayName` is on the data dict, it must NOT be used."""
        node = _make_loop_node("for-1")
        node["data"]["displayName"] = "LEGACY"
        node_map = {"for-1": node}
        session = _make_session()
        with patch("wavecore.api.services.workbench.for_loop._add_execution_log") as mock_log:
            _handle_iteration_result(
                result="break",
                node_id="for-1",
                node_map=node_map,
                session=session,
                session_id="s-1",
            )
        # `displayName` is not a recognized key - the type and the Name make the Source.
        assert mock_log.call_args.args[3] == "For Loop : Loop"


@pytest.mark.usefixtures("engine_registries")
class TestWhileLoopHandleBodyOutcomeSource:
    """_handle_while_body_outcome writes the break line with the loop's Source."""

    def test_break_logs_the_type_and_the_name(self) -> None:
        node = _make_loop_node(
            "while-1", element_type="while", label="Until ready", description="Retry loop"
        )
        node_map = {"while-1": node}
        session = _make_session()
        with patch("wavecore.api.services.workbench.while_loop._add_execution_log") as mock_log:
            action = _handle_while_body_outcome(
                outcome="break",
                node_id="while-1",
                node_map=node_map,
                session=session,
                session_id="s-1",
            )
        assert action == "break"
        assert mock_log.call_args.args[3] == "While Loop : Until ready"

    def test_break_logs_the_type_alone_when_the_name_matches(self) -> None:
        node = _make_loop_node(
            "while-1", element_type="while", label="While Loop", description="Retry loop"
        )
        node_map = {"while-1": node}
        session = _make_session()
        with patch("wavecore.api.services.workbench.while_loop._add_execution_log") as mock_log:
            _handle_while_body_outcome(
                outcome="break",
                node_id="while-1",
                node_map=node_map,
                session=session,
                session_id="s-1",
            )
        assert mock_log.call_args.args[3] == "While Loop"

    def test_break_ignores_legacy_displayName(self) -> None:
        node = _make_loop_node("while-1", element_type="while")
        node["data"]["displayName"] = "LEGACY"
        node_map = {"while-1": node}
        session = _make_session()
        with patch("wavecore.api.services.workbench.while_loop._add_execution_log") as mock_log:
            _handle_while_body_outcome(
                outcome="break",
                node_id="while-1",
                node_map=node_map,
                session=session,
                session_id="s-1",
            )
        assert mock_log.call_args.args[3] == "While Loop : Loop"


@pytest.mark.usefixtures("engine_registries")
@pytest.mark.parametrize(("kind", "type_name"), LOOP_KINDS, ids=LOOP_IDS)
class TestALoopsOwnLines:
    """Every line a loop block writes about itself carries the loop's Source."""

    async def test_loop_completed_carries_the_type_and_the_name(
        self, kind: str, type_name: str
    ) -> None:
        lines = await _loop_lines(kind, "Retry upload")

        completed = [line["source"] for line in lines if line["message"] == "Loop completed"]
        assert completed == [f"{type_name} : Retry upload"]

    async def test_every_line_of_the_loop_carries_the_same_source(
        self, kind: str, type_name: str
    ) -> None:
        lines = await _loop_lines(kind, "Retry upload")

        assert {line["source"] for line in lines} == {f"{type_name} : Retry upload"}

    async def test_a_loop_named_as_its_type_shows_the_type_alone(
        self, kind: str, type_name: str
    ) -> None:
        lines = await _loop_lines(kind, type_name)

        assert {line["source"] for line in lines} == {type_name}

    async def test_the_break_line_carries_the_type_and_the_name(
        self, kind: str, type_name: str
    ) -> None:
        lines = await _loop_lines(kind, "Retry upload", breaks=True)

        left = [line["source"] for line in lines if line["message"] == "Break - loop exited"]
        assert left == [f"{type_name} : Retry upload"]

    async def test_the_description_is_in_no_source(self, kind: str, type_name: str) -> None:
        lines = await _loop_lines(kind, "Retry upload")

        assert [line["source"] for line in lines if LONG_DESCRIPTION in line["source"]] == []


class TestBuildErrorObjectName:
    """try_catch._build_error_object names the failed block by its Name."""

    def test_error_node_is_the_name_when_a_description_is_set(self) -> None:
        try_error = RuntimeError("boom")
        failed_node = {
            "id": "f-1",
            "type": "workflowNode",
            "data": {
                "label": "HTTP Probe",
                "description": "Probe gateway",
                "elementType": "http-client",
            },
        }
        node_map = {"f-1": failed_node}
        session = {"block_states": {"f-1": "failed"}}
        try_chain = ["f-1"]

        error_obj = _build_error_object(try_error, try_chain, session, node_map)

        assert error_obj["node"] == "HTTP Probe"
        assert error_obj["node_id"] == "f-1"
        assert error_obj["element_type"] == "http-client"
        assert error_obj["type"] == "RuntimeError"

    def test_error_node_is_the_name_without_a_description(self) -> None:
        try_error = RuntimeError("boom")
        failed_node = {
            "id": "f-1",
            "type": "workflowNode",
            "data": {
                "label": "HTTP Probe",
                "elementType": "http-client",
            },
        }
        node_map = {"f-1": failed_node}
        session = {"block_states": {"f-1": "failed"}}
        try_chain = ["f-1"]

        error_obj = _build_error_object(try_error, try_chain, session, node_map)
        assert error_obj["node"] == "HTTP Probe"

    def test_error_node_ignores_legacy_displayName(self) -> None:
        """A leftover `displayName` on the data dict is not the source - the Name is."""
        try_error = RuntimeError("boom")
        failed_node = {
            "id": "f-1",
            "type": "workflowNode",
            "data": {
                "label": "HTTP Probe",
                "displayName": "LEGACY",
                "elementType": "http-client",
            },
        }
        node_map = {"f-1": failed_node}
        session = {"block_states": {"f-1": "failed"}}
        try_chain = ["f-1"]

        error_obj = _build_error_object(try_error, try_chain, session, node_map)
        # displayName must not leak in.
        assert error_obj["node"] == "HTTP Probe"

    def test_error_node_empty_when_no_failed_node_resolved(self) -> None:
        """When no node in the try_chain is in 'failed' state, the node field is empty."""
        try_error = RuntimeError("boom")
        failed_node = {
            "id": "f-1",
            "type": "workflowNode",
            "data": {"label": "HTTP Probe", "elementType": "http-client"},
        }
        node_map = {"f-1": failed_node}
        # No 'failed' state in block_states
        session = {"block_states": {"f-1": "passed"}}
        try_chain = ["f-1"]

        error_obj = _build_error_object(try_error, try_chain, session, node_map)
        # failed_node_id stays None -> failed_node lookup returns {} -> node="" and element_type=""
        assert error_obj["node"] == ""
        assert error_obj["node_id"] == ""
        assert error_obj["element_type"] == ""


class TestNoLegacyDisplayNameReadsInLoopModules:
    """Negative: source modules contain no `displayName` references after the rename.

    These tests guarantee the rename is complete at the source level, not just at the
    behavioral level. Pure source-grep assertions remain stable after refactors.
    """

    def _read(self, mod_name: str) -> str:
        from importlib import import_module

        mod = import_module(mod_name)
        return open(mod.__file__, encoding="utf-8").read()  # noqa: SIM115 - test-only read

    def test_for_loop_source_has_no_displayName(self) -> None:
        src = self._read("wavecore.api.services.workbench.for_loop")
        assert "displayName" not in src

    def test_for_each_source_has_no_displayName(self) -> None:
        src = self._read("wavecore.api.services.workbench.for_each")
        assert "displayName" not in src

    def test_while_loop_source_has_no_displayName(self) -> None:
        src = self._read("wavecore.api.services.workbench.while_loop")
        assert "displayName" not in src

    def test_try_catch_source_has_no_displayName(self) -> None:
        src = self._read("wavecore.api.services.workbench.try_catch")
        assert "displayName" not in src

    def test_node_helpers_source_has_no_displayName(self) -> None:
        src = self._read("wavecore.api.services.workbench.node_helpers")
        assert "displayName" not in src
        assert "display_name" not in src
