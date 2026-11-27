"""A fake SonarQube Cloud, a git work tree and the shared cases of the SonarQube results scripts."""

import json
import re
import threading
import urllib.parse
from collections.abc import Iterator
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

import pytest

from tests.scripts.script_support import Repo, Run, Stubs, copy_from_clone, run, stub_env

CLOUD_URL = "https://sonarcloud.io"
ORGANIZATION = "waveapphq"
RELEASE = "release/1.0.0-alpha62"
FIX_BRANCH = "fix/1.0.0-alpha62-sonar-results"
FEATURE_BRANCH = "feature/1.0.0-alpha62-sonar-results"
PULL_REQUEST = "42"
TOKEN = "test-token"

MEASURES_PATH = "/api/measures/component"
GATE_PATH = "/api/qualitygates/project_status"
ISSUES_PATH = "/api/issues/search"
HOTSPOTS_PATH = "/api/hotspots/search"
TREE_PATH = "/api/measures/component_tree"
DUPLICATIONS_PATH = "/api/duplications/show"
RULES_PATH = "/api/rules/show"
CE_TASK_PATH = "/api/ce/task"

# Every read that belongs to one branch or pull request; the rule text belongs to neither.
SCOPED_PATHS = (
    MEASURES_PATH,
    GATE_PATH,
    ISSUES_PATH,
    HOTSPOTS_PATH,
    TREE_PATH,
    DUPLICATIONS_PATH,
)
FINDING_PATHS = (ISSUES_PATH, HOTSPOTS_PATH, TREE_PATH, DUPLICATIONS_PATH)

SITECUSTOMIZE = '''"""Send SonarQube Cloud requests to the fake server; refuse every other URL."""
import os
import urllib.request

_FAKE = os.environ.get("FAKE_SONARQUBE_URL", "")
_CLOUD = "https://sonarcloud.io/"
_open = urllib.request.urlopen


def _to_fake(request, *args, **kwargs):
    if not isinstance(request, urllib.request.Request):
        request = urllib.request.Request(request)
    if not _FAKE or not request.full_url.startswith(_CLOUD):
        raise OSError("this test reaches no network: " + request.full_url)
    request.full_url = _FAKE + "/" + request.full_url[len(_CLOUD):]
    return _open(request, *args, **kwargs)


urllib.request.urlopen = _to_fake
'''


@dataclass(frozen=True)
class Project:
    """One results script and the SonarQube project it reads."""

    script: str
    key: str
    title: str
    folder: str
    kind: str
    code_file: str
    rule: str
    hotspot_rule: str

    @property
    def component(self) -> str:
        return f"{self.key}:{self.code_file}"


BACKEND = Project(
    script="scripts/report/sonar-results-backend.sh",
    key="waveapphq_wave-backend",
    title="  WAVE Backend - SonarQube Detailed Results",
    folder="backend",
    kind="Python",
    code_file="backend/wavecore/app.py",
    rule="python:S1192",
    hotspot_rule="python:S4790",
)

FRONTEND = Project(
    script="scripts/report/sonar-results-frontend.sh",
    key="waveapphq_wave-frontend",
    title="  WAVE Frontend - SonarQube Detailed Results",
    folder="frontend",
    kind="TypeScript or JavaScript",
    code_file="frontend/src/app.ts",
    rule="typescript:S1192",
    hotspot_rule="typescript:S4790",
)


@dataclass
class Recorded:
    """One request the fake server received."""

    path: str
    query: dict[str, str]


def default_measures() -> dict[str, str]:
    return {
        "ncloc": "1234",
        "coverage": "87.5",
        "duplicated_lines_density": "1.2",
        "bugs": "1",
        "vulnerabilities": "0",
        "code_smells": "0",
        "security_hotspots": "1",
        "security_hotspots_reviewed": "0.0",
        "sqale_rating": "1.0",
        "reliability_rating": "3.0",
        "security_rating": "1.0",
    }


def default_gate() -> dict[str, Any]:
    return {
        "status": "ERROR",
        "conditions": [
            {
                "status": "ERROR",
                "metricKey": "new_coverage",
                "comparator": "LT",
                "errorThreshold": "80",
                "actualValue": "61.5",
            },
            {
                "status": "OK",
                "metricKey": "new_duplicated_lines_density",
                "comparator": "GT",
                "errorThreshold": "3",
                "actualValue": "0.0",
            },
        ],
    }


