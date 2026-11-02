"""
Remote Execution worker stop-protocol tests (REQ-3.4.1.3, REQ-3.2.2.4, SHRUN-15).

A block owns every process it starts, on the WAVE server and on a remote host
alike, and the worker running the bundle is what holds that ownership on the
remote host. It keeps reading the session while it works, so a stop that
arrives in the middle of a request is seen rather than queued behind the answer.
A stop request carried over the session, or the session closing under it, ends
the process group of every request the worker is serving and ends the worker,
so a stopped run leaves the remote host as it was found: nothing WAVE-authored
still running and nothing WAVE-authored left on disk.
"""

from pathlib import Path
from typing import Any

import pytest

from tests.core.remote_exec.worker_harness import (
    EXIT_MARGIN_S,
    STOP_REQUEST,
    Answers,
    await_exit,
    await_gone,
    await_probe,
    awaiting_answer,
    close_session,
    network_request,
    peer_closed,
    probe_request,
    read_answer,
    send,
    silent_listener,
    sleeper_request,
    stop_grace_s,
    stub_import_path,
    worker,
)


@pytest.fixture(scope="module")
def stub_path(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return stub_import_path(tmp_path_factory.mktemp("worker-host"))


class TestStopDuringARequest:
    """A stop request over the session, seen while the worker is still working."""

    def test_a_stop_mid_request_ends_the_worker(self, stub_path: Path, tmp_path: Path) -> None:
        """The worker keeps reading while it works, so the stop is seen at once
        rather than queued behind an answer that is 30 seconds away."""
        with worker(stub_path) as proc:
            send(proc, sleeper_request(tmp_path))
            await_probe(tmp_path)

            send(proc, STOP_REQUEST)

            assert await_exit(proc) is not None

    def test_a_stop_mid_request_kills_what_the_worker_started(
        self, stub_path: Path, tmp_path: Path
    ) -> None:
        with worker(stub_path) as proc:
            send(proc, sleeper_request(tmp_path))
            _request_pid, child_pid, _workspace = await_probe(tmp_path)

            send(proc, STOP_REQUEST)
            await_exit(proc)

            assert await_gone(child_pid)

    def test_a_stop_mid_request_sends_no_further_answer(
        self, stub_path: Path, tmp_path: Path
    ) -> None:
        with worker(stub_path) as proc:
            send(proc, sleeper_request(tmp_path))
            await_probe(tmp_path)

            send(proc, STOP_REQUEST)
            await_exit(proc)

            assert proc.stdout is not None
            assert proc.stdout.read() == b""

    def test_a_stop_leaves_nothing_the_request_wrote_on_disk(
        self, stub_path: Path, tmp_path: Path
    ) -> None:
        """A stopped run leaves the host as it was found, so the directory the
        in-flight request made is gone and not left behind mid-answer."""
        with worker(stub_path) as proc:
            send(proc, sleeper_request(tmp_path))
            _request_pid, _child_pid, workspace = await_probe(tmp_path)
            assert workspace.exists()

            send(proc, STOP_REQUEST)
            await_exit(proc)

            assert not workspace.exists()

    def test_a_stop_mid_network_read_ends_the_worker_within_the_grace(
        self, stub_path: Path
    ) -> None:
        """A request with no child to kill still gets only the stop grace to unwind."""
        with silent_listener() as listener, worker(stub_path) as proc:
            send(proc, network_request(listener))
            with awaiting_answer(listener):
                send(proc, STOP_REQUEST)

                assert await_exit(proc, stop_grace_s() + EXIT_MARGIN_S) is not None
                assert proc.stdout is not None
                assert proc.stdout.read() == b""


class TestSessionClosing:
    """The session closing under a working worker ends it the same way."""

    def test_a_closed_session_mid_request_ends_the_worker(
        self, stub_path: Path, tmp_path: Path
    ) -> None:
        with worker(stub_path) as proc:
            send(proc, sleeper_request(tmp_path))
            await_probe(tmp_path)

            close_session(proc)

            assert await_exit(proc) is not None

    def test_a_closed_session_kills_what_the_worker_started(
        self, stub_path: Path, tmp_path: Path
    ) -> None:
        with worker(stub_path) as proc:
            send(proc, sleeper_request(tmp_path))
            _request_pid, child_pid, _workspace = await_probe(tmp_path)

            close_session(proc)
            await_exit(proc)

            assert await_gone(child_pid)

    def test_a_closed_session_leaves_nothing_the_request_wrote_on_disk(
        self, stub_path: Path, tmp_path: Path
    ) -> None:
        with worker(stub_path) as proc:
            send(proc, sleeper_request(tmp_path))
            _request_pid, _child_pid, workspace = await_probe(tmp_path)
            assert workspace.exists()

            close_session(proc)
            await_exit(proc)

            assert not workspace.exists()

    def test_a_closed_session_mid_network_read_ends_the_worker_within_the_grace(
        self, stub_path: Path
    ) -> None:
        """Nobody can read an answer on a closed session, so the worker leaves within
        the same bound as a stop and writes none."""
        with silent_listener() as listener, worker(stub_path) as proc:
            send(proc, network_request(listener))
            with awaiting_answer(listener):
                close_session(proc)

                assert await_exit(proc, stop_grace_s() + EXIT_MARGIN_S) is not None
                assert proc.stdout is not None
                assert proc.stdout.read() == b""


class TestStopBetweenRequests:
    """A stop that arrives while the worker is idle still ends it."""

    def test_a_stop_between_requests_ends_the_worker(self, stub_path: Path) -> None:
        with worker(stub_path) as proc:
            send(proc, {"plugin_id": "nope", "params": {}, "variables": {}})
            read_answer(proc)

            send(proc, STOP_REQUEST)

            assert await_exit(proc) is not None

    def test_a_request_before_the_stop_is_still_answered(self, stub_path: Path) -> None:
        """The stop ends the worker; it does not swallow the answer already owed."""
        with worker(stub_path) as proc:
            send(proc, {"plugin_id": "nope", "params": {}, "variables": {}})

            answer = read_answer(proc)

            assert answer["status"] == "failed"
            send(proc, STOP_REQUEST)
            await_exit(proc)


def _end_session(proc: Any, how: str) -> None:
    if how == "stop":
        send(proc, STOP_REQUEST)
    else:
        close_session(proc)


class TestStopWithSeveralRequestsInFlight:
    """A stop or a closed session ends every request the worker is serving, not only one."""

    @pytest.mark.parametrize("how", ["stop", "closed session"])
    def test_every_request_and_what_it_started_is_gone(
        self, stub_path: Path, tmp_path: Path, how: str
    ) -> None:
        with silent_listener() as listener, worker(stub_path) as proc:
            send(proc, sleeper_request(tmp_path / "a", "a"))
            send(proc, sleeper_request(tmp_path / "b", "b"))
            send(proc, network_request(listener, "c"))
            first = await_probe(tmp_path / "a")
            second = await_probe(tmp_path / "b")
            with awaiting_answer(listener) as connection:
                _end_session(proc, how)

                assert await_exit(proc, stop_grace_s() + EXIT_MARGIN_S) is not None
                assert peer_closed(connection)
            for request_pid, child_pid, workspace in (first, second):
                assert await_gone(request_pid)
                assert await_gone(child_pid)
                assert not workspace.exists()

    @pytest.mark.parametrize("how", ["stop", "closed session"])
    def test_no_request_is_answered(self, stub_path: Path, tmp_path: Path, how: str) -> None:
        with worker(stub_path) as proc:
            answers = Answers(proc)
            send(proc, sleeper_request(tmp_path / "a", "a"))
            send(proc, sleeper_request(tmp_path / "b", "b"))
            await_probe(tmp_path / "a")
            await_probe(tmp_path / "b")

            _end_session(proc, how)
            await_exit(proc, stop_grace_s() + EXIT_MARGIN_S)

            assert answers.rest() == []

    def test_a_request_that_ignores_the_stop_is_still_ended_within_the_grace(
        self, stub_path: Path, tmp_path: Path
    ) -> None:
        with worker(stub_path) as proc:
            send(proc, probe_request("stubborn", tmp_path, "a"))
            request_pid, _child_pid, _workspace = await_probe(tmp_path)

            send(proc, STOP_REQUEST)

            assert await_exit(proc, stop_grace_s() + EXIT_MARGIN_S) is not None
            assert await_gone(request_pid)
