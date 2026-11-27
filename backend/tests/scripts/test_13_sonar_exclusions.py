"""Tests for scripts/gate/13-sonar-exclusions.sh: it runs the SonarQube exclusions check."""

from pathlib import Path

import pytest

from tests.scripts.gate_support import (
    BAD_OPTION,
    GateContract,
    GateRun,
    copy_gate,
    copy_ignores,
    gate_path,
)
from tests.scripts.script_support import Repo, Stubs, refuse_shared_temp, run, stub_env

NUMBER = 13
SCRIPT = gate_path(NUMBER)
CHECK = "scripts/lib/check-exclusions.py"
FLAG = "--sonarqube"


@pytest.fixture
def repo(tmp_path: Path) -> Repo:
    tree = Repo(tmp_path / "repo")
    copy_ignores(tree)
    copy_gate(tree, NUMBER)
    tree.write("README.md", ["# Test tree"])
    tree.commit()
    return tree


@pytest.fixture
def stubs(tmp_path: Path, repo: Repo) -> Stubs:
    tools = Stubs(tmp_path / "stubs")
    tools.script(repo, CHECK, key="exclusions")
    return tools


def exclusions(repo: Repo, stubs: Stubs, tmp_path: Path, *args: str, **extra: str) -> GateRun:
    refuse_shared_temp(repo, SCRIPT)
    env = stub_env(tmp_path, stubs, **extra)
    return GateRun(run(repo, [str(repo.root / SCRIPT), *args], env), repo, stubs)


@pytest.fixture
def passing(repo: Repo, stubs: Stubs, tmp_path: Path) -> GateRun:
    return exclusions(repo, stubs, tmp_path)


@pytest.fixture
def failing(repo: Repo, stubs: Stubs, tmp_path: Path) -> GateRun:
    return exclusions(repo, stubs, tmp_path, STUB_FAIL="exclusions")


@pytest.fixture
def usage_error(repo: Repo, stubs: Stubs, tmp_path: Path) -> GateRun:
    return exclusions(repo, stubs, tmp_path, BAD_OPTION)


class TestResultAndLog(GateContract):
    NUMBER = NUMBER


class TestTheCheck:
    """The script runs the exclusions check once, for SonarQube only, from the clone root."""

    def test_the_check_runs_once(self, passing: GateRun) -> None:
        assert len(passing.stubs.calls(CHECK)) == 1, passing.stubs.calls()

    def test_the_check_reads_sonarqube(self, passing: GateRun) -> None:
        (call,) = passing.stubs.calls(CHECK)

        assert call.args == [FLAG]

    def test_the_check_runs_from_the_clone_root(self, passing: GateRun) -> None:
        (call,) = passing.stubs.calls(CHECK)

        assert Path(call.cwd) == passing.repo.root

    def test_a_usage_error_runs_no_check(self, usage_error: GateRun) -> None:
        assert usage_error.stubs.calls(CHECK) == []
