"""Tests for the MCP report tools: the failure report and the generated run report."""

import json
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest

from tests.core.recipes.conftest import make_recipe
from tests.mcp.conftest import (
    make_failed_suite_execution,
    make_log_workflow,
    make_minimal_execution,
    make_terminal_test_execution,
)
from wavecore.api.exceptions import (
    ConflictException,
    InternalServerException,
    NotFoundException,
    ValidationException,
)
from wavecore.core.secrets.cipher import SecretCipher
from wavecore.core.secrets.masking import MASK_PLACEHOLDER

pytestmark = pytest.mark.timeout(60)

FAILURE_REPORT_KEYS = {"execution", "outcome", "counts", "failed_tests", "pending_action_items"}
EXECUTION_IDENTITY_KEYS = {
    "id",
    "name",
    "entity_type",
    "status",
    "triggered_by",
    "started_at",
    "ended_at",
}
FAILED_TEST_KEYS = {"run_id", "test_id", "name", "status", "failed_blocks", "log_excerpt"}
FAILED_BLOCK_KEYS = {"block_id", "label", "path", "error"}
COUNT_KEYS = {"total", "passed", "failed", "skipped", "stopped", "excluded", "pending"}


@pytest.fixture(autouse=True)
def _isolation(clear_execution_state: None) -> None:
    """Every test fabricates its own executions in isolated storage."""


