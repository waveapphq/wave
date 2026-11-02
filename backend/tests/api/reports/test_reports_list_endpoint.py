"""Unit tests for the execution-centric report listing endpoint (REQ-5.2.4.13).

GET /reports lists one row per execution eligible for reporting (every
execution not currently running or paused), joined with the latest report
artifact metadata per format. Filter values are validated strictly with
exact error messages, unlike the lenient executions list.
"""

import os
import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from tests.api.reports.conftest import (
    artifact_dir_path,
    iso,
    make_minimal_execution,
    make_test_execution,
)

GENERATED_AT = datetime(2026, 6, 10, 11, 30, 0, tzinfo=UTC)


def _write_report_file(
    artifact_dir: str,
    filename: str,
    *,
    content: str = "{}",
    mtime: datetime | None = None,
) -> Path:
    path = artifact_dir_path(artifact_dir) / filename
    path.write_text(content)
    if mtime is not None:
        stamp = mtime.timestamp()
        os.utime(path, (stamp, stamp))
    return path


def _rows(response: Any) -> list[dict[str, Any]]:
    return response.json()["data"]


def _names(response: Any) -> list[str]:
    return [row["execution"]["name"] for row in _rows(response)]


class TestReportsListRowShape:
    """Row shape: trimmed execution summary + per-format report slots."""

    def test_row_contains_trimmed_execution_and_report_slots(self, client: TestClient) -> None:
        record = make_test_execution()

        response = client.get("/reports")

        assert response.status_code == 200
        body = response.json()
        assert body["success"] is True
        assert "meta" in body
        rows = body["data"]
        assert len(rows) == 1
        row = rows[0]
        assert set(row.keys()) == {"execution", "reports"}
        assert row["execution"] == {
            "id": record["execution_id"],
            "name": "Inventory Sync Validation",
            "entity_type": "test",
            "entity_id": record["test_id"],
            "status": "passed",
            "triggered_by": "dev",
            "started_at": iso(0.0),
            "ended_at": iso(4.0),
            "duration": 4,
        }
        assert set(row["reports"].keys()) == {"json", "html"}
        assert row["reports"]["json"] is None
        assert row["reports"]["html"] is None

    def test_empty_listing_returns_no_rows(self, client: TestClient) -> None:
        response = client.get("/reports")

        assert response.status_code == 200
        assert _rows(response) == []
        assert response.json()["pagination"] == {
            "total": 0,
            "page": 1,
            "per_page": 20,
            "total_pages": 0,
        }

    def test_json_report_metadata_joined(self, client: TestClient) -> None:
        record = make_test_execution()
        content = '{"summary": {}}'
        _write_report_file(
            record["artifact_dir"], "report.json", content=content, mtime=GENERATED_AT
        )

        response = client.get("/reports")

        reports = _rows(response)[0]["reports"]
        assert reports["json"] == {
            "artifact_id": f"{record['artifact_dir']}/report.json",
            "size_bytes": len(content.encode("utf-8")),
            "generated_at": "2026-06-10T11:30:00+00:00",
        }
        assert reports["html"] is None

    def test_html_report_metadata_joined(self, client: TestClient) -> None:
        record = make_test_execution()
        content = "<html></html>"
        _write_report_file(
            record["artifact_dir"], "report.html", content=content, mtime=GENERATED_AT
        )

        response = client.get("/reports")

        reports = _rows(response)[0]["reports"]
        assert reports["json"] is None
        assert reports["html"] == {
            "artifact_id": f"{record['artifact_dir']}/report.html",
            "size_bytes": len(content.encode("utf-8")),
            "generated_at": "2026-06-10T11:30:00+00:00",
        }

    def test_both_formats_joined_independently(self, client: TestClient) -> None:
        record = make_test_execution()
        _write_report_file(record["artifact_dir"], "report.json")
        _write_report_file(record["artifact_dir"], "report.html")

        response = client.get("/reports")

        reports = _rows(response)[0]["reports"]
        assert reports["json"]["artifact_id"] == f"{record['artifact_dir']}/report.json"
        assert reports["html"]["artifact_id"] == f"{record['artifact_dir']}/report.html"

    def test_non_report_files_are_ignored(self, client: TestClient) -> None:
        record = make_test_execution()
        _write_report_file(record["artifact_dir"], "screenshot.png", content="png")
        _write_report_file(record["artifact_dir"], "summary.html", content="<html></html>")
        _write_report_file(record["artifact_dir"], "data.json", content="{}")

        response = client.get("/reports")

        reports = _rows(response)[0]["reports"]
        assert reports["json"] is None
        assert reports["html"] is None

    def test_missing_artifact_dir_yields_null_reports(self, client: TestClient) -> None:
        make_minimal_execution("passed", with_artifact_dir=False)

        response = client.get("/reports")

        rows = _rows(response)
        assert len(rows) == 1
        assert rows[0]["reports"] == {"json": None, "html": None}

    def test_wiped_artifact_dir_yields_null_reports(self, client: TestClient) -> None:
        record = make_test_execution()
        shutil.rmtree(artifact_dir_path(record["artifact_dir"]))

        response = client.get("/reports")

        rows = _rows(response)
        assert len(rows) == 1
        assert rows[0]["reports"] == {"json": None, "html": None}


