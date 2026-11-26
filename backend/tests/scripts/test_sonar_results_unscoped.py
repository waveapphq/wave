"""Tests for the SonarQube results scripts when no branch is known, as on a GitHub Actions runner.

There the scripts read the project with no branch and no pull request on any read, and a detached
HEAD does not stop them.
"""

from collections.abc import Iterator
from pathlib import Path

import pytest

from tests.scripts.sonar_results_support import (
    BACKEND,
    FRONTEND,
    ORGANIZATION,
    RULES_PATH,
    SCOPED_PATHS,
    FakeSonarQube,
    Project,
    Tree,
    dashboard,
    lines_of_code,
    run_results,
    start_fake,
)


@pytest.fixture(params=[BACKEND, FRONTEND], ids=["backend", "frontend"])
def project(request: pytest.FixtureRequest) -> Project:
    return request.param


@pytest.fixture
def fake(project: Project) -> Iterator[FakeSonarQube]:
    fake, server = start_fake(project)
    yield fake
    server.shutdown()
    server.server_close()


@pytest.fixture
def tree(tmp_path: Path, project: Project) -> Tree:
    return Tree(tmp_path, project)


@pytest.mark.parametrize("detached", [False, True], ids=["branch", "detached"])
def test_github_actions_run_reads_the_project_with_no_branch(
    tmp_path: Path, tree: Tree, fake: FakeSonarQube, project: Project, detached: bool
) -> None:
    tree.branch()
    if detached:
        tree.repo.detach()
    got = run_results(tmp_path, tree, fake, "--fix", GITHUB_ACTIONS="true")
    assert got.code == 0, "\n".join(got.lines)
    assert lines_of_code("1,234") in got.lines
    assert "  Bugs (1):" in got.lines
    assert dashboard(project, {}) in got.lines
    for path in SCOPED_PATHS[:5]:
        assert fake.requests_to(path), f"no read of {path}"
    for request in fake.requests:
        assert "branch" not in request.query, request
        assert "pullRequest" not in request.query, request
    rules = fake.requests_to(RULES_PATH)
    assert rules, "no rule read with --fix"
    for request in rules:
        assert request.query.get("organization") == ORGANIZATION, request
