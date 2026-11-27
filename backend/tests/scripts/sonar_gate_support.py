"""The cases both SonarQube gate scripts (10 and 11) share, against a fake SonarQube Cloud."""

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from tests.scripts.gate_support import (
    BAD_OPTION,
    GateRun,
    copy_gate,
    copy_ignores,
    failed_reason,
    gate_path,
    passed_line,
    result_lines,
)
from tests.scripts.script_support import Repo, Stubs, refuse_shared_temp, run, stub_env
from tests.scripts.sonar_results_support import (
    GATE_PATH,
    PUSH_BRANCHES,
    PUSH_IDS,
    RELEASE,
    SITECUSTOMIZE,
    TOKEN,
    FakeSonarQube,
    Project,
    Tree,
    push_env,
    start_fake,
)

CHANGED_LINE = 2
UNCHANGED_LINE = 1

# The variable ci.yml sets to the commit the branch was at before the push (github.event.before).
BEFORE_SHA = "BEFORE_SHA"
# In a push tree: line 1 is on master, line 2 came with an earlier push, line 3 with this push.
EARLIER_LINE = 2
PUSHED_LINE = 3
# GitHub's github.event.before when the push created the branch: there is no earlier commit.
NO_BEFORE = "0" * 40


class PushTree(Tree):
    """A release branch or master that a push moved from one commit (before) to HEAD."""

    def __init__(self, tmp_path: Path, project: Project, number: int, branch: str) -> None:
        super().__init__(tmp_path, project)
        copy_ignores(self.repo)
        copy_gate(self.repo, number)
        self.master = self.repo.commit()
        if branch != "master":
            self.repo.checkout(branch)
        first = self.repo.line(project.code_file, 1)
        self.repo.write(project.code_file, [first, "EARLIER = 2"])
        self.before = self.repo.commit()
        self.repo.write(project.code_file, [first, "EARLIER = 2", "PUSHED = 3"])
        self.pushed = self.repo.commit()
        self.branch_name = branch

    def on_github(self) -> None:
        """origin as GitHub's checkout of the push sees it: the branch at HEAD."""
        if self.branch_name != "master":
            self.repo.git("update-ref", "refs/remotes/origin/master", self.master)
        self.repo.git("update-ref", f"refs/remotes/origin/{self.branch_name}", self.pushed)

    def unpushed(self) -> None:
        """origin as a local clone sees it before the push: the branch at the earlier commit."""
        if self.branch_name != "master":
            self.repo.git("update-ref", "refs/remotes/origin/master", self.master)
        self.repo.git("update-ref", f"refs/remotes/origin/{self.branch_name}", self.before)


# sonar-scanner: writes the task file a real scan leaves and exits with STUB_SCANNER_EXIT.
SCANNER = """
folder = os.path.join(os.getcwd(), ".scannerwork")
os.makedirs(folder, exist_ok=True)
key = os.environ.get("STUB_PROJECT_KEY", "")
with open(os.path.join(folder, "report-task.txt"), "w", encoding="utf-8") as task:
    task.write(
        f"projectKey={key}\\nserverUrl=https://sonarcloud.io\\nceTaskId=task-1\\n"
        "ceTaskUrl=https://sonarcloud.io/api/ce/task?id=task-1\\n"
    )
sys.exit(int(os.environ.get("STUB_SCANNER_EXIT", "0")))
"""

# curl: sends SonarQube Cloud requests to the fake and refuses every other URL.
CURL = """
fake = os.environ.get("FAKE_SONARQUBE_URL", "")
args = [a.replace("https://sonarcloud.io", fake) for a in ARGS]
if not fake or any("://" in a and not a.startswith(fake) for a in args):
    print("this test reaches no network", file=sys.stderr)
    sys.exit(7)
real = next(p for p in ("/usr/bin/curl", "/bin/curl") if os.path.exists(p))
sys.exit(subprocess.run([real, *args], check=False).returncode)
"""

