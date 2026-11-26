"""Tests for scripts/sonar-results-backend.sh with a fake SonarQube Cloud and no network."""

from pathlib import Path

import pytest

from tests.scripts.sonar_results_support import (
    BACKEND,
    FakeSonarQube,
    Project,
    SonarResultsCases,
    Tree,
)


@pytest.fixture
def project() -> Project:
    return BACKEND


class TestSonarResultsBackend(SonarResultsCases):
    """The findings, the quality gate, --pr and the 0-line check of the backend project."""

    def test_python_files_under_backend_count(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube, project: Project
    ) -> None:
        self.check_counted(
            tmp_path,
            tree,
            fake,
            project,
            counted=["backend/wavecore/app.py", "backend/scripts/new.py"],
            ignored=[],
        )

    def test_other_files_and_python_outside_backend_do_not_count(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube, project: Project
    ) -> None:
        self.check_counted(
            tmp_path,
            tree,
            fake,
            project,
            counted=["backend/wavecore/plugins/new.py"],
            ignored=[
                "backend/README.md",
                "backend/pyproject.toml",
                "backend/wavecore/data.json",
                "scripts/tool.py",
                "frontend/src/tool.py",
                "frontend/src/app.ts",
            ],
        )

    def test_only_non_python_changes_pass_with_the_no_code_note(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube, project: Project
    ) -> None:
        self.check_counted(
            tmp_path,
            tree,
            fake,
            project,
            counted=[],
            ignored=["backend/README.md", "scripts/tool.py", "frontend/src/app.ts"],
        )
