"""Tests for scripts/check-exclusions.py, run from the clone on a git work tree in tmp_path."""

import json
import socket
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest

from tests.scripts.exclusions_support import (
    ALERTS_PATH,
    ANALYSES_PATH,
    BACKEND_KEY,
    BRANCHES_PATH,
    CATEGORIES,
    CODEQL_LIST,
    FRONTEND_KEY,
    ISSUES_PATH,
    SONAR_LIST,
    FakeServices,
    Repo,
    Result,
    codeql_alert,
    codeql_list,
    cql_id,
    run_script,
    script_env,
    sonar_list,
    sonar_mark,
    sq_id,
    start_services,
)

SQ_A = sq_id("TEST-001")
SQ_B = sq_id("TEST-002")
SQ_C = sq_id("TEST-003")
SQ_UNKNOWN = sq_id("TEST-009")
CQL_A = cql_id("TEST-001")
CQL_B = cql_id("TEST-002")
CQL_C = cql_id("TEST-003")
CQL_UNKNOWN = cql_id("TEST-009")

HASH_FILE = "backend/wavecore/hashing.py"
PROXY_FILE = "frontend/src/proxy.ts"
LOGS_FILE = "backend/wavecore/logs.py"
PARSE_FILE = "frontend/src/parse.ts"
LOG_RULE = "py/clear-text-logging-sensitive-data"
XSS_RULE = "js/xss-through-dom"
RELEASE = "release/1.0.0-alpha62"
FIX_BRANCH = "fix/1.0.0-alpha62-exclusion-checks"
HEAD_SHA = "a" * 40
MERGE_SHA = "b" * 40
PUSH_SHA = "c" * 40

USAGE = "Usage: scripts/check-exclusions.py --sonarqube or --codeql"


@pytest.fixture
def services() -> Iterator[FakeServices]:
    fake, server = start_services()
    yield fake
    server.shutdown()
    server.server_close()


@pytest.fixture
def repo(tmp_path: Path) -> Repo:
    return Repo(tmp_path / "repo")


@pytest.fixture
def home(tmp_path: Path) -> Path:
    return tmp_path / "home"


def assert_output(result: Result, code: int, failures: list[str], summary: str) -> None:
    """Exit code, the failure lines in any order, and the summary as the last line."""
    assert result.code == code, result.all_lines
    assert result.stdout, result.stderr
    assert result.stdout[-1] == summary
    assert sorted(result.stdout[:-1]) == sorted(failures)


def assert_exit_2(result: Result, text: str) -> None:
    """An exit 2 error prints its text as one whole line."""
    assert result.code == 2, result.all_lines
    assert text in result.all_lines


# SonarQube part: the tree, the list and the marks


def write_sonar_tree(repo: Repo, entries: list[tuple[str, str | None]] | None = None) -> None:
    """Two places: SQ_A in the backend, SQ_B in the frontend."""
    repo.write(
        HASH_FILE,
        [
            "import hashlib",
            "",
            "def digest(data: bytes) -> str:",
            f"    # SonarQube exclusion: {SQ_A}",
            "    return hashlib.sha1(data).hexdigest()",
        ],
    )
    repo.write(
        PROXY_FILE,
        [
            "export function proxyUrl(host: string): string {",
            f"  // SonarQube exclusion: {SQ_B}",
            "  return `http://${host}:3128`;",
            "}",
        ],
    )
    repo.write(
        SONAR_LIST,
        sonar_list(
            entries if entries is not None else [(SQ_A, "python:S4790"), (SQ_B, "typescript:S5332")]
        ),
    )
    repo.write(CODEQL_LIST, codeql_list([]))


def hash_mark(
    repo: Repo,
    *,
    comments: list[str] | None = None,
    text: str | None = None,
    project: str | None = None,
    reported_line: int | None = None,
) -> dict[str, Any]:
    """The mark of SQ_A's flagged line in the backend."""
    return sonar_mark(
        repo,
        HASH_FILE,
        5,
        "python:S4790",
        [f"{SQ_A} The protocol sets this hash."] if comments is None else comments,
        text=text,
        project=project,
        reported_line=reported_line,
    )


def proxy_mark(repo: Repo) -> dict[str, Any]:
    return sonar_mark(repo, PROXY_FILE, 3, "typescript:S5332", [f"{SQ_B} A proxy address."])


def master_marks(
    services: FakeServices, *backend: dict[str, Any], frontend: list[dict[str, Any]] | None = None
) -> None:
    services.add_marks(BACKEND_KEY, "branch", "master", *backend)
    services.add_marks(FRONTEND_KEY, "branch", "master", *(frontend or []))


def sonar_base(repo: Repo, services: FakeServices) -> None:
    write_sonar_tree(repo)
    repo.commit()
    master_marks(services, hash_mark(repo), frontend=[proxy_mark(repo)])


ALL_MATCH_MASTER = "SonarQube exclusions: 2 entries, 2 ID comments and 2 marks match on master."


