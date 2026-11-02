"""Unit tests for DELETE /artifacts/{artifact_id} as a soft-delete.

Deletion frees the artifact bytes but leaves an audit record: a tombstone
sidecar (``<relpath>.removed``) carrying name/path/size/removed_at/removed_by.
There is no restore - this is an audit trail, not a recycle bin. The default
listing hides tombstones; ``include_removed=true`` surfaces them. Artifacts of
in-progress executions stay protected (409). Artifact metadata carries no
``version`` field.
"""

import datetime as dt
import json
import re
import uuid

import pytest
from fastapi.testclient import TestClient

from tests.api.artifacts.conftest import (
    make_execution_dir,
    seed_execution_record,
    write_artifact_file,
)

_INVALID_ID_RE = r"^Invalid artifact identifier: .+$"
_IN_PROGRESS_MESSAGE = "Cannot delete artifact of an execution in progress"


class TestSoftDeleteTombstone:
    """A delete frees bytes and writes a tombstone sidecar."""

    def test_delete_returns_204_frees_bytes_and_writes_tombstone(self, client: TestClient) -> None:
        dir_name, execution_id, directory = make_execution_dir()
        seed_execution_record(execution_id, "passed", dir_name)
        artifact_path = write_artifact_file(directory, "report.json", b"12345")

        response = client.delete(f"/artifacts/{dir_name}/report.json")

        assert response.status_code == 204
        assert response.content == b""
        assert not artifact_path.exists()
        tombstone = directory / "report.json.removed"
        assert tombstone.is_file()
        record = json.loads(tombstone.read_text())
        assert record["name"] == "report.json"
        assert record["path"] == "report.json"
        assert record["size_bytes"] == 5
        assert record["removed_by"]
        dt.datetime.fromisoformat(record["removed_at"])

    def test_tombstone_written_for_nested_artifact(self, client: TestClient) -> None:
        dir_name, execution_id, directory = make_execution_dir()
        seed_execution_record(execution_id, "failed", dir_name)
        write_artifact_file(directory, "logs/smoke/a.log", b"line\n")

        response = client.delete(f"/artifacts/{dir_name}/logs/smoke/a.log")

        assert response.status_code == 204
        assert not (directory / "logs/smoke/a.log").exists()
        tombstone = directory / "logs/smoke/a.log.removed"
        assert tombstone.is_file()
        assert json.loads(tombstone.read_text())["path"] == "logs/smoke/a.log"

    def test_sibling_artifacts_are_untouched(self, client: TestClient) -> None:
        dir_name, execution_id, directory = make_execution_dir()
        seed_execution_record(execution_id, "passed", dir_name)
        write_artifact_file(directory, "delete-me.txt", b"x")
        sibling = write_artifact_file(directory, "keep-me.txt", b"y")

        client.delete(f"/artifacts/{dir_name}/delete-me.txt")

        assert sibling.exists()
        assert not (directory / "keep-me.txt.removed").exists()

    def test_execution_record_is_not_removed(self, client: TestClient) -> None:
        from wavecore.api.services.executions import _storage as exec_storage

        dir_name, execution_id, directory = make_execution_dir()
        seed_execution_record(execution_id, "passed", dir_name)
        write_artifact_file(directory, "report.json", b"{}")

        client.delete(f"/artifacts/{dir_name}/report.json")

        assert exec_storage._execution_storage.get(execution_id) is not None


