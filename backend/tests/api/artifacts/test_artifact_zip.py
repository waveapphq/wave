"""Unit tests for GET /artifacts/zip (whole-execution / subtree download).

Streams a ``application/zip`` of an execution's live artifacts, or of a subtree
when ``path`` is given. Only live artifacts are archived - tombstone sidecars
and removed originals are excluded. An execution with no live artifacts returns
404; a ``path`` that escapes the execution directory returns 400.
"""

import io
import re
import uuid
import zipfile
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from tests.api.artifacts.conftest import (
    make_execution_dir,
    seed_execution_record,
    write_artifact_file,
)
from tests.api.download_name_helpers import ENTITY_NAME, assert_whole_name
from wavecore.api.services import artifact_service, shared
from wavecore.api.services.executions import _storage as exec_storage

_INVALID_ID_RE = r"^Invalid artifact identifier: .+$"


def _zip_names(content: bytes) -> list[str]:
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        return sorted(archive.namelist())


def _disposition_filename(response: object) -> str:
    disposition = response.headers["content-disposition"]  # type: ignore[attr-defined]
    match = re.search(r'filename="([^"]+)"', disposition)
    assert match is not None
    return match.group(1)


class TestZipWholeExecution:
    """A whole-execution zip carries every live artifact by relative path."""

    def test_streams_zip_of_all_artifacts(self, client: TestClient) -> None:
        dir_name, execution_id, directory = make_execution_dir()
        seed_execution_record(execution_id, "passed", dir_name)
        write_artifact_file(directory, "report.json", b"{}")
        write_artifact_file(directory, "logs/smoke/a.log", b"line\n")

        response = client.get("/artifacts/zip", params={"execution_id": execution_id})

        assert response.status_code == 200
        assert response.headers["content-type"] == "application/zip"
        assert _zip_names(response.content) == ["logs/smoke/a.log", "report.json"]
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            assert archive.read("report.json") == b"{}"

    def test_tombstones_are_excluded_from_zip(self, client: TestClient) -> None:
        dir_name, execution_id, directory = make_execution_dir()
        seed_execution_record(execution_id, "passed", dir_name)
        write_artifact_file(directory, "report.json", b"{}")
        # Simulate a prior soft-delete: a tombstone sidecar with no live original.
        write_artifact_file(directory, "old.json.removed", b'{"path": "old.json"}')

        response = client.get("/artifacts/zip", params={"execution_id": execution_id})

        names = _zip_names(response.content)
        assert names == ["report.json"]


class TestZipSubtree:
    """A subtree zip carries only the requested path."""

    def test_subtree_excludes_other_artifacts(self, client: TestClient) -> None:
        dir_name, execution_id, directory = make_execution_dir()
        seed_execution_record(execution_id, "passed", dir_name)
        write_artifact_file(directory, "report.json", b"{}")
        write_artifact_file(directory, "logs/smoke/a.log", b"line\n")

        response = client.get(
            "/artifacts/zip", params={"execution_id": execution_id, "path": "logs"}
        )

        assert response.status_code == 200
        names = _zip_names(response.content)
        assert any("a.log" in name for name in names)
        assert not any("report.json" in name for name in names)


class TestZipErrors:
    """404 for empty executions, 400 for path traversal."""

    def test_unknown_execution_returns_404(self, client: TestClient) -> None:
        execution_id = str(uuid.uuid4())

        response = client.get("/artifacts/zip", params={"execution_id": execution_id})

        assert response.status_code == 404
        assert re.match(
            rf"^No artifacts found for execution {re.escape(execution_id)}$",
            response.json()["error"]["message"],
        )

    def test_execution_with_only_tombstones_returns_404(self, client: TestClient) -> None:
        dir_name, execution_id, directory = make_execution_dir()
        seed_execution_record(execution_id, "passed", dir_name)
        write_artifact_file(directory, "old.json.removed", b'{"path": "old.json"}')

        response = client.get("/artifacts/zip", params={"execution_id": execution_id})

        assert response.status_code == 404
        assert re.match(
            rf"^No artifacts found for execution {re.escape(execution_id)}$",
            response.json()["error"]["message"],
        )

    def test_path_traversal_is_rejected(self, client: TestClient) -> None:
        dir_name, execution_id, directory = make_execution_dir()
        seed_execution_record(execution_id, "passed", dir_name)
        write_artifact_file(directory, "report.json", b"{}")

        response = client.get(
            "/artifacts/zip",
            params={"execution_id": execution_id, "path": "../escape"},
        )

        assert response.status_code == 400
        assert re.match(_INVALID_ID_RE, response.json()["error"]["message"])

    def test_execution_id_is_required(self, client: TestClient) -> None:
        response = client.get("/artifacts/zip")

        assert response.status_code == 400
        assert response.json()["success"] is False


