"""Local-process Stop on pattern: pass, fail, both and none (SHRUN-13).

REQ-3.4.1.1 and REQ-3.4.1.18: patterns are searched against each line of stdout and stderr.
A pass match stops the program, says so on the console and the block passes; a fail match
stops it and the block fails; a line matching both fails; with no match the exit code decides,
and a non-zero exit names the last line the program wrote to stderr (REQ-3.2.2.4 owns the stop
itself, proven in the termination file).
"""

import os
import re
from collections.abc import Callable
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

from wavecore.plugins._local_process import LaunchSpec, ProcessOutcome, run_local_process
from wavecore.plugins._local_process_runtime import judge_outcome

Spec = Callable[..., LaunchSpec]
LONG_LINE = "E" * 250
PASS_LINE = "Output matched the pass pattern"


def messages(logger: MagicMock, level: str) -> list[str]:
    return [str(call.args[0]) for call in getattr(logger, level).call_args_list if call.args]


@pytest.fixture
def spec(tmp_path: Path) -> Spec:
    """A launch in tmp_path with Stop on pattern armed and a deadline no match reaches."""

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


@pytest.fixture
async def pass_match(spec: Spec) -> ProcessOutcome:
    return await run_local_process(
        spec(["/bin/sh", "-c", "echo READY; sleep 5"], pass_re=re.compile("READY"))
    )


@pytest.fixture
async def fail_match(spec: Spec) -> ProcessOutcome:
    return await run_local_process(
        spec(["/bin/sh", "-c", "echo ERROR x; sleep 5"], fail_re=re.compile("ERROR"))
    )


class TestPassPattern:
    """A pass match stops the program, records the line and the block passes."""

    async def test_a_pass_match_stops_the_program(self, pass_match: ProcessOutcome) -> None:
        assert pass_match.stop == "pass"
        assert pass_match.exit_code == 137
        assert pass_match.ended_on_own is False

    async def test_a_pass_match_records_the_line_and_the_stream(
        self, pass_match: ProcessOutcome
    ) -> None:
        assert pass_match.match_line == "READY"
        assert pass_match.match_stream == "stdout"

    async def test_a_pass_match_is_not_a_failure(self, pass_match: ProcessOutcome) -> None:
        assert judge_outcome(pass_match, "Script", 300, frozenset()) == (None, None)

    async def test_a_pass_match_on_stderr_records_its_stream(self, spec: Spec) -> None:
        outcome = await run_local_process(
            spec(["/bin/sh", "-c", "echo READY >&2; sleep 5"], pass_re=re.compile("READY"))
        )

        assert outcome.stop == "pass"
        assert outcome.match_stream == "stderr"


class TestPassMatchConsoleLine:
    """The console says why the program stopped, once, at INFO, with Log Output off."""

    async def test_the_line_names_the_matching_line(self, spec: Spec) -> None:
        logger = MagicMock()

        await run_local_process(
            spec(
                ["/bin/sh", "-c", "echo READY now; sleep 5"],
                pass_re=re.compile("READY"),
                logger=logger,
            )
        )

        assert messages(logger, "info") == [f"{PASS_LINE}: READY now"]

    async def test_a_match_on_a_secret_stream_omits_the_line(self, spec: Spec) -> None:
        logger = MagicMock()

        await run_local_process(
            spec(
                ["/bin/sh", "-c", "echo READY now; sleep 5"],
                pass_re=re.compile("READY"),
                logger=logger,
                secret_streams=frozenset({"stdout"}),
            )
        )

        assert messages(logger, "info") == [PASS_LINE]

    async def test_a_long_matching_line_is_cut_to_200_characters(self, spec: Spec) -> None:
        logger = MagicMock()

        await run_local_process(
            spec(
                ["/bin/sh", "-c", 'echo "$1"; sleep 5', "sh", LONG_LINE],
                pass_re=re.compile("EEEE"),
                logger=logger,
            )
        )

        assert messages(logger, "info") == [f"{PASS_LINE}: {'E' * 200}"]

    async def test_a_second_matching_line_writes_nothing_more(self, spec: Spec) -> None:
        logger = MagicMock()

        await run_local_process(
            spec(
                ["/bin/sh", "-c", "echo READY 1; echo READY 2; sleep 5"],
                pass_re=re.compile("READY"),
                logger=logger,
            )
        )

        assert messages(logger, "info") == [f"{PASS_LINE}: READY 1"]

    async def test_a_fail_match_writes_no_info_line(self, spec: Spec) -> None:
        logger = MagicMock()

        await run_local_process(
            spec(
                ["/bin/sh", "-c", "echo ERROR x; sleep 5"],
                fail_re=re.compile("ERROR"),
                logger=logger,
            )
        )

        assert messages(logger, "info") == []


