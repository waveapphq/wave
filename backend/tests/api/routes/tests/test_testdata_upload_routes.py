"""Unit tests for the streamed upload endpoints (REQ-5.2.4.12).

The route reads ``path`` and ``replace`` before the file part, so a bad target is
refused without accepting the body, and exactly one file may follow. The space
pre-check answers the same refusal before the client sends anything.
"""

import shutil
import uuid
from collections import namedtuple
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.api.routes.tests.conftest import (
    assert_error,
    assert_running_conflict,
    seed_file,
    seed_folder,
    seed_running_execution,
    seed_running_session,
    testdata_root,
)

_DiskUsage = namedtuple("_DiskUsage", "total used free")
_ALMOST_FULL = _DiskUsage(10**12, 10**12 - 1024, 1024)
_ROOMY = _DiskUsage(10**12, 0, 10**12)
_BOUNDARY = "wave-upload-boundary"
_CONTENT_TYPE = f"multipart/form-data; boundary={_BOUNDARY}"

Part = tuple[str, str | None, bytes]


def _body(parts: list[Part], *, closed: bool = True) -> bytes:
    """A raw multipart body; a part with filename None is a plain form field."""
    out = bytearray()
    for name, filename, content in parts:
        disposition = f'form-data; name="{name}"'
        if filename is not None:
            disposition += f'; filename="{filename}"'
        out += f"--{_BOUNDARY}\r\nContent-Disposition: {disposition}\r\n\r\n".encode()
        out += content + b"\r\n"
    if closed:
        out += f"--{_BOUNDARY}--\r\n".encode()
    return bytes(out)


def _post(client: TestClient, test_id: str, parts: list[Part], *, closed: bool = True) -> Any:
    return client.post(
        f"/tests/{test_id}/testdata/upload",
        content=_body(parts, closed=closed),
        headers={"Content-Type": _CONTENT_TYPE},
    )


def _upload(
    client: TestClient,
    test_id: str,
    name: str,
    content: bytes = b"id,name\n",
    *,
    path: str = "",
    replace: str = "false",
) -> Any:
    """One request in the contract's field order: path, replace, then the file."""
    return _post(
        client,
        test_id,
        [
            ("path", None, path.encode()),
            ("replace", None, replace.encode()),
            ("files", name, content),
        ],
    )


def _in_progress(test_id: str) -> list[str]:
    root: Path = testdata_root(test_id)
    if not root.exists():
        return []
    return [path.name for path in root.rglob("*") if path.name.startswith("_upld-")]


class TestUploadSuccess:
    """201 with the stored file's path, size and whether it replaced one."""

    def test_a_file_lands_in_the_root(self, client: TestClient, test_id: str) -> None:
        response = _upload(client, test_id, "customers.csv", b"id,name\n")

        assert response.status_code == 201
        assert response.json() == {
            "path": "customers.csv",
            "size_bytes": 8,
            "replaced": False,
        }
        assert (testdata_root(test_id) / "customers.csv").read_bytes() == b"id,name\n"

    def test_the_target_folder_prefixes_the_path(self, client: TestClient, test_id: str) -> None:
        seed_folder(test_id, "fixtures")

        response = _upload(client, test_id, "orders.json", b"{}", path="fixtures")

        assert response.status_code == 201
        assert response.json()["path"] == "fixtures/orders.json"
        assert (testdata_root(test_id) / "fixtures" / "orders.json").exists()

    def test_replace_true_overwrites_and_flags_it(self, client: TestClient, test_id: str) -> None:
        seed_file(test_id, "customers.csv", b"old")

        response = _upload(client, test_id, "customers.csv", b"new", replace="true")

        assert response.status_code == 201
        assert response.json()["replaced"] is True
        assert (testdata_root(test_id) / "customers.csv").read_bytes() == b"new"

    def test_an_empty_file_is_stored(self, client: TestClient, test_id: str) -> None:
        response = _upload(client, test_id, "empty.csv", b"")

        assert response.status_code == 201
        assert response.json()["size_bytes"] == 0

    def test_no_in_progress_file_survives_a_stored_upload(
        self, client: TestClient, test_id: str
    ) -> None:
        _upload(client, test_id, "customers.csv", b"x")

        assert _in_progress(test_id) == []

    def test_replace_defaults_to_false_when_the_field_is_absent(
        self, client: TestClient, test_id: str
    ) -> None:
        seed_file(test_id, "customers.csv", b"old")

        response = _post(
            client,
            test_id,
            [("path", None, b""), ("files", "customers.csv", b"new")],
        )

        assert_error(
            response,
            status_code=409,
            code="CONFLICT",
            message="File already exists: customers.csv",
        )

    def test_the_path_defaults_to_the_root_when_the_field_is_absent(
        self, client: TestClient, test_id: str
    ) -> None:
        response = _post(client, test_id, [("files", "customers.csv", b"x")])

        assert response.status_code == 201
        assert response.json()["path"] == "customers.csv"


