"""Tests for scripts/ci-frontend-local.sh with stub tools: tests, coverage, progress and log."""

from pathlib import Path

import pytest

from tests.scripts.script_support import (
    NODE_BODY,
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


# npm and npx that print the test run's stderr from STUB_STDERR before they answer as usual.
NODE_WITH_STDERR = (
    """
if ("test:coverage" in ARGS or "vitest" in " ".join(ARGS)) and os.environ.get("STUB_STDERR"):
    with open(os.environ["STUB_STDERR"], encoding="utf-8") as _stderr:
        sys.stderr.write(_stderr.read())
    sys.stderr.flush()
"""
    + NODE_BODY
)


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
            assert "lint" not in call.args, call.line
            assert "eslint" not in call.line, call.line
            assert "type-check" not in call.args, call.line
            assert "tsc" not in call.args, call.line
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


ACT_UPDATE = [
    "Warning: An update to ProfilesListContainer inside a test was not wrapped in act(...).",
    "",
    "When testing, code that causes React state updates should be wrapped into act(...):",
    "",
    "act(() => {",
    "  /* fire events that update state */",
    "});",
    "/* assert on the output */",
    "",
    "This ensures that you're testing the behavior the user would see in the browser."
    " Learn more at https://react.dev/link/wrap-tests-with-act",
]

SUSPENDED_RESOURCE = [
    "A suspended resource finished loading inside a test, but the event was not wrapped in"
    " act(...).",
    "",
    "When testing, code that resolves suspended data should be wrapped into act(...):",
    "",
    "act(() => {",
    "  /* finish loading suspended data */",
    "});",
    "/* assert on the output */",
    "",
    "This ensures that you're testing the behavior the user would see in the browser."
    " Learn more at https://react.dev/link/wrap-tests-with-act",
]

FLOW_RENDERER_ACT = ["An update to FlowRenderer inside a test was not wrapped in act(...)."]

UNAWAITED_ACT = [
    "A component suspended inside an `act` scope, but the `act` call was not awaited. When"
    " testing React components that depend on asynchronous data, you must await the result:",
]

REACT_KEY_WARNING = ['Each child in a list should have a unique "key" prop.']

NPM_WARN = ["npm WARN config production Use `--omit=dev` instead."]

NODE_EXPERIMENTAL = [
    "(node:41) ExperimentalWarning: SQLite is an experimental feature and might change at any"
    " time",
]

VITEST_LABELS = [
    "stderr | tests/app/history.test.tsx > Browser History Integration > back button",
    "stderr | tests/app/history.test.tsx",
]

NPM_NOTICES = [
    "npm notice run wave-frontend@1.0.0 test:coverage",
    "npm notice New patch version of npm available! 12.2.0 -> 12.2.3",
    "npm notice To update run: npm install -g npm@12.2.3",
]


@pytest.fixture
def loud_stubs(stubs: Stubs) -> Stubs:
    """The stub tools, with npm and npx printing the canned test stderr."""
    stubs.tool("npm", NODE_WITH_STDERR)
    stubs.tool("npx", NODE_WITH_STDERR)
    return stubs


def run_with_stderr(repo: Repo, stubs: Stubs, tmp_path: Path, lines: list[str]) -> Run:
    canned = tmp_path / "vitest-stderr.txt"
    canned.write_text("".join(line + "\n" for line in lines), encoding="utf-8")
    return frontend_ci(repo, stubs, tmp_path, STUB_STDERR=str(canned))


def listed_twice(result: Run, line: str) -> bool:
    """Printed once by the test run and once more in the list of unexpected stderr."""
    return result.lines.count(line) >= 2


class TestStderrGate:
    """Only vitest's `stderr |` label lines and npm's own `npm notice` lines may reach stderr."""

    @pytest.mark.parametrize(
        "lines",
        [
            ACT_UPDATE,
            SUSPENDED_RESOURCE,
            FLOW_RENDERER_ACT,
            UNAWAITED_ACT,
            REACT_KEY_WARNING,
            NPM_WARN,
            NODE_EXPERIMENTAL,
        ],
        ids=[
            "act-state-update",
            "suspended-resource",
            "flow-renderer-act",
            "suspended-in-unawaited-act",
            "react-key-warning",
            "npm-warn",
            "node-experimental-warning",
        ],
    )
    def test_a_warning_fails_the_run_and_is_listed(
        self, repo: Repo, loud_stubs: Stubs, tmp_path: Path, lines: list[str]
    ) -> None:
        result = run_with_stderr(repo, loud_stubs, tmp_path, lines)

        assert result.code == 1, result.lines
        for line in [line for line in lines if line.strip()]:
            assert listed_twice(result, line), (line, result.lines)

    def test_a_warning_after_a_vitest_label_fails_the_run(
        self, repo: Repo, loud_stubs: Stubs, tmp_path: Path
    ) -> None:
        result = run_with_stderr(
            repo, loud_stubs, tmp_path, [VITEST_LABELS[0], *SUSPENDED_RESOURCE]
        )

        assert result.code == 1, result.lines
        assert listed_twice(result, SUSPENDED_RESOURCE[0]), result.lines

    def test_a_warning_among_npm_notices_fails_the_run(
        self, repo: Repo, loud_stubs: Stubs, tmp_path: Path
    ) -> None:
        result = run_with_stderr(repo, loud_stubs, tmp_path, [*NPM_NOTICES, *ACT_UPDATE])

        assert result.code == 1, result.lines
        assert listed_twice(result, ACT_UPDATE[0]), result.lines

    @pytest.mark.parametrize(
        "lines",
        [VITEST_LABELS, NPM_NOTICES, [*NPM_NOTICES, "", *VITEST_LABELS, "  "], []],
        ids=["vitest-labels", "npm-notices", "both-with-blank-lines", "nothing"],
    )
    def test_only_labels_and_npm_notices_pass(
        self, repo: Repo, loud_stubs: Stubs, tmp_path: Path, lines: list[str]
    ) -> None:
        result = run_with_stderr(repo, loud_stubs, tmp_path, lines)

        assert result.code == 0, result.lines
