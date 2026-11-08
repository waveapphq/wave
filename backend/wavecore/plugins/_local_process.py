"""The runtime core Shell Script and Shell Exec share (REQ-3.4.1.1, REQ-3.4.1.18).

One launch under the watchdog: stream both pipes as lines, keep a capped tail of
each, and stop on a pattern match or the deadline (SHRUN-12, SHRUN-13, SHRUN-15).
A pattern match terminates the group so the shell may run its exit handler, then
kills it once the grace has passed; the deadline and a cancel kill it at once, and a
cancel hands what the program printed to on_stop before it reaches the caller. The
core builds no block message; _local_process_common.judge_outcome reads the outcome.
"""

import asyncio
import os
import re
import select
import sys
from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, cast

from wavecore.plugins import _process_group

WATCHDOG_PATH = Path(__file__).with_name("_local_process_watchdog.py")
TAIL_CAP = 16 * 1024 * 1024
FLUSH_RUN = 1024 * 1024
READ_SIZE = 65536
# The first TERM waits for the shell to fork the command after the matched line, or that
# command is born without it; the second catches a fork that was late; then the kill.
PATTERN_STOP_SETTLE = 0.05
PATTERN_STOP_NUDGE = 0.25
PATTERN_STOP_GRACE = 2.0
# After the deadline kill; a program in a session of its own may keep the pipes open.
PIPE_CLOSE_GRACE = 1.0
MATCH_LINE_LIMIT = 200
STOPPED_EXIT_CODE = 137
PASS_MATCH = "Output matched the pass pattern"

OnMatch = Callable[[str, str | None, str | None], None]


@dataclass(frozen=True)
class LaunchSpec:
    argv: list[str]
    cwd: str
    env: dict[str, str]
    timeout: float
    stream_output: bool
    secret_streams: frozenset[str]
    pass_re: re.Pattern[str] | None
    fail_re: re.Pattern[str] | None
    logger: Any | None


@dataclass(frozen=True)
class ProcessOutcome:
    stdout: str
    stderr: str
    exit_code: int
    ended_on_own: bool
    stop: str | None
    match_line: str | None
    match_stream: str | None
    start_error: str | None


@dataclass
class _StreamState:
    """The capped tail of one stream, what fell off its front, and the unfinished line."""

    tail: bytearray = field(default_factory=bytearray)
    dropped: int = 0
    pending: bytes = b""

    def keep(self, chunk: bytes) -> None:
        self.tail += chunk
        excess = len(self.tail) - TAIL_CAP
        if excess > 0:
            del self.tail[:excess]
            self.dropped += excess

    def text(self) -> str:
        return self.tail.decode("utf-8", errors="replace")


def match_message(prefix: str, line: str | None, stream: str | None, secret: frozenset[str]) -> str:
    """The prefix alone for a secret stream; otherwise the prefix and the line cut short."""
    if stream in secret:
        return prefix
    return f"{prefix}: {(line or '')[:MATCH_LINE_LIMIT]}"


class _Halt:
    """What ended the run early; the first stop wins."""

    def __init__(self, pgid: int, status_fd: int, spec: LaunchSpec) -> None:
        self.pgid = pgid
        self.status_fd = status_fd
        self.spec = spec
        self.stop: str | None = None
        self.match_line: str | None = None
        self.match_stream: str | None = None
        self.terminated = False
        self.timers: list[asyncio.TimerHandle] = []

    def __call__(self, stop: str, line: str | None, stream: str | None) -> None:
        if stop == "timeout":
            self.stop = self.stop or stop
            _kill_group(self.pgid)
        elif self.stop is None:
            self._match(stop, line, stream)

    def _match(self, stop: str, line: str | None, stream: str | None) -> None:
        self.stop, self.match_line, self.match_stream = stop, line, stream
        if stop == "pass" and self.spec.logger is not None:
            self.spec.logger.info(match_message(PASS_MATCH, line, stream, self.spec.secret_streams))
        if _status_ready(self.status_fd):
            return
        self.terminated = True
        loop = asyncio.get_running_loop()
        self.timers = [
            loop.call_later(PATTERN_STOP_SETTLE, _process_group.terminate_group, self.pgid),
            loop.call_later(
                PATTERN_STOP_SETTLE + PATTERN_STOP_NUDGE, _process_group.terminate_group, self.pgid
            ),
            loop.call_later(PATTERN_STOP_SETTLE + PATTERN_STOP_GRACE, _kill_group, self.pgid),
        ]

    def settle(self) -> None:
        for timer in self.timers:
            timer.cancel()

    def abort(self) -> None:
        """End the group at once, whatever stop was under way."""
        _kill_group(self.pgid)
        self.settle()
        self.stop, self.match_line, self.match_stream = "cancel", None, None


def _timeout_errors() -> tuple[type[BaseException], ...]:
    """asyncio.TimeoutError is its own class below Python 3.11, the bundle's interpreter floor."""
    return (TimeoutError, asyncio.TimeoutError)


def _kill_group(pgid: int) -> None:
    _process_group.kill_group(pgid)


def _status_ready(fd: int) -> bool:
    """True once the watchdog has written the program's own exit (or has gone)."""
    return bool(select.select([fd], [], [], 0)[0])


