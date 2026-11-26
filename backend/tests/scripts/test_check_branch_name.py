"""Where scripts/check-branch-name.sh runs: the fast checks and the GitHub Branch name check."""

import re
from pathlib import Path

from tests.scripts.script_support import CLONE

CHECK = "check-branch-name.sh"
LOCAL_CIS = ["ci-backend-local.sh", "ci-frontend-local.sh", "ci-playwright-local.sh"]


def callers(folder: Path, pattern: str) -> list[str]:
    """Names of the files in a folder whose text names the branch name check."""
    return sorted(
        path.name
        for path in folder.glob(pattern)
        if path.is_file() and path.name != CHECK and CHECK in path.read_text(encoding="utf-8")
    )


class TestLocalCallers:
    """Among the local scripts, only the fast checks run the branch name check."""

    def test_only_the_fast_checks_run_it(self) -> None:
        assert callers(CLONE / "scripts", "*.sh") == ["ci-checks-local.sh"]

    def test_no_local_ci_runs_it(self) -> None:
        for name in LOCAL_CIS:
            text = (CLONE / "scripts" / name).read_text(encoding="utf-8")
            assert CHECK not in text, name

    def test_the_fast_checks_run_it_as_the_branch_name_check(self) -> None:
        text = (CLONE / "scripts" / "ci-checks-local.sh").read_text(encoding="utf-8")
        assert re.search(
            r'^host_check "Branch name" "\$SCRIPT_DIR/check-branch-name\.sh"$', text, re.M
        )


class TestGitHubCallers:
    """Only the GitHub Branch name check runs it; no job of the GitHub CI does."""

    def test_only_the_branch_name_workflow_runs_it(self) -> None:
        workflows = CLONE / ".github" / "workflows"
        assert callers(workflows, "*.yml") + callers(workflows, "*.yaml") == ["branch-name.yml"]

    def test_the_ci_workflow_does_not_run_it(self) -> None:
        text = (CLONE / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
        assert CHECK not in text

    def test_the_branch_name_workflow_checks_the_pull_request_branches(self) -> None:
        text = (CLONE / ".github" / "workflows" / "branch-name.yml").read_text(encoding="utf-8")
        assert re.search(r"^name: Branch name$", text, re.M)
        assert re.search(
            r'^\s+run: \./scripts/check-branch-name\.sh --pr "\$HEAD" "\$BASE"$', text, re.M
        )
