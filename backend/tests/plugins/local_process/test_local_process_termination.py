"""Local-process termination: the whole tree dies, never only the shell (REQ-3.2.2.4).

SHRUN-15: a block owns every process it starts, and a stop ends them. A timeout, a cancel, a
normal exit that left a background job, a closed lifeline and WAVE itself being killed
outright each end the group at once. A pattern match terminates the group first, so the shell
may run WAVE's exit handler, and kills it once a short grace has passed.
"""

import asyncio
import os
import re
import signal
import subprocess
import sys
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from wavecore.plugins import _local_process
from wavecore.plugins._local_process import LaunchSpec, run_local_process
from wavecore.plugins._local_process_runtime import judge_outcome

Spec = Callable[..., LaunchSpec]
POLL = 0.005
BACKEND_ROOT = Path(str(_local_process.__file__)).resolve().parents[2]

STAND_IN = """\
import asyncio
import os
import sys

from wavecore.plugins._local_process import LaunchSpec, run_local_process

asyncio.run(
    run_local_process(
        LaunchSpec(
            argv=["/bin/sh", "-c", sys.argv[1]],
            cwd=os.path.dirname(os.path.abspath(__file__)),
            env={"PATH": "/usr/bin:/bin"},
            timeout=30.0,
            stream_output=False,
            secret_streams=frozenset(),
            pass_re=None,
            fail_re=None,
            logger=None,
        )
    )
)
"""


@pytest.fixture
def spec(tmp_path: Path) -> Spec:
    """A quiet launch in tmp_path: no console, no patterns, a generous deadline."""

    def build(argv: list[str], **overrides: Any) -> LaunchSpec:
        fields: dict[str, Any] = {
            "argv": argv,
            "cwd": str(tmp_path),
            "env": dict(os.environ),
            "timeout": 10.0,
            "stream_output": False,
            "secret_streams": frozenset(),
            "pass_re": None,
            "fail_re": None,
            "logger": None,
        }
        fields.update(overrides)
        return LaunchSpec(**fields)

    return build


def background_job(pid_file: Path, tail: str) -> list[str]:
    """A shell that starts a grandchild, records its pid, then runs the given tail."""
    return ["/bin/sh", "-c", f'sleep 999 &\necho $! > "{pid_file}"\n{tail}\n']


def alive(pid: int) -> bool:
    """A pid that still names a process which has not ended."""
    try:
        stat = Path(f"/proc/{pid}/stat").read_text(encoding="utf-8")
    except OSError:
        return False
    return stat.rsplit(") ", 1)[-1].split(" ", 1)[0] != "Z"


async def pid_from(pid_file: Path, bound: float = 2.0) -> int:
    """The pid a shell recorded, once the file holds it."""
    deadline = time.monotonic() + bound
    while time.monotonic() < deadline:
        text = pid_file.read_text(encoding="utf-8").strip() if pid_file.exists() else ""
        if text:
            return int(text)
        await asyncio.sleep(POLL)
    raise AssertionError(f"{pid_file} was never written")


async def wait_until_gone(pid: int, bound: float = 2.0) -> None:
    deadline = time.monotonic() + bound
    while time.monotonic() < deadline:
        if not alive(pid):
            return
        await asyncio.sleep(POLL)
    raise AssertionError(f"pid {pid} is still running")


def ignoring_job(pid_file: Path, tail: str) -> list[str]:
    """A shell that ignores TERM before it starts its grandchild, so only a kill ends them."""
    return ["/bin/sh", "-c", f'trap "" TERM\nsleep 999 &\necho $! > "{pid_file}"\n{tail}\n']


def start_watchdog(program: list[str]) -> tuple[subprocess.Popen[bytes], int, int]:
    """The watchdog spawned as the core spawns it: (process, lifeline write end, status read)."""
    lifeline_r, lifeline_w = os.pipe()
    status_r, status_w = os.pipe()
    os.set_inheritable(lifeline_r, True)
    os.set_inheritable(status_w, True)
    watchdog = subprocess.Popen(
        [
            sys.executable,
            "-I",
            str(_local_process.WATCHDOG_PATH),
            str(lifeline_r),
            str(status_w),
            *program,
        ],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
        pass_fds=(lifeline_r, status_w),
    )
    os.close(lifeline_r)
    os.close(status_w)
    return watchdog, lifeline_w, status_r


def read_to_eof(fd: int) -> bytes:
    data = b""
    while chunk := os.read(fd, 4096):
        data += chunk
    return data


