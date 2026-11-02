"""Unit tests for DELETE /artifacts/executions/{execution_id} (bulk path).

Mass "Delete artifacts" over an execution soft-deletes every live artifact of
that execution in one call: bytes freed, a tombstone written per artifact, the
execution record itself untouched. Empty/unknown executions return 404; an
in-progress execution is protected with 409.
"""

import re
import uuid

import pytest
from fastapi.testclient import TestClient

from tests.api.artifacts.conftest import (
    make_execution_dir,
    seed_execution_record,
    write_artifact_file,
)

_IN_PROGRESS_MESSAGE = "Cannot delete artifact of an execution in progress"


class TestExecutionDeleteHappyPath:
    """204 soft-deletes every live artifact of the execution."""

    def test_returns_204_and_tombstones_every_artifact(self, client: TestClient) -> None:
        dir_name, execution_id, directory = make_execution_dir()
        seed_execution_record(execution_id, "failed", dir_name)
        write_artifact_file(directory, "report.json", b"{}")
        write_artifact_file(directory, "logs/smoke/a.log", b"line\n")

        response = client.delete(f"/artifacts/executions/{execution_id}")

        assert response.status_code == 204
        assert response.content == b""
        assert not (directory / "report.json").exists()
        assert not (directory / "logs/smoke/a.log").exists()
        assert (directory / "report.json.removed").is_file()
        assert (directory / "logs/smoke/a.log.removed").is_file()

    def test_default_list_empty_and_include_removed_shows_all(self, client: TestClient) -> None:
        dir_name, execution_id, directory = make_execution_dir()
        seed_execution_record(execution_id, "passed", dir_name)
        write_artifact_file(directory, "one.json", b"{}")
        write_artifact_file(directory, "two.json", b"{}")

        client.delete(f"/artifacts/executions/{execution_id}")

        live = client.get("/artifacts", params={"execution_id": execution_id})
        assert live.json()["data"] == []
        with_removed = client.get(
            "/artifacts",
            params={"execution_id": execution_id, "include_removed": "true"},
        )
        paths = sorted(item["path"] for item in with_removed.json()["data"])
        assert paths == ["one.json", "two.json"]

    def test_execution_record_is_not_removed(self, client: TestClient) -> None:
        from wavecore.api.services.executions import _storage as exec_storage

        dir_name, execution_id, directory = make_execution_dir()
        seed_execution_record(execution_id, "passed", dir_name)
        write_artifact_file(directory, "report.json", b"{}")

        client.delete(f"/artifacts/executions/{execution_id}")

        assert exec_storage._execution_storage.get(execution_id) is not None


class TestExecutionDeleteErrors:
    """404 for empty/unknown executions, 409 while in progress."""

    def test_unknown_execution_returns_404(self, client: TestClient) -> None:
        # An unrelated execution dir exists, but the queried id has none.
        other_dir, other_id, other_directory = make_execution_dir(stamp="20260609-080000")
        seed_execution_record(other_id, "passed", other_dir)
        write_artifact_file(other_directory, "report.json", b"{}")
        execution_id = str(uuid.uuid4())

        response = client.delete(f"/artifacts/executions/{execution_id}")

        assert response.status_code == 404
        assert re.match(
            rf"^No artifacts found for execution {re.escape(execution_id)}$",
            response.json()["error"]["message"],
        )

    def test_execution_with_no_live_artifacts_returns_404(self, client: TestClient) -> None:
        dir_name, execution_id, _directory = make_execution_dir()
        seed_execution_record(execution_id, "passed", dir_name)

        response = client.delete(f"/artifacts/executions/{execution_id}")

        assert response.status_code == 404
        assert re.match(
            rf"^No artifacts found for execution {re.escape(execution_id)}$",
            response.json()["error"]["message"],
        )

    @pytest.mark.parametrize("status", ["running", "paused"])
    def test_in_progress_execution_blocks_delete(self, client: TestClient, status: str) -> None:
        execution_id = str(uuid.uuid4())
        dir_name, execution_id, directory = make_execution_dir(execution_id=execution_id)
        seed_execution_record(execution_id, status, dir_name)
        artifact_path = write_artifact_file(directory, "live.json", b"{}")

        response = client.delete(f"/artifacts/executions/{execution_id}")

        assert response.status_code == 409
        error = response.json()["error"]
        assert re.match(rf"^{re.escape(_IN_PROGRESS_MESSAGE)}$", error["message"])
        assert error["details"] == {"execution_ids": [execution_id]}
        assert artifact_path.exists()
        assert not (directory / "live.json.removed").exists()
