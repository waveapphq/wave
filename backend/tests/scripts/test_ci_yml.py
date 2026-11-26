"""Tests for .github/workflows/ci.yml: the gate's jobs, their names, stages, needs and skips."""

import re
from typing import Any

import pytest
import yaml

from tests.scripts.gate_support import gate_file
from tests.scripts.script_support import CLONE

WORKFLOWS = CLONE / ".github" / "workflows"
CHANGES = "00 Changes"
STAGE_1 = [
    "01 Branch name",
    "02 Grammar and Comments",
    "03 Orphaned files and exclusion IDs",
    "04 Backend static",
    "05 Frontend static",
    "06 E2E types",
]
STAGE_2 = ["07 Frontend build", "08 Backend tests", "09 Frontend tests"]
SONAR = {"10 SonarQube backend": "08 Backend tests", "11 SonarQube frontend": "09 Frontend tests"}
SONAR_EXCLUSIONS = "13 SonarQube exclusions"
CODEQL_EXCLUSIONS = "14 CodeQL exclusions"
NAMES = [CHANGES, *STAGE_1, *STAGE_2, *SONAR, SONAR_EXCLUSIONS, CODEQL_EXCLUSIONS]
SKIPPABLE = [name for name in NAMES if name not in (CHANGES, "01 Branch name")]
WAITING = [*STAGE_2, *SONAR, SONAR_EXCLUSIONS]
BRANCHES = ["master", "release/**"]
# always() or GitHub's check for a canceled run, its name built so the spell check skips it.
STATUS_FUNCTION = re.compile(r"\b(always|" + "cancel" + r"led)\(\)")


def load() -> dict[str, Any]:
    data = yaml.safe_load((WORKFLOWS / "ci.yml").read_text(encoding="utf-8"))
    assert isinstance(data, dict)
    return data


WORKFLOW = load()
JOBS: dict[str, dict[str, Any]] = WORKFLOW.get("jobs", {})
KEYS = {job.get("name", key): key for key, job in JOBS.items()}


def job(name: str) -> dict[str, Any]:
    return JOBS.get(KEYS.get(name, ""), {})


def needs(name: str) -> set[str]:
    """The names of the jobs a job waits for."""
    found = job(name).get("needs", [])
    keys = [found] if isinstance(found, str) else found
    by_key = {key: name for name, key in KEYS.items()}
    return {by_key.get(key, key) for key in keys}


def condition(name: str) -> str:
    return str(job(name).get("if", ""))


def runs(name: str) -> str:
    """Every run line of a job's steps, joined."""
    return "\n".join(str(step.get("run", "")) for step in job(name).get("steps", []))


def uses(name: str, action: str) -> list[dict[str, Any]]:
    """The steps of a job that use one action, at any version."""
    return [
        s for s in job(name).get("steps", []) if str(s.get("uses", "")).startswith(action + "@")
    ]


def triggers() -> dict[str, Any]:
    # YAML 1.1 reads the key `on` as true.
    found = WORKFLOW.get("on", WORKFLOW.get(True, {}))
    assert isinstance(found, dict)
    return found


class TestTriggers:
    """Pull requests into master and release/**, and pushes to them."""

    @pytest.mark.parametrize("event", ["pull_request", "push"])
    def test_the_event_covers_master_and_the_release_branches(self, event: str) -> None:
        assert triggers().get(event, {}).get("branches") == BRANCHES


class TestJobs:
    """Exactly the gate's jobs, by their exact names."""

    def test_the_job_names_are_exact(self) -> None:
        assert sorted(KEYS) == sorted(NAMES)

    def test_codeql_itself_is_no_job(self) -> None:
        assert not [name for name in KEYS if name.startswith("12 ")]

    @pytest.mark.parametrize("name", [n for n in NAMES if n != CHANGES])
    def test_each_job_calls_its_gate_script(self, name: str) -> None:
        script = f"scripts/gate/{gate_file(int(name[:2]))}"

        assert script in runs(name), runs(name)

    def test_the_branch_name_job_checks_the_pull_request_branches(self) -> None:
        assert re.search(
            r'^\./scripts/gate/01-branch-name\.sh --pr "\$HEAD" "\$BASE"$',
            runs("01 Branch name"),
            re.M,
        )


