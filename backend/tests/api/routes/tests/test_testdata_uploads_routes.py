"""Live upload state on the Test Data routes (TDATA-14, TDATA-15, TDATA-17).

An upload is state of the test, so a session that did not start it can read it,
the session holding the test can stop it, and a file that did not land leaves a
notice these routes serve, clear and re-create.
"""

import os
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from tests.api.routes.tests.conftest import assert_error, seed_folder, testdata_root
from wavecore.api.services.tests import testdata_uploads
from wavecore.api.services.workbench import ownership

_BOUNDARY = "wave-upload-boundary"
_CONTENT_TYPE = f"multipart/form-data; boundary={_BOUNDARY}"
_STARTER = "starter-session"
_HOLDER = "holder-session"

Part = tuple[str, str | None, bytes]


@pytest.fixture(autouse=True)
def _clean_ownership() -> None:
    ownership.clear()


def _body(parts: list[Part], *, closed: bool = True) -> bytes:
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


def _upload(
    client: TestClient,
    test_id: str,
    name: str,
    content: bytes = b"payload",
    *,
    path: str = "",
    replace: str = "false",
    upload_id: str = "u1",
    session: str = _STARTER,
    size: str = "7",
    retry_of: str = "",
    closed: bool = True,
) -> Any:
    """One request in the contract's field order: every field, then the file."""
    return client.post(
        f"/tests/{test_id}/testdata/upload",
        content=_body(
            [
                ("path", None, path.encode()),
                ("replace", None, replace.encode()),
                ("upload_id", None, upload_id.encode()),
                ("session", None, session.encode()),
                ("size", None, size.encode()),
                ("retry_of", None, retry_of.encode()),
                ("files", name, content),
            ],
            closed=closed,
        ),
        headers={"Content-Type": _CONTENT_TYPE},
    )


def _snapshot(client: TestClient, test_id: str) -> dict[str, Any]:
    response = client.get(f"/tests/{test_id}/testdata/uploads")
    assert response.status_code == 200, response.text
    return response.json()


def _in_progress(test_id: str) -> list[str]:
    root: Path = testdata_root(test_id)
    if not root.exists():
        return []
    return [path.name for path in root.rglob("*") if path.name.startswith("_upld-")]


class TestSnapshotRoute:
    """What a session joining late reads back."""

    def test_a_test_with_nothing_in_flight_answers_two_empty_lists(
        self, client: TestClient, test_id: str
    ) -> None:
        assert _snapshot(client, test_id) == {"uploads": [], "interruptions": []}

    def test_an_upload_that_finished_leaves_nothing_in_flight(
        self, client: TestClient, test_id: str
    ) -> None:
        assert _upload(client, test_id, "alpha.txt").status_code == 201

        assert _snapshot(client, test_id) == {"uploads": [], "interruptions": []}

    def test_an_unknown_test_answers_the_same_empty_state(self, client: TestClient) -> None:
        assert _snapshot(client, "no-such-test") == {"uploads": [], "interruptions": []}


class TestInterruptionsFromTheUploadRoute:
    """Whatever stops a file landing leaves the same notice."""

    def test_a_refusal_before_the_first_byte_leaves_a_notice(
        self, client: TestClient, test_id: str
    ) -> None:
        seed_folder(test_id, "notes")

        response = _upload(client, test_id, "notes", b"cannot land")

        assert response.status_code == 409
        interruptions = _snapshot(client, test_id)["interruptions"]
        assert len(interruptions) == 1
        assert interruptions[0]["id"] == "u1"
        assert interruptions[0]["name"] == "notes"
        assert interruptions[0]["reason"] == "Folder already exists: notes"

    def test_the_notice_keeps_the_folder_the_file_was_going_to(
        self, client: TestClient, test_id: str
    ) -> None:
        seed_folder(test_id, "inputs")
        seed_folder(test_id, "inputs/taken")

        _upload(client, test_id, "taken", path="inputs")

        notice = _snapshot(client, test_id)["interruptions"][0]
        assert notice["folder"] == "inputs"
        assert notice["path"] == "inputs/taken"

    def test_a_truncated_body_leaves_a_notice(self, client: TestClient, test_id: str) -> None:
        response = _upload(client, test_id, "alpha.txt", closed=False)

        assert response.status_code == 400
        notice = _snapshot(client, test_id)["interruptions"][0]
        assert notice["reason"] == "Upload ended before the file was complete"

    def test_the_replace_answer_is_kept_on_the_notice(
        self, client: TestClient, test_id: str
    ) -> None:
        _upload(client, test_id, "alpha.txt", replace="true", closed=False)

        assert _snapshot(client, test_id)["interruptions"][0]["replace"] is True

    def test_a_later_success_on_the_same_path_clears_the_notice(
        self, client: TestClient, test_id: str
    ) -> None:
        _upload(client, test_id, "alpha.txt", closed=False)

        assert _upload(client, test_id, "alpha.txt", upload_id="u2").status_code == 201

        assert _snapshot(client, test_id)["interruptions"] == []

    def test_a_success_elsewhere_leaves_the_notice_alone(
        self, client: TestClient, test_id: str
    ) -> None:
        _upload(client, test_id, "alpha.txt", closed=False)

        assert _upload(client, test_id, "beta.txt", upload_id="u2").status_code == 201

        assert [n["name"] for n in _snapshot(client, test_id)["interruptions"]] == ["alpha.txt"]

    def test_a_failure_that_is_not_a_wave_answer_still_names_the_upload(
        self, client: TestClient, test_id: str
    ) -> None:
        with patch.object(
            testdata_uploads, "advance", side_effect=RuntimeError("the disk went away")
        ):
            response = _upload(client, test_id, "alpha.txt")

        assert response.status_code == 500
        assert _snapshot(client, test_id)["interruptions"][0]["reason"] == (
            "The upload did not complete"
        )


