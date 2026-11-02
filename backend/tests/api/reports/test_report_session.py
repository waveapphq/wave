"""Unit tests for POST /workbench/session/report.

The active workbench session's finished run is reportable synchronously, one
format per request; an existing fresh artifact is returned without work, and
an artifact predating the session's run start counts as stale.
"""

import json
import os
import uuid
from datetime import datetime
from typing import Any

from fastapi.testclient import TestClient

from wavecore.api.services import artifact_service, log_streaming_service
from wavecore.api.services.storage_paths import get_artifacts_storage_path
from wavecore.api.services.workbench import _common as wb_common
from wavecore.api.services.workbench._common import DEFAULT_USER_ID

SESSION_TEST_NAME = "Scratch Inventory Test"

_SESSION_STARTED_AT = "2026-06-10T11:06:52+00:00"


def _prime_session(
    status: str = "passed",
    *,
    execution_id: str | None = None,
    with_artifacts_dir: bool = True,
) -> dict[str, Any]:
    session_id = str(uuid.uuid4())
    artifacts_dir: str | None = None
    if with_artifacts_dir:
        directory = get_artifacts_storage_path() / "sessions" / session_id
        directory.mkdir(parents=True)
        artifacts_dir = str(directory)
    session: dict[str, Any] = {
        "session_id": session_id,
        "status": status,
        "test_id": str(uuid.uuid4()),
        "test_name": SESSION_TEST_NAME,
        "environment_id": str(uuid.uuid4()),
        "user_id": DEFAULT_USER_ID,
        "started_at": _SESSION_STARTED_AT,
        "variables": {},
        "block_states": {"node-a": "passed", "node-b": "failed"},
        "execution_id": execution_id,
        "parent_execution_id": None,
        "artifacts_dir": artifacts_dir,
    }
    wb_common._workbench_sessions[session_id] = session
    wb_common._user_active_session[DEFAULT_USER_ID] = session_id
    return session


def _add_session_logs(session_id: str) -> None:
    log_streaming_service.add_log(session_id, "INFO", "Block A done", "Log : A", block_id="node-a")
    log_streaming_service.add_log(
        session_id,
        "ERROR",
        "Assertion failed: totals mismatch",
        "Assert : B",
        block_id="node-b",
    )


class TestSessionReportGuards:
    def test_no_active_session_returns_404(self, client: TestClient) -> None:
        response = client.post("/workbench/session/report")

        assert response.status_code == 404
        assert response.json()["error"]["message"] == "No active workbench session"

    def test_invalid_format_returns_400(self, client: TestClient) -> None:
        _prime_session()

        response = client.post("/workbench/session/report?format=pdf")

        assert response.status_code == 400
        assert (
            response.json()["error"]["message"]
            == "Invalid format 'pdf': valid formats are html, json"
        )

    def test_running_session_returns_409(self, client: TestClient) -> None:
        _prime_session("running")

        response = client.post("/workbench/session/report")

        assert response.status_code == 409
        assert (
            response.json()["error"]["message"]
            == "Cannot generate report for workbench session in 'running' state. "
            "Wait for the run to finish."
        )

    def test_paused_session_returns_409(self, client: TestClient) -> None:
        _prime_session("paused")

        response = client.post("/workbench/session/report")

        assert response.status_code == 409
        assert (
            response.json()["error"]["message"]
            == "Cannot generate report for workbench session in 'paused' state. "
            "Wait for the run to finish."
        )

    def test_tracked_viewer_session_returns_409(self, client: TestClient) -> None:
        tracked_execution_id = str(uuid.uuid4())
        _prime_session("passed", execution_id=tracked_execution_id)

        response = client.post("/workbench/session/report")

        assert response.status_code == 409
        assert (
            response.json()["error"]["message"]
            == f"Workbench session belongs to tracked execution '{tracked_execution_id}'. "
            "Generate the report from the execution endpoint."
        )


