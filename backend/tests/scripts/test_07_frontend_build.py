"""Tests for scripts/gate/07-frontend-build.sh: the Vite build in wave-ci."""

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

NUMBER = 7
SCRIPT = gate_path(NUMBER)


@pytest.fixture
def repo(tmp_path: Path) -> Repo:
    tree = Repo(tmp_path / "repo")
    copy_ignores(tree)
    copy_gate(tree, NUMBER)
    for folder in ("frontend/src", "frontend/node_modules"):
        (tree.root / folder).mkdir(parents=True)
    tree.write("frontend/package.json", ['{"name": "frontend"}'])
    return tree


@pytest.fixture
def stubs(tmp_path: Path) -> Stubs:
    tools = Stubs(tmp_path / "stubs")
    tools.podman()
    tools.node_tools()
    return tools


def frontend_build(repo: Repo, stubs: Stubs, tmp_path: Path, *args: str, **extra: str) -> GateRun:
    refuse_shared_temp(repo, SCRIPT)
    env = stub_env(tmp_path, stubs, **extra)
    return GateRun(run(repo, [str(repo.root / SCRIPT), *args], env, timeout=50), repo, stubs)


@pytest.fixture
def passing(repo: Repo, stubs: Stubs, tmp_path: Path) -> GateRun:
    return frontend_build(repo, stubs, tmp_path)


@pytest.fixture
def failing(repo: Repo, stubs: Stubs, tmp_path: Path) -> GateRun:
    return frontend_build(repo, stubs, tmp_path, STUB_FAIL="build")


@pytest.fixture
def usage_error(repo: Repo, stubs: Stubs, tmp_path: Path) -> GateRun:
    return frontend_build(repo, stubs, tmp_path, BAD_OPTION)


@pytest.fixture
def inside(repo: Repo, stubs: Stubs, tmp_path: Path) -> GateRun:
    return frontend_build(repo, stubs, tmp_path, **{IN_CONTAINER: "1"})


@pytest.fixture
def no_image(repo: Repo, stubs: Stubs, tmp_path: Path) -> GateRun:
    stubs.tool("podman", PODMAN_WITHOUT_IMAGE)
    return frontend_build(repo, stubs, tmp_path)


class TestResultAndLog(GateContract):
    NUMBER = NUMBER


class TestWhereItRuns(ContainerContract):
    NUMBER = NUMBER

    def test_inside_the_container_the_build_runs_directly(self, inside: GateRun) -> None:
        assert len(node_check(inside.stubs, inside.repo, "build")) == 1


class TestTheBuild:
    """The build runs once, in frontend/, and nothing else runs."""

    def test_it_builds_in_the_frontend(self, passing: GateRun) -> None:
        (call,) = node_check(passing.stubs, passing.repo, "build")

        assert Path(call.cwd) == passing.repo.root / "frontend"

    @pytest.mark.parametrize("key", ["eslint", "typescript", "vitest"])
    def test_no_other_check_runs(self, passing: GateRun, key: str) -> None:
        assert node_check(passing.stubs, passing.repo, key) == []
