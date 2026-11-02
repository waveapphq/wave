"""The shared step that stores and paints skipped the lanes a container did not run."""

from typing import Any

import pytest

from wavecore.api.services.workbench import block_status
from wavecore.api.services.workbench.block_status import (
    lane_blocks,
    leave_by_then,
    skip_lane_never_run,
)

Adj = dict[str, list[tuple[str, str | None]]]


def _block(block_id: str) -> dict[str, Any]:
    return {"id": block_id, "type": "workflowNode", "data": {"label": block_id.upper()}}


NODE_MAP: dict[str, Any] = {
    **{
        block_id: _block(block_id)
        for block_id in ("loop", "a", "b", "inner", "deep", "join", "after")
    },
    "note": {"id": "note", "type": "note", "data": {}},
}

# loop -body-> a -> inner (-body-> deep) -then-> join; loop -then-> after; b -> join.
ADJ: Adj = {
    "loop": [("a", "body"), ("after", "then")],
    "a": [("inner", None), ("note", None)],
    "inner": [("deep", "body"), ("join", "then")],
    "b": [("join", None)],
}


class TestLaneBlocks:
    def test_a_lane_holds_the_lanes_of_the_containers_inside_it(self) -> None:
        assert lane_blocks(["a"], ADJ, NODE_MAP) == ["a", "inner", "deep", "join"]

    def test_the_walk_stops_where_another_lane_rejoins(self) -> None:
        assert lane_blocks(["a"], ADJ, NODE_MAP, {"join"}) == ["a", "inner", "deep"]

    def test_an_absent_start_and_a_note_hold_no_block(self) -> None:
        assert lane_blocks([None, "note"], ADJ, NODE_MAP) == []


@pytest.fixture
def painted(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []

    async def _record(_session_id: str, event: dict[str, Any]) -> None:
        events.append(event)

    monkeypatch.setattr(block_status, "_broadcast_event", _record)
    return events


def _session(status: str = "running") -> dict[str, Any]:
    return {"status": status, "block_states": {}}


class TestSkipLaneNeverRun:
    async def test_a_lane_that_never_ran_is_stored_and_painted_skipped_up_to_the_exit(
        self, painted: list[dict[str, Any]]
    ) -> None:
        session = _session()
        executed: set[str] = set()

        await skip_lane_never_run("a", "join", ADJ, NODE_MAP, session, "sid", executed)

        assert session["block_states"] == {"a": "skipped", "inner": "skipped", "deep": "skipped"}
        assert [(e["block_id"], e["block_name"], e["status"]) for e in painted] == [
            ("a", "A", "skipped"),
            ("inner", "INNER", "skipped"),
            ("deep", "DEEP", "skipped"),
        ]
        assert executed == {"a", "inner", "deep"}

    @pytest.mark.parametrize(
        ("lane", "executed", "status"),
        [
            (None, set(), "running"),
            ("a", {"a"}, "running"),
            ("a", set(), "stopped"),
        ],
        ids=["no-lane", "the-lane-ran", "the-run-was-stopped"],
    )
    async def test_nothing_is_skipped(
        self,
        lane: str | None,
        executed: set[str],
        status: str,
        painted: list[dict[str, Any]],
    ) -> None:
        session = _session(status)

        await skip_lane_never_run(lane, "after", ADJ, NODE_MAP, session, "sid", executed)

        assert session["block_states"] == {}
        assert painted == []


class TestLeaveByThen:
    async def test_no_exit_or_an_exit_that_ran_is_left_alone(
        self, painted: list[dict[str, Any]]
    ) -> None:
        queue: list[str] = []
        session = _session()

        await leave_by_then(None, False, queue, ADJ, NODE_MAP, session, "sid", set())
        await leave_by_then("join", True, queue, ADJ, NODE_MAP, session, "sid", {"join"})

        assert queue == []
        assert session["block_states"] == {}
        assert painted == []

    async def test_the_exit_is_queued(self, painted: list[dict[str, Any]]) -> None:
        queue: list[str] = []

        await leave_by_then("join", False, queue, ADJ, NODE_MAP, _session(), "sid", set())

        assert queue == ["join"]
        assert painted == []

    async def test_a_skipped_exit_skips_all_it_leads_to_up_to_a_block_that_ran(
        self, painted: list[dict[str, Any]]
    ) -> None:
        queue: list[str] = []
        session = _session()
        executed = {"deep"}

        await leave_by_then("a", True, queue, ADJ, NODE_MAP, session, "sid", executed)

        assert queue == []
        assert session["block_states"] == {"a": "skipped", "inner": "skipped", "join": "skipped"}
        assert executed == {"a", "inner", "deep", "join"}
