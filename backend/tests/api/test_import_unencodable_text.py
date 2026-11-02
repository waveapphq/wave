"""A file holding text UTF-8 cannot write is refused at every import (REQ-4.6.9).

One character that cannot be written, anywhere in an imported YAML or JSON file,
refuses the file the way that import refuses a file it cannot parse, and nothing
from the file is stored. One character written as two escapes is that character.
"""

import io
import json
import zipfile
from collections.abc import Callable, Generator
from dataclasses import dataclass
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient

from wavecore.api.services import variable_service

LONE = "cafe\udce9"
_PLACEHOLDER = "EMOJI-GOES-HERE"
_TWO_ESCAPES = rb"\uD83D\uDE00"

Stored = Callable[[TestClient], list[str]]


def _refused(where: str) -> str:
    return (
        f"The file has a character at {where} that cannot be encoded as UTF-8, "
        "so it was not imported: remove or replace it"
    )


def _descriptions(route: str) -> Stored:
    return lambda client: [item["description"] for item in client.get(route).json()["data"]]


def _tags(route: str) -> Stored:
    return lambda client: [tag for item in client.get(route).json()["data"] for tag in item["tags"]]


def _variable_values(client: TestClient) -> list[str]:
    variables = client.get("/variables/system").json()["data"]["variables"]
    return [variable["value"] for variable in variables.values()]


@dataclass(frozen=True)
class Import:
    """One import: its routes, its parse-error code, and a document with one free text."""

    route: str
    validate: str | None
    code: str
    where: str
    document: Callable[[str], dict[str, Any]]
    stored: Stored


IMPORTS: dict[str, Import] = {
    "tests": Import(
        "/tests/import",
        "/tests/import/validate",
        "PARSE_ERROR",
        "description",
        lambda text: {
            "name": "Imported",
            "description": text,
            "workflow": {"nodes": [], "edges": []},
        },
        _descriptions("/tests"),
    ),
    "suites": Import(
        "/suites/import",
        "/suites/import/validate",
        "VALIDATION_ERROR",
        "description",
        lambda text: {"name": "Imported", "description": text, "tests": []},
        _descriptions("/suites"),
    ),
    "regressions": Import(
        "/regressions/import",
        "/regressions/import/validate",
        "VALIDATION_ERROR",
        "description",
        lambda text: {"name": "Imported", "description": text, "suites": []},
        _descriptions("/regressions"),
    ),
    "profiles": Import(
        "/profiles/import",
        "/profiles/import/validate",
        "VALIDATION_ERROR",
        "tags[0]",
        lambda text: {"name": "Imported", "type": "ssh", "tags": [text], "config": {}},
        _tags("/profiles"),
    ),
    "environments": Import(
        "/environments/import",
        "/environments/import/validate",
        "VALIDATION_ERROR",
        "tags[0]",
        lambda text: {"name": "Imported", "tags": [text]},
        _tags("/environments"),
    ),
    "variables": Import(
        "/variables/system/import",
        "/variables/system/import/validate",
        "VALIDATION_ERROR",
        "variables.imported.value",
        lambda text: {"variables": {"imported": {"type": "string", "value": text}}},
        _variable_values,
    ),
    "functions": Import(
        "/functions/import",
        "/functions/import/validate",
        "VALIDATION_ERROR",
        "description",
        lambda text: {
            "name": "Imported",
            "description": text,
            "tags": [],
            "inputs": [],
            "outputs": [],
            "dependencies": {"functions": [], "plugins": []},
            "workflow": {"nodes": [], "edges": []},
        },
        _descriptions("/functions"),
    ),
    "blocks": Import(
        "/blocks/import",
        None,
        "VALIDATION_ERROR",
        "description",
        lambda text: {"name": "Imported", "description": text, "parameters": {}},
        _descriptions("/blocks"),
    ),
}
ENTITIES = sorted(IMPORTS)
WITH_A_DRY_RUN = [entity for entity in ENTITIES if IMPORTS[entity].validate is not None]
FORMATS = ["yaml", "json"]


def _file(document: Any, fmt: str) -> bytes:
    """The document as a YAML or JSON file with every text in double quotes."""
    if fmt == "json":
        return json.dumps(document).encode()
    return yaml.safe_dump(document, default_style='"').encode()


def _upload(content: bytes, name: str) -> dict[str, tuple[str, bytes, str]]:
    return {"file": (name, content, "application/octet-stream")}