class TestStages:
    """Each stage waits for the one before it."""

    def test_the_changes_job_waits_for_nothing(self) -> None:
        assert needs(CHANGES) == set()

    @pytest.mark.parametrize("name", STAGE_1)
    def test_a_stage_1_job_waits_only_for_the_changes(self, name: str) -> None:
        assert needs(name) == {CHANGES}

    @pytest.mark.parametrize("name", STAGE_2)
    def test_a_stage_2_job_waits_for_every_stage_1_job(self, name: str) -> None:
        assert set(STAGE_1) <= needs(name), needs(name)

    @pytest.mark.parametrize(("name", "tests"), list(SONAR.items()))
    def test_a_sonarqube_job_waits_for_its_tests(self, name: str, tests: str) -> None:
        assert tests in needs(name), needs(name)

    def test_the_sonarqube_exclusions_wait_for_both_scans(self) -> None:
        assert set(SONAR) <= needs(SONAR_EXCLUSIONS), needs(SONAR_EXCLUSIONS)

    def test_the_codeql_exclusions_wait_for_the_changes(self) -> None:
        assert CHANGES in needs(CODEQL_EXCLUSIONS)

    def test_the_codeql_exclusions_run_alongside_the_stages(self) -> None:
        staged = set(STAGE_1) | set(STAGE_2) | set(SONAR) | {SONAR_EXCLUSIONS}

        assert not needs(CODEQL_EXCLUSIONS) & staged


class TestSkips:
    """A job the change does not need is skipped through `if:` on the changes job's outputs."""

    def test_the_changes_job_has_outputs(self) -> None:
        assert job(CHANGES).get("outputs"), job(CHANGES)

    @pytest.mark.parametrize("name", [n for n in SKIPPABLE if n != SONAR_EXCLUSIONS])
    def test_the_job_reads_the_changes_outputs(self, name: str) -> None:
        assert f"needs.{KEYS.get(CHANGES)}.outputs." in condition(name), condition(name)

    @pytest.mark.parametrize("name", SKIPPABLE)
    def test_every_output_read_exists(self, name: str) -> None:
        read = re.findall(
            rf"needs\.{re.escape(str(KEYS.get(CHANGES)))}\.outputs\.([\w-]+)", condition(name)
        )
        outputs = job(CHANGES).get("outputs", {})

        assert set(read) <= set(outputs), (read, outputs)

    @pytest.mark.parametrize("name", WAITING)
    def test_a_job_still_runs_when_a_job_it_waits_for_was_skipped(self, name: str) -> None:
        # Without a status function, GitHub skips a job whose needed job was skipped.
        assert STATUS_FUNCTION.search(condition(name)), condition(name)


class TestCoverageArtifacts:
    """Each test job hands its coverage to its SonarQube job as an artifact."""

    @pytest.mark.parametrize(("sonar", "tests"), list(SONAR.items()))
    def test_the_test_job_uploads_an_artifact(self, sonar: str, tests: str) -> None:
        assert len(uses(tests, "actions/upload-artifact")) == 1, job(tests)

    @pytest.mark.parametrize(("sonar", "tests"), list(SONAR.items()))
    def test_the_sonarqube_job_downloads_the_same_artifact(self, sonar: str, tests: str) -> None:
        uploaded = [s.get("with", {}).get("name") for s in uses(tests, "actions/upload-artifact")]
        downloaded = [
            s.get("with", {}).get("name") for s in uses(sonar, "actions/download-artifact")
        ]

        assert uploaded == downloaded, (uploaded, downloaded)

    def test_the_two_artifacts_have_their_own_names(self) -> None:
        names = {
            s.get("with", {}).get("name")
            for tests in SONAR.values()
            for s in uses(tests, "actions/upload-artifact")
        }

        assert len(names) == len(SONAR), names


class TestOtherWorkflows:
    """The branch name workflow is folded into ci.yml; the docs check stays its own workflow."""

    def test_the_branch_name_workflow_is_gone(self) -> None:
        assert not (WORKFLOWS / "branch-name.yml").exists()

    def test_the_docs_check_stays(self) -> None:
        assert (WORKFLOWS / "docs-check.yml").is_file()