@dataclass
class FakeSonarQube:
    """Serves the SonarQube Web API reads of the results scripts from the data the test sets."""

    project: Project
    url: str = ""
    requests: list[Recorded] = field(default_factory=list)
    measures: dict[str, str] = field(default_factory=default_measures)
    gate: dict[str, Any] = field(default_factory=default_gate)
    issues: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    hotspots: list[dict[str, Any]] = field(default_factory=list)
    failures: dict[str, int] = field(default_factory=dict)
    # The gate of each branch the test names; a read of any other branch, or of none, gets gate.
    branch_gates: dict[str, dict[str, Any]] = field(default_factory=dict)

    def __post_init__(self) -> None:
        p = self.project
        self.issues = {
            "BUG": [
                {
                    "key": "bug-1",
                    "component": p.component,
                    "line": 12,
                    "severity": "MAJOR",
                    "rule": p.rule,
                    "message": "Define a constant instead of duplicating this literal.",
                    "effort": "5min",
                    "flows": [
                        {
                            "locations": [
                                {
                                    "component": p.component,
                                    "textRange": {"startLine": 30},
                                    "msg": "the issue",
                                },
                                {
                                    "component": p.component,
                                    "textRange": {"startLine": 7},
                                    "msg": "the input",
                                },
                            ]
                        }
                    ],
                }
            ]
        }
        self.hotspots = [
            {
                "key": "hotspot-1",
                "component": p.component,
                "line": 4,
                "message": "Make sure this weak hash algorithm is not used in a sensitive context.",
                "securityCategory": "weak-cryptography",
                "vulnerabilityProbability": "LOW",
                "ruleKey": p.hotspot_rule,
            }
        ]

    def requests_to(self, path: str) -> list[Recorded]:
        return [r for r in self.requests if r.path == path]

    def reply(self, path: str, query: dict[str, str]) -> tuple[int, Any]:
        if path in self.failures:
            return self.failures[path], {"errors": [{"msg": "Server Error"}]}
        first = query.get("p", "1") == "1"
        if path == MEASURES_PATH:
            measures = [{"metric": k, "value": v} for k, v in self.measures.items()]
            return 200, {"component": {"key": self.project.key, "measures": measures}}
        if path == GATE_PATH:
            return 200, {"projectStatus": self.branch_gates.get(query.get("branch", ""), self.gate)}
        if path == ISSUES_PATH:
            types = query.get("types", "")
            wanted = types.split(",") if types else list(self.issues)
            found = [issue for kind in wanted for issue in self.issues.get(kind, [])]
            return 200, {"paging": {"total": len(found)}, "issues": found if first else []}
        if path == HOTSPOTS_PATH:
            found = self.hotspots
            return 200, {"paging": {"total": len(found)}, "hotspots": found if first else []}
        if path == TREE_PATH:
            return 200, {"paging": {"total": 0}, "components": []}
        if path == DUPLICATIONS_PATH:
            return 200, {"duplications": [], "files": {}}
        if path == CE_TASK_PATH:
            task = {"id": query.get("id", ""), "status": "SUCCESS", "analysisId": "analysis-1"}
            return 200, {"task": task}
        if path == RULES_PATH:
            rule = query.get("key", "")
            return 200, {
                "rule": {
                    "key": rule,
                    "name": f"Rule {rule}",
                    "descriptionSections": [
                        {"key": "root_cause", "content": f"<p>Why {rule} matters.</p>"},
                        {"key": "how_to_fix", "content": f"<p>Change the code for {rule}.</p>"},
                    ],
                }
            }
        return 404, {"errors": [{"msg": "Unknown url"}]}


def start_fake(project: Project) -> tuple[FakeSonarQube, ThreadingHTTPServer]:
    """Start the fake SonarQube on a free local port."""
    fake = FakeSonarQube(project)

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the http.server hook name
            parts = urlsplit(self.path)
            query = {k: v[-1] for k, v in parse_qs(parts.query).items()}
            fake.requests.append(Recorded(parts.path, query))
            status, body = fake.reply(parts.path, query)
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    fake.url = f"http://127.0.0.1:{server.server_address[1]}"
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return fake, server


class Tree:
    """The work tree the script runs in: a release branch on origin and a branch checked out."""

    def __init__(self, tmp_path: Path, project: Project) -> None:
        self.project = project
        self.repo = Repo(tmp_path / "repo")
        copy_from_clone(self.repo, project.script)
        copy_from_clone(self.repo, "scripts/lib/sonar-env.sh")
        self.repo.write(BACKEND.code_file, ["VALUE = 1"])
        self.repo.write(FRONTEND.code_file, ["export const value = 1;"])
        self.repo.write("README.md", ["# Test tree"])
        self.base = self.repo.commit()

    def release_on_origin(self) -> None:
        """Make origin/<release> point at the base commit, as a fetch of the release would."""
        self.repo.git("update-ref", f"refs/remotes/origin/{RELEASE}", self.base)

    def branch(self, name: str = FIX_BRANCH, origin: bool = True) -> None:
        """Check out a branch at the base commit; by default origin has the release branch."""
        if origin:
            self.release_on_origin()
        self.repo.checkout(name)

    def change(self, *rels: str) -> str:
        """Add or rewrite each file and commit; return the commit sha."""
        for rel in rels:
            path = self.repo.root / rel
            lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
            self.repo.write(rel, [*lines, "// changed"])
        return self.repo.commit()

    def delete(self, *rels: str) -> str:
        for rel in rels:
            self.repo.git("rm", "-q", rel)
        return self.repo.commit()

    def head(self) -> str:
        return self.repo.git("rev-parse", "HEAD")