class TestReportsListScope:
    """Rows cover exactly the executions the generation endpoint accepts."""

    def test_running_and_paused_executions_are_excluded(self, client: TestClient) -> None:
        listed_id = make_minimal_execution("passed")
        make_minimal_execution("running")
        make_minimal_execution("paused")

        response = client.get("/reports")

        rows = _rows(response)
        assert [row["execution"]["id"] for row in rows] == [listed_id]
        assert response.json()["pagination"]["total"] == 1

    def test_terminal_and_skipped_statuses_are_included(self, client: TestClient) -> None:
        for status in ("passed", "failed", "stopped", "skipped"):
            make_minimal_execution(status, name=f"Exec {status}")

        response = client.get("/reports")

        statuses = sorted(row["execution"]["status"] for row in _rows(response))
        assert statuses == ["failed", "passed", "skipped", "stopped"]
        assert response.json()["pagination"]["total"] == 4


class TestReportsListFilters:
    """Standard list filters mirroring the executions list conventions."""

    def test_search_matches_name_case_insensitive(self, client: TestClient) -> None:
        make_minimal_execution("passed", name="Nightly API Suite")
        make_minimal_execution("passed", name="Inventory Sync Validation")

        response = client.get("/reports", params={"search": "nightly"})

        assert _names(response) == ["Nightly API Suite"]

    def test_search_matches_triggered_by(self, client: TestClient) -> None:
        make_minimal_execution("passed", name="Alpha", triggered_by="qa-bot")
        make_minimal_execution("passed", name="Beta", triggered_by="dev")

        response = client.get("/reports", params={"search": "qa-bot"})

        assert _names(response) == ["Alpha"]

    def test_status_filter_csv(self, client: TestClient) -> None:
        make_minimal_execution("passed", name="Passed Exec")
        make_minimal_execution("failed", name="Failed Exec")
        make_minimal_execution("stopped", name="Stopped Exec")

        response = client.get("/reports", params={"status": "passed,failed"})

        statuses = sorted(row["execution"]["status"] for row in _rows(response))
        assert statuses == ["failed", "passed"]

    def test_status_filter_tolerates_whitespace_and_empty_segments(
        self, client: TestClient
    ) -> None:
        make_minimal_execution("passed", name="Passed Exec")
        make_minimal_execution("failed", name="Failed Exec")

        response = client.get("/reports", params={"status": " passed, ,"})

        assert _names(response) == ["Passed Exec"]

    def test_type_filter_csv(self, client: TestClient) -> None:
        make_minimal_execution("passed", name="Test Exec", entity_type="test")
        make_minimal_execution("passed", name="Suite Exec", entity_type="suite")
        make_minimal_execution("passed", name="Regression Exec", entity_type="regression")

        response = client.get("/reports", params={"type": "suite,regression"})

        types = sorted(row["execution"]["entity_type"] for row in _rows(response))
        assert types == ["regression", "suite"]

    def test_triggered_by_filter_csv(self, client: TestClient) -> None:
        make_minimal_execution("passed", name="Alpha", triggered_by="alice")
        make_minimal_execution("passed", name="Beta", triggered_by="bob")
        make_minimal_execution("passed", name="Gamma", triggered_by="carol")

        response = client.get("/reports", params={"triggered_by": "alice,carol"})

        users = sorted(row["execution"]["triggered_by"] for row in _rows(response))
        assert users == ["alice", "carol"]

    def test_date_window_filters_on_started_at(self, client: TestClient) -> None:
        make_minimal_execution("passed", name="Early", started_offset=0.0)
        make_minimal_execution("passed", name="Middle", started_offset=100.0)
        make_minimal_execution("passed", name="Late", started_offset=200.0)

        response = client.get("/reports", params={"from_date": iso(50.0), "to_date": iso(150.0)})

        assert _names(response) == ["Middle"]