class TestZipFilename:
    """The Content-Disposition filename reads ``<stamp>-<name>[-<subtree>].zip``."""

    def test_whole_execution_filename_is_stamp_and_name(self, client: TestClient) -> None:
        dir_name, execution_id, directory = make_execution_dir()
        seed_execution_record(execution_id, "passed", dir_name)
        write_artifact_file(directory, "report.json", b"{}")

        response = client.get("/artifacts/zip", params={"execution_id": execution_id})

        assert _disposition_filename(response) == "20260609-120000-artifact-test-execution.zip"

    def test_subtree_filename_appends_the_subtree(self, client: TestClient) -> None:
        dir_name, execution_id, directory = make_execution_dir()
        seed_execution_record(execution_id, "passed", dir_name)
        write_artifact_file(directory, "logs/smoke/a.log", b"x")

        response = client.get(
            "/artifacts/zip", params={"execution_id": execution_id, "path": "logs"}
        )

        assert _disposition_filename(response) == "20260609-120000-artifact-test-execution-logs.zip"

    def test_unsafe_characters_in_name_are_sanitized(self, client: TestClient) -> None:
        dir_name, execution_id, directory = make_execution_dir()
        seed_execution_record(execution_id, "passed", dir_name, name="My Suite/v2")
        write_artifact_file(directory, "report.json", b"{}")

        response = client.get("/artifacts/zip", params={"execution_id": execution_id})

        assert _disposition_filename(response) == "20260609-120000-My-Suite-v2.zip"

    def test_a_name_in_another_language_keeps_its_letters(self, client: TestClient) -> None:
        dir_name, execution_id, directory = make_execution_dir()
        seed_execution_record(execution_id, "passed", dir_name, name="हिंदी परीक्षण / Grüße 測試")
        write_artifact_file(directory, "report.json", b"{}")

        response = client.get("/artifacts/zip", params={"execution_id": execution_id})

        assert_whole_name(response, "20260609-120000-हिंदी-परीक्षण-Grüße-測試.zip")

    def test_all_unsafe_name_falls_back_to_artifacts(self, client: TestClient) -> None:
        dir_name, execution_id, directory = make_execution_dir()
        seed_execution_record(execution_id, "passed", dir_name, name="///")
        write_artifact_file(directory, "report.json", b"{}")

        response = client.get("/artifacts/zip", params={"execution_id": execution_id})

        assert _disposition_filename(response) == "20260609-120000-artifacts.zip"


class TestZipDownloadNameFallback:
    """zip_download_name falls back to the id when dir + record are missing."""

    def test_missing_dir_and_record_falls_back_to_id(self) -> None:
        execution_id = str(uuid.uuid4())

        name = artifact_service.zip_download_name(execution_id)

        assert name == f"{execution_id}-{execution_id}.zip"


def _zip_call_files(spy: object) -> list[tuple[str, object]]:
    """The (arcname, content) list build_export_zip was handed."""
    call = spy.call_args  # type: ignore[attr-defined]
    return call.args[0] if call.args else call.kwargs["files"]


