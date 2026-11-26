"""Tests for scripts/gate/run.sh with every gate script a stub: areas, order, container, table."""

import stat
import sys
from pathlib import Path

import pytest

from tests.scripts.gate_support import (
    CONTAINER_GATES,
    GATES,
    IMAGE,
    IN_CONTAINER,
    RUNNER,
    check_name,
    container_runs,
    copy_folder,
    copy_ignores,
    gate_file,
    gate_path,
    with_origin,
)
from tests.scripts.script_support import (
    Repo,
    Run,
    Stubs,
    copy_from_clone,
    refuse_shared_temp,
    run,
    stub_env,
)

RELEASE = "release/1.0.0-alpha1"
BRANCH = "fix/1.0.0-alpha1-change"
TABLE_HEADER = "| # | Gate check | Script | Result | Numbers |"
SKIPPED = "skipped: not needed"

# A gate script: prints its result line and fails when STUB_FAIL names its number.
GATE_BODY = """
number = {number!r}
name = {name!r}
failed = f"{{number:02d}}" in FAIL
print(f"{{number:02d}} {{name}}: " + ("failed (stub)" if failed else "passed"), flush=True)
sys.exit(1 if failed else 0)
"""

# The files of the base commit, one per area, so a change to each can be made.
BASE_FILES = {
    "README.md": "# Test tree",
    "backend/wavecore/app.py": "VALUE = 1",
    "backend/tests/test_app.py": "def test_app() -> None: ...",
    "frontend/src/app.ts": "export const value = 1",
    "frontend/tests/app.test.ts": "export {}",
    "tests/e2e/functional/a/a.spec.ts": "export {}",
    "tests/exclusions/codeql.md": "# CodeQL",
    "scripts/lib/tool.sh": "echo tool",
    "scripts/lib/tool.py": "print('tool')",
    ".github/workflows/ci.yml": "name: CI",
    ".github/scripts/docs-check.cjs": "module.exports = 1",
}
PICTURE = "docs/picture.png"


