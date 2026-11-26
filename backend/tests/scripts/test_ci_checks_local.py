"""Tests for scripts/ci-checks-local.sh, the fast checks, with stub tools and stub checks."""

from pathlib import Path

import pytest

from tests.scripts.script_support import (
    Call,
    Repo,
    Run,
    Stubs,
    copy_from_clone,
    log_lines,
    refuse_shared_temp,
    run,
    stub_env,
)

SCRIPT = "scripts/ci-checks-local.sh"
IMAGE = "wave-ci:latest"

# Check name -> the stub key that makes it fail, in run order.
CHECKS = {
    "Branch name": "branch",
    "Text": "text",
    "Orphaned files and exclusion IDs": "orphans",
    "mypy": "mypy",
    "black": "black",
    "ruff": "ruff",
    "ESLint": "eslint",
    "TypeScript": "typescript",
    "E2E TypeScript": "e2e-typescript",
    "Build": "build",
}
HOST_CHECKS = {
    "scripts/check-branch-name.sh": "branch",
    "scripts/check-text.sh": "text",
    "scripts/check-orphaned-files.sh": "orphans",
}


@pytest.fixture
def repo(tmp_path: Path) -> Repo:
    tree = Repo(tmp_path / "repo")
    copy_from_clone(tree, SCRIPT)
    for folder in ("backend/wavecore", "backend/tests", "frontend/src", "frontend/tests"):
        (tree.root / folder).mkdir(parents=True)
    tree.write("frontend/package.json", ['{"name": "frontend"}'])
    tree.write("tests/e2e/package.json", ['{"name": "e2e"}'])
    return tree


@pytest.fixture
def stubs(tmp_path: Path, repo: Repo) -> Stubs:
    tools = Stubs(tmp_path / "stubs")
    tools.podman()
    tools.poetry()
    tools.node_tools()
    for rel, key in HOST_CHECKS.items():
        tools.script(repo, rel, key=key)
    return tools


def checks(repo: Repo, stubs: Stubs, tmp_path: Path, fail: list[str] | None = None) -> Run:
    refuse_shared_temp(repo, SCRIPT)
    env = stub_env(tmp_path, stubs, STUB_FAIL=",".join(fail or []))
    return run(repo, [str(repo.root / SCRIPT)], env, timeout=50)


def poetry_tool(stubs: Stubs, tool: str) -> list[Call]:
    return [c for c in stubs.calls("poetry") if "run" in c.args and tool in c.args]


def node_calls(stubs: Stubs) -> list[Call]:
    return stubs.calls("npm") + stubs.calls("npx")


