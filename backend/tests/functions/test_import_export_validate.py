"""Tests for the Function import dry-run validate endpoint (REQ-3.1.2.5).

The dry-run mirrors the
Tests/Suites validate pattern but returns the canonical shared shape from
``frontend/src/types/import-export.ts`` so the shared import dialog consumes
it unchanged:

    ValidateImportResult = {
        items: [{name, status, fatal_errors, fixable_errors, warnings, existing_id}],
        total, importable, blocked
    }

- status is one of: "ok" | "conflict" | "fixable" | "fatal".
- The endpoint persists NOTHING (pure dry-run).
- Intra-archive dependency resolution: a dependency satisfied by another
  entry in the same archive is not reported as missing.

Anchored error string:
    ^Validation failed: <reason>$
"""

import io
import json
import re
import uuid
import zipfile
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient

from wavecore.api.services.functions import _storage
from wavecore.core.secrets.cipher import SecretCipher

from .conftest import make_function_payload


def _foreign_envelope(value: Any) -> str:
    """Seal a value under a key this instance does not hold (undecryptable here)."""
    return SecretCipher(bytes(range(1, 33))).seal(value)


VALIDATION_FAILED_RE = re.compile(r"^Validation failed: .+$")
MISSING_FUNCTION_TEXT = r'^Uses Function "{block}", which is not in the library or in this file$'
UNNAMED_FUNCTION_TEXT = r"^Uses a Function that is not in the library or in this file$"
MISSING_VERSION_TEXT = (
    r'^Uses Function "{name}" {version}, which is not in the library or in this file$'
)
CIRCULAR_TEXT = r"^Circular Function reference: {path}$"
INVALID_VERSION_TEXT = r"^Invalid version '{version}'; expected a valid semver$"

ITEM_KEYS = {"name", "status", "fatal_errors", "fixable_errors", "warnings", "existing_id"}


def _all_error_messages(body: dict) -> list[str]:
    err = body["error"]
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


def _export_doc(**overrides: Any) -> dict[str, Any]:
    """Build a Function definition document shaped like an export payload."""
    doc = make_function_payload(**overrides)
    doc.setdefault("id", str(uuid.uuid4()))
    doc.setdefault("version", "1.0.0")
    doc.setdefault(
        "metadata",
        {
            "author": "tester",
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
        },
    )
    return doc


def _yaml_bytes(doc: dict[str, Any]) -> bytes:
    return yaml.safe_dump(doc, sort_keys=False).encode()


