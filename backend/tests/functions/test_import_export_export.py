"""Tests for the Function export endpoints (REQ-3.1.2.5).

Contract (mirrors the Tests/Suites per-feature export pattern):

- POST /functions/export  {ids: [...], format: "yaml"|"json"}
    - 1 id  -> a single file (Content-Disposition attachment)
    - 2+ ids -> a ZIP archive, one entry per Function, entries written in
      dependency-first (topological) order so a fresh import re-creates a
      runnable graph.
- GET /functions/{id}/export?format=yaml|json -> a single file.

Anchored error strings:
    ^Invalid export format '<fmt>'; must be 'yaml' or 'json'$
    ^One or more Functions not found: <ids>$
    ^Function '<id>' not found$
"""

import io
import json
import re
import uuid
import zipfile
from typing import Any
from unittest.mock import patch

import pytest
import yaml
from fastapi.testclient import TestClient

from tests.api.body_shape_support import NOT_ID_LIST_FIELDS, assert_refused
from tests.api.download_name_helpers import ENTITY_NAME, EXPORT_STEM, assert_whole_name
from wavecore.api.exceptions import ConflictException
from wavecore.api.services.functions import import_export
from wavecore.core.secrets.cipher import SecretCipher, is_secret_envelope
from wavecore.core.secrets.masking import MASK_PLACEHOLDER
from wavecore.core.secrets.sealing import seal_value

from .conftest import make_function_payload

_DECRYPTION_FAILED_MESSAGE = (
    "Secret decryption failed: ciphertext is corrupt or the encryption key is invalid"
)


def _sealed_secret_variables() -> list[dict[str, Any]]:
    """A Function's local variables: one locally-sealed secret and one plain variable."""
    return [
        {"name": "api_key", "type": "string", "value": seal_value("sk-classified"), "secret": True},
        {"name": "host", "type": "string", "value": "example.com"},
    ]


def _named(variables: list[dict[str, Any]], name: str) -> dict[str, Any]:
    """The one local variable called ``name``."""
    (variable,) = [variable for variable in variables if variable["name"] == name]
    return variable


def _foreign_envelope(value: Any) -> str:
    """Seal a value under a key this instance does not hold (undecryptable here)."""
    return SecretCipher(bytes(range(1, 33))).seal(value)


BAD_FORMAT_RE = re.compile(r"^Invalid export format '.+'; must be 'yaml' or 'json'$")
BATCH_NOT_FOUND_RE = re.compile(r"^One or more Functions not found: .+$")
NOT_FOUND_RE = re.compile(r"^Function '.+' not found$")


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


def _create(client: TestClient, **overrides) -> str:
    """Create a published Function and return its id."""
    response = client.post("/functions", json=make_function_payload(**overrides))
    assert response.status_code == 201, response.text
    return response.json()["data"]["id"]


def _zip_names(content: bytes) -> list[str]:
    """Return ZIP member names in archive (insertion) order."""
    with zipfile.ZipFile(io.BytesIO(content)) as zf:
        return zf.namelist()


def _body_calling(*function_ids: str) -> dict[str, Any]:
    """A body that calls each library Function in turn, wired from the start block."""
    nodes = [
        {
            "id": f"node-call-{position}",
            "type": "workflowNode",
            "position": {"x": 0, "y": 0},
            "data": {
                "label": f"Call {position}",
                "elementType": "function",
                "nodeType": "function",
                "functionLifecycle": "shared",
                "functionId": function_id,
                "functionVersion": "1.0.0",
                "config": {"values": {}, "outputBindings": {}, "profileBindings": []},
            },
        }
        for position, function_id in enumerate(function_ids)
    ]
    sources = ["start-node", *(node["id"] for node in nodes)]
    edges = [
        {"id": f"edge-{position}", "source": source, "target": node["id"]}
        for position, (source, node) in enumerate(zip(sources, nodes, strict=False))
    ]
    return {"nodes": nodes, "edges": edges}