class TestUploadWireContract:
    """Field order and the one-file rule are part of the contract."""

    def test_a_second_file_part_is_refused(self, client: TestClient, test_id: str) -> None:
        response = _post(
            client,
            test_id,
            [
                ("path", None, b""),
                ("replace", None, b"false"),
                ("files", "a.csv", b"a"),
                ("files", "b.csv", b"b"),
            ],
        )

        assert_error(
            response,
            status_code=400,
            code="VALIDATION_ERROR",
            message="One file per upload request",
        )

    def test_a_field_after_the_file_part_is_refused(self, client: TestClient, test_id: str) -> None:
        response = _post(
            client,
            test_id,
            [
                ("path", None, b""),
                ("files", "a.csv", b"a"),
                ("replace", None, b"true"),
            ],
        )

        assert_error(
            response,
            status_code=400,
            code="VALIDATION_ERROR",
            message="Send path and replace before the file",
        )

    def test_a_request_without_a_file_part_is_refused(
        self, client: TestClient, test_id: str
    ) -> None:
        response = _post(client, test_id, [("path", None, b""), ("replace", None, b"false")])

        assert_error(
            response,
            status_code=400,
            code="VALIDATION_ERROR",
            message="No file in the upload request",
        )

    def test_a_body_that_ends_mid_file_is_refused(self, client: TestClient, test_id: str) -> None:
        response = _post(
            client,
            test_id,
            [("path", None, b""), ("files", "a.csv", b"half")],
            closed=False,
        )

        assert_error(
            response,
            status_code=400,
            code="VALIDATION_ERROR",
            message="Upload ended before the file was complete",
        )

    def test_a_body_that_ends_mid_file_leaves_nothing_behind(
        self, client: TestClient, test_id: str
    ) -> None:
        _post(
            client,
            test_id,
            [("path", None, b""), ("files", "a.csv", b"half")],
            closed=False,
        )

        assert _in_progress(test_id) == []
        assert not (testdata_root(test_id) / "a.csv").exists()

    def test_a_non_multipart_body_is_refused(self, client: TestClient, test_id: str) -> None:
        response = client.post(
            f"/tests/{test_id}/testdata/upload",
            content=b"just bytes",
            headers={"Content-Type": "application/octet-stream"},
        )

        assert_error(
            response,
            status_code=400,
            code="VALIDATION_ERROR",
            message="Malformed multipart request",
        )


