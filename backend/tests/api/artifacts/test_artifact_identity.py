"""An artifact id names one stored artifact file inside the artifact root (REQ-5.2.4.12).

The id is the execution folder name and the file's path inside it. Meta, content
and delete check the real folder the entry sits in and, when the entry is a link,
the place the link leads to: each must be inside the artifact root, outside the
workbench sessions area, and below an execution folder. The answers name the
artifact by its real folder and the entry's own name, so another spelling of the
same entry (a dot segment, a folder link) answers like the listing does. An
execution folder is a real folder in the artifact root; a link there is none.
"""

import json
import uuid
from pathlib import Path
from typing import NamedTuple

import pytest
from fastapi.testclient import TestClient
from httpx2 import Response

from tests.api.artifacts.conftest import (
    make_execution_dir,
    seed_execution_record,
    write_artifact_file,
)
from wavecore.api.services import artifact_service
from wavecore.api.services.storage_paths import get_artifacts_storage_path

_IN_PROGRESS_MESSAGE = "Cannot delete artifact of an execution in progress"


def _invalid(artifact_id: str) -> str:
    return f"Invalid artifact identifier: {artifact_id}"


def _ask(client: TestClient, route: str, artifact_id: str) -> Response:
    """One artifact route for an id, its slashes encoded so the id reaches the route whole."""
    encoded = artifact_id.replace("/", "%2F").replace("\0", "%00")
    if route == "delete":
        return client.delete(f"/artifacts/{encoded}")
    return client.get(f"/artifacts/{route}/{encoded}")


_ROUTES = ["meta", "content", "delete"]


@pytest.fixture
def outside(tmp_path: Path) -> Path:
    """A folder outside the artifact root holding one file."""
    folder = tmp_path / "outside"
    folder.mkdir()
    (folder / "secret.txt").write_bytes(b"secret")
    return folder


class TestADotSegmentSpelling:
    """A dot segment names the same artifact, and every rule holds for it."""

    def test_meta_names_the_artifact_and_its_execution(self, client: TestClient) -> None:
        dir_name, execution_id, directory = make_execution_dir()
        write_artifact_file(directory, "logs/service.log", b"line\n")

        response = _ask(client, "meta", f"./{dir_name}/logs/service.log")

        assert response.status_code == 200
        body = response.json()
        assert body["id"] == f"{dir_name}/logs/service.log"
        assert body["execution_id"] == execution_id
        assert body["path"] == "logs/service.log"
        assert body["name"] == "service.log"

    def test_dot_segments_inside_the_id_name_the_same_artifact(self, client: TestClient) -> None:
        dir_name, _execution_id, directory = make_execution_dir()
        write_artifact_file(directory, "logs/service.log", b"line\n")

        response = _ask(client, "meta", f"{dir_name}/./logs/./service.log")

        assert response.json()["id"] == f"{dir_name}/logs/service.log"
        assert response.json()["path"] == "logs/service.log"

    def test_content_is_the_artifact_bytes(self, client: TestClient) -> None:
        dir_name, _execution_id, directory = make_execution_dir()
        write_artifact_file(directory, "data.txt", b"0123456789")

        response = _ask(client, "content", f"./{dir_name}/data.txt")

        assert response.status_code == 200
        assert response.content == b"0123456789"
        assert response.headers["content-disposition"] == 'attachment; filename="data.txt"'

    @pytest.mark.parametrize("status", ["running", "paused"])
    def test_an_execution_in_progress_keeps_the_artifact(
        self, client: TestClient, status: str
    ) -> None:
        dir_name, execution_id, directory = make_execution_dir()
        seed_execution_record(execution_id, status, dir_name)
        artifact = write_artifact_file(directory, "live.json", b"{}")

        response = _ask(client, "delete", f"./{dir_name}/live.json")

        assert response.status_code == 409
        error = response.json()["error"]
        assert error["message"] == _IN_PROGRESS_MESSAGE
        assert error["details"] == {"execution_ids": [execution_id]}
        assert artifact.read_bytes() == b"{}"
        assert not (directory / "live.json.removed").exists()

    def test_a_delete_records_the_path_the_artifact_had(self, client: TestClient) -> None:
        dir_name, execution_id, directory = make_execution_dir()
        seed_execution_record(execution_id, "passed", dir_name)
        write_artifact_file(directory, "logs/a.log", b"12345")

        response = _ask(client, "delete", f"./{dir_name}/logs/a.log")

        assert response.status_code == 204
        assert not (directory / "logs/a.log").exists()
        record = json.loads((directory / "logs/a.log.removed").read_text())
        assert record["path"] == "logs/a.log"
        assert record["name"] == "a.log"
        assert record["size_bytes"] == 5
        listing = client.get(
            "/artifacts", params={"execution_id": execution_id, "include_removed": "true"}
        )
        assert [(item["id"], item["path"]) for item in listing.json()["data"]] == [
            (f"{dir_name}/logs/a.log", "logs/a.log")
        ]

    @pytest.mark.parametrize("spelling", ["{dir}/.", "./{dir}", "./."])
    @pytest.mark.parametrize("route", _ROUTES)
    def test_an_id_that_names_no_file_below_an_execution_folder_is_invalid(
        self, client: TestClient, spelling: str, route: str
    ) -> None:
        dir_name, _execution_id, directory = make_execution_dir()
        write_artifact_file(directory, "data.txt", b"x")
        artifact_id = spelling.format(dir=dir_name)

        response = _ask(client, route, artifact_id)

        assert response.status_code == 400
        assert response.json()["error"]["message"] == _invalid(artifact_id)
        assert (directory / "data.txt").read_bytes() == b"x"