class TestGroupKillWhileRunning:
    """A timeout and a cancel end the whole group at once; a pattern match ends it too."""

    async def test_timeout_kills_tree_and_keeps_output(self, tmp_path: Path, spec: Spec) -> None:
        pid_file = tmp_path / "grandchild.pid"

        outcome = await run_local_process(
            spec(background_job(pid_file, "echo before-kill\nwait"), timeout=0.2)
        )

        assert outcome.stop == "timeout"
        assert outcome.exit_code == 137
        assert outcome.ended_on_own is False
        assert outcome.stdout == "before-kill\n"
        await wait_until_gone(await pid_from(pid_file))

    async def test_a_pattern_stop_kills_the_tree(self, tmp_path: Path, spec: Spec) -> None:
        pid_file = tmp_path / "grandchild.pid"

        outcome = await run_local_process(
            spec(
                background_job(pid_file, "echo MATCHME\nwait"),
                fail_re=re.compile("MATCHME"),
            )
        )

        assert outcome.stop == "fail"
        assert outcome.match_stream == "stdout"
        assert outcome.match_line == "MATCHME"
        assert outcome.exit_code == 137
        assert outcome.ended_on_own is False
        await wait_until_gone(await pid_from(pid_file))

    async def test_a_cancel_kills_the_tree_and_re_raises(self, tmp_path: Path, spec: Spec) -> None:
        pid_file = tmp_path / "grandchild.pid"
        task = asyncio.ensure_future(run_local_process(spec(background_job(pid_file, "wait"))))
        grandchild = await pid_from(pid_file)

        task.cancel()

        with pytest.raises(asyncio.CancelledError):
            await task
        await wait_until_gone(grandchild)


class TestPatternStopIsGraceful:
    """A pattern match terminates the group, then kills whatever is still there."""

    async def test_the_shell_gets_to_run_its_term_trap(self, tmp_path: Path, spec: Spec) -> None:
        pid_file = tmp_path / "grandchild.pid"
        mark = tmp_path / "trapped"
        program = [
            "/bin/sh",
            "-c",
            f"trap 'echo trapped > \"{mark}\"; exit 0' TERM\n"
            f'sleep 999 &\necho $! > "{pid_file}"\necho MATCHME\nwait\n',
        ]

        outcome = await run_local_process(spec(program, fail_re=re.compile("MATCHME")))

        assert outcome.stop == "fail"
        assert outcome.exit_code == 137
        assert outcome.ended_on_own is False
        assert mark.read_text(encoding="utf-8") == "trapped\n"
        await wait_until_gone(await pid_from(pid_file))

    async def test_a_command_forked_after_the_first_term_gets_a_second(
        self, tmp_path: Path, spec: Spec
    ) -> None:
        mark = tmp_path / "nudged"
        program = [
            "/bin/sh",
            "-c",
            "trap '' TERM\necho MATCHME\nsleep 0.15\n"
            f"trap 'echo nudged > \"{mark}\"; exit 0' TERM\nsleep 999\n",
        ]
        started = time.monotonic()

        outcome = await run_local_process(spec(program, fail_re=re.compile("MATCHME")))

        assert time.monotonic() - started < 1.0
        assert outcome.stop == "fail"
        assert outcome.exit_code == 137
        assert mark.read_text(encoding="utf-8") == "nudged\n"

    async def test_a_tree_that_ignores_term_is_killed_once_the_grace_passes(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, spec: Spec
    ) -> None:
        monkeypatch.setattr(_local_process, "PATTERN_STOP_GRACE", 0.2)
        pid_file = tmp_path / "grandchild.pid"
        started = time.monotonic()

        outcome = await run_local_process(
            spec(ignoring_job(pid_file, "echo MATCHME\nwait"), fail_re=re.compile("MATCHME"))
        )

        assert 0.2 <= time.monotonic() - started < 1.5
        assert outcome.stop == "fail"
        assert outcome.exit_code == 137
        assert outcome.ended_on_own is False
        await wait_until_gone(await pid_from(pid_file))

    async def test_the_deadline_kills_during_the_grace_and_the_stop_stays(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, spec: Spec
    ) -> None:
        monkeypatch.setattr(_local_process, "PATTERN_STOP_GRACE", 5.0)
        pid_file = tmp_path / "grandchild.pid"
        started = time.monotonic()

        outcome = await run_local_process(
            spec(
                ignoring_job(pid_file, "echo READY\nwait"),
                pass_re=re.compile("READY"),
                timeout=0.15,
            )
        )

        assert time.monotonic() - started < 1.0
        assert outcome.stop == "pass"
        assert outcome.exit_code == 137
        assert outcome.ended_on_own is False
        await wait_until_gone(await pid_from(pid_file))

    async def test_a_cancel_during_the_grace_kills_the_tree_at_once(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, spec: Spec
    ) -> None:
        monkeypatch.setattr(_local_process, "PATTERN_STOP_GRACE", 5.0)
        pid_file = tmp_path / "grandchild.pid"
        task = asyncio.ensure_future(
            run_local_process(
                spec(ignoring_job(pid_file, "echo READY\nwait"), pass_re=re.compile("READY"))
            )
        )
        grandchild = await pid_from(pid_file)
        await asyncio.sleep(0.05)

        task.cancel()

        with pytest.raises(asyncio.CancelledError):
            await task
        await wait_until_gone(grandchild)

    async def test_a_group_term_reaches_the_program_and_not_the_watchdog(
        self, tmp_path: Path
    ) -> None:
        shell_file = tmp_path / "shell.pid"
        watchdog, lifeline_w, status_r = start_watchdog(
            ["/bin/sh", "-c", f'echo $$ > "{shell_file}"\nsleep 999\n']
        )
        try:
            shell = await pid_from(shell_file)

            os.killpg(watchdog.pid, signal.SIGTERM)

            assert read_to_eof(status_r) == b"exit 143\n"
            await wait_until_gone(shell)
            assert watchdog.wait(timeout=2) == -signal.SIGKILL
        finally:
            os.close(lifeline_w)
            os.close(status_r)
            watchdog.kill()
            watchdog.wait(timeout=5)


