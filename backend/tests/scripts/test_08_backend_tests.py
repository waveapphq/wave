"""Tests for scripts/gate/08-backend-tests.sh with stub tools: tests, coverage, progress and log."""

import shutil
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
    log_paths,
)
from tests.scripts.script_support import (
    Repo,
    Run,
    Stubs,
    file_lines,
    refuse_shared_temp,
    run,
    stub_env,
    terminated,
)

NUMBER = 8
SCRIPT = gate_path(NUMBER)
COVERAGE = "scripts/lib/run-coverage-backend.sh"
SONAR_ENV = "scripts/lib/sonar-env.sh"
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
root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
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

# The other gate scripts this one must not run.
HELPERS = {
    gate_path(1): "branch",
    gate_path(2): "text",
    gate_path(3): "orphans",
    gate_path(4): "static",
    gate_path(10): "sonar",
}


@pytest.fixture
def repo(tmp_path: Path) -> Repo:
    tree = Repo(tmp_path / "repo")
    copy_ignores(tree)
    copy_gate(tree, NUMBER)
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
    tools.sourced(repo, SONAR_ENV)
    tools.script(repo, COVERAGE, RUN_COVERAGE)
    return tools


def backend_ci(repo: Repo, stubs: Stubs, tmp_path: Path, *args: str, **extra: str) -> Run:
    refuse_shared_temp(repo, SCRIPT)
    env = stub_env(tmp_path, stubs, **extra)
    return run(repo, [str(repo.root / SCRIPT), *args], env, timeout=50)


@pytest.fixture
def passing(repo: Repo, stubs: Stubs, tmp_path: Path) -> GateRun:
    return GateRun(backend_ci(repo, stubs, tmp_path), repo, stubs)


@pytest.fixture
def failing(repo: Repo, stubs: Stubs, tmp_path: Path) -> GateRun:
    return GateRun(backend_ci(repo, stubs, tmp_path, STUB_FAIL="pytest"), repo, stubs)


@pytest.fixture
def usage_error(repo: Repo, stubs: Stubs, tmp_path: Path) -> GateRun:
    return GateRun(backend_ci(repo, stubs, tmp_path, BAD_OPTION), repo, stubs)


@pytest.fixture
def inside(repo: Repo, stubs: Stubs, tmp_path: Path) -> GateRun:
    return GateRun(backend_ci(repo, stubs, tmp_path, **{IN_CONTAINER: "1"}), repo, stubs)


@pytest.fixture
def no_image(repo: Repo, stubs: Stubs, tmp_path: Path) -> GateRun:
    stubs.tool("podman", PODMAN_WITHOUT_IMAGE)
    return GateRun(backend_ci(repo, stubs, tmp_path), repo, stubs)


class TestResultAndLog(GateContract):
    NUMBER = NUMBER


class TestWhereItRuns(ContainerContract):
    NUMBER = NUMBER

    def test_inside_the_container_the_coverage_script_runs_directly(self, inside: GateRun) -> None:
        assert len(inside.stubs.calls(COVERAGE)) == 1, inside.stubs.calls()


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
        assert stubs.calls(gate_path(10)) == []
        assert stubs.calls(SONAR_ENV) == []

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
        assert stubs.calls(gate_path(1)) == []

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
        assert stubs.calls(gate_path(2)) == []
        assert stubs.calls(gate_path(3)) == []
        assert stubs.calls(gate_path(4)) == []
        tools = [c.args[c.args.index("run") + 1] for c in stubs.calls("poetry") if "run" in c.args]
        assert not {"mypy", "black", "ruff"} & set(tools)

    def test_the_container_runs_the_coverage_script(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        backend_ci(repo, stubs, tmp_path)

        runs = [c for c in stubs.calls("podman") if c.args[:1] == ["run"]]
        assert len(runs) == 1
        assert "wave-ci:latest" in runs[0].args
        assert len(stubs.calls(COVERAGE)) == 1

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
    """pytest's own percentage as Progress lines, one each time the number changes."""

    def test_progress_lines_are_printed(self, repo: Repo, stubs: Stubs, tmp_path: Path) -> None:
        result = backend_ci(repo, stubs, tmp_path)

        assert result.code == 0, result.lines
        progress = [line for line in result.lines if line.startswith("Progress:")]
        assert progress, result.lines
        for line in progress:
            assert line in STUB_PROGRESS, line

    def test_each_percentage_shows_once_in_order(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        result = backend_ci(repo, stubs, tmp_path)

        progress = [line for line in result.lines if line.startswith("Progress:")]
        assert progress == sorted(set(progress), key=lambda line: int(line[10:-1])), progress

    def test_no_row_of_dots_reaches_the_screen(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        result = backend_ci(repo, stubs, tmp_path)

        assert not [line for line in result.lines if line.rstrip().endswith("%]")], result.lines


def logged_lines(result: Run) -> list[str]:
    """The lines of the log the run named, or none when it named no log."""
    paths = log_paths(result)
    return file_lines(Path(paths[0])) if paths else []


# A green run, a short green run and a red run.
STOP_CASES = [
    {},
    {"STUB_PYTEST_PAUSE": "0.2"},
    {"STUB_FAIL": "pytest"},
]
STOP_IDS = ["green", "short-run", "failing-tests"]

# The real pkill, then a pause: a shell that reports a killed job always has time to print it,
# as on a busy machine, so the report shows up on every run and not only when the race is lost.
REAL_PKILL = shutil.which("pkill")
SLOW_PKILL = f"""
real = {REAL_PKILL!r}
code = subprocess.run([real, *ARGS], check=False).returncode if real else 127
time.sleep(0.3)
sys.exit(code)
"""


class TestProgressLoopStops:
    """Stopping the progress loop prints no shell job report such as a bare Terminated line."""

    @pytest.mark.parametrize("extra", STOP_CASES, ids=STOP_IDS)
    def test_no_terminated_line_is_printed_or_logged(
        self, repo: Repo, stubs: Stubs, tmp_path: Path, extra: dict[str, str]
    ) -> None:
        stubs.tool("pkill", SLOW_PKILL)

        result = backend_ci(repo, stubs, tmp_path, **extra)

        logged = logged_lines(result)
        assert terminated(result.lines + logged) == []
