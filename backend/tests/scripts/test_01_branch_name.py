"""Tests for scripts/gate/01-branch-name.sh: where it runs, its result line, log and exit codes."""

import re
from pathlib import Path

import pytest

from tests.scripts.gate_support import (
    BAD_OPTION,
    GATES,
    GateContract,
    GateRun,
    copy_gate,
    copy_ignores,
    gate_file,
    gate_path,
    passed_line,
    result_lines,
)
from tests.scripts.script_support import CLONE, Repo, Run, Stubs, refuse_shared_temp, run, stub_env

NUMBER = 1
CHECK = gate_file(NUMBER)


def callers(folder: Path, pattern: str) -> list[str]:
    """Names of the files in a folder whose text names the branch name check."""
    return sorted(
        path.name
        for path in folder.glob(pattern)
        if path.is_file() and path.name != CHECK and CHECK in path.read_text(encoding="utf-8")
    )


class TestLocalCallers:
    """No other gate script runs the branch name check; only the runner may."""

    @pytest.mark.parametrize("number", [n for n in GATES if n != NUMBER])
    def test_no_other_gate_script_runs_it(self, number: int) -> None:
        path = CLONE / gate_path(number)
        assert path.is_file(), f"{gate_path(number)} does not exist in the clone."

        assert CHECK not in path.read_text(encoding="utf-8")


class TestGitHubCallers:
    """Only the CI workflow runs it, as job 01, on the pull request's branches."""

    def test_only_the_ci_workflow_runs_it(self) -> None:
        workflows = CLONE / ".github" / "workflows"

        assert callers(workflows, "*.yml") + callers(workflows, "*.yaml") == ["ci.yml"]

    def test_the_ci_workflow_checks_the_pull_request_branches(self) -> None:
        text = (CLONE / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")

        assert re.search(
            r'^\s+run: \./scripts/gate/01-branch-name\.sh --pr "\$HEAD" "\$BASE"$', text, re.M
        )


@pytest.fixture
def repo(tmp_path: Path) -> Repo:
    tree = Repo(tmp_path / "repo")
    copy_ignores(tree)
    copy_gate(tree, NUMBER)
    tree.write("README.md", ["# Test tree"])
    tree.commit()
    return tree


@pytest.fixture
def stubs(tmp_path: Path) -> Stubs:
    return Stubs(tmp_path / "stubs")


def branch_check(repo: Repo, stubs: Stubs, tmp_path: Path, *args: str) -> Run:
    refuse_shared_temp(repo, gate_path(NUMBER))
    return run(repo, [str(repo.root / gate_path(NUMBER)), *args], stub_env(tmp_path, stubs))


@pytest.fixture
def passing(repo: Repo, stubs: Stubs, tmp_path: Path) -> GateRun:
    return GateRun(branch_check(repo, stubs, tmp_path), repo, stubs)


@pytest.fixture
def failing(repo: Repo, stubs: Stubs, tmp_path: Path) -> GateRun:
    repo.checkout("Not_An_Allowed_Name")
    return GateRun(branch_check(repo, stubs, tmp_path), repo, stubs)


@pytest.fixture
def usage_error(repo: Repo, stubs: Stubs, tmp_path: Path) -> GateRun:
    return GateRun(branch_check(repo, stubs, tmp_path, BAD_OPTION), repo, stubs)


class TestResultAndLog(GateContract):
    NUMBER = NUMBER


class TestPullRequestBranches:
    """With --pr <head> <base> it checks the pull request's branches, not the current one."""

    def test_a_fix_branch_into_its_release_passes(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        repo.checkout("Not_An_Allowed_Name")

        result = branch_check(
            repo, stubs, tmp_path, "--pr", "fix/1.0.0-alpha1-change", "release/1.0.0-alpha1"
        )

        assert result.code == 0, result.lines
        assert result_lines(result, NUMBER) == [passed_line(NUMBER)]

    def test_a_fix_branch_into_another_release_fails(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        result = branch_check(
            repo, stubs, tmp_path, "--pr", "fix/1.0.0-alpha1-change", "release/1.0.0-alpha2"
        )

        assert result.code == 1, result.lines

    def test_a_missing_base_is_a_usage_error(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        result = branch_check(repo, stubs, tmp_path, "--pr", "fix/1.0.0-alpha1-change")

        assert result.code == 2, result.lines
