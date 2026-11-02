"""
Remote Execution runner contract tests (REQ-3.4.1.3).

The runner drives a persistent remote worker over an already-open asyncssh
connection:

- probe asks the host interpreter for its version, machine and libc in one
  command (REQ-5.1.4); open_worker refuses what the probe rules out and keeps
  the answer on the WorkerHandle it returns.
- open_worker validates a compatible Python interpreter on the host (a
  runtime check), pushes the pure-Python bundle, starts the persistent
  worker process, and returns a WorkerHandle.
- run_on_worker sends one plugin-execution request (plain dict in, with the
  trust spec its blocks verify by) over the worker's stdin and reads its JSON
  response (return_value / logs / status / error) back off stdout.
- close_worker tears the worker down; nothing WAVE-authored persists on the
  host (agentless).

These tests run against a fake asyncssh connection, no real sshd; only the
probe itself also runs under the interpreter running the tests. The
interpreter probe rides connection.run(...); the persistent worker rides
connection.create_process(...), matching the shipped SSH session plugins.
"""

import asyncio
import inspect
import json
import platform
import re
import shlex
import subprocess
import sys
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from wavecore.core.remote_exec import runner
from wavecore.core.remote_exec.bundle import worker_bootstrap
from wavecore.core.remote_exec.runner import (
    STOP_REQUEST,
    WorkerHandle,
    close_worker,
    open_worker,
    run_on_worker,
)

NO_INTERPRETER_MSG = "Remote Execution: no compatible Python interpreter on the host"

# A host whose exec channel greets every command: the version is not the whole of stdout.
BANNER = "Authorized use only: this system is monitored"

_STARTUP_TRACEBACK = (
    "Traceback (most recent call last):\n"
    '  File "<string>", line 1, in <module>\n'
    "ModuleNotFoundError: No module named 'ssl'"
)
_SILENT_DETAIL = "the worker exited without answering"
# The trust spec in its wire form, as the workbench sends it with each request (REQ-4.5.16).
_TRUST: dict[str, Any] = {
    "source": "builtin",
    "additional_pem": "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n",
    "additional_count": 1,
    "builtin_label": "June 2026",
}
_HOST_TRUST: dict[str, Any] = {
    "source": "host",
    "additional_pem": "",
    "additional_count": 0,
    "builtin_label": "June 2026",
}


def _floor_message(interpreter: str, found: str) -> str:
    """The exact refusal an under-floor interpreter raises; ``found`` is major.minor."""
    return (
        f"Remote interpreter '{interpreter}' is Python {found}; "
        "Remote Execution needs Python 3.10 or newer"
    )


def _unreadable_message(interpreter: str) -> str:
    """The exact refusal for a probe that exits 0 with something that is not a version."""
    return f"Remote interpreter '{interpreter}' did not report a readable version"


def _stopped_message(detail: str) -> str:
    """The exact failure a worker that answered nothing raises, carrying the host's stderr."""
    return f"Remote Execution worker on the host stopped: {detail}"


def _exact(message: str) -> str:
    return f"^{re.escape(message)}$"


def _written_requests(proc: MagicMock) -> list[dict[str, Any]]:
    """Every plugin request written to the worker's stdin, in order."""
    lines = [json.loads(line) for line in _writes(proc).splitlines() if line.strip()]
    return [line for line in lines if "plugin_id" in line]


def _fake_process(response_lines: list[str] | None = None, stderr: str = "") -> MagicMock:
    """A fake asyncssh SSHClientProcess with writable stdin and readable stdout/stderr.

    Each scripted answer is stamped with the id of the request it answers, in order; an
    empty line ends the worker's output, and a worker past its script stays up.
    """
    proc = MagicMock()
    proc.stdin = MagicMock()
    proc.stdin.write = MagicMock()
    proc.stdin.write_eof = MagicMock()
    proc.stdin.drain = AsyncMock()
    proc.stdout = MagicMock()
    script = list(response_lines or [])
    answered: list[str] = []

    async def _readline() -> str:
        if not script:
            await asyncio.Event().wait()
        line = script.pop(0)
        if not line:
            return line
        while len(_written_requests(proc)) <= len(answered):
            await asyncio.sleep(0)
        request_id = _written_requests(proc)[len(answered)]["id"]
        answered.append(request_id)
        return json.dumps({"id": request_id, **json.loads(line)}) + "\n"

    proc.stdout.readline = AsyncMock(side_effect=_readline)
    proc.stderr = MagicMock()
    proc.stderr.read = AsyncMock(return_value=stderr)
    proc.close = MagicMock()
    proc.wait_closed = AsyncMock()
    return proc


class _AnsweredByTheTest:
    """A fake worker process whose output lines the test writes, one at a time."""

    def __init__(self) -> None:
        self.proc = _fake_process()
        self.lines: asyncio.Queue[str] = asyncio.Queue()
        self.proc.stdout.readline = AsyncMock(side_effect=self.lines.get)
        self.worker = WorkerHandle(process=self.proc, host="prod-host", interpreter="python3")

    def request_id(self, plugin_id: str) -> str:
        ids = [req["id"] for req in _written_requests(self.proc) if req["plugin_id"] == plugin_id]
        assert len(ids) == 1, f"expected one {plugin_id} request, sent {ids}"
        return str(ids[0])

    def answer(self, request_id: str, return_value: Any) -> None:
        payload = {"id": request_id, "return_value": return_value, "logs": [], "status": "passed"}
        self.lines.put_nowait(json.dumps(payload) + "\n")

    async def settle(self) -> None:
        for _ in range(20):
            await asyncio.sleep(0)