class TestBuildFailureReport:
    def test_top_level_shape(self) -> None:
        from wavecore.api.services.reports import builder

        seeded = make_failed_suite_execution()

        report = builder.build_failure_report(seeded["execution_id"])

        assert set(report.keys()) == FAILURE_REPORT_KEYS
        assert EXECUTION_IDENTITY_KEYS.issubset(report["execution"].keys())
        assert report["execution"]["id"] == seeded["execution_id"]
        assert report["execution"]["entity_type"] == "suite"
        assert report["execution"]["triggered_by"] == "dev"
        assert report["outcome"] == "failed"
        assert report["pending_action_items"] == []

    def test_counts_cover_all_run_statuses(self) -> None:
        from wavecore.api.services.reports import builder

        seeded = make_failed_suite_execution()

        counts = builder.build_failure_report(seeded["execution_id"])["counts"]

        assert set(counts.keys()) == COUNT_KEYS
        assert counts["total"] == 3
        assert counts["passed"] == 1
        assert counts["failed"] == 1
        assert counts["skipped"] == 1
        assert counts["stopped"] == 0
        assert counts["excluded"] == 0
        assert counts["pending"] == 0

    def test_unfilled_secrets_surface_as_pending_action_items(self) -> None:
        from tests.mcp.conftest import create_test_entity
        from wavecore.api.services.reports import builder

        created = create_test_entity(
            "Pending Secret Source",
            variables={"token": {"type": "string", "secret": True}},
        )
        seeded = make_terminal_test_execution(
            "failed", test_id=created["id"], test_name="Pending Secret Source"
        )

        report = builder.build_failure_report(seeded["execution_id"])

        assert report["pending_action_items"] == [
            {
                "test_id": created["id"],
                "test_name": "Pending Secret Source",
                "step": "variables.token",
                "code": "NO_VALUE_VARIABLE",
                "problem": "Secret variable 'token' holds no value",
                "fix": "A person must fill it in before dependent definitions can run",
            }
        ]

    def test_an_empty_secret_value_is_pending(self) -> None:
        """An empty secret holds nothing, so a person still owes its value (REQ-4.5.1)."""
        from tests.mcp.conftest import create_test_entity
        from wavecore.api.services.reports import builder

        created = create_test_entity(
            "Empty Secret Source",
            variables={"token": {"type": "string", "secret": True, "value": ""}},
        )
        seeded = make_terminal_test_execution(
            "failed", test_id=created["id"], test_name="Empty Secret Source"
        )

        report = builder.build_failure_report(seeded["execution_id"])

        assert report["pending_action_items"] == [
            {
                "test_id": created["id"],
                "test_name": "Empty Secret Source",
                "step": "variables.token",
                "code": "NO_VALUE_VARIABLE",
                "problem": "Secret variable 'token' holds no value",
                "fix": "A person must fill it in before dependent definitions can run",
            }
        ]

    @pytest.mark.parametrize("imported", ["masked", "foreign"])
    def test_an_imported_secret_that_holds_null_is_pending(self, imported: str) -> None:
        """A masked export, or a secret WAVE cannot open, imports as null and is owed
        (REQ-4.5.19, EXPORT-7)."""
        from wavecore.api.services.reports import builder
        from wavecore.api.services.tests import service as test_service

        value = (
            MASK_PLACEHOLDER
            if imported == "masked"
            else SecretCipher(bytes(range(1, 33))).seal("foreign-api-token")
        )
        content = json.dumps(
            {
                "name": "Imported Secret Source",
                "workflow": make_log_workflow(),
                "variables": {"api_tok": {"type": "string", "secret": True, "value": value}},
            }
        )
        (row,) = test_service.import_tests(content.encode("utf-8"), "imported.json")["imported"]
        seeded = make_terminal_test_execution(
            "failed", test_id=row["id"], test_name="Imported Secret Source"
        )

        report = builder.build_failure_report(seeded["execution_id"])

        assert report["pending_action_items"] == [
            {
                "test_id": row["id"],
                "test_name": "Imported Secret Source",
                "step": "variables.api_tok",
                "code": "NO_VALUE_VARIABLE",
                "problem": "Secret variable 'api_tok' holds no value",
                "fix": "A person must fill it in before dependent definitions can run",
            }
        ]

    def test_filled_secrets_and_plain_variables_are_not_pending(self) -> None:
        from tests.mcp.conftest import create_test_entity
        from wavecore.api.services.reports import builder

        created = create_test_entity(
            "Filled Secret Source",
            variables={
                "token": {"type": "string", "secret": True, "value": "hunter2"},
                "base_url": {"type": "string", "value": "http://localhost"},
            },
        )
        seeded = make_terminal_test_execution(
            "failed", test_id=created["id"], test_name="Filled Secret Source"
        )

        report = builder.build_failure_report(seeded["execution_id"])

        assert report["pending_action_items"] == []

    def test_rows_without_ids_and_repeat_rows_are_skipped(self) -> None:
        from wavecore.api.services.reports import builder

        composition = {
            "suites": [
                {"tests": [{"name": "No Id Row"}, {"id": "ghost", "name": "Missing"}]},
                {"tests": [{"id": "ghost", "name": "Missing Again"}]},
            ]
        }

        assert builder._pending_action_items(composition) == []

    def test_only_failed_runs_are_reported(self) -> None:
        from wavecore.api.services.reports import builder

        seeded = make_failed_suite_execution()

        failed_tests = builder.build_failure_report(seeded["execution_id"])["failed_tests"]

        assert len(failed_tests) == 1
        row = failed_tests[0]
        assert set(row.keys()) == FAILED_TEST_KEYS
        assert row["run_id"] == seeded["run_ids"][1]
        assert row["test_id"] == seeded["test_ids"][1]
        assert row["name"] == "Bravo Fails"
        assert row["status"] == "failed"

    def test_failed_blocks_carry_label_path_and_error(self) -> None:
        from wavecore.api.services.reports import builder

        seeded = make_failed_suite_execution()

        row = builder.build_failure_report(seeded["execution_id"])["failed_tests"][0]

        assert len(row["failed_blocks"]) == 1
        block = row["failed_blocks"][0]
        assert set(block.keys()) == FAILED_BLOCK_KEYS
        assert block["block_id"] == "node-validate"
        assert block["label"] == "Validate_Stock_Levels"
        assert "Validate_Stock_Levels" in block["path"]
        assert block["error"] == (
            "Downstream validation rejected payload: expected 412 rows, got 409"
        )

    def test_log_excerpt_is_warn_and_above_only(self) -> None:
        from wavecore.api.services.reports import builder

        seeded = make_failed_suite_execution()

        excerpt = builder.build_failure_report(seeded["execution_id"])["failed_tests"][0][
            "log_excerpt"
        ]

        levels = [entry["level"] for entry in excerpt]
        assert levels == ["WARN", "ERROR", "FATAL"]
        messages = [entry["message"] for entry in excerpt]
        assert "Fetched 409 rows" not in messages
        assert "Executing 'SELECT count(*) FROM stock_levels'" not in messages

    def test_log_excerpt_carries_at_rest_masked_content(self) -> None:
        from wavecore.api.services.reports import builder

        seeded = make_failed_suite_execution()

        excerpt = builder.build_failure_report(seeded["execution_id"])["failed_tests"][0][
            "log_excerpt"
        ]

        warn_entry = next(entry for entry in excerpt if entry["level"] == "WARN")
        assert warn_entry["message"] == "Auth header rejected for token ********"

    def test_undispatched_tests_without_run_ids_are_skipped(self) -> None:
        from wavecore.api.services.executions import _storage as exec_storage
        from wavecore.api.services.reports import builder

        execution_id = make_minimal_execution("failed")
        exec_storage._save_composition(
            execution_id,
            {
                "suites": [
                    {
                        "id": None,
                        "name": "",
                        "tests": [{"id": "test-undispatched", "name": "Never Dispatched"}],
                    }
                ]
            },
        )

        report = builder.build_failure_report(execution_id)

        assert report["failed_tests"] == []

    def test_passed_execution_has_no_failed_tests(self) -> None:
        from wavecore.api.services.reports import builder

        seeded = make_terminal_test_execution(status="passed")

        report = builder.build_failure_report(seeded["execution_id"])

        assert report["outcome"] == "passed"
        assert report["failed_tests"] == []

    def test_running_execution_is_rejected_with_exact_message(self) -> None:
        from wavecore.api.services.reports import builder

        execution_id = make_minimal_execution("running")

        with pytest.raises(
            ConflictException,
            match=(
                rf"^Execution '{execution_id}' is still running; "
                r"the failure report is available when it finishes$"
            ),
        ):
            builder.build_failure_report(execution_id)

    def test_unknown_execution_raises_service_message(self) -> None:
        from wavecore.api.services.reports import builder

        with pytest.raises(NotFoundException, match=r"^Execution with ID 'ghost' not found$"):
            builder.build_failure_report("ghost")