class TestUploadValidation:
    """400 for a bad target folder or a bad file name."""

    def test_traversal_in_the_target_folder_is_rejected(
        self, client: TestClient, test_id: str
    ) -> None:
        response = _upload(client, test_id, "customers.csv", b"x", path="../evil")

        assert_error(
            response,
            status_code=400,
            code="VALIDATION_ERROR",
            message="Invalid test data path: ../evil",
        )

    def test_absolute_target_folder_is_rejected(self, client: TestClient, test_id: str) -> None:
        response = _upload(client, test_id, "customers.csv", b"x", path="/etc")

        assert_error(
            response,
            status_code=400,
            code="VALIDATION_ERROR",
            message="Invalid test data path: /etc",
        )

    def test_file_name_with_a_separator_is_rejected(self, client: TestClient, test_id: str) -> None:
        response = _upload(client, test_id, "bad/name.csv", b"x")

        assert_error(
            response,
            status_code=400,
            code="VALIDATION_ERROR",
            message="Invalid name: bad/name.csv",
        )

    def test_dot_dot_file_name_is_rejected(self, client: TestClient, test_id: str) -> None:
        response = _upload(client, test_id, "..", b"x")

        assert_error(
            response,
            status_code=400,
            code="VALIDATION_ERROR",
            message="Invalid name: ..",
        )

    def test_an_empty_file_name_is_rejected(self, client: TestClient, test_id: str) -> None:
        response = _upload(client, test_id, "", b"x")

        assert_error(
            response,
            status_code=400,
            code="VALIDATION_ERROR",
            message="Invalid name: ",
        )

    def test_over_long_file_name_is_rejected(self, client: TestClient, test_id: str) -> None:
        name = "a" * 256

        response = _upload(client, test_id, name, b"x")

        assert_error(
            response,
            status_code=400,
            code="VALIDATION_ERROR",
            message=f"Invalid name: {name}",
        )

    def test_a_refused_name_writes_nothing(self, client: TestClient, test_id: str) -> None:
        _upload(client, test_id, "bad/name.csv", b"x")

        assert _in_progress(test_id) == []


class TestUploadNotFound:
    """404 for an unknown test and for a target folder that is not there."""

    def test_unknown_test_is_not_found(self, client: TestClient) -> None:
        missing = str(uuid.uuid4())

        response = _upload(client, missing, "customers.csv", b"x")

        assert_error(
            response,
            status_code=404,
            code="NOT_FOUND",
            message=f"Test not found: {missing}",
        )

    def test_missing_target_folder_is_not_found(self, client: TestClient, test_id: str) -> None:
        response = _upload(client, test_id, "orders.json", b"{}", path="fixtures")

        assert_error(
            response,
            status_code=404,
            code="NOT_FOUND",
            message="Folder not found: fixtures",
        )


class TestUploadConflicts:
    """409 when the name is already taken or already being written."""

    def test_existing_file_without_replace_is_a_conflict(
        self, client: TestClient, test_id: str
    ) -> None:
        seed_file(test_id, "customers.csv", b"old")

        response = _upload(client, test_id, "customers.csv", b"new")

        assert_error(
            response,
            status_code=409,
            code="CONFLICT",
            message="File already exists: customers.csv",
        )

    def test_a_conflict_leaves_the_existing_file_untouched(
        self, client: TestClient, test_id: str
    ) -> None:
        seed_file(test_id, "customers.csv", b"old")

        response = _upload(client, test_id, "customers.csv", b"new")

        assert response.status_code == 409
        assert (testdata_root(test_id) / "customers.csv").read_bytes() == b"old"
        assert _in_progress(test_id) == []

    def test_folder_of_the_same_name_is_a_conflict(self, client: TestClient, test_id: str) -> None:
        seed_folder(test_id, "customers.csv")

        response = _upload(client, test_id, "customers.csv", b"new")

        assert_error(
            response,
            status_code=409,
            code="CONFLICT",
            message="Folder already exists: customers.csv",
        )

    def test_folder_conflict_holds_even_with_replace(
        self, client: TestClient, test_id: str
    ) -> None:
        seed_folder(test_id, "customers.csv")

        response = _upload(client, test_id, "customers.csv", b"new", replace="true")

        assert_error(
            response,
            status_code=409,
            code="CONFLICT",
            message="Folder already exists: customers.csv",
        )

    def test_an_upload_of_the_same_name_already_running_is_a_conflict(
        self, client: TestClient, test_id: str
    ) -> None:
        seed_file(test_id, "_upld-customers.csv", b"partial")

        response = _upload(client, test_id, "customers.csv", b"new")

        assert_error(
            response,
            status_code=409,
            code="CONFLICT",
            message="Upload already in progress: customers.csv",
        )


