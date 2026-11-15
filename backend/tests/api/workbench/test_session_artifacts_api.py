"""Unit tests for the workbench session artifact endpoints.

GET /workbench/session/artifacts lists the current user's active session
artifacts; GET /workbench/session/artifacts/content/{path} streams one file;
DELETE /workbench/session/artifacts/{path} hard-deletes one file (ephemeral
sessions only - tracked sessions are rejected). Paths are validated for
containment within the session's directory.
"""

import re
import uuid
from datetime import datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from httpx import Response

from wavecore.api.services.storage_paths import get_artifacts_storage_path
from wavecore.api.services.workbench import _common as wb_common
from wavecore.api.services.workbench._common import DEFAULT_USER_ID

_NO_SESSION_MESSAGE = "No active workbench session"
_INVALID_PATH_RE = r"^Invalid artifact path: .+$"
_TRACKED_MESSAGE = "Tracked execution artifacts are managed in the Artifacts page"


@pytest.fixture
def client() -> TestClient:
    from wavecore.api.app import app

    return TestClient(app)


def _prime_active_session() -> tuple[str, Path]:
    """Register an active session whose artifacts_dir exists on disk."""
    session_id = str(uuid.uuid4())
    session_dir = get_artifacts_storage_path() / "sessions" / session_id
    session_dir.mkdir(parents=True)
    wb_common._workbench_sessions[session_id] = {
        "session_id": session_id,
        "test_id": str(uuid.uuid4()),
        "status": "running",
        "user_id": DEFAULT_USER_ID,
        "variables": {},
        "block_states": {},
        "artifacts_dir": str(session_dir),
    }
    wb_common._user_active_session[DEFAULT_USER_ID] = session_id
    return session_id, session_dir


def _prime_tracked_session(
    *, execution_id: str | None = None, parent_execution_id: str | None = None
) -> tuple[str, Path]:
    """Register an active tracked session whose artifacts_dir is a permanent execution dir."""
    session_id = str(uuid.uuid4())
    tracked_id = execution_id or parent_execution_id
    execution_dir = get_artifacts_storage_path() / f"20260702-120000-{tracked_id}"
    execution_dir.mkdir(parents=True)
    wb_common._workbench_sessions[session_id] = {
        "session_id": session_id,
        "test_id": str(uuid.uuid4()),
        "status": "running",
        "user_id": DEFAULT_USER_ID,
        "variables": {},
        "block_states": {},
        "artifacts_dir": str(execution_dir),
        "execution_id": execution_id,
        "parent_execution_id": parent_execution_id,
    }
    wb_common._user_active_session[DEFAULT_USER_ID] = session_id
    return session_id, execution_dir


class TestListSessionArtifacts:
    """GET /workbench/session/artifacts."""

    def test_lists_session_files_sorted_by_path(self, client: TestClient) -> None:
        _session_id, session_dir = _prime_active_session()
        (session_dir / "result.json").write_bytes(b'{"ok": true}')
        logs_dir = session_dir / "logs"
        logs_dir.mkdir()
        (logs_dir / "service.log").write_bytes(b"line\n")

        response = client.get("/workbench/session/artifacts")

        assert response.status_code == 200
        body = response.json()
        assert set(body.keys()) == {"items"}
        items = body["items"]
        assert [item["path"] for item in items] == ["logs/service.log", "result.json"]
        for item in items:
            assert set(item.keys()) == {"path", "size_bytes", "created_at"}
            datetime.fromisoformat(item["created_at"])
        assert items[1]["size_bytes"] == len(b'{"ok": true}')

    def test_empty_session_dir_returns_empty_items(self, client: TestClient) -> None:
        _prime_active_session()

        response = client.get("/workbench/session/artifacts")

        assert response.status_code == 200
        assert response.json() == {"items": []}

    def test_missing_session_dir_returns_empty_items(self, client: TestClient) -> None:
        _session_id, session_dir = _prime_active_session()
        session_dir.rmdir()

        response = client.get("/workbench/session/artifacts")

        assert response.status_code == 200
        assert response.json() == {"items": []}

    def test_no_active_session_lists_nothing(self, client: TestClient) -> None:
        """No session holds no artifacts; a listing says so instead of failing."""
        response = client.get("/workbench/session/artifacts")

        assert response.status_code == 200
        assert response.json() == {"items": []}