class TestGetFailureReportTool:
    def test_returns_the_builder_projection(self) -> None:
        from wavecore.mcp.tools import report as report_tools

        seeded = make_failed_suite_execution()

        report = report_tools.get_failure_report(seeded["execution_id"])

        assert set(report.keys()) == FAILURE_REPORT_KEYS
        assert report["outcome"] == "failed"
        assert report["failed_tests"][0]["name"] == "Bravo Fails"

    def test_running_execution_error_passes_through(self) -> None:
        from wavecore.mcp.tools import report as report_tools

        execution_id = make_minimal_execution("running")

        with pytest.raises(
            ConflictException,
            match=(
                rf"^Execution '{execution_id}' is still running; "
                r"the failure report is available when it finishes$"
            ),
        ):
            report_tools.get_failure_report(execution_id)


def _failed_run_of_recipe(recipe_text: str) -> tuple[dict[str, Any], dict[str, Any]]:
    """Create a test from a recipe and seed a failed run of it."""
    from wavecore.mcp.tools import author as author_tools

    created = author_tools.create_test_from_recipe(recipe_text)
    assert created["created"] is True, created
    seeded = make_terminal_test_execution(
        "failed", test_id=created["test_id"], test_name=created["name"]
    )
    return created, seeded


class TestCaptureFilledSecretsAreNotPending:
    """A secret a block output writes is filled by the run, so no person owes it; a
    declare-empty secret nothing writes is still pending (REQ-5.2.7.3)."""

    @pytest.mark.parametrize("example_name", ["06-k8s-smoke", "07-helm-lifecycle"])
    def test_a_served_example_owes_no_session_secret(
        self, seed_registries: None, example_name: str
    ) -> None:
        from wavecore.mcp.tools import author as author_tools
        from wavecore.mcp.tools import report as report_tools

        examples = {ex["name"]: ex["recipe"] for ex in author_tools.get_recipe_guide()["examples"]}
        _created, seeded = _failed_run_of_recipe(str(examples[example_name]))

        report = report_tools.get_failure_report(seeded["execution_id"])

        assert report["pending_action_items"] == []

    def test_only_the_secret_nothing_writes_is_pending(self, seed_registries: None) -> None:
        from wavecore.mcp.tools import report as report_tools

        recipe = make_recipe(
            [
                {
                    "block": "http-client",
                    "settings": {"url": "http://shop.local/token", "method": "GET"},
                    "capture": {"body": "issued_token"},
                },
                {"block": "log", "settings": {"message": "shh"}},
            ],
            name="Report Capture Filled",
            variables={
                "issued_token": {"type": "string", "secret": True},
                "api_key": {"type": "string", "secret": True},
            },
        )
        created, seeded = _failed_run_of_recipe(recipe)

        report = report_tools.get_failure_report(seeded["execution_id"])

        assert report["pending_action_items"] == [
            {
                "test_id": created["test_id"],
                "test_name": "Report Capture Filled",
                "step": "variables.api_key",
                "code": "NO_VALUE_VARIABLE",
                "problem": "Secret variable 'api_key' holds no value",
                "fix": "A person must fill it in before dependent definitions can run",
            }
        ]


