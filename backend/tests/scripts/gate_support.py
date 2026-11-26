"""The gate scripts under scripts/gate/, a copy of one in a work tree, and the checks they share.

Every gate script prints one result line, `<NN> <Check name>: passed` or
`<NN> <Check name>: failed (<reason>)`, names its log under ci-output/ as `Log: <path>` at start
and end, and exits 0 when it passes, 1 when it fails and 2 on a usage or setup error. The
container checks, 04 to 09, start the wave-ci container themselves when run alone and run
directly when WAVE_IN_CI_CONTAINER=1 is set.
"""

import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

from tests.scripts.script_support import (
    CLONE,
    PODMAN_BODY,
    Call,
    Repo,
    Run,
    Stubs,
    copy_from_clone,
    file_lines,
)

GATE_DIR = "scripts/gate"
RUNNER = f"{GATE_DIR}/run.sh"
IMAGE = "wave-ci:latest"
IN_CONTAINER = "WAVE_IN_CI_CONTAINER"
BAD_OPTION = "--no-such-option"

# Number -> (script file, check name), in run order.
GATES: dict[int, tuple[str, str]] = {
    1: ("01-branch-name.sh", "Branch name"),
    2: ("02-grammar.sh", "Grammar and Comments"),
    3: ("03-orphans.sh", "Orphaned files and exclusion IDs"),
    4: ("04-backend-static.sh", "Backend static"),
    5: ("05-frontend-static.sh", "Frontend static"),
    6: ("06-e2e-types.sh", "E2E types"),
    7: ("07-frontend-build.sh", "Frontend build"),
    8: ("08-backend-tests.sh", "Backend tests"),
    9: ("09-frontend-tests.sh", "Frontend tests"),
    10: ("10-sonar-backend.sh", "SonarQube backend"),
    11: ("11-sonar-frontend.sh", "SonarQube frontend"),
    12: ("12-codeql.sh", "CodeQL"),
    13: ("13-sonar-exclusions.sh", "SonarQube exclusions"),
    14: ("14-codeql-exclusions.sh", "CodeQL exclusions"),
    15: ("15-playwright.sh", "Playwright"),
}
CONTAINER_GATES = (4, 5, 6, 7, 8, 9)

# podman that answers every `image` question with no such image.
PODMAN_WITHOUT_IMAGE = (
    """
if ARGS[:1] == ["image"] or ARGS[:1] == ["images"]:
    sys.exit(1)
"""
    + PODMAN_BODY
)


def gate_file(number: int) -> str:
    return GATES[number][0]


def gate_path(number: int) -> str:
    """The script's path relative to the clone root."""
    return f"{GATE_DIR}/{gate_file(number)}"


def check_name(number: int) -> str:
    return GATES[number][1]


def passed_line(number: int) -> str:
    return f"{number:02d} {check_name(number)}: passed"


def failed_pattern(number: int) -> str:
    return rf"{number:02d} {re.escape(check_name(number))}: failed \((?P<reason>.+)\)"


def result_lines(result: Run, number: int) -> list[str]:
    """Every line that starts as the script's result line."""
    prefix = f"{number:02d} {check_name(number)}: "
    return [line for line in result.lines if line.startswith(prefix)]


def failed_reason(result: Run, number: int) -> str:
    """The reason of the one failed result line, or an empty text when there is none."""
    for line in result_lines(result, number):
        found = re.fullmatch(failed_pattern(number), line)
        if found:
            return found.group("reason")
    return ""


def log_paths(result: Run) -> list[str]:
    """The path of every `Log: <path>` line, in order."""
    return [line.removeprefix("Log: ") for line in result.lines if line.startswith("Log: ")]


def copy_folder(repo: Repo, folder: str) -> None:
    """Copy every file of one clone folder into the work tree at the same paths."""
    source = CLONE / folder
    if not source.is_dir():
        return
    for path in sorted(source.rglob("*")):
        if path.is_file() and "__pycache__" not in path.parts:
            copy_from_clone(repo, path.relative_to(CLONE).as_posix())


def copy_gate(repo: Repo, number: int) -> str:
    """Copy one gate script and the shared scripts/lib/ folder; return the script's path."""
    copy_folder(repo, "scripts/lib")
    rel = gate_path(number)
    copy_from_clone(repo, rel)
    return rel


def copy_ignores(repo: Repo) -> None:
    """Copy the clone's .gitignore files, so ci-output/ and coverage reports stay untracked."""
    for rel in (".gitignore", "backend/.gitignore", "frontend/.gitignore"):
        copy_from_clone(repo, rel)


def container_runs(stubs: Stubs) -> list[Call]:
    return [c for c in stubs.calls("podman") if c.args[:1] == ["run"]]