# ---------------------------------------------------------------------------
# GET /functions/{id}/export (single)
# ---------------------------------------------------------------------------


class TestSingleExport:
    def test_yaml_export_default(self, client: TestClient) -> None:
        fn_id = _create(client, name="exportable_yaml")
        response = client.get(f"/functions/{fn_id}/export")
        assert response.status_code == 200
        ctype = response.headers["content-type"]
        assert ctype.startswith("application/x-yaml") or ctype.startswith("application/yaml")
        cd = response.headers["content-disposition"]
        assert "attachment" in cd
        assert ".yaml" in cd
        parsed = yaml.safe_load(response.content)
        assert parsed["name"] == "exportable_yaml"

    def test_json_export(self, client: TestClient) -> None:
        fn_id = _create(client, name="exportable_json")
        response = client.get(f"/functions/{fn_id}/export?format=json")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/json")
        parsed = json.loads(response.content)
        assert parsed["name"] == "exportable_json"

    def test_bad_format_returns_400(self, client: TestClient) -> None:
        fn_id = _create(client, name="exportable_bad_fmt")
        response = client.get(f"/functions/{fn_id}/export?format=xml")
        assert response.status_code == 400
        assert any(BAD_FORMAT_RE.match(m) for m in _all_error_messages(response.json()))

    def test_export_missing_returns_404(self, client: TestClient) -> None:
        missing_id = str(uuid.uuid4())
        response = client.get(f"/functions/{missing_id}/export")
        assert response.status_code == 404
        assert any(NOT_FOUND_RE.match(m) for m in _all_error_messages(response.json()))

    def test_invalid_secrets_mode_returns_400(self, client: TestClient) -> None:
        fn_id = _create(client, name="mode_fn")
        response = client.get(f"/functions/{fn_id}/export?secrets=bogus")
        assert response.status_code == 400
        assert (
            "Invalid secrets mode 'bogus'; must be 'mask', 'encrypted', or 'plaintext'"
            in response.text
        )


# ---------------------------------------------------------------------------
# Secrets mode transform: definition variables AND version-history entries
# ---------------------------------------------------------------------------