def _archive(members: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, content in members.items():
            archive.writestr(name, content)
    return buffer.getvalue()


@pytest.fixture(autouse=True)
def fresh_system_variables() -> Generator[None, None, None]:
    variable_service._variable_storage.clear()
    variable_service._system_cache_loaded = False
    yield
    variable_service._variable_storage.clear()
    variable_service._system_cache_loaded = False


@pytest.fixture
def client() -> TestClient:
    from wavecore.api.app import app

    return TestClient(app)


@pytest.mark.parametrize("fmt", FORMATS)
class TestEveryImport:
    """The eight imports, each with a YAML file and with a JSON file."""

    @pytest.mark.parametrize("entity", ENTITIES)
    def test_a_file_with_a_lone_surrogate_is_refused_and_nothing_is_stored(
        self, client: TestClient, entity: str, fmt: str
    ) -> None:
        target = IMPORTS[entity]
        content = _file(target.document(LONE), fmt)
        assert rb"cafe\udce9" in content.lower()

        response = client.post(target.route, files=_upload(content, f"import.{fmt}"))

        assert response.status_code == 400
        error = response.json()["error"]
        assert (error["code"], error["message"]) == (target.code, _refused(target.where))
        assert target.stored(client) == []

    @pytest.mark.parametrize("entity", WITH_A_DRY_RUN)
    def test_the_dry_run_refuses_the_same_file(
        self, client: TestClient, entity: str, fmt: str
    ) -> None:
        target = IMPORTS[entity]
        content = _file(target.document(LONE), fmt)

        response = client.post(str(target.validate), files=_upload(content, f"import.{fmt}"))

        assert response.status_code == 400
        error = response.json()["error"]
        assert (error["code"], error["message"]) == (target.code, _refused(target.where))
        assert target.stored(client) == []

    @pytest.mark.parametrize("entity", ENTITIES)
    def test_a_character_written_as_two_escapes_is_imported_as_that_character(
        self, client: TestClient, entity: str, fmt: str
    ) -> None:
        target = IMPORTS[entity]
        written = _file(target.document(f"ok {_PLACEHOLDER}"), fmt)
        content = written.replace(_PLACEHOLDER.encode(), _TWO_ESCAPES)
        assert content != written

        response = client.post(target.route, files=_upload(content, f"import.{fmt}"))

        assert response.status_code in (200, 201), response.text
        assert target.stored(client) == ["ok 😀"]


class TestWhereTheMessagePoints:
    """The path forms, seen through the Suite import."""

    @staticmethod
    def _message(client: TestClient, content: bytes, name: str = "import.yaml") -> str:
        response = client.post("/suites/import", files=_upload(content, name))
        assert response.status_code == 400, response.text
        return str(response.json()["error"]["message"])

    def test_a_file_that_is_the_text_itself(self, client: TestClient) -> None:
        assert self._message(client, rb'"cafe\uDCE9"') == _refused("the file")

    def test_a_broken_key(self, client: TestClient) -> None:
        content = rb'{"name": "Imported", "metadata": {"ab\udce9c": 1}, "tests": []}'

        assert self._message(client, content, "import.json") == _refused("metadata.ab?c")

    def test_an_eight_digit_escape(self, client: TestClient) -> None:
        content = b'name: Imported\ndescription: "cafe\\U0000DCE9"\ntests: []\n'

        assert self._message(client, content) == _refused("description")

    def test_a_file_in_another_encoding(self, client: TestClient) -> None:
        content = 'name: Imported\ndescription: "cafe\\uDCE9"\ntests: []\n'.encode("utf-16")

        assert self._message(client, content) == _refused("description")

    def test_the_same_characters_outside_double_quotes_are_plain_text(
        self, client: TestClient
    ) -> None:
        content = b"name: Imported\ndescription: C:\\uDCE9 kept\ntests: []\n"

        response = client.post("/suites/import", files=_upload(content, "import.yaml"))

        assert response.status_code == 200, response.text
        assert _descriptions("/suites")(client) == [r"C:\uDCE9 kept"]


class TestAnArchive:
    """One member that cannot be written refuses the whole archive."""

    @pytest.mark.parametrize("entity", ["tests", "suites", "functions"])
    def test_nothing_from_the_archive_is_stored(self, client: TestClient, entity: str) -> None:
        target = IMPORTS[entity]
        clean = {**target.document("clean"), "name": "Clean one"}
        content = _archive(
            {
                "clean.yaml": _file(clean, "yaml"),
                "broken.yaml": _file(target.document(LONE), "yaml"),
            }
        )

        response = client.post(target.route, files=_upload(content, "import.zip"))

        assert response.status_code == 400
        assert response.json()["error"]["message"] == _refused(target.where)
        assert target.stored(client) == []


class TestTheFunctionImportAnswer:
    """The Function import repeats its message in the error details, as for a parse error."""

    @pytest.mark.parametrize("route", ["/functions/import", "/functions/import/validate"])
    def test_the_details_carry_the_message(self, client: TestClient, route: str) -> None:
        content = _file(IMPORTS["functions"].document(LONE), "yaml")

        response = client.post(route, files=_upload(content, "import.yaml"))

        message = _refused("description")
        assert response.json()["error"]["details"] == {"errors": [{"message": message}]}