class TestSonarQubeChecks:
    """The SonarQube checks, each mismatch with its exact line."""

    def test_all_match_prints_the_summary_and_exits_0(
        self, repo: Repo, services: FakeServices, home: Path
    ) -> None:
        sonar_base(repo, services)

        result = run_script(repo, script_env(home, services), "--sonarqube")

        assert_output(result, 0, [], ALL_MATCH_MASTER)

    def test_one_of_each_uses_the_singular(
        self, repo: Repo, services: FakeServices, home: Path
    ) -> None:
        write_sonar_tree(repo, [(SQ_A, "python:S4790")])
        (repo.root / PROXY_FILE).unlink()
        repo.commit()
        master_marks(services, hash_mark(repo))

        result = run_script(repo, script_env(home, services), "--sonarqube")

        assert_output(
            result,
            0,
            [],
            "SonarQube exclusions: 1 entry, 1 ID comment and 1 mark match on master.",
        )

    def test_reads_false_positive_marks_with_comments_of_both_projects(
        self, repo: Repo, services: FakeServices, home: Path
    ) -> None:
        sonar_base(repo, services)

        run_script(repo, script_env(home, services), "--sonarqube")

        searches = services.requests_to(ISSUES_PATH)
        assert {r.query["componentKeys"] for r in searches} == {BACKEND_KEY, FRONTEND_KEY}
        for request in searches:
            assert request.query["issueStatuses"] == "FALSE_POSITIVE"
            assert request.query["additionalFields"] == "comments"
            assert request.query["ps"] == "500"
            assert request.query["p"] == "1"

    def test_an_entry_no_code_carries(self, repo: Repo, services: FakeServices, home: Path) -> None:
        write_sonar_tree(
            repo, [(SQ_A, "python:S4790"), (SQ_B, "typescript:S5332"), (SQ_C, "python:S5332")]
        )
        repo.commit()
        master_marks(services, hash_mark(repo), frontend=[proxy_mark(repo)])

        result = run_script(repo, script_env(home, services), "--sonarqube")

        assert_output(
            result,
            1,
            [
                f"{SQ_C}: no code carries this ID. Add the comment above the flagged line,"
                " or remove the entry from tests/exclusions/sonarqube-cloud.md."
            ],
            "SonarQube exclusions: 1 mismatch on master.",
        )

    @pytest.mark.parametrize(
        ("path", "marker"),
        [
            ("backend/wavecore/extra.py", "#"),
            ("frontend/src/extra.ts", "//"),
            ("frontend/src/extra.tsx", "//"),
            ("frontend/src/extra.js", "//"),
            ("frontend/scripts/extra.mjs", "//"),
        ],
    )
    def test_an_id_comment_naming_no_entry(
        self, repo: Repo, services: FakeServices, home: Path, path: str, marker: str
    ) -> None:
        write_sonar_tree(repo)
        repo.write(
            path, ["const_value = 1", f"{marker} SonarQube exclusion: {SQ_UNKNOWN}", "x = 2"]
        )
        repo.commit()
        master_marks(services, hash_mark(repo), frontend=[proxy_mark(repo)])

        result = run_script(repo, script_env(home, services), "--sonarqube")

        assert_output(
            result,
            1,
            [
                f"{path}:2: {SQ_UNKNOWN} has no entry in tests/exclusions/sonarqube-cloud.md."
                " Add the entry, or remove the comment."
            ],
            "SonarQube exclusions: 1 mismatch on master.",
        )

    def test_a_commented_line_with_no_mark(
        self, repo: Repo, services: FakeServices, home: Path
    ) -> None:
        write_sonar_tree(repo)
        repo.write(
            "backend/wavecore/second.py",
            ["import hashlib", f"# SonarQube exclusion: {SQ_A}", "KEY = hashlib.sha1(b'k')"],
        )
        repo.commit()
        master_marks(services, hash_mark(repo), frontend=[proxy_mark(repo)])

        result = run_script(repo, script_env(home, services), "--sonarqube")

        assert_output(
            result,
            1,
            [
                "backend/wavecore/second.py:3: python:S4790 is not marked false positive on master."
                f" Mark it in SonarQube Cloud with a comment that starts with {SQ_A}."
            ],
            "SonarQube exclusions: 1 mismatch on master.",
        )

    def test_a_mark_with_no_commented_line(
        self, repo: Repo, services: FakeServices, home: Path
    ) -> None:
        write_sonar_tree(repo)
        repo.commit()
        stray = sonar_mark(repo, PROXY_FILE, 1, "typescript:S1234", ["A stray mark."])
        master_marks(services, hash_mark(repo), frontend=[proxy_mark(repo), stray])

        result = run_script(repo, script_env(home, services), "--sonarqube")

        assert_output(
            result,
            1,
            [
                "frontend/src/proxy.ts:1: typescript:S1234 is marked false positive on master"
                " but has no matching SonarQube exclusion comment. Add the comment and the entry,"
                " or reopen the issue."
            ],
            "SonarQube exclusions: 1 mismatch on master.",
        )

    def test_a_mark_whose_line_hash_differs_matches_nothing(
        self, repo: Repo, services: FakeServices, home: Path
    ) -> None:
        write_sonar_tree(repo)
        repo.commit()
        stale = hash_mark(repo, text="    return hashlib.sha1(old_data).hexdigest()")
        master_marks(services, stale, frontend=[proxy_mark(repo)])

        result = run_script(repo, script_env(home, services), "--sonarqube")

        assert_output(
            result,
            1,
            [
                f"{HASH_FILE}:5: python:S4790 is not marked false positive on master."
                f" Mark it in SonarQube Cloud with a comment that starts with {SQ_A}.",
                f"{HASH_FILE}:5: python:S4790 is marked false positive on master"
                " but has no matching SonarQube exclusion comment. Add the comment and the entry,"
                " or reopen the issue.",
            ],
            "SonarQube exclusions: 2 mismatches on master.",
        )

    def test_a_mark_of_another_rule_matches_nothing(
        self, repo: Repo, services: FakeServices, home: Path
    ) -> None:
        write_sonar_tree(repo)
        repo.commit()
        other_rule = sonar_mark(repo, HASH_FILE, 5, "python:S9999", [f"{SQ_A} Wrong rule."])
        master_marks(services, other_rule, frontend=[proxy_mark(repo)])

        result = run_script(repo, script_env(home, services), "--sonarqube")

        assert_output(
            result,
            1,
            [
                f"{HASH_FILE}:5: python:S4790 is not marked false positive on master."
                f" Mark it in SonarQube Cloud with a comment that starts with {SQ_A}.",
                f"{HASH_FILE}:5: python:S9999 is marked false positive on master"
                " but has no matching SonarQube exclusion comment. Add the comment and the entry,"
                " or reopen the issue.",
            ],
            "SonarQube exclusions: 2 mismatches on master.",
        )

    def test_a_mark_of_the_other_project_matches_nothing(
        self, repo: Repo, services: FakeServices, home: Path
    ) -> None:
        write_sonar_tree(repo)
        repo.commit()
        wrong_project = hash_mark(repo, project=FRONTEND_KEY)
        master_marks(services, frontend=[proxy_mark(repo), wrong_project])

        result = run_script(repo, script_env(home, services), "--sonarqube")

        assert_output(
            result,
            1,
            [
                f"{HASH_FILE}:5: python:S4790 is not marked false positive on master."
                f" Mark it in SonarQube Cloud with a comment that starts with {SQ_A}.",
                "frontend/wavecore/hashing.py:5: python:S4790 is marked false positive on master"
                " but has no matching SonarQube exclusion comment. Add the comment and the entry,"
                " or reopen the issue.",
            ],
            "SonarQube exclusions: 2 mismatches on master.",
        )

    def test_a_mark_on_a_shifted_line_matches_by_hash(
        self, repo: Repo, services: FakeServices, home: Path
    ) -> None:
        write_sonar_tree(repo)
        repo.commit()
        master_marks(services, hash_mark(repo, reported_line=41), frontend=[proxy_mark(repo)])

        result = run_script(repo, script_env(home, services), "--sonarqube")

        assert_output(result, 0, [], ALL_MATCH_MASTER)

    @pytest.mark.parametrize(
        "comments",
        [
            [f"The protocol sets this hash, see {SQ_A}."],
            [],
            ["Marked before the entry existed.", f"{SQ_A} The protocol sets this hash."],
            [f"{SQ_B} The wrong entry."],
        ],
        ids=["id-not-first", "no-comment", "only-a-later-comment-starts-right", "other-id"],
    )
    def test_a_matched_mark_whose_first_comment_does_not_start_with_its_id(
        self, repo: Repo, services: FakeServices, home: Path, comments: list[str]
    ) -> None:
        write_sonar_tree(repo)
        repo.commit()
        master_marks(services, hash_mark(repo, comments=comments), frontend=[proxy_mark(repo)])

        result = run_script(repo, script_env(home, services), "--sonarqube")

        assert_output(
            result,
            1,
            [
                f"{HASH_FILE}:5: the false positive mark on master does not start with {SQ_A}."
                " Edit the mark's comment."
            ],
            "SonarQube exclusions: 1 mismatch on master.",
        )