class TestExportSecretsModes:
    def _definition(self, variables: list[dict[str, Any]]) -> dict[str, Any]:
        return {
            "id": "fn-secret",
            "name": "secret_fn",
            "version": "2.0.0",
            "inputs": [],
            "outputs": [],
            "dependencies": {"functions": [], "plugins": []},
            "workflow": {"nodes": [], "edges": []},
            "variables": variables,
        }

    def _version_records(self, variables: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [
            {
                "version": "1.0.0",
                "definition": {
                    "name": "secret_fn",
                    "inputs": [],
                    "outputs": [],
                    "variables": variables,
                },
                "metadata": {},
            }
        ]

    def _export(self, variables: list[dict[str, Any]], **kwargs: Any) -> dict[str, Any]:
        with (
            patch.object(
                import_export._storage,
                "load_function",
                return_value=(self._definition(variables), "etag"),
            ),
            patch.object(
                import_export._storage,
                "list_version_records",
                return_value=self._version_records(variables),
            ),
        ):
            body, _filename, _ctype = import_export.export_function("fn-secret", **kwargs)
        return yaml.safe_load(body)

    def test_default_mode_is_mask(self) -> None:
        doc = self._export(_sealed_secret_variables(), fmt="yaml")

        assert _named(doc["variables"], "api_key")["value"] == MASK_PLACEHOLDER

    def test_mask_mode_masks_definition_and_versions(self) -> None:
        doc = self._export(_sealed_secret_variables(), fmt="yaml", secrets="mask")

        assert _named(doc["variables"], "api_key")["value"] == MASK_PLACEHOLDER
        assert _named(doc["variables"], "api_key")["masked"] is True
        assert _named(doc["variables"], "host")["value"] == "example.com"
        version_vars = doc["versions"][0]["definition"]["variables"]
        assert _named(version_vars, "api_key")["value"] == MASK_PLACEHOLDER

    def test_encrypted_mode_emits_envelopes_in_definition_and_versions(self) -> None:
        variables = _sealed_secret_variables()
        doc = self._export(variables, fmt="yaml", secrets="encrypted")

        sealed = _named(variables, "api_key")["value"]
        assert _named(doc["variables"], "api_key")["value"] == sealed
        assert is_secret_envelope(_named(doc["variables"], "api_key")["value"])
        version_vars = doc["versions"][0]["definition"]["variables"]
        assert is_secret_envelope(_named(version_vars, "api_key")["value"])

    def test_plaintext_mode_decrypts_definition_and_versions(self) -> None:
        doc = self._export(_sealed_secret_variables(), fmt="yaml", secrets="plaintext")

        assert _named(doc["variables"], "api_key")["value"] == "sk-classified"
        version_vars = doc["versions"][0]["definition"]["variables"]
        assert _named(version_vars, "api_key")["value"] == "sk-classified"

    def test_plaintext_undecryptable_raises_conflict(self) -> None:
        variables = [
            {"name": "api_key", "type": "string", "value": _foreign_envelope("x"), "secret": True}
        ]

        with (
            patch.object(
                import_export._storage,
                "load_function",
                return_value=(self._definition(variables), "etag"),
            ),
            patch.object(
                import_export._storage,
                "list_version_records",
                return_value=self._version_records(variables),
            ),
            pytest.raises(ConflictException) as exc_info,
        ):
            import_export.export_function("fn-secret", fmt="yaml", secrets="plaintext")

        assert str(exc_info.value) == _DECRYPTION_FAILED_MESSAGE

    def test_version_without_variables_or_workflow_passes_through(self) -> None:
        variables = _sealed_secret_variables()
        bare_versions = [{"version": "1.0.0", "definition": {"name": "secret_fn"}, "metadata": {}}]
        with (
            patch.object(
                import_export._storage,
                "load_function",
                return_value=(self._definition(variables), "etag"),
            ),
            patch.object(
                import_export._storage,
                "list_version_records",
                return_value=bare_versions,
            ),
        ):
            body, _filename, _ctype = import_export.export_function(
                "fn-secret", fmt="yaml", secrets="mask"
            )
        doc = yaml.safe_load(body)
        # The bare version definition survives untouched (no variables/workflow).
        assert doc["versions"][0]["definition"] == {"name": "secret_fn"}


_LOCAL_SECRET = "fn-local-sk-classified"
_OUTPUT_SECRET = "fn-output-default-classified"


class TestExportSecretsModesOnFunctionLocals:
    """A Function's local variables are a list; each secret one follows the export
    secrets mode in the definition and every version (REQ-3.1.2.5, REQ-5.2.4.9)."""

    @staticmethod
    def _body() -> dict[str, Any]:
        return {
            "inputs": [],
            "outputs": [
                {
                    "name": "out_tok",
                    "type": "string",
                    "secret": True,
                    "default": seal_value(_OUTPUT_SECRET),
                }
            ],
            "variables": [
                {
                    "name": "api_key",
                    "type": "string",
                    "value": seal_value(_LOCAL_SECRET),
                    "secret": True,
                },
                {"name": "host", "type": "string", "value": "example.com"},
            ],
            "workflow": {"nodes": [], "edges": []},
        }

    def _export(self, body: dict[str, Any], secrets: str) -> tuple[str, dict[str, Any]]:
        definition = {
            "id": "fn-secret",
            "name": "secret_fn",
            "version": "1.0.0",
            "dependencies": {"functions": [], "plugins": []},
            **body,
        }
        records = [{"version": "1.0.0", "definition": body, "metadata": {}}]
        with (
            patch.object(
                import_export._storage, "load_function", return_value=(definition, "etag")
            ),
            patch.object(import_export._storage, "list_version_records", return_value=records),
        ):
            raw, _filename, _ctype = import_export.export_function(
                "fn-secret", fmt="yaml", secrets=secrets
            )
        text = raw.decode("utf-8") if isinstance(raw, bytes) else raw
        return text, yaml.safe_load(text)

    @staticmethod
    def _local_lists(doc: dict[str, Any]) -> list[list[dict[str, Any]]]:
        return [doc["variables"], doc["versions"][0]["definition"]["variables"]]

    def test_mask_mode_masks_each_secret_local(self) -> None:
        body = self._body()

        text, doc = self._export(body, "mask")

        for variables in self._local_lists(doc):
            assert variables[0]["name"] == "api_key"
            assert variables[0]["value"] == MASK_PLACEHOLDER
            assert variables[1] == {"name": "host", "type": "string", "value": "example.com"}
        assert body["variables"][0]["value"] not in text

    def test_encrypted_mode_keeps_each_secret_local_sealed(self) -> None:
        body = self._body()

        _text, doc = self._export(body, "encrypted")

        for variables in self._local_lists(doc):
            assert variables[0]["value"] == body["variables"][0]["value"]
            assert is_secret_envelope(variables[0]["value"])
            assert variables[1] == {"name": "host", "type": "string", "value": "example.com"}

    def test_plaintext_mode_unseals_each_secret_local(self) -> None:
        _text, doc = self._export(self._body(), "plaintext")

        for variables in self._local_lists(doc):
            assert variables[0]["value"] == _LOCAL_SECRET
            assert variables[1] == {"name": "host", "type": "string", "value": "example.com"}

    def test_mask_mode_masks_a_secret_output_default(self) -> None:
        _text, doc = self._export(self._body(), "mask")

        assert doc["outputs"][0]["default"] == MASK_PLACEHOLDER
        assert doc["versions"][0]["definition"]["outputs"][0]["default"] == MASK_PLACEHOLDER


# ---------------------------------------------------------------------------
# function_export_document: one Function, every version, one secrets mode
# ---------------------------------------------------------------------------


class TestFunctionExportDocument:
    @pytest.mark.parametrize("mode", ["mask", "encrypted", "plaintext"])
    def test_the_document_holds_every_version_under_each_secrets_mode(
        self, mode: str, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        variables = _sealed_secret_variables()
        definition = {
            "id": "fn-secret",
            "name": "secret_fn",
            "version": "2.0.0",
            "inputs": [],
            "outputs": [],
            "dependencies": {"functions": [], "plugins": []},
            "workflow": {"nodes": [], "edges": []},
            "variables": variables,
        }
        records = [
            {"version": version, "definition": {"variables": variables}, "metadata": {}}
            for version in ("2.0.0", "1.0.0")
        ]
        monkeypatch.setattr(import_export._storage, "load_function", lambda _id: (definition, "e"))
        monkeypatch.setattr(import_export._storage, "list_version_records", lambda _id: records)
        expected = {
            "mask": MASK_PLACEHOLDER,
            "encrypted": _named(variables, "api_key")["value"],
            "plaintext": "sk-classified",
        }[mode]

        document = import_export.function_export_document("fn-secret", mode)

        assert [record["version"] for record in document["versions"]] == ["2.0.0", "1.0.0"]
        assert _named(document["variables"], "api_key")["value"] == expected
        assert [
            _named(record["definition"]["variables"], "api_key")["value"]
            for record in document["versions"]
        ] == [expected, expected]

        calls: list[tuple[str, str]] = []

        def marked(function_id: str, secrets: str) -> dict[str, Any]:
            calls.append((function_id, secrets))
            return {"name": "secret_fn", "marker": "from the helper"}

        monkeypatch.setattr(import_export, "function_export_document", marked)
        single, _filename, _ctype = import_export.export_function(
            "fn-secret", fmt="yaml", secrets=mode
        )
        ((_fn_id, batch, _batch_filename),) = import_export.export_functions_batch(
            ["fn-secret"], fmt="yaml", secrets=mode
        )

        assert calls == [("fn-secret", mode), ("fn-secret", mode)]
        assert yaml.safe_load(single) == {"name": "secret_fn", "marker": "from the helper"}
        assert yaml.safe_load(batch) == {"name": "secret_fn", "marker": "from the helper"}


# ---------------------------------------------------------------------------
# POST /functions/export - single id => single file
# ---------------------------------------------------------------------------


class TestBatchExportSingle:
    def test_one_id_returns_single_yaml_file_not_zip(self, client: TestClient) -> None:
        fn_id = _create(client, name="solo_yaml")
        response = client.post("/functions/export", json={"ids": [fn_id], "format": "yaml"})
        assert response.status_code == 200
        ctype = response.headers["content-type"]
        assert "zip" not in ctype
        assert ctype.startswith("application/x-yaml") or ctype.startswith("application/yaml")
        cd = response.headers["content-disposition"]
        assert "attachment" in cd
        parsed = yaml.safe_load(response.content)
        # A single-id export is the bare definition document, not a list.
        assert isinstance(parsed, dict)
        assert parsed["name"] == "solo_yaml"

    def test_one_id_returns_single_json_file(self, client: TestClient) -> None:
        fn_id = _create(client, name="solo_json")
        response = client.post("/functions/export", json={"ids": [fn_id], "format": "json"})
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/json")
        parsed = json.loads(response.content)
        assert isinstance(parsed, dict)
        assert parsed["name"] == "solo_json"


# ---------------------------------------------------------------------------
# POST /functions/export - 2+ ids => ZIP archive
# ---------------------------------------------------------------------------


class TestBatchExportZip:
    def test_two_ids_returns_zip_with_one_entry_each(self, client: TestClient) -> None:
        a_id = _create(client, name="zip_a")
        b_id = _create(client, name="zip_b")
        response = client.post("/functions/export", json={"ids": [a_id, b_id], "format": "yaml"})
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/zip")
        assert "attachment" in response.headers["content-disposition"]
        names = _zip_names(response.content)
        assert len(names) == 2
        assert "zip_a.yaml" in names
        assert "zip_b.yaml" in names

    def test_zip_json_uses_json_extension(self, client: TestClient) -> None:
        a_id = _create(client, name="zj_a")
        b_id = _create(client, name="zj_b")
        response = client.post("/functions/export", json={"ids": [a_id, b_id], "format": "json"})
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/zip")
        names = _zip_names(response.content)
        assert sorted(names) == ["zj_a.json", "zj_b.json"]

    def test_zip_entries_in_dependency_first_order(self, client: TestClient) -> None:
        """Dependencies must be written before their dependents.

        Graph: A's body calls (B, C); B's body calls D; C's body calls D.
        A valid topological order is [D, B, C, A] or [D, C, B, A].
        """
        d_id = _create(client, name="topo_d")
        b_id = _create(client, name="topo_b", workflow=_body_calling(d_id))
        c_id = _create(client, name="topo_c", workflow=_body_calling(d_id))
        a_id = _create(client, name="topo_a", workflow=_body_calling(b_id, c_id))

        response = client.post(
            "/functions/export",
            json={"ids": [a_id, b_id, c_id, d_id], "format": "yaml"},
        )
        assert response.status_code == 200
        names = _zip_names(response.content)
        order = {name: idx for idx, name in enumerate(names)}
        assert order["topo_d.yaml"] < order["topo_b.yaml"]
        assert order["topo_d.yaml"] < order["topo_c.yaml"]
        assert order["topo_b.yaml"] < order["topo_a.yaml"]
        assert order["topo_c.yaml"] < order["topo_a.yaml"]

    def test_zip_entry_is_a_single_definition_document(self, client: TestClient) -> None:
        a_id = _create(client, name="zdoc_a")
        b_id = _create(client, name="zdoc_b")
        response = client.post("/functions/export", json={"ids": [a_id, b_id], "format": "yaml"})
        with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
            doc = yaml.safe_load(zf.read("zdoc_a.yaml"))
        assert isinstance(doc, dict)
        assert doc["name"] == "zdoc_a"


# ---------------------------------------------------------------------------
# POST /functions/export - error paths
# ---------------------------------------------------------------------------


class TestBatchExportErrors:
    def test_bad_format_returns_400(self, client: TestClient) -> None:
        fn_id = _create(client, name="batch_bad_fmt")
        response = client.post("/functions/export", json={"ids": [fn_id], "format": "xml"})
        assert response.status_code == 400
        assert any(BAD_FORMAT_RE.match(m) for m in _all_error_messages(response.json()))

    def test_missing_id_returns_404(self, client: TestClient) -> None:
        missing_id = str(uuid.uuid4())
        response = client.post("/functions/export", json={"ids": [missing_id], "format": "yaml"})
        assert response.status_code == 404
        assert any(BATCH_NOT_FOUND_RE.match(m) for m in _all_error_messages(response.json()))

    def test_partial_missing_lists_every_missing_id(self, client: TestClient) -> None:
        good_id = _create(client, name="batch_good")
        missing_1 = str(uuid.uuid4())
        missing_2 = str(uuid.uuid4())
        response = client.post(
            "/functions/export",
            json={"ids": [good_id, missing_1, missing_2], "format": "yaml"},
        )
        assert response.status_code == 404
        message = _all_error_messages(response.json())[0]
        assert missing_1 in message
        assert missing_2 in message

    def test_empty_ids_returns_400(self, client: TestClient) -> None:
        response = client.post("/functions/export", json={"ids": [], "format": "yaml"})
        assert response.status_code == 400

    @pytest.mark.parametrize("ids", NOT_ID_LIST_FIELDS)
    def test_ids_that_are_not_a_list_of_strings_are_refused(
        self, client: TestClient, ids: Any
    ) -> None:
        response = client.post("/functions/export", json={"ids": ids, "format": "yaml"})

        assert_refused(response, "'ids' must be a list of ID strings")


class TestBatchExportFilenameCollision:
    def test_duplicate_names_get_a_numeric_suffix(self) -> None:
        # Two library Functions sharing a name (seeded directly, bypassing the
        # create-time uniqueness check) must export to distinct filenames.
        metadata = {
            "description": "",
            "tags": [],
            "changelog": "",
            "details": "",
            "published_at": "",
            "published_by": "wave",
        }
        for fid in ("dup-a", "dup-b"):
            definition = import_export._build_definition(
                make_function_payload(name="Twins"), fid, "Twins"
            )
            import_export._storage.save_new_version(
                fid, "1.0.0", definition, metadata, name="Twins"
            )
        results = import_export.export_functions_batch(["dup-a", "dup-b"])
        filenames = sorted(fname for _fid, _body, fname in results)
        assert "Twins.yaml" in filenames
        assert any(fname.startswith("Twins-2.") for fname in filenames)


pytestmark = pytest.mark.usefixtures("temp_storage_path")


class TestExportKeepsTheWholeFileName:
    """A Function named with text outside plain ASCII exports under its whole name (REQ-4.6.9)."""

    def test_single_export(self, client: TestClient) -> None:
        fn_id = _create(client, name=ENTITY_NAME)

        response = client.get(f"/functions/{fn_id}/export")

        assert_whole_name(response, f"{EXPORT_STEM}.yaml")

    def test_bulk_export_of_one(self, client: TestClient) -> None:
        fn_id = _create(client, name=ENTITY_NAME)

        response = client.post("/functions/export", json={"ids": [fn_id], "format": "yaml"})

        assert_whole_name(response, f"{EXPORT_STEM}.yaml")