def write_gate_stubs(repo: Repo, stubs: Stubs) -> None:
    """A stub for each gate script: a shell wrapper in the tree that runs a recording stub."""
    for number in GATES:
        body = GATE_BODY.format(number=number, name=check_name(number))
        stub = stubs.file(stubs.bin.parent / "gates" / f"{number:02d}.py", gate_path(number), body)
        wrapper = repo.root / gate_path(number)
        wrapper.parent.mkdir(parents=True, exist_ok=True)
        wrapper.write_text(
            f'#!/bin/bash\nexec "{sys.executable}" "{stub}" "$@"\n', encoding="utf-8"
        )
        wrapper.chmod(wrapper.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


@pytest.fixture
def stubs(tmp_path: Path) -> Stubs:
    tools = Stubs(tmp_path / "stubs")
    tools.podman()
    return tools


@pytest.fixture
def repo(tmp_path: Path, stubs: Stubs) -> Repo:
    tree = Repo(tmp_path / "repo")
    copy_ignores(tree)
    copy_folder(tree, "scripts/lib")
    copy_from_clone(tree, RUNNER)
    for rel, text in BASE_FILES.items():
        tree.write(rel, [text])
    (tree.root / "docs").mkdir()
    (tree.root / PICTURE).write_bytes(b"\x89PNG\r\n\x1a\n\x00\x00\x00\x00")
    write_gate_stubs(tree, stubs)
    base = tree.commit()
    with_origin(tree, tmp_path, {"master": base, RELEASE: base})
    tree.checkout(BRANCH)
    return tree


def gate(repo: Repo, stubs: Stubs, tmp_path: Path, *args: str, **extra: str) -> Run:
    refuse_shared_temp(repo, RUNNER)
    env = stub_env(tmp_path, stubs, **extra)
    return run(repo, [str(repo.root / RUNNER), *args], env, timeout=60)


def commit_change(repo: Repo, *rels: str) -> None:
    for rel in rels:
        if rel == PICTURE:
            (repo.root / rel).write_bytes(b"\x89PNG\r\n\x1a\n\x00\x00\x00\x01")
        else:
            repo.write(rel, ["// changed"])
    repo.commit()


def called(stubs: Stubs) -> list[int]:
    """The numbers of the gate scripts that ran, in the order they ran."""
    by_path = {gate_path(n): n for n in GATES}
    return [by_path[c.tool] for c in stubs.calls() if c.tool in by_path]


def calls_of(stubs: Stubs, number: int) -> list[list[str]]:
    return [c.args for c in stubs.calls(gate_path(number))]


def table_rows(result: Run) -> dict[int, list[str]]:
    """The proof table's rows by number: gate check, script, result and numbers."""
    rows = {}
    for line in result.lines:
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if line.startswith("|") and len(cells) == 5 and cells[0].isdigit():
            rows[int(cells[0])] = cells[1:]
    return rows


BACKEND = {1, 2, 3, 4, 8, 10, 12, 13, 14}
FRONTEND = {1, 2, 3, 5, 7, 9, 11, 12, 13, 14}


class TestAreasFromChangedFiles:
    """With no area given, the changed files pick the scripts, each by its own rule."""

    @pytest.mark.parametrize(
        ("rel", "numbers"),
        [
            ("README.md", {1, 2}),
            (PICTURE, {1}),
            ("backend/wavecore/app.py", BACKEND),
            ("backend/tests/test_app.py", BACKEND - {3}),
            ("frontend/src/app.ts", FRONTEND),
            ("frontend/tests/app.test.ts", FRONTEND - {3}),
            ("tests/e2e/functional/a/a.spec.ts", {1, 2, 6, 12, 14}),
            ("tests/exclusions/codeql.md", {1, 2, 3}),
            ("scripts/lib/tool.sh", {1, 2, 8}),
            ("scripts/lib/tool.py", {1, 2, 8, 12, 14}),
            (".github/workflows/ci.yml", {1, 2, 12, 14}),
            (".github/scripts/docs-check.cjs", {1, 2, 12, 14}),
        ],
        ids=[
            "readme",
            "binary-file",
            "backend-code",
            "backend-tests",
            "frontend-code",
            "frontend-tests",
            "e2e",
            "exclusion-list",
            "shell-script",
            "python-script",
            "workflow",
            "workflow-script",
        ],
    )
    def test_a_committed_change_runs_its_scripts(
        self, repo: Repo, stubs: Stubs, tmp_path: Path, rel: str, numbers: set[int]
    ) -> None:
        commit_change(repo, rel)

        result = gate(repo, stubs, tmp_path)

        assert result.code == 0, result.lines
        assert set(called(stubs)) == numbers

    def test_an_uncommitted_change_counts(self, repo: Repo, stubs: Stubs, tmp_path: Path) -> None:
        repo.write("backend/wavecore/app.py", ["VALUE = 2"])

        gate(repo, stubs, tmp_path)

        assert 4 in called(stubs)

    def test_an_untracked_file_counts(self, repo: Repo, stubs: Stubs, tmp_path: Path) -> None:
        repo.write("tests/e2e/functional/b/b.spec.ts", ["export {}"])

        gate(repo, stubs, tmp_path)

        assert 6 in called(stubs)

    def test_no_change_runs_only_the_branch_name_check(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        result = gate(repo, stubs, tmp_path)

        assert result.code == 0, result.lines
        assert called(stubs) == [1]


class TestTheBase:
    """A fix branch compares with its release branch; any other branch with master."""

    @pytest.fixture
    def moved_release(self, repo: Repo, tmp_path: Path) -> str:
        """origin/master stays at the base; the release branch on origin adds a frontend change."""
        master = repo.git("rev-parse", "HEAD")
        repo.git("checkout", "-q", "-b", "release-work")
        commit_change(repo, "frontend/src/app.ts")
        release = repo.git("rev-parse", "HEAD")
        repo.git("push", "-q", "-f", "origin", f"{release}:refs/heads/{RELEASE}")
        repo.git("push", "-q", "-f", "origin", f"{master}:refs/heads/master")
        repo.git("fetch", "-q", "origin")
        return release

    def test_a_fix_branch_leaves_out_what_its_release_already_has(
        self, repo: Repo, stubs: Stubs, tmp_path: Path, moved_release: str
    ) -> None:
        repo.git("checkout", "-q", "-B", BRANCH, moved_release)
        commit_change(repo, "backend/wavecore/app.py")

        gate(repo, stubs, tmp_path)

        assert 5 not in called(stubs)

    def test_a_release_branch_compares_with_master(
        self, repo: Repo, stubs: Stubs, tmp_path: Path, moved_release: str
    ) -> None:
        repo.git("checkout", "-q", "-B", RELEASE, moved_release)
        commit_change(repo, "backend/wavecore/app.py")

        gate(repo, stubs, tmp_path)

        assert 5 in called(stubs)


class TestAreasGiven:
    """Named areas pick the scripts in place of the changed files."""

    @pytest.mark.parametrize(
        ("area", "runs", "skips"),
        [
            ("backend", {4, 8, 10}, {5, 6, 7, 9, 11}),
            ("frontend", {5, 7, 9, 11}, {4, 6, 8, 10}),
            ("e2e", {6}, {4, 5, 7, 8, 9, 10, 11}),
            ("scripts", {8}, {4, 5, 6, 7, 9, 10, 11}),
        ],
    )
    def test_an_area_runs_its_scripts(
        self,
        repo: Repo,
        stubs: Stubs,
        tmp_path: Path,
        area: str,
        runs: set[int],
        skips: set[int],
    ) -> None:
        result = gate(repo, stubs, tmp_path, area)

        assert result.code == 0, result.lines
        assert runs <= set(called(stubs))
        assert not skips & set(called(stubs))

    def test_two_areas_run_the_scripts_of_both(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        gate(repo, stubs, tmp_path, "backend", "e2e")

        assert {4, 6, 8, 10} <= set(called(stubs))

    def test_a_named_area_replaces_the_changed_files(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        commit_change(repo, "frontend/src/app.ts")

        gate(repo, stubs, tmp_path, "backend")

        assert 5 not in called(stubs)

    def test_the_branch_name_check_always_runs(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        gate(repo, stubs, tmp_path, "e2e")

        assert 1 in called(stubs)

    def test_an_unknown_area_is_a_usage_error(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        result = gate(repo, stubs, tmp_path, "nowhere")

        assert result.code == 2, result.lines
        assert called(stubs) == []


class TestOrderAndStop:
    """The scripts run in number order and the run stops at the first failure."""

    def test_the_scripts_run_in_number_order(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        commit_change(repo, "backend/wavecore/app.py", "frontend/src/app.ts")

        gate(repo, stubs, tmp_path)

        assert called(stubs) == sorted(called(stubs))

    def test_each_script_runs_once(self, repo: Repo, stubs: Stubs, tmp_path: Path) -> None:
        commit_change(repo, "backend/wavecore/app.py", "frontend/src/app.ts")

        gate(repo, stubs, tmp_path)

        assert len(called(stubs)) == len(set(called(stubs)))

    @pytest.mark.parametrize(
        ("fail", "ran"),
        [
            (2, [1, 2]),
            (4, [1, 2, 3, 4]),
            (8, [1, 2, 3, 4, 8]),
            (10, [1, 2, 3, 4, 8, 10]),
            (12, [1, 2, 3, 4, 8, 10, 12]),
        ],
    )
    def test_the_run_stops_at_the_first_failure(
        self, repo: Repo, stubs: Stubs, tmp_path: Path, fail: int, ran: list[int]
    ) -> None:
        commit_change(repo, "backend/wavecore/app.py")

        result = gate(repo, stubs, tmp_path, STUB_FAIL=f"{fail:02d}")

        assert result.code == 1, result.lines
        assert called(stubs) == ran

    def test_a_failure_before_the_container_starts_none(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        commit_change(repo, "backend/wavecore/app.py")

        gate(repo, stubs, tmp_path, STUB_FAIL="03")

        assert container_runs(stubs) == []


class TestOneContainer:
    """The container checks, 04 to 09, all run inside one wave-ci container."""

    def test_one_container_runs_every_container_check(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        commit_change(repo, "backend/wavecore/app.py", "frontend/src/app.ts", "tests/e2e/x.ts")

        gate(repo, stubs, tmp_path)
        runs = container_runs(stubs)

        assert len(runs) == 1, stubs.calls("podman")
        assert IMAGE in runs[0].args

    @pytest.mark.parametrize("number", CONTAINER_GATES)
    def test_a_container_check_runs_inside(
        self, repo: Repo, stubs: Stubs, tmp_path: Path, number: int
    ) -> None:
        commit_change(repo, "backend/wavecore/app.py", "frontend/src/app.ts", "tests/e2e/x.ts")

        gate(repo, stubs, tmp_path)
        (call,) = stubs.calls(gate_path(number))

        assert call.env.get(IN_CONTAINER) == "1", call.env

    @pytest.mark.parametrize("number", [1, 2, 3, 10, 11, 12, 13, 14])
    def test_a_host_check_runs_on_the_host(
        self, repo: Repo, stubs: Stubs, tmp_path: Path, number: int
    ) -> None:
        commit_change(repo, "backend/wavecore/app.py", "frontend/src/app.ts")

        gate(repo, stubs, tmp_path)
        (call,) = stubs.calls(gate_path(number))

        assert call.env.get(IN_CONTAINER) != "1", call.env

    def test_no_container_check_needed_starts_no_container(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        commit_change(repo, "README.md")

        gate(repo, stubs, tmp_path)

        assert container_runs(stubs) == []

    def test_a_container_check_failing_stops_the_ones_after_it(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        commit_change(repo, "backend/wavecore/app.py", "frontend/src/app.ts")

        result = gate(repo, stubs, tmp_path, STUB_FAIL="05")

        assert result.code == 1, result.lines
        assert called(stubs) == [1, 2, 3, 4, 5]


class TestPlaywright:
    """Playwright runs only when asked for, last, with a spec list or the full suite."""

    def test_without_the_option_playwright_does_not_run(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        commit_change(repo, "tests/e2e/functional/a/a.spec.ts")

        gate(repo, stubs, tmp_path)

        assert calls_of(stubs, 15) == []

    def test_full_runs_the_full_suite(self, repo: Repo, stubs: Stubs, tmp_path: Path) -> None:
        result = gate(repo, stubs, tmp_path, "--playwright", "full")

        assert result.code == 0, result.lines
        assert calls_of(stubs, 15) == [["full"]]

    def test_a_spec_list_is_passed_on(self, repo: Repo, stubs: Stubs, tmp_path: Path) -> None:
        specs = ["functional/a/a.spec.ts", "visual/dashboard/v-dash-01.spec.ts"]

        gate(repo, stubs, tmp_path, "--playwright", *specs)

        assert calls_of(stubs, 15) == [specs]

    def test_playwright_runs_last(self, repo: Repo, stubs: Stubs, tmp_path: Path) -> None:
        commit_change(repo, "backend/wavecore/app.py")

        gate(repo, stubs, tmp_path, "--playwright", "full")

        assert called(stubs)[-1] == 15

    def test_playwright_waits_for_every_earlier_script(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        commit_change(repo, "backend/wavecore/app.py")

        gate(repo, stubs, tmp_path, "--playwright", "full", STUB_FAIL="13")

        assert calls_of(stubs, 15) == []

    def test_playwright_runs_with_an_area(self, repo: Repo, stubs: Stubs, tmp_path: Path) -> None:
        gate(repo, stubs, tmp_path, "e2e", "--playwright", "full")

        assert calls_of(stubs, 15) == [["full"]]


class TestProofTable:
    """The run ends with the proof table of the scripts it covered."""

    def test_the_table_has_its_header(self, repo: Repo, stubs: Stubs, tmp_path: Path) -> None:
        commit_change(repo, "backend/wavecore/app.py")

        result = gate(repo, stubs, tmp_path)

        assert TABLE_HEADER in result.lines

    def test_the_table_comes_after_every_result_line(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        commit_change(repo, "backend/wavecore/app.py")

        result = gate(repo, stubs, tmp_path)
        last_result = max(
            (i for i, line in enumerate(result.lines) if line.startswith("14 ")), default=-1
        )

        assert result.lines.index(TABLE_HEADER) > last_result

    @pytest.mark.parametrize("number", sorted(BACKEND))
    def test_a_script_that_ran_reads_passed(
        self, repo: Repo, stubs: Stubs, tmp_path: Path, number: int
    ) -> None:
        commit_change(repo, "backend/wavecore/app.py")

        result = gate(repo, stubs, tmp_path)
        rows = table_rows(result)

        assert rows.get(number, [])[:3] == [check_name(number), gate_file(number), "passed"]

    @pytest.mark.parametrize("number", [5, 6, 7, 9, 11, 15])
    def test_a_script_not_needed_never_reads_passed(
        self, repo: Repo, stubs: Stubs, tmp_path: Path, number: int
    ) -> None:
        commit_change(repo, "backend/wavecore/app.py")

        result = gate(repo, stubs, tmp_path)
        row = table_rows(result).get(number, ["", "", SKIPPED])

        assert row[2] == SKIPPED, row

    def test_the_failed_script_reads_failed(self, repo: Repo, stubs: Stubs, tmp_path: Path) -> None:
        commit_change(repo, "backend/wavecore/app.py")

        result = gate(repo, stubs, tmp_path, STUB_FAIL="08")
        row = table_rows(result).get(8, ["", "", ""])

        assert row[2].startswith("failed"), table_rows(result)

    def test_the_full_playwright_run_has_its_row(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        result = gate(repo, stubs, tmp_path, "--playwright", "full")
        row = table_rows(result).get(15, [])

        assert row[:3] == ["Playwright, full", gate_file(15), "passed"]


class TestExitCode:
    """Exit 0 only when every needed script passed."""

    def test_every_needed_script_passing_exits_0(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        commit_change(repo, "backend/wavecore/app.py", "frontend/src/app.ts")

        result = gate(repo, stubs, tmp_path)

        assert result.code == 0, result.lines

    @pytest.mark.parametrize("fail", ["01", "09", "11", "14"])
    def test_any_failure_exits_1(self, repo: Repo, stubs: Stubs, tmp_path: Path, fail: str) -> None:
        commit_change(repo, "backend/wavecore/app.py", "frontend/src/app.ts")

        result = gate(repo, stubs, tmp_path, STUB_FAIL=fail)

        assert result.code == 1, result.lines
