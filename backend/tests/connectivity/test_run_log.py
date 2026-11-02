"""The once-per-run log sink a block run carries for its connection lines (REQ-4.5.16).

A block run sets one sink; a line logged through it reaches the run's log once, however
many connections the run opens. Without a sink (editor helpers, plain calls) nothing is logged.
"""

import asyncio
import contextvars
from collections.abc import Callable, Iterator
from pathlib import Path

import pytest

from tests.core.remote_exec._vendorability import (
    imported_names,
    is_stdlib,
    parses_at_the_floor,
    post_floor_names,
)
from wavecore.connectivity import run_log
from wavecore.connectivity.run_log import RUN_LOG, RunLog, log_once

_PATH = Path(str(run_log.__file__))
_TRUST_LINE = "Trusting WAVE's built-in certificate list (June 2026)"
_PROXY_LINE = "Using the proxy http://proxy.internal:3128"

Lines = list[tuple[str, str]]


def _sink(lines: Lines) -> RunLog:
    """A run's sink writing (level, message) pairs, the shape of a verb's log callable."""
    return RunLog(lambda level, message: lines.append((level, message)))


@pytest.fixture
def run_lines() -> Iterator[Lines]:
    """One block run: its sink is active for the test and removed after."""
    lines: Lines = []
    token = RUN_LOG.set(_sink(lines))
    yield lines
    RUN_LOG.reset(token)


def _in_run(lines: Lines, body: Callable[[], None]) -> None:
    """Run `body` as one block run of its own, in a fresh context holding a new sink."""

    def run() -> None:
        RUN_LOG.set(_sink(lines))
        body()

    contextvars.copy_context().run(run)


class TestTheRunVariable:
    """The sink rides a context variable, like the process group a run holds."""

    def test_it_is_a_context_variable(self) -> None:
        assert isinstance(RUN_LOG, contextvars.ContextVar)

    def test_it_holds_no_sink_by_default(self) -> None:
        assert contextvars.Context().run(RUN_LOG.get) is None


class TestLogOnce:
    """A line reaches the run's log once per run, and only when a run holds a sink."""

    def test_without_a_sink_nothing_is_logged(self) -> None:
        assert RUN_LOG.get() is None

        assert log_once("INFO", _TRUST_LINE) is None

    def test_a_line_reaches_the_sink_with_its_level(self, run_lines: Lines) -> None:
        log_once("INFO", _TRUST_LINE)

        assert run_lines == [("INFO", _TRUST_LINE)]

    def test_the_same_line_twice_in_one_run_is_logged_once(self, run_lines: Lines) -> None:
        log_once("INFO", _TRUST_LINE)
        log_once("INFO", _TRUST_LINE)

        assert run_lines == [("INFO", _TRUST_LINE)]

    def test_different_lines_are_each_logged_in_order(self, run_lines: Lines) -> None:
        log_once("INFO", _TRUST_LINE)
        log_once("INFO", _PROXY_LINE)
        log_once("INFO", _TRUST_LINE)

        assert run_lines == [("INFO", _TRUST_LINE), ("INFO", _PROXY_LINE)]

    def test_two_runs_log_the_same_line_each(self) -> None:
        first: Lines = []
        second: Lines = []

        _in_run(first, lambda: log_once("INFO", _TRUST_LINE))
        _in_run(second, lambda: log_once("INFO", _TRUST_LINE))

        assert first == [("INFO", _TRUST_LINE)]
        assert second == [("INFO", _TRUST_LINE)]

    def test_a_new_sink_with_the_same_writer_starts_a_new_run(self) -> None:
        lines: Lines = []

        def write(level: str, message: str) -> None:
            lines.append((level, message))

        for _ in range(2):
            token = RUN_LOG.set(RunLog(write))
            try:
                log_once("INFO", _TRUST_LINE)
            finally:
                RUN_LOG.reset(token)

        assert lines == [("INFO", _TRUST_LINE), ("INFO", _TRUST_LINE)]

    async def test_runs_side_by_side_keep_their_own_sinks(self) -> None:
        first: Lines = []
        second: Lines = []

        async def run(lines: Lines) -> None:
            RUN_LOG.set(_sink(lines))
            for _ in range(2):
                log_once("INFO", _TRUST_LINE)
                await asyncio.sleep(0)

        await asyncio.gather(run(first), run(second))

        assert first == [("INFO", _TRUST_LINE)]
        assert second == [("INFO", _TRUST_LINE)]

    async def test_a_thread_the_run_starts_logs_into_the_same_run(self) -> None:
        lines: Lines = []

        async def run() -> None:
            RUN_LOG.set(_sink(lines))
            log_once("INFO", _TRUST_LINE)
            await asyncio.to_thread(log_once, "INFO", _TRUST_LINE)
            await asyncio.to_thread(log_once, "INFO", _PROXY_LINE)

        await asyncio.create_task(run())

        assert lines == [("INFO", _TRUST_LINE), ("INFO", _PROXY_LINE)]


class TestRidesToRemoteHosts:
    """The remote worker sets a sink per request, so the module is carried verbatim."""

    def test_it_imports_only_the_standard_library(self) -> None:
        names = imported_names(run_log.__name__, _PATH)

        assert all(is_stdlib({name}) for name in names), names

    def test_it_parses_at_the_interpreter_floor(self) -> None:
        source = _PATH.read_text(encoding="utf-8")

        assert parses_at_the_floor(source)
        assert post_floor_names(source) == set()