class TestSessionArtifactContent:
    """GET /workbench/session/artifacts/content/{path}."""

    def test_streams_file_content_with_guessed_type(self, client: TestClient) -> None:
        _session_id, session_dir = _prime_active_session()
        (session_dir / "result.json").write_bytes(b'{"ok": true}')

        response = client.get("/workbench/session/artifacts/content/result.json")

        assert response.status_code == 200
        assert response.content == b'{"ok": true}'
        assert response.headers["content-type"].startswith("application/json")

    def test_streams_nested_file(self, client: TestClient) -> None:
        _session_id, session_dir = _prime_active_session()
        logs_dir = session_dir / "logs"
        logs_dir.mkdir()
        (logs_dir / "service.log").write_bytes(b"log line\n")

        response = client.get("/workbench/session/artifacts/content/logs/service.log")

        assert response.status_code == 200
        assert response.content == b"log line\n"

    def test_traversal_path_rejected(self, client: TestClient) -> None:
        _prime_active_session()

        response = client.get("/workbench/session/artifacts/content/..%2Fescape.txt")

        assert response.status_code == 400
        message = response.json()["error"]["message"]
        assert re.match(_INVALID_PATH_RE, message)
        assert message == "Invalid artifact path: ../escape.txt"

    def test_absolute_path_rejected(self, client: TestClient) -> None:
        _prime_active_session()

        response = client.get("/workbench/session/artifacts/content/%2Fetc%2Fpasswd")

        assert response.status_code == 400
        assert re.match(_INVALID_PATH_RE, response.json()["error"]["message"])

    def test_missing_file_returns_404(self, client: TestClient) -> None:
        _prime_active_session()

        response = client.get("/workbench/session/artifacts/content/missing.txt")

        assert response.status_code == 404
        assert response.json()["error"]["message"] == "Session artifact missing.txt not found"

    def test_no_active_session_returns_404(self, client: TestClient) -> None:
        response = client.get("/workbench/session/artifacts/content/result.json")

        assert response.status_code == 404
        assert response.json()["error"]["message"] == _NO_SESSION_MESSAGE


class TestSessionArtifactPages:
    """A session page renders as itself, but never with WAVE's origin."""

    @pytest.mark.parametrize("disposition", ["attachment", "inline"])
    @pytest.mark.parametrize(
        ("name", "media_type"),
        [
            ("page.html", "text/html"),
            ("drawing.svg", "image/svg+xml"),
            ("feed.xml", "application/xml"),
        ],
    )
    def test_a_page_runs_sandboxed_outside_the_wave_origin(
        self, client: TestClient, disposition: str, name: str, media_type: str
    ) -> None:
        _session_id, session_dir = _prime_active_session()
        (session_dir / name).write_bytes(b"<x/>")

        response = client.get(
            f"/workbench/session/artifacts/content/{name}", params={"disposition": disposition}
        )

        assert response.status_code == 200
        assert response.headers["content-type"].startswith(media_type)
        assert response.headers["content-disposition"] == f'{disposition}; filename="{name}"'
        assert response.headers["content-security-policy"] == "sandbox allow-scripts"

    @pytest.mark.parametrize("disposition", ["attachment", "inline"])
    @pytest.mark.parametrize("name", ["result.json", "data.txt", "report.pdf", "chart.png"])
    def test_a_file_that_is_not_a_page_carries_no_policy(
        self, client: TestClient, disposition: str, name: str
    ) -> None:
        _session_id, session_dir = _prime_active_session()
        (session_dir / name).write_bytes(b"0123456789")

        response = client.get(
            f"/workbench/session/artifacts/content/{name}", params={"disposition": disposition}
        )

        assert response.status_code == 200
        assert "content-security-policy" not in response.headers


