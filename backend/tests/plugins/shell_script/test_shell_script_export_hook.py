"""The POSIX exit hook that reads a script's variable exports (REQ-3.4.1.1).

SHRUN-7: one piece of POSIX shell code, the same text under every shell. It probes
each declared variable instead of asking which shell is running, so a shell with
arrays hands back the elements and a shell without them hands back text. A script
that takes over the EXIT trap or hands its process on leaves the hook unrun, and
WAVE reads no exports. A TERM, the way a pattern stop ends the script, runs the
same capture on the way out.
"""

import inspect
import os
import re
import signal
import subprocess
import tempfile
import time
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

import pytest

from wavecore.plugins._shell_capture import Captured, build_preamble, hook_ran, parse_capture

BASH = "/bin/bash"
SH = "/bin/sh"
SHELLS = [BASH, SH]

DOT_SOURCE = '. "$0"'


@dataclass(frozen=True)
class Run:
    """One script run under the generated hook."""

    exit_code: int
    stdout: str
    stderr: str
    exports: dict[str, Captured]


def run_hook(
    shell: str,
    script: str,
    names: Sequence[str],
    tmp_path: Path,
    args: Sequence[str] = (),
) -> Run:
    """Run a script the way the plugin does and read back what the hook captured."""
    work = Path(tempfile.mkdtemp(dir=tmp_path))
    script_path = work / "script.sh"
    script_path.write_text(script, encoding="utf-8")
    capture_path = work / "capture"
    hook = build_preamble(list(names), str(capture_path))
    completed = subprocess.run(
        [shell, "-c", hook, str(script_path), *args],
        capture_output=True,
        text=True,
        timeout=10,
    )
    data = capture_path.read_bytes() if capture_path.exists() else b""
    return Run(
        exit_code=completed.returncode,
        stdout=completed.stdout,
        stderr=completed.stderr,
        exports=parse_capture(data),
    )