def probe_line(version: str, machine: str = "x86_64", libc: str = "glibc") -> str:
    """The probe's answer: the version, the machine and the libc, whitespace separated."""
    return f"{version} {machine} {libc}"


def _fake_connection(
    exit_status: int = 0,
    stdout: str = probe_line("3.11.5"),
    process: MagicMock | None = None,
) -> MagicMock:
    """A fake asyncssh connection whose run() answers the host probe with `stdout`."""
    conn = MagicMock()
    run_result = MagicMock()
    run_result.exit_status = exit_status
    run_result.stdout = stdout
    run_result.stderr = ""
    conn.run = AsyncMock(return_value=run_result)
    conn.create_process = AsyncMock(return_value=process or _fake_process())
    return conn


def _writes(proc: MagicMock) -> str:
    """Concatenate everything written to the worker's stdin."""
    return "".join(
        str(call.args[0]) if call.args else "" for call in proc.stdin.write.call_args_list
    )


class LocalShell:
    """A connection whose run() executes the command on this machine, as sshd runs it on a host."""

    async def run(self, command: str) -> SimpleNamespace:
        done = await asyncio.to_thread(
            subprocess.run, command, shell=True, capture_output=True, text=True, timeout=30
        )
        return SimpleNamespace(exit_status=done.returncode, stdout=done.stdout, stderr=done.stderr)


def local_probe() -> dict[str, Any]:
    """The probe of the interpreter running these tests, taken the way a host is probed."""
    reply: dict[str, Any] = asyncio.run(runner.probe(LocalShell(), sys.executable))
    return reply


def _probed(
    version: tuple[int, int], machine: str = "x86_64", libc: str = "glibc"
) -> dict[str, Any]:
    return {"python": version, "machine": machine, "libc": libc}