@dataclass
class Results:
    """One run of a results script and the requests it made."""

    result: Run
    fake: FakeSonarQube

    @property
    def code(self) -> int:
        return self.result.code

    @property
    def lines(self) -> list[str]:
        return self.result.lines

    def index(self, line: str) -> int:
        assert line in self.lines, f"missing line {line!r} in:\n" + "\n".join(self.lines)
        return self.lines.index(line)

    def has(self, pattern: str) -> bool:
        return self.result.has(pattern)

    def matching(self, pattern: str) -> list[str]:
        return [line for line in self.lines if re.fullmatch(pattern, line)]


def run_results(
    tmp_path: Path,
    tree: Tree,
    fake: FakeSonarQube,
    *args: str,
    **extra: str,
) -> Results:
    """Run the results script of the tree's project with the fake SonarQube behind Cloud's URL."""
    site = tmp_path / "site"
    site.mkdir(exist_ok=True)
    (site / "sitecustomize.py").write_text(SITECUSTOMIZE, encoding="utf-8")
    stubs = Stubs(tmp_path / f"stubs-{len(list(tmp_path.glob('stubs-*')))}")
    env = stub_env(tmp_path, stubs, PYTHONPATH=str(site), FAKE_SONARQUBE_URL=fake.url)
    env["SONAR_TOKEN"] = TOKEN
    env.update(extra)
    env = {k: v for k, v in env.items() if v != ""}
    result = run(tree.repo, [str(tree.repo.root / tree.project.script), *args], env, timeout=60)
    return Results(result, fake)


# A push to a release branch or master, as GitHub Actions runs it: no pull request, no target.
PUSH_BRANCHES = [RELEASE, "master"]
PUSH_IDS = ["release", "master"]


def push_env(branch: str) -> dict[str, str]:
    """The variables GitHub Actions sets for a push to the branch."""
    return {
        "GITHUB_ACTIONS": "true",
        "GITHUB_EVENT_NAME": "push",
        "GITHUB_REF": f"refs/heads/{branch}",
        "GITHUB_REF_NAME": branch,
    }


def passed_gate() -> dict[str, Any]:
    return {
        "status": "OK",
        "conditions": [
            {
                "status": "OK",
                "metricKey": "new_violations",
                "comparator": "GT",
                "errorThreshold": "0",
                "actualValue": "0",
            }
        ],
    }


def failed_gate() -> dict[str, Any]:
    return {
        "status": "ERROR",
        "conditions": [
            {
                "status": "ERROR",
                "metricKey": "new_violations",
                "comparator": "GT",
                "errorThreshold": "0",
                "actualValue": "14",
            }
        ],
    }


def lines_of_code(count: str) -> str:
    return f"  Lines of Code:       {count}"


def gate_lines() -> list[str]:
    """The gate block that default_gate() prints, after the summary."""
    return [
        "  Quality Gate:        ERROR",
        "    ERROR  new_coverage: 61.5, fails below 80",
        "    OK     new_duplicated_lines_density: 0.0, fails above 3",
    ]


def no_code_note(project: Project, head: str) -> str:
    return (
        f"0 (no code changed: {head[:12]} adds or modifies no {project.kind} file"
        f" under {project.folder}/ that SonarQube counts as code against {RELEASE})"
    )


def not_proven(project: Project, head: str, count: int) -> str:
    noun = "file" if count == 1 else "files"
    return (
        f"NOT PROVEN: the scan analyzed 0 lines while {head[:12]} changed {count}"
        f" {project.kind} {noun}"
    )


# Paths SonarQube counts as tests when sonar.tests is not set.
TEST_FILE_VARIANTS = [
    "doc/example{s}",
    "docs/example{s}",
    "test/example{s}",
    "tests/example{s}",
    "mock/example{s}",
    "mocks/example{s}",
    "lib/test/example{s}",
    "lib/tests/deep/example{s}",
    "lib/loadtest/example{s}",
    "lib/unittests/example{s}",
    "lib/mocks/example{s}",
    "lib/test_example{s}",
    "lib/testing{s}",
    "lib/example.test{s}",
    "lib/example.tests{s}",
    "lib/example_test{s}",
    "lib/conftest{s}",
]
TEST_FILE_IDS = [
    "dir-doc",
    "dir-docs",
    "dir-test",
    "dir-tests",
    "dir-mock",
    "dir-mocks",
    "nested-dir-test",
    "deep-in-dir-tests",
    "dir-ending-test",
    "dir-ending-tests",
    "nested-dir-mocks",
    "name-starts-test",
    "name-starts-test-word",
    "name-has-test-dot",
    "name-has-tests-dot",
    "name-ends-test",
    "name-conftest",
]

