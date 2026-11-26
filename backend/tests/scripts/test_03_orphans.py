"""Tests for scripts/gate/03-orphans.sh: orphaned frontend files and exclusion IDs."""

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
from tests.scripts.script_support import Repo, Run, Stubs, refuse_shared_temp, run, stub_env

NUMBER = 3
SCRIPT = gate_path(NUMBER)
LISTS = [
    "tests/exclusions/frontend-coverage.md",
    "tests/exclusions/backend-coverage.md",
    "tests/exclusions/sonarqube-cloud.md",
    "tests/exclusions/codeql.md",
]


def sq_id(name: str) -> str:
    """Build a SonarQube entry ID at run time, so no unregistered ID literal sits in the repo."""
    return "SQ-" + name


@pytest.fixture
def repo(tmp_path: Path) -> Repo:
    tree = Repo(tmp_path / "repo")
    copy_ignores(tree)
    copy_gate(tree, NUMBER)
    tree.write("frontend/src/app/main.tsx", ["import { App } from './App'", "App()"])
    tree.write("frontend/src/app/App.tsx", ["export function App() {}"])
    for folder in ("backend/wavecore", "backend/tests", "frontend/tests", "tests/e2e"):
        (tree.root / folder).mkdir(parents=True)
    for rel in LISTS:
        tree.write(rel, ["# Exclusions"])
    return tree


@pytest.fixture
def stubs(tmp_path: Path) -> Stubs:
    return Stubs(tmp_path / "stubs")


def orphans(repo: Repo, stubs: Stubs, tmp_path: Path, *args: str) -> Run:
    refuse_shared_temp(repo, SCRIPT)
    return run(repo, [str(repo.root / SCRIPT), *args], stub_env(tmp_path, stubs))


@pytest.fixture
def passing(repo: Repo, stubs: Stubs, tmp_path: Path) -> GateRun:
    return GateRun(orphans(repo, stubs, tmp_path), repo, stubs)


@pytest.fixture
def failing(repo: Repo, stubs: Stubs, tmp_path: Path) -> GateRun:
    repo.write("frontend/src/lib/unused.ts", ["export const unused = 1"])
    return GateRun(orphans(repo, stubs, tmp_path), repo, stubs)


@pytest.fixture
def usage_error(repo: Repo, stubs: Stubs, tmp_path: Path) -> GateRun:
    return GateRun(orphans(repo, stubs, tmp_path, BAD_OPTION), repo, stubs)


class TestResultAndLog(GateContract):
    NUMBER = NUMBER


class TestExclusionIds:
    """An ID comment in the code with no entry in its list fails the check."""

    def test_an_unregistered_id_fails(self, repo: Repo, stubs: Stubs, tmp_path: Path) -> None:
        repo.write("backend/wavecore/a.py", [f"# SonarQube exclusion: {sq_id('HASH-001')}"])

        result = orphans(repo, stubs, tmp_path)

        assert result.code == 1, result.lines

    def test_a_registered_id_passes(self, repo: Repo, stubs: Stubs, tmp_path: Path) -> None:
        repo.write("backend/wavecore/a.py", [f"# SonarQube exclusion: {sq_id('HASH-001')}"])
        repo.write("tests/exclusions/sonarqube-cloud.md", [f"### {sq_id('HASH-001')}"])

        result = orphans(repo, stubs, tmp_path)

        assert result.code == 0, result.lines