class TestSonarQubeCommentPlaces:
    """Only ID comments in tracked code files under backend/ and frontend/ count."""

    @pytest.mark.parametrize(
        ("path", "line", "track"),
        [
            ("backend/README.md", "# SonarQube exclusion: {id}", True),
            ("frontend/docs/notes.md", "// SonarQube exclusion: {id}", True),
            ("backend/tests/scripts/test_tool.py", "# SonarQube exclusion: {id}", True),
            ("backend/wavecore/draft.py", "# SonarQube exclusion: {id}", False),
            ("scripts/tool.py", "# SonarQube exclusion: {id}", True),
            ("tests/e2e/spec.ts", "// SonarQube exclusion: {id}", True),
            ("backend/run.sh", "# SonarQube exclusion: {id}", True),
            ("frontend/src/theme.css", "// SonarQube exclusion: {id}", True),
            ("backend/wavecore/note.py", "# SonarQube exclusion: {id} and more words", True),
            ("backend/wavecore/inline.py", "x = 1  # SonarQube exclusion: {id}", True),
        ],
        ids=[
            "markdown-backend",
            "markdown-frontend",
            "script-tests",
            "untracked",
            "outside-backend-and-frontend",
            "e2e",
            "shell",
            "css",
            "trailing-text",
            "after-code",
        ],
    )
    def test_a_comment_the_check_does_not_read_carries_no_entry(
        self,
        repo: Repo,
        services: FakeServices,
        home: Path,
        path: str,
        line: str,
        track: bool,
    ) -> None:
        write_sonar_tree(
            repo, [(SQ_A, "python:S4790"), (SQ_B, "typescript:S5332"), (SQ_C, "python:S4790")]
        )
        if track:
            repo.write(path, [line.format(id=SQ_C), "value = hashlib.sha1(b'v')"])
        repo.commit()
        if not track:
            repo.write(path, [line.format(id=SQ_C), "value = hashlib.sha1(b'v')"])
        master_marks(services, hash_mark(repo), frontend=[proxy_mark(repo)])

        result = run_script(repo, script_env(home, services), "--sonarqube")

        assert_output(
            result,
            1,
            [
                f"{SQ_C}: no code carries this ID. Add the comment above the flagged line,"
                " or remove the entry from tests/exclusions/sonarqube-cloud.md."
            ],
            "SonarQube exclusions: 1 mismatch on master.",
        )


# Target selection


@dataclass
class Context:
    """Where the script runs: the environment, the checkout and what each part reads."""

    name: str
    branch: str | None
    ci: dict[str, str]
    sonar_reads: set[tuple[str, str]]
    sonar_target: str
    listed: bool
    codeql_ref: str
    codeql_sha: str | None


def pr_env(event_path: str) -> dict[str, str]:
    return {
        "GITHUB_ACTIONS": "true",
        "GITHUB_EVENT_NAME": "pull_request",
        "GITHUB_REF": "refs/pull/95/merge",
        "GITHUB_BASE_REF": RELEASE,
        "GITHUB_HEAD_REF": FIX_BRANCH,
        "GITHUB_SHA": MERGE_SHA,
        "GITHUB_EVENT_PATH": event_path,
    }


PUSH_ENV = {
    "GITHUB_ACTIONS": "true",
    "GITHUB_EVENT_NAME": "push",
    "GITHUB_REF": f"refs/heads/{RELEASE}",
    "GITHUB_REF_NAME": RELEASE,
    "GITHUB_SHA": PUSH_SHA,
}

CONTEXTS = [
    Context(
        "ci-pull-request",
        None,
        {"pr": "1"},
        {("branch", RELEASE), ("pullRequest", "95")},
        f"pull request 95 and {RELEASE}",
        False,
        "refs/pull/95/head",
        HEAD_SHA,
    ),
    Context(
        "ci-push",
        None,
        PUSH_ENV,
        {("branch", RELEASE)},
        RELEASE,
        False,
        f"refs/heads/{RELEASE}",
        PUSH_SHA,
    ),
    Context(
        "local-fix-listed",
        FIX_BRANCH,
        {},
        {("branch", RELEASE), ("branch", FIX_BRANCH)},
        f"{FIX_BRANCH} and {RELEASE}",
        True,
        f"refs/heads/{RELEASE}",
        None,
    ),
    Context(
        "local-fix-not-listed",
        FIX_BRANCH,
        {},
        {("branch", RELEASE)},
        RELEASE,
        False,
        f"refs/heads/{RELEASE}",
        None,
    ),
    Context(
        "local-feature",
        "feature/1.2.0-batch-runs",
        {},
        {("branch", "release/1.2.0")},
        "release/1.2.0",
        False,
        "refs/heads/release/1.2.0",
        None,
    ),
    Context(
        "local-master",
        "master",
        {},
        {("branch", "master")},
        "master",
        False,
        "refs/heads/master",
        None,
    ),
    Context(
        "local-release",
        RELEASE,
        {},
        {("branch", RELEASE)},
        RELEASE,
        False,
        f"refs/heads/{RELEASE}",
        None,
    ),
]


def context_env(
    context: Context, tmp_path: Path, home: Path, services: FakeServices
) -> dict[str, str]:
    if context.ci.get("pr"):
        event = tmp_path / "event.json"
        event.write_text(json.dumps({"pull_request": {"number": 95, "head": {"sha": HEAD_SHA}}}))
        ci = pr_env(str(event))
    else:
        ci = dict(context.ci)
    return script_env(home, services, GH_TOKEN="test-token", **ci)


def place(repo: Repo, context: Context) -> None:
    if context.branch is None:
        repo.detach()
    elif context.branch != "master":
        repo.checkout(context.branch)