class TestReportsListSorting:
    """Sort fields and order, defaulting to started_at desc."""

    def test_default_sort_is_started_at_desc(self, client: TestClient) -> None:
        make_minimal_execution("passed", name="Oldest", started_offset=0.0)
        make_minimal_execution("passed", name="Newest", started_offset=20.0)
        make_minimal_execution("passed", name="Middle", started_offset=10.0)

        response = client.get("/reports")

        assert _names(response) == ["Newest", "Middle", "Oldest"]

    def test_sort_started_at_asc(self, client: TestClient) -> None:
        make_minimal_execution("passed", name="Oldest", started_offset=0.0)
        make_minimal_execution("passed", name="Newest", started_offset=20.0)

        response = client.get("/reports", params={"sort": "started_at", "order": "asc"})

        assert _names(response) == ["Oldest", "Newest"]

    def test_sort_name_asc_is_case_insensitive(self, client: TestClient) -> None:
        make_minimal_execution("passed", name="beta")
        make_minimal_execution("passed", name="Alpha")
        make_minimal_execution("passed", name="gamma")

        response = client.get("/reports", params={"sort": "name", "order": "asc"})

        assert _names(response) == ["Alpha", "beta", "gamma"]

    def test_sort_status_asc(self, client: TestClient) -> None:
        make_minimal_execution("stopped", name="Stopped Exec")
        make_minimal_execution("passed", name="Passed Exec")
        make_minimal_execution("failed", name="Failed Exec")

        response = client.get("/reports", params={"sort": "status", "order": "asc"})

        assert _names(response) == ["Passed Exec", "Failed Exec", "Stopped Exec"]

    def test_sort_triggered_by_asc(self, client: TestClient) -> None:
        make_minimal_execution("passed", name="Bob Exec", triggered_by="bob")
        make_minimal_execution("passed", name="Alice Exec", triggered_by="alice")

        response = client.get("/reports", params={"sort": "triggered_by", "order": "asc"})

        assert _names(response) == ["Alice Exec", "Bob Exec"]

    def test_sort_type_asc(self, client: TestClient) -> None:
        make_minimal_execution("passed", name="Test Exec", entity_type="test")
        make_minimal_execution("passed", name="Regression Exec", entity_type="regression")
        make_minimal_execution("passed", name="Suite Exec", entity_type="suite")

        response = client.get("/reports", params={"sort": "type", "order": "asc"})

        assert _names(response) == ["Regression Exec", "Suite Exec", "Test Exec"]

    def test_sort_duration_desc(self, client: TestClient) -> None:
        make_minimal_execution("passed", name="Short", duration=1)
        make_minimal_execution("passed", name="Long", duration=5)
        make_minimal_execution("passed", name="Medium", duration=3)

        response = client.get("/reports", params={"sort": "duration", "order": "desc"})

        assert _names(response) == ["Long", "Medium", "Short"]