class TestSoftDeleteListingVisibility:
    """Tombstones are hidden by default and revealed by include_removed."""

    def test_default_listing_hides_tombstones(self, client: TestClient) -> None:
        dir_name, execution_id, directory = make_execution_dir()
        seed_execution_record(execution_id, "passed", dir_name)
        write_artifact_file(directory, "gone.json", b"{}")
        write_artifact_file(directory, "kept.json", b"{}")
        client.delete(f"/artifacts/{dir_name}/gone.json")

        response = client.get("/artifacts", params={"execution_id": execution_id})

        paths = [item["path"] for item in response.json()["data"]]
        assert paths == ["kept.json"]
        assert "gone.json.removed" not in paths

    def test_include_removed_surfaces_tombstone_with_audit_fields(self, client: TestClient) -> None:
        dir_name, execution_id, directory = make_execution_dir()
        seed_execution_record(execution_id, "passed", dir_name)
        write_artifact_file(directory, "gone.json", b"{}")
        write_artifact_file(directory, "kept.json", b"{}")
        client.delete(f"/artifacts/{dir_name}/gone.json")

        response = client.get(
            "/artifacts",
            params={"execution_id": execution_id, "include_removed": "true"},
        )

        items = {item["path"]: item for item in response.json()["data"]}
        assert set(items) == {"gone.json", "kept.json"}
        removed = items["gone.json"]
        assert removed["removed_at"]
        assert removed["removed_by"]
        # Live entries are not tagged as removed.
        assert not items["kept.json"].get("removed_at")

    def test_live_artifact_item_has_no_version_field(self, client: TestClient) -> None:
        dir_name, execution_id, directory = make_execution_dir()
        seed_execution_record(execution_id, "passed", dir_name)
        write_artifact_file(directory, "report.json", b"{}")

        response = client.get("/artifacts", params={"execution_id": execution_id})

        item = response.json()["data"][0]
        assert "version" not in item


class TestSoftDeleteGuardsAndErrors:
    """In-progress protection, idempotency, and identifier validation."""

    @pytest.mark.parametrize("status", ["running", "paused"])
    def test_in_progress_execution_blocks_delete(self, client: TestClient, status: str) -> None:
        execution_id = str(uuid.uuid4())
        dir_name, execution_id, directory = make_execution_dir(execution_id=execution_id)
        seed_execution_record(execution_id, status, dir_name)
        artifact_path = write_artifact_file(directory, "live.json", b"{}")

        response = client.delete(f"/artifacts/{dir_name}/live.json")

        assert response.status_code == 409
        error = response.json()["error"]
        assert re.match(rf"^{re.escape(_IN_PROGRESS_MESSAGE)}$", error["message"])
        assert error["details"] == {"execution_ids": [execution_id]}
        assert artifact_path.exists()
        assert not (directory / "live.json.removed").exists()

    def test_second_delete_returns_404(self, client: TestClient) -> None:
        dir_name, execution_id, directory = make_execution_dir()
        seed_execution_record(execution_id, "passed", dir_name)
        write_artifact_file(directory, "gone.json", b"{}")

        first = client.delete(f"/artifacts/{dir_name}/gone.json")
        second = client.delete(f"/artifacts/{dir_name}/gone.json")

        assert first.status_code == 204
        assert second.status_code == 404
        assert second.json()["error"]["message"] == f"Artifact {dir_name}/gone.json not found"

    def test_missing_artifact_returns_404(self, client: TestClient) -> None:
        dir_name, _execution_id, _directory = make_execution_dir()

        response = client.delete(f"/artifacts/{dir_name}/missing.txt")

        assert response.status_code == 404
        assert response.json()["error"]["message"] == f"Artifact {dir_name}/missing.txt not found"

    def test_traversal_identifier_rejected(self, client: TestClient) -> None:
        response = client.delete("/artifacts/..%2Fescape.txt")

        assert response.status_code == 400
        assert re.match(_INVALID_ID_RE, response.json()["error"]["message"])

    def test_orphan_dir_without_execution_record_allows_soft_delete(
        self, client: TestClient
    ) -> None:
        # A dir with no matching execution record is not in progress, so deletable.
        dir_name, _execution_id, directory = make_execution_dir()
        write_artifact_file(directory, "orphan.json", b"{}")

        response = client.delete(f"/artifacts/{dir_name}/orphan.json")

        assert response.status_code == 204
        assert not (directory / "orphan.json").exists()
        assert (directory / "orphan.json.removed").is_file()