def _read_status(fd: int) -> tuple[bool, int, str | None]:
    """(ended on its own, exit code, spawn error) from the watchdog's status line."""
    data = b""
    while chunk := os.read(fd, 4096):
        data += chunk
    line = data.decode("utf-8", errors="replace").removesuffix("\n")
    if line.startswith("exit "):
        return True, int(line[5:]), None
    if line.startswith("spawn-error "):
        return False, -1, line[12:]
    return False, STOPPED_EXIT_CODE, None


def _line(raw: bytes, spec: LaunchSpec, stream: str, on_match: OnMatch) -> None:
    line = raw.removesuffix(b"\r").decode("utf-8", errors="replace")
    if spec.logger is not None and spec.stream_output and stream not in spec.secret_streams:
        (spec.logger.info if stream == "stdout" else spec.logger.warn)(line)
    if spec.fail_re is not None and spec.fail_re.search(line):
        on_match("fail", line, stream)
    elif spec.pass_re is not None and spec.pass_re.search(line):
        on_match("pass", line, stream)


async def _read_stream(
    reader: asyncio.StreamReader,
    state: _StreamState,
    spec: LaunchSpec,
    stream: str,
    on_match: OnMatch,
) -> None:
    while chunk := await reader.read(READ_SIZE):
        state.keep(chunk)
        *lines, state.pending = (state.pending + chunk).split(b"\n")
        for raw in lines:
            _line(raw, spec, stream, on_match)
        if len(state.pending) >= FLUSH_RUN:
            _line(state.pending, spec, stream, on_match)
            state.pending = b""
    if state.pending:
        _line(state.pending, spec, stream, on_match)
        state.pending = b""


async def _supervise(
    proc: asyncio.subprocess.Process,
    states: dict[str, _StreamState],
    spec: LaunchSpec,
    on_match: OnMatch,
) -> None:
    """Read both pipes to EOF, then wait for the watchdog to end."""
    await asyncio.gather(
        _read_stream(
            cast(asyncio.StreamReader, proc.stdout), states["stdout"], spec, "stdout", on_match
        ),
        _read_stream(
            cast(asyncio.StreamReader, proc.stderr), states["stderr"], spec, "stderr", on_match
        ),
    )
    await proc.wait()


async def _drain(work: asyncio.Future[None]) -> None:
    """Let the readers take what is left for a grace, then stop them where they are."""
    try:
        await asyncio.wait_for(asyncio.shield(work), PIPE_CLOSE_GRACE)
    except _timeout_errors():
        work.cancel()


def _outcome(
    states: dict[str, _StreamState],
    spec: LaunchSpec,
    halt: _Halt,
    ended_on_own: bool,
    exit_code: int,
    start_error: str | None,
) -> ProcessOutcome:
    """The captured tails with the run's status; a stream that dropped its front says so."""
    for stream, state in states.items():
        if state.dropped and spec.logger is not None:
            spec.logger.warn(f"{stream.capitalize()} truncated: {state.dropped} bytes dropped")
    return ProcessOutcome(
        stdout=states["stdout"].text(),
        stderr=states["stderr"].text(),
        exit_code=exit_code,
        ended_on_own=ended_on_own,
        stop=halt.stop,
        match_line=halt.match_line,
        match_stream=halt.match_stream,
        start_error=start_error,
    )


async def run_local_process(
    spec: LaunchSpec, on_stop: Callable[[ProcessOutcome], None] | None = None
) -> ProcessOutcome:
    lifeline_r, lifeline_w = os.pipe()
    status_r, status_w = os.pipe()
    states = {"stdout": _StreamState(), "stderr": _StreamState()}
    try:
        try:
            proc = await asyncio.create_subprocess_exec(
                sys.executable,
                "-I",
                str(WATCHDOG_PATH),
                str(lifeline_r),
                str(status_w),
                *spec.argv,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=spec.cwd,
                env=spec.env,
                start_new_session=True,
                pass_fds=(lifeline_r, status_w),
            )
        except OSError as exc:
            return ProcessOutcome("", "", -1, False, None, None, None, exc.strerror or str(exc))
        finally:
            os.close(lifeline_r)
            os.close(status_w)
        halt = _Halt(proc.pid, status_r, spec)
        work = asyncio.ensure_future(_supervise(proc, states, spec, halt))
        try:
            try:
                await asyncio.wait_for(asyncio.shield(work), spec.timeout)
            except _timeout_errors():
                halt("timeout", None, None)
                await _drain(work)
            halt.settle()
            ended_on_own, exit_code, start_error = _read_status(status_r)
            if halt.terminated:
                ended_on_own, exit_code = False, STOPPED_EXIT_CODE
        except BaseException as exc:
            halt.abort()
            try:
                if on_stop is not None and isinstance(exc, asyncio.CancelledError):
                    # The cancel must reach the caller whatever the readers raise.
                    with suppress(Exception):
                        await _drain(work)
                    on_stop(_outcome(states, spec, halt, False, STOPPED_EXIT_CODE, None))
            finally:
                work.cancel()
            raise
    finally:
        os.close(lifeline_w)
        os.close(status_r)
    return _outcome(states, spec, halt, ended_on_own, exit_code, start_error)