class TestReportsListPagination:
    """Pagination math and the page-scoped report join."""

    def test_pagination_math(self, client: TestClient) -> None:
        for index in range(5):
            make_minimal_execution("passed", name=f"Exec {index}", started_offset=float(index))

        response = client.get("/reports", params={"per_page": 2})

        assert len(_rows(response)) == 2
        assert response.json()["pagination"] == {
            "total": 5,
            "page": 1,
            "per_page": 2,
            "total_pages": 3,
        }

    def test_second_page_contents(self, client: TestClient) -> None:
        for name in ("Alpha", "Beta", "Gamma", "Delta", "Epsilon"):
            make_minimal_execution("passed", name=name)

        response = client.get(
            "/reports", params={"sort": "name", "order": "asc", "per_page": 2, "page": 2}
        )

        assert _names(response) == ["Delta", "Epsilon"]
        assert response.json()["pagination"]["page"] == 2

    def test_page_beyond_range_returns_empty_rows(self, client: TestClient) -> None:
        make_minimal_execution("passed")

        response = client.get("/reports", params={"page": 99})

        assert _rows(response) == []
        assert response.json()["pagination"]["total"] == 1

    def test_report_info_present_on_returned_page_rows(self, client: TestClient) -> None:
        for _ in range(3):
            record = make_test_execution()
            _write_report_file(record["artifact_dir"], "report.json")

        response = client.get("/reports", params={"per_page": 2})

        rows = _rows(response)
        assert len(rows) == 2
        for row in rows:
            json_info = row["reports"]["json"]
            assert json_info is not None
            assert json_info["artifact_id"].endswith("/report.json")
        assert response.json()["pagination"]["total"] == 3


class TestReportsListValidation:
    """Strict filter validation with exact error messages."""

    def test_invalid_status_value_returns_400(self, client: TestClient) -> None:
        response = client.get("/reports", params={"status": "passed,bogus"})

        assert response.status_code == 400
        assert (
            response.json()["error"]["message"]
            == "Invalid status 'bogus': valid statuses are passed, failed, stopped"
        )

    def test_invalid_type_value_returns_400(self, client: TestClient) -> None:
        response = client.get("/reports", params={"type": "bogus"})

        assert response.status_code == 400
        assert (
            response.json()["error"]["message"]
            == "Invalid type 'bogus': valid types are test, suite, regression"
        )

    def test_invalid_sort_returns_400(self, client: TestClient) -> None:
        response = client.get("/reports", params={"sort": "bogus"})

        assert response.status_code == 400
        assert response.json()["error"]["message"] == (
            "Invalid sort 'bogus': valid sorts are "
            "started_at, name, status, triggered_by, type, duration"
        )

    def test_invalid_order_returns_400(self, client: TestClient) -> None:
        response = client.get("/reports", params={"order": "bogus"})

        assert response.status_code == 400
        assert (
            response.json()["error"]["message"]
            == "Invalid order 'bogus': valid orders are asc, desc"
        )

    def test_invalid_from_date_returns_400(self, client: TestClient) -> None:
        response = client.get("/reports", params={"from_date": "bogus"})

        assert response.status_code == 400
        assert (
            response.json()["error"]["message"]
            == "Invalid from_date 'bogus': expected an ISO 8601 datetime"
        )

    def test_invalid_to_date_returns_400(self, client: TestClient) -> None:
        response = client.get("/reports", params={"to_date": "bogus"})

        assert response.status_code == 400
        assert (
            response.json()["error"]["message"]
            == "Invalid to_date 'bogus': expected an ISO 8601 datetime"
        )

    def test_page_below_minimum_returns_400(self, client: TestClient) -> None:
        response = client.get("/reports", params={"page": 0})

        assert response.status_code == 400
        assert (
            response.json()["error"]["message"]
            == "Validation error for 'page': Input should be greater than or equal to 1"
        )

    def test_per_page_below_minimum_returns_400(self, client: TestClient) -> None:
        response = client.get("/reports", params={"per_page": 0})

        assert response.status_code == 400
        assert (
            response.json()["error"]["message"]
            == "Validation error for 'per_page': Input should be greater than or equal to 1"
        )

    def test_per_page_above_maximum_returns_400(self, client: TestClient) -> None:
        response = client.get("/reports", params={"per_page": 101})

        assert response.status_code == 400
        assert (
            response.json()["error"]["message"]
            == "Validation error for 'per_page': Input should be less than or equal to 100"
        )