class TestDeleteSessionArtifact:
    """DELETE /workbench/session/artifacts/{path} (hard delete, ephemeral only)."""

    def test_delete_removes_file_and_returns_204(self, client: TestClient) -> None:
        _session_id, session_dir = _prime_active_session()
        (session_dir / "result.json").write_bytes(b'{"ok": true}')
        (session_dir / "keep.txt").write_bytes(b"keep me\n")

        response = client.delete("/workbench/session/artifacts/result.json")

        assert response.status_code == 204
        assert response.content == b""
        assert not (session_dir / "result.json").exists()
        assert (session_dir / "keep.txt").exists()
        listing = client.get("/workbench/session/artifacts")
        assert [item["path"] for item in listing.json()["items"]] == ["keep.txt"]

    def test_delete_nested_file_leaves_siblings(self, client: TestClient) -> None:
        _session_id, session_dir = _prime_active_session()
        output_dir = session_dir / "output"
        output_dir.mkdir()
        (output_dir / "data.json").write_bytes(b"{}")
        (output_dir / "other.log").write_bytes(b"line\n")
        (session_dir / "root.txt").write_bytes(b"root\n")

        response = client.delete("/workbench/session/artifacts/output/data.json")

        assert response.status_code == 204
        assert not (output_dir / "data.json").exists()
        assert (output_dir / "other.log").exists()
        assert (session_dir / "root.txt").exists()
        listing = client.get("/workbench/session/artifacts")
        assert [item["path"] for item in listing.json()["items"]] == [
            "output/other.log",
            "root.txt",
        ]

    def test_no_active_session_returns_404(self, client: TestClient) -> None:
        response = client.delete("/workbench/session/artifacts/result.json")

        assert response.status_code == 404
        assert response.json()["error"]["message"] == _NO_SESSION_MESSAGE

    def test_absolute_path_rejected(self, client: TestClient) -> None:
        _prime_active_session()

        response = client.delete("/workbench/session/artifacts/%2Fetc%2Fpasswd")

        assert response.status_code == 400
        message = response.json()["error"]["message"]
        assert re.match(_INVALID_PATH_RE, message)
        assert message == "Invalid artifact path: /etc/passwd"

    def test_traversal_path_rejected(self, client: TestClient) -> None:
        _session_id, session_dir = _prime_active_session()
        escape_target = session_dir.parent / "escape.txt"
        escape_target.write_bytes(b"outside\n")

        response = client.delete("/workbench/session/artifacts/..%2Fescape.txt")

        assert response.status_code == 400
        message = response.json()["error"]["message"]
        assert re.match(_INVALID_PATH_RE, message)
        assert message == "Invalid artifact path: ../escape.txt"
        assert escape_target.exists()

    def test_empty_segment_path_rejected(self, client: TestClient) -> None:
        _prime_active_session()

        response = client.delete("/workbench/session/artifacts/a%2F%2Fb")

        assert response.status_code == 400
        message = response.json()["error"]["message"]
        assert re.match(_INVALID_PATH_RE, message)
        assert message == "Invalid artifact path: a//b"

    def test_missing_file_returns_404(self, client: TestClient) -> None:
        _prime_active_session()

        response = client.delete("/workbench/session/artifacts/missing.txt")

        assert response.status_code == 404
        assert response.json()["error"]["message"] == "Session artifact missing.txt not found"

    def test_second_delete_of_same_file_returns_404(self, client: TestClient) -> None:
        _session_id, session_dir = _prime_active_session()
        (session_dir / "once.txt").write_bytes(b"once\n")

        first = client.delete("/workbench/session/artifacts/once.txt")
        second = client.delete("/workbench/session/artifacts/once.txt")

        assert first.status_code == 204
        assert second.status_code == 404
        assert second.json()["error"]["message"] == "Session artifact once.txt not found"

    def test_tracked_session_rejected_with_409(self, client: TestClient) -> None:
        _session_id, execution_dir = _prime_tracked_session(execution_id=str(uuid.uuid4()))
        (execution_dir / "tracked.txt").write_bytes(b"keep\n")

        response = client.delete("/workbench/session/artifacts/tracked.txt")

        assert response.status_code == 409
        assert response.json()["error"]["message"] == _TRACKED_MESSAGE
        assert (execution_dir / "tracked.txt").exists()

    def test_child_tracked_session_rejected_with_409(self, client: TestClient) -> None:
        _session_id, execution_dir = _prime_tracked_session(parent_execution_id=str(uuid.uuid4()))
        (execution_dir / "child.txt").write_bytes(b"keep\n")

        response = client.delete("/workbench/session/artifacts/child.txt")

        assert response.status_code == 409
        assert response.json()["error"]["message"] == _TRACKED_MESSAGE
        assert (execution_dir / "child.txt").exists()

    def test_tracked_guard_precedes_path_validation(self, client: TestClient) -> None:
        _prime_tracked_session(execution_id=str(uuid.uuid4()))

        response = client.delete("/workbench/session/artifacts/..%2Fescape.txt")

        assert response.status_code == 409
        assert response.json()["error"]["message"] == _TRACKED_MESSAGE

    def test_delete_leaves_permanent_artifacts_zone_untouched(self, client: TestClient) -> None:
        execution_dir = get_artifacts_storage_path() / f"20260702-130000-{uuid.uuid4()}"
        execution_dir.mkdir(parents=True)
        (execution_dir / "report.json").write_bytes(b'{"kept": true}')
        _session_id, session_dir = _prime_active_session()
        (session_dir / "report.json").write_bytes(b'{"scratch": true}')
        before = client.get("/artifacts").json()["data"]
        assert [item["name"] for item in before] == ["report.json"]

        response = client.delete("/workbench/session/artifacts/report.json")

        assert response.status_code == 204
        assert (execution_dir / "report.json").exists()
        assert client.get("/artifacts").json()["data"] == before