class TestNormalExit:
    """A job the script left behind is killed too, so it cannot hold the run open."""

    async def test_leftover_job_killed_at_normal_exit(self, tmp_path: Path, spec: Spec) -> None:
        pid_file = tmp_path / "grandchild.pid"

        outcome = await asyncio.wait_for(
            run_local_process(spec(background_job(pid_file, "exit 0"))), timeout=2.0
        )

        assert outcome.ended_on_own is True
        assert outcome.exit_code == 0
        assert outcome.stop is None
        await wait_until_gone(await pid_from(pid_file))


class TestLifeline:
    """The watchdog ends the tree when WAVE goes away, with or without a chance to clean up."""

    async def test_a_closed_lifeline_kills_the_tree(self, tmp_path: Path) -> None:
        pid_file = tmp_path / "grandchild.pid"
        lifeline_r, lifeline_w = os.pipe()
        status_r, status_w = os.pipe()
        os.set_inheritable(lifeline_r, True)
        os.set_inheritable(status_w, True)
        watchdog = subprocess.Popen(
            [
                sys.executable,
                "-I",
                str(_local_process.WATCHDOG_PATH),
                str(lifeline_r),
                str(status_w),
                *background_job(pid_file, "wait"),
            ],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
            pass_fds=(lifeline_r, status_w),
        )
        os.close(lifeline_r)
        os.close(status_w)
        lifeline_open = True
        try:
            grandchild = await pid_from(pid_file)

            os.close(lifeline_w)
            lifeline_open = False

            await wait_until_gone(grandchild)
            assert watchdog.wait(timeout=2) == -signal.SIGKILL
        finally:
            if lifeline_open:
                os.close(lifeline_w)
            os.close(status_r)
            watchdog.kill()
            watchdog.wait(timeout=5)

    async def test_server_death_leaves_no_tree(self, tmp_path: Path) -> None:
        pid_file = tmp_path / "grandchild.pid"
        shell_file = tmp_path / "shell.pid"
        stand_in = tmp_path / "wave_stand_in.py"
        stand_in.write_text(STAND_IN, encoding="utf-8")
        log = tmp_path / "wave_stand_in.log"
        script = f'echo $$ > "{shell_file}"\nsleep 999 &\necho $! > "{pid_file}"\nwait\n'
        with log.open("wb") as handle:
            server = subprocess.Popen(
                [sys.executable, str(stand_in), script],
                stdin=subprocess.DEVNULL,
                stdout=handle,
                stderr=handle,
                env={**os.environ, "PYTHONPATH": str(BACKEND_ROOT)},
            )
        try:
            try:
                grandchild = await pid_from(pid_file, bound=5.0)
                shell = await pid_from(shell_file, bound=5.0)
            except AssertionError as exc:
                raise AssertionError(f"{exc}: {log.read_text(encoding='utf-8')}") from exc

            server.kill()
            assert server.wait(timeout=5) == -signal.SIGKILL

            await wait_until_gone(shell, bound=5.0)
            await wait_until_gone(grandchild, bound=5.0)
        finally:
            server.kill()
            server.wait(timeout=5)


class _AsyncioOnlyTimeout(Exception):
    """asyncio.TimeoutError below Python 3.11, where it is not the builtin TimeoutError."""


class TestTimeoutOnTheBundleInterpreterFloor:
    """The bundle floor is Python 3.10, where asyncio's timeout is a class of its own."""

    async def test_a_timeout_that_is_not_the_builtin_still_stops_the_run(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path, spec: Spec
    ) -> None:
        pid_file = tmp_path / "grandchild.pid"
        real_wait_for = asyncio.wait_for

        async def wait_for(awaitable: Any, timeout: float) -> Any:
            try:
                return await real_wait_for(awaitable, timeout)
            except TimeoutError:
                raise _AsyncioOnlyTimeout from None

        monkeypatch.setattr(asyncio, "TimeoutError", _AsyncioOnlyTimeout)
        monkeypatch.setattr(asyncio, "wait_for", wait_for)

        outcome = await run_local_process(
            spec(background_job(pid_file, "echo before-kill\nwait"), timeout=1)
        )

        assert outcome.stop == "timeout"
        assert outcome.exit_code == 137
        assert outcome.ended_on_own is False
        assert judge_outcome(outcome, "Script", 1, frozenset()) == (
            "Script timed out after 1 seconds",
            "Timeout",
        )
        await wait_until_gone(await pid_from(pid_file))