class TestFailPattern:
    """A fail match stops the program and names the matching line."""

    async def test_a_fail_match_stops_the_program(self, fail_match: ProcessOutcome) -> None:
        assert fail_match.stop == "fail"
        assert fail_match.match_line == "ERROR x"
        assert fail_match.match_stream == "stdout"
        assert fail_match.exit_code == 137
        assert fail_match.ended_on_own is False

    async def test_the_fail_message_carries_the_line(self, fail_match: ProcessOutcome) -> None:
        assert judge_outcome(fail_match, "Script", 300, frozenset()) == (
            "Output matched the fail pattern: ERROR x",
            "FailPattern",
        )

    async def test_a_line_matching_both_patterns_fails(self, spec: Spec) -> None:
        outcome = await run_local_process(
            spec(
                ["/bin/sh", "-c", "echo READY ERROR; sleep 5"],
                pass_re=re.compile("READY"),
                fail_re=re.compile("ERROR"),
            )
        )

        assert outcome.stop == "fail"
        assert outcome.match_line == "READY ERROR"

    async def test_a_long_matching_line_is_cut_to_200_characters(self, spec: Spec) -> None:
        outcome = await run_local_process(
            spec(
                ["/bin/sh", "-c", 'echo "$1"; sleep 5', "sh", LONG_LINE],
                fail_re=re.compile("EEEE"),
            )
        )

        assert outcome.match_line == LONG_LINE
        assert judge_outcome(outcome, "Script", 300, frozenset()) == (
            f"Output matched the fail pattern: {'E' * 200}",
            "FailPattern",
        )

    async def test_a_match_on_a_secret_stream_omits_the_line(
        self, fail_match: ProcessOutcome
    ) -> None:
        assert judge_outcome(fail_match, "Script", 300, frozenset({"stdout"})) == (
            "Output matched the fail pattern",
            "FailPattern",
        )

    async def test_a_match_on_stderr_stops_the_program(self, spec: Spec) -> None:
        outcome = await run_local_process(
            spec(["/bin/sh", "-c", "echo ERROR x >&2; sleep 5"], fail_re=re.compile("ERROR"))
        )

        assert outcome.stop == "fail"
        assert outcome.match_stream == "stderr"
        assert judge_outcome(outcome, "Script", 300, frozenset()) == (
            "Output matched the fail pattern: ERROR x",
            "FailPattern",
        )


class TestMatchRacesTheExit:
    """A line matched only once the program has ended on its own keeps the relayed code."""

    async def test_the_relayed_exit_code_stays(self, spec: Spec) -> None:
        outcome = await run_local_process(
            spec(["/bin/sh", "-c", "printf READY; exit 5"], pass_re=re.compile("READY"))
        )

        assert outcome.stop == "pass"
        assert outcome.match_line == "READY"
        assert outcome.exit_code == 5
        assert outcome.ended_on_own is True

    async def test_a_fail_match_that_races_the_exit_still_fails(self, spec: Spec) -> None:
        outcome = await run_local_process(
            spec(["/bin/sh", "-c", "printf ERROR; exit 0"], fail_re=re.compile("ERROR"))
        )

        assert outcome.stop == "fail"
        assert outcome.exit_code == 0
        assert outcome.ended_on_own is True
        assert judge_outcome(outcome, "Script", 300, frozenset()) == (
            "Output matched the fail pattern: ERROR",
            "FailPattern",
        )


