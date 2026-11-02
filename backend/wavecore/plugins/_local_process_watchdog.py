"""The watchdog WAVE starts a local process under (REQ-3.2.2.4, SHRUN-15)."""

import os
import signal
import subprocess
import sys
import threading
from types import FrameType


def watch_lifeline(fd: int) -> None:
    """Block until WAVE's end of the lifeline goes away, then kill this whole group."""
    try:
        os.read(fd, 1)
    except OSError:
        pass
    _kill_own_group()


def status_line(returncode: int) -> str:
    """The exit code WAVE reads back; a signal death counts as 128 plus the signal."""
    code = returncode if returncode >= 0 else 128 - returncode
    return f"exit {code}"


def _kill_own_group() -> None:
    # Only a group this watchdog leads (WAVE starts it in a new session), never its starter's.
    if os.getpgrp() == os.getpid():
        os.killpg(0, signal.SIGKILL)


def _term_is_for_the_program(signum: int, frame: FrameType | None) -> None:
    """A group TERM (a pattern stop) reaches the program; the watchdog keeps waiting."""


def _run(program: list[str]) -> str:
    # The program stays in this group, so the group kill reaches it and its children.
    try:
        child = subprocess.Popen(program, close_fds=True)
    except OSError as exc:
        return f"spawn-error {exc.strerror}"
    return status_line(child.wait())


def main(argv: list[str]) -> None:
    lifeline_fd, status_fd = int(argv[0]), int(argv[1])
    # A handler, never SIG_IGN: an ignored disposition would survive the exec into the program.
    signal.signal(signal.SIGTERM, _term_is_for_the_program)
    threading.Thread(target=watch_lifeline, args=(lifeline_fd,), daemon=True).start()
    try:
        os.write(status_fd, f"{_run(argv[2:])}\n".encode())
    finally:
        _kill_own_group()


if __name__ == "__main__":
    main(sys.argv[1:])