OWED_FIX = "A person must fill it in before dependent definitions can run"


class TestOwedSecretFinding:
    """One builder words every owed secret: variables, profile fields and their per
    environment values (REQ-5.2.7.12)."""

    @pytest.mark.parametrize(
        ("name", "options", "code", "problem"),
        [
            pytest.param(
                "api_tok",
                {"step": "variables.api_tok"},
                "NO_VALUE_VARIABLE",
                "Secret variable 'api_tok' holds no value",
                id="variable",
            ),
            pytest.param(
                "password",
                {"step": "config.password", "field": True},
                "NO_VALUE_SECRET",
                "Secret field 'password' holds no value",
                id="profile-field",
            ),
            pytest.param(
                "password",
                {
                    "step": "environment_values.env-staging.password",
                    "field": True,
                    "environment": "env-staging",
                },
                "NO_VALUE_SECRET",
                "Secret field 'password' holds no value for environment 'env-staging'",
                id="profile-environment-value",
            ),
        ],
    )
    def test_the_owed_finding_names_what_holds_no_value(
        self, name: str, options: dict[str, Any], code: str, problem: str
    ) -> None:
        from wavecore.api.services.reports import builder

        item = builder.owed_secret_finding(name, **options)

        assert (item["step"], item["code"], item["problem"], item["fix"]) == (
            options["step"],
            code,
            problem,
            OWED_FIX,
        )


