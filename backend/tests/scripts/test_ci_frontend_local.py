"""Tests for scripts/ci-frontend-local.sh with stub tools: tests, coverage, progress and log."""

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

SCRIPT = "scripts/ci-frontend-local.sh"
REPORTER = "vitest-progress-reporter.mjs"

HELPERS = {
    "scripts/check-branch-name.sh": "branch",
    "scripts/check-text.sh": "text",
    "scripts/check-orphaned-files.sh": "orphans",
    "scripts/sonar-scan-frontend.sh": "sonar",
}


@pytest.fixture
def repo(tmp_path: Path) -> Repo:
    tree = Repo(tmp_path / "repo")
    copy_from_clone(tree, SCRIPT)
    (tree.root / "frontend" / "node_modules").mkdir(parents=True)
    tree.write("frontend/package.json", ['{"name": "frontend"}'])
    tree.write("frontend/scripts/" + REPORTER, ["export default class Reporter {}"])
    return tree


@pytest.fixture
def stubs(tmp_path: Path, repo: Repo) -> Stubs:
    tools = Stubs(tmp_path / "stubs")
    tools.podman()
    tools.poetry()
    tools.node_tools()
    tools.tool("sonar-scanner")
    for rel, key in HELPERS.items():
        tools.script(repo, rel, key=key)
    tools.sourced(repo, "scripts/sonar-env.sh")
    return tools


def frontend_ci(repo: Repo, stubs: Stubs, tmp_path: Path, **extra: str) -> Run:
    refuse_shared_temp(repo, SCRIPT)
    env = stub_env(tmp_path, stubs, **extra)
    return run(repo, [str(repo.root / SCRIPT)], env, timeout=50)


def node_calls(stubs: Stubs) -> list[Call]:
    return stubs.calls("npm") + stubs.calls("npx")


def vitest_calls(stubs: Stubs) -> list[Call]:
    return [c for c in node_calls(stubs) if "test:coverage" in c.args or "vitest" in c.line]


class TestNoSonarQube:
    """The local frontend CI runs no SonarQube scan and needs none of its prerequisites."""

    def test_passes_without_sonar_token_or_scanner(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        (stubs.bin / "sonar-scanner").unlink()

        result = frontend_ci(repo, stubs, tmp_path)

        assert result.code == 0, result.lines

    def test_no_scan_runs(self, repo: Repo, stubs: Stubs, tmp_path: Path) -> None:
        result = frontend_ci(repo, stubs, tmp_path, SONAR_TOKEN="test-token")

        assert result.code == 0, result.lines
        assert stubs.calls("sonar-scanner") == []
        assert stubs.calls("scripts/sonar-scan-frontend.sh") == []
        assert stubs.calls("scripts/sonar-env.sh") == []

    def test_passes_on_a_detached_head(self, repo: Repo, stubs: Stubs, tmp_path: Path) -> None:
        repo.commit()
        repo.detach()

        result = frontend_ci(repo, stubs, tmp_path)

        assert result.code == 0, result.lines

    def test_leaves_no_coverage_marker(self, repo: Repo, stubs: Stubs, tmp_path: Path) -> None:
        frontend_ci(repo, stubs, tmp_path)

        assert not (repo.root / ".ci-fe-coverage-ready").exists()


class TestTestsAndCoverageOnly:
    """The tests and the coverage gate only: no branch name check and no fast checks."""

    def test_the_branch_name_check_does_not_run(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        result = frontend_ci(repo, stubs, tmp_path)

        assert result.code == 0, result.lines
        assert stubs.calls("scripts/check-branch-name.sh") == []

    @pytest.mark.parametrize("branch", ["not-an-allowed-name", ""], ids=["bad-name", "detached"])
    def test_a_branch_name_the_check_refuses_does_not_stop_the_run(
        self, repo: Repo, stubs: Stubs, tmp_path: Path, branch: str
    ) -> None:
        repo.commit()
        if branch:
            repo.checkout(branch)
        else:
            repo.detach()

        result = frontend_ci(repo, stubs, tmp_path, STUB_FAIL="branch")

        assert result.code == 0, result.lines
        assert len([c for c in stubs.calls("podman") if c.args[:1] == ["run"]]) == 1

    def test_no_fast_check_runs(self, repo: Repo, stubs: Stubs, tmp_path: Path) -> None:
        result = frontend_ci(repo, stubs, tmp_path)

        assert result.code == 0, result.lines
        assert stubs.calls("scripts/check-text.sh") == []
        assert stubs.calls("scripts/check-orphaned-files.sh") == []
        for call in node_calls(stubs):
            assert "lint" not in call.args and "eslint" not in call.line, call.line
            assert "type-check" not in call.args and "tsc" not in call.args, call.line
            assert "build" not in call.args, call.line

    def test_the_tests_run_once_with_coverage(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        frontend_ci(repo, stubs, tmp_path)

        runs = [c for c in stubs.calls("podman") if c.args[:1] == ["run"]]
        assert len(runs) == 1
        assert "wave-ci:latest" in runs[0].args
        (call,) = vitest_calls(stubs)
        assert "test:coverage" in call.args or "--coverage" in call.args
        assert Path(call.cwd) == repo.root / "frontend"

    def test_failing_tests_fail_the_run(self, repo: Repo, stubs: Stubs, tmp_path: Path) -> None:
        result = frontend_ci(repo, stubs, tmp_path, STUB_FAIL="vitest")

        assert result.code == 1, result.lines


class TestProgressReporter:
    """The vitest call passes the progress reporter."""

    def test_the_reporter_replaces_the_dot_reporter(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        frontend_ci(repo, stubs, tmp_path)

        (call,) = vitest_calls(stubs)
        assert "--reporter=dot" not in call.args
        assert "dot" not in call.args
        reporters = [
            a.split("=", 1)[1] if a.startswith("--reporter=") else call.args[i + 1]
            for i, a in enumerate(call.args)
            if a.startswith("--reporter=") or a == "--reporter"
        ]
        assert len(reporters) == 1, call.args
        assert reporters[0].endswith("scripts/" + REPORTER)

    def test_the_progress_interval_reaches_the_container(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        frontend_ci(repo, stubs, tmp_path, WAVE_CI_PROGRESS_SECONDS="7")

        (call,) = vitest_calls(stubs)
        assert call.env.get("WAVE_CI_PROGRESS_SECONDS") == "7"


class TestLog:
    """The log goes to ci-output/ci-frontend.log, named at the start and the end."""

    def test_the_log_path_is_printed_at_start_and_end(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        log = repo.root / "ci-output" / "ci-frontend.log"

        result = frontend_ci(repo, stubs, tmp_path)

        named = [i for i, line in enumerate(result.lines) if line == f"Log: {log}"]
        assert len(log_lines(result, log)) >= 2, result.lines
        assert named[0] < len(result.lines) // 2 < named[-1]
        assert log.is_file()
