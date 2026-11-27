"""Tests for scripts/gate/04-backend-static.sh: mypy, black and ruff, together, in wave-ci."""

from pathlib import Path

import pytest

from tests.scripts.gate_support import (
    BAD_OPTION,
    IN_CONTAINER,
    PODMAN_WITHOUT_IMAGE,
    ContainerContract,
    GateContract,
    GateRun,
    container_runs,
    copy_gate,
    copy_ignores,
    failed_reason,
    first_index,
    gate_path,
)
from tests.scripts.script_support import (
    Call,
    Repo,
    Stubs,
    refuse_shared_temp,
    run,
    stub_env,
)

NUMBER = 4
SCRIPT = gate_path(NUMBER)
TOOLS = ["mypy", "black", "ruff"]


@pytest.fixture
def repo(tmp_path: Path) -> Repo:
    tree = Repo(tmp_path / "repo")
    copy_ignores(tree)
    copy_gate(tree, NUMBER)
    for folder in ("backend/wavecore", "backend/tests"):
        (tree.root / folder).mkdir(parents=True)
    return tree


@pytest.fixture
def stubs(tmp_path: Path) -> Stubs:
    tools = Stubs(tmp_path / "stubs")
    tools.podman()
    tools.poetry()
    return tools


def backend_static(repo: Repo, stubs: Stubs, tmp_path: Path, *args: str, **extra: str) -> GateRun:
    refuse_shared_temp(repo, SCRIPT)
    env = stub_env(tmp_path, stubs, **extra)
    return GateRun(run(repo, [str(repo.root / SCRIPT), *args], env, timeout=50), repo, stubs)


def poetry_tool(stubs: Stubs, tool: str) -> list[Call]:
    return [c for c in stubs.calls("poetry") if "run" in c.args and tool in c.args]


@pytest.fixture
def passing(repo: Repo, stubs: Stubs, tmp_path: Path) -> GateRun:
    return backend_static(repo, stubs, tmp_path)


@pytest.fixture
def failing(repo: Repo, stubs: Stubs, tmp_path: Path) -> GateRun:
    return backend_static(repo, stubs, tmp_path, STUB_FAIL="black")


@pytest.fixture
def usage_error(repo: Repo, stubs: Stubs, tmp_path: Path) -> GateRun:
    return backend_static(repo, stubs, tmp_path, BAD_OPTION)


@pytest.fixture
def inside(repo: Repo, stubs: Stubs, tmp_path: Path) -> GateRun:
    return backend_static(repo, stubs, tmp_path, **{IN_CONTAINER: "1"})


@pytest.fixture
def no_image(repo: Repo, stubs: Stubs, tmp_path: Path) -> GateRun:
    stubs.tool("podman", PODMAN_WITHOUT_IMAGE)
    return backend_static(repo, stubs, tmp_path)


class TestResultAndLog(GateContract):
    NUMBER = NUMBER


class TestWhereItRuns(ContainerContract):
    NUMBER = NUMBER

    def test_run_alone_the_tools_run_inside_the_container(self, passing: GateRun) -> None:
        calls = passing.stubs.calls()

        assert first_index(calls, "podman") < first_index(calls, "poetry"), calls

    @pytest.mark.parametrize("tool", TOOLS)
    def test_inside_the_container_each_tool_runs_directly(self, inside: GateRun, tool: str) -> None:
        assert len(poetry_tool(inside.stubs, tool)) == 1, inside.stubs.calls()


class TestEveryToolRuns:
    """The three tools run together: one failing never stops the others."""

    @pytest.mark.parametrize("fail", TOOLS)
    @pytest.mark.parametrize("tool", TOOLS)
    def test_each_tool_runs_once(
        self, repo: Repo, stubs: Stubs, tmp_path: Path, fail: str, tool: str
    ) -> None:
        backend_static(repo, stubs, tmp_path, STUB_FAIL=fail)

        assert len(poetry_tool(stubs, tool)) == 1, stubs.calls()

    @pytest.mark.parametrize("fail", TOOLS)
    def test_the_reason_names_the_failed_tool(
        self, repo: Repo, stubs: Stubs, tmp_path: Path, fail: str
    ) -> None:
        result = backend_static(repo, stubs, tmp_path, STUB_FAIL=fail).result

        assert result.code == 1, result.lines
        assert fail in failed_reason(result, NUMBER), result.lines

    @pytest.mark.parametrize("fail", TOOLS)
    def test_the_reason_names_no_tool_that_passed(
        self, repo: Repo, stubs: Stubs, tmp_path: Path, fail: str
    ) -> None:
        result = backend_static(repo, stubs, tmp_path, STUB_FAIL=fail).result
        reason = failed_reason(result, NUMBER)

        for tool in [t for t in TOOLS if t != fail]:
            assert tool not in reason, (tool, reason)

    def test_two_failed_tools_are_both_named(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        result = backend_static(repo, stubs, tmp_path, STUB_FAIL="mypy,ruff").result
        reason = failed_reason(result, NUMBER)

        assert "mypy" in reason, result.lines
        assert "ruff" in reason, result.lines


class TestScopes:
    """mypy over wavecore/; black and ruff over wavecore/ and tests/; nothing is fixed."""

    def test_mypy_checks_wavecore_only(self, passing: GateRun) -> None:
        (call,) = poetry_tool(passing.stubs, "mypy")
        folders = {a.rstrip("/") for a in call.args}

        assert Path(call.cwd) == passing.repo.root / "backend"
        assert "wavecore" in folders
        assert "tests" not in folders

    @pytest.mark.parametrize("tool", ["black", "ruff"])
    def test_format_and_lint_cover_wavecore_and_tests(self, passing: GateRun, tool: str) -> None:
        (call,) = poetry_tool(passing.stubs, tool)
        folders = {a.rstrip("/") for a in call.args}

        assert Path(call.cwd) == passing.repo.root / "backend"
        assert {"wavecore", "tests"} <= folders

    def test_black_only_checks(self, passing: GateRun) -> None:
        (call,) = poetry_tool(passing.stubs, "black")

        assert "--check" in call.args

    def test_ruff_only_checks(self, passing: GateRun) -> None:
        (call,) = poetry_tool(passing.stubs, "ruff")

        assert "check" in call.args
        assert "--fix" not in call.args

    def test_one_container_runs_the_three_tools(self, passing: GateRun) -> None:
        assert len(container_runs(passing.stubs)) == 1
