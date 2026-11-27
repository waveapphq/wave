"""Tests for scripts/gate/12-codeql.sh with a fake CodeQL CLI: changed languages, result and log."""

from pathlib import Path

import pytest

from tests.scripts.gate_support import (
    BAD_OPTION,
    GateContract,
    GateRun,
    copy_gate,
    copy_ignores,
    failed_reason,
    gate_path,
    result_lines,
    with_origin,
)
from tests.scripts.script_support import Call, Repo, Stubs, refuse_shared_temp, run, stub_env

NUMBER = 12
SCRIPT = gate_path(NUMBER)
RELEASE = "release/1.0.0-alpha1"
BRANCH = "fix/1.0.0-alpha1-change"
ALERT_FILE = "backend/wavecore/alert.py"
PYTHON = "python"
SCRIPTING = "javascript-typescript"
ACTIONS = "actions"

# tar: the copy of the working tree breaks off, as on a full disk.
BROKEN_TAR = """
print("tar: write error: No space left on device", file=sys.stderr)
sys.exit(2)
"""

# codeql: a database records its source; the analysis finds one alert when ALERT_FILE is there.
FAKE_CODEQL = """
ALERT = "backend/wavecore/alert.py"
def value(flag):
    for i, arg in enumerate(ARGS):
        if arg.startswith(flag + "="):
            return arg.split("=", 1)[1]
        if arg == flag and i + 1 < len(ARGS):
            return ARGS[i + 1]
    return ""


if ARGS[:1] == ["version"]:
    print("2.25.0")
    sys.exit(0)
if ARGS[:2] == ["database", "create"]:
    db = ARGS[2]
    os.makedirs(db, exist_ok=True)
    with open(os.path.join(db, "source-root"), "w", encoding="utf-8") as handle:
        handle.write(value("--source-root"))
    sys.exit(0)
if ARGS[:2] == ["database", "analyze"]:
    with open(os.path.join(ARGS[2], "source-root"), encoding="utf-8") as handle:
        source = handle.read()
    results = []
    if os.path.exists(os.path.join(source, ALERT)):
        location = {"physicalLocation": {
            "artifactLocation": {"uri": ALERT}, "region": {"startLine": 1}}}
        results.append({
            "ruleId": "py/clear-text-logging-sensitive-data",
            "level": "error",
            "message": {"text": "This logs sensitive data."},
            "locations": [location],
            "partialFingerprints": {"primaryLocationLineHash": "abc:1"},
        })
    with open(value("--output"), "w", encoding="utf-8") as handle:
        json.dump({"runs": [{"results": results}]}, handle)
    sys.exit(0)
sys.exit(0)
"""


@pytest.fixture
def repo(tmp_path: Path) -> Repo:
    tree = Repo(tmp_path / "repo")
    copy_ignores(tree)
    copy_gate(tree, NUMBER)
    tree.write("README.md", ["# Test tree"])
    tree.write("backend/wavecore/app.py", ["VALUE = 1"])
    base = tree.commit()
    with_origin(tree, tmp_path, {"master": base, RELEASE: base})
    tree.checkout(BRANCH)
    return tree


@pytest.fixture
def stubs(tmp_path: Path) -> Stubs:
    tools = Stubs(tmp_path / "stubs")
    tools.tool("codeql", FAKE_CODEQL)
    return tools


def codeql(repo: Repo, stubs: Stubs, tmp_path: Path, *args: str, **extra: str) -> GateRun:
    refuse_shared_temp(repo, SCRIPT)
    env = stub_env(tmp_path, stubs, CODEQL_WORK_DIR=str(tmp_path / "work"), **extra)
    return GateRun(run(repo, [str(repo.root / SCRIPT), *args], env, timeout=50), repo, stubs)


def change(repo: Repo, *rels: str) -> None:
    for rel in rels:
        repo.write(rel, ["// changed"])
    repo.commit()


def scanned_languages(stubs: Stubs) -> set[str]:
    """Every language a CodeQL database was made for."""
    return {language(c) for c in stubs.calls("codeql") if c.args[:2] == ["database", "create"]}


def language(call: Call) -> str:
    for i, arg in enumerate(call.args):
        if arg.startswith("--language="):
            return arg.split("=", 1)[1]
        if arg == "--language" and i + 1 < len(call.args):
            return call.args[i + 1]
    return ""