class TestOpenWorkerInterpreterValidation:
    """open_worker - the runtime interpreter compatibility check."""

    @pytest.mark.asyncio
    async def test_missing_interpreter_raises_exact_message(self) -> None:
        conn = _fake_connection(exit_status=127, stdout="")

        with pytest.raises(RuntimeError, match=f"^{NO_INTERPRETER_MSG}$"):
            await open_worker(conn)

    @pytest.mark.asyncio
    async def test_probe_runs_over_the_connection(self) -> None:
        conn = _fake_connection()

        await open_worker(conn)

        conn.run.assert_awaited()

    @pytest.mark.asyncio
    async def test_probe_asks_the_interpreter_for_its_version(self) -> None:
        """The host must state its version: --version alone cannot tell 3.9 from 3.12."""
        conn = _fake_connection()

        await open_worker(conn)

        assert conn.run.await_args.args[0] == f"python3 {runner._PROBE}"

    @pytest.mark.asyncio
    async def test_probe_runs_under_the_requested_interpreter(self) -> None:
        conn = _fake_connection()

        await open_worker(conn, interpreter="/usr/bin/python3.12")

        assert conn.run.await_args.args[0] == f"/usr/bin/python3.12 {runner._PROBE}"

    def test_the_supported_floor_is_python_3_10(self) -> None:
        from wavecore.core.remote_exec.runner import REMOTE_PYTHON_FLOOR

        assert REMOTE_PYTHON_FLOOR == (3, 10)

    @pytest.mark.asyncio
    async def test_the_floor_version_itself_is_accepted(self) -> None:
        """Ubuntu 22.04 ships 3.10: the floor is inclusive or every LTS host fails."""
        conn = _fake_connection(stdout=probe_line("3.10"))

        worker = await open_worker(conn)

        assert isinstance(worker, WorkerHandle)

    @pytest.mark.asyncio
    async def test_a_patch_release_of_the_floor_is_accepted(self) -> None:
        conn = _fake_connection(stdout=probe_line("3.10.12"))

        worker = await open_worker(conn)

        assert isinstance(worker, WorkerHandle)

    @pytest.mark.asyncio
    async def test_a_newer_interpreter_is_accepted(self) -> None:
        conn = _fake_connection(stdout=probe_line("3.12.13"))

        worker = await open_worker(conn)

        assert isinstance(worker, WorkerHandle)

    @pytest.mark.asyncio
    async def test_below_floor_raises_the_exact_message(self) -> None:
        conn = _fake_connection(stdout=probe_line("3.9"))

        with pytest.raises(RuntimeError, match=f"^{re.escape(_floor_message('python3', '3.9'))}$"):
            await open_worker(conn)

    @pytest.mark.asyncio
    async def test_the_refusal_names_only_the_major_and_minor(self) -> None:
        conn = _fake_connection(stdout=probe_line("3.9.18"))

        with pytest.raises(RuntimeError, match=f"^{re.escape(_floor_message('python3', '3.9'))}$"):
            await open_worker(conn)

    @pytest.mark.asyncio
    async def test_the_refusal_names_the_requested_interpreter_verbatim(self) -> None:
        conn = _fake_connection(stdout=probe_line("3.8"))

        with pytest.raises(
            RuntimeError,
            match=f"^{re.escape(_floor_message('/usr/bin/python3.8', '3.8'))}$",
        ):
            await open_worker(conn, interpreter="/usr/bin/python3.8")

    @pytest.mark.asyncio
    async def test_a_python_2_interpreter_is_refused(self) -> None:
        conn = _fake_connection(stdout=probe_line("2.7"))

        with pytest.raises(RuntimeError, match=f"^{re.escape(_floor_message('python2', '2.7'))}$"):
            await open_worker(conn, interpreter="python2")

    @pytest.mark.asyncio
    async def test_a_refused_interpreter_never_starts_a_worker(self) -> None:
        conn = _fake_connection(stdout=probe_line("3.9"))

        with pytest.raises(RuntimeError):
            await open_worker(conn)

        conn.create_process.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_unreadable_version_output_names_the_unreadable_answer(self) -> None:
        """An interpreter that exits 0 with a version we cannot read is a different
        diagnosis from a host that has no interpreter at all."""
        conn = _fake_connection(stdout="Python was here")

        with pytest.raises(RuntimeError, match=_exact(_unreadable_message("python3"))):
            await open_worker(conn)

    @pytest.mark.asyncio
    async def test_empty_version_output_names_the_unreadable_answer(self) -> None:
        conn = _fake_connection(stdout="")

        with pytest.raises(RuntimeError, match=_exact(_unreadable_message("python3"))):
            await open_worker(conn)

    @pytest.mark.asyncio
    async def test_a_single_segment_version_names_the_unreadable_answer(self) -> None:
        conn = _fake_connection(stdout=probe_line("3"))

        with pytest.raises(RuntimeError, match=_exact(_unreadable_message("python3"))):
            await open_worker(conn)

    @pytest.mark.asyncio
    async def test_the_unreadable_refusal_names_the_requested_interpreter(self) -> None:
        conn = _fake_connection(stdout="Python was here")

        with pytest.raises(RuntimeError, match=_exact(_unreadable_message("/usr/bin/python3.12"))):
            await open_worker(conn, interpreter="/usr/bin/python3.12")

    @pytest.mark.asyncio
    async def test_an_unreadable_answer_never_starts_a_worker(self) -> None:
        conn = _fake_connection(stdout="Python was here")

        with pytest.raises(RuntimeError):
            await open_worker(conn)

        conn.create_process.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_a_version_behind_a_banner_line_is_accepted(self) -> None:
        """A shell that greets every exec channel still has the interpreter it names."""
        conn = _fake_connection(stdout=f"{BANNER}\n{probe_line('3.12')}\n")

        worker = await open_worker(conn)

        assert isinstance(worker, WorkerHandle)

    @pytest.mark.asyncio
    async def test_a_banner_host_is_never_told_it_has_no_interpreter(self) -> None:
        conn = _fake_connection(stdout=f"{BANNER}\n{probe_line('3.12')}\n")

        await open_worker(conn)

        conn.create_process.assert_awaited()

    @pytest.mark.asyncio
    async def test_several_noise_lines_before_the_version_are_ignored(self) -> None:
        noise = f"{BANNER}\nLast login: Tue Sep  2 10:00:00 2026\n"
        conn = _fake_connection(stdout=f"{noise}{probe_line('3.10')}\n")

        worker = await open_worker(conn)

        assert isinstance(worker, WorkerHandle)

    @pytest.mark.asyncio
    async def test_a_banner_host_below_the_floor_is_refused_by_its_real_version(self) -> None:
        conn = _fake_connection(stdout=f"{BANNER}\n{probe_line('3.9.18')}\n")

        with pytest.raises(RuntimeError, match=_exact(_floor_message("python3", "3.9"))):
            await open_worker(conn)

    @pytest.mark.asyncio
    async def test_blank_lines_around_the_version_are_ignored(self) -> None:
        conn = _fake_connection(stdout=f"\n{probe_line('3.11.5')}\n\n")

        worker = await open_worker(conn)

        assert isinstance(worker, WorkerHandle)


class TestOpenWorkerHappyPath:
    """open_worker - starting the persistent worker over the connection."""

    @pytest.mark.asyncio
    async def test_returns_a_worker_handle_wrapping_the_process(self) -> None:
        proc = _fake_process()
        conn = _fake_connection(process=proc)

        worker = await open_worker(conn)

        assert isinstance(worker, WorkerHandle)
        assert worker.process is proc

    @pytest.mark.asyncio
    async def test_starts_the_worker_via_create_process(self) -> None:
        conn = _fake_connection()

        await open_worker(conn)

        conn.create_process.assert_awaited()

    @pytest.mark.asyncio
    async def test_worker_runs_under_the_requested_interpreter(self) -> None:
        conn = _fake_connection()

        await open_worker(conn, interpreter="python3.11")

        assert "python3.11" in str(conn.create_process.call_args)

    @pytest.mark.asyncio
    async def test_the_worker_interpreter_starts_in_utf8_mode(self) -> None:
        conn = _fake_connection()

        await open_worker(conn, interpreter="python3.11")

        command = conn.create_process.call_args.args[0]
        assert shlex.split(command) == ["python3.11", "-X", "utf8", "-c", worker_bootstrap()]