class TestTargetSelection:
    """What each part reads, by context."""

    @pytest.mark.parametrize("context", CONTEXTS, ids=[c.name for c in CONTEXTS])
    def test_sonarqube_reads_the_marks_of_its_context(
        self, repo: Repo, services: FakeServices, home: Path, tmp_path: Path, context: Context
    ) -> None:
        write_sonar_tree(repo)
        repo.commit()
        place(repo, context)
        reads = sorted(context.sonar_reads)
        first, last = reads[0], reads[-1]
        services.add_marks(BACKEND_KEY, first[0], first[1], hash_mark(repo))
        services.add_marks(FRONTEND_KEY, last[0], last[1], proxy_mark(repo))
        if context.listed:
            services.sonar_branches = {
                BACKEND_KEY: ["master", RELEASE, FIX_BRANCH],
                FRONTEND_KEY: ["master", RELEASE, FIX_BRANCH],
            }
        else:
            services.sonar_branches = {
                BACKEND_KEY: ["master", RELEASE],
                FRONTEND_KEY: ["master", RELEASE],
            }

        result = run_script(repo, context_env(context, tmp_path, home, services), "--sonarqube")

        assert_output(
            result,
            0,
            [],
            "SonarQube exclusions: 2 entries, 2 ID comments and 2 marks match on"
            f" {context.sonar_target}.",
        )
        read = {
            (r.query["componentKeys"], "pullRequest" if "pullRequest" in r.query else "branch")
            + (r.query.get("pullRequest") or r.query.get("branch", ""),)
            for r in services.requests_to(ISSUES_PATH)
        }
        assert read == {
            (key, kind, value)
            for key in (BACKEND_KEY, FRONTEND_KEY)
            for kind, value in context.sonar_reads
        }

    @pytest.mark.parametrize("context", CONTEXTS, ids=[c.name for c in CONTEXTS])
    def test_codeql_reads_the_alerts_of_its_ref(
        self, repo: Repo, services: FakeServices, home: Path, tmp_path: Path, context: Context
    ) -> None:
        write_codeql_tree(repo)
        repo.commit()
        place(repo, context)
        services.alerts = {context.codeql_ref: base_alerts()}
        if context.codeql_sha is not None:
            services.analyses_for(context.codeql_ref, context.codeql_sha)

        result = run_script(repo, context_env(context, tmp_path, home, services), "--codeql")

        assert_output(
            result,
            0,
            [],
            "CodeQL exclusions: 2 entries, 3 alerts and 3 ID comments match on"
            f" {context.codeql_ref}.",
        )
        alert_reads = services.requests_to(ALERTS_PATH)
        assert {r.query["ref"] for r in alert_reads} == {context.codeql_ref}
        assert {r.query["state"] for r in alert_reads} == {"open", "dismissed", "fixed"}
        for request in alert_reads:
            assert request.query["tool_name"] == "CodeQL"
            assert request.query["per_page"] == "100"

    def test_a_local_fix_branch_asks_cloud_which_branches_it_lists(
        self, repo: Repo, services: FakeServices, home: Path
    ) -> None:
        write_sonar_tree(repo)
        repo.commit()
        repo.checkout(FIX_BRANCH)
        services.add_marks(BACKEND_KEY, "branch", RELEASE, hash_mark(repo))
        services.add_marks(FRONTEND_KEY, "branch", RELEASE, proxy_mark(repo))

        run_script(repo, script_env(home, services), "--sonarqube")

        asked = {r.query["project"] for r in services.requests_to(BRANCHES_PATH)}
        assert asked
        assert asked <= {BACKEND_KEY, FRONTEND_KEY}

    @pytest.mark.parametrize(
        ("flag", "part"), [("--sonarqube", "SonarQube"), ("--codeql", "CodeQL")]
    )
    @pytest.mark.parametrize(
        ("branch", "shown"),
        [(None, "HEAD"), ("chore/cleanup", "chore/cleanup"), ("fix/no-version", "fix/no-version")],
        ids=["detached", "unknown", "fix-without-version"],
    )
    def test_a_local_branch_it_cannot_place_exits_2(
        self,
        repo: Repo,
        services: FakeServices,
        home: Path,
        flag: str,
        part: str,
        branch: str | None,
        shown: str,
    ) -> None:
        write_sonar_tree(repo)
        repo.commit()
        if branch is None:
            repo.detach()
        else:
            repo.checkout(branch)

        result = run_script(repo, script_env(home, services, GH_TOKEN="test-token"), flag)

        assert_exit_2(
            result,
            f"{part} exclusions: cannot tell what to check on {shown}."
            " Check out master, a release branch, or a fix or feature branch.",
        )
        assert services.requests_to(ISSUES_PATH) == []
        assert services.requests_to(ALERTS_PATH) == []


# CodeQL part: the tree, the list and the alerts


def write_codeql_tree(
    repo: Repo,
    entries: list[tuple[str, str | None]] | None = None,
    extra: list[str] | None = None,
) -> None:
    """CQL_A carried twice in the backend (alerts 1 and 2), CQL_B once in the frontend (alert 5)."""
    repo.write(
        LOGS_FILE,
        [
            "import logging",
            "",
            "logger = logging.getLogger(__name__)",
            f"# CodeQL exclusion: {CQL_A}",
            "logger.info('saved %s', name)",
            f"# CodeQL exclusion: {CQL_A}",
            "logger.info('loaded %s', name)",
        ],
    )
    repo.write(
        PARSE_FILE,
        [
            f"// CodeQL exclusion: {CQL_B}",
            "const doc = new DOMParser().parseFromString(text, 'text/html');",
        ],
    )
    repo.write(
        CODEQL_LIST,
        codeql_list(entries if entries is not None else [(CQL_A, "1 to 2"), (CQL_B, "5")], extra),
    )
    repo.write(SONAR_LIST, sonar_list([]))


def base_alerts() -> list[dict[str, object]]:
    return [
        codeql_alert(1, "dismissed", LOG_RULE, LOGS_FILE, 5),
        codeql_alert(2, "dismissed", LOG_RULE, LOGS_FILE, 7),
        codeql_alert(5, "dismissed", XSS_RULE, PARSE_FILE, 2),
    ]


MASTER_REF = "refs/heads/master"
CODEQL_ALL_MATCH = (
    "CodeQL exclusions: 2 entries, 3 alerts and 3 ID comments match on refs/heads/master."
)


def run_codeql(repo: Repo, services: FakeServices, home: Path, **extra: str) -> Result:
    env = {"GH_TOKEN": "test-token", **extra}
    return run_script(repo, script_env(home, services, **env), "--codeql")