def _route(method: str, path: str) -> str:
    """The content route for a read, the artifact route for a delete."""
    if method == "get":
        return f"/workbench/session/artifacts/content/{path}"
    return f"/workbench/session/artifacts/{path}"


def _assert_invalid(response: Response, path: str) -> None:
    assert response.status_code == 400, response.text
    assert response.json()["error"]["message"] == f"Invalid artifact path: {path}"


class TestSessionArtifactContainment:
    """A path names a file inside the session's folder, through links too."""

    @pytest.fixture
    def outside(self, tmp_path: Path) -> Path:
        folder = tmp_path / "outside"
        folder.mkdir()
        (folder / "secret.txt").write_bytes(b"outside\n")
        return folder

    @pytest.mark.parametrize("method", ["get", "delete"])
    def test_a_link_to_a_file_outside_is_refused_and_both_stay(
        self, client: TestClient, outside: Path, method: str
    ) -> None:
        _session_id, session_dir = _prime_active_session()
        (session_dir / "leak.txt").symlink_to(outside / "secret.txt")

        response = client.request(method.upper(), _route(method, "leak.txt"))

        _assert_invalid(response, "leak.txt")
        assert (session_dir / "leak.txt").is_symlink()
        assert (outside / "secret.txt").read_bytes() == b"outside\n"

    @pytest.mark.parametrize("method", ["get", "delete"])
    def test_a_path_through_a_folder_link_that_leads_outside_is_refused(
        self, client: TestClient, outside: Path, method: str
    ) -> None:
        _session_id, session_dir = _prime_active_session()
        (session_dir / "out").symlink_to(outside)

        response = client.request(method.upper(), _route(method, "out/secret.txt"))

        _assert_invalid(response, "out/secret.txt")
        assert (outside / "secret.txt").read_bytes() == b"outside\n"

    @pytest.mark.parametrize("method", ["get", "delete"])
    @pytest.mark.parametrize("path", ["a", "a/x"])
    def test_two_links_that_point_at_each_other_are_an_invalid_path(
        self, client: TestClient, method: str, path: str
    ) -> None:
        _session_id, session_dir = _prime_active_session()
        (session_dir / "a").symlink_to(session_dir / "b")
        (session_dir / "b").symlink_to(session_dir / "a")

        response = client.request(method.upper(), _route(method, path))

        _assert_invalid(response, path)

    @pytest.mark.parametrize("method", ["get", "delete"])
    def test_a_nul_byte_is_an_invalid_path(self, client: TestClient, method: str) -> None:
        _prime_active_session()

        response = client.request(method.upper(), _route(method, "a%00b.txt"))

        _assert_invalid(response, "a\0b.txt")

    def test_a_link_that_stays_inside_is_served_with_its_targets_bytes(
        self, client: TestClient
    ) -> None:
        _session_id, session_dir = _prime_active_session()
        (session_dir / "real.txt").write_bytes(b"inside\n")
        (session_dir / "alias.txt").symlink_to(session_dir / "real.txt")

        response = client.get("/workbench/session/artifacts/content/alias.txt")

        assert response.status_code == 200
        assert response.content == b"inside\n"

    def test_a_delete_of_a_link_that_stays_inside_removes_the_link_only(
        self, client: TestClient
    ) -> None:
        _session_id, session_dir = _prime_active_session()
        (session_dir / "real.txt").write_bytes(b"inside\n")
        (session_dir / "alias.txt").symlink_to(session_dir / "real.txt")

        response = client.delete("/workbench/session/artifacts/alias.txt")

        assert response.status_code == 204
        assert not (session_dir / "alias.txt").is_symlink()
        assert (session_dir / "real.txt").read_bytes() == b"inside\n"

    @pytest.mark.parametrize("method", ["get", "delete"])
    def test_a_session_with_nowhere_to_write_refuses_an_unsafe_path_first(
        self, client: TestClient, method: str
    ) -> None:
        session_id, _session_dir = _prime_active_session()
        wb_common._workbench_sessions[session_id]["artifacts_dir"] = None

        _assert_invalid(client.request(method.upper(), _route(method, "..%2Fx.txt")), "../x.txt")
        missing = client.request(method.upper(), _route(method, "x.txt"))
        assert missing.status_code == 404
        assert missing.json()["error"]["message"] == "Session artifact x.txt not found"
