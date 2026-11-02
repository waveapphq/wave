"""Route-level tests for the test-independent add-version endpoint (REQ-3.1.2.2).

    POST /functions/{function_id}/versions

This is the in-memory edit-mode publish path: it writes a new immutable library
version straight from a client-supplied ``draft_definition`` with NO owning Test
and NO node to compare against (the test-coupled ``source_version != draft
upstream`` check is dropped). Contract:

    201 on success -> {success: true, data: {function_id, version}}
    422 Draft definition is malformed (draft_definition not a dict)
    422 Draft definition is malformed (source_version not a string)
    422 Changelog is required for edit-mode publish
    422 Function version '<target>' is not a valid semver (X.Y.Z)
    404 Function '<id>' version '<source>' not found  (source missing)
    409 Target version '<target>' already exists in the library
    422 Target version '<target>' is not a valid bump from '<source>' (disallowed change: ...)

All error messages are asserted with anchored regex.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Generator
from typing import Any

import pytest
from fastapi.testclient import TestClient

# ---------------------------------------------------------------------------
# Anchored regex helpers (exact error strings)
# ---------------------------------------------------------------------------

MALFORMED_DRAFT_RE = re.compile(
    r"^Draft definition is malformed: draft_definition is required and must be a dict$"
)
MALFORMED_SOURCE_RE = re.compile(
    r"^Draft definition is malformed: source_version is required and must be a string$"
)
CHANGELOG_REQUIRED_RE = re.compile(r"^Changelog is required for edit-mode publish$")
INVALID_SEMVER_RE = re.compile(r"^Function version '[^']+' is not a valid semver$")
VERSION_NOT_FOUND_RE = re.compile(r"^Function '[^']+' version '[^']+' not found$")
DUPLICATE_TARGET_RE = re.compile(r"^Target version '[^']+' already exists in the library$")
INVALID_BUMP_RE = re.compile(
    r"^Target version '[^']+' is not a valid bump from '[^']+' \(disallowed change: .+\)$"
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _register_core_plugins_and_controls() -> Generator[None, None, None]:
    try:
        from wavecore.controls.registry import _registry, register_all_core_controls
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.log import LogPlugin
    except (ImportError, ModuleNotFoundError):
        yield
        return

    _registry.clear()
    register_all_core_controls(_registry)
    clear_registry()
    register_plugin(LogPlugin())
    yield
    _registry.clear()
    clear_registry()


@pytest.fixture
def client() -> TestClient:
    from wavecore.api.app import app

    return TestClient(app)


def _all_error_messages(body: dict) -> list[str]:
    err = body.get("error") or {}
    messages: list[str] = []
    if err.get("message"):
        messages.append(err["message"])
    details = err.get("details") or []
    if isinstance(details, list):
        for item in details:
            if isinstance(item, str):
                messages.append(item)
            elif isinstance(item, dict) and "message" in item:
                messages.append(item["message"])
    return messages


# ---------------------------------------------------------------------------
# Seeding helpers
# ---------------------------------------------------------------------------


def _source_body(**overrides: Any) -> dict[str, Any]:
    """The body fields a source version is seeded with (no name; name is a
    separate `save_new_version` argument that round-trips through storage)."""
    return {
        "inputs": overrides.pop("inputs", [{"name": "x", "type": "string", "required": True}]),
        "outputs": overrides.pop("outputs", [{"name": "result", "type": "string"}]),
        "dependencies": overrides.pop("dependencies", {"functions": [], "plugins": []}),
        "workflow": overrides.pop("workflow", {"nodes": [], "edges": []}),
    }


def _source_metadata(**overrides: Any) -> dict[str, Any]:
    return {
        "description": overrides.pop("description", "say hello"),
        "tags": overrides.pop("tags", ["demo"]),
        "changelog": overrides.pop("changelog", "initial"),
        "details": overrides.pop("details", ""),
        "published_at": overrides.pop("published_at", "2026-01-01T00:00:00Z"),
        "published_by": overrides.pop("published_by", "wave"),
    }


def _seed_library_function(name: str = "greet", version: str = "1.0.0") -> str:
    from wavecore.api.services.functions._storage import save_new_version

    fn_id = str(uuid.uuid4())
    save_new_version(fn_id, version, _source_body(), _source_metadata(), name=name)
    return fn_id


def _draft_description_change(name: str = "greet") -> dict[str, Any]:
    """A draft whose only delta vs the source is the description -> PATCH allowed."""
    return {
        "name": name,
        "description": "new wording",
        "tags": ["demo"],
        "inputs": [{"name": "x", "type": "string", "required": True}],
        "outputs": [{"name": "result", "type": "string"}],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {"nodes": [], "edges": []},
    }


def _draft_added_required_input(name: str = "greet") -> dict[str, Any]:
    """A draft that adds a REQUIRED input -> only MAJOR is allowed."""
    return {
        "name": name,
        "description": "say hello",
        "tags": ["demo"],
        "inputs": [
            {"name": "x", "type": "string", "required": True},
            {"name": "y", "type": "integer", "required": True},
        ],
        "outputs": [{"name": "result", "type": "string"}],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {"nodes": [], "edges": []},
    }


def _add_version_body(**overrides: Any) -> dict[str, Any]:
    return {
        "source_version": overrides.pop("source_version", "1.0.0"),
        "target_version": overrides.pop("target_version", "1.0.1"),
        "draft_definition": overrides.pop("draft_definition", _draft_description_change()),
        "changelog": overrides.pop("changelog", "Description update"),
        "description": overrides.pop("description", "new wording"),
        "tags": overrides.pop("tags", ["demo"]),
        "details": overrides.pop("details", ""),
        **overrides,
    }


# ===========================================================================
# 201 - happy path
# ===========================================================================


class TestAddVersionHappyPath:
    """A valid add-version writes a new immutable library version, no Test involved."""

    def test_patch_bump_returns_201_with_function_id_and_version(self, client: TestClient) -> None:
        fn_id = _seed_library_function()
        response = client.post(f"/functions/{fn_id}/versions", json=_add_version_body())
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["success"] is True
        data = body["data"]
        assert data["function_id"] == fn_id
        assert data["version"] == "1.0.1"

    def test_new_version_is_readable_via_get_versions(self, client: TestClient) -> None:
        fn_id = _seed_library_function()
        post = client.post(f"/functions/{fn_id}/versions", json=_add_version_body())
        assert post.status_code == 201, post.text

        listing = client.get(f"/functions/{fn_id}/versions")
        assert listing.status_code == 200, listing.text
        data = listing.json()["data"]
        assert data["latest"] == "1.0.1"
        assert "1.0.1" in [entry["version"] for entry in data["versions"]]

        version_get = client.get(f"/functions/{fn_id}/versions/1.0.1")
        assert version_get.status_code == 200, version_get.text

    def test_major_bump_when_only_major_allowed_returns_201(self, client: TestClient) -> None:
        fn_id = _seed_library_function()
        body = _add_version_body(
            target_version="2.0.0",
            draft_definition=_draft_added_required_input(),
            changelog="Added required input y",
            description="say hello",
        )
        response = client.post(f"/functions/{fn_id}/versions", json=body)
        assert response.status_code == 201, response.text
        assert response.json()["data"]["version"] == "2.0.0"


# ===========================================================================
# 422 - malformed draft (route-level, mirrors POST /validate-bumps)
# ===========================================================================


class TestAddVersionMalformedDraft:
    def test_non_dict_draft_definition_returns_422(self, client: TestClient) -> None:
        fn_id = _seed_library_function()
        body = _add_version_body(draft_definition="not-a-dict")
        response = client.post(f"/functions/{fn_id}/versions", json=body)
        assert response.status_code == 422, response.text
        messages = _all_error_messages(response.json())
        assert any(MALFORMED_DRAFT_RE.match(m) for m in messages), messages

    def test_missing_draft_definition_returns_422(self, client: TestClient) -> None:
        fn_id = _seed_library_function()
        body = _add_version_body()
        body.pop("draft_definition")
        response = client.post(f"/functions/{fn_id}/versions", json=body)
        assert response.status_code == 422, response.text
        messages = _all_error_messages(response.json())
        assert any(MALFORMED_DRAFT_RE.match(m) for m in messages), messages

    def test_non_string_source_version_returns_422(self, client: TestClient) -> None:
        fn_id = _seed_library_function()
        body = _add_version_body(source_version=123)
        response = client.post(f"/functions/{fn_id}/versions", json=body)
        assert response.status_code == 422, response.text
        messages = _all_error_messages(response.json())
        assert any(MALFORMED_SOURCE_RE.match(m) for m in messages), messages

    def test_empty_source_version_returns_422(self, client: TestClient) -> None:
        fn_id = _seed_library_function()
        body = _add_version_body(source_version="")
        response = client.post(f"/functions/{fn_id}/versions", json=body)
        assert response.status_code == 422, response.text
        messages = _all_error_messages(response.json())
        assert any(MALFORMED_SOURCE_RE.match(m) for m in messages), messages


# ===========================================================================
# 422 - changelog required
# ===========================================================================


class TestAddVersionChangelogRequired:
    def test_missing_changelog_returns_422(self, client: TestClient) -> None:
        fn_id = _seed_library_function()
        body = _add_version_body(changelog="")
        response = client.post(f"/functions/{fn_id}/versions", json=body)
        assert response.status_code == 422, response.text
        messages = _all_error_messages(response.json())
        assert any(CHANGELOG_REQUIRED_RE.match(m) for m in messages), messages

    def test_whitespace_changelog_returns_422(self, client: TestClient) -> None:
        fn_id = _seed_library_function()
        body = _add_version_body(changelog="   ")
        response = client.post(f"/functions/{fn_id}/versions", json=body)
        assert response.status_code == 422, response.text
        messages = _all_error_messages(response.json())
        assert any(CHANGELOG_REQUIRED_RE.match(m) for m in messages), messages


# ===========================================================================
# 422 - invalid target semver
# ===========================================================================


class TestAddVersionInvalidSemver:
    def test_non_semver_target_returns_422(self, client: TestClient) -> None:
        fn_id = _seed_library_function()
        body = _add_version_body(target_version="not-a-semver")
        response = client.post(f"/functions/{fn_id}/versions", json=body)
        assert response.status_code == 422, response.text
        messages = _all_error_messages(response.json())
        assert any(INVALID_SEMVER_RE.match(m) for m in messages), messages
        assert any(
            m == "Function version 'not-a-semver' is not a valid semver" for m in messages
        ), messages


# ===========================================================================
# 404 - source version missing
# ===========================================================================


class TestAddVersionSourceMissing:
    def test_unknown_source_version_returns_404(self, client: TestClient) -> None:
        fn_id = _seed_library_function(version="1.0.0")
        body = _add_version_body(source_version="9.9.9", target_version="9.9.10")
        response = client.post(f"/functions/{fn_id}/versions", json=body)
        assert response.status_code == 404, response.text
        messages = _all_error_messages(response.json())
        expected = f"Function '{fn_id}' version '9.9.9' not found"
        assert any(m == expected for m in messages), messages
        assert any(VERSION_NOT_FOUND_RE.match(m) for m in messages)


# ===========================================================================
# 409 - duplicate target
# ===========================================================================


class TestAddVersionDuplicateTarget:
    def test_existing_target_returns_409(self, client: TestClient) -> None:
        from wavecore.api.services.functions._storage import save_new_version

        fn_id = _seed_library_function()
        save_new_version(fn_id, "1.0.1", _source_body(), _source_metadata(), name="greet")
        body = _add_version_body(target_version="1.0.1")
        response = client.post(f"/functions/{fn_id}/versions", json=body)
        assert response.status_code == 409, response.text
        messages = _all_error_messages(response.json())
        expected = "Target version '1.0.1' already exists in the library"
        assert any(m == expected for m in messages), messages
        assert any(DUPLICATE_TARGET_RE.match(m) for m in messages)


# ===========================================================================
# 422 - disallowed bump
# ===========================================================================


class TestAddVersionDisallowedBump:
    def test_patch_target_with_added_required_input_returns_422(self, client: TestClient) -> None:
        fn_id = _seed_library_function()
        body = _add_version_body(
            target_version="1.0.1",
            draft_definition=_draft_added_required_input(),
            changelog="Trying to sneak a required input into a patch",
        )
        response = client.post(f"/functions/{fn_id}/versions", json=body)
        assert response.status_code == 422, response.text
        messages = _all_error_messages(response.json())
        assert any(INVALID_BUMP_RE.match(m) for m in messages), messages


# ===========================================================================
# 422 - missing reference (REQ-3.1.2.4)
# ===========================================================================


class TestAddVersionReferenceChecks:
    def test_a_version_with_a_missing_reference_returns_422_with_the_findings(
        self, client: TestClient
    ) -> None:
        from wavecore.api.services.functions._storage import save_new_version

        fn_id = str(uuid.uuid4())
        save_new_version(
            fn_id, "1.0.0", _source_body(inputs=[], outputs=[]), _source_metadata(), name="greet"
        )
        unknown_id = str(uuid.uuid4())
        draft = _draft_description_change()
        draft["inputs"] = []
        draft["outputs"] = []
        draft["workflow"] = {
            "nodes": [
                {
                    "id": "call-1",
                    "type": "workflowNode",
                    "data": {
                        "label": "Call_1",
                        "elementType": "function",
                        "nodeType": "function",
                        "functionLifecycle": "shared",
                        "functionId": unknown_id,
                        "functionVersion": "1.0.0",
                        "config": {"values": {}, "outputBindings": {}, "profileBindings": []},
                    },
                }
            ],
            "edges": [{"source": "start-node", "target": "call-1"}],
        }

        response = client.post(
            f"/functions/{fn_id}/versions", json=_add_version_body(draft_definition=draft)
        )

        assert response.status_code == 422, response.text
        body = response.json()
        assert body["success"] is False
        error = body["error"]
        assert error["code"] == "VALIDATION_ERROR"
        assert re.fullmatch(r"^Function has 1 validation error\(s\)$", error["message"])
        details = error["details"]
        assert [finding["code"] for finding in details] == ["MISSING_FUNCTION_ID"]
        assert re.fullmatch(
            rf"^References unknown Function '{re.escape(unknown_id)}'$", details[0]["message"]
        ), details[0]["message"]


# ===========================================================================
# 422 - malformed declarations (REQ-3.1.2.4, REQ-3.1.2.10, REQ-3.1.2.11)
# ===========================================================================


def _level(**fields: Any) -> dict[str, Any]:
    """A well-formed String enum input ``level`` with ``fields`` laid over it."""
    level: dict[str, Any] = {
        "name": "level",
        "type": "string",
        "required": True,
        "enumValues": ["low", "high"],
        "default": "low",
        **fields,
    }
    return level


def _draft_declaring(**declarations: Any) -> dict[str, Any]:
    """A draft whose inputs, outputs and locals are ``declarations`` (MAJOR allows any change)."""
    draft = _draft_description_change()
    draft.update(inputs=[], outputs=[], variables=[])
    draft.update(declarations)
    return draft


_OLD_ARRAY_ENUM = {
    "name": "level",
    "type": "array",
    "required": True,
    "enumValueType": "string",
    "enumValues": ["low", "high"],
}
_LOCAL_ID = {"name": "id", "type": "string", "value": "x"}

_MALFORMED_DECLARATIONS = [
    pytest.param(
        {"inputs": [_OLD_ARRAY_ENUM]},
        ("ENUM_INPUT_TYPE", "Enum input 'level' must be of type string, integer or float"),
        id="old-array-enum",
    ),
    pytest.param(
        {"inputs": [_level(required=False)]},
        ("ENUM_INPUT_NOT_REQUIRED", "Enum input 'level' must be required"),
        id="enum-not-required",
    ),
    pytest.param(
        {"inputs": [_level(enumValues=[])]},
        ("ENUM_INPUT_EMPTY", "Enum input 'level' has no allowed values"),
        id="enum-empty",
    ),
    pytest.param(
        {"inputs": [_level(secret=True)]},
        ("SECRET_ENUM_INPUT", "Input 'level' cannot be both secret and an enum"),
        id="secret-enum",
    ),
    pytest.param(
        {"inputs": [_level(type="integer", enumValues=[1, "abc"], default=1)]},
        ("ENUM_VALUE_TYPE", "Allowed value 'abc' of enum input 'level' is not a valid integer"),
        id="enum-value-type",
    ),
    pytest.param(
        {"inputs": [{key: value for key, value in _level().items() if key != "default"}]},
        ("ENUM_INPUT_NO_DEFAULT", "Enum input 'level' needs a default from its allowed values"),
        id="enum-no-default",
    ),
    pytest.param(
        {"inputs": [_level(default="x")]},
        (
            "ENUM_DEFAULT_NOT_ALLOWED",
            "Default 'x' of enum input 'level' is not one of its allowed values",
        ),
        id="enum-default-not-allowed",
    ),
    pytest.param(
        {"inputs": [{"name": "flag", "type": "boolean", "required": True}]},
        ("BOOLEAN_INPUT_NO_DEFAULT", "Boolean input 'flag' needs a default"),
        id="required-boolean-no-default",
    ),
    pytest.param(
        {"inputs": [{"name": "flag", "type": "boolean", "required": False}]},
        ("BOOLEAN_INPUT_NO_DEFAULT", "Boolean input 'flag' needs a default"),
        id="optional-boolean-no-default",
    ),
    pytest.param(
        {
            "inputs": [{"name": "id", "type": "string", "required": False}],
            "outputs": [{"name": "id", "type": "string"}],
        },
        ("DUPLICATE_PARAMETER_NAME", "Function declares 'id' as both an input and an output"),
        id="input-and-output",
    ),
    pytest.param(
        {"inputs": [{"name": "id", "type": "string", "required": False}], "variables": [_LOCAL_ID]},
        (
            "DUPLICATE_PARAMETER_NAME",
            "Function declares 'id' as both an input and a local variable",
        ),
        id="input-and-local",
    ),
    pytest.param(
        {"outputs": [{"name": "id", "type": "string"}], "variables": [_LOCAL_ID]},
        (
            "DUPLICATE_PARAMETER_NAME",
            "Function declares 'id' as both an output and a local variable",
        ),
        id="output-and-local",
    ),
    pytest.param(
        {"variables": [_LOCAL_ID, _LOCAL_ID]},
        ("DUPLICATE_VARIABLE_NAME", "Function declares local variable 'id' more than once"),
        id="local-twice",
    ),
]


class TestAddVersionDeclarationRules:
    """Edit-mode publish refuses a malformed declaration as every other save does."""

    @pytest.mark.parametrize(("declarations", "expected"), _MALFORMED_DECLARATIONS)
    def test_a_malformed_declaration_returns_422_and_publishes_nothing(
        self, client: TestClient, declarations: dict[str, Any], expected: tuple[str, str]
    ) -> None:
        fn_id = _seed_library_function()
        body = _add_version_body(
            target_version="2.0.0", draft_definition=_draft_declaring(**declarations)
        )

        response = client.post(f"/functions/{fn_id}/versions", json=body)

        assert response.status_code == 422, response.text
        error = response.json()["error"]
        assert error["code"] == "VALIDATION_ERROR"
        found = [d for d in error["details"] if (d.get("code"), d.get("message")) == expected]
        assert len(found) == 1, error["details"]
        assert found[0]["severity"] == "error"
        assert client.get(f"/functions/{fn_id}/versions").json()["data"]["latest"] == "1.0.0"

    def test_well_formed_declarations_publish(self, client: TestClient) -> None:
        fn_id = _seed_library_function()
        draft = _draft_declaring(
            inputs=[
                _level(description="How loud"),
                {"name": "count", "type": "integer", "required": True, "default": 3},
                {"name": "flag", "type": "boolean", "required": True, "default": False},
                {"name": "verbose", "type": "boolean", "required": False, "default": True},
                {"name": "tok", "type": "boolean", "required": True, "secret": True},
                {"name": "pin", "type": "boolean", "required": False, "secret": True},
            ],
            outputs=[{"name": "result", "type": "string"}],
            variables=[{"name": "step", "type": "integer", "value": 1}],
        )

        response = client.post(
            f"/functions/{fn_id}/versions",
            json=_add_version_body(target_version="2.0.0", draft_definition=draft),
        )

        assert response.status_code == 201, response.text


class TestAddVersionStoresNumbersInWireForm:
    """REQ-3.1.3.14: a published version stores each typed number a client sends in wire form."""

    def test_declared_numbers_are_stored_in_wire_form(self, client: TestClient) -> None:
        from tests.api.wire_number_cases import BIG, TINY

        fn_id = _seed_library_function()
        draft = _draft_declaring(
            inputs=[
                {"name": "rate", "type": "float", "required": False, "default": TINY},
                _level(type="float", enumValues=[30.0, 2.5], default=30.0),
            ],
            outputs=[{"name": "total", "type": "integer", "default": BIG}],
            variables=[{"name": "count", "type": "integer", "value": 30}],
        )

        response = client.post(
            f"/functions/{fn_id}/versions",
            json=_add_version_body(target_version="2.0.0", draft_definition=draft),
        )
        assert response.status_code == 201, response.text
        stored = client.get(f"/functions/{fn_id}/versions/2.0.0").json()["data"]["definition"]

        assert [
            stored["inputs"][0]["default"],
            stored["inputs"][1]["enumValues"],
            stored["inputs"][1]["default"],
            stored["outputs"][0]["default"],
            stored["variables"][0]["value"],
        ] == ["0.0000001", ["30.0", 2.5], "30.0", "1234567890123456789", 30]


pytestmark = pytest.mark.usefixtures("temp_storage_path")
