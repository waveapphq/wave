"""The Netcat test furniture's listeners and leak check (NETCAT-6).

The leak check fails a test that leaves a socket, transport or stream writer open. It is fair only
when the furniture closes its own side: a far end still closing when the test ends is closed before
the event loop closes, and a channel really left open still fails its test.
"""

import asyncio
import os
import subprocess
import sys
from collections.abc import Awaitable, Callable
from pathlib import Path

from tests.plugins.netcat.conftest import Listener

Listen = Callable[..., Awaitable[Listener]]
BACKEND = Path(__file__).resolve().parents[3]

LEFT_OPEN = """
import asyncio

from tests.plugins.netcat.conftest import _earlier_garbage_collected, listen, no_unclosed_resource


async def test_a_client_left_open_is_reported(listen):
    far = await listen("tcp-echo")
    _, writer = await asyncio.open_connection("127.0.0.1", far.port)
    writer.write(b"ping")
    await writer.drain()
"""


async def test_a_far_end_still_closing_is_closed_before_the_loop_closes(listen: Listen) -> None:
    far = await listen("tcp-echo")
    _, writer = await asyncio.open_connection("127.0.0.1", far.port)
    writer.close()


def test_the_leak_check_still_fails_a_test_that_leaves_a_channel_open(tmp_path: Path) -> None:
    (tmp_path / "test_left_open.py").write_text(LEFT_OPEN)
    env = {**os.environ, "PYTHONPATH": str(BACKEND)}
    command = [sys.executable, "-m", "pytest", str(tmp_path / "test_left_open.py")]
    options = ["-c", str(BACKEND / "pyproject.toml"), "--rootdir", str(tmp_path), "-p", "no:xdist"]
    run = subprocess.run(
        [*command, *options], cwd=BACKEND, env=env, capture_output=True, text=True, timeout=60
    )
    assert run.returncode == 1, run.stdout
    assert "1 passed, 1 error" in run.stdout, run.stdout
    assert "unclosed" in run.stdout, run.stdout
