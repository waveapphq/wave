"""Unit tests for the execution report endpoints (REQ-3.7.2.1).

POST /executions/{execution_id}/report?format=html|json ensures the report
of the requested format exists: it returns an existing artifact immediately
(200, nothing generated), or starts the async generation job (202). GET
polls the job. Regeneration is explicit: delete the artifact, POST again.
"""

import asyncio
import json
import shutil
import uuid
from typing import Any

from fastapi.testclient import TestClient

from tests.api.reports.conftest import (
    artifact_dir_path,
    make_minimal_execution,
    make_suite_execution,
    make_test_execution,
)


def _drain_job(client: TestClient, execution_id: str, report_format: str = "html") -> None:
    """Await the job task on the portal loop so assertions see terminal state."""
    from wavecore.api.services.reports import jobs

    task = jobs.get_task(execution_id, report_format)
    assert task is not None
    if not task.done():
        client.portal.call(lambda: asyncio.wait_for(task, timeout=10.0))


def _seed_job(
    execution_id: str,
    status: str,
    report_format: str = "html",
    runs_total: int = 3,
) -> dict[str, Any]:
    from wavecore.api.services.reports import jobs

    job = jobs.create_job(execution_id, report_format, runs_total=runs_total)
    job["status"] = status
    return job


class TestStartReportJob:
    """POST /executions/{execution_id}/report."""

    def test_post_returns_202_with_job_view(self, client: TestClient) -> None:
        record = make_suite_execution()

        response = client.post(f"/executions/{record['execution_id']}/report")

        assert response.status_code == 202
        body = response.json()
        assert body["success"] is True
        assert "meta" in body
        data = body["data"]
        assert data["execution_id"] == record["execution_id"]
        assert data["format"] == "html"
        assert data["status"] in ("pending", "running", "completed")
        assert data["progress"]["runs_total"] == 3
        assert data["error"] is None

    def test_job_completes_with_artifact_id_and_full_progress(self, client: TestClient) -> None:
        record = make_suite_execution()
        client.post(f"/executions/{record['execution_id']}/report")
        _drain_job(client, record["execution_id"])

        response = client.get(f"/executions/{record['execution_id']}/report")

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["status"] == "completed"
        assert data["format"] == "html"
        assert data["progress"] == {"runs_processed": 3, "runs_total": 3}
        assert data["artifact_id"] == f"{record['artifact_dir']}/report.html"
        assert data["error"] is None
        assert data["ended_at"] is not None

    def test_only_requested_format_is_written(self, client: TestClient) -> None:
        record = make_suite_execution()
        client.post(f"/executions/{record['execution_id']}/report")
        _drain_job(client, record["execution_id"])

        files = sorted(p.name for p in artifact_dir_path(record["artifact_dir"]).iterdir())

        assert files == ["report.html"]

    def test_json_format_writes_canonical_model(self, client: TestClient) -> None:
        record = make_suite_execution()
        client.post(f"/executions/{record['execution_id']}/report?format=json")
        _drain_job(client, record["execution_id"], "json")

        files = sorted(p.name for p in artifact_dir_path(record["artifact_dir"]).iterdir())
        payload = json.loads(
            (artifact_dir_path(record["artifact_dir"]) / "report.json").read_text()
        )

        assert files == ["report.json"]
        assert payload["execution"]["id"] == record["execution_id"]
        assert len(payload["timeline"]["runs"]) == 3
        assert len(payload["logs"]) == 8

    def test_html_artifact_streams_inline_as_html(self, client: TestClient) -> None:
        record = make_suite_execution()
        client.post(f"/executions/{record['execution_id']}/report")
        _drain_job(client, record["execution_id"])

        html_id = f"{record['artifact_dir']}/report.html"
        response = client.get(f"/artifacts/content/{html_id}?disposition=inline")

        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/html")
        assert response.headers["content-disposition"] == 'inline; filename="report.html"'
        assert "<html" in response.text

    def test_test_type_execution_report_includes_blocks(self, client: TestClient) -> None:
        record = make_test_execution()
        client.post(f"/executions/{record['execution_id']}/report?format=json")
        _drain_job(client, record["execution_id"], "json")

        status = client.get(f"/executions/{record['execution_id']}/report?format=json")
        data = status.json()["data"]
        payload = json.loads(
            (artifact_dir_path(record["artifact_dir"]) / "report.json").read_text()
        )

        assert data["status"] == "completed"
        assert data["progress"]["runs_processed"] == data["progress"]["runs_total"]
        assert len(payload["timeline"]["blocks"]) == 6

    def test_stopped_execution_is_eligible(self, client: TestClient) -> None:
        execution_id = make_minimal_execution("stopped")

        response = client.post(f"/executions/{execution_id}/report")

        assert response.status_code == 202
        _drain_job(client, execution_id)
        status = client.get(f"/executions/{execution_id}/report").json()["data"]
        assert status["status"] == "completed"

    def test_post_while_job_in_flight_returns_existing_job_unchanged(
        self, client: TestClient
    ) -> None:
        from wavecore.api.services.reports import jobs

        record = make_suite_execution()
        seeded = _seed_job(record["execution_id"], "running")

        response = client.post(f"/executions/{record['execution_id']}/report")

        assert response.status_code == 202
        data = response.json()["data"]
        assert data["status"] == "running"
        assert data["started_at"] == seeded["started_at"]
        assert data["progress"] == {"runs_processed": 0, "runs_total": 3}
        assert jobs.get_task(record["execution_id"], "html") is None
        assert list(artifact_dir_path(record["artifact_dir"]).iterdir()) == []

    def test_post_after_failed_job_starts_fresh_generation(self, client: TestClient) -> None:
        record = make_suite_execution()
        stale = _seed_job(record["execution_id"], "failed")
        stale["error"] = "previous failure"

        response = client.post(f"/executions/{record['execution_id']}/report")

        assert response.status_code == 202
        _drain_job(client, record["execution_id"])
        data = client.get(f"/executions/{record['execution_id']}/report").json()["data"]
        assert data["status"] == "completed"
        assert data["error"] is None
        assert data["artifact_id"] == f"{record['artifact_dir']}/report.html"

    def test_existing_report_returns_200_without_regenerating(self, client: TestClient) -> None:
        record = make_suite_execution()
        client.post(f"/executions/{record['execution_id']}/report")
        _drain_job(client, record["execution_id"])

        response = client.post(f"/executions/{record['execution_id']}/report")

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["status"] == "completed"
        assert data["format"] == "html"
        assert data["artifact_id"] == f"{record['artifact_dir']}/report.html"
        assert data["progress"] == {"runs_processed": 3, "runs_total": 3}
        assert data["started_at"] is None
        files = sorted(p.name for p in artifact_dir_path(record["artifact_dir"]).iterdir())
        assert files == ["report.html"]

    def test_formats_generate_independently(self, client: TestClient) -> None:
        record = make_suite_execution()
        client.post(f"/executions/{record['execution_id']}/report")
        _drain_job(client, record["execution_id"])

        first_json = client.post(f"/executions/{record['execution_id']}/report?format=json")
        _drain_job(client, record["execution_id"], "json")
        second_json = client.post(f"/executions/{record['execution_id']}/report?format=json")

        assert first_json.status_code == 202
        assert second_json.status_code == 200
        assert second_json.json()["data"]["artifact_id"] == (
            f"{record['artifact_dir']}/report.json"
        )
        files = sorted(p.name for p in artifact_dir_path(record["artifact_dir"]).iterdir())
        assert files == ["report.html", "report.json"]

    def test_deleted_report_regenerates_on_next_post(self, client: TestClient) -> None:
        record = make_suite_execution()
        client.post(f"/executions/{record['execution_id']}/report")
        _drain_job(client, record["execution_id"])

        deleted = client.delete(f"/artifacts/{record['artifact_dir']}/report.html")
        response = client.post(f"/executions/{record['execution_id']}/report")

        assert deleted.status_code == 204
        assert response.status_code == 202
        _drain_job(client, record["execution_id"])
        files = sorted(p.name for p in artifact_dir_path(record["artifact_dir"]).iterdir())
        assert files == ["report.html"]

    def test_wiped_artifact_dir_regenerates(self, client: TestClient) -> None:
        record = make_suite_execution()
        shutil.rmtree(artifact_dir_path(record["artifact_dir"]))

        response = client.post(f"/executions/{record['execution_id']}/report")

        assert response.status_code == 202
        _drain_job(client, record["execution_id"])
        files = sorted(p.name for p in artifact_dir_path(record["artifact_dir"]).iterdir())
        assert files == ["report.html"]

    def test_builder_failure_marks_job_failed(self, client: TestClient, monkeypatch: Any) -> None:
        from wavecore.api.services.reports import builder

        record = make_suite_execution()

        def _boom(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
            raise RuntimeError("model build exploded")

        monkeypatch.setattr(builder, "build_execution_report", _boom)
        client.post(f"/executions/{record['execution_id']}/report")
        _drain_job(client, record["execution_id"])

        data = client.get(f"/executions/{record['execution_id']}/report").json()["data"]
        assert data["status"] == "failed"
        assert "model build exploded" in data["error"]
        assert data["artifact_id"] is None


class TestStartReportJobErrors:
    """POST guard paths with exact error messages."""

    def test_invalid_uuid_returns_400(self, client: TestClient) -> None:
        response = client.post("/executions/not-a-uuid/report")

        assert response.status_code == 400
        assert (
            response.json()["error"]["message"]
            == "Invalid UUID format for execution_id: 'not-a-uuid'"
        )

    def test_invalid_format_returns_400(self, client: TestClient) -> None:
        record = make_suite_execution()

        response = client.post(f"/executions/{record['execution_id']}/report?format=pdf")

        assert response.status_code == 400
        assert (
            response.json()["error"]["message"]
            == "Invalid format 'pdf': valid formats are html, json"
        )

    def test_unknown_execution_returns_404(self, client: TestClient) -> None:
        execution_id = str(uuid.uuid4())

        response = client.post(f"/executions/{execution_id}/report")

        assert response.status_code == 404
        assert (
            response.json()["error"]["message"] == f"Execution with ID '{execution_id}' not found"
        )

    def test_running_execution_returns_409(self, client: TestClient) -> None:
        execution_id = make_minimal_execution("running")

        response = client.post(f"/executions/{execution_id}/report")

        assert response.status_code == 409
        assert (
            response.json()["error"]["message"]
            == "Cannot generate report for execution in 'running' state. "
            "Wait for the execution to finish."
        )

    def test_paused_execution_returns_409(self, client: TestClient) -> None:
        execution_id = make_minimal_execution("paused")

        response = client.post(f"/executions/{execution_id}/report")

        assert response.status_code == 409
        assert (
            response.json()["error"]["message"]
            == "Cannot generate report for execution in 'paused' state. "
            "Wait for the execution to finish."
        )

    def test_execution_without_artifact_dir_returns_409(self, client: TestClient) -> None:
        execution_id = make_minimal_execution("passed", with_artifact_dir=False)

        response = client.post(f"/executions/{execution_id}/report")

        assert response.status_code == 409
        assert (
            response.json()["error"]["message"]
            == f"Execution '{execution_id}' has no artifact directory"
        )


class TestReportJobStatus:
    """GET /executions/{execution_id}/report."""

    def test_invalid_uuid_returns_400(self, client: TestClient) -> None:
        response = client.get("/executions/not-a-uuid/report")

        assert response.status_code == 400
        assert (
            response.json()["error"]["message"]
            == "Invalid UUID format for execution_id: 'not-a-uuid'"
        )

    def test_invalid_format_returns_400(self, client: TestClient) -> None:
        record = make_suite_execution()

        response = client.get(f"/executions/{record['execution_id']}/report?format=bogus")

        assert response.status_code == 400
        assert (
            response.json()["error"]["message"]
            == "Invalid format 'bogus': valid formats are html, json"
        )

    def test_unknown_execution_returns_404(self, client: TestClient) -> None:
        execution_id = str(uuid.uuid4())

        response = client.get(f"/executions/{execution_id}/report")

        assert response.status_code == 404
        assert (
            response.json()["error"]["message"] == f"Execution with ID '{execution_id}' not found"
        )

    def test_execution_without_job_returns_404(self, client: TestClient) -> None:
        record = make_suite_execution()

        response = client.get(f"/executions/{record['execution_id']}/report")

        assert response.status_code == 404
        assert (
            response.json()["error"]["message"]
            == f"No report generation job for execution '{record['execution_id']}'"
        )

    def test_job_lookup_is_per_format(self, client: TestClient) -> None:
        record = make_suite_execution()
        _seed_job(record["execution_id"], "running")

        response = client.get(f"/executions/{record['execution_id']}/report?format=json")

        assert response.status_code == 404
        assert (
            response.json()["error"]["message"]
            == f"No report generation job for execution '{record['execution_id']}'"
        )

    def test_returns_current_job_view(self, client: TestClient) -> None:
        record = make_suite_execution()
        seeded = _seed_job(record["execution_id"], "running")

        response = client.get(f"/executions/{record['execution_id']}/report")

        assert response.status_code == 200
        body = response.json()
        assert body["success"] is True
        data = body["data"]
        assert data["execution_id"] == record["execution_id"]
        assert data["format"] == "html"
        assert data["status"] == "running"
        assert data["started_at"] == seeded["started_at"]
        assert data["artifact_id"] is None