def terminate_hook(shell: str, script: str, names: Sequence[str], tmp_path: Path) -> Run:
    """Run a script under the hook in its own group, TERM the group once it is ready."""
    work = Path(tempfile.mkdtemp(dir=tmp_path))
    script_path = work / "script.sh"
    script_path.write_text(script, encoding="utf-8")
    capture_path = work / "capture"
    ready = work / "ready"
    hook = build_preamble(list(names), str(capture_path))
    child = subprocess.Popen(
        [shell, "-c", hook, str(script_path), str(ready)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    try:
        deadline = time.monotonic() + 2.0
        while not ready.exists() and time.monotonic() < deadline:
            time.sleep(0.002)
        os.killpg(child.pid, signal.SIGTERM)
        exit_code = child.wait(timeout=5)
    finally:
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait(timeout=5)
    data = capture_path.read_bytes() if capture_path.exists() else b""
    assert hook_ran(data), data
    return Run(exit_code=exit_code, stdout="", stderr="", exports=parse_capture(data))


class TestHookShape:
    """What the generated text is made of."""

    def test_the_text_ends_by_running_the_script(self) -> None:
        assert build_preamble(["COUNT"], "/srv/wave/capture").rstrip().endswith(DOT_SOURCE)

    def test_the_text_carries_the_capture_path_and_the_names(self) -> None:
        text = build_preamble(["COUNT", "STATUS"], "/srv/wave/capture")

        assert "/srv/wave/capture" in text
        assert "COUNT" in text
        assert "STATUS" in text

    def test_the_text_installs_an_exit_handler(self) -> None:
        text = build_preamble(["COUNT"], "/srv/wave/capture")

        assert "trap" in text
        assert "EXIT" in text

    def test_the_text_installs_a_term_handler(self) -> None:
        text = build_preamble(["COUNT"], "/srv/wave/capture")

        assert re.search(r"trap\s+\S+\s+TERM", text)

    def test_no_exports_gives_only_the_dot_source_line(self) -> None:
        assert build_preamble([], "/srv/wave/capture").strip() == DOT_SOURCE

    def test_a_capture_path_holding_a_quote_survives(self, tmp_path: Path) -> None:
        odd = tmp_path / "o'brien"
        odd.mkdir()

        run = run_hook(BASH, "COUNT=3\n", ["COUNT"], odd)

        assert run.exports["COUNT"].scalar == "3"


@pytest.mark.parametrize("shell", SHELLS)
class TestPositionalArguments:
    """The script keeps its positional parameters through the hook (SHRUN-4)."""

    def test_rows_arrive_in_order_with_empty_and_spaced_values(
        self, shell: str, tmp_path: Path
    ) -> None:
        script = """printf '[%s]' "$@"
printf ' n=%s\\n' "$#"
"""

        run = run_hook(shell, script, ["COUNT"], tmp_path, args=["--env", "", "x y"])

        assert run.stdout == "[--env][][x y] n=3\n"
        assert run.exit_code == 0

    def test_the_script_path_is_dollar_zero(self, shell: str, tmp_path: Path) -> None:
        run = run_hook(shell, 'printf "%s\\n" "$0"\n', ["COUNT"], tmp_path)

        assert run.stdout.strip().endswith("script.sh")


@pytest.mark.parametrize("shell", SHELLS)
class TestNormalEndCaptures:
    """A script that ends on its own has its exports read (SHRUN-7)."""

    def test_scalars_including_a_newline(self, shell: str, tmp_path: Path) -> None:
        script = """COUNT=3
STATUS='two words
newline'
"""

        run = run_hook(shell, script, ["COUNT", "STATUS"], tmp_path)

        assert run.exit_code == 0
        assert run.exports["COUNT"].kind == "s"
        assert run.exports["COUNT"].scalar == "3"
        assert run.exports["STATUS"].scalar == "two words\nnewline"

    def test_an_empty_scalar_is_not_a_never_set_name(self, shell: str, tmp_path: Path) -> None:
        run = run_hook(shell, "EMPTY=''\n", ["EMPTY", "MISSING"], tmp_path)

        assert run.exports["EMPTY"].kind == "s"
        assert run.exports["EMPTY"].scalar == ""
        assert run.exports["MISSING"].kind == "u"

    def test_set_e_stops_at_the_failure_and_keeps_the_value(
        self, shell: str, tmp_path: Path
    ) -> None:
        script = """set -e
COUNT=42
false
COUNT=99
"""

        run = run_hook(shell, script, ["COUNT"], tmp_path)

        assert run.exit_code == 1
        assert run.exports["COUNT"].scalar == "42"

    def test_an_explicit_exit_keeps_its_code(self, shell: str, tmp_path: Path) -> None:
        run = run_hook(shell, "COUNT=7\nexit 7\n", ["COUNT"], tmp_path)

        assert run.exit_code == 7
        assert run.exports["COUNT"].scalar == "7"

    def test_set_u_does_not_break_the_probe(self, shell: str, tmp_path: Path) -> None:
        script = """set -u
SET=yes
"""

        run = run_hook(shell, script, ["SET", "MISSING"], tmp_path)

        assert run.exit_code == 0
        assert run.exports["SET"].scalar == "yes"
        assert run.exports["MISSING"].kind == "u"


class TestBashArrays:
    """A shell with arrays hands back the elements and the pairs."""

    def test_an_indexed_array_round_trips(self, tmp_path: Path) -> None:
        script = """ARR=("a b" "" "multi
line")
"""

        run = run_hook(BASH, script, ["ARR"], tmp_path)

        assert run.exports["ARR"].kind == "a"
        assert run.exports["ARR"].items == ["a b", "", "multi\nline"]

    def test_an_empty_array(self, tmp_path: Path) -> None:
        run = run_hook(BASH, "ARR=()\n", ["ARR"], tmp_path)

        assert run.exports["ARR"].kind == "a"
        assert run.exports["ARR"].items == []

    def test_an_associative_array_becomes_a_map(self, tmp_path: Path) -> None:
        run = run_hook(BASH, 'declare -A M=([k1]=v1 [k2]="v 2")\n', ["M"], tmp_path)

        assert run.exports["M"].kind == "A"
        assert run.exports["M"].pairs == {"k1": "v1", "k2": "v 2"}


class TestShellWithoutArrays:
    """A shell with no arrays answers the text probe instead (SHRUN-7)."""

    def test_a_scalar_answers_the_text_probe(self, tmp_path: Path) -> None:
        run = run_hook(SH, "COUNT=3\n", ["COUNT"], tmp_path)

        assert run.exit_code == 0
        assert run.exports["COUNT"].kind == "s"
        assert run.exports["COUNT"].scalar == "3"

    def test_json_text_arrives_as_a_scalar(self, tmp_path: Path) -> None:
        script = """ARR='["x","y"]'
M='{"k":"v"}'
"""

        run = run_hook(SH, script, ["ARR", "M"], tmp_path)

        assert run.exports["ARR"].kind == "s"
        assert run.exports["ARR"].scalar == '["x","y"]'
        assert run.exports["M"].kind == "s"
        assert run.exports["M"].scalar == '{"k":"v"}'

    def test_the_failed_array_probe_writes_nothing_to_stderr(self, tmp_path: Path) -> None:
        run = run_hook(SH, "COUNT=3\n", ["COUNT", "MISSING"], tmp_path)

        assert run.stderr == ""
        assert run.exit_code == 0


@pytest.mark.parametrize("shell", SHELLS)
class TestHookLeftUnrun:
    """A script that takes the handler over, or never reaches it, leaves no exports."""

    def test_a_script_exit_trap_takes_over(self, shell: str, tmp_path: Path) -> None:
        script = """trap 'STATUS=from-trap; echo "handler-ran $STATUS"' EXIT
COUNT=1
exit 4
"""

        run = run_hook(shell, script, ["COUNT", "STATUS"], tmp_path)

        assert run.exit_code == 4
        assert run.stdout == "handler-ran from-trap\n"
        assert run.exports == {}

    def test_a_trap_that_exits_with_its_own_code(self, shell: str, tmp_path: Path) -> None:
        script = """trap 'exit 9' EXIT
COUNT=1
"""

        run = run_hook(shell, script, ["COUNT"], tmp_path)

        assert run.exit_code == 9
        assert run.exports == {}

    def test_set_e_with_a_trap_that_runs_past_a_failed_command(
        self, shell: str, tmp_path: Path
    ) -> None:
        script = """set -e
trap 'echo cleanup' EXIT
COUNT=1
false
echo never
"""

        run = run_hook(shell, script, ["COUNT"], tmp_path)

        assert run.exit_code == 1
        assert run.stdout == "cleanup\n"
        assert run.exports == {}

    def test_removing_the_handler_leaves_no_exports(self, shell: str, tmp_path: Path) -> None:
        script = """COUNT=1
trap - EXIT
exit 0
"""

        run = run_hook(shell, script, ["COUNT"], tmp_path)

        assert run.exit_code == 0
        assert run.exports == {}

    def test_handing_the_process_on_leaves_no_exports(self, shell: str, tmp_path: Path) -> None:
        script = """SET_TWO=2
exec /bin/true
"""

        run = run_hook(shell, script, ["SET_TWO"], tmp_path)

        assert run.exit_code == 0
        assert run.exports == {}

    def test_a_killed_script_leaves_no_exports(self, shell: str, tmp_path: Path) -> None:
        script = """COUNT=1
kill -9 $$
"""

        run = run_hook(shell, script, ["COUNT"], tmp_path)

        assert run.exit_code == -9
        assert run.exports == {}


@pytest.mark.parametrize("shell", SHELLS)
class TestTermRunsTheCapture:
    """A TERM, the pattern-stop signal, captures the exports and exits 143."""

    def test_a_terminated_script_leaves_a_complete_capture(
        self, shell: str, tmp_path: Path
    ) -> None:
        script = """COUNT=1
STATUS=running
: > "$1"
sleep 30
"""

        run = terminate_hook(shell, script, ["COUNT", "STATUS"], tmp_path)

        assert run.exit_code == 143
        assert run.exports["COUNT"].scalar == "1"
        assert run.exports["STATUS"].scalar == "running"

    def test_a_script_waiting_on_a_background_job_is_captured_too(
        self, shell: str, tmp_path: Path
    ) -> None:
        script = """COUNT=2
sleep 30 &
: > "$1"
wait
"""

        run = terminate_hook(shell, script, ["COUNT"], tmp_path)

        assert run.exit_code == 143
        assert run.exports["COUNT"].scalar == "2"


@pytest.mark.parametrize("shell", SHELLS)
class TestSubshellTrap:
    """A trap inside a subshell does not write the exports."""

    def test_only_the_values_the_script_itself_holds_are_captured(
        self, shell: str, tmp_path: Path
    ) -> None:
        script = """( trap 'echo sub-trap' EXIT; INNER=1 )
OUTER=out
"""

        run = run_hook(shell, script, ["INNER", "OUTER"], tmp_path)

        assert run.stdout == "sub-trap\n"
        assert set(run.exports) == {"INNER", "OUTER"}
        assert run.exports["INNER"].kind == "u"
        assert run.exports["OUTER"].scalar == "out"


@pytest.mark.parametrize("shell", SHELLS)
class TestScriptTrapsStillReported:
    """The script's own traps are still reported to it after WAVE installs the hook."""

    def test_the_script_sees_the_trap_it_set(self, shell: str, tmp_path: Path) -> None:
        script = """trap 'echo caught' USR1
trap
COUNT=1
"""

        run = run_hook(shell, script, ["COUNT"], tmp_path)

        assert "USR1" in run.stdout
        assert run.exports["COUNT"].scalar == "1"


class TestProbesTheVariableNotTheShell:
    """The hook asks the variable, never which shell is running (SHRUN-7)."""

    def test_the_text_does_not_depend_on_the_shell(self) -> None:
        assert "shell" not in inspect.signature(build_preamble).parameters

    def test_the_text_names_no_shell_and_asks_for_no_version(self) -> None:
        text = build_preamble(["COUNT", "ARR"], "/srv/wave/capture").casefold()

        for token in ("bash", "dash", "zsh", "ksh", "version", "$shell"):
            assert token not in text

    def test_one_text_captures_under_every_shell(self, tmp_path: Path) -> None:
        for shell in SHELLS:
            run = run_hook(shell, "COUNT=3\n", ["COUNT"], tmp_path)

            assert run.exports["COUNT"].scalar == "3"


@pytest.mark.parametrize("shell", SHELLS)
class TestNoHookWithoutExports:
    """A block that declares no exports gets no handler at all."""

    def test_the_script_runs_and_nothing_is_captured(self, shell: str, tmp_path: Path) -> None:
        run = run_hook(shell, "COUNT=1\necho ran\n", [], tmp_path)

        assert run.exit_code == 0
        assert run.stdout == "ran\n"
        assert run.exports == {}

    def test_no_hook_variable_reaches_a_child(self, shell: str, tmp_path: Path) -> None:
        script = """echo "child=$(env | grep -c '^__wave' || true)"
"""

        run = run_hook(shell, script, ["COUNT"], tmp_path)

        assert run.stdout == "child=0\n"


HOOK_NAMES = ["COUNT", "ARR", "M"]
HOOK_PATH = "/var/lib/wave/process-dirs/shell-script-a1b2/capture"


def hook_text() -> str:
    return build_preamble(HOOK_NAMES, HOOK_PATH)


def live_code(text: str) -> str:
    """The hook text as a shell parses it: an escaped dollar and a single-quoted span are data."""
    return re.sub(r"'[^']*'", " ", text.replace("\\$", ""))


class TestExportHookIsPosix:
    """The generated hook holds no construct outside POSIX shell (SHRUN-7).

    Two things pass. Array syntax may appear as data for the guarded probe - inside
    single quotes or behind an escaped dollar - because the probe asks the variable,
    not the shell. A case pattern may match a shell's own output text.
    """

    def test_no_double_bracket_test(self) -> None:
        assert "[[" not in live_code(hook_text())

    def test_no_array_assignment(self) -> None:
        assert "=(" not in hook_text()

    def test_no_array_expansion_in_code_the_shell_parses(self) -> None:
        assert re.findall(r"\$\{[^}]*\[[@*]\]", live_code(hook_text())) == []

    def test_no_declare_local_or_typeset(self) -> None:
        assert re.findall(r"\b(?:declare|local|typeset)\b", hook_text()) == []

    def test_no_case_conversion_or_transform_expansions(self) -> None:
        assert re.findall(r"\$\{[^}]*(?:\^\^|,,|@[A-Za-z])", live_code(hook_text())) == []

    def test_no_mapfile_readarray_or_coproc(self) -> None:
        assert re.findall(r"\b(?:mapfile|readarray|coproc)\b", hook_text()) == []

    def test_no_bash_only_operators(self) -> None:
        assert re.findall(r"\|&|&>>?|;;&|(?<![;&]);&", live_code(hook_text())) == []

    def test_no_bash_only_variables(self) -> None:
        pattern = r"\$\{?(?:BASHPID|BASH_[A-Z]+|BASH\b|RANDOM\b)"

        assert re.findall(pattern, live_code(hook_text())) == []

    def test_no_ansi_c_quoting(self) -> None:
        assert "$'" not in hook_text().replace("\\$", "")

    def test_no_wait_n_or_named_descriptor_redirection(self) -> None:
        code = live_code(hook_text())

        assert re.findall(r"\bwait\s+-n\b", code) == []
        assert re.findall(r"(?<!\$)\{[A-Za-z_][A-Za-z0-9_]*\}>", code) == []

    def test_no_function_keyword_source_echo_e_let_or_arithmetic_command(self) -> None:
        code = live_code(hook_text())

        assert re.findall(r"\bfunction\s+[A-Za-z_]", code) == []
        assert re.findall(r"(?:^|[\s;&|(])source\s", code) == []
        assert re.findall(r"\becho\s+-e\b", code) == []
        assert re.findall(r"(?:^|[\s;&|(])let\s", code) == []
        assert re.findall(r"(?<!\$)\(\(", code) == []