REFUSE = """
print("this test reaches no network", file=sys.stderr)
sys.exit(7)
"""


def gate_ok() -> dict[str, Any]:
    return {
        "status": "OK",
        "conditions": [
            {
                "status": "OK",
                "metricKey": "new_coverage",
                "comparator": "LT",
                "errorThreshold": "80",
                "actualValue": "100.0",
            }
        ],
    }


def gate_failed(metric: str) -> dict[str, Any]:
    return {
        "status": "ERROR",
        "conditions": [
            {
                "status": "ERROR",
                "metricKey": metric,
                "comparator": "LT" if "coverage" in metric else "GT",
                "errorThreshold": "80" if "coverage" in metric else "3",
                "actualValue": "40.0" if "coverage" in metric else "9.0",
            }
        ],
    }


def issue(project: Project, kind: str, line: int) -> dict[str, Any]:
    return {
        "key": f"{kind.lower()}-{line}",
        "component": project.component,
        "line": line,
        "type": kind,
        "severity": "MAJOR",
        "rule": project.rule,
        "message": "Define a constant instead of duplicating this literal.",
        "effort": "5min",
        "status": "OPEN",
    }


def hotspot(project: Project, line: int) -> dict[str, Any]:
    return {
        "key": f"hotspot-{line}",
        "component": project.component,
        "line": line,
        "status": "TO_REVIEW",
        "message": "Make sure this weak hash algorithm is not used in a sensitive context.",
        "securityCategory": "weak-cryptography",
        "vulnerabilityProbability": "LOW",
        "ruleKey": project.hotspot_rule,
    }