class TestTheHostProbe:
    """probe - one command reports the host's Python, machine and libc (SQL-15)."""

    def test_the_probe_is_a_dash_c_program(self) -> None:
        assert runner._PROBE.startswith("-c ")

    async def test_the_command_is_the_interpreter_and_the_probe(self) -> None:
        conn = _fake_connection()

        await runner.probe(conn)

        assert conn.run.await_args.args[0] == f"python3 {runner._PROBE}"

    async def test_the_command_runs_the_requested_interpreter(self) -> None:
        conn = _fake_connection()

        await runner.probe(conn, "/opt/python/bin/python3.13")

        assert conn.run.await_args.args[0] == f"/opt/python/bin/python3.13 {runner._PROBE}"

    @pytest.mark.parametrize(
        ("stdout", "expected"),
        [
            pytest.param(probe_line("3.12"), _probed((3, 12)), id="major-minor"),
            pytest.param(probe_line("3.10.12"), _probed((3, 10)), id="patch-version"),
            pytest.param(
                probe_line("3.14.0", "aarch64", "musl"),
                _probed((3, 14), "aarch64", "musl"),
                id="musl",
            ),
            pytest.param(
                probe_line("3.11", "x86_64", "bionic"),
                _probed((3, 11), "x86_64", "bionic"),
                id="other-libc",
            ),
            pytest.param(f"{BANNER}\n{probe_line('3.13')}\n", _probed((3, 13)), id="banner"),
            pytest.param(f"\n\n{probe_line('3.12')}\n\n", _probed((3, 12)), id="blank-lines"),
        ],
    )
    async def test_the_last_answer_line_is_read(
        self, stdout: str, expected: dict[str, Any]
    ) -> None:
        reply = await runner.probe(_fake_connection(stdout=stdout))

        assert reply == expected

    @pytest.mark.parametrize(
        "stdout",
        [
            pytest.param("3.12", id="single-token"),
            pytest.param("3.12 x86_64", id="no-libc"),
            pytest.param("3.12 x86_64 glibc 2.35", id="extra-token"),
            pytest.param(probe_line("3"), id="single-segment-version"),
            pytest.param(probe_line("three.twelve"), id="words"),
            pytest.param("Python was here", id="prose"),
            pytest.param("", id="empty"),
            pytest.param(f"{probe_line('3.12')}\n{BANNER}\n", id="answer-not-last"),
        ],
    )
    async def test_anything_else_is_the_unreadable_refusal(self, stdout: str) -> None:
        with pytest.raises(RuntimeError, match=_exact(_unreadable_message("python3"))):
            await runner.probe(_fake_connection(stdout=stdout))

    async def test_a_missing_interpreter_is_the_same_refusal_open_worker_gave(self) -> None:
        with pytest.raises(RuntimeError, match=_exact(NO_INTERPRETER_MSG)):
            await runner.probe(_fake_connection(exit_status=127, stdout=""))

    async def test_an_interpreter_below_the_floor_is_refused_by_major_and_minor(self) -> None:
        conn = _fake_connection(stdout=probe_line("3.9.18", "aarch64", "musl"))

        with pytest.raises(RuntimeError, match=_exact(_floor_message("python3.9", "3.9"))):
            await runner.probe(conn, "python3.9")

    def test_running_the_probe_under_this_interpreter_reports_it(self) -> None:
        major, minor = sys.version_info[:2]

        reply = local_probe()

        assert reply == _probed((major, minor), platform.machine(), "glibc")

    def test_the_probe_prints_one_answer_line_under_this_interpreter(self) -> None:
        major, minor = sys.version_info[:2]
        done = subprocess.run(
            f"{sys.executable} {runner._PROBE}",
            shell=True,
            capture_output=True,
            text=True,
            timeout=30,
            check=True,
        )

        last = [line for line in done.stdout.splitlines() if line.strip()][-1]
        pattern = rf"{major}\.{minor}(\.\d+)? {re.escape(platform.machine())} glibc"
        assert re.fullmatch(pattern, last.strip()), last


class TestTheHandleKeepsTheProbe:
    """The worker handle remembers what its host is and which wheels it already holds."""

    async def test_open_worker_keeps_the_probe_on_the_handle(self) -> None:
        conn = _fake_connection(stdout=probe_line("3.13.1", "aarch64", "musl"))

        worker = await open_worker(conn)

        assert worker.probe == _probed((3, 13), "aarch64", "musl")

    async def test_a_new_worker_holds_no_wheels(self) -> None:
        worker = await open_worker(_fake_connection())

        assert worker.wheels == set()

    def test_a_handle_built_without_a_probe_has_none(self) -> None:
        worker = WorkerHandle(process=_fake_process(), host="h", interpreter="python3")

        assert worker.probe is None
        assert worker.wheels == set()

    def test_each_handle_has_its_own_wheel_record(self) -> None:
        first = WorkerHandle(process=_fake_process(), host="h", interpreter="python3")
        second = WorkerHandle(process=_fake_process(), host="h", interpreter="python3")

        first.wheels.add("cffi.whl")

        assert second.wheels == set()