class TestRetry:
    """A retry may displace its own abandoned attempt, and only its own (TDATA-17)."""

    def _abandon(self, client: TestClient, test_id: str, name: str = "alpha.txt") -> None:
        """An attempt whose request died before it could clear up after itself."""
        root: Path = testdata_root(test_id)
        root.mkdir(parents=True, exist_ok=True)
        os.chmod(root, 0o700)
        (root / f"_upld-{name}").write_bytes(b"half a file")
        os.chmod(root, 0o500)
        client.post(
            f"/tests/{test_id}/testdata/uploads/u1/interrupt",
            json={"name": name, "reason": "Upload ended before the file was complete"},
        )

    def test_a_plain_upload_is_refused_while_the_leftover_owns_the_name(
        self, client: TestClient, test_id: str
    ) -> None:
        self._abandon(client, test_id)

        response = _upload(client, test_id, "alpha.txt", upload_id="u2")

        assert_error(
            response,
            status_code=409,
            code="CONFLICT",
            message="Upload already in progress: alpha.txt",
        )

    def test_a_retry_displaces_it_and_lands(self, client: TestClient, test_id: str) -> None:
        self._abandon(client, test_id)

        response = _upload(
            client, test_id, "alpha.txt", b"second try", upload_id="u2", retry_of="u1", size="10"
        )

        assert response.status_code == 201, response.text
        assert (testdata_root(test_id) / "alpha.txt").read_bytes() == b"second try"
        assert _in_progress(test_id) == []

    def test_the_retry_clears_the_notice_it_names(self, client: TestClient, test_id: str) -> None:
        self._abandon(client, test_id)

        _upload(client, test_id, "alpha.txt", upload_id="u2", retry_of="u1")

        assert _snapshot(client, test_id)["interruptions"] == []

    def test_a_retry_that_fails_again_leaves_exactly_one_notice(
        self, client: TestClient, test_id: str
    ) -> None:
        self._abandon(client, test_id)

        _upload(client, test_id, "alpha.txt", upload_id="u2", retry_of="u1", closed=False)

        notices = _snapshot(client, test_id)["interruptions"]
        assert [notice["id"] for notice in notices] == ["u2"]

    def test_a_retry_of_a_notice_that_is_already_gone_still_lands(
        self, client: TestClient, test_id: str
    ) -> None:
        response = _upload(client, test_id, "alpha.txt", upload_id="u2", retry_of="u1")

        assert response.status_code == 201


class TestUploadFields:
    """The fields the request carries beside the file."""

    def test_an_upload_without_an_id_still_lands(self, client: TestClient, test_id: str) -> None:
        response = _upload(client, test_id, "alpha.txt", upload_id="")

        assert response.status_code == 201

    def test_an_upload_without_an_id_that_fails_still_leaves_a_notice(
        self, client: TestClient, test_id: str
    ) -> None:
        _upload(client, test_id, "alpha.txt", upload_id="", closed=False)

        assert len(_snapshot(client, test_id)["interruptions"]) == 1

    def test_a_size_that_is_not_a_number_counts_as_unknown(
        self, client: TestClient, test_id: str
    ) -> None:
        with patch.object(testdata_uploads, "start", wraps=testdata_uploads.start) as start:
            _upload(client, test_id, "alpha.txt", size="not-a-number")

        assert start.call_args.kwargs["total_bytes"] == 0

    def test_the_declared_size_reaches_the_record(self, client: TestClient, test_id: str) -> None:
        with patch.object(testdata_uploads, "start", wraps=testdata_uploads.start) as start:
            _upload(client, test_id, "alpha.txt", size="7")

        assert start.call_args.kwargs["total_bytes"] == 7