# Paths relative to the project folder that look close to a test path but match no rule above.
CODE_FILE_VARIANTS = [
    "lib/attestation{s}",
    "lib/latest_value{s}",
    "lib/my_tests_util{s}",
    "lib/documents/example{s}",
    "lib/mockups/example{s}",
    "lib/testkit/example{s}",
    "lib/test_helpers/example{s}",
    "lib/tests_data/example{s}",
]


def in_project(project: Project, rel: str) -> str:
    """A path under the project folder with the project's code ending."""
    suffix = Path(project.code_file).suffix
    return f"{project.folder}/{rel.format(s=suffix)}"


def usage(tree: Tree) -> str:
    return f"Usage: {tree.repo.root / tree.project.script} [--fix] [--pr <number>]"


def dashboard(project: Project, scope: dict[str, str]) -> str:
    query = urllib.parse.urlencode({"id": project.key, **scope})
    return f"  Dashboard: {CLOUD_URL}/dashboard?{query}"


class SonarResultsCases:
    """The cases both results scripts share; each test file binds its own project fixture."""

    @pytest.fixture
    def fake(self, project: Project) -> Iterator[FakeSonarQube]:
        fake, server = start_fake(project)
        yield fake
        server.shutdown()
        server.server_close()

    @pytest.fixture
    def tree(self, tmp_path: Path, project: Project) -> Tree:
        return Tree(tmp_path, project)

    # --- A branch run: findings, --fix and exit codes 0, 1 and 2 ---

    def test_branch_run_prints_summary_findings_and_dashboard_and_exits_0(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube, project: Project
    ) -> None:
        tree.branch()
        tree.change(project.code_file)
        got = run_results(tmp_path, tree, fake)
        assert got.code == 0, "\n".join(got.lines)
        assert got.lines[1] == project.title
        assert lines_of_code("1,234") in got.lines
        assert "  Coverage:            87.5%" in got.lines
        assert "  Bugs:                1  (Reliability: C)" in got.lines
        assert "  Security Hotspots:   1 (0.0% reviewed)" in got.lines
        assert "  Bugs (1):" in got.lines
        assert f"  1. [MAJOR] {project.code_file}:12" in got.lines
        assert f"     Rule: {project.rule}" in got.lines
        assert "     Effort: 5min" in got.lines
        assert "  No open vulnerabilities." in got.lines
        assert "  No open code smells." in got.lines
        assert "  Security Hotspots - TO_REVIEW (1):" in got.lines
        assert "     Category: weak-cryptography" in got.lines
        assert "  No duplicated code blocks." in got.lines
        assert dashboard(project, {"branch": FIX_BRANCH}) in got.lines
        assert not got.matching(r"^\s*Flow 1:$")
        assert not got.matching(r"^  How to fix \(\d+ rules\):$")
        assert not got.matching(r"^NOT PROVEN: .*$")

    def test_branch_run_scopes_every_read_to_the_current_branch(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube, project: Project
    ) -> None:
        tree.branch()
        got = run_results(tmp_path, tree, fake)
        assert got.code == 0, "\n".join(got.lines)
        for path in (MEASURES_PATH, ISSUES_PATH, HOTSPOTS_PATH, TREE_PATH):
            assert fake.requests_to(path), f"no read of {path}"
        for request in fake.requests:
            if request.path in SCOPED_PATHS:
                assert request.query.get("branch") == FIX_BRANCH, request
                assert "pullRequest" not in request.query, request

    def test_fix_prints_each_flow_from_the_input_and_the_rule_text_once_per_rule(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube, project: Project
    ) -> None:
        tree.branch()
        got = run_results(tmp_path, tree, fake, "--fix")
        assert got.code == 0, "\n".join(got.lines)
        flow = got.index("     Flow 1:")
        assert got.lines[flow + 1 : flow + 3] == [
            f"       {project.code_file}:7  the input",
            f"       {project.code_file}:30  the issue",
        ]
        assert "  How to fix (2 rules):" in got.lines
        assert f"  {project.rule}: Rule {project.rule}" in got.lines
        assert f"  {project.hotspot_rule}: Rule {project.hotspot_rule}" in got.lines
        assert "    Why is this an issue" in got.lines
        assert f"     Why {project.rule} matters." in got.lines
        rules = fake.requests_to(RULES_PATH)
        assert sorted(r.query["key"] for r in rules) == sorted([project.rule, project.hotspot_rule])
        for request in rules:
            assert request.query.get("organization") == ORGANIZATION, request
            assert "branch" not in request.query, request
            assert "pullRequest" not in request.query, request

    @pytest.mark.parametrize(
        "args",
        [["--bogus"], ["--fix", "--bogus"], ["fix"]],
        ids=["unknown", "unknown-after-fix", "bare-word"],
    )
    def test_unknown_argument_prints_usage_and_exits_2(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube, args: list[str]
    ) -> None:
        tree.branch()
        got = run_results(tmp_path, tree, fake, *args)
        assert got.code == 2
        assert got.lines == [usage(tree)]
        assert fake.requests == []

    def test_missing_token_exits_1_before_any_read(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube
    ) -> None:
        tree.branch()
        got = run_results(tmp_path, tree, fake, SONAR_TOKEN="")
        assert got.code == 1
        assert got.has(
            r"^ERROR: SONAR_TOKEN environment variable is not set\. "
            r"Set it to your token for https://sonarcloud\.io\.$"
        )
        assert fake.requests == []

    def test_detached_head_exits_1_before_any_read(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube
    ) -> None:
        tree.release_on_origin()
        tree.repo.detach()
        got = run_results(tmp_path, tree, fake)
        assert got.code == 1
        assert got.has(
            r"^ERROR: HEAD is detached\. SonarQube Cloud analyzes a local scan as the current "
            r"branch\.$"
        )
        assert fake.requests == []

    def test_measures_read_error_exits_1(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube
    ) -> None:
        tree.branch()
        fake.failures[MEASURES_PATH] = 500
        got = run_results(tmp_path, tree, fake)
        assert got.code == 1
        assert got.has(r"^  ERROR fetching metrics: HTTP Error 500: .+$")
        for path in FINDING_PATHS:
            assert fake.requests_to(path) == [], f"read {path} after the error"

    # --- The quality gate after the summary ---

    def test_gate_with_each_condition_value_and_limit_follows_the_summary(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube, project: Project
    ) -> None:
        tree.branch()
        got = run_results(tmp_path, tree, fake)
        assert got.code == 0, "\n".join(got.lines)
        gate = got.index("  Quality Gate:        ERROR")
        assert got.lines[gate : gate + 3] == gate_lines()
        assert got.index("  Security Hotspots:   1 (0.0% reviewed)") < gate
        assert gate + 3 < got.index("  Bugs (1):")
        reads = fake.requests_to(GATE_PATH)
        assert len(reads) == 1
        assert reads[0].query.get("projectKey") == project.key
        assert reads[0].query.get("branch") == FIX_BRANCH
        assert "pullRequest" not in reads[0].query

    def test_passed_gate_prints_ok_and_every_condition(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube
    ) -> None:
        tree.branch()
        fake.gate = {
            "status": "OK",
            "conditions": [
                {
                    "status": "OK",
                    "metricKey": "new_coverage",
                    "comparator": "LT",
                    "errorThreshold": "80",
                    "actualValue": "92.0",
                },
                {
                    "status": "OK",
                    "metricKey": "new_security_hotspots_reviewed",
                    "comparator": "LT",
                    "errorThreshold": "100",
                    "actualValue": "100.0",
                },
                {
                    "status": "OK",
                    "metricKey": "new_violations",
                    "comparator": "GT",
                    "errorThreshold": "0",
                    "actualValue": "0",
                },
            ],
        }
        got = run_results(tmp_path, tree, fake)
        assert got.code == 0, "\n".join(got.lines)
        gate = got.index("  Quality Gate:        OK")
        assert got.lines[gate : gate + 4] == [
            "  Quality Gate:        OK",
            "    OK     new_coverage: 92.0, fails below 80",
            "    OK     new_security_hotspots_reviewed: 100.0, fails below 100",
            "    OK     new_violations: 0, fails above 0",
        ]

    def test_gate_read_error_exits_1_before_the_findings(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube
    ) -> None:
        tree.branch()
        fake.failures[GATE_PATH] = 500
        got = run_results(tmp_path, tree, fake)
        assert got.code == 1, "\n".join(got.lines)
        assert got.has(r"^  ERROR fetching the quality gate: HTTP Error 500: .+$")
        for path in FINDING_PATHS:
            assert fake.requests_to(path) == [], f"read {path} after the error"

    # --- A push to a release branch or master ---

    @pytest.mark.parametrize("branch", PUSH_BRANCHES, ids=PUSH_IDS)
    def test_push_run_reads_the_gate_of_the_pushed_branch(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube, project: Project, branch: str
    ) -> None:
        if branch != "master":
            tree.branch(branch, origin=False)
        tree.change(project.code_file)
        fake.gate = failed_gate()
        fake.branch_gates[branch] = passed_gate()
        got = run_results(tmp_path, tree, fake, **push_env(branch))
        assert got.code == 0, "\n".join(got.lines)
        reads = fake.requests_to(GATE_PATH)
        assert len(reads) == 1
        assert reads[0].query.get("projectKey") == project.key
        assert reads[0].query.get("branch") == branch, reads[0]
        assert "pullRequest" not in reads[0].query
        gate = got.index("  Quality Gate:        OK")
        assert got.lines[gate : gate + 2] == [
            "  Quality Gate:        OK",
            "    OK     new_violations: 0, fails above 0",
        ]
        assert "  Quality Gate:        ERROR" not in got.lines

    @pytest.mark.parametrize("branch", PUSH_BRANCHES, ids=PUSH_IDS)
    def test_push_run_scopes_every_read_and_the_dashboard_to_the_pushed_branch(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube, project: Project, branch: str
    ) -> None:
        if branch != "master":
            tree.branch(branch, origin=False)
        tree.change(project.code_file)
        got = run_results(tmp_path, tree, fake, **push_env(branch))
        assert got.code == 0, "\n".join(got.lines)
        assert dashboard(project, {"branch": branch}) in got.lines
        for path in (MEASURES_PATH, GATE_PATH, ISSUES_PATH, HOTSPOTS_PATH, TREE_PATH):
            assert fake.requests_to(path), f"no read of {path}"
        for request in fake.requests:
            if request.path in SCOPED_PATHS:
                assert request.query.get("branch") == branch, request
                assert "pullRequest" not in request.query, request

    @pytest.mark.parametrize("branch", PUSH_BRANCHES, ids=PUSH_IDS)
    def test_push_run_with_a_failed_gate_on_the_pushed_branch_prints_it(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube, project: Project, branch: str
    ) -> None:
        if branch != "master":
            tree.branch(branch, origin=False)
        tree.change(project.code_file)
        fake.gate = passed_gate()
        fake.branch_gates[branch] = failed_gate()
        got = run_results(tmp_path, tree, fake, **push_env(branch))
        assert got.code == 0, "\n".join(got.lines)
        gate = got.index("  Quality Gate:        ERROR")
        assert got.lines[gate : gate + 2] == [
            "  Quality Gate:        ERROR",
            "    ERROR  new_violations: 14, fails above 0",
        ]
        assert "  Quality Gate:        OK" not in got.lines

    # --- --pr <number> ---

    @pytest.mark.parametrize(
        "args",
        [["--pr", PULL_REQUEST], ["--fix", "--pr", PULL_REQUEST], ["--pr", PULL_REQUEST, "--fix"]],
        ids=["pr", "fix-then-pr", "pr-then-fix"],
    )
    def test_pr_scopes_every_read_and_the_dashboard_to_the_pull_request(
        self,
        tmp_path: Path,
        tree: Tree,
        fake: FakeSonarQube,
        project: Project,
        args: list[str],
    ) -> None:
        tree.branch()
        got = run_results(tmp_path, tree, fake, *args)
        assert got.code == 0, "\n".join(got.lines)
        assert got.lines[got.index("  Quality Gate:        ERROR") :][:3] == gate_lines()
        assert f"  1. [MAJOR] {project.code_file}:12" in got.lines
        assert dashboard(project, {"pullRequest": PULL_REQUEST}) in got.lines
        for path in (MEASURES_PATH, GATE_PATH, ISSUES_PATH, HOTSPOTS_PATH, TREE_PATH):
            assert fake.requests_to(path), f"no read of {path}"
        for request in fake.requests:
            if request.path in SCOPED_PATHS:
                assert request.query.get("pullRequest") == PULL_REQUEST, request
                assert "branch" not in request.query, request
        fix = "--fix" in args
        assert bool(got.matching(r"^  How to fix \(2 rules\):$")) is fix
        for request in fake.requests_to(RULES_PATH):
            assert "pullRequest" not in request.query, request

    @pytest.mark.parametrize(
        "args",
        [
            ["--pr"],
            ["--pr", "0"],
            ["--pr", "abc"],
            ["--pr", "-4"],
            ["--pr", "07"],
            ["--fix", "--pr"],
        ],
        ids=["no-number", "zero", "word", "negative", "leading-zero", "fix-then-no-number"],
    )
    def test_pr_without_a_pull_request_number_prints_usage_and_exits_2(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube, args: list[str]
    ) -> None:
        tree.branch()
        got = run_results(tmp_path, tree, fake, *args)
        assert got.code == 2
        assert got.lines == [usage(tree)]
        assert fake.requests == []

    def test_pr_at_0_lines_skips_the_0_line_check(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube, project: Project
    ) -> None:
        # No origin release branch either: the check would fail on git if it ran.
        tree.branch(origin=False)
        tree.change(project.code_file)
        fake.measures["ncloc"] = "0"
        got = run_results(tmp_path, tree, fake, "--pr", PULL_REQUEST)
        assert got.code == 0, "\n".join(got.lines)
        assert lines_of_code("0") in got.lines
        assert not got.matching(r"^NOT PROVEN: .*$")
        assert fake.requests_to(ISSUES_PATH)

    # --- The 0-line check ---

    @pytest.mark.parametrize("branch", [FIX_BRANCH, FEATURE_BRANCH], ids=["fix", "feature"])
    def test_0_lines_with_changed_code_is_not_proven_and_exits_3(
        self,
        tmp_path: Path,
        tree: Tree,
        fake: FakeSonarQube,
        project: Project,
        branch: str,
    ) -> None:
        tree.branch(branch)
        added = f"{project.folder}/added/{Path(project.code_file).name}"
        head = tree.change(project.code_file, added)
        fake.measures["ncloc"] = "0"
        got = run_results(tmp_path, tree, fake)
        assert got.code == 3, "\n".join(got.lines)
        proven = got.index(not_proven(project, head, 2))
        assert got.lines[proven + 1 :] == sorted([f"  {project.code_file}", f"  {added}"])
        assert got.index("  Quality Gate:        ERROR") < proven
        assert lines_of_code("0") in got.lines
        for path in FINDING_PATHS:
            assert fake.requests_to(path) == [], f"read {path} after NOT PROVEN"
        assert not got.matching(r"^  Dashboard: .*$")

    def test_0_lines_with_no_ncloc_measure_is_not_proven(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube, project: Project
    ) -> None:
        tree.branch()
        head = tree.change(project.code_file)
        del fake.measures["ncloc"]
        got = run_results(tmp_path, tree, fake)
        assert got.code == 3, "\n".join(got.lines)
        proven = got.index(not_proven(project, head, 1))
        assert got.lines[proven + 1 :] == [f"  {project.code_file}"]

    def test_not_proven_lists_at_most_ten_files_and_counts_all(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube, project: Project
    ) -> None:
        tree.branch()
        suffix = Path(project.code_file).suffix
        files = [f"{project.folder}/many/file_{n:02d}{suffix}" for n in range(12)]
        head = tree.change(*files)
        fake.measures["ncloc"] = "0"
        got = run_results(tmp_path, tree, fake)
        assert got.code == 3, "\n".join(got.lines)
        proven = got.index(not_proven(project, head, 12))
        assert got.lines[proven + 1 :] == [f"  {name}" for name in sorted(files)[:10]]

    def test_renamed_code_file_counts_at_its_new_path(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube, project: Project
    ) -> None:
        tree.branch()
        moved = f"{project.folder}/moved/{Path(project.code_file).name}"
        (tree.repo.root / moved).parent.mkdir(parents=True)
        tree.repo.git("mv", project.code_file, moved)
        head = tree.repo.commit()
        fake.measures["ncloc"] = "0"
        got = run_results(tmp_path, tree, fake)
        assert got.code == 3, "\n".join(got.lines)
        proven = got.index(not_proven(project, head, 1))
        assert got.lines[proven + 1 :] == [f"  {moved}"]

    def test_0_lines_after_only_deleting_code_passes_with_the_no_code_note(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube, project: Project
    ) -> None:
        tree.branch()
        head = tree.delete(project.code_file)
        fake.measures["ncloc"] = "0"
        got = run_results(tmp_path, tree, fake)
        assert got.code == 0, "\n".join(got.lines)
        assert lines_of_code(no_code_note(project, head)) in got.lines
        assert got.lines[got.index("  Quality Gate:        ERROR") :][:3] == gate_lines()
        assert not got.matching(r"^NOT PROVEN: .*$")
        assert fake.requests_to(ISSUES_PATH)

    def test_0_lines_with_only_uncommitted_code_passes_with_the_no_code_note(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube, project: Project
    ) -> None:
        tree.branch()
        head = tree.change("README.md")
        tree.repo.write(project.code_file, ["// not committed"])
        tree.repo.write(f"{project.folder}/new/{Path(project.code_file).name}", ["// untracked"])
        fake.measures["ncloc"] = "0"
        got = run_results(tmp_path, tree, fake)
        assert got.code == 0, "\n".join(got.lines)
        assert lines_of_code(no_code_note(project, head)) in got.lines
        assert not got.matching(r"^NOT PROVEN: .*$")

    def test_0_lines_with_no_change_at_all_passes_with_the_no_code_note(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube, project: Project
    ) -> None:
        tree.branch()
        fake.measures["ncloc"] = "0"
        got = run_results(tmp_path, tree, fake)
        assert got.code == 0, "\n".join(got.lines)
        assert lines_of_code(no_code_note(project, tree.base)) in got.lines
        assert dashboard(project, {"branch": FIX_BRANCH}) in got.lines

    @pytest.mark.parametrize(
        "branch",
        ["master", RELEASE, "fix/sonar-results", "docs/1.0.0-alpha62-sonar-results"],
        ids=["master", "release", "fix-without-release", "other-prefix"],
    )
    def test_0_lines_on_a_branch_with_no_release_target_runs_no_check(
        self,
        tmp_path: Path,
        tree: Tree,
        fake: FakeSonarQube,
        project: Project,
        branch: str,
    ) -> None:
        if branch != "master":
            tree.branch(branch, origin=False)
        tree.change(project.code_file)
        fake.measures["ncloc"] = "0"
        got = run_results(tmp_path, tree, fake)
        assert got.code == 0, "\n".join(got.lines)
        assert lines_of_code("0") in got.lines
        assert got.lines[got.index("  Quality Gate:        ERROR") :][:3] == gate_lines()
        assert not got.matching(r"^NOT PROVEN: .*$")
        assert fake.requests_to(ISSUES_PATH)

    def test_lines_above_0_run_no_check(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube, project: Project
    ) -> None:
        # No origin release branch: the check would fail on git if it ran.
        tree.branch(origin=False)
        tree.change(project.code_file)
        fake.measures["ncloc"] = "7"
        got = run_results(tmp_path, tree, fake)
        assert got.code == 0, "\n".join(got.lines)
        assert lines_of_code("7") in got.lines
        assert not got.matching(r"^NOT PROVEN: .*$")

    def test_0_line_check_git_error_exits_1(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube, project: Project
    ) -> None:
        tree.branch(origin=False)
        tree.change(project.code_file)
        fake.measures["ncloc"] = "0"
        got = run_results(tmp_path, tree, fake)
        assert got.code == 1, "\n".join(got.lines)
        assert got.has(r"^  ERROR comparing HEAD with origin/release/1\.0\.0-alpha62: .+$")
        assert not got.matching(r"^NOT PROVEN: .*$")
        for path in FINDING_PATHS:
            assert fake.requests_to(path) == [], f"read {path} after the error"

    # --- Files SonarQube counts as tests while sonar.tests is not set ---

    @pytest.mark.parametrize("rel", TEST_FILE_VARIANTS, ids=TEST_FILE_IDS)
    def test_0_lines_with_only_a_test_file_passes_with_the_no_code_note(
        self,
        tmp_path: Path,
        tree: Tree,
        fake: FakeSonarQube,
        project: Project,
        rel: str,
    ) -> None:
        tested = in_project(project, rel)
        tree.branch()
        head = tree.change(tested)
        fake.measures["ncloc"] = "0"
        got = run_results(tmp_path, tree, fake)
        assert got.code == 0, "\n".join(got.lines)
        assert lines_of_code(no_code_note(project, head)) in got.lines
        assert got.lines[got.index("  Quality Gate:        ERROR") :][:3] == gate_lines()
        assert not got.matching(r"^NOT PROVEN: .*$")
        assert fake.requests_to(ISSUES_PATH)
        assert fake.requests_to(HOTSPOTS_PATH)
        assert dashboard(project, {"branch": FIX_BRANCH}) in got.lines

    def test_0_lines_with_every_kind_of_test_file_in_one_commit_passes(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube, project: Project
    ) -> None:
        got = self.check_counted(
            tmp_path,
            tree,
            fake,
            project,
            counted=[],
            ignored=[in_project(project, rel) for rel in TEST_FILE_VARIANTS],
        )
        assert not got.matching(r"^NOT PROVEN: .*$")
        assert fake.requests_to(ISSUES_PATH)

    def test_0_lines_with_test_and_code_files_lists_only_the_code_files(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube, project: Project
    ) -> None:
        self.check_counted(
            tmp_path,
            tree,
            fake,
            project,
            counted=[project.code_file],
            ignored=[in_project(project, rel) for rel in TEST_FILE_VARIANTS],
        )
        for path in FINDING_PATHS:
            assert fake.requests_to(path) == [], f"read {path} after NOT PROVEN"

    def test_names_close_to_a_test_name_still_count_as_code(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube, project: Project
    ) -> None:
        self.check_counted(
            tmp_path,
            tree,
            fake,
            project,
            counted=[in_project(project, rel) for rel in CODE_FILE_VARIANTS],
            ignored=[in_project(project, "lib/tests/helper{s}")],
        )

    def test_code_file_moved_into_a_tests_folder_passes_with_the_no_code_note(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube, project: Project
    ) -> None:
        tree.branch()
        moved = in_project(project, "tests/app{s}")
        (tree.repo.root / moved).parent.mkdir(parents=True)
        tree.repo.git("mv", project.code_file, moved)
        head = tree.repo.commit()
        fake.measures["ncloc"] = "0"
        got = run_results(tmp_path, tree, fake)
        assert got.code == 0, "\n".join(got.lines)
        assert lines_of_code(no_code_note(project, head)) in got.lines
        assert not got.matching(r"^NOT PROVEN: .*$")

    def check_counted(
        self,
        tmp_path: Path,
        tree: Tree,
        fake: FakeSonarQube,
        project: Project,
        counted: list[str],
        ignored: list[str],
    ) -> Results:
        """Commit counted and ignored files at 0 lines; only the counted ones are listed."""
        tree.branch()
        head = tree.change(*counted, *ignored)
        fake.measures["ncloc"] = "0"
        got = run_results(tmp_path, tree, fake)
        if not counted:
            assert got.code == 0, "\n".join(got.lines)
            assert lines_of_code(no_code_note(project, head)) in got.lines
            return got
        assert got.code == 3, "\n".join(got.lines)
        proven = got.index(not_proven(project, head, len(counted)))
        assert got.lines[proven + 1 :] == [f"  {name}" for name in sorted(counted)]
        return got