class SonarGateCases:
    """The result, the scan and the failure rules of a SonarQube gate script."""

    NUMBER = 0
    COVERAGE_REPORT = ""

    @pytest.fixture
    def fake(self, project: Project) -> Iterator[FakeSonarQube]:
        fake, server = start_fake(project)
        fake.gate = gate_ok()
        fake.issues = {}
        fake.hotspots = []
        yield fake
        server.shutdown()
        server.server_close()

    @pytest.fixture
    def tree(self, tmp_path: Path, project: Project) -> Tree:
        tree = Tree(tmp_path, project)
        copy_ignores(tree.repo)
        copy_gate(tree.repo, self.NUMBER)
        tree.base = tree.repo.commit()
        tree.branch()
        tree.change(project.code_file)
        return tree

    def with_coverage(self, repo: Repo) -> None:
        repo.write(self.COVERAGE_REPORT, ["coverage report"])

    def sonar_gate(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube, *args: str, **extra: str
    ) -> GateRun:
        site = tmp_path / "site"
        site.mkdir(exist_ok=True)
        (site / "sitecustomize.py").write_text(SITECUSTOMIZE, encoding="utf-8")
        stubs = Stubs(tmp_path / f"stubs-{len(list(tmp_path.glob('stubs-*')))}")
        stubs.tool("sonar-scanner", SCANNER)
        stubs.tool("curl", CURL)
        stubs.tool("wget", REFUSE)
        env = stub_env(
            tmp_path,
            stubs,
            PYTHONPATH=str(site),
            FAKE_SONARQUBE_URL=fake.url,
            SONAR_TOKEN=TOKEN,
            STUB_PROJECT_KEY=tree.project.key,
        )
        env.update(extra)
        env = {k: v for k, v in env.items() if v != ""}
        script = gate_path(self.NUMBER)
        refuse_shared_temp(tree.repo, script)
        result = run(tree.repo, [str(tree.repo.root / script), *args], env, timeout=60)
        return GateRun(result, tree.repo, stubs)

    @pytest.fixture
    def passing(self, tmp_path: Path, tree: Tree, fake: FakeSonarQube) -> GateRun:
        self.with_coverage(tree.repo)
        return self.sonar_gate(tmp_path, tree, fake)

    @pytest.fixture
    def failing(self, tmp_path: Path, tree: Tree, fake: FakeSonarQube, project: Project) -> GateRun:
        self.with_coverage(tree.repo)
        fake.issues = {"CODE_SMELL": [issue(project, "CODE_SMELL", CHANGED_LINE)]}
        return self.sonar_gate(tmp_path, tree, fake)

    @pytest.fixture
    def usage_error(self, tmp_path: Path, tree: Tree, fake: FakeSonarQube) -> GateRun:
        return self.sonar_gate(tmp_path, tree, fake, BAD_OPTION)

    # --- The scan, then the results report ---

    def test_the_scan_runs_once_in_the_project_folder(
        self, passing: GateRun, project: Project
    ) -> None:
        (call,) = passing.stubs.calls("sonar-scanner")

        assert Path(call.cwd) == passing.repo.root / project.folder

    def test_the_scan_waits_for_its_gate(self, passing: GateRun) -> None:
        (call,) = passing.stubs.calls("sonar-scanner")

        assert "-Dsonar.qualitygate.wait=true" in call.args

    def test_the_results_report_follows_the_scan(self, passing: GateRun, project: Project) -> None:
        assert project.title in passing.result.lines

    # --- Issues and hotspots on changed lines ---

    @pytest.mark.parametrize("kind", ["BUG", "VULNERABILITY", "CODE_SMELL"])
    def test_an_issue_on_a_changed_line_fails(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube, project: Project, kind: str
    ) -> None:
        self.with_coverage(tree.repo)
        fake.issues = {kind: [issue(project, kind, CHANGED_LINE)]}

        result = self.sonar_gate(tmp_path, tree, fake).result

        assert result.code == 1, result.lines

    @pytest.mark.parametrize("kind", ["BUG", "VULNERABILITY", "CODE_SMELL"])
    def test_an_issue_on_an_unchanged_line_passes(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube, project: Project, kind: str
    ) -> None:
        self.with_coverage(tree.repo)
        fake.issues = {kind: [issue(project, kind, UNCHANGED_LINE)]}

        result = self.sonar_gate(tmp_path, tree, fake).result

        assert result.code == 0, result.lines
        assert result_lines(result, self.NUMBER) == [passed_line(self.NUMBER)]

    def test_a_hotspot_on_a_changed_line_fails(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube, project: Project
    ) -> None:
        self.with_coverage(tree.repo)
        fake.hotspots = [hotspot(project, CHANGED_LINE)]

        result = self.sonar_gate(tmp_path, tree, fake).result

        assert result.code == 1, result.lines

    def test_a_hotspot_on_an_unchanged_line_passes(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube, project: Project
    ) -> None:
        self.with_coverage(tree.repo)
        fake.hotspots = [hotspot(project, UNCHANGED_LINE)]

        result = self.sonar_gate(tmp_path, tree, fake).result

        assert result.code == 0, result.lines

    # --- Quality gate conditions ---

    @pytest.mark.parametrize("metric", ["new_duplicated_lines_density", "new_violations"])
    def test_a_failed_condition_other_than_coverage_fails(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube, metric: str
    ) -> None:
        fake.gate = gate_failed(metric)

        result = self.sonar_gate(tmp_path, tree, fake, STUB_SCANNER_EXIT="1").result

        assert result.code == 1, result.lines

    @pytest.mark.parametrize("metric", ["new_coverage", "coverage"])
    def test_a_failed_coverage_condition_before_the_tests_ran_passes(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube, metric: str
    ) -> None:
        fake.gate = gate_failed(metric)

        result = self.sonar_gate(tmp_path, tree, fake, STUB_SCANNER_EXIT="1").result

        assert result.code == 0, result.lines
        assert result_lines(result, self.NUMBER) == [passed_line(self.NUMBER)]

    @pytest.mark.parametrize("metric", ["new_coverage", "coverage"])
    def test_a_failed_coverage_condition_after_the_tests_ran_fails(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube, metric: str
    ) -> None:
        self.with_coverage(tree.repo)
        fake.gate = gate_failed(metric)

        result = self.sonar_gate(tmp_path, tree, fake, STUB_SCANNER_EXIT="1").result

        assert result.code == 1, result.lines

    # --- NOT PROVEN and setup errors ---

    def test_a_zero_line_scan_of_changed_code_exits_3(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube
    ) -> None:
        self.with_coverage(tree.repo)
        fake.measures["ncloc"] = "0"

        result = self.sonar_gate(tmp_path, tree, fake).result

        assert result.code == 3, result.lines

    def test_a_zero_line_scan_prints_a_failed_line(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube
    ) -> None:
        self.with_coverage(tree.repo)
        fake.measures["ncloc"] = "0"

        result = self.sonar_gate(tmp_path, tree, fake).result

        assert len(result_lines(result, self.NUMBER)) == 1, result.lines
        assert result_lines(result, self.NUMBER) != [passed_line(self.NUMBER)]

    def test_uncommitted_work_is_a_setup_error(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube, project: Project
    ) -> None:
        self.with_coverage(tree.repo)
        tree.repo.write(project.code_file, ["VALUE = 2"])

        run_result = self.sonar_gate(tmp_path, tree, fake)

        assert run_result.result.code == 2, run_result.result.lines
        assert run_result.stubs.calls("sonar-scanner") == []

    def test_no_token_is_a_setup_error(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube
    ) -> None:
        self.with_coverage(tree.repo)

        run_result = self.sonar_gate(tmp_path, tree, fake, SONAR_TOKEN="")

        assert run_result.result.code == 2, run_result.result.lines
        assert run_result.stubs.calls("sonar-scanner") == []

    # --- A push to a release branch or master: no pull request, no fix or feature target ---

    def push_tree(self, tmp_path: Path, project: Project, branch: str) -> PushTree:
        tree = PushTree(tmp_path, project, self.NUMBER, branch)
        self.with_coverage(tree.repo)
        return tree

    def github_push(
        self, tmp_path: Path, tree: PushTree, fake: FakeSonarQube, **extra: str
    ) -> GateRun:
        tree.on_github()
        env = {**push_env(tree.branch_name), BEFORE_SHA: tree.before, **extra}
        return self.sonar_gate(tmp_path, tree, fake, **env)

    @pytest.mark.parametrize("branch", PUSH_BRANCHES, ids=PUSH_IDS)
    def test_a_push_passes_on_the_pushed_branch_gate_when_the_main_branch_gate_failed(
        self, tmp_path: Path, fake: FakeSonarQube, project: Project, branch: str
    ) -> None:
        tree = self.push_tree(tmp_path, project, branch)
        fake.gate = gate_failed("new_violations")
        fake.branch_gates[branch] = gate_ok()

        result = self.github_push(tmp_path, tree, fake).result

        assert result.code == 0, result.lines
        assert result_lines(result, self.NUMBER) == [passed_line(self.NUMBER)]

    @pytest.mark.parametrize("branch", PUSH_BRANCHES, ids=PUSH_IDS)
    def test_a_push_fails_on_a_failed_pushed_branch_gate(
        self, tmp_path: Path, fake: FakeSonarQube, project: Project, branch: str
    ) -> None:
        tree = self.push_tree(tmp_path, project, branch)
        fake.gate = gate_ok()
        fake.branch_gates[branch] = gate_failed("new_violations")

        result = self.github_push(tmp_path, tree, fake, STUB_SCANNER_EXIT="1").result

        assert result.code == 1, result.lines
        assert failed_reason(result, self.NUMBER) == "quality gate: new_violations", result.lines

    @pytest.mark.parametrize("branch", PUSH_BRANCHES, ids=PUSH_IDS)
    def test_a_push_reads_the_gate_of_the_pushed_branch(
        self, tmp_path: Path, fake: FakeSonarQube, project: Project, branch: str
    ) -> None:
        tree = self.push_tree(tmp_path, project, branch)

        self.github_push(tmp_path, tree, fake)

        reads = fake.requests_to(GATE_PATH)
        assert len(reads) == 1, fake.requests
        assert reads[0].query.get("branch") == branch, reads[0]
        assert "pullRequest" not in reads[0].query, reads[0]

    @pytest.mark.parametrize("branch", PUSH_BRANCHES, ids=PUSH_IDS)
    @pytest.mark.parametrize("finding", ["issue", "hotspot"])
    def test_a_push_counts_no_line_of_an_earlier_push(
        self, tmp_path: Path, fake: FakeSonarQube, project: Project, branch: str, finding: str
    ) -> None:
        tree = self.push_tree(tmp_path, project, branch)
        if finding == "issue":
            fake.issues = {"CODE_SMELL": [issue(project, "CODE_SMELL", EARLIER_LINE)]}
        else:
            fake.hotspots = [hotspot(project, EARLIER_LINE)]

        result = self.github_push(tmp_path, tree, fake).result

        assert result.code == 0, result.lines
        assert result_lines(result, self.NUMBER) == [passed_line(self.NUMBER)]

    @pytest.mark.parametrize("branch", PUSH_BRANCHES, ids=PUSH_IDS)
    @pytest.mark.parametrize("finding", ["issue", "hotspot"])
    def test_a_push_fails_on_a_finding_on_a_pushed_line(
        self, tmp_path: Path, fake: FakeSonarQube, project: Project, branch: str, finding: str
    ) -> None:
        tree = self.push_tree(tmp_path, project, branch)
        if finding == "issue":
            fake.issues = {"CODE_SMELL": [issue(project, "CODE_SMELL", PUSHED_LINE)]}
        else:
            fake.hotspots = [hotspot(project, PUSHED_LINE)]

        result = self.github_push(tmp_path, tree, fake).result

        assert result.code == 1, result.lines
        assert failed_reason(result, self.NUMBER) == (
            f"1 issue or hotspot on changed lines: {project.code_file}:{PUSHED_LINE}"
        ), result.lines

    @pytest.mark.parametrize("branch", PUSH_BRANCHES, ids=PUSH_IDS)
    def test_a_local_run_counts_only_the_lines_origin_does_not_have(
        self, tmp_path: Path, fake: FakeSonarQube, project: Project, branch: str
    ) -> None:
        # origin/master lacks the earlier line too; a release branch is compared with itself.
        tree = self.push_tree(tmp_path, project, branch)
        tree.unpushed()
        fake.issues = {"CODE_SMELL": [issue(project, "CODE_SMELL", EARLIER_LINE)]}

        result = self.sonar_gate(tmp_path, tree, fake).result

        assert result.code == 0, result.lines
        assert result_lines(result, self.NUMBER) == [passed_line(self.NUMBER)]

    @pytest.mark.parametrize("branch", PUSH_BRANCHES, ids=PUSH_IDS)
    def test_a_local_run_fails_on_an_issue_on_an_unpushed_line(
        self, tmp_path: Path, fake: FakeSonarQube, project: Project, branch: str
    ) -> None:
        tree = self.push_tree(tmp_path, project, branch)
        tree.unpushed()
        fake.issues = {"CODE_SMELL": [issue(project, "CODE_SMELL", PUSHED_LINE)]}

        result = self.sonar_gate(tmp_path, tree, fake).result

        assert result.code == 1, result.lines
        assert failed_reason(result, self.NUMBER) == (
            f"1 issue or hotspot on changed lines: {project.code_file}:{PUSHED_LINE}"
        ), result.lines

    def test_a_local_run_on_a_release_branch_never_compares_with_master(
        self, tmp_path: Path, fake: FakeSonarQube, project: Project
    ) -> None:
        # A clone with no origin/master still has its own branch on origin.
        tree = self.push_tree(tmp_path, project, RELEASE)
        tree.repo.git("update-ref", f"refs/remotes/origin/{RELEASE}", tree.before)

        result = self.sonar_gate(tmp_path, tree, fake).result

        assert result.code == 0, result.lines
        assert result_lines(result, self.NUMBER) == [passed_line(self.NUMBER)]

    # --- A push that created the branch: github.event.before is forty zeros ---

    def created_push(
        self, tmp_path: Path, tree: PushTree, fake: FakeSonarQube, **extra: str
    ) -> GateRun:
        return self.github_push(tmp_path, tree, fake, **{BEFORE_SHA: NO_BEFORE, **extra})

    @pytest.mark.parametrize("branch", PUSH_BRANCHES, ids=PUSH_IDS)
    @pytest.mark.parametrize("line", [EARLIER_LINE, PUSHED_LINE], ids=["earlier", "pushed"])
    @pytest.mark.parametrize("finding", ["issue", "hotspot"])
    def test_a_push_that_created_the_branch_passes_on_a_passed_branch_gate(
        self,
        tmp_path: Path,
        fake: FakeSonarQube,
        project: Project,
        branch: str,
        line: int,
        finding: str,
    ) -> None:
        # The release branch has lines origin/master lacks; no line counts as changed all the same.
        tree = self.push_tree(tmp_path, project, branch)
        fake.gate = gate_failed("new_violations")
        fake.branch_gates[branch] = gate_ok()
        if finding == "issue":
            fake.issues = {"CODE_SMELL": [issue(project, "CODE_SMELL", line)]}
        else:
            fake.hotspots = [hotspot(project, line)]

        result = self.created_push(tmp_path, tree, fake).result

        assert result.code == 0, result.lines
        assert result_lines(result, self.NUMBER) == [passed_line(self.NUMBER)]

    @pytest.mark.parametrize("branch", PUSH_BRANCHES, ids=PUSH_IDS)
    def test_a_push_that_created_the_branch_fails_on_a_failed_branch_gate_alone(
        self, tmp_path: Path, fake: FakeSonarQube, project: Project, branch: str
    ) -> None:
        # A finding on a line origin/master lacks adds no changed-line reason to the gate's.
        tree = self.push_tree(tmp_path, project, branch)
        fake.gate = gate_ok()
        fake.branch_gates[branch] = gate_failed("new_violations")
        fake.issues = {"CODE_SMELL": [issue(project, "CODE_SMELL", PUSHED_LINE)]}

        result = self.created_push(tmp_path, tree, fake, STUB_SCANNER_EXIT="1").result

        assert result.code == 1, result.lines
        assert failed_reason(result, self.NUMBER) == "quality gate: new_violations", result.lines

    @pytest.mark.parametrize("branch", PUSH_BRANCHES, ids=PUSH_IDS)
    def test_a_push_that_created_the_branch_reads_the_gate_of_the_pushed_branch(
        self, tmp_path: Path, fake: FakeSonarQube, project: Project, branch: str
    ) -> None:
        tree = self.push_tree(tmp_path, project, branch)

        self.created_push(tmp_path, tree, fake)

        reads = fake.requests_to(GATE_PATH)
        assert len(reads) == 1, fake.requests
        assert reads[0].query.get("branch") == branch, reads[0]
        assert "pullRequest" not in reads[0].query, reads[0]

    @pytest.mark.parametrize("branch", PUSH_BRANCHES, ids=PUSH_IDS)
    def test_a_push_that_created_the_branch_is_never_not_proven(
        self, tmp_path: Path, fake: FakeSonarQube, project: Project, branch: str
    ) -> None:
        # No line counts as changed, so a 0-line scan proves nothing is missing.
        tree = self.push_tree(tmp_path, project, branch)
        fake.measures["ncloc"] = "0"

        result = self.created_push(tmp_path, tree, fake).result

        assert result.code == 0, result.lines
        assert result_lines(result, self.NUMBER) == [passed_line(self.NUMBER)]