class TestCodeQLChecks:
    """The CodeQL checks, each mismatch with its exact line."""

    def test_all_match_prints_the_summary_and_exits_0(
        self, repo: Repo, services: FakeServices, home: Path
    ) -> None:
        write_codeql_tree(repo)
        repo.commit()
        services.alerts = {MASTER_REF: base_alerts()}

        result = run_codeql(repo, services, home)

        assert_output(result, 0, [], CODEQL_ALL_MATCH)

    def test_one_of_each_uses_the_singular(
        self, repo: Repo, services: FakeServices, home: Path
    ) -> None:
        write_codeql_tree(repo, [(CQL_B, "5")])
        (repo.root / LOGS_FILE).unlink()
        repo.commit()
        services.alerts = {MASTER_REF: [codeql_alert(5, "dismissed", XSS_RULE, PARSE_FILE, 2)]}

        result = run_codeql(repo, services, home)

        assert_output(
            result,
            0,
            [],
            "CodeQL exclusions: 1 entry, 1 alert and 1 ID comment match on refs/heads/master.",
        )

    def test_a_dismissed_alert_no_entry_lists(
        self, repo: Repo, services: FakeServices, home: Path
    ) -> None:
        write_codeql_tree(repo)
        repo.commit()
        unlisted = codeql_alert(9, "dismissed", "py/path-injection", LOGS_FILE, 3)
        services.alerts = {MASTER_REF: [*base_alerts(), unlisted]}

        result = run_codeql(repo, services, home)

        assert_output(
            result,
            1,
            [
                "Alert 9 (py/path-injection) is dismissed but no entry lists it."
                " Add it to an entry in tests/exclusions/codeql.md, or reopen the alert."
            ],
            "CodeQL exclusions: 1 mismatch on refs/heads/master.",
        )

    def test_an_alert_listed_by_two_entries(
        self, repo: Repo, services: FakeServices, home: Path
    ) -> None:
        write_codeql_tree(repo, [(CQL_A, "1 to 2"), (CQL_B, "5"), (CQL_C, "2")])
        repo.write("backend/wavecore/other.py", [f"# CodeQL exclusion: {CQL_C}", "print(name)"])
        repo.commit()
        services.alerts = {MASTER_REF: base_alerts()}

        result = run_codeql(repo, services, home)

        assert result.code == 1, result.all_lines
        assert f"Alert 2 is listed by {CQL_A} and {CQL_C}. Keep it in one entry." in result.stdout
        assert result.stdout[-1].startswith("CodeQL exclusions: ")
        assert result.stdout[-1].endswith(" on refs/heads/master.")

    def test_a_listed_alert_that_is_open(
        self, repo: Repo, services: FakeServices, home: Path
    ) -> None:
        write_codeql_tree(repo, [(CQL_A, "1 to 3"), (CQL_B, "5")])
        repo.commit()
        services.alerts = {
            MASTER_REF: [*base_alerts(), codeql_alert(3, "open", LOG_RULE, LOGS_FILE, 3)]
        }

        result = run_codeql(repo, services, home)

        assert_output(
            result,
            1,
            [
                f"{CQL_A}: alert 3 (py/clear-text-logging-sensitive-data) is open on"
                " refs/heads/master. Fix the code, or dismiss the alert."
            ],
            "CodeQL exclusions: 1 mismatch on refs/heads/master.",
        )

    def test_a_listed_alert_that_is_fixed_is_no_failure(
        self, repo: Repo, services: FakeServices, home: Path
    ) -> None:
        write_codeql_tree(repo, [(CQL_A, "1 to 3"), (CQL_B, "5")])
        repo.commit()
        services.alerts = {
            MASTER_REF: [*base_alerts(), codeql_alert(3, "fixed", LOG_RULE, LOGS_FILE, 3)]
        }

        result = run_codeql(repo, services, home)

        assert result.code == 0, result.all_lines
        assert len(result.stdout) == 1
        assert result.stdout[0].startswith("CodeQL exclusions: 2 entries, ")
        assert result.stdout[0].endswith(" and 3 ID comments match on refs/heads/master.")

    def test_a_listed_dismissed_alert_with_no_comment_above_its_line_is_no_failure(
        self, repo: Repo, services: FakeServices, home: Path
    ) -> None:
        # Per D8: comments match entries by ID only, never by the alert's line.
        write_codeql_tree(repo)
        repo.commit()
        moved = [
            codeql_alert(1, "dismissed", LOG_RULE, LOGS_FILE, 5),
            codeql_alert(2, "dismissed", LOG_RULE, LOGS_FILE, 3),
            codeql_alert(5, "dismissed", XSS_RULE, PARSE_FILE, 2),
        ]
        services.alerts = {MASTER_REF: moved}

        result = run_codeql(repo, services, home)

        assert_output(result, 0, [], CODEQL_ALL_MATCH)

    def test_dismissed_alerts_with_no_comment_above_any_of_their_lines_are_no_failure(
        self, repo: Repo, services: FakeServices, home: Path
    ) -> None:
        # Per D8: every listed alert points at a line with no CQL comment above it.
        write_codeql_tree(repo)
        repo.commit()
        services.alerts = {
            MASTER_REF: [
                codeql_alert(1, "dismissed", LOG_RULE, LOGS_FILE, 1),
                codeql_alert(2, "dismissed", LOG_RULE, LOGS_FILE, 4),
                codeql_alert(5, "dismissed", XSS_RULE, PARSE_FILE, 1),
            ]
        }

        result = run_codeql(repo, services, home)

        assert_output(result, 0, [], CODEQL_ALL_MATCH)

    def test_a_comment_above_naming_another_entry_is_no_failure(
        self, repo: Repo, services: FakeServices, home: Path
    ) -> None:
        # Per D8: CQL_A is still carried by one comment, so its alert 2 needs no comment of its own.
        write_codeql_tree(repo)
        repo.write(
            LOGS_FILE,
            [
                "import logging",
                "",
                "logger = logging.getLogger(__name__)",
                f"# CodeQL exclusion: {CQL_A}",
                "logger.info('saved %s', name)",
                f"# CodeQL exclusion: {CQL_B}",
                "logger.info('loaded %s', name)",
            ],
        )
        repo.commit()
        services.alerts = {MASTER_REF: base_alerts()}

        result = run_codeql(repo, services, home)

        assert_output(result, 0, [], CODEQL_ALL_MATCH)

    def test_a_dismissed_alert_in_a_file_the_tree_lacks_is_no_failure(
        self, repo: Repo, services: FakeServices, home: Path
    ) -> None:
        # Per D8: the alert's location is never read from the work tree.
        write_codeql_tree(repo)
        repo.commit()
        services.alerts = {
            MASTER_REF: [
                codeql_alert(1, "dismissed", LOG_RULE, LOGS_FILE, 5),
                codeql_alert(2, "dismissed", LOG_RULE, "backend/wavecore/removed.py", 40),
                codeql_alert(5, "dismissed", XSS_RULE, PARSE_FILE, 2),
            ]
        }

        result = run_codeql(repo, services, home)

        assert_output(result, 0, [], CODEQL_ALL_MATCH)

    @pytest.mark.parametrize("context", CONTEXTS, ids=[c.name for c in CONTEXTS])
    def test_a_dismissed_alert_whose_instance_is_fixed_at_a_stale_line_is_no_failure(
        self, repo: Repo, services: FakeServices, home: Path, tmp_path: Path, context: Context
    ) -> None:
        # Per D8: a dismissed alert whose most recent instance on the ref is fixed, at a line
        # number the code no longer has, matches by its number in the entry alone.
        write_codeql_tree(repo)
        repo.commit()
        place(repo, context)
        stale = codeql_alert(2, "dismissed", LOG_RULE, LOGS_FILE, 120)
        stale["most_recent_instance"]["state"] = "fixed"
        services.alerts = {
            context.codeql_ref: [
                codeql_alert(1, "dismissed", LOG_RULE, LOGS_FILE, 5),
                stale,
                codeql_alert(5, "dismissed", XSS_RULE, PARSE_FILE, 2),
            ]
        }
        if context.codeql_sha is not None:
            services.analyses_for(context.codeql_ref, context.codeql_sha)

        result = run_script(repo, context_env(context, tmp_path, home, services), "--codeql")

        assert_output(
            result,
            0,
            [],
            "CodeQL exclusions: 2 entries, 3 alerts and 3 ID comments match on"
            f" {context.codeql_ref}.",
        )

    def test_a_stale_alert_with_an_unlisted_dismissed_alert_gives_only_its_line(
        self, repo: Repo, services: FakeServices, home: Path
    ) -> None:
        # Per D8a: the other checks still fail alone when a listed alert has no comment above.
        write_codeql_tree(repo)
        repo.commit()
        services.alerts = {
            MASTER_REF: [
                codeql_alert(1, "dismissed", LOG_RULE, LOGS_FILE, 5),
                codeql_alert(2, "dismissed", LOG_RULE, LOGS_FILE, 3),
                codeql_alert(5, "dismissed", XSS_RULE, PARSE_FILE, 2),
                codeql_alert(9, "dismissed", "py/path-injection", LOGS_FILE, 3),
            ]
        }

        result = run_codeql(repo, services, home)

        assert_output(
            result,
            1,
            [
                "Alert 9 (py/path-injection) is dismissed but no entry lists it."
                " Add it to an entry in tests/exclusions/codeql.md, or reopen the alert."
            ],
            "CodeQL exclusions: 1 mismatch on refs/heads/master.",
        )

    def test_an_entry_with_a_dismissed_alert_no_code_carries_gives_only_its_line(
        self, repo: Repo, services: FakeServices, home: Path
    ) -> None:
        # Per D8d: an entry with no ID comment fails once, by its ID, not by its alert's line.
        write_codeql_tree(repo, [(CQL_A, "1 to 2"), (CQL_B, "5"), (CQL_C, "8")])
        repo.commit()
        services.alerts = {
            MASTER_REF: [*base_alerts(), codeql_alert(8, "dismissed", LOG_RULE, LOGS_FILE, 3)]
        }

        result = run_codeql(repo, services, home)

        assert_output(
            result,
            1,
            [
                f"{CQL_C}: no code carries this ID. Add the comment above the flagged line,"
                " or remove the entry from tests/exclusions/codeql.md."
            ],
            "CodeQL exclusions: 1 mismatch on refs/heads/master.",
        )

    def test_an_id_comment_naming_no_entry(
        self, repo: Repo, services: FakeServices, home: Path
    ) -> None:
        write_codeql_tree(repo)
        repo.write(
            PARSE_FILE,
            [
                f"// CodeQL exclusion: {CQL_B}",
                "const doc = new DOMParser().parseFromString(text, 'text/html');",
                f"// CodeQL exclusion: {CQL_UNKNOWN}",
                "const other = 1;",
            ],
        )
        repo.commit()
        services.alerts = {MASTER_REF: base_alerts()}

        result = run_codeql(repo, services, home)

        assert_output(
            result,
            1,
            [
                f"{PARSE_FILE}:3: {CQL_UNKNOWN} has no entry in tests/exclusions/codeql.md."
                " Add the entry, or remove the comment."
            ],
            "CodeQL exclusions: 1 mismatch on refs/heads/master.",
        )

    def test_an_entry_no_code_carries(self, repo: Repo, services: FakeServices, home: Path) -> None:
        write_codeql_tree(repo, [(CQL_A, "1 to 2"), (CQL_B, "5"), (CQL_C, "8")])
        repo.commit()
        services.alerts = {
            MASTER_REF: [*base_alerts(), codeql_alert(8, "fixed", LOG_RULE, LOGS_FILE, 3)]
        }

        result = run_codeql(repo, services, home)

        assert_output(
            result,
            1,
            [
                f"{CQL_C}: no code carries this ID. Add the comment above the flagged line,"
                " or remove the entry from tests/exclusions/codeql.md."
            ],
            "CodeQL exclusions: 1 mismatch on refs/heads/master.",
        )

    def test_sonarcloud_alerts_and_an_open_unlisted_alert_are_no_failures(
        self, repo: Repo, services: FakeServices, home: Path
    ) -> None:
        write_codeql_tree(repo)
        repo.commit()
        services.alerts = {
            MASTER_REF: [
                *base_alerts(),
                codeql_alert(40, "dismissed", "python:S4790", LOGS_FILE, 3, tool="SonarCloud"),
                codeql_alert(41, "open", "py/path-injection", LOGS_FILE, 3),
            ]
        }

        result = run_codeql(repo, services, home)

        assert result.code == 0, result.all_lines
        assert len(result.stdout) == 1
        assert result.stdout[0].startswith("CodeQL exclusions: 2 entries, ")
        assert result.stdout[0].endswith(" and 3 ID comments match on refs/heads/master.")
        assert {r.query["tool_name"] for r in services.requests_to(ALERTS_PATH)} == {"CodeQL"}