class TestOpenWorkerWhenThePushFails:
    """A worker that dies mid-push breaks the pipe: the host's own stderr says why."""

    @pytest.mark.asyncio
    async def test_a_broken_pipe_on_drain_raises_what_the_host_printed(self) -> None:
        proc = _fake_process(stderr=f"{_STARTUP_TRACEBACK}\n")
        proc.stdin.drain = AsyncMock(side_effect=BrokenPipeError())
        conn = _fake_connection(process=proc)

        with pytest.raises(RuntimeError, match=_exact(_stopped_message(_STARTUP_TRACEBACK))):
            await open_worker(conn)

    @pytest.mark.asyncio
    async def test_a_broken_pipe_on_write_raises_what_the_host_printed(self) -> None:
        proc = _fake_process(stderr=f"{_STARTUP_TRACEBACK}\n")
        proc.stdin.write = MagicMock(side_effect=BrokenPipeError())
        conn = _fake_connection(process=proc)

        with pytest.raises(RuntimeError, match=_exact(_stopped_message(_STARTUP_TRACEBACK))):
            await open_worker(conn)

    @pytest.mark.asyncio
    async def test_a_silent_host_still_gets_a_reason(self) -> None:
        proc = _fake_process(stderr="")
        proc.stdin.drain = AsyncMock(side_effect=BrokenPipeError())
        conn = _fake_connection(process=proc)

        with pytest.raises(RuntimeError, match=_exact(_stopped_message(_SILENT_DETAIL))):
            await open_worker(conn)

    @pytest.mark.asyncio
    async def test_a_dropped_channel_raises_what_the_host_printed(self) -> None:
        proc = _fake_process(stderr=f"{_STARTUP_TRACEBACK}\n")
        proc.stdin.drain = AsyncMock(side_effect=ConnectionResetError())
        conn = _fake_connection(process=proc)

        with pytest.raises(RuntimeError, match=_exact(_stopped_message(_STARTUP_TRACEBACK))):
            await open_worker(conn)

    @pytest.mark.asyncio
    async def test_the_failure_is_never_reported_with_an_empty_message(self) -> None:
        proc = _fake_process(stderr=f"{_STARTUP_TRACEBACK}\n")
        proc.stdin.drain = AsyncMock(side_effect=BrokenPipeError())
        conn = _fake_connection(process=proc)

        with pytest.raises(RuntimeError) as caught:
            await open_worker(conn)

        assert str(caught.value).strip() != ""


class TestRunOnWorker:
    """run_on_worker - one plugin execution, plain dict in / JSON out."""

    @pytest.mark.asyncio
    async def test_returns_the_parsed_json_response(self) -> None:
        response = {
            "return_value": {"status_code": 200, "body": "ok"},
            "logs": [{"level": "INFO", "message": "ran"}],
            "status": "passed",
            "error": None,
        }
        proc = _fake_process([json.dumps(response) + "\n"])
        worker = WorkerHandle(process=proc, host="prod-host", interpreter="python3")

        result = await run_on_worker(worker, "http-client", {"url": "http://x"}, {}, _TRUST)

        assert result == response

    @pytest.mark.asyncio
    async def test_sends_the_plugin_id_params_and_variables_as_json(self) -> None:
        response = {"return_value": None, "logs": [], "status": "passed", "error": None}
        proc = _fake_process([json.dumps(response) + "\n"])
        worker = WorkerHandle(process=proc, host="prod-host", interpreter="python3")

        await run_on_worker(
            worker,
            "http-client",
            {"method": "GET", "url": "http://x"},
            {"token": "abc"},
            _TRUST,
        )

        request = json.loads(_writes(proc).strip())
        assert request["plugin_id"] == "http-client"
        assert request["params"] == {"method": "GET", "url": "http://x"}
        assert request["variables"] == {"token": "abc"}

    @pytest.mark.asyncio
    async def test_every_request_carries_an_id_of_its_own(self) -> None:
        response = json.dumps({"return_value": None, "logs": [], "status": "passed"}) + "\n"
        proc = _fake_process([response, response])
        worker = WorkerHandle(process=proc, host="prod-host", interpreter="python3")

        await run_on_worker(worker, "http-client", {}, {}, _TRUST)
        await run_on_worker(worker, "http-client", {}, {}, _TRUST)

        ids = [request["id"] for request in _written_requests(proc)]
        assert all(isinstance(request_id, str) and request_id for request_id in ids)
        assert len(set(ids)) == 2
        await close_worker(worker)

    @pytest.mark.asyncio
    async def test_surfaces_a_remote_plugin_error(self) -> None:
        response = {
            "return_value": None,
            "logs": [],
            "status": "failed",
            "error": "boom on host",
        }
        proc = _fake_process([json.dumps(response) + "\n"])
        worker = WorkerHandle(process=proc, host="prod-host", interpreter="python3")

        result = await run_on_worker(worker, "http-client", {}, {}, _TRUST)

        assert result["status"] == "failed"
        assert result["error"] == "boom on host"


