"""Local-process streams: tail caps, line assembly, live console lines and secret streams.

REQ-3.4.1.1 and REQ-3.4.1.18: stdout lines go to the run console at INFO and stderr at WARN
while Log Output is on, a stream marked secret is never written live (SHRUN-12), and with
Log Output off the core writes no raw output at any level.
"""

import os
import re
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

from wavecore.plugins._local_process import LaunchSpec, ProcessOutcome, run_local_process

Spec = Callable[..., LaunchSpec]
TAIL_CAP = 16 * 1024 * 1024
FLUSH_RUN = 1024 * 1024


@pytest.fixture
def spec(tmp_path: Path) -> Spec:
    """A launch in tmp_path that logs through the given console logger."""

    def build(argv: list[str], logger: Any, **overrides: Any) -> LaunchSpec:
        fields: dict[str, Any] = {
            "argv": argv,
            "cwd": str(tmp_path),
            "env": dict(os.environ),
            "timeout": 10.0,
            "stream_output": True,
            "secret_streams": frozenset(),
            "pass_re": None,
            "fail_re": None,
            "logger": logger,
        }
        fields.update(overrides)
        return LaunchSpec(**fields)

    return build


def messages(logger: MagicMock, level: str) -> list[str]:
    return [str(call.args[0]) for call in getattr(logger, level).call_args_list if call.args]


def every_message(logger: MagicMock) -> list[str]:
    return [str(arg) for call in logger.mock_calls for arg in call.args]


async def run_over_the_cap(stream: str, logger: MagicMock, spec: Spec) -> ProcessOutcome:
    """Write 1024 bytes over the tail cap to one stream through a real pipe."""
    target = "sys.stdout" if stream == "stdout" else "sys.stderr"
    program = f'import sys; {target}.write("A" * 1024 + "B" * {TAIL_CAP})'
    return await run_local_process(
        spec([sys.executable, "-c", program], logger, stream_output=False)
    )


class TestTailCaps:
    """Only the last 16 MiB of a stream is kept, and the drop is reported once."""

    async def test_stdout_tail_truncated(self, spec: Spec) -> None:
        logger = MagicMock()

        outcome = await run_over_the_cap("stdout", logger, spec)

        assert len(outcome.stdout) == TAIL_CAP
        assert "A" not in outcome.stdout
        assert messages(logger, "warn") == ["Stdout truncated: 1024 bytes dropped"]

    async def test_stderr_tail_truncated(self, spec: Spec) -> None:
        logger = MagicMock()

        outcome = await run_over_the_cap("stderr", logger, spec)

        assert len(outcome.stderr) == TAIL_CAP
        assert "A" not in outcome.stderr
        assert messages(logger, "warn") == ["Stderr truncated: 1024 bytes dropped"]


class TestLineAssembly:
    """A line is a line however it arrives on the pipe."""

    async def test_a_line_written_in_two_halves_is_matched_whole(self, spec: Spec) -> None:
        outcome = await run_local_process(
            spec(
                ["/bin/sh", "-c", 'printf "ER"; sleep 0.05; echo "ROR x"; sleep 5'],
                MagicMock(),
                fail_re=re.compile("ERROR x"),
            )
        )

        assert outcome.stop == "fail"
        assert outcome.match_line == "ERROR x"

    async def test_a_carriage_return_is_stripped(self, spec: Spec) -> None:
        logger = MagicMock()

        await run_local_process(spec(["/bin/sh", "-c", r'printf "hello\r\n"'], logger))

        assert messages(logger, "info") == ["hello"]

    async def test_a_final_unterminated_line_is_streamed(self, spec: Spec) -> None:
        logger = MagicMock()

        await run_local_process(spec(["/bin/sh", "-c", 'printf "tail-no-newline"'], logger))

        assert messages(logger, "info") == ["tail-no-newline"]

    async def test_a_run_with_no_newline_is_flushed_at_one_mebibyte(self, spec: Spec) -> None:
        logger = MagicMock()
        grow = f"s=xxxxxxxx; while [ ${{#s}} -le {FLUSH_RUN} ]; do s=$s$s; done"

        outcome = await run_local_process(
            spec(
                ["/bin/sh", "-c", f'{grow}; printf "%s" "$s"; sleep 5'],
                logger,
                pass_re=re.compile("xxxx"),
            )
        )

        assert outcome.stop == "pass"
        assert len(messages(logger, "info")[0]) >= FLUSH_RUN


class TestLiveConsole:
    """Lines reach the console while the program is still running (SHRUN-12)."""

    async def test_stdout_logs_at_info_and_stderr_at_warn_before_the_process_ends(
        self, spec: Spec
    ) -> None:
        logger = MagicMock()

        outcome = await run_local_process(
            spec(["/bin/sh", "-c", "echo out; echo err >&2; sleep 5"], logger, timeout=0.3)
        )

        assert outcome.stop == "timeout"
        assert outcome.ended_on_own is False
        assert messages(logger, "info") == ["out"]
        assert messages(logger, "warn") == ["err"]


class TestSecretStreams:
    """A stream marked secret is never written live (SHRUN-12)."""

    async def test_a_secret_stdout_writes_no_live_line(self, spec: Spec) -> None:
        logger = MagicMock()

        outcome = await run_local_process(
            spec(
                ["/bin/sh", "-c", "echo out; echo err >&2"],
                logger,
                secret_streams=frozenset({"stdout"}),
            )
        )

        assert outcome.stdout == "out\n"
        assert messages(logger, "info") == []
        assert messages(logger, "warn") == ["err"]

    async def test_a_secret_stderr_writes_no_live_line(self, spec: Spec) -> None:
        logger = MagicMock()

        outcome = await run_local_process(
            spec(
                ["/bin/sh", "-c", "echo out; echo err >&2"],
                logger,
                secret_streams=frozenset({"stderr"}),
            )
        )

        assert outcome.stderr == "err\n"
        assert messages(logger, "info") == ["out"]
        assert messages(logger, "warn") == []


class TestNoRawIoDumps:
    """With Log Output off the core writes no output of its own at any level."""

    async def test_no_logger_call_at_any_level_carries_the_stdout_text(self, spec: Spec) -> None:
        logger = MagicMock()

        outcome = await run_local_process(
            spec(["/bin/sh", "-c", "echo leaky-stdout-text"], logger, stream_output=False)
        )

        assert outcome.stdout == "leaky-stdout-text\n"
        assert not any("leaky-stdout-text" in message for message in every_message(logger))
