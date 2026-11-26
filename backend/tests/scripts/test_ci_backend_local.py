"""Tests for scripts/ci-backend-local.sh with stub tools: tests, coverage, progress and log."""

from pathlib import Path

import pytest

from tests.scripts.script_support import (
    Repo,
    Run,
    Stubs,
    copy_from_clone,
    log_lines,
    refuse_shared_temp,
    run,
    stub_env,
)

SCRIPT = "scripts/ci-backend-local.sh"
CONTAINER_PATH = "/workspace/backend"

# Prints pytest progress for a few seconds, then writes coverage.xml with container paths.
RUN_COVERAGE = f"""
lines = [
    "tests/api/test_a.py ........ [ 25%]",
    "tests/api/test_b.py ........ [ 50%]",
    "tests/core/test_c.py ........ [ 75%]",
    "tests/core/test_d.py ........ [100%]",
]
for line in lines:
    print(line, flush=True)
    time.sleep(float(os.environ.get("STUB_PYTEST_PAUSE", "0.8")))
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(root, "backend", "coverage.xml"), "w", encoding="utf-8") as handle:
    handle.write(
        '<?xml version="1.0" ?>\\n<coverage><sources><source>{CONTAINER_PATH}/wavecore</source>'
        '</sources><packages><package name="wavecore"><classes>'
        '<class filename="{CONTAINER_PATH}/wavecore/app.py"/></classes></package></packages>'
        "</coverage>\\n"
    )
sys.exit(1 if "pytest" in FAIL else 0)
"""

STUB_PROGRESS = {f"Progress: {n}%" for n in (0, 25, 50, 75, 100)}

HELPERS = {
    "scripts/check-branch-name.sh": "branch",
    "scripts/check-text.sh": "text",
    "scripts/check-orphaned-files.sh": "orphans",
    "scripts/sonar-scan-backend.sh": "sonar",
}


@pytest.fixture
def repo(tmp_path: Path) -> Repo:
    tree = Repo(tmp_path / "repo")
    copy_from_clone(tree, SCRIPT)
    (tree.root / "backend" / "wavecore").mkdir(parents=True)
    return tree


@pytest.fixture
def stubs(tmp_path: Path, repo: Repo) -> Stubs:
    tools = Stubs(tmp_path / "stubs")
    tools.podman()
    tools.poetry()
    tools.tool("sonar-scanner")
    for rel, key in HELPERS.items():
        tools.script(repo, rel, key=key)
    tools.sourced(repo, "scripts/sonar-env.sh")
    tools.script(repo, "scripts/run-coverage-backend.sh", RUN_COVERAGE)
    return tools


def backend_ci(repo: Repo, stubs: Stubs, tmp_path: Path, **extra: str) -> Run:
    refuse_shared_temp(repo, SCRIPT)
    env = stub_env(tmp_path, stubs, **extra)
    return run(repo, [str(repo.root / SCRIPT)], env, timeout=50)


class TestNoSonarQube:
    """The local backend CI runs no SonarQube scan and needs none of its prerequisites."""

    def test_passes_without_sonar_token_or_scanner(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        (stubs.bin / "sonar-scanner").unlink()

        result = backend_ci(repo, stubs, tmp_path)

        assert result.code == 0, result.lines

    def test_no_scan_runs(self, repo: Repo, stubs: Stubs, tmp_path: Path) -> None:
        result = backend_ci(repo, stubs, tmp_path, SONAR_TOKEN="test-token")

        assert result.code == 0, result.lines
        assert stubs.calls("sonar-scanner") == []
        assert stubs.calls("scripts/sonar-scan-backend.sh") == []
        assert stubs.calls("scripts/sonar-env.sh") == []

    def test_passes_on_a_detached_head(self, repo: Repo, stubs: Stubs, tmp_path: Path) -> None:
        repo.commit()
        repo.detach()

        result = backend_ci(repo, stubs, tmp_path)

        assert result.code == 0, result.lines

    def test_leaves_no_coverage_marker(self, repo: Repo, stubs: Stubs, tmp_path: Path) -> None:
        backend_ci(repo, stubs, tmp_path)

        assert not (repo.root / ".ci-be-coverage-ready").exists()


class TestTestsAndCoverageOnly:
    """The tests and the coverage gate only: no branch name check and no fast checks."""

    def test_the_branch_name_check_does_not_run(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        result = backend_ci(repo, stubs, tmp_path)

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

        result = backend_ci(repo, stubs, tmp_path, STUB_FAIL="branch")

        assert result.code == 0, result.lines
        assert len([c for c in stubs.calls("podman") if c.args[:1] == ["run"]]) == 1

    def test_no_fast_check_runs(self, repo: Repo, stubs: Stubs, tmp_path: Path) -> None:
        result = backend_ci(repo, stubs, tmp_path)

        assert result.code == 0, result.lines
        assert stubs.calls("scripts/check-text.sh") == []
        assert stubs.calls("scripts/check-orphaned-files.sh") == []
        tools = [c.args[c.args.index("run") + 1] for c in stubs.calls("poetry") if "run" in c.args]
        assert not {"mypy", "black", "ruff"} & set(tools)

    def test_the_container_runs_the_coverage_script(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        backend_ci(repo, stubs, tmp_path)

        runs = [c for c in stubs.calls("podman") if c.args[:1] == ["run"]]
        assert len(runs) == 1
        assert "wave-ci:latest" in runs[0].args
        assert len(stubs.calls("scripts/run-coverage-backend.sh")) == 1

    def test_failing_tests_fail_the_run(self, repo: Repo, stubs: Stubs, tmp_path: Path) -> None:
        result = backend_ci(repo, stubs, tmp_path, STUB_FAIL="pytest")

        assert result.code == 1, result.lines


class TestCoveragePaths:
    """coverage.xml names the clone's backend folder after every run."""

    @pytest.mark.parametrize("fail", ["", "pytest"], ids=["green", "red"])
    def test_container_paths_are_rewritten(
        self, repo: Repo, stubs: Stubs, tmp_path: Path, fail: str
    ) -> None:
        backend_ci(repo, stubs, tmp_path, STUB_FAIL=fail)

        text = (repo.root / "backend" / "coverage.xml").read_text(encoding="utf-8")
        assert CONTAINER_PATH not in text
        assert f"{repo.root}/backend/wavecore/app.py" in text


class TestProgress:
    """A progress line every WAVE_CI_PROGRESS_SECONDS while the tests run."""

    def test_progress_lines_are_printed(self, repo: Repo, stubs: Stubs, tmp_path: Path) -> None:
        result = backend_ci(repo, stubs, tmp_path, WAVE_CI_PROGRESS_SECONDS="1")

        assert result.code == 0, result.lines
        progress = [line for line in result.lines if line.startswith("Progress:")]
        assert progress, result.lines
        for line in progress:
            assert line in STUB_PROGRESS, line

    def test_the_default_interval_prints_nothing_in_a_short_run(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        result = backend_ci(repo, stubs, tmp_path, STUB_PYTEST_PAUSE="0.2")

        assert result.code == 0, result.lines
        assert not [line for line in result.lines if line.startswith("Progress:")]


class TestLog:
    """The log goes to ci-output/ci-backend.log, named at the start and the end."""

    def test_the_log_path_is_printed_at_start_and_end(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        log = repo.root / "ci-output" / "ci-backend.log"

        result = backend_ci(repo, stubs, tmp_path)

        named = [i for i, line in enumerate(result.lines) if line == f"Log: {log}"]
        assert len(log_lines(result, log)) >= 2, result.lines
        assert named[0] < len(result.lines) // 2 < named[-1]
        assert log.is_file()
