"""Tests for the Function import (commit) endpoint (REQ-3.1.2.5).

Import mirrors the
Tests/Suites per-feature pattern and returns the canonical shared shape from
``frontend/src/types/import-export.ts``:

    ImportResult = {
        imported: [{name, id, action}],          # action: created|renamed|overwritten
        skipped: [{name, reason}],
        fixes_applied: [{name, fixes}],
        total_imported, total_skipped
    }

Conflict resolutions use the shared vocabulary ``rename`` | ``overwrite`` |
``skip``. A name conflict without a supplied resolution is surfaced in the
result (skipped), never a 4xx.

Anchored error string:
    ^Import payload is not valid YAML or JSON$
"""

import io
import re
import uuid
import zipfile
from collections.abc import Callable, Mapping
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient

from wavecore.api.services.functions import _storage, import_export
from wavecore.api.services.storage_paths import get_functions_storage_path
from wavecore.core.secrets.cipher import SecretCipher
from wavecore.core.secrets.masking import MASK_PLACEHOLDER
from wavecore.core.secrets.sealing import unseal_all

from .conftest import make_function_payload

INVALID_PAYLOAD_RE = re.compile(r"^Import payload is not valid YAML or JSON$")
MISSING_FUNCTION_TEXT = r'^Uses Function "{block}", which is not in the library or in this file$'
UNNAMED_FUNCTION_TEXT = r"^Uses a Function that is not in the library or in this file$"
SAME_RUN_NAME_TEXT = r"^The file holds another Function with this name$"
SAME_RUN_ID_TEXT = r"^The file holds another Function with this ID$"
AMBIGUOUS_NAME_TEXT = r"^Several Functions in the library have this name$"
CIRCULAR_TEXT = r"^Circular Function reference: {path}$"
UUID_EXISTS_TEXT = r"^UUID '{id}' already exists in the library$"

RESULT_KEYS = {"imported", "skipped", "fixes_applied", "total_imported", "total_skipped"}
PREVIEW_KEYS = {"items", "total", "importable", "blocked"}
ITEM_KEYS = {"name", "status", "fatal_errors", "fixable_errors", "warnings", "existing_id"}

WRITE_ERROR = "No space left on device"

Choice = Callable[[str], str]
Case = tuple[list[dict[str, Any]], Choice, dict[str, Any]]


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
    import zipfile

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for filename, doc in docs.items():
            zf.writestr(filename, yaml.safe_dump(doc, sort_keys=False))
    buf.seek(0)
    return buf.read()


def _import(
    client: TestClient,
    content: bytes,
    filename: str,
    *,
    resolutions: dict[str, str] | None = None,
):
    import json as _json

    data: dict[str, str] = {}
    if resolutions is not None:
        data["conflict_resolutions"] = _json.dumps(resolutions)
    return client.post(
        "/functions/import",
        files={"file": (filename, io.BytesIO(content), "application/octet-stream")},
        data=data,
    )


def _names(entries: list[dict[str, Any]]) -> list[str]:
    return [e["name"] for e in entries]