# Entry parsing


def heading_line(repo: Repo, rel: str, entry_id: str) -> int:
    return repo.line_of(rel, f"### {entry_id}: A Test Entry")


class TestEntryParsing:
    """Entries, rules and alert lists, and the line each bad entry prints."""

    def test_a_range_includes_both_ends(
        self, repo: Repo, services: FakeServices, home: Path
    ) -> None:
        lines = []
        alerts = []
        for number in (1, 2, 3, 7):
            lines += [f"# CodeQL exclusion: {CQL_A}", f"logger.info('value %s', v{number})"]
            alerts.append(codeql_alert(number, "dismissed", LOG_RULE, LOGS_FILE, len(lines)))
        repo.write(CODEQL_LIST, codeql_list([(CQL_A, "1 to 3, 7")]))
        repo.write(SONAR_LIST, sonar_list([]))
        repo.write(LOGS_FILE, lines)
        repo.commit()
        services.alerts = {MASTER_REF: alerts}

        result = run_codeql(repo, services, home)

        assert_output(
            result,
            0,
            [],
            "CodeQL exclusions: 1 entry, 4 alerts and 4 ID comments match on refs/heads/master.",
        )

    def test_rule_and_alert_lines_after_the_next_heading_belong_to_no_entry(
        self, repo: Repo, services: FakeServices, home: Path
    ) -> None:
        notes = ["## Notes", "", "- **Rule**: `python:S9999`, Not an entry's", ""]
        write_sonar_tree(repo)
        repo.write(
            SONAR_LIST,
            sonar_list([(SQ_A, "python:S4790"), (SQ_B, "typescript:S5332")], notes),
        )
        repo.commit()
        master_marks(services, hash_mark(repo), frontend=[proxy_mark(repo)])

        result = run_script(repo, script_env(home, services), "--sonarqube")

        assert_output(result, 0, [], ALL_MATCH_MASTER)

    def test_alert_lines_after_the_next_heading_belong_to_no_entry(
        self, repo: Repo, services: FakeServices, home: Path
    ) -> None:
        notes = ["### Notes", "", "- **CodeQL alerts**: 2, 5", ""]
        write_codeql_tree(repo, [(CQL_A, "1 to 2"), (CQL_B, "5")], notes)
        repo.commit()
        services.alerts = {MASTER_REF: base_alerts()}

        result = run_codeql(repo, services, home)

        assert_output(result, 0, [], CODEQL_ALL_MATCH)

    @pytest.mark.parametrize(
        ("rule_lines", "what"),
        [
            ([], "no Rule line"),
            (
                ["- **Rule**: `python:S4790`, One", "- **Rule**: `python:S5332`, Two"],
                "more than one Rule line",
            ),
        ],
        ids=["no-rule", "two-rules"],
    )
    def test_a_sonarqube_entry_it_cannot_read(
        self,
        repo: Repo,
        services: FakeServices,
        home: Path,
        rule_lines: list[str],
        what: str,
    ) -> None:
        bad = [f"### {SQ_C}: A Test Entry", "", "- **Kind**: False positive", *rule_lines, ""]
        write_sonar_tree(repo)
        repo.write(
            SONAR_LIST,
            sonar_list([(SQ_A, "python:S4790"), (SQ_B, "typescript:S5332")], ["## More", "", *bad]),
        )
        repo.write("backend/wavecore/third.py", [f"# SonarQube exclusion: {SQ_C}", "x = 1"])
        repo.commit()
        master_marks(services, hash_mark(repo), frontend=[proxy_mark(repo)])

        result = run_script(repo, script_env(home, services), "--sonarqube")

        line = heading_line(repo, SONAR_LIST, SQ_C)
        assert result.code == 1, result.all_lines
        assert (
            f"tests/exclusions/sonarqube-cloud.md:{line}: {SQ_C} is not a valid entry: {what}."
            in result.stdout
        )
        assert result.stdout[-1].startswith("SonarQube exclusions: ")
        assert result.stdout[-1].endswith(" on master.")

    @pytest.mark.parametrize(
        ("alert_lines", "what"),
        [
            ([], "no CodeQL alerts line"),
            (
                ["- **CodeQL alerts**: 8", "- **CodeQL alerts**: 9"],
                "more than one CodeQL alerts line",
            ),
            (["- **CodeQL alerts**: eight"], "cannot read the alert list"),
            (["- **CodeQL alerts**: 8 to"], "cannot read the alert list"),
            (["- **CodeQL alerts**: 8 and 9"], "cannot read the alert list"),
            (["- **CodeQL alerts**: 8,9"], "cannot read the alert list"),
        ],
        ids=["no-alerts", "two-alerts-lines", "word", "open-range", "and", "no-space"],
    )
    def test_a_codeql_entry_it_cannot_read(
        self,
        repo: Repo,
        services: FakeServices,
        home: Path,
        alert_lines: list[str],
        what: str,
    ) -> None:
        bad = [f"### {CQL_C}: A Test Entry", "", "- **Kind**: False positive", *alert_lines, ""]
        write_codeql_tree(repo, [(CQL_A, "1 to 2"), (CQL_B, "5")], bad)
        repo.write("backend/wavecore/third.py", [f"# CodeQL exclusion: {CQL_C}", "print(x)"])
        repo.commit()
        services.alerts = {MASTER_REF: base_alerts()}

        result = run_codeql(repo, services, home)

        line = heading_line(repo, CODEQL_LIST, CQL_C)
        assert result.code == 1, result.all_lines
        assert (
            f"tests/exclusions/codeql.md:{line}: {CQL_C} is not a valid entry: {what}."
            in result.stdout
        )
        assert result.stdout[-1].startswith("CodeQL exclusions: ")
        assert result.stdout[-1].endswith(" on refs/heads/master.")