class TestTheSessionsAreaIsRefused:
    """The workbench sessions area is never an artifact: not by name, through a dot
    segment, through a folder link, or through a file link."""

    @pytest.mark.parametrize("route", _ROUTES)
    @pytest.mark.parametrize(
        "spelling",
        [
            "sessions/{sid}/note.txt",
            "./sessions/{sid}/note.txt",
            "{dir}/into/note.txt",
            "{dir}/peek.txt",
        ],
    )
    def test_every_spelling_is_invalid_and_the_session_file_stays(
        self, client: TestClient, route: str, spelling: str
    ) -> None:
        session_id = str(uuid.uuid4())
        session_dir = get_artifacts_storage_path() / "sessions" / session_id
        note = write_artifact_file(session_dir, "note.txt", b"session")
        dir_name, _execution_id, directory = make_execution_dir()
        (directory / "into").symlink_to(session_dir, target_is_directory=True)
        (directory / "peek.txt").symlink_to(note)
        artifact_id = spelling.format(sid=session_id, dir=dir_name)

        response = _ask(client, route, artifact_id)

        assert response.status_code == 400
        assert response.json()["error"]["message"] == _invalid(artifact_id)
        assert note.read_bytes() == b"session"
        assert not (session_dir / "note.txt.removed").exists()
        assert (directory / "peek.txt").is_symlink()
        assert not (directory / "peek.txt.removed").exists()


class TestAnIdThatHasNoRealLocation:
    """A NUL byte or a link loop is an invalid id, never a missing file or a server error."""

    @pytest.mark.parametrize("route", _ROUTES)
    def test_a_nul_byte_is_invalid(self, client: TestClient, route: str) -> None:
        dir_name, _execution_id, _directory = make_execution_dir()
        artifact_id = f"{dir_name}/a\0b.txt"

        response = _ask(client, route, artifact_id)

        assert response.status_code == 400
        assert response.json()["error"]["message"] == _invalid(artifact_id)

    @pytest.mark.parametrize("route", _ROUTES)
    @pytest.mark.parametrize("tail", ["a", "a/x.txt"])
    def test_two_links_that_point_at_each_other_are_invalid(
        self, client: TestClient, route: str, tail: str
    ) -> None:
        dir_name, _execution_id, directory = make_execution_dir()
        (directory / "a").symlink_to(directory / "b")
        (directory / "b").symlink_to(directory / "a")
        artifact_id = f"{dir_name}/{tail}"

        response = _ask(client, route, artifact_id)

        assert response.status_code == 400
        assert response.json()["error"]["message"] == _invalid(artifact_id)