def _zip_bytes(docs: dict[str, dict[str, Any]]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for filename, doc in docs.items():
            zf.writestr(filename, yaml.safe_dump(doc, sort_keys=False))
    buf.seek(0)
    return buf.read()


def _validate(client: TestClient, content: bytes, filename: str):
    return client.post(
        "/functions/import/validate",
        files={"file": (filename, io.BytesIO(content), "application/octet-stream")},
    )


def _find_item(result: dict[str, Any], name: str) -> dict[str, Any]:
    matches = [item for item in result["items"] if item["name"] == name]
    assert matches, f"no item named {name!r} in {[i['name'] for i in result['items']]}"
    return matches[0]


def _call_block(
    function_id: str, *, version: str = "1.0.0", label: str = "Call callee"
) -> dict[str, Any]:
    """A library Function block that calls ``function_id``."""
    return {
        "id": "node-call",
        "type": "workflowNode",
        "position": {"x": 0, "y": 0},
        "data": {
            "label": label,
            "elementType": "function",
            "nodeType": "function",
            "functionLifecycle": "shared",
            "functionId": function_id,
            "functionVersion": version,
            "config": {"values": {}, "outputBindings": {}, "profileBindings": []},
        },
    }


def _body(*blocks: dict[str, Any]) -> dict[str, Any]:
    return {"nodes": list(blocks), "edges": []}


def _version_record(version: str, workflow: dict[str, Any] | None = None) -> dict[str, Any]:
    """One entry of an export document's ``versions`` list."""
    return {
        "version": version,
        "definition": {
            "inputs": [],
            "outputs": [],
            "dependencies": {"functions": [], "plugins": []},
            "workflow": workflow or _body(),
        },
        "metadata": {
            "description": "",
            "tags": [],
            "changelog": "",
            "details": "",
            "published_at": "2026-01-01T00:00:00Z",
            "published_by": "wave",
        },
    }


def _seed_version(
    function_id: str, name: str, version: str, workflow: dict[str, Any] | None = None
) -> None:
    """Publish one version of a library Function without the publish checks."""
    record = _version_record(version, workflow)
    _storage.save_new_version(
        function_id, version, record["definition"], record["metadata"], name=name
    )


def _blocked_by(result: dict[str, Any], name: str) -> dict[str, str]:
    """The one fatal error of a blocked item."""
    item = _find_item(result, name)
    assert item["status"] == "fatal", item
    assert len(item["fatal_errors"]) == 1, item["fatal_errors"]
    return item["fatal_errors"][0]


# ---------------------------------------------------------------------------
# Result shape + counts
# ---------------------------------------------------------------------------


class TestValidateShape:
    def test_clean_single_is_ok(self, client: TestClient) -> None:
        doc = _export_doc(name="clean_one")
        response = _validate(client, _yaml_bytes(doc), "clean_one.yaml")
        assert response.status_code == 200, response.text
        result = response.json()["data"]
        assert result["total"] == 1
        assert result["importable"] == 1
        assert result["blocked"] == 0
        item = _find_item(result, "clean_one")
        assert item["status"] == "ok"
        assert item["existing_id"] is None

    def test_item_carries_canonical_keys(self, client: TestClient) -> None:
        doc = _export_doc(name="shape_check")
        response = _validate(client, _yaml_bytes(doc), "shape_check.yaml")
        result = response.json()["data"]
        item = _find_item(result, "shape_check")
        assert ITEM_KEYS <= set(item.keys())
        assert isinstance(item["fatal_errors"], list)
        assert isinstance(item["fixable_errors"], list)
        assert isinstance(item["warnings"], list)

    def test_zip_reports_every_entry(self, client: TestClient) -> None:
        content = _zip_bytes(
            {
                "a.yaml": _export_doc(name="multi_a"),
                "b.yaml": _export_doc(name="multi_b"),
            }
        )
        response = _validate(client, content, "functions.zip")
        assert response.status_code == 200, response.text
        result = response.json()["data"]
        assert result["total"] == 2
        names = {item["name"] for item in result["items"]}
        assert names == {"multi_a", "multi_b"}


# ---------------------------------------------------------------------------
# Foreign encrypted secrets
# ---------------------------------------------------------------------------


class TestValidateForeignSecrets:
    def test_foreign_envelope_variable_warns(self, client: TestClient) -> None:
        doc = _export_doc(
            name="foreign_secret_fn",
            variables=[
                {
                    "name": "api_key",
                    "type": "string",
                    "value": _foreign_envelope("x"),
                    "secret": True,
                }
            ],
        )
        response = _validate(client, _yaml_bytes(doc), "foreign_secret_fn.yaml")
        assert response.status_code == 200, response.text
        item = _find_item(response.json()["data"], "foreign_secret_fn")
        foreign = next(w for w in item["warnings"] if w["code"] == "FOREIGN_ENCRYPTED_SECRET")
        assert foreign["message"] == (
            "Secret 'api_key' is encrypted by another WAVE instance and "
            "cannot be decrypted here; re-enter it after import"
        )


# ---------------------------------------------------------------------------
# Conflict detection
# ---------------------------------------------------------------------------


class TestValidateConflict:
    def test_name_conflict_sets_status_and_existing_id(self, client: TestClient) -> None:
        created = client.post("/functions", json=make_function_payload(name="dup_name")).json()
        existing_id = created["data"]["id"]

        doc = _export_doc(name="dup_name")
        response = _validate(client, _yaml_bytes(doc), "dup_name.yaml")
        assert response.status_code == 200
        result = response.json()["data"]
        item = _find_item(result, "dup_name")
        assert item["status"] == "conflict"
        assert item["existing_id"] == existing_id
        # Conflicts are resolvable, so they are importable, not blocked.
        assert result["blocked"] == 0
        assert result["importable"] == 1


# ---------------------------------------------------------------------------
# Fatal structural errors
# ---------------------------------------------------------------------------


class TestValidateFatal:
    def test_overlong_name_is_fatal(self, client: TestClient) -> None:
        doc = _export_doc(name="X" * 33)
        response = _validate(client, _yaml_bytes(doc), "bad.yaml")
        assert response.status_code == 200
        result = response.json()["data"]
        item = result["items"][0]
        assert item["status"] == "fatal"
        assert item["fatal_errors"]
        assert result["blocked"] == 1
        assert result["importable"] == 0

    def test_invalid_semver_is_fatal(self, client: TestClient) -> None:
        doc = _export_doc(name="bad_ver")
        doc["version"] = "not-semver"
        response = _validate(client, _yaml_bytes(doc), "bad_ver.yaml")
        assert response.status_code == 200
        result = response.json()["data"]
        item = _find_item(result, "bad_ver")
        assert item["status"] == "fatal"
        assert item["fatal_errors"]

    def test_an_invalid_version_reads_the_existing_message(self, client: TestClient) -> None:
        doc = _export_doc(name="bad_ver")
        doc["version"] = "not-semver"
        response = _validate(client, _yaml_bytes(doc), "bad_ver.yaml")
        assert response.status_code == 200, response.text
        error = _blocked_by(response.json()["data"], "bad_ver")
        assert error["code"] == "INVALID_VERSION"
        assert re.fullmatch(
            INVALID_VERSION_TEXT.format(version=re.escape("not-semver")), error["message"]
        )

    @pytest.mark.parametrize(
        ("declarations", "code", "message"),
        [
            pytest.param(
                {
                    "inputs": [
                        {
                            "name": "level",
                            "type": "array",
                            "required": True,
                            "enumValueType": "string",
                            "enumValues": ["low", "high"],
                            "default": "low",
                        }
                    ]
                },
                "ENUM_INPUT_TYPE",
                "Enum input 'level' must be of type string, integer or float",
                id="old-array-enum",
            ),
            pytest.param(
                {
                    "inputs": [
                        {
                            "name": "level",
                            "type": "string",
                            "required": True,
                            "enumValues": ["low", "high"],
                        }
                    ]
                },
                "ENUM_INPUT_NO_DEFAULT",
                "Enum input 'level' needs a default from its allowed values",
                id="enum-no-default",
            ),
            pytest.param(
                {"inputs": [{"name": "flag", "type": "boolean", "required": True}]},
                "BOOLEAN_INPUT_NO_DEFAULT",
                "Boolean input 'flag' needs a default",
                id="required-boolean-no-default",
            ),
            pytest.param(
                {"inputs": [{"name": "flag", "type": "boolean", "required": False}]},
                "BOOLEAN_INPUT_NO_DEFAULT",
                "Boolean input 'flag' needs a default",
                id="optional-boolean-no-default",
            ),
            pytest.param(
                {
                    "inputs": [{"name": "id", "type": "string", "required": False}],
                    "variables": [{"name": "id", "type": "string", "value": "x"}],
                },
                "DUPLICATE_PARAMETER_NAME",
                "Function declares 'id' as both an input and a local variable",
                id="input-and-local",
            ),
        ],
    )
    def test_a_malformed_declaration_is_fatal_with_its_rule(
        self, client: TestClient, declarations: dict[str, Any], code: str, message: str
    ) -> None:
        # REQ-3.1.2.4, REQ-3.1.2.11: each declaration breaks one rule.
        doc = _export_doc(name="declares", **declarations)

        response = _validate(client, _yaml_bytes(doc), "declares.yaml")

        assert response.status_code == 200, response.text
        result = response.json()["data"]
        assert _blocked_by(result, "declares") == {"code": code, "message": message}
        assert result["blocked"] == 1


# ---------------------------------------------------------------------------
# Dry-run persists nothing
# ---------------------------------------------------------------------------


class TestValidatePersistsNothing:
    def test_validate_does_not_create_a_function(self, client: TestClient) -> None:
        doc = _export_doc(name="ephemeral_only")
        _validate(client, _yaml_bytes(doc), "ephemeral_only.yaml")
        listed = client.get("/functions?search=ephemeral_only").json()["data"]
        assert listed == []


# ---------------------------------------------------------------------------
# Intra-archive dependency resolution
# ---------------------------------------------------------------------------


class TestValidateIntraArchiveDeps:
    def test_dependency_satisfied_within_archive_is_not_missing(self, client: TestClient) -> None:
        """A's body calls B; both ride in the same ZIP and neither is published.

        The validator must resolve A's reference against the sibling archive
        entry, so A is importable rather than blocked on a missing Function.
        """
        b_id = str(uuid.uuid4())
        dep_b = _export_doc(name="dep_callee")
        dep_b["id"] = b_id
        caller_a = _export_doc(name="dep_caller", workflow=_body(_call_block(b_id)))
        content = _zip_bytes({"a.yaml": caller_a, "b.yaml": dep_b})
        response = _validate(client, content, "functions.zip")
        assert response.status_code == 200, response.text
        result = response.json()["data"]
        caller_item = _find_item(result, "dep_caller")
        assert caller_item["status"] == "ok"
        assert result["blocked"] == 0


# ---------------------------------------------------------------------------
# Parse failures
# ---------------------------------------------------------------------------


class TestValidateParseErrors:
    def test_unparsable_returns_400(self, client: TestClient) -> None:
        response = _validate(client, b"{this is :: garbage [", "garbage.yaml")
        assert response.status_code == 400
        assert any(VALIDATION_FAILED_RE.match(m) for m in _all_error_messages(response.json()))

    def test_unparsable_json_extension_returns_400(self, client: TestClient) -> None:
        response = _validate(client, b"{not valid json", "garbage.json")
        assert response.status_code == 400
        assert any(VALIDATION_FAILED_RE.match(m) for m in _all_error_messages(response.json()))


def test_validate_result_is_serializable(client: TestClient) -> None:
    """The full envelope round-trips through JSON unchanged (shared-dialog use)."""
    doc = _export_doc(name="serialize_me")
    response = _validate(client, _yaml_bytes(doc), "serialize_me.yaml")
    # Re-encoding must not raise; the dialog reads `data` verbatim.
    json.dumps(response.json()["data"])


class TestValidateMissingReference:
    def test_a_missing_function_blocks_the_entry(self, client: TestClient) -> None:
        doc = _export_doc(
            name="calls_ghost",
            workflow=_body(_call_block(str(uuid.uuid4()), label="Call ghost")),
        )
        response = _validate(client, _yaml_bytes(doc), "calls_ghost.yaml")
        assert response.status_code == 200, response.text
        result = response.json()["data"]
        error = _blocked_by(result, "calls_ghost")
        assert error["code"] == "MISSING_FUNCTION_ID"
        assert re.fullmatch(
            MISSING_FUNCTION_TEXT.format(block=re.escape("Call ghost")), error["message"]
        )
        assert _find_item(result, "calls_ghost")["warnings"] == []
        assert result["blocked"] == 1
        assert result["importable"] == 0

    def test_a_missing_function_with_no_name_on_the_canvas_reads_uses_a_function(
        self, client: TestClient
    ) -> None:
        call = _call_block(str(uuid.uuid4()), label="")
        del call["id"]
        doc = _export_doc(name="calls_ghost", workflow=_body(call))
        response = _validate(client, _yaml_bytes(doc), "calls_ghost.yaml")
        assert response.status_code == 200, response.text
        error = _blocked_by(response.json()["data"], "calls_ghost")
        assert error["code"] == "MISSING_FUNCTION_ID"
        assert re.fullmatch(UNNAMED_FUNCTION_TEXT, error["message"])

    @pytest.mark.parametrize("label", ["", "   "], ids=["empty", "blank"])
    def test_a_block_with_an_id_and_no_name_is_not_named_by_its_id(
        self, client: TestClient, label: str
    ) -> None:
        call = _call_block(str(uuid.uuid4()), label=label)
        assert call["id"] == "node-call"
        doc = _export_doc(name="calls_ghost", workflow=_body(call))
        response = _validate(client, _yaml_bytes(doc), "calls_ghost.yaml")
        assert response.status_code == 200, response.text
        error = _blocked_by(response.json()["data"], "calls_ghost")
        assert error["code"] == "MISSING_FUNCTION_ID"
        assert re.fullmatch(UNNAMED_FUNCTION_TEXT, error["message"])

    def test_a_missing_version_blocks_the_entry(self, client: TestClient) -> None:
        created = client.post("/functions", json=make_function_payload(name="lib_callee")).json()
        callee_id = created["data"]["id"]
        doc = _export_doc(
            name="pins_gone",
            workflow=_body(_call_block(callee_id, version="9.9.9", label="Call callee")),
        )
        response = _validate(client, _yaml_bytes(doc), "pins_gone.yaml")
        assert response.status_code == 200, response.text
        error = _blocked_by(response.json()["data"], "pins_gone")
        assert error["code"] == "MISSING_FUNCTION_VERSION"
        assert re.fullmatch(
            MISSING_VERSION_TEXT.format(name=re.escape("lib_callee"), version=re.escape("9.9.9")),
            error["message"],
        )

    def test_entries_that_call_each_other_in_one_upload_pass(self, client: TestClient) -> None:
        """The caller pins a version its callee holds only in the file's version list."""
        callee_id = str(uuid.uuid4())
        callee = _export_doc(name="up_callee", id=callee_id, version="1.1.0")
        callee["versions"] = [_version_record("1.1.0"), _version_record("1.0.0")]
        caller = _export_doc(
            name="up_caller", workflow=_body(_call_block(callee_id, version="1.0.0"))
        )
        content = _zip_bytes({"a.yaml": caller, "b.yaml": callee})
        response = _validate(client, content, "functions.zip")
        assert response.status_code == 200, response.text
        result = response.json()["data"]
        assert _find_item(result, "up_caller")["status"] == "ok"
        assert _find_item(result, "up_callee")["status"] == "ok"
        assert result["blocked"] == 0


class TestValidateCircular:
    def test_a_circle_blocks_every_entry_in_it(self, client: TestClient) -> None:
        a_id, b_id = str(uuid.uuid4()), str(uuid.uuid4())
        doc_a = _export_doc(name="A", id=a_id, workflow=_body(_call_block(b_id)))
        doc_b = _export_doc(name="B", id=b_id, workflow=_body(_call_block(a_id)))
        content = _zip_bytes({"a.yaml": doc_a, "b.yaml": doc_b})
        response = _validate(client, content, "functions.zip")
        assert response.status_code == 200, response.text
        result = response.json()["data"]
        error_a = _blocked_by(result, "A")
        assert error_a["code"] == "CIRCULAR"
        assert re.fullmatch(CIRCULAR_TEXT.format(path="A -> B -> A"), error_a["message"])
        error_b = _blocked_by(result, "B")
        assert error_b["code"] == "CIRCULAR"
        assert re.fullmatch(
            CIRCULAR_TEXT.format(path="(A -> B -> A|B -> A -> B)"), error_b["message"]
        )
        assert result["blocked"] == 2
        assert result["importable"] == 0

    @pytest.mark.parametrize("closed_by", ["an older version", "a stored version"])
    def test_a_circle_through_an_older_version_or_a_stored_version_is_found(
        self, client: TestClient, closed_by: str
    ) -> None:
        """A calls B; only version 1.0.0 of B calls A back, and B's latest does not."""
        a_id, b_id = str(uuid.uuid4()), str(uuid.uuid4())
        calls_a = _body(_call_block(a_id))
        docs = {
            "a.yaml": _export_doc(
                name="A", id=a_id, workflow=_body(_call_block(b_id, version="2.0.0"))
            )
        }
        if closed_by == "a stored version":
            _seed_version(b_id, "B", "1.0.0", calls_a)
            _seed_version(b_id, "B", "2.0.0")
        else:
            doc_b = _export_doc(name="B", id=b_id, version="2.0.0")
            doc_b["versions"] = [_version_record("2.0.0"), _version_record("1.0.0", calls_a)]
            docs["b.yaml"] = doc_b
        response = _validate(client, _zip_bytes(docs), "functions.zip")
        assert response.status_code == 200, response.text
        error = _blocked_by(response.json()["data"], "A")
        assert error["code"] == "CIRCULAR"
        assert re.fullmatch(CIRCULAR_TEXT.format(path="A -> B -> A"), error["message"])


pytestmark = pytest.mark.usefixtures("temp_storage_path")