# CodeQL waiting in CI


def push_env(home: Path, services: FakeServices, **extra: str) -> dict[str, str]:
    return script_env(home, services, GH_TOKEN="test-token", **PUSH_ENV, **extra)


PUSH_REF = f"refs/heads/{RELEASE}"


def ready_analyses(sha: str, categories: tuple[str, ...] = CATEGORIES) -> list[dict[str, object]]:
    return [
        {"ref": PUSH_REF, "commit_sha": sha, "category": c, "tool": {"name": "CodeQL"}}
        for c in categories
    ]


class TestCodeQLWaiting:
    """In CI the CodeQL part waits for an analysis of the commit in each category."""

    def test_proceeds_once_the_analyses_appear(
        self, repo: Repo, services: FakeServices, home: Path
    ) -> None:
        write_codeql_tree(repo)
        repo.commit()
        repo.detach()
        services.alerts = {PUSH_REF: base_alerts()}
        services.analyses = lambda call: [] if call == 1 else ready_analyses(PUSH_SHA)

        result = run_script(repo, push_env(home, services), "--codeql")

        assert_output(
            result,
            0,
            [],
            f"CodeQL exclusions: 2 entries, 3 alerts and 3 ID comments match on {PUSH_REF}.",
        )
        polls = services.requests_to(ANALYSES_PATH)
        assert len(polls) >= 2
        for poll in polls:
            assert poll.query["ref"] == PUSH_REF
            assert poll.query["tool_name"] == "CodeQL"
        first_alert = services.requests.index(services.requests_to(ALERTS_PATH)[0])
        assert services.requests.index(polls[1]) < first_alert

    @pytest.mark.parametrize(
        "analyses",
        [
            [],
            ready_analyses(PUSH_SHA, CATEGORIES[:2]),
            ready_analyses("d" * 40),
        ],
        ids=["none", "one-category-missing", "other-commit"],
    )
    def test_times_out_when_no_analysis_appears(
        self,
        repo: Repo,
        services: FakeServices,
        home: Path,
        analyses: list[dict[str, object]],
    ) -> None:
        write_codeql_tree(repo)
        repo.commit()
        repo.detach()
        services.alerts = {PUSH_REF: base_alerts()}
        services.analyses = lambda _call: analyses

        result = run_script(
            repo, push_env(home, services, WAVE_EXCLUSIONS_WAIT_SECONDS="0"), "--codeql"
        )

        assert_exit_2(
            result,
            f"CodeQL exclusions: no CodeQL analysis for {PUSH_SHA} on {PUSH_REF} after 0 minutes."
            " Re-run this job when code scanning has finished.",
        )
        assert services.requests_to(ALERTS_PATH) == []

    def test_a_pull_request_waits_for_its_head_commit(
        self, repo: Repo, services: FakeServices, home: Path, tmp_path: Path
    ) -> None:
        write_codeql_tree(repo)
        repo.commit()
        repo.detach()
        event = tmp_path / "event.json"
        event.write_text(json.dumps({"pull_request": {"number": 95, "head": {"sha": HEAD_SHA}}}))
        services.analyses_for("refs/pull/95/head", MERGE_SHA)
        env = script_env(
            home,
            services,
            GH_TOKEN="test-token",
            WAVE_EXCLUSIONS_WAIT_SECONDS="0",
            **pr_env(str(event)),
        )

        result = run_script(repo, env, "--codeql")

        assert_exit_2(
            result,
            f"CodeQL exclusions: no CodeQL analysis for {HEAD_SHA} on refs/pull/95/head"
            " after 0 minutes. Re-run this job when code scanning has finished.",
        )

    def test_locally_it_does_not_wait(self, repo: Repo, services: FakeServices, home: Path) -> None:
        write_codeql_tree(repo)
        repo.commit()
        services.alerts = {MASTER_REF: base_alerts()}

        result = run_codeql(repo, services, home)

        assert_output(result, 0, [], CODEQL_ALL_MATCH)
        assert services.requests_to(ANALYSES_PATH) == []