class TestZipBuildsThroughSharedExportZip:
    """The zip is assembled by shared.build_export_zip, not by raw zipfile."""

    def test_shared_builder_receives_every_live_artifact_as_a_path(
        self, client: TestClient
    ) -> None:
        """One call, arcnames relative to the execution dir, contents on disk."""
        dir_name, execution_id, directory = make_execution_dir()
        seed_execution_record(execution_id, "passed", dir_name)
        write_artifact_file(directory, "report.json", b"{}")
        write_artifact_file(directory, "logs/smoke/a.log", b"line\n")

        with patch.object(shared, "build_export_zip", wraps=shared.build_export_zip) as spy:
            response = client.get("/artifacts/zip", params={"execution_id": execution_id})

        assert response.status_code == 200
        assert spy.call_count == 1
        files = _zip_call_files(spy)
        assert sorted(arcname for arcname, _ in files) == ["logs/smoke/a.log", "report.json"]
        assert all(isinstance(content, Path) for _, content in files)

    def test_the_served_archive_is_unchanged(self, client: TestClient) -> None:
        """Migrating the builder does not change the bytes a client downloads."""
        dir_name, execution_id, directory = make_execution_dir()
        seed_execution_record(execution_id, "passed", dir_name)
        write_artifact_file(directory, "report.json", b"{}")
        write_artifact_file(directory, "logs/smoke/a.log", b"line\n")

        response = client.get("/artifacts/zip", params={"execution_id": execution_id})

        assert _zip_names(response.content) == ["logs/smoke/a.log", "report.json"]
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            assert archive.read("logs/smoke/a.log") == b"line\n"

    def test_a_subtree_zip_also_goes_through_the_shared_builder(self, client: TestClient) -> None:
        """The subtree branch shares the builder with the whole-execution branch."""
        dir_name, execution_id, directory = make_execution_dir()
        seed_execution_record(execution_id, "passed", dir_name)
        write_artifact_file(directory, "report.json", b"{}")
        write_artifact_file(directory, "logs/smoke/a.log", b"line\n")

        with patch.object(shared, "build_export_zip", wraps=shared.build_export_zip) as spy:
            client.get("/artifacts/zip", params={"execution_id": execution_id, "path": "logs"})

        assert spy.call_count == 1
        assert [arcname for arcname, _ in _zip_call_files(spy)] == ["logs/smoke/a.log"]

    def test_an_empty_execution_never_reaches_the_builder(self, client: TestClient) -> None:
        """The 404 is raised before any archive assembly."""
        dir_name, execution_id, directory = make_execution_dir()
        seed_execution_record(execution_id, "passed", dir_name)
        write_artifact_file(directory, "old.json.removed", b'{"path": "old.json"}')

        with patch.object(shared, "build_export_zip", wraps=shared.build_export_zip) as spy:
            response = client.get("/artifacts/zip", params={"execution_id": execution_id})

        assert response.status_code == 404
        assert spy.call_count == 0


class TestActiveExecutionStatusSource:
    """The in-progress guard reads the executions storage constant, not a copy."""

    def test_artifact_service_has_no_status_tuple_of_its_own(self) -> None:
        """artifact_service declares no status tuple of its own."""
        assert not hasattr(artifact_service, "_IN_PROGRESS_STATUSES")

    def test_every_storage_active_status_counts_as_in_progress(self) -> None:
        """Each status in _ACTIVE_EXECUTION_STATUSES blocks artifact mutation."""
        for status_value in sorted(exec_storage._ACTIVE_EXECUTION_STATUSES):
            dir_name, execution_id, _directory = make_execution_dir()
            seed_execution_record(execution_id, status_value, dir_name)

            assert artifact_service._execution_in_progress(execution_id) is True

    def test_a_terminal_status_is_not_in_progress(self) -> None:
        """A finished execution's artifacts are mutable again."""
        dir_name, execution_id, _directory = make_execution_dir()
        seed_execution_record(execution_id, "passed", dir_name)

        assert artifact_service._execution_in_progress(execution_id) is False


class TestZipKeepsTheWholeFileName:
    """A zip name with text outside plain ASCII is sent whole (REQ-4.6.9)."""

    def test_a_name_outside_plain_ascii_is_sent_whole(self, client: TestClient) -> None:
        dir_name, execution_id, directory = make_execution_dir()
        seed_execution_record(execution_id, "passed", dir_name)
        write_artifact_file(directory, "report.json", b"{}")
        name = f"{ENTITY_NAME}.zip"

        with patch.object(artifact_service, "zip_download_name", return_value=name):
            response = client.get("/artifacts/zip", params={"execution_id": execution_id})

        assert_whole_name(response, name)