class TestRunOnWorkerCarriesTheTrust:
    """Each request line carries the trust its block verifies by on the remote host (REQ-4.5.16)."""

    def test_trust_is_the_fifth_parameter_and_has_no_default(self) -> None:
        parameters = inspect.signature(run_on_worker).parameters

        assert list(parameters) == ["worker", "plugin_id", "params", "variables", "trust"]
        assert parameters["trust"].default is inspect.Parameter.empty

    @pytest.mark.asyncio
    async def test_the_request_line_carries_the_trust_it_was_given(self) -> None:
        response = {"return_value": None, "logs": [], "status": "passed", "error": None}
        proc = _fake_process([json.dumps(response) + "\n"])
        worker = WorkerHandle(process=proc, host="prod-host", interpreter="python3")

        await run_on_worker(worker, "http-client", {"url": "https://x"}, {}, _TRUST)

        [request] = _written_requests(proc)
        assert request["trust"] == _TRUST

    @pytest.mark.asyncio
    async def test_the_request_line_holds_the_trust_beside_the_plugin_request(self) -> None:
        response = {"return_value": None, "logs": [], "status": "passed", "error": None}
        proc = _fake_process([json.dumps(response) + "\n"])
        worker = WorkerHandle(process=proc, host="prod-host", interpreter="python3")

        await run_on_worker(worker, "k8s-get", {"kind": "Pod"}, {"token": "abc"}, _HOST_TRUST)

        [request] = _written_requests(proc)
        assert set(request) == {"id", "plugin_id", "params", "variables", "trust"}
        assert (request["plugin_id"], request["params"], request["variables"]) == (
            "k8s-get",
            {"kind": "Pod"},
            {"token": "abc"},
        )

    @pytest.mark.asyncio
    async def test_each_request_carries_the_trust_of_its_own_call(self) -> None:
        response = json.dumps({"return_value": None, "logs": [], "status": "passed"}) + "\n"
        proc = _fake_process([response, response])
        worker = WorkerHandle(process=proc, host="prod-host", interpreter="python3")

        await run_on_worker(worker, "http-client", {}, {}, _TRUST)
        await run_on_worker(worker, "sql-client", {}, {}, _HOST_TRUST)

        assert [request["trust"] for request in _written_requests(proc)] == [_TRUST, _HOST_TRUST]
        await close_worker(worker)

    @pytest.mark.asyncio
    async def test_concurrent_requests_keep_their_own_trust(self) -> None:
        fake = _AnsweredByTheTest()
        first = asyncio.create_task(run_on_worker(fake.worker, "first", {}, {}, _TRUST))
        second = asyncio.create_task(run_on_worker(fake.worker, "second", {}, {}, _HOST_TRUST))
        await fake.settle()

        sent = {request["plugin_id"]: request["trust"] for request in _written_requests(fake.proc)}

        assert sent == {"first": _TRUST, "second": _HOST_TRUST}
        for task in (first, second):
            task.cancel()
        await asyncio.gather(first, second, return_exceptions=True)
        await close_worker(fake.worker)

    @pytest.mark.asyncio
    async def test_a_cancel_line_carries_no_trust(self) -> None:
        fake = _AnsweredByTheTest()
        task = asyncio.create_task(run_on_worker(fake.worker, "http-client", {}, {}, _TRUST))
        await fake.settle()
        request_id = fake.request_id("http-client")

        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

        lines = [json.loads(line) for line in _writes(fake.proc).splitlines()]
        assert lines[1:] == [{"cancel": request_id}]
        await close_worker(fake.worker)