@pytest.fixture
def passing(repo: Repo, stubs: Stubs, tmp_path: Path) -> GateRun:
    change(repo, "backend/wavecore/app.py")
    return codeql(repo, stubs, tmp_path)


@pytest.fixture
def failing(repo: Repo, stubs: Stubs, tmp_path: Path) -> GateRun:
    change(repo, ALERT_FILE)
    return codeql(repo, stubs, tmp_path)


@pytest.fixture
def usage_error(repo: Repo, stubs: Stubs, tmp_path: Path) -> GateRun:
    change(repo, "backend/wavecore/app.py")
    return codeql(repo, stubs, tmp_path, BAD_OPTION)


class TestResultAndLog(GateContract):
    NUMBER = NUMBER


class TestChangedLanguages:
    """Only the languages whose files the branch changed against its release are scanned."""

    @pytest.mark.parametrize(
        ("files", "languages"),
        [
            (["backend/wavecore/a.py"], {PYTHON}),
            (["backend/tests/test_a.py"], {PYTHON}),
            (["scripts/lib/tool.py"], {PYTHON}),
            (["frontend/src/a.ts"], {SCRIPTING}),
            (["tests/e2e/functional/a/a.spec.ts"], {SCRIPTING}),
            (["scripts/e2e/tool.mjs"], {SCRIPTING}),
            ([".github/scripts/check.cjs"], {SCRIPTING}),
            ([".github/workflows/ci.yml"], {ACTIONS}),
            (["backend/wavecore/a.py", "frontend/src/a.ts"], {PYTHON, SCRIPTING}),
            (
                ["backend/wavecore/a.py", "frontend/src/a.ts", ".github/workflows/ci.yml"],
                {PYTHON, SCRIPTING, ACTIONS},
            ),
        ],
        ids=[
            "backend-code",
            "backend-tests",
            "python-script",
            "frontend",
            "e2e",
            "node-script",
            "workflow-script",
            "workflow",
            "two",
            "three",
        ],
    )
    def test_only_changed_languages_are_scanned(
        self,
        repo: Repo,
        stubs: Stubs,
        tmp_path: Path,
        files: list[str],
        languages: set[str],
    ) -> None:
        change(repo, *files)

        result = codeql(repo, stubs, tmp_path).result

        assert result.code == 0, result.lines
        assert scanned_languages(stubs) == languages

    def test_an_uncommitted_change_counts(self, repo: Repo, stubs: Stubs, tmp_path: Path) -> None:
        change(repo, "backend/wavecore/app.py")
        repo.write("frontend/src/new.ts", ["export const a = 1"])

        codeql(repo, stubs, tmp_path)

        assert scanned_languages(stubs) == {PYTHON, SCRIPTING}


class TestNewAlerts:
    """An alert the release branch does not have fails the check and is listed."""

    def test_the_new_alert_is_listed(self, failing: GateRun) -> None:
        listed = [line for line in failing.result.lines if ALERT_FILE in line]

        assert listed, failing.result.lines


class TestSetupErrors:
    """No CodeQL CLI, a detached HEAD or a failed copy of the tree stop the check unscanned."""

    def test_no_codeql_cli_exits_2(self, repo: Repo, stubs: Stubs, tmp_path: Path) -> None:
        change(repo, "backend/wavecore/app.py")

        result = codeql(repo, stubs, tmp_path, CODEQL=str(tmp_path / "no-codeql")).result

        assert result.code == 2, result.lines

    def test_a_detached_head_exits_2(self, repo: Repo, stubs: Stubs, tmp_path: Path) -> None:
        change(repo, "backend/wavecore/app.py")
        repo.detach()

        result = codeql(repo, stubs, tmp_path).result

        assert result.code == 2, result.lines
        assert scanned_languages(stubs) == set()

    def test_a_failed_copy_of_the_working_tree_exits_2(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        change(repo, "backend/wavecore/app.py")
        stubs.tool("tar", BROKEN_TAR)

        result = codeql(repo, stubs, tmp_path).result

        assert result.code == 2, result.lines
        assert len(result_lines(result, NUMBER)) == 1, result.lines
        assert failed_reason(result, NUMBER), result.lines

    def test_a_failed_copy_of_the_working_tree_scans_nothing(
        self, repo: Repo, stubs: Stubs, tmp_path: Path
    ) -> None:
        change(repo, "backend/wavecore/app.py")
        stubs.tool("tar", BROKEN_TAR)

        codeql(repo, stubs, tmp_path)

        assert scanned_languages(stubs) == set()