class TestLinksInAnExecutionFolder:
    """A link reaches nothing outside the execution folders; one that stays below one is usable."""

    @pytest.mark.parametrize("route", _ROUTES)
    @pytest.mark.parametrize("target", ["stray.txt", "{other}"])
    def test_a_link_to_a_place_outside_every_execution_folder_is_invalid(
        self, client: TestClient, route: str, target: str
    ) -> None:
        dir_name, _execution_id, directory = make_execution_dir()
        other_name, _other_id, other = make_execution_dir()
        write_artifact_file(other, "data.txt", b"other")
        root = get_artifacts_storage_path()
        stray = write_artifact_file(root, "stray.txt", b"stray")
        link = directory / "up"
        link.symlink_to(root / target.format(other=other_name))
        artifact_id = f"{dir_name}/up"

        response = _ask(client, route, artifact_id)

        assert response.status_code == 400
        assert response.json()["error"]["message"] == _invalid(artifact_id)
        assert link.is_symlink()
        assert not (directory / "up.removed").exists()
        assert stray.read_bytes() == b"stray"
        assert (other / "data.txt").read_bytes() == b"other"

    @pytest.mark.parametrize("route", _ROUTES)
    def test_a_file_link_out_of_the_root_is_invalid(
        self, client: TestClient, route: str, outside: Path
    ) -> None:
        dir_name, _execution_id, directory = make_execution_dir()
        link = directory / "out.txt"
        link.symlink_to(outside / "secret.txt")
        artifact_id = f"{dir_name}/out.txt"

        response = _ask(client, route, artifact_id)

        assert response.status_code == 400
        assert response.json()["error"]["message"] == _invalid(artifact_id)
        assert link.is_symlink()
        assert (outside / "secret.txt").read_bytes() == b"secret"
        assert sorted(entry.name for entry in outside.iterdir()) == ["secret.txt"]

    @pytest.mark.parametrize("route", _ROUTES)
    @pytest.mark.parametrize("name", ["secret.txt", "back.txt"])
    def test_a_path_through_a_folder_link_out_of_the_root_is_invalid(
        self, client: TestClient, route: str, name: str, outside: Path
    ) -> None:
        dir_name, _execution_id, directory = make_execution_dir()
        real = write_artifact_file(directory, "real.txt", b"real")
        (outside / "back.txt").symlink_to(real)
        (directory / "outdir").symlink_to(outside, target_is_directory=True)
        artifact_id = f"{dir_name}/outdir/{name}"

        response = _ask(client, route, artifact_id)

        assert response.status_code == 400
        assert response.json()["error"]["message"] == _invalid(artifact_id)
        assert real.read_bytes() == b"real"
        assert sorted(entry.name for entry in outside.iterdir()) == ["back.txt", "secret.txt"]

    def test_a_file_link_inside_is_read_under_its_own_name(self, client: TestClient) -> None:
        dir_name, _execution_id, directory = make_execution_dir()
        write_artifact_file(directory, "real.txt", b"0123456789")
        (directory / "alias.txt").symlink_to(directory / "real.txt")

        meta = _ask(client, "meta", f"{dir_name}/alias.txt").json()
        content = _ask(client, "content", f"{dir_name}/alias.txt")

        assert (meta["id"], meta["path"], meta["size_bytes"]) == (
            f"{dir_name}/alias.txt",
            "alias.txt",
            10,
        )
        assert content.content == b"0123456789"
        assert content.headers["content-disposition"] == 'attachment; filename="alias.txt"'

    def test_a_delete_of_a_file_link_inside_removes_the_link_only(self, client: TestClient) -> None:
        dir_name, _execution_id, directory = make_execution_dir()
        real = write_artifact_file(directory, "real.txt", b"0123456789")
        link = directory / "alias.txt"
        link.symlink_to(real)

        response = _ask(client, "delete", f"{dir_name}/alias.txt")

        assert response.status_code == 204
        assert not link.is_symlink()
        assert real.read_bytes() == b"0123456789"
        record = json.loads((directory / "alias.txt.removed").read_text())
        assert (record["name"], record["path"], record["size_bytes"]) == (
            "alias.txt",
            "alias.txt",
            10,
        )

    def test_a_folder_link_inside_names_the_artifact_where_it_is(self, client: TestClient) -> None:
        dir_name, _execution_id, directory = make_execution_dir()
        write_artifact_file(directory, "logs/a.log", b"line\n")
        (directory / "current").symlink_to(directory / "logs", target_is_directory=True)

        response = _ask(client, "meta", f"{dir_name}/current/a.log")

        assert response.status_code == 200
        assert response.json()["id"] == f"{dir_name}/logs/a.log"
        assert response.json()["path"] == "logs/a.log"


class _LinkedExecution(NamedTuple):
    execution_id: str
    link: Path
    target: Path
    listed: list[str]