def first_index(calls: list[Call], tool: str) -> int:
    """The index of a tool's first call, or the length of the list when it was never called."""
    return next((i for i, c in enumerate(calls) if c.tool == tool), len(calls))


@dataclass
class GateRun:
    """One run of a gate script and what it ran in."""

    result: Run
    repo: Repo
    stubs: Stubs


def with_origin(repo: Repo, tmp_path: Path, branches: dict[str, str]) -> None:
    """Give the work tree an origin: a bare repository in tmp_path holding the given branches."""
    bare = tmp_path / "origin.git"
    subprocess.run(
        ["git", "init", "-q", "--bare", str(bare)], check=True, capture_output=True, text=True
    )
    repo.git("remote", "add", "origin", str(bare))
    for name, sha in branches.items():
        repo.git("push", "-q", "origin", f"{sha}:refs/heads/{name}")
    repo.git("fetch", "-q", "origin")


class GateContract:
    """The result line, the log line and the exit codes every gate script shares.

    A test module subclasses it as a Test class, sets NUMBER and gives three fixtures: passing,
    failing and usage_error, each a GateRun.
    """

    NUMBER = 0

    def test_a_pass_exits_0(self, passing: GateRun) -> None:
        assert passing.result.code == 0, passing.result.lines

    def test_a_pass_prints_one_passed_line(self, passing: GateRun) -> None:
        lines = result_lines(passing.result, self.NUMBER)

        assert lines == [passed_line(self.NUMBER)], passing.result.lines

    def test_a_failure_exits_1(self, failing: GateRun) -> None:
        assert failing.result.code == 1, failing.result.lines

    def test_a_failure_prints_one_failed_line_with_its_reason(self, failing: GateRun) -> None:
        lines = result_lines(failing.result, self.NUMBER)

        assert len(lines) == 1, failing.result.lines
        assert re.fullmatch(failed_pattern(self.NUMBER), lines[0]), lines

    def test_a_usage_error_exits_2(self, usage_error: GateRun) -> None:
        assert usage_error.result.code == 2, usage_error.result.lines

    def test_the_log_is_named_at_start_and_end(self, passing: GateRun) -> None:
        lines = passing.result.lines
        paths = log_paths(passing.result)

        assert len(paths) >= 2, lines
        assert len(set(paths)) == 1, paths
        assert lines.index(f"Log: {paths[0]}") < 3, lines
        assert len(lines) - 1 - lines[::-1].index(f"Log: {paths[0]}") >= len(lines) - 3, lines

    def test_the_log_is_a_file_under_ci_output(self, passing: GateRun) -> None:
        paths = log_paths(passing.result)
        assert paths, passing.result.lines
        log = Path(paths[0])

        assert log.is_relative_to(passing.repo.root / "ci-output"), log
        assert log.is_file(), log
        assert passed_line(self.NUMBER) in file_lines(log)


class ContainerContract:
    """Where a container check (04 to 09) runs: its own wave-ci container, or directly.

    A test module subclasses it as a Test class and gives the fixtures passing (run alone),
    inside (run with WAVE_IN_CI_CONTAINER=1) and no_image (run alone with no CI image).
    """

    NUMBER = 0

    def test_run_alone_it_starts_one_wave_ci_container(self, passing: GateRun) -> None:
        runs = container_runs(passing.stubs)

        assert len(runs) == 1, passing.stubs.calls("podman")
        assert IMAGE in runs[0].args

    def test_inside_the_container_it_starts_none(self, inside: GateRun) -> None:
        assert inside.result.code == 0, inside.result.lines
        assert container_runs(inside.stubs) == []

    def test_inside_the_container_it_prints_its_result_line(self, inside: GateRun) -> None:
        lines = result_lines(inside.result, self.NUMBER)

        assert lines == [passed_line(self.NUMBER)], inside.result.lines

    def test_no_ci_image_is_a_setup_error(self, no_image: GateRun) -> None:
        assert no_image.result.code == 2, no_image.result.lines
        assert container_runs(no_image.stubs) == []


def node_calls(stubs: Stubs) -> list[Call]:
    return stubs.calls("npm") + stubs.calls("npx")


def node_key(call: Call, repo: Repo) -> str | None:
    """The check an npm or npx call stands for, as the stub reads it."""
    e2e = Path(call.cwd) == repo.root / "tests" / "e2e" or "tests/e2e" in call.line
    if "lint" in call.args or "eslint" in call.line:
        return "eslint"
    if "type-check" in call.args or "tsc" in call.args:
        return "e2e-typescript" if e2e else "typescript"
    if "build" in call.args:
        return "build"
    if "test:coverage" in call.args or "vitest" in call.line:
        return "vitest"
    return None


def node_check(stubs: Stubs, repo: Repo, key: str) -> list[Call]:
    """The npm and npx calls that stand for one check."""
    return [c for c in node_calls(stubs) if node_key(c, repo) == key]