class TestRunOnWorkerWhenTheWorkerStopped:
    """An empty answer means the worker died: the host's own stderr says why."""

    @pytest.mark.asyncio
    async def test_an_empty_answer_raises_with_what_the_host_printed(self) -> None:
        proc = _fake_process([""], stderr=f"{_STARTUP_TRACEBACK}\n")
        worker = WorkerHandle(process=proc, host="bastion-1", interpreter="python3")

        with pytest.raises(RuntimeError, match=_exact(_stopped_message(_STARTUP_TRACEBACK))):
            await run_on_worker(worker, "k8s-get", {}, {}, _TRUST)

    @pytest.mark.asyncio
    async def test_a_worker_that_printed_nothing_says_it_answered_nothing(self) -> None:
        proc = _fake_process([""], stderr="")
        worker = WorkerHandle(process=proc, host="bastion-1", interpreter="python3")

        with pytest.raises(RuntimeError, match=_exact(_stopped_message(_SILENT_DETAIL))):
            await run_on_worker(worker, "k8s-get", {}, {}, _TRUST)

    @pytest.mark.asyncio
    async def test_a_whitespace_only_stderr_says_it_answered_nothing(self) -> None:
        proc = _fake_process([""], stderr="  \n\n")
        worker = WorkerHandle(process=proc, host="bastion-1", interpreter="python3")

        with pytest.raises(RuntimeError, match=_exact(_stopped_message(_SILENT_DETAIL))):
            await run_on_worker(worker, "k8s-get", {}, {}, _TRUST)

    @pytest.mark.asyncio
    async def test_the_user_never_meets_the_json_decode_error(self) -> None:
        proc = _fake_process([""], stderr=f"{_STARTUP_TRACEBACK}\n")
        worker = WorkerHandle(process=proc, host="bastion-1", interpreter="python3")

        with pytest.raises(RuntimeError) as raised:
            await run_on_worker(worker, "k8s-get", {}, {}, _TRUST)

        assert "Expecting value" not in str(raised.value)

    @pytest.mark.asyncio
    async def test_the_hosts_stderr_is_read(self) -> None:
        proc = _fake_process([""], stderr=f"{_STARTUP_TRACEBACK}\n")
        worker = WorkerHandle(process=proc, host="bastion-1", interpreter="python3")

        with pytest.raises(RuntimeError):
            await run_on_worker(worker, "k8s-get", {}, {}, _TRUST)

        proc.stderr.read.assert_awaited()

    @pytest.mark.asyncio
    async def test_a_live_worker_never_reads_stderr(self) -> None:
        response = {"return_value": None, "logs": [], "status": "passed", "error": None}
        proc = _fake_process([json.dumps(response) + "\n"])
        worker = WorkerHandle(process=proc, host="bastion-1", interpreter="python3")

        await run_on_worker(worker, "k8s-get", {}, {}, _TRUST)
        await close_worker(worker)

        proc.stderr.read.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_every_request_still_waiting_fails_with_the_reason(self) -> None:
        fake = _AnsweredByTheTest()
        fake.proc.stderr.read = AsyncMock(return_value="killed\n")
        first = asyncio.create_task(run_on_worker(fake.worker, "first", {}, {}, _TRUST))
        second = asyncio.create_task(run_on_worker(fake.worker, "second", {}, {}, _TRUST))
        await fake.settle()

        fake.lines.put_nowait("")

        for task in (first, second):
            with pytest.raises(RuntimeError, match=_exact(_stopped_message("killed"))):
                await task

    @pytest.mark.asyncio
    async def test_an_answer_that_arrived_before_the_worker_stopped_still_counts(self) -> None:
        fake = _AnsweredByTheTest()
        task = asyncio.create_task(run_on_worker(fake.worker, "first", {}, {}, _TRUST))
        await fake.settle()

        fake.answer(fake.request_id("first"), "answered")
        fake.lines.put_nowait("")

        assert (await asyncio.wait_for(task, timeout=1))["return_value"] == "answered"

    @pytest.mark.asyncio
    async def test_a_request_after_the_worker_stopped_fails_with_the_same_reason(self) -> None:
        proc = _fake_process([""], stderr="gone")
        worker = WorkerHandle(process=proc, host="prod-host", interpreter="python3")
        with pytest.raises(RuntimeError):
            await run_on_worker(worker, "first", {}, {}, _TRUST)

        with pytest.raises(RuntimeError, match=_exact(_stopped_message("gone"))):
            await asyncio.wait_for(run_on_worker(worker, "second", {}, {}, _TRUST), timeout=1)

        assert [request["plugin_id"] for request in _written_requests(proc)] == ["first"]

    @pytest.mark.asyncio
    async def test_a_broken_answer_stream_fails_the_waiting_request(self) -> None:
        fake = _AnsweredByTheTest()
        fake.proc.stdout.readline = AsyncMock(side_effect=ConnectionResetError("channel reset"))

        with pytest.raises(RuntimeError, match=_exact(_stopped_message("channel reset"))):
            await asyncio.wait_for(run_on_worker(fake.worker, "first", {}, {}, _TRUST), timeout=1)

    @pytest.mark.asyncio
    async def test_a_broken_answer_stream_with_no_message_still_gives_a_reason(self) -> None:
        fake = _AnsweredByTheTest()
        fake.proc.stdout.readline = AsyncMock(side_effect=BrokenPipeError())

        with pytest.raises(RuntimeError, match=_exact(_stopped_message(_SILENT_DETAIL))):
            await asyncio.wait_for(run_on_worker(fake.worker, "first", {}, {}, _TRUST), timeout=1)


class TestRunOnWorkerWhenItsWaitIsCanceled:
    """A canceled wait cancels that one request on the host (SHRUN-15), never the worker."""

    @staticmethod
    async def _canceled(fake: _AnsweredByTheTest, plugin_id: str) -> str:
        task = asyncio.create_task(run_on_worker(fake.worker, plugin_id, {}, {}, _TRUST))
        await fake.settle()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        return fake.request_id(plugin_id)

    @pytest.mark.asyncio
    async def test_the_cancel_line_names_the_request(self) -> None:
        fake = _AnsweredByTheTest()

        request_id = await self._canceled(fake, "http-client")

        lines = [json.loads(line) for line in _writes(fake.proc).splitlines()]
        assert lines == [lines[0], {"cancel": request_id}]
        assert lines[0]["plugin_id"] == "http-client"
        await close_worker(fake.worker)

    @pytest.mark.asyncio
    async def test_a_canceled_wait_never_stops_the_worker(self) -> None:
        fake = _AnsweredByTheTest()

        await self._canceled(fake, "http-client")

        assert STOP_REQUEST not in _writes(fake.proc)
        fake.proc.stdin.write_eof.assert_not_called()
        await close_worker(fake.worker)

    @pytest.mark.asyncio
    async def test_a_closed_input_still_lets_the_cancel_through(self) -> None:
        fake = _AnsweredByTheTest()
        task = asyncio.create_task(run_on_worker(fake.worker, "http-client", {}, {}, _TRUST))
        await fake.settle()
        fake.proc.stdin.write = MagicMock(side_effect=BrokenPipeError())

        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        await close_worker(fake.worker)

    @pytest.mark.asyncio
    async def test_the_worker_keeps_serving_after_a_cancel(self) -> None:
        fake = _AnsweredByTheTest()
        await self._canceled(fake, "first")

        later = asyncio.create_task(run_on_worker(fake.worker, "second", {}, {}, _TRUST))
        await fake.settle()
        fake.answer(fake.request_id("second"), "second")

        assert (await asyncio.wait_for(later, timeout=1))["return_value"] == "second"
        await close_worker(fake.worker)

    @pytest.mark.asyncio
    async def test_a_late_answer_for_a_canceled_request_is_never_taken_as_another(self) -> None:
        fake = _AnsweredByTheTest()
        canceled_id = await self._canceled(fake, "first")
        later = asyncio.create_task(run_on_worker(fake.worker, "second", {}, {}, _TRUST))
        await fake.settle()

        fake.answer(canceled_id, "first")
        await fake.settle()

        assert not later.done()
        fake.answer(fake.request_id("second"), "second")
        assert (await asyncio.wait_for(later, timeout=1))["return_value"] == "second"
        await close_worker(fake.worker)


