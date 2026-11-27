"""Tests for scripts/gate/05-frontend-static.sh: ESLint and the type check, together, in wave-ci."""

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
    failed_reason,
    first_index,
    gate_path,
    node_check,
)
from tests.scripts.script_support import Repo, Stubs, refuse_shared_temp, run, stub_env

NUMBER = 5
SCRIPT = gate_path(NUMBER)
# Stub key -> a word the failed reason holds for it, lower case.
TOOLS = {"eslint": "eslint", "typescript": "type"}


@pytest.fixture
def repo(tmp_path: Path) -> Repo:
    tree = Repo(tmp_path / "repo")
    copy_ignores(tree)
    copy_gate(tree, NUMBER)
    for folder in ("frontend/src", "frontend/tests", "frontend/node_modules"):
        (tree.root / folder).mkdir(parents=True)
    tree.write("frontend/package.json", ['{"name": "frontend"}'])
    return tree


@pytest.fixture
def stubs(tmp_path: Path) -> Stubs:
    tools = Stubs(tmp_path / "stubs")
    tools.podman()
    tools.node_tools()
    return tools


def frontend_static(repo: Repo, stubs: Stubs, tmp_path: Path, *args: str, **extra: str) -> GateRun:
    refuse_shared_temp(repo, SCRIPT)
    env = stub_env(tmp_path, stubs, **extra)
    return GateRun(run(repo, [str(repo.root / SCRIPT), *args], env, timeout=50), repo, stubs)


@pytest.fixture
def passing(repo: Repo, stubs: Stubs, tmp_path: Path) -> GateRun:
    return frontend_static(repo, stubs, tmp_path)


@pytest.fixture
def failing(repo: Repo, stubs: Stubs, tmp_path: Path) -> GateRun:
    return frontend_static(repo, stubs, tmp_path, STUB_FAIL="eslint")


@pytest.fixture
def usage_error(repo: Repo, stubs: Stubs, tmp_path: Path) -> GateRun:
    return frontend_static(repo, stubs, tmp_path, BAD_OPTION)


@pytest.fixture
def inside(repo: Repo, stubs: Stubs, tmp_path: Path) -> GateRun:
    return frontend_static(repo, stubs, tmp_path, **{IN_CONTAINER: "1"})


@pytest.fixture
def no_image(repo: Repo, stubs: Stubs, tmp_path: Path) -> GateRun:
    stubs.tool("podman", PODMAN_WITHOUT_IMAGE)
    return frontend_static(repo, stubs, tmp_path)


class TestResultAndLog(GateContract):
    NUMBER = NUMBER


class TestWhereItRuns(ContainerContract):
    NUMBER = NUMBER

    def test_run_alone_the_tools_run_inside_the_container(self, passing: GateRun) -> None:
        calls = passing.stubs.calls()
        first_node = min(first_index(calls, "npm"), first_index(calls, "npx"))

        assert first_index(calls, "podman") < first_node, calls

    @pytest.mark.parametrize("key", list(TOOLS))
    def test_inside_the_container_each_tool_runs_directly(self, inside: GateRun, key: str) -> None:
        assert len(node_check(inside.stubs, inside.repo, key)) == 1, inside.stubs.calls()


class TestEveryToolRuns:
    """ESLint and the type check run together: one failing never stops the other."""

    @pytest.mark.parametrize("fail", list(TOOLS))
    @pytest.mark.parametrize("key", list(TOOLS))
    def test_each_tool_runs_once(
        self, repo: Repo, stubs: Stubs, tmp_path: Path, fail: str, key: str
    ) -> None:
        frontend_static(repo, stubs, tmp_path, STUB_FAIL=fail)

        assert len(node_check(stubs, repo, key)) == 1, stubs.calls()

    @pytest.mark.parametrize("fail", list(TOOLS))
    def test_the_reason_names_the_failed_tool(
        self, repo: Repo, stubs: Stubs, tmp_path: Path, fail: str
    ) -> None:
        result = frontend_static(repo, stubs, tmp_path, STUB_FAIL=fail).result

        assert result.code == 1, result.lines
        assert TOOLS[fail] in failed_reason(result, NUMBER).lower(), result.lines

    @pytest.mark.parametrize(("fail", "other"), [("eslint", "type"), ("typescript", "eslint")])
    def test_the_reason_names_no_tool_that_passed(
        self, repo: Repo, stubs: Stubs, tmp_path: Path, fail: str, other: str
    ) -> None:
        result = frontend_static(repo, stubs, tmp_path, STUB_FAIL=fail).result

        assert other not in failed_reason(result, NUMBER).lower(), result.lines


class TestScopes:
    """ESLint over src/ and tests/ through the lint script; the type check through its script."""

    def test_eslint_runs_in_the_frontend(self, passing: GateRun) -> None:
        (call,) = node_check(passing.stubs, passing.repo, "eslint")

        assert Path(call.cwd) == passing.repo.root / "frontend"
        assert "--fix" not in call.args

    def test_the_type_check_uses_its_package_script(self, passing: GateRun) -> None:
        (call,) = node_check(passing.stubs, passing.repo, "typescript")

        assert Path(call.cwd) == passing.repo.root / "frontend"
        assert call.tool == "npm"
        assert "type-check" in call.args