class TestSummary:
    """One summary line: all passed, or the failed checks in run order."""

    def test_all_pass(self, repo: Repo, stubs: Stubs, tmp_path: Path) -> None:
        result = checks(repo, stubs, tmp_path)

        assert result.code == 0, result.lines
        assert "Fast checks passed." in result.lines
        assert not any(line.startswith("Fast checks failed:") for line in result.lines)

    @pytest.mark.parametrize("name", list(CHECKS))
    def test_one_failed_check_is_named(
        self, repo: Repo, stubs: Stubs, tmp_path: Path, name: str
    ) -> None:
        result = checks(repo, stubs, tmp_path, [CHECKS[name]])

        assert result.code == 1, result.lines
        assert f"Fast checks failed: {name}." in result.lines
        assert "Fast checks passed." not in result.lines

    def test_several_failed_checks_are_listed_in_run_order(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        result = checks(repo, stubs, tmp_path, ["build", "text", "ruff"])

        assert result.code == 1, result.lines
        assert "Fast checks failed: Text, ruff, Build." in result.lines

    def test_every_check_failing_lists_all_ten(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        result = checks(repo, stubs, tmp_path, list(CHECKS.values()))

        assert result.code == 1, result.lines
        assert f"Fast checks failed: {', '.join(CHECKS)}." in result.lines


class TestEveryCheckRuns:
    """Every check runs even after one fails."""

    @pytest.mark.parametrize("fail", [[], ["branch"], ["branch", "text", "orphans", "mypy"]])
    def test_all_checks_are_called(
        self, repo: Repo, stubs: Stubs, tmp_path: Path, fail: list[str]
    ) -> None:
        checks(repo, stubs, tmp_path, fail)

        for rel in HOST_CHECKS:
            assert len(stubs.calls(rel)) == 1, rel
        for tool in ("mypy", "black", "ruff"):
            assert len(poetry_tool(stubs, tool)) == 1, tool
        keys = [node_key(c, repo) for c in node_calls(stubs)]
        for key in ("eslint", "typescript", "e2e-typescript", "build"):
            assert keys.count(key) == 1, (key, keys)


def node_key(call: Call, repo: Repo) -> str | None:
    """The check an npm or npx call stands for, as the stub reads it."""
    e2e = Path(call.cwd) == repo.root / "tests" / "e2e" or "tests/e2e" in call.line
    if "lint" in call.args or "eslint" in call.line:
        return "eslint"
    if "type-check" in call.args or "tsc" in call.args:
        return "e2e-typescript" if e2e else "typescript"
    if "build" in call.args:
        return "build"
    return None


class TestWhereChecksRun:
    """Three checks on the host first, then one wave-ci container for the rest."""

    def test_the_host_checks_run_before_one_container(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        checks(repo, stubs, tmp_path)

        calls = stubs.calls()
        runs = [i for i, c in enumerate(calls) if c.tool == "podman" and c.args[:1] == ["run"]]
        assert len(runs) == 1
        assert IMAGE in calls[runs[0]].args
        host = [i for i, c in enumerate(calls) if c.tool in HOST_CHECKS]
        assert [calls[i].tool for i in host] == list(HOST_CHECKS)
        assert max(host) < runs[0]

    def test_container_checks_run_inside_the_container(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        checks(repo, stubs, tmp_path)

        calls = stubs.calls()
        start = next(i for i, c in enumerate(calls) if c.tool == "podman" and c.args[:1] == ["run"])
        inside = [c.tool for c in calls[start + 1 :]]
        assert "poetry" in inside
        assert {"npm", "npx"} & set(inside)
        assert not [c for c in calls[:start] if c.tool in ("poetry", "npm", "npx")]


class TestScopes:
    """mypy over wavecore/; black, ruff and ESLint over the code and the tests."""

    def test_mypy_checks_wavecore_only(self, repo: Repo, stubs: Stubs, tmp_path: Path) -> None:
        checks(repo, stubs, tmp_path)

        (call,) = poetry_tool(stubs, "mypy")
        assert Path(call.cwd) == repo.root / "backend"
        assert "wavecore/" in call.args or "wavecore" in call.args
        assert not any(a.rstrip("/") == "tests" for a in call.args)

    @pytest.mark.parametrize("tool", ["black", "ruff"])
    def test_format_and_lint_cover_wavecore_and_tests(
        self, repo: Repo, stubs: Stubs, tmp_path: Path, tool: str
    ) -> None:
        checks(repo, stubs, tmp_path)

        (call,) = poetry_tool(stubs, tool)
        assert Path(call.cwd) == repo.root / "backend"
        folders = {a.rstrip("/") for a in call.args}
        assert {"wavecore", "tests"} <= folders
        if tool == "black":
            assert "--check" in call.args
        else:
            assert "check" in call.args
            assert "--fix" not in call.args

    def test_eslint_runs_in_the_frontend(self, repo: Repo, stubs: Stubs, tmp_path: Path) -> None:
        checks(repo, stubs, tmp_path)

        (call,) = [c for c in node_calls(stubs) if node_key(c, repo) == "eslint"]
        assert Path(call.cwd) == repo.root / "frontend"
        if "eslint" in call.line and "lint" not in call.args:
            folders = {a.rstrip("/") for a in call.args}
            assert {"src", "tests"} <= folders
        assert "--fix" not in call.args

    def test_both_type_checks_use_their_package_scripts(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        checks(repo, stubs, tmp_path)

        typed = [
            c for c in node_calls(stubs) if node_key(c, repo) in ("typescript", "e2e-typescript")
        ]
        assert sorted(Path(c.cwd) for c in typed) == sorted(
            [repo.root / "frontend", repo.root / "tests" / "e2e"]
        )
        for call in typed:
            assert call.tool == "npm"
            assert "type-check" in call.args


class TestLog:
    """The log goes to ci-output/ci-checks.log, named at the start and the end."""

    def test_the_log_path_is_printed_at_start_and_end(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        log = repo.root / "ci-output" / "ci-checks.log"

        result = checks(repo, stubs, tmp_path)

        assert len(log_lines(result, log)) >= 2, result.lines
        assert result.lines.index(f"Log: {log}") < result.lines.index("Fast checks passed.")
        assert log.is_file()
        assert "Fast checks passed." in log.read_text(encoding="utf-8")