def _call_block(
    function_id: str,
    *,
    version: str = "1.0.0",
    label: str = "Call callee",
    node_id: str = "node-call",
) -> dict[str, Any]:
    """A library Function block that calls ``function_id``."""
    return {
        "id": node_id,
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


def _deep_body(callee_id: str) -> dict[str, Any]:
    """A body that names ``callee_id`` at the top level, in a Local body and in a draft."""
    local = {
        "id": "node-local",
        "type": "workflowNode",
        "position": {"x": 0, "y": 0},
        "data": {
            "label": "Local step",
            "elementType": "function",
            "nodeType": "function",
            "functionLifecycle": "local",
            "localDefinition": {
                "name": "Local step",
                "inputs": [],
                "outputs": [],
                "dependencies": {"functions": [callee_id], "plugins": []},
                "workflow": _body(_call_block(callee_id, node_id="node-in-local")),
            },
        },
    }
    editing = _call_block(callee_id, node_id="node-editing")
    editing["data"]["editMode"] = True
    editing["data"]["upstreamLink"] = {"functionId": callee_id, "sourceVersion": "1.0.0"}
    editing["data"]["draft"] = {"workflow": _body(_call_block(callee_id, node_id="node-in-draft"))}
    return _body(_call_block(callee_id, node_id="node-top"), local, editing)


def _callee_places(workflow: dict[str, Any]) -> dict[str, Any]:
    """Every place of a ``_deep_body`` workflow that names the callee."""
    data = {node["id"]: node["data"] for node in workflow["nodes"]}
    local = data["node-local"]["localDefinition"]
    editing = data["node-editing"]
    return {
        "top level": data["node-top"]["functionId"],
        "local body": local["workflow"]["nodes"][0]["data"]["functionId"],
        "local dependency list": local["dependencies"]["functions"],
        "edit-mode block": editing["functionId"],
        "upstream link": editing["upstreamLink"]["functionId"],
        "draft": editing["draft"]["workflow"]["nodes"][0]["data"]["functionId"],
    }


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


def _seed(function_id: str, name: str, *, workflow: dict[str, Any] | None = None) -> None:
    """Publish version 1.0.0 of a library Function with a known id and name."""
    record = _version_record("1.0.0", workflow)
    _storage.save_new_version(
        function_id, "1.0.0", record["definition"], record["metadata"], name=name
    )


def _choices(by_name: dict[str, str]) -> Choice:
    return lambda name: by_name.get(name, "skip")


def _decision_for(decisions: list[Any], doc: dict[str, Any]) -> Any:
    matches = [d for d in decisions if (d.source_id, d.name) == (doc["id"], doc["name"])]
    assert len(matches) == 1, [(d.source_id, d.name) for d in decisions]
    return matches[0]


def _outcome_for(outcomes: list[Any], doc: dict[str, Any]) -> Any:
    matches = [o for o in outcomes if o.source_id == doc["id"]]
    assert len(matches) == 1, [o.source_id for o in outcomes]
    return matches[0]


def _decided(decision: Any) -> dict[str, Any]:
    return {
        "source_id": decision.source_id,
        "name": decision.name,
        "status": decision.status,
        "conflict": decision.conflict,
        "action": decision.action,
        "target_id": decision.target_id,
        "target_name": decision.target_name,
        "existing_id": decision.existing_id,
        "finding": decision.finding,
    }


def _matched(decision: Any) -> tuple[str, str | None]:
    return decision.status, decision.conflict


def _written(outcome: Any) -> tuple[str, str, str]:
    return outcome.action, outcome.final_id, outcome.final_name


def _library_files() -> dict[str, bytes]:
    root = get_functions_storage_path()
    if not root.exists():
        return {}
    return {
        str(p.relative_to(root)): p.read_bytes() for p in sorted(root.rglob("*")) if p.is_file()
    }


def _versions_of(function_id: str) -> set[str]:
    definition, _etag = _storage.load_function(function_id)
    return set(definition["available_versions"])


def _wrap_savers(monkeypatch: pytest.MonkeyPatch, after_write: Callable[[str], None]) -> None:
    """Call ``after_write`` with the Function id after every version write."""
    for saver_name in ("save_new_version", "save_or_replace_version"):
        real = getattr(_storage, saver_name)

        def saver(
            function_id: str,
            version: str,
            definition: Any,
            metadata: Any,
            *,
            name: str,
            _real: Callable[..., str] = real,
        ) -> str:
            etag = _real(function_id, version, definition, metadata, name=name)
            after_write(function_id)
            return etag

        monkeypatch.setattr(_storage, saver_name, saver)


def _fail_writes_of(function_ids: set[str]) -> Callable[[str], None]:
    def after_write(function_id: str) -> None:
        if function_id in function_ids:
            raise OSError(WRITE_ERROR)

    return after_write


def _structural_case() -> Case:
    doc = _export_doc(name="X" * 33)
    return [doc], _choices({}), doc


def _invalid_version_case() -> Case:
    doc = _export_doc(name="Bad version", version="not-semver")
    return [doc], _choices({}), doc


def _missing_function_case() -> Case:
    doc = _export_doc(name="Calls ghost", workflow=_body(_call_block(str(uuid.uuid4()))))
    return [doc], _choices({}), doc


def _missing_version_case() -> Case:
    callee_id = str(uuid.uuid4())
    _seed(callee_id, "Lib")
    doc = _export_doc(name="Pins gone", workflow=_body(_call_block(callee_id, version="9.9.9")))
    return [doc], _choices({}), doc


def _circular_case() -> Case:
    a_id, b_id = str(uuid.uuid4()), str(uuid.uuid4())
    doc_a = _export_doc(name="A", id=a_id, workflow=_body(_call_block(b_id)))
    doc_b = _export_doc(name="B", id=b_id, workflow=_body(_call_block(a_id)))
    return [doc_a, doc_b], _choices({}), doc_a


def _name_taken_case() -> Case:
    id_holder, name_holder = str(uuid.uuid4()), str(uuid.uuid4())
    _seed(id_holder, "Alpha")
    _seed(name_holder, "Beta")
    doc = _export_doc(name="Beta", id=id_holder, version="2.0.0")
    return [doc], _choices({"Beta": "overwrite"}), doc


def _same_run_case() -> Case:
    first = _export_doc(name="First")
    second = _export_doc(name="Second", id=first["id"])
    return [first, second], _choices({"Second": "overwrite"}), second


def _ambiguous_name_case() -> Case:
    for _ in range(2):
        _seed(str(uuid.uuid4()), "Twins")
    doc = _export_doc(name="Twins", version="2.0.0")
    return [doc], _choices({"Twins": "overwrite"}), doc


def _clean_case() -> Case:
    doc = _export_doc(name="Fresh")
    return [doc], _choices({}), doc


_FUNCTION_SECRET_PLACES = (
    "Setter literal",
    "plugin credential",
    "Function-local secret",
    "secret output default",
)
_SECRET_VERSION_METADATA = {
    "description": "",
    "tags": [],
    "changelog": "",
    "details": "",
    "published_at": "2026-01-01T00:00:00Z",
    "published_by": "wave",
}


@pytest.fixture
def http_client_plugin(monkeypatch: pytest.MonkeyPatch) -> None:
    """The HTTP block, registered for one test, so its declared credential fields are known."""
    from wavecore.core import plugin_registry
    from wavecore.plugins.http_client import HTTPClientPlugin

    plugin = HTTPClientPlugin()
    monkeypatch.setitem(
        plugin_registry._registry._plugins, "http-client", {plugin.metadata["version"]: plugin}
    )


def _secret_wave_cannot_open(kind: str) -> str:
    if kind == "foreign":
        return SecretCipher(bytes(range(1, 33))).seal("sealed-elsewhere")
    return MASK_PLACEHOLDER


def _secret_block(place: str, value: Any) -> dict[str, Any]:
    """The one block that holds ``value`` at a body secret place."""
    if place == "Setter literal":
        data: dict[str, Any] = {
            "label": "Set token",
            "elementType": "variable-setter",
            "nodeType": "control",
            "version": "1.0.0",
            "config": {
                "values": {"variables": {"set_tok": value}},
                "variableSecretKeys": ["set_tok"],
            },
        }
    else:
        data = {
            "label": "Call API",
            "elementType": "http-client",
            "nodeType": "plugin",
            "version": "1.0.0",
            "config": {
                "values": {"url": "http://api.test", "method": "GET", "auth_token": value},
                "outputBindings": {},
                "profileBindings": [],
            },
        }
    return {
        "id": "secret-block",
        "type": "workflowNode",
        "position": {"x": 0, "y": 0},
        "data": data,
    }


def _secret_body(place: str, value: Any) -> dict[str, Any]:
    """A Function body whose only secret, ``value``, sits at ``place``."""
    body: dict[str, Any] = {
        "inputs": [],
        "outputs": [],
        "variables": [],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": _body(),
    }
    if place in ("Setter literal", "plugin credential"):
        body["workflow"] = _body(_secret_block(place, value))
    elif place == "Function-local secret":
        body["variables"] = [
            {"name": "local_tok", "type": "string", "secret": True, "value": value}
        ]
    else:
        body["outputs"] = [{"name": "out_tok", "type": "string", "secret": True, "default": value}]
    return body


def _secret_entry(
    place: str,
    value: Any,
    *,
    function_id: str | None = None,
    versions: tuple[str, ...] = ("1.0.0",),
) -> dict[str, Any]:
    """An export document whose every version holds ``value`` at ``place``."""
    return {
        "id": function_id or str(uuid.uuid4()),
        "name": "Holds a secret",
        "version": versions[0],
        "description": "",
        "tags": [],
        **_secret_body(place, value),
        "metadata": {"author": "tester", "created_at": "2026-01-01T00:00:00Z"},
        "versions": [
            {
                "version": version,
                "definition": _secret_body(place, value),
                "metadata": _SECRET_VERSION_METADATA,
            }
            for version in versions
        ],
    }


def _function_secret(place: str, definition: Mapping[str, Any]) -> tuple[Any, bool]:
    """The value a stored version body holds at ``place`` and whether it is still secret."""
    if place in ("Setter literal", "plugin credential"):
        config = definition["workflow"]["nodes"][0]["data"]["config"]
        if place == "Setter literal":
            return config["values"]["variables"]["set_tok"], config["variableSecretKeys"] == [
                "set_tok"
            ]
        # The HTTP block declares this field a credential, so it is secret by declaration.
        return config["values"]["auth_token"], True
    if place == "Function-local secret":
        declared = (definition.get("variables") or [{}])[0]
        return declared.get("value"), declared.get("secret") is True
    declared = definition["outputs"][0]
    return declared.get("default"), declared.get("secret") is True


# ---------------------------------------------------------------------------
# Clean import
# ---------------------------------------------------------------------------


class TestCleanImport:
    def test_creates_function_with_action_created(self, client: TestClient) -> None:
        doc = _export_doc(name="fresh_import")
        response = _import(client, _yaml_bytes(doc), "fresh_import.yaml")
        assert response.status_code == 200, response.text
        result = response.json()["data"]
        assert RESULT_KEYS <= set(result.keys())
        assert result["total_imported"] == 1
        assert result["total_skipped"] == 0
        entry = result["imported"][0]
        assert entry["name"] == "fresh_import"
        assert entry["action"] == "created"
        assert entry["id"]

    def test_imported_function_is_persisted_and_listed(self, client: TestClient) -> None:
        doc = _export_doc(name="persisted_import")
        _import(client, _yaml_bytes(doc), "persisted_import.yaml")
        listed = client.get("/functions?search=persisted_import").json()["data"]
        assert any(row["name"] == "persisted_import" for row in listed)

    def test_an_id_leaving_the_library_folder_is_skipped_and_writes_nothing(
        self, client: TestClient
    ) -> None:
        doc = _export_doc(name="escapes", id="../escaped")

        response = _import(client, _yaml_bytes(doc), "escapes.yaml")

        assert response.status_code == 200, response.text
        result = response.json()["data"]
        assert result["imported"] == []
        assert result["skipped"] == [
            {"name": "escapes", "reason": "Invalid UUID format for id: '../escaped'"}
        ]
        assert _library_files() == {}
        assert not (get_functions_storage_path().parent / "escaped").exists()

    @pytest.mark.usefixtures("http_client_plugin")
    @pytest.mark.parametrize("kind", ["foreign", "masked"])
    @pytest.mark.parametrize("place", _FUNCTION_SECRET_PLACES)
    def test_a_secret_wave_cannot_open_is_stored_as_null_in_every_version(
        self, place: str, kind: str
    ) -> None:
        entry = _secret_entry(place, _secret_wave_cannot_open(kind), versions=("1.1.0", "1.0.0"))

        result = import_export.import_functions(_yaml_bytes(entry), "secret.yaml")

        assert result["total_imported"] == 1, result
        records = _storage.list_version_records(result["imported"][0]["id"])
        assert [record["version"] for record in records] == ["1.1.0", "1.0.0"]
        assert [_function_secret(place, record["definition"]) for record in records] == [
            (None, True),
            (None, True),
        ]

    @pytest.mark.usefixtures("http_client_plugin")
    @pytest.mark.parametrize("place", _FUNCTION_SECRET_PLACES)
    def test_a_masked_placeholder_keeps_the_secret_stored_at_the_same_place_on_overwrite(
        self, place: str
    ) -> None:
        function_id = str(uuid.uuid4())
        _storage.save_new_version(
            function_id,
            "1.0.0",
            _secret_body(place, "kept-secret"),
            _SECRET_VERSION_METADATA,
            name="Holds a secret",
        )
        entry = _secret_entry(place, MASK_PLACEHOLDER, function_id=function_id)

        result = import_export.import_functions(
            _yaml_bytes(entry), "masked.yaml", {"Holds a secret": "overwrite"}
        )

        assert result["imported"] == [
            {"name": "Holds a secret", "id": function_id, "action": "overwritten"}
        ]
        (record,) = _storage.list_version_records(function_id)
        value, secret = _function_secret(place, record["definition"])
        assert (unseal_all(value), secret) == ("kept-secret", True)

    @pytest.mark.usefixtures("http_client_plugin")
    @pytest.mark.parametrize(
        ("place", "name"),
        [
            ("Setter literal", "set_tok"),
            ("plugin credential", "auth_token"),
            ("Function-local secret", "local_tok"),
            ("secret output default", "out_tok"),
        ],
    )
    def test_the_preview_names_a_foreign_secret_with_the_unchanged_warning(
        self, place: str, name: str
    ) -> None:
        entry = _secret_entry(place, _secret_wave_cannot_open("foreign"))

        preview = import_export.validate_import(_yaml_bytes(entry), "foreign.yaml")

        messages = [
            warning["message"]
            for warning in preview["items"][0]["warnings"]
            if warning["code"] == "FOREIGN_ENCRYPTED_SECRET"
        ]
        assert len(messages) == 1, messages
        expected = (
            f"Secret '{name}' is encrypted by another WAVE instance and "
            "cannot be decrypted here; re-enter it after import"
        )
        assert re.fullmatch("^" + re.escape(expected) + "$", messages[0])


# ---------------------------------------------------------------------------
# Conflict resolutions: overwrite / rename / skip
# ---------------------------------------------------------------------------


class TestConflictResolutions:
    def _seed_existing(self, client: TestClient, name: str, description: str) -> str:
        created = client.post(
            "/functions",
            json=make_function_payload(name=name, description=description),
        ).json()
        return created["data"]["id"]

    def test_overwrite_replaces_existing(self, client: TestClient) -> None:
        self._seed_existing(client, "ow_target", "original")
        doc = _export_doc(name="ow_target", description="replacement")
        response = _import(
            client,
            _yaml_bytes(doc),
            "ow_target.yaml",
            resolutions={"ow_target": "overwrite"},
        )
        assert response.status_code == 200, response.text
        result = response.json()["data"]
        entry = result["imported"][0]
        assert entry["action"] == "overwritten"
        listed = client.get("/functions?search=ow_target").json()["data"]
        ow_rows = [r for r in listed if r["name"] == "ow_target"]
        assert len(ow_rows) == 1
        assert ow_rows[0]["description"] == "replacement"

    def test_rename_keeps_original_and_adds_renamed(self, client: TestClient) -> None:
        self._seed_existing(client, "rn_target", "original")
        doc = _export_doc(name="rn_target", description="incoming")
        response = _import(
            client,
            _yaml_bytes(doc),
            "rn_target.yaml",
            resolutions={"rn_target": "rename"},
        )
        assert response.status_code == 200, response.text
        result = response.json()["data"]
        entry = result["imported"][0]
        assert entry["action"] == "renamed"
        assert entry["name"] != "rn_target"
        # Both the original and the renamed copy now exist.
        names = {r["name"] for r in client.get("/functions").json()["data"]}
        assert "rn_target" in names
        assert entry["name"] in names

    def test_skip_leaves_existing_untouched(self, client: TestClient) -> None:
        self._seed_existing(client, "sk_target", "original")
        doc = _export_doc(name="sk_target", description="should-not-apply")
        response = _import(
            client,
            _yaml_bytes(doc),
            "sk_target.yaml",
            resolutions={"sk_target": "skip"},
        )
        assert response.status_code == 200, response.text
        result = response.json()["data"]
        assert result["total_imported"] == 0
        assert result["total_skipped"] == 1
        assert "sk_target" in _names(result["skipped"])
        assert result["skipped"][0].get("reason")
        listed = client.get("/functions?search=sk_target").json()["data"]
        assert [r for r in listed if r["name"] == "sk_target"][0]["description"] == "original"

    def test_unresolved_conflict_is_surfaced_not_4xx(self, client: TestClient) -> None:
        """A conflict with no supplied resolution is reported, not a hard error."""
        self._seed_existing(client, "noresolve", "original")
        doc = _export_doc(name="noresolve", description="incoming")
        response = _import(client, _yaml_bytes(doc), "noresolve.yaml")
        assert response.status_code == 200, response.text
        result = response.json()["data"]
        assert result["total_imported"] == 0
        assert "noresolve" in _names(result["skipped"])


# ---------------------------------------------------------------------------
# Dependency-ordered batch import
# ---------------------------------------------------------------------------


class TestDependencyOrderedImport:
    def test_entries_are_ordered_by_what_their_bodies_call(self, client: TestClient) -> None:
        """A's body calls B and no dependency list names B; B imports before A."""
        b_id = str(uuid.uuid4())
        callee_b = _export_doc(name="imp_callee", id=b_id)
        caller_a = _export_doc(
            name="imp_caller",
            dependencies={"functions": [], "plugins": []},
            workflow=_body(_call_block(b_id)),
        )
        content = _zip_bytes({"a.yaml": caller_a, "b.yaml": callee_b})
        response = _import(client, content, "functions.zip")
        assert response.status_code == 200, response.text
        result = response.json()["data"]
        imported_names = _names(result["imported"])
        assert "imp_callee" in imported_names
        assert "imp_caller" in imported_names
        assert imported_names.index("imp_callee") < imported_names.index("imp_caller")

    def test_a_call_in_an_older_version_orders_the_entry(self, client: TestClient) -> None:
        """Only version 1.0.0 of A calls B; B still imports before A."""
        b_id = str(uuid.uuid4())
        callee_b = _export_doc(name="old_callee", id=b_id)
        caller_a = _export_doc(name="old_caller", version="2.0.0")
        caller_a["versions"] = [
            _version_record("2.0.0"),
            _version_record("1.0.0", _body(_call_block(b_id))),
        ]
        content = _zip_bytes({"a.yaml": caller_a, "b.yaml": callee_b})
        response = _import(client, content, "functions.zip")
        assert response.status_code == 200, response.text
        result = response.json()["data"]
        imported_names = _names(result["imported"])
        assert "old_callee" in imported_names
        assert "old_caller" in imported_names
        assert imported_names.index("old_callee") < imported_names.index("old_caller")

    def test_archive_imports_all_clean_entries(self, client: TestClient) -> None:
        content = _zip_bytes(
            {
                "a.yaml": _export_doc(name="batch_one"),
                "b.yaml": _export_doc(name="batch_two"),
            }
        )
        response = _import(client, content, "functions.zip")
        result = response.json()["data"]
        assert result["total_imported"] == 2
        assert set(_names(result["imported"])) == {"batch_one", "batch_two"}


# ---------------------------------------------------------------------------
# Entries blocked by their references
# ---------------------------------------------------------------------------


class TestImportBlockedEntries:
    def test_a_blocked_entry_is_not_written_and_is_named_with_its_reason(
        self, client: TestClient
    ) -> None:
        blocked = _export_doc(
            name="calls_ghost",
            workflow=_body(_call_block(str(uuid.uuid4()), label="Call ghost")),
        )
        clean = _export_doc(name="stands_alone")
        content = _zip_bytes({"a.yaml": blocked, "b.yaml": clean})
        response = _import(client, content, "functions.zip")
        assert response.status_code == 200, response.text
        result = response.json()["data"]
        assert _names(result["imported"]) == ["stands_alone"]
        assert _names(result["skipped"]) == ["calls_ghost"]
        assert re.fullmatch(
            MISSING_FUNCTION_TEXT.format(block=re.escape("Call ghost")),
            result["skipped"][0]["reason"],
        )
        listed = {row["name"] for row in client.get("/functions").json()["data"]}
        assert listed == {"stands_alone"}

    def test_a_missing_function_with_no_name_on_the_canvas_reads_uses_a_function(
        self, client: TestClient
    ) -> None:
        blocked = _export_doc(
            name="calls_ghost",
            workflow=_body(_call_block(str(uuid.uuid4()), label="", node_id="")),
        )
        response = _import(client, _yaml_bytes(blocked), "calls_ghost.yaml")
        assert response.status_code == 200, response.text
        result = response.json()["data"]
        assert _names(result["skipped"]) == ["calls_ghost"]
        assert re.fullmatch(UNNAMED_FUNCTION_TEXT, result["skipped"][0]["reason"])
        assert client.get("/functions").json()["data"] == []

    @pytest.mark.parametrize("label", ["", "   "], ids=["empty", "blank"])
    def test_a_block_with_an_id_and_no_name_is_not_named_by_its_id(
        self, client: TestClient, label: str
    ) -> None:
        call = _call_block(str(uuid.uuid4()), label=label, node_id="node-1779383867313-vzh88ic")
        blocked = _export_doc(name="calls_ghost", workflow=_body(call))
        response = _import(client, _yaml_bytes(blocked), "calls_ghost.yaml")
        assert response.status_code == 200, response.text
        result = response.json()["data"]
        assert _names(result["skipped"]) == ["calls_ghost"]
        assert re.fullmatch(UNNAMED_FUNCTION_TEXT, result["skipped"][0]["reason"])
        assert client.get("/functions").json()["data"] == []


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


_LOCAL_ID = {"name": "id", "type": "string", "value": "x"}

# Each declaration breaks one rule, so its entry carries exactly one finding.
_MALFORMED_DECLARATIONS = [
    pytest.param(
        {"inputs": [{**_level(type="array"), "enumValueType": "string"}]},
        "Enum input 'level' must be of type string, integer or float",
        id="old-array-enum",
    ),
    pytest.param(
        {"inputs": [{key: value for key, value in _level().items() if key != "default"}]},
        "Enum input 'level' needs a default from its allowed values",
        id="enum-no-default",
    ),
    pytest.param(
        {"inputs": [{"name": "flag", "type": "boolean", "required": True}]},
        "Boolean input 'flag' needs a default",
        id="required-boolean-no-default",
    ),
    pytest.param(
        {"inputs": [{"name": "flag", "type": "boolean", "required": False}]},
        "Boolean input 'flag' needs a default",
        id="optional-boolean-no-default",
    ),
    pytest.param(
        {"inputs": [{"name": "id", "type": "string", "required": False}], "variables": [_LOCAL_ID]},
        "Function declares 'id' as both an input and a local variable",
        id="input-and-local",
    ),
    pytest.param(
        {
            "inputs": [{"name": "id", "type": "string", "required": False}],
            "outputs": [{"name": "id", "type": "string"}],
        },
        "Function declares 'id' as both an input and an output",
        id="input-and-output",
    ),
    pytest.param(
        {"variables": [_LOCAL_ID, _LOCAL_ID]},
        "Function declares local variable 'id' more than once",
        id="local-twice",
    ),
]


class TestImportRefusesMalformedDeclarations:
    """An entry with a malformed declaration is not written and names the rule it breaks
    (REQ-3.1.2.4, REQ-3.1.2.11)."""

    @pytest.mark.parametrize(("declarations", "message"), _MALFORMED_DECLARATIONS)
    def test_the_entry_is_skipped_with_the_message(
        self, client: TestClient, declarations: dict[str, Any], message: str
    ) -> None:
        doc = _export_doc(name="declares", **declarations)

        response = _import(client, _yaml_bytes(doc), "declares.yaml")

        assert response.status_code == 200, response.text
        result = response.json()["data"]
        assert result["imported"] == []
        assert result["skipped"] == [{"name": "declares", "reason": message}]
        assert client.get("/functions").json()["data"] == []

    def test_well_formed_declarations_import(self, client: TestClient) -> None:
        doc = _export_doc(
            name="declares",
            inputs=[
                _level(),
                {"name": "flag", "type": "boolean", "required": True, "default": False},
                {"name": "verbose", "type": "boolean", "required": False, "default": True},
                {"name": "pin", "type": "boolean", "required": False, "secret": True},
            ],
            outputs=[{"name": "result", "type": "string"}],
            variables=[{"name": "step", "type": "integer", "value": 1}],
        )

        response = _import(client, _yaml_bytes(doc), "declares.yaml")

        assert response.status_code == 200, response.text
        assert _names(response.json()["data"]["imported"]) == ["declares"]


# ---------------------------------------------------------------------------
# Parse failures
# ---------------------------------------------------------------------------


class TestImportParseErrors:
    def test_unparsable_returns_400(self, client: TestClient) -> None:
        response = _import(client, b"{this is :: garbage [", "garbage.yaml")
        assert response.status_code == 400
        assert any(INVALID_PAYLOAD_RE.match(m) for m in _all_error_messages(response.json()))

    def test_non_mapping_top_level_is_rejected(self, client: TestClient) -> None:
        # Parses fine but is a list, not a Function mapping.
        response = _import(client, b"- one\n- two\n", "list.yaml")
        assert response.status_code == 400
        assert any(INVALID_PAYLOAD_RE.match(m) for m in _all_error_messages(response.json()))

    def test_invalid_zip_is_rejected(self, client: TestClient) -> None:
        response = _import(client, b"this is definitely not a zip", "bundle.zip")
        assert response.status_code == 400
        assert any(INVALID_PAYLOAD_RE.match(m) for m in _all_error_messages(response.json()))

    def test_zip_without_importable_members_is_rejected(self, client: TestClient) -> None:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("readme.txt", "nothing importable here")
        response = _import(client, buf.getvalue(), "bundle.zip")
        assert response.status_code == 400
        assert any(INVALID_PAYLOAD_RE.match(m) for m in _all_error_messages(response.json()))


class TestImportSkipsAndInternals:
    def test_structurally_invalid_entry_is_skipped(self, client: TestClient) -> None:
        # An over-length name (> NAME_MAX_LENGTH) is a structural failure.
        long_name = "x" * 40
        response = _import(client, _yaml_bytes(_export_doc(name=long_name)), "bad.yaml")
        assert response.status_code == 200
        result = response.json()["data"]
        assert any(s["name"] == long_name for s in result["skipped"])

    def test_invalid_conflict_resolutions_json_is_rejected(self, client: TestClient) -> None:
        response = client.post(
            "/functions/import",
            files={
                "file": (
                    "f.yaml",
                    io.BytesIO(_yaml_bytes(_export_doc(name="Whatever"))),
                    "application/octet-stream",
                )
            },
            data={"conflict_resolutions": "{not valid json"},
        )
        assert response.status_code == 400
        assert any(
            "Invalid JSON in conflict_resolutions" in m
            for m in _all_error_messages(response.json())
        )

    def test_commit_failure_is_skipped(self, client: TestClient) -> None:
        # A structurally-valid entry whose version is not valid semver clears the
        # structural gate but raises inside save_new_version; the entry is
        # skipped, not surfaced as a 500.
        doc = _export_doc(name="Clashy", version="not-a-semver")
        response = _import(client, _yaml_bytes(doc), "clash.yaml")
        assert response.status_code == 200
        result = response.json()["data"]
        assert any(s["name"] == "Clashy" for s in result["skipped"])


# ---------------------------------------------------------------------------
# decide_entries: one decision per entry, nothing written
# ---------------------------------------------------------------------------


class TestDecideEntries:
    def test_nothing_is_written(self) -> None:
        held_id, kept_id = str(uuid.uuid4()), str(uuid.uuid4())
        _seed(held_id, "Held")
        _seed(kept_id, "Kept")
        before = _library_files()
        fresh = _export_doc(name="Fresh")
        update = _export_doc(name="Held", id=held_id, version="2.0.0")
        moved = _export_doc(name="Moved", id=kept_id)

        decisions = import_export.decide_entries(
            [fresh, update, moved], _choices({"Held": "overwrite", "Moved": "rename"})
        )

        actions = {decision.name: decision.action for decision in decisions}
        assert actions == {"Fresh": "create", "Held": "overwrite", "Moved": "rename"}
        assert _library_files() == before

    def test_a_decision_carries_the_pinned_fields(self) -> None:
        held_id, kept_id, stays_id = (str(uuid.uuid4()) for _ in range(3))
        _seed(held_id, "Held")
        _seed(kept_id, "Kept")
        _seed(stays_id, "Stays")
        fresh = _export_doc(name="Fresh")
        update = _export_doc(name="Held", id=held_id, version="2.0.0")
        renamed = _export_doc(name="Kept")
        left = _export_doc(name="Other name", id=stays_id)

        decisions = import_export.decide_entries(
            [fresh, update, renamed, left], _choices({"Held": "overwrite", "Kept": "rename"})
        )

        created = _decision_for(decisions, fresh)
        assert created.entry == fresh
        assert _decided(created) == {
            "source_id": fresh["id"],
            "name": "Fresh",
            "status": "ok",
            "conflict": None,
            "action": "create",
            "target_id": fresh["id"],
            "target_name": "Fresh",
            "existing_id": None,
            "finding": None,
        }
        assert _decided(_decision_for(decisions, update)) == {
            "source_id": held_id,
            "name": "Held",
            "status": "conflict",
            "conflict": "both",
            "action": "overwrite",
            "target_id": held_id,
            "target_name": "Held",
            "existing_id": held_id,
            "finding": None,
        }
        assert _decided(_decision_for(decisions, renamed)) == {
            "source_id": renamed["id"],
            "name": "Kept",
            "status": "conflict",
            "conflict": "name",
            "action": "rename",
            "target_id": renamed["id"],
            "target_name": "Kept (2)",
            "existing_id": kept_id,
            "finding": None,
        }
        skipped = _decided(_decision_for(decisions, left))
        del skipped["target_name"]
        assert skipped == {
            "source_id": stays_id,
            "name": "Other name",
            "status": "conflict",
            "conflict": "id",
            "action": "skip",
            "target_id": stays_id,
            "existing_id": stays_id,
            "finding": None,
        }

    def test_without_a_resolution_the_status_and_the_kind_are_decided_and_the_action_is_none(
        self,
    ) -> None:
        held_id, alpha_id, beta_id = (str(uuid.uuid4()) for _ in range(3))
        _seed(held_id, "Held")
        _seed(alpha_id, "Alpha")
        _seed(beta_id, "Beta")
        for _ in range(2):
            _seed(str(uuid.uuid4()), "Twins")
        fresh = _export_doc(name="Fresh")
        same_id = _export_doc(name="Other name", id=held_id)
        caller = _export_doc(name="Calls ghost", workflow=_body(_call_block(str(uuid.uuid4()))))
        name_taken = _export_doc(name="Beta", id=alpha_id)
        twin = _export_doc(name="Twins")
        first, second = _export_doc(name="Dup"), _export_doc(name="Dup")
        entries = [fresh, same_id, caller, name_taken, twin, first, second]

        decisions = import_export.decide_entries(entries, None)

        assert [decision.action for decision in decisions] == [None] * len(entries)
        assert _matched(_decision_for(decisions, fresh)) == ("ok", None)
        assert _matched(_decision_for(decisions, same_id)) == ("conflict", "id")
        assert _matched(_decision_for(decisions, name_taken)) == ("conflict", "both")
        assert _matched(_decision_for(decisions, twin)) == ("conflict", "name")
        blocked = _decision_for(decisions, caller)
        assert blocked.status == "fatal"
        assert blocked.finding[0] == "MISSING_FUNCTION_ID"
        for doc in (name_taken, twin, first, second):
            assert _decision_for(decisions, doc).finding is None

    @pytest.mark.parametrize(
        ("build", "code", "keys"),
        [
            pytest.param(_structural_case, "STRUCTURAL", {"message"}, id="STRUCTURAL"),
            pytest.param(
                _invalid_version_case, "INVALID_VERSION", {"message"}, id="INVALID_VERSION"
            ),
            pytest.param(
                _missing_function_case,
                "MISSING_FUNCTION_ID",
                {"block", "in_archive"},
                id="MISSING_FUNCTION_ID",
            ),
            pytest.param(
                _missing_version_case,
                "MISSING_FUNCTION_VERSION",
                {"block", "function_name", "version", "in_archive"},
                id="MISSING_FUNCTION_VERSION",
            ),
            pytest.param(_circular_case, "CIRCULAR", {"path"}, id="CIRCULAR"),
            pytest.param(_name_taken_case, "NAME_TAKEN", {"type"}, id="NAME_TAKEN"),
            pytest.param(_same_run_case, "SAME_RUN", {"type", "match"}, id="SAME_RUN"),
            pytest.param(_ambiguous_name_case, "AMBIGUOUS_NAME", {"type"}, id="AMBIGUOUS_NAME"),
            pytest.param(_clean_case, None, set(), id="no finding"),
        ],
    )
    def test_each_finding_is_a_code_and_its_parts(
        self, build: Callable[[], Case], code: str | None, keys: set[str]
    ) -> None:
        entries, choice, doc = build()

        decision = _decision_for(import_export.decide_entries(entries, choice), doc)

        if code is None:
            assert decision.finding is None
            return
        assert decision.status == "fatal"
        found_code, parts = decision.finding
        assert found_code == code
        assert keys <= set(parts)

    @pytest.mark.parametrize(
        ("match", "text"),
        [
            pytest.param("name", SAME_RUN_NAME_TEXT, id="the same name"),
            pytest.param("id", SAME_RUN_ID_TEXT, id="the same id"),
        ],
    )
    def test_two_entries_of_one_file_with_the_same_name_or_id_block_the_second_on_overwrite(
        self, match: str, text: str
    ) -> None:
        first = _export_doc(name="First", description="first")
        if match == "id":
            second = _export_doc(name="Second", id=first["id"], description="second")
        else:
            second = _export_doc(name="First", description="second")
        resolutions = {second["name"]: "overwrite"}

        decisions = import_export.decide_entries([first, second], _choices(resolutions))
        result = import_export.import_functions(
            _zip_bytes({"a.yaml": first, "b.yaml": second}), "functions.zip", resolutions
        )

        assert _decision_for(decisions, first).action == "create"
        blocked = _decision_for(decisions, second)
        assert (blocked.status, blocked.action) == ("fatal", "blocked")
        found_code, parts = blocked.finding
        assert found_code == "SAME_RUN"
        assert parts["match"] == match
        assert [(e["name"], e["action"]) for e in result["imported"]] == [("First", "created")]
        assert _names(result["skipped"]) == [second["name"]]
        assert re.fullmatch(text, result["skipped"][0]["reason"])
        stored, _etag = _storage.load_function(first["id"])
        assert stored["description"] == "first"

    def test_overwrite_is_blocked_when_several_library_entries_share_the_name(self) -> None:
        twin_ids = [str(uuid.uuid4()), str(uuid.uuid4())]
        for twin_id in twin_ids:
            _seed(twin_id, "Twins")
        incoming = _export_doc(name="Twins", version="2.0.0")
        resolutions = {"Twins": "overwrite"}

        (decision,) = import_export.decide_entries([incoming], _choices(resolutions))
        result = import_export.import_functions(_yaml_bytes(incoming), "twins.yaml", resolutions)

        assert (decision.status, decision.action) == ("fatal", "blocked")
        assert decision.finding[0] == "AMBIGUOUS_NAME"
        assert result["imported"] == []
        assert _names(result["skipped"]) == ["Twins"]
        assert re.fullmatch(AMBIGUOUS_NAME_TEXT, result["skipped"][0]["reason"])
        assert [_versions_of(twin_id) for twin_id in twin_ids] == [{"1.0.0"}, {"1.0.0"}]

    def test_the_entry_is_rewritten_through_the_full_id_map(self) -> None:
        collide_id = str(uuid.uuid4())
        _seed(collide_id, "Occupied")
        callee = _export_doc(name="DepFn", id=collide_id)
        deep = _export_doc(name="DeepFn", workflow=_deep_body(collide_id))
        versioned = _export_doc(
            name="VersionedFn", version="2.0.0", workflow=_body(_call_block(collide_id))
        )
        versioned["versions"] = [
            _version_record("2.0.0", _body(_call_block(collide_id))),
            _version_record("1.0.0", _body(_call_block(collide_id))),
        ]

        decisions = import_export.decide_entries(
            [deep, versioned, callee], _choices({"DepFn": "rename"})
        )

        new_id = _decision_for(decisions, callee).target_id
        assert isinstance(new_id, str)
        assert new_id not in {collide_id, deep["id"], versioned["id"]}
        rewritten = _decision_for(decisions, deep).entry
        assert _callee_places(rewritten["workflow"]) == _callee_places(_deep_body(new_id))
        records = _decision_for(decisions, versioned).entry["versions"]
        assert [
            record["definition"]["workflow"]["nodes"][0]["data"]["functionId"] for record in records
        ] == [new_id, new_id]

    @pytest.mark.parametrize("held", [True, False], ids=["held by the file", "not in the file"])
    @pytest.mark.parametrize("code", ["MISSING_FUNCTION_ID", "MISSING_FUNCTION_VERSION"])
    def test_a_missing_reference_finding_says_whether_the_file_holds_it(
        self, code: str, held: bool
    ) -> None:
        callee_id = str(uuid.uuid4())
        entries: list[dict[str, Any]] = []
        if code == "MISSING_FUNCTION_VERSION":
            _seed(callee_id, "Lib")
            if held:
                entries.append(_export_doc(name="Lib", id=callee_id, version="2.0.0"))
        elif held:
            entries.append(_export_doc(name="X" * 33, id=callee_id))
        caller = _export_doc(name="Caller", workflow=_body(_call_block(callee_id, version="2.0.0")))
        entries.append(caller)

        decisions = import_export.decide_entries(entries, _choices({}))

        found_code, parts = _decision_for(decisions, caller).finding
        assert found_code == code
        assert parts["in_archive"] is held

    def test_a_circle_is_named_by_function_names_and_keeps_an_id_where_no_name_is_known(
        self,
    ) -> None:
        a_id, nameless_id = str(uuid.uuid4()), str(uuid.uuid4())
        _seed(nameless_id, "", workflow=_body(_call_block(a_id)))
        entry = _export_doc(name="A", id=a_id, workflow=_body(_call_block(nameless_id)))

        (decision,) = import_export.decide_entries([entry], None)
        preview = import_export.validate_import(_yaml_bytes(entry), "a.yaml")

        found_code, parts = decision.finding
        assert found_code == "CIRCULAR"
        assert list(parts["path"]) == ["A", nameless_id, "A"]
        (error,) = preview["items"][0]["fatal_errors"]
        assert error["code"] == "CIRCULAR"
        assert re.fullmatch(
            CIRCULAR_TEXT.format(path=f"A -> {re.escape(nameless_id)} -> A"), error["message"]
        )

    def test_a_versions_list_that_holds_a_non_mapping_does_not_raise(self) -> None:
        collide_id = str(uuid.uuid4())
        _seed(collide_id, "Occupied")
        callee = _export_doc(name="DepFn", id=collide_id)
        mixed = _export_doc(name="Mixed", version="2.0.0")
        mixed["versions"] = [
            "not a record",
            _version_record("2.0.0", _body(_call_block(collide_id))),
        ]
        bare = _export_doc(name="Bare", workflow=_body(_call_block(str(uuid.uuid4()))))
        bare["versions"] = ["not a record"]

        decisions = import_export.decide_entries([mixed, callee], _choices({"DepFn": "rename"}))
        (alone,) = import_export.decide_entries([bare], None)

        new_id = _decision_for(decisions, callee).target_id
        assert new_id != collide_id
        decided = _decision_for(decisions, mixed)
        assert decided.action == "create"
        kept, record = decided.entry["versions"]
        assert kept == "not a record"
        assert record["definition"]["workflow"]["nodes"][0]["data"]["functionId"] == new_id
        assert alone.finding[0] == "MISSING_FUNCTION_ID"


# ---------------------------------------------------------------------------
# commit_decisions: one outcome per entry
# ---------------------------------------------------------------------------


class TestCommitDecisions:
    def test_entries_are_written_dependency_first(self, monkeypatch: pytest.MonkeyPatch) -> None:
        callee = _export_doc(name="Callee")
        caller = _export_doc(name="Caller", workflow=_body(_call_block(callee["id"])))
        written: list[str] = []
        _wrap_savers(monkeypatch, written.append)

        import_export.commit_decisions(import_export.decide_entries([caller, callee], _choices({})))

        assert set(written) == {callee["id"], caller["id"]}
        assert written.index(callee["id"]) < written.index(caller["id"])

    def test_an_outcome_carries_the_pinned_fields(self) -> None:
        held_id, kept_id, stays_id = (str(uuid.uuid4()) for _ in range(3))
        _seed(held_id, "Held")
        _seed(kept_id, "Kept")
        _seed(stays_id, "Stays")
        fresh = _export_doc(name="Fresh")
        update = _export_doc(name="Held", id=held_id, version="2.0.0")
        renamed = _export_doc(name="Kept")
        left = _export_doc(name="Other name", id=stays_id)
        decisions = import_export.decide_entries(
            [fresh, update, renamed, left], _choices({"Held": "overwrite", "Kept": "rename"})
        )

        outcomes = import_export.commit_decisions(decisions)

        assert len(outcomes) == 4
        assert all(hasattr(outcome, "reason") for outcome in outcomes)
        assert _written(_outcome_for(outcomes, fresh)) == ("created", fresh["id"], "Fresh")
        assert _written(_outcome_for(outcomes, update)) == ("overwritten", held_id, "Held")
        assert _written(_outcome_for(outcomes, renamed)) == ("renamed", renamed["id"], "Kept (2)")
        assert _outcome_for(outcomes, left).action == "skipped"
        stored, _etag = _storage.load_function(renamed["id"])
        assert stored["name"] == "Kept (2)"
        assert _versions_of(held_id) == {"1.0.0", "2.0.0"}
        assert _versions_of(stays_id) == {"1.0.0"}

    def test_one_failing_entry_does_not_stop_the_others(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        bad = _export_doc(name="Bad")
        good = _export_doc(name="Good")
        decisions = import_export.decide_entries([bad, good], _choices({}))
        _wrap_savers(monkeypatch, _fail_writes_of({bad["id"]}))

        outcomes = import_export.commit_decisions(decisions)

        failed = _outcome_for(outcomes, bad)
        assert failed.action == "failed"
        assert failed.reason == WRITE_ERROR
        assert _outcome_for(outcomes, good).action == "created"
        stored, _etag = _storage.load_function(good["id"])
        assert stored["name"] == "Good"

    def test_an_entry_it_was_creating_that_fails_leaves_nothing_behind(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        held_id = str(uuid.uuid4())
        _seed(held_id, "Held")
        brand_new = _export_doc(name="Brand new")
        update = _export_doc(name="Held", id=held_id, version="2.0.0")
        decisions = import_export.decide_entries(
            [brand_new, update], _choices({"Held": "overwrite"})
        )
        _wrap_savers(monkeypatch, _fail_writes_of({brand_new["id"], held_id}))

        outcomes = import_export.commit_decisions(decisions)

        assert _outcome_for(outcomes, brand_new).action == "failed"
        assert _outcome_for(outcomes, update).action == "failed"
        root = get_functions_storage_path()
        assert not (root / brand_new["id"]).exists()
        assert (root / held_id).is_dir()
        stored, _etag = _storage.load_function(held_id)
        assert stored["name"] == "Held"
        assert "1.0.0" in stored["available_versions"]


# ---------------------------------------------------------------------------
# The file-upload entry points
# ---------------------------------------------------------------------------


class TestUploadEntryPoints:
    def test_validate_import_and_import_functions_keep_their_wire_shapes(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        held_id = str(uuid.uuid4())
        _seed(held_id, "Held")
        fresh = _export_doc(name="Fresh")
        payload = _zip_bytes({"a.yaml": fresh, "b.yaml": _export_doc(name="Held", id=held_id)})
        real_decide = import_export.decide_entries
        real_commit = import_export.commit_decisions
        choices: list[Any] = []
        commits: list[int] = []

        def decide(entries: list[dict[str, Any]], resolution_for: Choice | None) -> list[Any]:
            choices.append(resolution_for)
            return real_decide(entries, resolution_for)

        def commit(decisions: list[Any]) -> list[Any]:
            commits.append(len(decisions))
            return real_commit(decisions)

        monkeypatch.setattr(import_export, "decide_entries", decide)
        monkeypatch.setattr(import_export, "commit_decisions", commit)

        preview = import_export.validate_import(payload, "functions.zip")

        assert choices == [None]
        assert commits == []
        assert set(preview) == PREVIEW_KEYS
        assert (preview["total"], preview["importable"], preview["blocked"]) == (2, 2, 0)
        items = {item["name"]: item for item in preview["items"]}
        assert ITEM_KEYS <= set(items["Fresh"]) <= ITEM_KEYS | {"conflict_reason"}
        assert items["Fresh"]["status"] == "ok"
        assert items["Fresh"]["existing_id"] is None
        assert set(items["Held"]) == ITEM_KEYS | {"conflict_reason"}
        assert items["Held"]["status"] == "conflict"
        assert items["Held"]["existing_id"] == held_id
        assert items["Held"]["conflict_reason"] == "both"

        result = import_export.import_functions(payload, "functions.zip", {"Held": "overwrite"})

        assert choices[1]("Held") == "overwrite"
        assert len(commits) == 1
        assert set(result) == RESULT_KEYS
        assert sorted(result["imported"], key=lambda entry: entry["name"]) == [
            {"name": "Fresh", "id": fresh["id"], "action": "created"},
            {"name": "Held", "id": held_id, "action": "overwritten"},
        ]
        assert result["skipped"] == []
        assert result["fixes_applied"] == []
        assert (result["total_imported"], result["total_skipped"]) == (2, 0)

        again = import_export.import_functions(payload, "functions.zip")

        assert again["imported"] == []
        assert again["total_skipped"] == 2
        assert all(set(entry) == {"name", "reason"} for entry in again["skipped"])
        reasons = {entry["name"]: entry["reason"] for entry in again["skipped"]}
        assert re.fullmatch(UUID_EXISTS_TEXT.format(id=re.escape(held_id)), reasons["Held"])
        assert re.fullmatch(UUID_EXISTS_TEXT.format(id=re.escape(fresh["id"])), reasons["Fresh"])


pytestmark = pytest.mark.usefixtures("temp_storage_path")
