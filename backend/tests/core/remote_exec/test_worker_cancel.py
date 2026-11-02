"""
Remote Execution worker request-protocol tests (REQ-3.4.1.3, REQ-3.2.2.4).

The worker on the remote host runs every request in a process of its own, in a
process group of its own. Requests carry an id and answers carry the same id, so
the worker serves several requests at once and WAVE matches each answer to its
request. A cancel names one request: the worker ends that request's process
group, writes no answer for it, and keeps serving every other request.
"""

from pathlib import Path

import pytest

from tests.core.remote_exec.worker_harness import (
    EXIT_MARGIN_S,
    STOP_REQUEST,
    Answers,
    accept_request,
    await_exit,
    await_gone,
    await_probe,
    await_true,
    cancel,
    network_request,
    peer_closed,
    probe_request,
    quick_request,
    respond,
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


class TestAnswersCarryTheirRequestId:
    """Every answer names the request it answers."""

    def test_an_answer_carries_the_id_of_its_request(self, stub_path: Path) -> None:
        with worker(stub_path) as proc:
            answers = Answers(proc)
            send(proc, quick_request("req-7"))

            answer = answers.next()

            assert answer["id"] == "req-7"

    def test_a_failing_request_answers_its_failure_as_before(self, stub_path: Path) -> None:
        with worker(stub_path) as proc:
            answers = Answers(proc)
            send(proc, quick_request("req-8"))

            answer = answers.next()

            assert answer == {
                "id": "req-8",
                "return_value": None,
                "logs": [],
                "status": "failed",
                "error": "Plugin 'nope' is not available in the remote bundle",
            }

    def test_a_request_that_ends_without_answering_fails_under_its_id(
        self, stub_path: Path, tmp_path: Path
    ) -> None:
        with worker(stub_path) as proc:
            answers = Answers(proc)
            send(proc, probe_request("crasher", tmp_path, "req-9"))

            answer = answers.next()

            assert answer == {
                "id": "req-9",
                "return_value": None,
                "logs": [],
                "status": "failed",
                "error": "The request ended on the remote host without an answer (exit code 3)",
            }


class TestRequestsServedAtTheSameTime:
    """A request in flight never holds back another request."""

    def test_a_second_request_is_answered_while_the_first_waits(self, stub_path: Path) -> None:
        with silent_listener() as listener, worker(stub_path) as proc:
            answers = Answers(proc)
            send(proc, network_request(listener, "slow"))
            with accept_request(listener) as connection:
                send(proc, quick_request("fast"))

                assert answers.next()["id"] == "fast"
                respond(connection)
                slow = answers.next()

            assert (slow["id"], slow["status"]) == ("slow", "passed")

    def test_two_held_requests_run_at_once(self, stub_path: Path) -> None:
        with silent_listener() as listener, worker(stub_path) as proc:
            answers = Answers(proc)
            send(proc, network_request(listener, "one"))
            send(proc, network_request(listener, "two"))
            with accept_request(listener) as first, accept_request(listener) as second:
                respond(second)
                respond(first)
                received = {answers.next()["id"], answers.next()["id"]}

            assert received == {"one", "two"}


class TestCancelOneRequest:
    """A cancel ends one request and nothing else."""

    def test_a_cancel_kills_the_program_the_request_started(
        self, stub_path: Path, tmp_path: Path
    ) -> None:
        with worker(stub_path) as proc:
            send(proc, sleeper_request(tmp_path, "held"))
            request_pid, child_pid, _workspace = await_probe(tmp_path)

            cancel(proc, "held")

            assert await_gone(child_pid)
            assert await_gone(request_pid)

    def test_a_cancel_ends_a_request_blocked_in_a_network_read(self, stub_path: Path) -> None:
        with silent_listener() as listener, worker(stub_path) as proc:
            send(proc, network_request(listener, "held"))
            with accept_request(listener) as connection:
                cancel(proc, "held")

                assert peer_closed(connection)

    def test_a_cancel_leaves_nothing_the_request_wrote_on_disk(
        self, stub_path: Path, tmp_path: Path
    ) -> None:
        with worker(stub_path) as proc:
            send(proc, sleeper_request(tmp_path, "held"))
            _request_pid, _child_pid, workspace = await_probe(tmp_path)
            assert workspace.exists()

            cancel(proc, "held")

            assert await_true(lambda: not workspace.exists())

    def test_a_canceled_request_is_never_answered(self, stub_path: Path, tmp_path: Path) -> None:
        with worker(stub_path) as proc:
            answers = Answers(proc)
            send(proc, sleeper_request(tmp_path, "held"))
            request_pid, _child_pid, _workspace = await_probe(tmp_path)
            cancel(proc, "held")
            assert await_gone(request_pid)

            send(proc, quick_request("after"))

            assert answers.next()["id"] == "after"
            send(proc, STOP_REQUEST)
            await_exit(proc, stop_grace_s() + EXIT_MARGIN_S)
            assert answers.rest() == []

    def test_the_worker_keeps_serving_after_a_cancel(self, stub_path: Path, tmp_path: Path) -> None:
        with worker(stub_path) as proc:
            answers = Answers(proc)
            send(proc, sleeper_request(tmp_path, "held"))
            await_probe(tmp_path)

            cancel(proc, "held")
            send(proc, quick_request("after"))

            assert answers.next()["id"] == "after"
            assert proc.poll() is None

    def test_another_request_in_flight_still_answers(self, stub_path: Path, tmp_path: Path) -> None:
        with silent_listener() as listener, worker(stub_path) as proc:
            answers = Answers(proc)
            send(proc, network_request(listener, "kept"))
            send(proc, sleeper_request(tmp_path, "held"))
            request_pid, child_pid, _workspace = await_probe(tmp_path)
            with accept_request(listener) as connection:
                cancel(proc, "held")
                assert await_gone(child_pid)
                assert await_gone(request_pid)

                respond(connection)
                kept = answers.next()

            assert (kept["id"], kept["status"]) == ("kept", "passed")

    def test_a_cancel_for_an_unknown_request_changes_nothing(self, stub_path: Path) -> None:
        with worker(stub_path) as proc:
            answers = Answers(proc)
            cancel(proc, "never-sent")
            send(proc, quick_request("after"))

            assert answers.next()["id"] == "after"

    def test_a_request_that_ignores_the_cancel_is_ended_within_the_grace(
        self, stub_path: Path, tmp_path: Path
    ) -> None:
        with worker(stub_path) as proc:
            answers = Answers(proc)
            send(proc, probe_request("stubborn", tmp_path, "held"))
            request_pid, _child_pid, _workspace = await_probe(tmp_path)

            cancel(proc, "held")

            assert await_gone(request_pid, stop_grace_s() + EXIT_MARGIN_S)
            send(proc, quick_request("after"))
            assert answers.next()["id"] == "after"