# Errors, tokens and usage


def closed_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


class TestErrors:
    """API, network, token and usage errors exit 2 with their texts."""

    def test_sonarqube_http_500(self, repo: Repo, services: FakeServices, home: Path) -> None:
        sonar_base(repo, services)
        services.failures = {ISSUES_PATH: 500}

        result = run_script(repo, script_env(home, services), "--sonarqube")

        assert_exit_2(
            result,
            f"SonarQube exclusions: could not read {services.url}{ISSUES_PATH}:"
            " HTTP 500 Internal Server Error.",
        )

    def test_sonarqube_branch_list_http_500(
        self, repo: Repo, services: FakeServices, home: Path
    ) -> None:
        write_sonar_tree(repo)
        repo.commit()
        repo.checkout(FIX_BRANCH)
        services.failures = {BRANCHES_PATH: 503}

        result = run_script(repo, script_env(home, services), "--sonarqube")

        assert_exit_2(
            result,
            f"SonarQube exclusions: could not read {services.url}{BRANCHES_PATH}:"
            " HTTP 503 Service Unavailable.",
        )

    def test_codeql_http_500(self, repo: Repo, services: FakeServices, home: Path) -> None:
        write_codeql_tree(repo)
        repo.commit()
        services.failures = {ALERTS_PATH: 500}

        result = run_codeql(repo, services, home)

        assert_exit_2(
            result,
            f"CodeQL exclusions: could not read {services.url}{ALERTS_PATH}:"
            " HTTP 500 Internal Server Error.",
        )

    def test_codeql_analyses_http_500_in_ci(
        self, repo: Repo, services: FakeServices, home: Path
    ) -> None:
        write_codeql_tree(repo)
        repo.commit()
        repo.detach()
        services.failures = {ANALYSES_PATH: 500}

        result = run_script(repo, push_env(home, services), "--codeql")

        assert_exit_2(
            result,
            f"CodeQL exclusions: could not read {services.url}{ANALYSES_PATH}:"
            " HTTP 500 Internal Server Error.",
        )

    @pytest.mark.parametrize(
        ("flag", "part", "variable", "path"),
        [
            ("--sonarqube", "SonarQube", "WAVE_EXCLUSIONS_SONAR_URL", ISSUES_PATH),
            ("--codeql", "CodeQL", "WAVE_EXCLUSIONS_GITHUB_URL", ALERTS_PATH),
        ],
    )
    def test_a_network_error(
        self,
        repo: Repo,
        services: FakeServices,
        home: Path,
        flag: str,
        part: str,
        variable: str,
        path: str,
    ) -> None:
        write_sonar_tree(repo)
        write_codeql_tree(repo)
        repo.commit()
        dead = f"http://127.0.0.1:{closed_port()}"
        env = script_env(home, services, GH_TOKEN="test-token", **{variable: dead})

        result = run_script(repo, env, flag)

        assert_exit_2(
            result,
            f"{part} exclusions: could not read {dead}{path}: [Errno 111] Connection refused.",
        )

    def test_codeql_with_no_token_locally(
        self, repo: Repo, services: FakeServices, home: Path
    ) -> None:
        write_codeql_tree(repo)
        repo.commit()

        result = run_script(repo, script_env(home, services), "--codeql")

        assert_exit_2(
            result,
            "CodeQL exclusions: no token. Set GH_TOKEN or write a read token to"
            " ~/.config/gh/waveapphq-read.token.",
        )
        assert services.requests_to(ALERTS_PATH) == []

    def test_codeql_reads_the_token_file_locally(
        self, repo: Repo, services: FakeServices, home: Path
    ) -> None:
        write_codeql_tree(repo)
        repo.commit()
        services.alerts = {MASTER_REF: base_alerts()}
        token_file = home / ".config" / "gh" / "waveapphq-read.token"
        token_file.parent.mkdir(parents=True)
        token_file.write_text("file-token\n")

        result = run_script(repo, script_env(home, services), "--codeql")

        assert_output(result, 0, [], CODEQL_ALL_MATCH)
        for request in services.requests_to(ALERTS_PATH):
            assert request.headers["authorization"].split()[-1] == "file-token"

    def test_gh_token_wins_over_the_token_file(
        self, repo: Repo, services: FakeServices, home: Path
    ) -> None:
        write_codeql_tree(repo)
        repo.commit()
        services.alerts = {MASTER_REF: base_alerts()}
        token_file = home / ".config" / "gh" / "waveapphq-read.token"
        token_file.parent.mkdir(parents=True)
        token_file.write_text("file-token\n")

        result = run_codeql(repo, services, home)

        assert_output(result, 0, [], CODEQL_ALL_MATCH)
        for request in services.requests_to(ALERTS_PATH):
            assert request.headers["authorization"].split()[-1] == "test-token"

    def test_sonarqube_needs_no_token(self, repo: Repo, services: FakeServices, home: Path) -> None:
        sonar_base(repo, services)

        result = run_script(repo, script_env(home, services), "--sonarqube")

        assert_output(result, 0, [], ALL_MATCH_MASTER)
        for request in services.requests_to(ISSUES_PATH):
            assert "authorization" not in request.headers

    @pytest.mark.parametrize(
        "flags",
        [[], ["--sonarqube", "--codeql"]],
        ids=["neither", "both"],
    )
    def test_usage(self, repo: Repo, services: FakeServices, home: Path, flags: list[str]) -> None:
        write_sonar_tree(repo)
        repo.commit()

        result = run_script(repo, script_env(home, services, GH_TOKEN="test-token"), *flags)

        assert_exit_2(result, USAGE)
        assert services.requests == []
