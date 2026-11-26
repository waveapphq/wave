"""Tests for scripts/sonar-results-frontend.sh with a fake SonarQube Cloud and no network."""

from pathlib import Path

import pytest

from tests.scripts.sonar_results_support import (
    FRONTEND,
    FakeSonarQube,
    Project,
    SonarResultsCases,
    Tree,
)


@pytest.fixture
def project() -> Project:
    return FRONTEND


class TestSonarResultsFrontend(SonarResultsCases):
    """The findings, the quality gate, --pr and the 0-line check of the frontend project."""

    @pytest.mark.parametrize("suffix", [".ts", ".tsx", ".js", ".jsx", ".mjs"])
    def test_each_typescript_or_javascript_ending_under_frontend_counts(
        self,
        tmp_path: Path,
        tree: Tree,
        fake: FakeSonarQube,
        project: Project,
        suffix: str,
    ) -> None:
        self.check_counted(
            tmp_path,
            tree,
            fake,
            project,
            counted=[f"frontend/src/new{suffix}"],
            ignored=[],
        )

    def test_every_ending_counts_in_one_list(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube, project: Project
    ) -> None:
        self.check_counted(
            tmp_path,
            tree,
            fake,
            project,
            counted=[
                "frontend/src/app.ts",
                "frontend/src/view.tsx",
                "frontend/tests/view.test.js",
                "frontend/src/legacy.jsx",
                "frontend/vite.config.mjs",
            ],
            ignored=[],
        )

    def test_other_files_and_code_outside_frontend_do_not_count(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube, project: Project
    ) -> None:
        self.check_counted(
            tmp_path,
            tree,
            fake,
            project,
            counted=["frontend/src/new.tsx"],
            ignored=[
                "frontend/src/styles.css",
                "frontend/package.json",
                "frontend/README.md",
                "frontend/src/tool.py",
                "tests/e2e/helpers/new.ts",
                "backend/wavecore/app.py",
            ],
        )

    def test_only_non_code_changes_pass_with_the_no_code_note(
        self, tmp_path: Path, tree: Tree, fake: FakeSonarQube, project: Project
    ) -> None:
        self.check_counted(
            tmp_path,
            tree,
            fake,
            project,
            counted=[],
            ignored=[
                "frontend/src/styles.css",
                "tests/e2e/helpers/new.ts",
                "backend/wavecore/app.py",
            ],
        )