class TestNoMatch:
    """A program that ends before any match is judged by its exit code."""

    async def test_a_non_zero_exit_decides_when_nothing_matched(self, spec: Spec) -> None:
        outcome = await run_local_process(
            spec(
                ["/bin/sh", "-c", "echo fine; exit 4"],
                pass_re=re.compile("READY"),
                fail_re=re.compile("ERROR"),
            )
        )

        assert outcome.stop is None
        assert outcome.ended_on_own is True
        assert outcome.exit_code == 4
        assert judge_outcome(outcome, "Script", 300, frozenset()) == (
            "Script exited with code 4",
            "NonZeroExit",
        )

    async def test_the_command_wording_of_a_non_zero_exit(self, spec: Spec) -> None:
        outcome = await run_local_process(
            spec(["/bin/sh", "-c", "exit 4"], fail_re=re.compile("ERROR"))
        )

        assert judge_outcome(outcome, "Command", 300, frozenset()) == (
            "Command exited with code 4",
            "NonZeroExit",
        )

    async def test_a_clean_run_with_patterns_armed_passes(self, spec: Spec) -> None:
        outcome = await run_local_process(
            spec(
                ["/bin/sh", "-c", "echo fine"],
                pass_re=re.compile("READY"),
                fail_re=re.compile("ERROR"),
            )
        )

        assert outcome.exit_code == 0
        assert judge_outcome(outcome, "Script", 300, frozenset()) == (None, None)


def exited(stderr: str, exit_code: int = 2) -> ProcessOutcome:
    """A program that ended on its own with a code and what it wrote to stderr."""
    return ProcessOutcome("", stderr, exit_code, True, None, None, None, None)


class TestNonZeroExitMessage:
    """A non-zero exit says why: the last non-empty stderr line, trimmed and cut to 200."""

    def test_the_last_stderr_line_follows_the_code(self) -> None:
        assert judge_outcome(exited("first\nlast words\n"), "Script", 300, frozenset()) == (
            "Script exited with code 2: last words",
            "NonZeroExit",
        )

    def test_trailing_blank_lines_are_skipped(self) -> None:
        assert judge_outcome(exited("boom\n\n   \n\t\n"), "Script", 300, frozenset()) == (
            "Script exited with code 2: boom",
            "NonZeroExit",
        )

    def test_the_line_is_trimmed(self) -> None:
        assert judge_outcome(exited("   spaced out \r\n"), "Script", 300, frozenset()) == (
            "Script exited with code 2: spaced out",
            "NonZeroExit",
        )

    def test_a_line_without_a_newline_still_counts(self) -> None:
        assert judge_outcome(exited("head\ntail"), "Script", 300, frozenset()) == (
            "Script exited with code 2: tail",
            "NonZeroExit",
        )

    def test_a_long_line_is_cut_to_200_characters(self) -> None:
        assert judge_outcome(exited(f"{LONG_LINE}\n"), "Script", 300, frozenset()) == (
            f"Script exited with code 2: {'E' * 200}",
            "NonZeroExit",
        )

    @pytest.mark.parametrize("stderr", ["", "\n", "  \n\t\n"])
    def test_empty_stderr_keeps_the_bare_message(self, stderr: str) -> None:
        assert judge_outcome(exited(stderr), "Script", 300, frozenset()) == (
            "Script exited with code 2",
            "NonZeroExit",
        )

    def test_a_secret_stderr_stream_omits_the_line(self) -> None:
        assert judge_outcome(exited("token abc\n"), "Script", 300, frozenset({"stderr"})) == (
            "Script exited with code 2",
            "NonZeroExit",
        )

    def test_a_secret_stdout_stream_still_names_the_stderr_line(self) -> None:
        assert judge_outcome(exited("bad input\n"), "Script", 300, frozenset({"stdout"})) == (
            "Script exited with code 2: bad input",
            "NonZeroExit",
        )

    def test_the_command_wording_names_the_line_too(self) -> None:
        outcome = exited("sh: 1: nosuch: not found\n", 127)

        assert judge_outcome(outcome, "Command", 300, frozenset()) == (
            "Command exited with code 127: sh: 1: nosuch: not found",
            "NonZeroExit",
        )

    def test_stdout_never_reaches_the_message(self) -> None:
        outcome = ProcessOutcome("only stdout\n", "", 3, True, None, None, None, None)

        assert judge_outcome(outcome, "Script", 300, frozenset()) == (
            "Script exited with code 3",
            "NonZeroExit",
        )

    async def test_a_real_program_is_judged_by_what_it_wrote(self, spec: Spec) -> None:
        outcome = await run_local_process(
            spec(["/bin/sh", "-c", "echo out; echo 'bad thing' >&2; echo >&2; exit 3"])
        )

        assert judge_outcome(outcome, "Script", 300, frozenset()) == (
            "Script exited with code 3: bad thing",
            "NonZeroExit",
        )