class TestUploadRunningTest:
    """409 while any execution or workbench session holds the test."""

    def test_tracked_execution_blocks_the_upload(self, client: TestClient, test_id: str) -> None:
        execution_id = seed_running_execution(test_id)

        response = _upload(client, test_id, "customers.csv", b"x")

        assert_running_conflict(response, [execution_id])

    def test_paused_execution_blocks_the_upload(self, client: TestClient, test_id: str) -> None:
        execution_id = seed_running_execution(test_id, status="paused")

        response = _upload(client, test_id, "customers.csv", b"x")

        assert_running_conflict(response, [execution_id])

    def test_workbench_session_blocks_the_upload(self, client: TestClient, test_id: str) -> None:
        session_id = seed_running_session(test_id)

        response = _upload(client, test_id, "customers.csv", b"x")

        assert_running_conflict(response, [session_id])

    def test_nothing_is_written_while_the_test_runs(self, client: TestClient, test_id: str) -> None:
        seed_running_execution(test_id)

        response = _upload(client, test_id, "customers.csv", b"x")

        assert response.status_code == 409
        assert not (testdata_root(test_id) / "customers.csv").exists()
        assert _in_progress(test_id) == []

    def test_a_finished_execution_does_not_block(self, client: TestClient, test_id: str) -> None:
        seed_running_execution(test_id, status="passed")

        response = _upload(client, test_id, "customers.csv", b"x")

        assert response.status_code == 201


class TestUploadFreeSpaceGuard:
    """507 as soon as the bytes landing would leave under 1 GB free."""

    def test_low_free_space_refuses_the_upload(
        self, client: TestClient, test_id: str, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(shutil, "disk_usage", lambda _path: _ALMOST_FULL)

        response = _upload(client, test_id, "customers.csv", b"x")

        assert_error(
            response,
            status_code=507,
            code="INSUFFICIENT_STORAGE",
            message="Storing customers.csv would leave less than 1 GB free",
        )

    def test_a_refused_upload_leaves_nothing_behind(
        self, client: TestClient, test_id: str, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(shutil, "disk_usage", lambda _path: _ALMOST_FULL)

        response = _upload(client, test_id, "customers.csv", b"x")

        assert response.status_code == 507
        assert not (testdata_root(test_id) / "customers.csv").exists()
        assert _in_progress(test_id) == []

    def test_conflicts_are_reported_before_the_space_guard(
        self, client: TestClient, test_id: str, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        seed_file(test_id, "customers.csv", b"old")
        monkeypatch.setattr(shutil, "disk_usage", lambda _path: _ALMOST_FULL)

        response = _upload(client, test_id, "customers.csv", b"new")

        assert_error(
            response,
            status_code=409,
            code="CONFLICT",
            message="File already exists: customers.csv",
        )


class TestUploadSpacePrecheck:
    """GET /tests/{id}/testdata/space answers before the client sends the body."""

    def test_enough_room_answers_ok(
        self, client: TestClient, test_id: str, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(shutil, "disk_usage", lambda _path: _ROOMY)

        response = client.get(
            f"/tests/{test_id}/testdata/space", params={"bytes": 1024, "name": "customers.csv"}
        )

        assert response.status_code == 200
        assert response.json() == {"ok": True}

    def test_too_little_room_is_refused(
        self, client: TestClient, test_id: str, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(shutil, "disk_usage", lambda _path: _ALMOST_FULL)

        response = client.get(
            f"/tests/{test_id}/testdata/space", params={"bytes": 1024, "name": "customers.csv"}
        )

        assert_error(
            response,
            status_code=507,
            code="INSUFFICIENT_STORAGE",
            message="Storing customers.csv would leave less than 1 GB free",
        )

    def test_a_running_test_blocks_the_pre_check(self, client: TestClient, test_id: str) -> None:
        execution_id = seed_running_execution(test_id)

        response = client.get(
            f"/tests/{test_id}/testdata/space", params={"bytes": 1, "name": "customers.csv"}
        )

        assert_running_conflict(response, [execution_id])

    def test_an_unknown_test_is_not_found(self, client: TestClient) -> None:
        missing = str(uuid.uuid4())

        response = client.get(
            f"/tests/{missing}/testdata/space", params={"bytes": 1, "name": "customers.csv"}
        )

        assert_error(
            response,
            status_code=404,
            code="NOT_FOUND",
            message=f"Test not found: {missing}",
        )