class TestAnExecutionFolderThatIsALink:
    """A link in the artifact root is no execution folder, wherever it leads."""

    @pytest.fixture(params=["outside", "execution", "sessions"])
    def linked(self, request: pytest.FixtureRequest, outside: Path) -> _LinkedExecution:
        """An execution whose folder is a link, the folder it leads to, and the ids listed."""
        real_name, _real_id, real_dir = make_execution_dir()
        root = get_artifacts_storage_path()
        targets = {
            "outside": outside,
            "execution": real_dir,
            "sessions": root / "sessions" / str(uuid.uuid4()),
        }
        target = targets[request.param]
        write_artifact_file(target, "secret.txt", b"secret")
        execution_id = str(uuid.uuid4())
        dir_name = f"20260609-120000-{execution_id}"
        link = root / dir_name
        link.symlink_to(target, target_is_directory=True)
        seed_execution_record(execution_id, "passed", dir_name)
        listed = [f"{real_name}/secret.txt"] if target == real_dir else []
        return _LinkedExecution(execution_id, link, target, listed)

    @staticmethod
    def _assert_target_untouched(linked: _LinkedExecution) -> None:
        assert linked.link.is_symlink()
        assert (linked.target / "secret.txt").read_bytes() == b"secret"
        assert sorted(entry.name for entry in linked.target.iterdir()) == ["secret.txt"]

    def test_the_listings_leave_it_out(self, client: TestClient, linked: _LinkedExecution) -> None:
        everything = client.get("/artifacts").json()["data"]
        own = client.get("/artifacts", params={"execution_id": linked.execution_id}).json()
        summaries = client.get("/artifacts/executions").json()["data"]

        assert [item["id"] for item in everything] == linked.listed
        assert own["data"] == []
        assert linked.execution_id not in {row["execution_id"] for row in summaries}

    @pytest.mark.parametrize("params", [{}, {"path": "."}])
    def test_a_zip_finds_no_artifacts(
        self, client: TestClient, linked: _LinkedExecution, params: dict[str, str]
    ) -> None:
        response = client.get(
            "/artifacts/zip", params={"execution_id": linked.execution_id, **params}
        )

        assert response.status_code == 404
        assert (
            response.json()["error"]["message"]
            == f"No artifacts found for execution {linked.execution_id}"
        )
        self._assert_target_untouched(linked)

    def test_a_delete_of_all_its_artifacts_finds_none(
        self, client: TestClient, linked: _LinkedExecution
    ) -> None:
        response = client.delete(f"/artifacts/executions/{linked.execution_id}")

        assert response.status_code == 404
        assert (
            response.json()["error"]["message"]
            == f"No artifacts found for execution {linked.execution_id}"
        )
        self._assert_target_untouched(linked)

    def test_a_purge_leaves_the_folder_it_leads_to(self, linked: _LinkedExecution) -> None:
        artifact_service.purge_execution_artifact_dir(linked.execution_id)

        self._assert_target_untouched(linked)


class TestAnArtifactRootUnderALink:
    """An artifact root reached through a link answers the ids the listing shows."""

    @pytest.fixture
    def directory(self, tmp_path: Path) -> tuple[str, str, Path]:
        real_root = tmp_path / "real-artifacts"
        real_root.mkdir()
        get_artifacts_storage_path().symlink_to(real_root, target_is_directory=True)
        dir_name, execution_id, directory = make_execution_dir()
        seed_execution_record(execution_id, "passed", dir_name)
        write_artifact_file(directory, "logs/a.log", b"line\n")
        return dir_name, execution_id, directory

    def test_meta_and_content_answer_as_under_a_plain_root(
        self, client: TestClient, directory: tuple[str, str, Path]
    ) -> None:
        dir_name, execution_id, _directory = directory

        meta = _ask(client, "meta", f"{dir_name}/logs/a.log").json()
        content = _ask(client, "content", f"{dir_name}/logs/a.log")

        assert (meta["id"], meta["execution_id"], meta["path"]) == (
            f"{dir_name}/logs/a.log",
            execution_id,
            "logs/a.log",
        )
        assert content.content == b"line\n"

    def test_a_delete_records_the_path_inside_the_execution(
        self, client: TestClient, directory: tuple[str, str, Path]
    ) -> None:
        dir_name, _execution_id, folder = directory

        response = _ask(client, "delete", f"{dir_name}/logs/a.log")

        assert response.status_code == 204
        assert json.loads((folder / "logs/a.log.removed").read_text())["path"] == "logs/a.log"