class TestGetRunReportTool:
    async def test_json_report_is_generated_and_parsed(self) -> None:
        from wavecore.mcp.tools import report as report_tools

        seeded = make_terminal_test_execution(status="passed")

        report = await report_tools.get_run_report(seeded["execution_id"], format="json")

        assert isinstance(report, dict)
        assert report["schema_version"] == 1
        assert report["execution"]["id"] == seeded["execution_id"]
        assert {"summary", "timeline", "errors", "logs"}.issubset(report.keys())

    async def test_json_is_the_default_format(self) -> None:
        from wavecore.mcp.tools import report as report_tools

        seeded = make_terminal_test_execution(status="passed")

        report = await report_tools.get_run_report(seeded["execution_id"])

        assert isinstance(report, dict)
        assert report["schema_version"] == 1

    async def test_html_report_is_returned_as_document_text(self) -> None:
        from wavecore.mcp.tools import report as report_tools

        seeded = make_terminal_test_execution(status="passed")

        report = await report_tools.get_run_report(seeded["execution_id"], format="html")

        assert isinstance(report, str)
        assert "<html" in report.lower()

    async def test_existing_report_is_reused(self) -> None:
        from wavecore.api.services.executions import _storage as exec_storage
        from wavecore.api.services.storage_paths import get_artifacts_storage_path
        from wavecore.mcp.tools import report as report_tools

        seeded = make_terminal_test_execution(status="passed")
        execution = exec_storage._execution_storage[seeded["execution_id"]]
        canned: dict[str, Any] = {"schema_version": 1, "canned": True}
        report_path = get_artifacts_storage_path() / execution["artifact_dir"] / "report.json"
        report_path.write_text(json.dumps(canned))

        report = await report_tools.get_run_report(seeded["execution_id"], format="json")

        assert report == canned

    async def test_invalid_format_raises_service_message(self) -> None:
        from wavecore.mcp.tools import report as report_tools

        seeded = make_terminal_test_execution(status="passed")

        with pytest.raises(
            ValidationException,
            match=r"^Invalid format 'pdf': valid formats are html, json$",
        ):
            await report_tools.get_run_report(seeded["execution_id"], format="pdf")

    async def test_failed_generation_surfaces_the_job_error(self) -> None:
        from wavecore.api.services.reports import service as reports_service
        from wavecore.mcp.tools import report as report_tools

        seeded = make_terminal_test_execution(status="passed")

        with patch.object(
            reports_service.builder,
            "build_execution_report",
            side_effect=RuntimeError("disk full"),
        ):
            with pytest.raises(InternalServerException, match=r"^disk full$"):
                await report_tools.get_run_report(seeded["execution_id"], format="json")

    async def test_running_execution_is_rejected(self) -> None:
        from wavecore.mcp.tools import report as report_tools

        execution_id = make_minimal_execution("running", with_artifact_dir=True)

        with pytest.raises(
            ConflictException,
            match=(
                r"^Cannot generate report for execution in 'running' state\. "
                r"Wait for the execution to finish\.$"
            ),
        ):
            await report_tools.get_run_report(execution_id, format="json")

    async def test_unknown_execution_raises_service_message(self) -> None:
        from wavecore.mcp.tools import report as report_tools

        with pytest.raises(NotFoundException, match=r"^Execution with ID 'ghost' not found$"):
            await report_tools.get_run_report("ghost", format="json")


LOCALE_TEXT = "Grüße 測試"
STORED_REPORTS: dict[str, Any] = {
    "json": {"schema_version": 1, "note": LOCALE_TEXT},
    "html": f"<html><body>{LOCALE_TEXT}</body></html>",
}

LOCALE_CHILD = f"""\
import asyncio
import sys

from wavecore.api.services import storage_paths
from wavecore.mcp.tools import report as report_tools

TEXT = {LOCALE_TEXT!r}
STORED = {STORED_REPORTS!r}
report_format = sys.argv[3]
storage_paths.set_base_path(sys.argv[1])
report = asyncio.run(report_tools.get_run_report(sys.argv[2], format=report_format))


def answer(same):
    raise SystemExit(0 if same else 3)
"""

CHILD_READS_STORED_REPORT = f"""{LOCALE_CHILD}
answer(report == STORED[report_format])
"""

CHILD_GENERATES_REPORT = f"""{LOCALE_CHILD}
if report_format == "json":
    answer(report["execution"]["name"] == TEXT)
answer(TEXT in report)
"""


