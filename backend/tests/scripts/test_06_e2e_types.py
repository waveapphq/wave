"""Tests for scripts/gate/06-e2e-types.sh: the tests/e2e type check in wave-ci."""

from pathlib import Path

import pytest

from tests.scripts.gate_support import (
    BAD_OPTION,
    IN_CONTAINER,
    PODMAN_WITHOUT_IMAGE,
    ContainerContract,
    GateContract,
    GateRun,
    copy_gate,
    copy_ignores,
    gate_path,
    node_check,
)
from tests.scripts.script_support import Repo, Stubs, refuse_shared_temp, run, stub_env

NUMBER = 6
SCRIPT = gate_path(NUMBER)


@pytest.fixture
def repo(tmp_path: Path) -> Repo:
    tree = Repo(tmp_path / "repo")
    copy_ignores(tree)
    copy_gate(tree, NUMBER)
    (tree.root / "tests" / "e2e" / "node_modules").mkdir(parents=True)
    tree.write("tests/e2e/package.json", ['{"name": "e2e"}'])
    return tree


@pytest.fixture
def stubs(tmp_path: Path) -> Stubs:
    tools = Stubs(tmp_path / "stubs")
    tools.podman()
    tools.node_tools()
    return tools


def e2e_types(repo: Repo, stubs: Stubs, tmp_path: Path, *args: str, **extra: str) -> GateRun:
    refuse_shared_temp(repo, SCRIPT)
    env = stub_env(tmp_path, stubs, **extra)
    return GateRun(run(repo, [str(repo.root / SCRIPT), *args], env, timeout=50), repo, stubs)


@pytest.fixture
def passing(repo: Repo, stubs: Stubs, tmp_path: Path) -> GateRun:
    return e2e_types(repo, stubs, tmp_path)


@pytest.fixture
def failing(repo: Repo, stubs: Stubs, tmp_path: Path) -> GateRun:
    return e2e_types(repo, stubs, tmp_path, STUB_FAIL="e2e-typescript")


@pytest.fixture
def usage_error(repo: Repo, stubs: Stubs, tmp_path: Path) -> GateRun:
    return e2e_types(repo, stubs, tmp_path, BAD_OPTION)


@pytest.fixture
def inside(repo: Repo, stubs: Stubs, tmp_path: Path) -> GateRun:
    return e2e_types(repo, stubs, tmp_path, **{IN_CONTAINER: "1"})


@pytest.fixture
def no_image(repo: Repo, stubs: Stubs, tmp_path: Path) -> GateRun:
    stubs.tool("podman", PODMAN_WITHOUT_IMAGE)
    return e2e_types(repo, stubs, tmp_path)


class TestResultAndLog(GateContract):
    NUMBER = NUMBER


class TestWhereItRuns(ContainerContract):
    NUMBER = NUMBER

    def test_inside_the_container_the_type_check_runs_directly(self, inside: GateRun) -> None:
        assert len(node_check(inside.stubs, inside.repo, "e2e-typescript")) == 1


class TestTheTypeCheck:
    """The type check runs once, in tests/e2e, through its package script."""

    def test_it_uses_the_e2e_package_script(self, passing: GateRun) -> None:
        (call,) = node_check(passing.stubs, passing.repo, "e2e-typescript")

        assert Path(call.cwd) == passing.repo.root / "tests" / "e2e"
        assert call.tool == "npm"
        assert "type-check" in call.args

    def test_the_frontend_type_check_does_not_run(self, passing: GateRun) -> None:
        assert node_check(passing.stubs, passing.repo, "typescript") == []