class TestSessionReportGeneration:
    def test_generates_html_report_in_session_dir(self, client: TestClient) -> None:
        session = _prime_session()
        _add_session_logs(session["session_id"])

        response = client.post("/workbench/session/report")

        assert response.status_code == 200
        body = response.json()
        assert body["success"] is True
        assert body["data"] == {
            "path": "report.html",
            "format": "html",
            "session_id": session["session_id"],
        }
        directory = artifact_service.session_artifacts_dir(session["session_id"])
        assert (directory / "report.html").is_file()
        assert not (directory / "report.json").exists()

    def test_reports_listed_by_session_artifact_endpoint(self, client: TestClient) -> None:
        session = _prime_session()
        _add_session_logs(session["session_id"])
        client.post("/workbench/session/report")

        response = client.get("/workbench/session/artifacts")

        assert response.status_code == 200
        paths = [item["path"] for item in response.json()["items"]]
        assert paths == ["report.html"]

    def test_report_html_served_by_session_content_endpoint(self, client: TestClient) -> None:
        session = _prime_session()
        _add_session_logs(session["session_id"])
        client.post("/workbench/session/report")

        response = client.get("/workbench/session/artifacts/content/report.html")

        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/html")
        assert SESSION_TEST_NAME in response.text

    def test_json_format_carries_session_model(self, client: TestClient) -> None:
        session = _prime_session(status="failed")
        _add_session_logs(session["session_id"])

        response = client.post("/workbench/session/report?format=json")

        assert response.status_code == 200
        assert response.json()["data"] == {
            "path": "report.json",
            "format": "json",
            "session_id": session["session_id"],
        }
        directory = artifact_service.session_artifacts_dir(session["session_id"])
        payload = json.loads((directory / "report.json").read_text())

        assert "execution" not in payload
        assert payload["session"] == {
            "session_id": session["session_id"],
            "test_id": session["test_id"],
            "test_name": SESSION_TEST_NAME,
            "environment_id": session["environment_id"],
            "status": "failed",
            "started_at": session["started_at"],
        }
        assert [entry["sequence"] for entry in payload["logs"]] == [0, 1]
        block_ids = [block["block_id"] for block in payload["timeline"]["blocks"]]
        assert "node-a" in block_ids
        assert "node-b" in block_ids

    def test_allocates_session_dir_when_unset(self, client: TestClient) -> None:
        session = _prime_session(with_artifacts_dir=False)
        _add_session_logs(session["session_id"])

        response = client.post("/workbench/session/report")

        assert response.status_code == 200
        directory = artifact_service.session_artifacts_dir(session["session_id"])
        assert (directory / "report.html").is_file()
        assert session["artifacts_dir"] == str(directory)

    def test_existing_fresh_report_returned_without_regenerating(self, client: TestClient) -> None:
        session = _prime_session()
        _add_session_logs(session["session_id"])

        client.post("/workbench/session/report")
        response = client.post("/workbench/session/report")

        assert response.status_code == 200
        assert response.json()["data"] == {
            "path": "report.html",
            "format": "html",
            "session_id": session["session_id"],
        }
        directory = artifact_service.session_artifacts_dir(session["session_id"])
        reports = sorted(p.name for p in directory.iterdir())
        assert reports == ["report.html"]

    def test_stale_predecessor_report_regenerates_in_place(self, client: TestClient) -> None:
        session = _prime_session()
        _add_session_logs(session["session_id"])
        directory = artifact_service.session_artifacts_dir(session["session_id"])
        stale = directory / "report.html"
        stale.write_text("<html>stale predecessor report</html>")
        before_run = datetime.fromisoformat(_SESSION_STARTED_AT).timestamp() - 60
        os.utime(stale, (before_run, before_run))

        response = client.post("/workbench/session/report")

        assert response.status_code == 200
        assert response.json()["data"]["path"] == "report.html"
        assert (directory / "report.html").is_file()
        assert "stale predecessor" not in (directory / "report.html").read_text()

    def test_stopped_session_is_eligible(self, client: TestClient) -> None:
        session = _prime_session(status="stopped")
        _add_session_logs(session["session_id"])

        response = client.post("/workbench/session/report")

        assert response.status_code == 200
        assert response.json()["data"]["session_id"] == session["session_id"]