class TestGetRunReportToolLocaleIndependence:
    """Report text is UTF-8 on a WAVE host whose locale is not UTF-8 (REQ-4.6.9)."""

    @pytest.fixture
    def run_child(
        self, tmp_path: Path, temp_storage_path: Path, non_utf8_child_env: dict[str, str]
    ) -> Callable[..., subprocess.CompletedProcess[bytes]]:
        """Run source as a file in a child Python on a host that is not UTF-8."""

        def _run(source: str, *arguments: str) -> subprocess.CompletedProcess[bytes]:
            script = tmp_path / "child.py"
            script.write_text(source, encoding="utf-8")
            return subprocess.run(
                [sys.executable, str(script), str(temp_storage_path), *arguments],
                env=non_utf8_child_env,
                capture_output=True,
                timeout=30,
                check=False,
            )

        return _run

    @staticmethod
    def _report_file(execution_id: str, report_format: str) -> Path:
        from wavecore.api.services.executions import _storage as exec_storage
        from wavecore.api.services.storage_paths import get_artifacts_storage_path

        artifact_dir = exec_storage._execution_storage[execution_id]["artifact_dir"]
        return get_artifacts_storage_path() / artifact_dir / f"report.{report_format}"

    @pytest.mark.parametrize("report_format", ["json", "html"])
    def test_report_stored_as_utf8_is_returned_equal(
        self, run_child: Callable[..., subprocess.CompletedProcess[bytes]], report_format: str
    ) -> None:
        # Starts a child Python.
        seeded = make_terminal_test_execution(status="passed")
        stored = STORED_REPORTS[report_format]
        text = stored if report_format == "html" else json.dumps(stored, ensure_ascii=False)
        self._report_file(seeded["execution_id"], report_format).write_bytes(text.encode("utf-8"))

        done = run_child(CHILD_READS_STORED_REPORT, seeded["execution_id"], report_format)

        assert done.returncode == 0, done.stderr.decode("utf-8", "replace")

    @pytest.mark.parametrize("report_format", ["json", "html"])
    def test_generated_report_is_utf8_on_disk_and_returned(
        self, run_child: Callable[..., subprocess.CompletedProcess[bytes]], report_format: str
    ) -> None:
        # Starts a child Python.
        seeded = make_terminal_test_execution(status="passed", test_name=LOCALE_TEXT)

        done = run_child(CHILD_GENERATES_REPORT, seeded["execution_id"], report_format)

        assert done.returncode == 0, done.stderr.decode("utf-8", "replace")
        written = self._report_file(seeded["execution_id"], report_format).read_bytes()
        if report_format == "json":
            assert json.loads(written.decode("utf-8"))["execution"]["name"] == LOCALE_TEXT
        else:
            assert LOCALE_TEXT in written.decode("utf-8")


def _owed(
    owner: dict[str, Any], step: str, name: str, *, field: bool = False, environment: str = ""
) -> dict[str, Any]:
    """One pending item: its owner's keys, its place, and the owed wording."""
    if field:
        where = f" for environment '{environment}'" if environment else ""
        problem = f"Secret field '{name}' holds no value{where}"
    else:
        problem = f"Secret variable '{name}' holds no value"
    code = "NO_VALUE_SECRET" if field else "NO_VALUE_VARIABLE"
    return {**owner, "step": step, "code": code, "problem": problem, "fix": OWED_FIX}


def _http_block(block_id: str, **values: Any) -> dict[str, Any]:
    return {
        "id": block_id,
        "type": "workflowNode",
        "data": {
            "label": block_id,
            "elementType": "http-client",
            "nodeType": "plugin",
            "version": "1.0.0",
            "config": {"values": {"method": "GET", "url": "http://shop.local", **values}},
        },
    }


def _import_test(document: dict[str, Any]) -> dict[str, Any]:
    from wavecore.api.services.tests import service as test_service

    content = json.dumps({"workflow": {"nodes": [], "edges": []}, **document})
    (row,) = test_service.import_tests(content.encode("utf-8"), "owed.json")["imported"]
    return {"id": row["id"], "name": document["name"]}


def _import_profile(document: dict[str, Any]) -> dict[str, Any]:
    from wavecore.api.services.profiles import import_export as profile_import

    content = json.dumps(document).encode("utf-8")
    (row,) = profile_import.import_profiles(content, "owed.json")["imported"]
    return {"id": row["id"]}


def _test_composition(*rows: dict[str, Any], suite: dict[str, Any] | None = None) -> dict[str, Any]:
    tests = [{"id": row["id"], "name": row["name"], "run_id": row["id"]} for row in rows]
    return {"suites": [{**(suite or {"id": None, "name": ""}), "tests": tests}]}