class TestCancelRoute:
    """Who may stop an upload, and what the stopped request answers."""

    def _live(self, test_id: str) -> testdata_uploads.Upload:
        return testdata_uploads.start(
            test_id,
            "u1",
            folder="",
            name="alpha.txt",
            path="alpha.txt",
            total_bytes=7,
            session=_STARTER,
            replace=False,
        )

    def test_the_session_that_started_it_may_cancel(self, client: TestClient, test_id: str) -> None:
        upload = self._live(test_id)

        response = client.post(
            f"/tests/{test_id}/testdata/uploads/u1/cancel", json={"session": _STARTER}
        )

        assert response.status_code == 204
        assert testdata_uploads.is_canceled(upload) is True

    def test_the_session_holding_the_test_may_cancel(
        self, client: TestClient, test_id: str
    ) -> None:
        upload = self._live(test_id)
        ownership.claim(_HOLDER, "Holder")

        response = client.post(
            f"/tests/{test_id}/testdata/uploads/u1/cancel", json={"session": _HOLDER}
        )

        assert response.status_code == 204
        assert testdata_uploads.is_canceled(upload) is True

    def test_anyone_else_is_refused(self, client: TestClient, test_id: str) -> None:
        self._live(test_id)
        ownership.claim(_HOLDER, "Holder")

        response = client.post(
            f"/tests/{test_id}/testdata/uploads/u1/cancel", json={"session": "third-party"}
        )

        assert_error(
            response,
            status_code=409,
            code="CONFLICT",
            message=(
                "Only the session holding the test, or the one that started it, "
                "can cancel an upload"
            ),
        )

    def test_an_unknown_upload_is_not_found(self, client: TestClient, test_id: str) -> None:
        response = client.post(
            f"/tests/{test_id}/testdata/uploads/nothing/cancel", json={"session": _STARTER}
        )

        assert_error(response, status_code=404, code="NOT_FOUND", message="No such upload")

    def test_a_canceled_upload_is_dropped_and_leaves_no_notice(
        self, client: TestClient, test_id: str
    ) -> None:
        with patch.object(testdata_uploads, "is_canceled", return_value=True):
            response = _upload(client, test_id, "alpha.txt")

        assert_error(
            response,
            status_code=409,
            code="CONFLICT",
            message="Upload canceled: alpha.txt",
        )
        assert _snapshot(client, test_id) == {"uploads": [], "interruptions": []}
        assert _in_progress(test_id) == []


class TestDismissRoute:
    """Clearing the notice a file left behind."""

    def test_the_notice_goes(self, client: TestClient, test_id: str) -> None:
        _upload(client, test_id, "alpha.txt", closed=False)

        response = client.post(f"/tests/{test_id}/testdata/uploads/u1/dismiss")

        assert response.status_code == 204
        assert _snapshot(client, test_id)["interruptions"] == []

    def test_an_unknown_notice_is_not_found(self, client: TestClient, test_id: str) -> None:
        response = client.post(f"/tests/{test_id}/testdata/uploads/nothing/dismiss")

        assert_error(response, status_code=404, code="NOT_FOUND", message="No such upload")


class TestInterruptRoute:
    """A file the client never got to send leaves the same notice."""

    def test_the_notice_carries_the_reason_the_client_gave(
        self, client: TestClient, test_id: str
    ) -> None:
        response = client.post(
            f"/tests/{test_id}/testdata/uploads/u9/interrupt",
            json={
                "path": "inputs",
                "name": "huge.bin",
                "reason": "Storing huge.bin would leave less than 1 GB free",
                "replace": True,
            },
        )

        assert response.status_code == 204
        notice = _snapshot(client, test_id)["interruptions"][0]
        assert notice == {
            "id": "u9",
            "folder": "inputs",
            "name": "huge.bin",
            "path": "inputs/huge.bin",
            "reason": "Storing huge.bin would leave less than 1 GB free",
            "replace": True,
            "at": notice["at"],
        }

    def test_a_file_bound_for_the_root_keeps_its_bare_name(
        self, client: TestClient, test_id: str
    ) -> None:
        client.post(
            f"/tests/{test_id}/testdata/uploads/u9/interrupt",
            json={"name": "huge.bin", "reason": "no room"},
        )

        assert _snapshot(client, test_id)["interruptions"][0]["path"] == "huge.bin"