class TestRunOnWorkerWithConcurrentRequests:
    """Callers sharing one worker (Parallel lanes) run at once; answers find requests by id."""

    @pytest.mark.asyncio
    async def test_a_second_request_is_sent_while_the_first_waits(self) -> None:
        fake = _AnsweredByTheTest()
        first = asyncio.create_task(run_on_worker(fake.worker, "first", {}, {}, _TRUST))
        second = asyncio.create_task(run_on_worker(fake.worker, "second", {}, {}, _TRUST))
        await fake.settle()

        sent = [request["plugin_id"] for request in _written_requests(fake.proc)]

        assert sent == ["first", "second"]
        for task in (first, second):
            task.cancel()
        await asyncio.gather(first, second, return_exceptions=True)
        await close_worker(fake.worker)

    @pytest.mark.asyncio
    async def test_answers_reach_their_own_request_in_any_order(self) -> None:
        fake = _AnsweredByTheTest()
        first = asyncio.create_task(run_on_worker(fake.worker, "first", {}, {}, _TRUST))
        second = asyncio.create_task(run_on_worker(fake.worker, "second", {}, {}, _TRUST))
        await fake.settle()

        fake.answer(fake.request_id("second"), "answer-2")
        assert (await asyncio.wait_for(second, timeout=1))["return_value"] == "answer-2"
        assert not first.done()
        fake.answer(fake.request_id("first"), "answer-1")

        assert (await asyncio.wait_for(first, timeout=1))["return_value"] == "answer-1"
        await close_worker(fake.worker)

    @pytest.mark.asyncio
    async def test_an_answer_for_no_waiting_request_is_ignored(self) -> None:
        fake = _AnsweredByTheTest()
        task = asyncio.create_task(run_on_worker(fake.worker, "first", {}, {}, _TRUST))
        await fake.settle()

        fake.answer("nobody-asked", "stray")
        fake.answer(fake.request_id("first"), "mine")

        assert (await asyncio.wait_for(task, timeout=1))["return_value"] == "mine"
        await close_worker(fake.worker)


class TestCloseWorker:
    """close_worker - teardown; nothing persists on the host (agentless)."""

    @pytest.mark.asyncio
    async def test_closes_the_worker_process(self) -> None:
        proc = _fake_process()
        worker = WorkerHandle(process=proc, host="prod-host", interpreter="python3")

        await close_worker(worker)

        proc.close.assert_called_once_with()

    @pytest.mark.asyncio
    async def test_close_is_best_effort(self) -> None:
        proc = _fake_process()
        proc.close.side_effect = RuntimeError("already gone")
        worker = WorkerHandle(process=proc, host="prod-host", interpreter="python3")

        # Must not raise on a teardown error.
        await close_worker(worker)

    @pytest.mark.asyncio
    async def test_close_ends_the_answer_reader(self) -> None:
        fake = _AnsweredByTheTest()
        task = asyncio.create_task(run_on_worker(fake.worker, "first", {}, {}, _TRUST))
        await fake.settle()
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)

        await close_worker(fake.worker)

        assert fake.worker.reader is not None and fake.worker.reader.done()


class TestWorkerHandle:
    """WorkerHandle - the live-worker record the registry tracks."""

    def test_handle_exposes_process_host_and_interpreter(self) -> None:
        proc = MagicMock()
        worker = WorkerHandle(process=proc, host="prod-host", interpreter="python3")

        assert worker.process is proc
        assert worker.host == "prod-host"
        assert worker.interpreter == "python3"

    def test_close_tears_down_the_process(self) -> None:
        """The registry's terminal cleanup rides WorkerHandle.close() (sync)."""
        proc = MagicMock()
        worker = WorkerHandle(process=proc, host="prod-host", interpreter="python3")

        worker.close()

        proc.close.assert_called_once_with()

    def test_close_is_best_effort(self) -> None:
        proc = MagicMock()
        proc.close.side_effect = RuntimeError("boom")
        worker = WorkerHandle(process=proc, host="prod-host", interpreter="python3")

        # Best-effort: a broken process teardown never propagates.
        worker.close()

    @pytest.mark.asyncio
    async def test_close_ends_the_answer_reader(self) -> None:
        fake = _AnsweredByTheTest()
        task = asyncio.create_task(run_on_worker(fake.worker, "first", {}, {}, _TRUST))
        await fake.settle()
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)

        fake.worker.close()
        await fake.settle()

        assert fake.worker.reader is not None and fake.worker.reader.done()