@pytest.mark.usefixtures("seed_registries")
class TestPendingActionItemsOfEveryHolder:
    """Every secret an execution's definitions hold that holds nothing is pending: a Test's
    block settings, its Suite and Regression variables, the System variables it reads, the
    profiles it binds and the library Functions it calls (REQ-5.2.7.11, REQ-4.5.19)."""

    def test_a_setter_row_and_a_credential_an_import_left_null_are_pending(self) -> None:
        from wavecore.api.services.reports import builder

        setter = {
            "id": "set-secret",
            "type": "workflowNode",
            "data": {
                "label": "Set",
                "elementType": "variable-setter",
                "nodeType": "control",
                "version": "1.0.0",
                "variableTypes": {"api_tok": "string"},
                "config": {
                    "values": {"variables": {"api_tok": MASK_PLACEHOLDER}},
                    "variableSecretKeys": ["api_tok"],
                },
            },
        }
        http = _http_block(
            "http",
            auth_enabled=True,
            auth_mode="basic",
            auth_username="wave",
            auth_password=MASK_PLACEHOLDER,
        )
        row = _import_test(
            {
                "name": "Owed Block Settings",
                "workflow": {"nodes": [setter, http], "edges": []},
                "variables": {"api_tok": {"type": "string", "secret": True, "value": None}},
            }
        )
        owner = {"test_id": row["id"], "test_name": row["name"]}

        items = builder._pending_action_items(_test_composition(row))

        assert items == [
            _owed(owner, "blocks.set-secret.variables.api_tok", "api_tok"),
            _owed(owner, "blocks.http.auth_password", "auth_password", field=True),
        ]

    def test_the_suites_and_the_regressions_variables_are_pending(self) -> None:
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.reports import builder
        from wavecore.api.services.suites import service as suite_service

        owed = {"type": "string", "secret": True, "value": None}
        suite = suite_service.create_suite({"name": "Owed Suite", "variables": {"suite_tok": owed}})
        regression = regression_service.create_regression(
            {"name": "Owed Regression", "suites": [suite["id"]], "variables": {"reg_tok": owed}}
        )
        composition = {"suites": [{"id": suite["id"], "name": "Owed Suite", "tests": []}]}
        detail = {"entity_type": "regression", "entity_id": regression["id"]}

        items = builder._pending_action_items(composition, detail)

        assert items == [
            _owed(
                {"suite_id": suite["id"], "suite_name": "Owed Suite"},
                "variables.suite_tok",
                "suite_tok",
            ),
            _owed(
                {"regression_id": regression["id"], "regression_name": "Owed Regression"},
                "variables.reg_tok",
                "reg_tok",
            ),
        ]

    def test_only_a_system_variable_the_test_reads_is_pending(self) -> None:
        from wavecore.api.services import variable_service
        from wavecore.api.services.reports import builder

        owed = {"type": "string", "secret": True, "value": None}
        variable_service.set_system_variables({"read_tok": owed, "unread_tok": owed})
        log = {
            "id": "log",
            "type": "workflowNode",
            "data": {
                "label": "Log",
                "elementType": "log",
                "nodeType": "plugin",
                "version": "1.0.0",
                "expressionFields": ["message"],
                "config": {"values": {"message": "system.read_tok + system.missing_tok"}},
            },
        }
        row = _import_test({"name": "Reads System", "workflow": {"nodes": [log], "edges": []}})

        items = builder._pending_action_items(_test_composition(row))

        assert items == [_owed({}, "system.read_tok", "read_tok")]

    def test_a_bound_profile_is_pending_for_its_defaults_and_the_runs_environment(self) -> None:
        from wavecore.api.services.environments import service as environment_service
        from wavecore.api.services.reports import builder

        run_env = environment_service.create_environment("Owed Run Env")
        environment_service.create_environment("Owed Other Env")
        masked = {"auth_username": "wave", "auth_password": MASK_PLACEHOLDER}
        bound = _import_profile(
            {
                "name": "Owed Profile",
                "type": "http",
                "config": masked,
                "environment_values": {"Owed Run Env": masked, "Owed Other Env": masked},
            }
        )
        defaults_only = _import_profile(
            {"name": "Owed Defaults Only", "type": "http", "config": masked}
        )
        bindings = [
            {"profileId": bound["id"], "alias": "a"},
            {"profileId": bound["id"], "alias": "b"},
            {"profileId": defaults_only["id"], "alias": "c"},
            {"profileId": "", "alias": "d"},
            {"profileId": "ghost-profile", "alias": "e"},
        ]
        block = _http_block("http")
        block["data"]["config"]["profileBindings"] = bindings
        row = _import_test({"name": "Binds Profiles", "workflow": {"nodes": [block], "edges": []}})
        detail = {"entity_type": "test", "environment_id": run_env["id"]}

        items = builder._pending_action_items(_test_composition(row), detail)

        profile = {"profile_id": bound["id"], "profile_name": "Owed Profile"}
        defaults = {"profile_id": defaults_only["id"], "profile_name": "Owed Defaults Only"}
        assert items == [
            _owed(profile, "config.auth_password", "auth_password", field=True),
            _owed(
                profile,
                "environment_values.Owed Run Env.auth_password",
                "auth_password",
                field=True,
                environment="Owed Run Env",
            ),
            _owed(defaults, "config.auth_password", "auth_password", field=True),
        ]

    def test_a_suite_or_regression_that_is_gone_owes_nothing(self) -> None:
        from wavecore.api.services.reports import builder

        composition = {"suites": [{"id": "ghost-suite", "name": "Gone", "tests": []}]}
        detail = {"entity_type": "regression", "entity_id": "ghost-regression"}

        assert builder._pending_action_items(composition, detail) == []

    def test_a_called_library_function_is_pending_once_with_what_it_calls(self) -> None:
        from tests.functions.conftest import make_function_payload
        from wavecore.api.services.functions import service as function_service
        from wavecore.api.services.reports import builder

        callee, _etag = function_service.create_function(
            make_function_payload(
                name="OwedCallee",
                workflow=_entry_workflow(_http_block("fn-http", auth_password="real-password")),
            )
        )
        callee = _reimport_masked_function(callee["id"])
        caller, _etag = function_service.create_function(
            make_function_payload(
                name="OwedCaller",
                variables=[{"name": "local_tok", "type": "string", "secret": True, "value": None}],
                workflow=_entry_workflow(_library_call("inner", callee["id"], None)),
            )
        )
        nodes = [
            _library_call("first", caller["id"], "1.0.0"),
            _library_call("again", caller["id"], "1.0.0"),
            _library_call("ghost", "ghost-function", None),
        ]
        row = _import_test({"name": "Calls Functions", "workflow": {"nodes": nodes, "edges": []}})

        items = builder._pending_action_items(_test_composition(row))

        outer = {
            "function_id": caller["id"],
            "function_name": "OwedCaller",
            "function_version": "1.0.0",
        }
        inner = {
            "function_id": callee["id"],
            "function_name": "OwedCallee",
            "function_version": "1.0.0",
        }
        assert items == [
            _owed(outer, "variables.local_tok", "local_tok"),
            _owed(inner, "blocks.fn-http.auth_password", "auth_password", field=True),
        ]


def _reimport_masked_function(function_id: str) -> dict[str, Any]:
    """The library Function as a masked export brings it back: its secrets now hold null."""
    from wavecore.api.services.functions import import_export as function_import
    from wavecore.api.services.functions import service as function_service

    exported, filename, _type = function_import.export_function(
        function_id, fmt="json", secrets="mask"
    )
    function_service.delete_function(function_id)
    (row,) = function_import.import_functions(exported, filename, {})["imported"]
    return {"id": row["id"]}


def _entry_workflow(block: dict[str, Any]) -> dict[str, Any]:
    edge = {"id": f"e-{block['id']}", "source": "start-node", "target": block["id"]}
    return {"nodes": [block], "edges": [edge]}


def _library_call(block_id: str, function_id: str, version: str | None) -> dict[str, Any]:
    data: dict[str, Any] = {
        "label": block_id,
        "elementType": "function",
        "nodeType": "function",
        "functionLifecycle": "shared",
        "functionId": function_id,
        "version": "1.0.0",
        "config": {"values": {}, "outputBindings": {}, "profileBindings": []},
    }
    if version:
        data["functionVersion"] = version
    return {"id": block_id, "type": "workflowNode", "data": data}
