"""Save-validation header key policy + Remote-Execution rules.

`_validate_test_data` carries a plugin-metadata-driven header-rule pass plus
HTTP-node value rules, with exact design-time messages:

- `Duplicate header "<key>" (header names are case-insensitive)` - for later
  rows duplicating an earlier one AND for rows colliding with a header the
  saved config generates at send time (Auth section; body_auto_headers +
  mode-implied Content-Type; multipart ALWAYS generates - the checkbox is
  forced). Key rendered as typed.
- `Header "Content-Length" cannot be set manually - the HTTP stack blocks
  length overrides` (canonical casing regardless of typed casing;
  Transfer-Encoding rows are allowed - the transport arbitrates)

Nodes inside a Remote Execution body (membership known design-time via the
body handle) additionally reject the HTTP capabilities the remote worker does
not support (code REMOTE_UNSUPPORTED). A WAVE-side path scheme on a remote-host
block is not a save-time finding: the remote host refuses it at run time.

The HTTP block's proxy choice has no save-time rule (REQ-3.4.3.9): the block
holds no proxy address, and inside a Remote Execution body the request uses
the remote host's own proxy settings, so no stored choice is a finding there.
"""

import re
from typing import Any

import pytest

from wavecore.api.services.tests import service as test_service

DUP_MESSAGE = 'Duplicate header "x-token" (header names are case-insensitive)'
BLOCKED_CL = (
    'Header "Content-Length" cannot be set manually - the HTTP stack blocks length overrides'
)


def _dup(key: str) -> str:
    return f'Duplicate header "{key}" (header names are case-insensitive)'


REMOTE_SUFFIX = "not supported inside Remote Execution"
REMOTE_FORM = f'Body mode "Form (URL-encoded)" is {REMOTE_SUFFIX}'
REMOTE_MULTIPART = f'Body mode "Multipart (form-data)" is {REMOTE_SUFFIX}'
REMOTE_FILE_BODY = f'Body mode "File" is {REMOTE_SUFFIX}'
REMOTE_FILE_RESPONSE = f'Response mode "file" is {REMOTE_SUFFIX}'
REMOTE_MAX_SIZE = f"Max Size is {REMOTE_SUFFIX}"
TLS_MIN_MAX = "Min TLS Version cannot exceed Max TLS Version"


def _unknown_cipher(name: str) -> str:
    return f'Unknown cipher suite "{name}"'


def _catalog_cipher_row() -> dict[str, Any]:
    """First TLS 1.2 catalog row (fixed, host-independent) carrying an IANA name."""
    from wavecore.connectivity import tls_capabilities

    for row in tls_capabilities.catalog():
        if row["min_version"] != "1.3":
            return dict(row)
    raise AssertionError("no <=1.2 cipher row in the catalog")


@pytest.fixture(autouse=True)
def _registered_plugins() -> Any:
    """Header rules are metadata-driven: the plugin registry must be primed."""
    from wavecore.controls.registry import _registry, register_all_core_controls
    from wavecore.core.plugin_registry import clear_registry, register_plugin
    from wavecore.plugins.file_io import FileIOPlugin
    from wavecore.plugins.http_client import HTTPClientPlugin
    from wavecore.plugins.k8s_connect import K8sConnectPlugin
    from wavecore.plugins.k8s_copy import K8sCopyPlugin
    from wavecore.plugins.log import LogPlugin

    test_service._clear_storage()
    _registry.clear()
    register_all_core_controls(_registry)
    clear_registry()
    register_plugin(HTTPClientPlugin())
    register_plugin(K8sConnectPlugin())
    register_plugin(K8sCopyPlugin())
    register_plugin(FileIOPlugin())
    register_plugin(LogPlugin())
    yield
    clear_registry()


def _out_of_range(name: str, minimum: str, maximum: str) -> str:
    return f'Cipher suite "{name}" is not available in TLS {minimum} to {maximum}'


def _k8s_connect_node(values: dict[str, Any], node_id: str = "k8s-1") -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "position": {"x": 100, "y": 200},
        "data": {
            "elementType": "k8s-connect",
            "nodeType": "plugin",
            "version": "1.0.0",
            "label": "Connect",
            "config": {"values": {"api_url": "https://k8s.example:6443", **values}},
        },
    }


def _tls_node(block: str, values: dict[str, Any]) -> dict[str, Any]:
    """An HTTP Request or K8s Connect Block holding the given TLS rows."""
    if block == "k8s-connect":
        return _k8s_connect_node(values)
    return _http_node(values={"method": "GET", "url": "https://example.com", **values})


def _cipher_findings(result: dict[str, Any], code: str) -> list[dict[str, Any]]:
    return [e for e in result["errors"] if e["code"] == code]


def _http_node(
    node_id: str = "http-1",
    values: dict[str, Any] | None = None,
    label: str = "HTTP Call",
) -> dict[str, Any]:
    if values is None:
        values = {"method": "GET", "url": "http://example.com"}
    return {
        "id": node_id,
        "type": "workflowNode",
        "position": {"x": 100, "y": 200},
        "data": {
            "elementType": "http-client",
            "nodeType": "plugin",
            "version": "1.0.0",
            "label": label,
            "config": {"values": values},
        },
    }


def _test_data(
    nodes: list[dict[str, Any]], edges: list[dict[str, Any]] | None = None
) -> dict[str, Any]:
    if edges is None:
        edges = [{"id": "e1", "source": "start-node", "target": nodes[0]["id"]}]
    return {
        "name": "Header Rules Test",
        "workflow": {"nodes": nodes, "edges": edges},
        "variables": {},
    }


def _messages(result: dict[str, Any]) -> list[str]:
    return [e["message"] for e in result.get("errors", [])]


def _remote_body(body: dict[str, Any]) -> dict[str, Any]:
    """Wrap one plugin node inside a Remote Execution body sub-flow."""
    rex = {
        "id": "rex-1",
        "type": "workflowNode",
        "position": {"x": 0, "y": 0},
        "data": {
            "elementType": "remote-execution",
            "nodeType": "plugin",
            "version": "1.0.0",
            "label": "Remote Execution",
            "config": {"values": {"session_id": "s"}},
        },
    }
    return {
        "name": "Remote Body Test",
        "workflow": {
            "nodes": [rex, body],
            "edges": [
                {"id": "e1", "source": "start-node", "target": "rex-1"},
                {"id": "e2", "source": "rex-1", "target": body["id"], "sourceHandle": "body"},
            ],
        },
        "variables": {},
    }


def _remote_wrapped(http_values: dict[str, Any]) -> dict[str, Any]:
    """Wrap an http-client node inside a Remote Execution body sub-flow."""
    return _remote_body(_http_node(node_id="http-body", values=http_values, label="Remote HTTP"))


def _copy_node(
    values: dict[str, Any] | None = None,
    node_id: str = "copy-body",
    label: str = "Copy Files",
) -> dict[str, Any]:
    """A complete K8s Copy node whose two path values default to host paths."""
    config = {
        "session": "sess",
        "direction": "to_pod",
        "pod": "api-0",
        "container": "app",
        "source_path": "/host/in.bin",
        "target_path": "/pod/out.bin",
        **(values or {}),
    }
    return {
        "id": node_id,
        "type": "workflowNode",
        "position": {"x": 300, "y": 200},
        "data": {
            "elementType": "k8s-copy",
            "nodeType": "plugin",
            "version": "1.0.0",
            "label": label,
            "config": {"values": config},
        },
    }


def _node_errors(result: dict[str, Any], node_id: str) -> list[dict[str, Any]]:
    return [e for e in result.get("errors", []) if e.get("node_id") == node_id]


def _proxy_url_findings(errors: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Findings that ask for a Proxy URL, by code or by wording."""
    return [e for e in errors if e["code"] == "PROXY_URL_REQUIRED" or "Proxy URL" in e["message"]]


def _file_io_node(values: dict[str, Any], node_id: str = "fio-body") -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "position": {"x": 300, "y": 200},
        "data": {
            "elementType": "file-io",
            "nodeType": "plugin",
            "version": "1.0.0",
            "label": "Read Orders",
            "config": {"values": values},
        },
    }


_TESTDATA_READ = {"operation": "read", "path": "testdata://orders.csv"}


class TestCaseInsensitiveDuplicates:
    def test_case_variant_duplicate_keys_error_with_exact_message(self) -> None:
        node = _http_node(
            values={
                "method": "GET",
                "url": "http://example.com",
                "headers": {"X-Token": "a", "x-token": "b"},
            }
        )

        result = test_service._validate_test_data(_test_data([node]), context="save")

        assert DUP_MESSAGE in _messages(result)

    def test_distinct_keys_produce_no_duplicate_error(self) -> None:
        node = _http_node(
            values={
                "method": "GET",
                "url": "http://example.com",
                "headers": {"X-Token": "a", "X-Other": "b"},
            }
        )

        result = test_service._validate_test_data(_test_data([node]), context="save")

        assert not any("Duplicate header" in m for m in _messages(result))


class TestFramingHeaders:
    def test_content_length_row_errors_with_exact_message(self) -> None:
        node = _http_node(
            values={
                "method": "GET",
                "url": "http://example.com",
                "headers": {"Content-Length": "42"},
            }
        )

        result = test_service._validate_test_data(_test_data([node]), context="save")

        assert BLOCKED_CL in _messages(result)

    def test_transfer_encoding_row_is_allowed(self) -> None:
        """The transport arbitrates manual Transfer-Encoding - no design-time block."""
        node = _http_node(
            values={
                "method": "POST",
                "url": "http://example.com",
                "body": "x",
                "headers": {"Transfer-Encoding": "chunked"},
            }
        )

        result = test_service._validate_test_data(_test_data([node]), context="save")

        assert _messages(result) == []

    def test_typed_lowercase_key_is_flagged_and_renders_canonical_sentence(self) -> None:
        node = _http_node(
            values={
                "method": "GET",
                "url": "http://example.com",
                "headers": {"content-length": "10"},
            }
        )

        result = test_service._validate_test_data(_test_data([node]), context="save")

        flagged = [e for e in result["errors"] if e["message"] == BLOCKED_CL]
        assert flagged and flagged[0]["code"] == "MAP_KEY_BLOCKED"

    def test_host_and_connection_rows_are_allowed(self) -> None:
        """Only Content-Length is blocked."""
        node = _http_node(
            values={
                "method": "GET",
                "url": "http://example.com",
                "headers": {"Host": "virtual.example.com", "Connection": "close"},
            }
        )

        result = test_service._validate_test_data(_test_data([node]), context="save")

        assert not any("cannot be set manually" in m for m in _messages(result))


class TestGeneratedContentTypeRowDuplicates:
    """Rows colliding with the mode-generated Content-Type are ordinary duplicates."""

    def test_form_mode_with_content_type_row_errors_as_duplicate(self) -> None:
        node = _http_node(
            values={
                "method": "POST",
                "url": "http://example.com",
                "body_mode": "form",
                "form_fields": {"a": "1"},
                "headers": {"Content-Type": "application/json"},
            }
        )

        result = test_service._validate_test_data(_test_data([node]), context="save")

        flagged = [e for e in result["errors"] if e["message"] == _dup("Content-Type")]
        assert flagged and flagged[0]["code"] == "MAP_KEY_DUPLICATE"

    def test_form_mode_with_auto_headers_off_allows_the_row(self) -> None:
        node = _http_node(
            values={
                "method": "POST",
                "url": "http://example.com",
                "body_mode": "form",
                "body_auto_headers": False,
                "form_fields": {"a": "1"},
                "headers": {"Content-Type": "application/json"},
            }
        )

        result = test_service._validate_test_data(_test_data([node]), context="save")

        assert not any("Duplicate header" in m for m in _messages(result))

    def test_multipart_generates_even_with_auto_headers_stored_false(self) -> None:
        """The checkbox is FORCED true for multipart - the stored value is ignored."""
        node = _http_node(
            values={
                "method": "POST",
                "url": "http://example.com",
                "body_mode": "multipart",
                "body_auto_headers": False,
                "parts": [{"kind": "text", "name": "a", "value": "1"}],
                "headers": {"Content-Type": "application/json"},
            }
        )

        result = test_service._validate_test_data(_test_data([node]), context="save")

        assert _dup("Content-Type") in _messages(result)

    def test_file_mode_with_content_type_row_errors_as_duplicate(self) -> None:
        node = _http_node(
            values={
                "method": "PUT",
                "url": "http://example.com",
                "body_mode": "file",
                "file_source": "/data/payload.bin",
                "headers": {"Content-Type": "application/x-custom"},
            }
        )

        result = test_service._validate_test_data(_test_data([node]), context="save")

        assert _dup("Content-Type") in _messages(result)

    def test_text_mode_with_content_type_row_is_valid(self) -> None:
        """Text mode generates nothing - Content-Type rows stay VALID."""
        node = _http_node(
            values={
                "method": "POST",
                "url": "http://example.com",
                "body": "{}",
                "headers": {"Content-Type": "application/json"},
            }
        )

        result = test_service._validate_test_data(_test_data([node]), context="save")

        assert not any("Duplicate header" in m for m in _messages(result))

    def test_key_renders_as_typed(self) -> None:
        node = _http_node(
            values={
                "method": "POST",
                "url": "http://example.com",
                "body_mode": "form",
                "form_fields": {"a": "1"},
                "headers": {"content-type": "application/json"},
            }
        )

        result = test_service._validate_test_data(_test_data([node]), context="save")

        assert _dup("content-type") in _messages(result)


class TestGeneratedAuthRowDuplicates:
    """Rows colliding with the composed Auth header are ordinary duplicates."""

    def test_auth_enabled_default_mode_generates_authorization(self) -> None:
        """auth_mode defaults to basic - Authorization is the generated name."""
        node = _http_node(
            values={
                "method": "GET",
                "url": "http://example.com",
                "auth_enabled": True,
                "headers": {"Authorization": "Bearer manual"},
            }
        )

        result = test_service._validate_test_data(_test_data([node]), context="save")

        flagged = [e for e in result["errors"] if e["message"] == _dup("Authorization")]
        assert flagged and flagged[0]["code"] == "MAP_KEY_DUPLICATE"

    def test_bearer_mode_collision_is_case_insensitive_and_renders_as_typed(self) -> None:
        node = _http_node(
            values={
                "method": "GET",
                "url": "http://example.com",
                "auth_enabled": True,
                "auth_mode": "bearer",
                "headers": {"authorization": "Bearer manual"},
            }
        )

        result = test_service._validate_test_data(_test_data([node]), context="save")

        assert _dup("authorization") in _messages(result)

    def test_api_key_mode_uses_the_configured_header_name(self) -> None:
        node = _http_node(
            values={
                "method": "GET",
                "url": "http://example.com",
                "auth_enabled": True,
                "auth_mode": "api_key",
                "auth_header_name": "X-Tenant-Key",
                "headers": {"x-tenant-key": "manual"},
            }
        )

        result = test_service._validate_test_data(_test_data([node]), context="save")

        assert _dup("x-tenant-key") in _messages(result)

    def test_api_key_mode_defaults_the_header_name(self) -> None:
        """auth_header_name unset falls back to the schema default X-API-Key."""
        node = _http_node(
            values={
                "method": "GET",
                "url": "http://example.com",
                "auth_enabled": True,
                "auth_mode": "api_key",
                "headers": {"X-API-Key": "manual"},
            }
        )

        result = test_service._validate_test_data(_test_data([node]), context="save")

        assert _dup("X-API-Key") in _messages(result)

    def test_api_key_mode_leaves_authorization_rows_valid(self) -> None:
        node = _http_node(
            values={
                "method": "GET",
                "url": "http://example.com",
                "auth_enabled": True,
                "auth_mode": "api_key",
                "headers": {"Authorization": "Bearer manual"},
            }
        )

        result = test_service._validate_test_data(_test_data([node]), context="save")

        assert not any("Duplicate header" in m for m in _messages(result))

    def test_auth_disabled_leaves_authorization_rows_valid(self) -> None:
        node = _http_node(
            values={
                "method": "GET",
                "url": "http://example.com",
                "headers": {"Authorization": "Bearer manual"},
            }
        )

        result = test_service._validate_test_data(_test_data([node]), context="save")

        assert not any("Duplicate header" in m for m in _messages(result))

    def test_blank_api_key_header_name_produces_no_finding(self) -> None:
        node = _http_node(
            values={
                "method": "GET",
                "url": "http://example.com",
                "auth_enabled": True,
                "auth_mode": "api_key",
                "auth_header_name": "   ",
                "headers": {"X-API-Key": "manual"},
            }
        )

        result = test_service._validate_test_data(_test_data([node]), context="save")

        assert not any("Duplicate header" in m for m in _messages(result))

    def test_non_string_api_key_header_name_produces_no_finding(self) -> None:
        node = _http_node(
            values={
                "method": "GET",
                "url": "http://example.com",
                "auth_enabled": True,
                "auth_mode": "api_key",
                "auth_header_name": None,
                "headers": {"X-API-Key": "manual"},
            }
        )

        result = test_service._validate_test_data(_test_data([node]), context="save")

        assert not any("Duplicate header" in m for m in _messages(result))


class TestPolicyScopedByMetadata:
    """The pass is driven by plugin metadata - no blanket map policing."""

    def test_query_params_are_not_subject_to_the_header_policy(self) -> None:
        node = _http_node(
            values={
                "method": "GET",
                "url": "http://example.com",
                "query_params": {"Content-Length": "42", "X-Token": "a", "x-token": "b"},
            }
        )

        result = test_service._validate_test_data(_test_data([node]), context="save")

        messages = _messages(result)
        assert not any("cannot be set manually" in m for m in messages)
        assert not any("Duplicate header" in m for m in messages)

    def test_other_plugins_map_params_are_untouched(self) -> None:
        node = {
            "id": "setter-1",
            "type": "workflowNode",
            "position": {"x": 100, "y": 200},
            "data": {
                "elementType": "variable-setter",
                "nodeType": "control",
                "version": "1.0.0",
                "label": "Set Variables",
                "config": {"values": {"variables": {"Content-Length": "42"}}},
            },
        }
        test = {
            "name": "Setter Map Untouched",
            "workflow": {
                "nodes": [node],
                "edges": [{"id": "e1", "source": "start-node", "target": "setter-1"}],
            },
            "variables": {"Content-Length": {"type": "string", "value": ""}},
        }

        result = test_service._validate_test_data(test, context="save")

        assert not any("cannot be set manually" in m for m in _messages(result))

    def test_clean_headers_produce_no_policy_errors(self) -> None:
        node = _http_node(
            values={
                "method": "GET",
                "url": "http://example.com",
                "headers": {"Authorization": "Bearer t", "Accept": "application/json"},
            }
        )

        result = test_service._validate_test_data(_test_data([node]), context="save")

        messages = _messages(result)
        assert not any("cannot be set manually" in m for m in messages)
        assert not any("Duplicate header" in m for m in messages)

    def test_duplicate_scanning_is_opt_in_per_key_policy(self) -> None:
        """A key policy that does not declare case-insensitive duplicate
        scanning yields no duplicate findings - each finding type activates
        only from its own policy declaration."""
        entries = {"X-Token": "a", "x-token": "b"}
        opted_out = {
            "blocked_keys": ["Reserved"],
            "blocked_message": 'Key "{key}" is reserved',
            "duplicate_message": 'Duplicate header "{key}" (header names are case-insensitive)',
        }
        opted_in = {**opted_out, "case_insensitive_duplicates": True}

        assert list(test_service._duplicate_key_findings(opted_out, entries)) == []
        assert list(test_service._duplicate_key_findings(opted_in, entries)) == [
            ("MAP_KEY_DUPLICATE", _dup("x-token"))
        ]


class TestRemoteBodyPathSchemesAreNotSaveFindings:
    """A WAVE-side scheme on a block inside a Remote body saves, imports and validates clean."""

    @pytest.mark.parametrize("context", ["save", "load", "run"])
    def test_a_testdata_read_on_file_io_inside_remote_has_no_finding(self, context: str) -> None:
        test = _remote_body(_file_io_node(dict(_TESTDATA_READ)))

        result = test_service._validate_test_data(test, context=context)

        assert _node_errors(result, "fio-body") == []

    @pytest.mark.parametrize(
        "values",
        [
            {"operation": "write", "path": "artifact://out/report.txt", "content": "x"},
            {"operation": "copy", "source": "testdata://a.csv", "destination": "artifact://b.csv"},
        ],
    )
    def test_every_file_io_path_row_takes_a_scheme_inside_remote(
        self, values: dict[str, Any]
    ) -> None:
        test = _remote_body(_file_io_node(values))

        result = test_service._validate_test_data(test, context="save")

        assert _node_errors(result, "fio-body") == []

    def test_the_test_survives_the_persist_pipeline_with_no_residual(self) -> None:
        test = _remote_body(_file_io_node(dict(_TESTDATA_READ)))

        residual = test_service._validate_for_persist(test)

        assert [e for e in residual if e.get("node_id") == "fio-body"] == []
        assert [n["id"] for n in test["workflow"]["nodes"]] == ["rex-1", "fio-body"]

    def test_the_test_saves_and_validates_for_a_run(self) -> None:
        created = test_service.create_test(_remote_body(_file_io_node(dict(_TESTDATA_READ))))

        result = test_service.validate_test(created["id"], context="run")

        assert result is not None
        assert _node_errors(result, "fio-body") == []

    def test_the_test_imports(self) -> None:
        import json

        test = _remote_body(_file_io_node(dict(_TESTDATA_READ)))
        test["name"] = "Remote Body Import"

        result = test_service.import_tests(json.dumps(test).encode(), "remote.json")

        assert result["total_imported"] == 1
        stored = test_service._load_test(result["imported"][0]["id"])
        node = stored["workflow"]["nodes"][1]
        assert node["data"]["config"]["values"]["path"] == "testdata://orders.csv"

    def test_an_http_file_source_scheme_inside_remote_reports_only_the_body_mode(self) -> None:
        test = _remote_wrapped(
            {
                "method": "PUT",
                "url": "http://target.local/upload",
                "body_mode": "file",
                "file_source": "artifact://payload.bin",
            }
        )

        result = test_service._validate_test_data(test, context="save")

        assert [e["message"] for e in _node_errors(result, "http-body")] == [REMOTE_FILE_BODY]

    @pytest.mark.parametrize("direction", ["to_pod", "from_pod"])
    def test_both_copy_path_fields_take_a_scheme_inside_remote(self, direction: str) -> None:
        test = _remote_body(
            _copy_node(
                {
                    "direction": direction,
                    "source_path": "artifact://payload.bin",
                    "target_path": "testdata://fixture.csv",
                }
            )
        )

        result = test_service._validate_test_data(test, context="save")

        assert _node_errors(result, "copy-body") == []

    def test_the_finding_code_is_gone(self) -> None:
        import inspect

        assert "REMOTE_HOST_PATH_SCHEME" not in inspect.getsource(test_service)


class TestProxyChoiceHasNoSaveRule:
    """REQ-3.4.3.9: the block holds no proxy address, so no stored choice asks for one."""

    @pytest.mark.parametrize(
        "stored",
        [{}, {"proxy_mode": "wave-setting"}, {"proxy_mode": "off"}, {"proxy_mode": "explicit"}],
        ids=["nothing-stored", "wave-setting", "off", "outside-the-two-choices"],
    )
    def test_no_stored_proxy_choice_asks_for_a_proxy_url(self, stored: dict[str, str]) -> None:
        node = _http_node(values={"method": "GET", "url": "http://example.com", **stored})

        result = test_service._validate_test_data(_test_data([node]), context="save")

        assert _proxy_url_findings(result["errors"]) == []

    def test_the_persist_pipeline_reports_no_proxy_url_finding(self) -> None:
        node = _http_node(
            values={"method": "GET", "url": "http://example.com", "proxy_mode": "explicit"}
        )
        test = _test_data([node])

        residual = test_service._validate_for_persist(test)

        assert _proxy_url_findings(residual) == []
        assert [n["id"] for n in test["workflow"]["nodes"]] == ["http-1"]

    def test_the_finding_code_is_gone(self) -> None:
        import inspect

        assert "PROXY_URL_REQUIRED" not in inspect.getsource(test_service)


class TestTlsSaveValidation:
    """Stored TLS pins the runtime guards would reject fail at save time."""

    def test_min_above_max_errors_with_exact_message(self) -> None:
        node = _http_node(
            values={
                "method": "GET",
                "url": "https://example.com",
                "tls_min_version": "1.3",
                "tls_max_version": "1.2",
            }
        )

        result = test_service._validate_test_data(_test_data([node]), context="save")

        flagged = [e for e in result["errors"] if e["message"] == TLS_MIN_MAX]
        assert flagged and flagged[0]["code"] == "TLS_VERSION_ORDER"

    @pytest.mark.parametrize(
        ("minimum", "maximum"),
        [("1.2", "1.3"), ("1.2", "1.2"), ("1.0", "1.0"), ("1.0", "1.3"), ("1.3", "1.3")],
    )
    def test_ordered_or_equal_pins_are_valid(self, minimum: str, maximum: str) -> None:
        node = _http_node(
            values={
                "method": "GET",
                "url": "https://example.com",
                "tls_min_version": minimum,
                "tls_max_version": maximum,
            }
        )

        result = test_service._validate_test_data(_test_data([node]), context="save")

        assert TLS_MIN_MAX not in _messages(result)

    def test_openssl_cipher_names_are_valid(self) -> None:
        node = _http_node(
            values={
                "method": "GET",
                "url": "https://example.com",
                "cipher_suites": [_catalog_cipher_row()["openssl"]],
            }
        )

        result = test_service._validate_test_data(_test_data([node]), context="save")

        assert not any("cipher suite" in m for m in _messages(result))

    def test_iana_cipher_names_are_valid(self) -> None:
        node = _http_node(
            values={
                "method": "GET",
                "url": "https://example.com",
                "cipher_suites": [_catalog_cipher_row()["iana"]],
            }
        )

        result = test_service._validate_test_data(_test_data([node]), context="save")

        assert not any("cipher suite" in m for m in _messages(result))

    def test_unknown_cipher_errors_per_entry(self) -> None:
        node = _http_node(
            values={
                "method": "GET",
                "url": "https://example.com",
                "cipher_suites": ["NOT-A-CIPHER", "ALSO-FAKE"],
            }
        )

        result = test_service._validate_test_data(_test_data([node]), context="save")

        messages = _messages(result)
        assert _unknown_cipher("NOT-A-CIPHER") in messages
        assert _unknown_cipher("ALSO-FAKE") in messages
        flagged = [e for e in result["errors"] if "cipher suite" in e["message"]]
        assert {e["code"] for e in flagged} == {"TLS_CIPHER_UNKNOWN"}

    def test_tls13_suite_names_are_valid(self) -> None:
        """TLS 1.3 suites are selectable now - the pure-Python client picks among them."""
        from wavecore.connectivity import tls_capabilities

        suites = list(tls_capabilities.tls13_suites()[:2])
        node = _http_node(
            values={
                "method": "GET",
                "url": "https://example.com",
                "cipher_suites": suites,
            }
        )

        result = test_service._validate_test_data(_test_data([node]), context="save")

        assert not any("cipher suite" in m for m in _messages(result))

    def test_other_plugins_are_untouched(self) -> None:
        node = {
            "id": "log-1",
            "type": "workflowNode",
            "position": {"x": 100, "y": 200},
            "data": {
                "elementType": "log",
                "nodeType": "plugin",
                "version": "1.0.0",
                "label": "Log",
                "config": {
                    "values": {
                        "message": "hi",
                        "tls_min_version": "1.3",
                        "tls_max_version": "1.2",
                        "cipher_suites": ["NOT-A-CIPHER"],
                    }
                },
            },
        }
        test = {
            "name": "Log TLS Untouched",
            "workflow": {
                "nodes": [node],
                "edges": [{"id": "e1", "source": "start-node", "target": "log-1"}],
            },
            "variables": {},
        }

        result = test_service._validate_test_data(test, context="save")

        messages = _messages(result)
        assert TLS_MIN_MAX not in messages
        assert not any("cipher suite" in m for m in messages)

    def test_errors_survive_the_persist_autofix_pipeline(self) -> None:
        """No destructive fix: the node stays; the errors surface as residual."""
        node = _http_node(
            values={
                "method": "GET",
                "url": "https://example.com",
                "tls_min_version": "1.3",
                "tls_max_version": "1.2",
                "cipher_suites": ["NOT-A-CIPHER"],
            }
        )
        test = _test_data([node])

        residual = test_service._validate_for_persist(test)

        residual_messages = [e["message"] for e in residual]
        assert TLS_MIN_MAX in residual_messages
        assert _unknown_cipher("NOT-A-CIPHER") in residual_messages
        assert [n["id"] for n in test["workflow"]["nodes"]] == ["http-1"]

    def test_the_save_check_keeps_no_rank_table_of_its_own(self) -> None:
        assert not hasattr(test_service, "_TLS_VERSION_RANK")


_TLS_BLOCKS = ["http-client", "k8s-connect"]


class TestTlsCipherRange:
    """Typed Cipher Suites names are checked against the Block's TLS versions at save."""

    @pytest.mark.parametrize("block", _TLS_BLOCKS)
    def test_a_tls13_suite_outside_tls_1_0_to_1_2_is_refused(self, block: str) -> None:
        node = _tls_node(
            block,
            {
                "tls_min_version": "1.0",
                "tls_max_version": "1.2",
                "cipher_suites": ["TLS_AES_128_GCM_SHA256"],
            },
        )

        result = test_service._validate_test_data(_test_data([node]), context="save")

        [finding] = _cipher_findings(result, "TLS_CIPHER_OUT_OF_RANGE")
        assert re.match(
            r'^Cipher suite "TLS_AES_128_GCM_SHA256" is not available in TLS 1\.0 to 1\.2$',
            finding["message"],
        )
        assert finding["node_id"] == node["id"]
        assert finding["element_type"] == block
        assert finding["path"].endswith(".data.config.values.cipher_suites")

    @pytest.mark.parametrize("block", _TLS_BLOCKS)
    def test_an_unset_max_version_reads_as_its_default(self, block: str) -> None:
        node = _tls_node(
            block, {"tls_min_version": "1.3", "cipher_suites": ["ECDHE-RSA-AES128-GCM-SHA256"]}
        )

        result = test_service._validate_test_data(_test_data([node]), context="save")

        assert [f["message"] for f in _cipher_findings(result, "TLS_CIPHER_OUT_OF_RANGE")] == [
            _out_of_range("ECDHE-RSA-AES128-GCM-SHA256", "1.3", "1.3")
        ]

    @pytest.mark.parametrize("block", _TLS_BLOCKS)
    def test_an_unset_min_version_reads_as_its_default(self, block: str) -> None:
        node = _tls_node(
            block, {"tls_max_version": "1.2", "cipher_suites": ["TLS_AES_128_GCM_SHA256"]}
        )

        result = test_service._validate_test_data(_test_data([node]), context="save")

        assert [f["message"] for f in _cipher_findings(result, "TLS_CIPHER_OUT_OF_RANGE")] == [
            _out_of_range("TLS_AES_128_GCM_SHA256", "1.2", "1.2")
        ]

    @pytest.mark.parametrize("block", _TLS_BLOCKS)
    @pytest.mark.parametrize(
        "suites",
        [[None], ["TLS_AES_128_GCM_SHA256", None]],
        ids=["only-null", "null-beside-a-name"],
    )
    def test_a_null_entry_gives_no_save_finding(self, block: str, suites: list[Any]) -> None:
        # Save allows null in any list item; only the run refuses it, naming the row.
        node = _tls_node(block, {"cipher_suites": suites})

        result = test_service._validate_test_data(_test_data([node]), context="save")

        assert [
            (f["code"], f["message"])
            for f in [*result["errors"], *result["warnings"]]
            if f.get("node_id") == node["id"]
        ] == []

    @pytest.mark.parametrize("block", _TLS_BLOCKS)
    def test_with_both_versions_unset_every_catalog_suite_is_in_range(self, block: str) -> None:
        from wavecore.connectivity import tls_capabilities

        names = [row["openssl"] for row in tls_capabilities.catalog()]
        node = _tls_node(block, {"cipher_suites": names})

        result = test_service._validate_test_data(_test_data([node]), context="save")

        assert _cipher_findings(result, "TLS_CIPHER_OUT_OF_RANGE") == []

    @pytest.mark.parametrize("block", _TLS_BLOCKS)
    def test_a_legacy_suite_inside_its_span_is_not_refused(self, block: str) -> None:
        node = _tls_node(
            block,
            {
                "tls_min_version": "1.0",
                "tls_max_version": "1.1",
                "cipher_suites": ["ECDHE-RSA-AES128-SHA"],
            },
        )

        result = test_service._validate_test_data(_test_data([node]), context="save")

        assert _cipher_findings(result, "TLS_CIPHER_OUT_OF_RANGE") == []

    @pytest.mark.parametrize("block", _TLS_BLOCKS)
    def test_an_iana_name_is_refused_as_typed(self, block: str) -> None:
        name = "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256"
        node = _tls_node(block, {"tls_min_version": "1.3", "cipher_suites": [name]})

        result = test_service._validate_test_data(_test_data([node]), context="save")

        assert [f["message"] for f in _cipher_findings(result, "TLS_CIPHER_OUT_OF_RANGE")] == [
            _out_of_range(name, "1.3", "1.3")
        ]

    @pytest.mark.parametrize("block", _TLS_BLOCKS)
    def test_each_entry_outside_the_range_has_its_own_finding(self, block: str) -> None:
        node = _tls_node(
            block,
            {
                "tls_min_version": "1.3",
                "cipher_suites": [
                    "ECDHE-RSA-AES128-GCM-SHA256",
                    "TLS_AES_256_GCM_SHA384",
                    "DHE-RSA-AES128-SHA",
                    "NOT-A-CIPHER",
                ],
            },
        )

        result = test_service._validate_test_data(_test_data([node]), context="save")

        assert [f["message"] for f in _cipher_findings(result, "TLS_CIPHER_OUT_OF_RANGE")] == [
            _out_of_range("ECDHE-RSA-AES128-GCM-SHA256", "1.3", "1.3"),
            _out_of_range("DHE-RSA-AES128-SHA", "1.3", "1.3"),
        ]
        assert [f["message"] for f in _cipher_findings(result, "TLS_CIPHER_UNKNOWN")] == [
            _unknown_cipher("NOT-A-CIPHER")
        ]

    def test_an_expression_version_gives_no_range_finding(self) -> None:
        node = _tls_node(
            "http-client",
            {"tls_min_version": "tls_floor", "cipher_suites": ["ECDHE-RSA-AES128-GCM-SHA256"]},
        )
        node["data"]["expressionFields"] = ["tls_min_version"]
        test = _test_data([node])
        test["variables"] = {"tls_floor": {"type": "string", "value": "1.3"}}

        result = test_service._validate_test_data(test, context="save")

        assert _cipher_findings(result, "TLS_CIPHER_OUT_OF_RANGE") == []

    def test_the_finding_survives_the_persist_autofix_pipeline(self) -> None:
        node = _tls_node(
            "http-client",
            {
                "tls_min_version": "1.0",
                "tls_max_version": "1.2",
                "cipher_suites": ["TLS_AES_128_GCM_SHA256"],
            },
        )
        test = _test_data([node])

        residual = test_service._validate_for_persist(test)

        assert _out_of_range("TLS_AES_128_GCM_SHA256", "1.0", "1.2") in [
            e["message"] for e in residual
        ]
        assert test["workflow"]["nodes"][0]["data"]["config"]["values"]["cipher_suites"] == [
            "TLS_AES_128_GCM_SHA256"
        ]


class TestK8sConnectTlsPins:
    """K8s Connect's stored TLS pins get the same save checks as HTTP Request's."""

    def test_min_above_max_errors_with_exact_message(self) -> None:
        node = _k8s_connect_node({"tls_min_version": "1.3", "tls_max_version": "1.2"})

        result = test_service._validate_test_data(_test_data([node]), context="save")

        [finding] = [e for e in result["errors"] if e["message"] == TLS_MIN_MAX]
        assert (finding["code"], finding["node_id"]) == ("TLS_VERSION_ORDER", "k8s-1")

    def test_unknown_cipher_errors_per_entry(self) -> None:
        node = _k8s_connect_node({"cipher_suites": ["NOT-A-CIPHER", "ALSO-FAKE"]})

        result = test_service._validate_test_data(_test_data([node]), context="save")

        assert [f["message"] for f in _cipher_findings(result, "TLS_CIPHER_UNKNOWN")] == [
            _unknown_cipher("NOT-A-CIPHER"),
            _unknown_cipher("ALSO-FAKE"),
        ]

    def test_catalog_names_in_range_are_valid(self) -> None:
        node = _k8s_connect_node({"cipher_suites": ["TLS_AES_128_GCM_SHA256"]})

        result = test_service._validate_test_data(_test_data([node]), context="save")

        assert not any("cipher suite" in m.lower() for m in _messages(result))


class TestRemoteUnsupportedCapabilities:
    """HTTP capabilities the remote worker lacks are rejected design-time."""

    def test_form_body_mode_inside_remote_errors(self) -> None:
        test = _remote_wrapped(
            {
                "method": "POST",
                "url": "http://target.local",
                "body_mode": "form",
                "form_fields": {"a": "1"},
            }
        )

        result = test_service._validate_test_data(test, context="save")

        flagged = [e for e in result["errors"] if e["message"] == REMOTE_FORM]
        assert flagged and flagged[0]["code"] == "REMOTE_UNSUPPORTED"

    def test_multipart_body_mode_inside_remote_errors(self) -> None:
        test = _remote_wrapped(
            {
                "method": "POST",
                "url": "http://target.local",
                "body_mode": "multipart",
                "parts": [{"kind": "text", "name": "a", "value": "1"}],
            }
        )

        result = test_service._validate_test_data(test, context="save")

        assert REMOTE_MULTIPART in _messages(result)

    def test_file_body_mode_with_host_path_inside_remote_errors(self) -> None:
        test = _remote_wrapped(
            {
                "method": "PUT",
                "url": "http://target.local/upload",
                "body_mode": "file",
                "file_source": "/data/on/host.bin",
            }
        )

        result = test_service._validate_test_data(test, context="save")

        assert REMOTE_FILE_BODY in _messages(result)

    def test_text_body_mode_inside_remote_is_valid(self) -> None:
        test = _remote_wrapped({"method": "POST", "url": "http://target.local", "body": "{}"})

        result = test_service._validate_test_data(test, context="save")

        assert not any(REMOTE_SUFFIX in m for m in _messages(result))

    def test_file_response_mode_inside_remote_errors(self) -> None:
        test = _remote_wrapped(
            {"method": "GET", "url": "http://target.local", "response_mode": "file"}
        )

        result = test_service._validate_test_data(test, context="save")

        assert REMOTE_FILE_RESPONSE in _messages(result)

    def test_max_size_inside_remote_errors(self) -> None:
        test = _remote_wrapped({"method": "GET", "url": "http://target.local", "max_size": 1024})

        result = test_service._validate_test_data(test, context="save")

        assert REMOTE_MAX_SIZE in _messages(result)

    @pytest.mark.parametrize("field", ["ca_cert", "client_cert", "client_key"])
    def test_tls_identity_fields_inside_remote_are_valid(self, field: str) -> None:
        # Remote TLS parity: the bundled pure-Python client travels in the bundle,
        # so certificate and identity material behaves identically on the remote host.
        test = _remote_wrapped(
            {"method": "GET", "url": "https://target.local", field: "/certs/material.pem"}
        )

        result = test_service._validate_test_data(test, context="save")

        assert not any(REMOTE_SUFFIX in m for m in _messages(result))

    def test_verify_ssl_false_inside_remote_is_valid(self) -> None:
        test = _remote_wrapped(
            {"method": "GET", "url": "https://target.local", "verify_ssl": False}
        )

        result = test_service._validate_test_data(test, context="save")

        assert not any(REMOTE_SUFFIX in m for m in _messages(result))

    @pytest.mark.parametrize(
        ("field", "value"),
        [("tls_min_version", "1.0"), ("tls_max_version", "1.2"), ("tls_max_version", "1.3")],
    )
    def test_tls_version_pins_inside_remote_are_valid(self, field: str, value: str) -> None:
        test = _remote_wrapped({"method": "GET", "url": "https://target.local", field: value})

        result = test_service._validate_test_data(test, context="save")

        assert not any(REMOTE_SUFFIX in m for m in _messages(result))

    def test_cipher_suites_inside_remote_are_valid(self) -> None:
        test = _remote_wrapped(
            {
                "method": "GET",
                "url": "https://target.local",
                "cipher_suites": [_catalog_cipher_row()["openssl"]],
            }
        )

        result = test_service._validate_test_data(test, context="save")

        assert not any(REMOTE_SUFFIX in m for m in _messages(result))

    def test_empty_cipher_list_inside_remote_is_valid(self) -> None:
        # Explicit-zero ciphers is a legitimate TLS choice the remote client honors.
        test = _remote_wrapped(
            {"method": "GET", "url": "https://target.local", "cipher_suites": []}
        )

        result = test_service._validate_test_data(test, context="save")

        assert not any(REMOTE_SUFFIX in m for m in _messages(result))

    @pytest.mark.parametrize("mode", ["wave-setting", "off"])
    def test_a_proxy_choice_inside_remote_saves_without_a_finding(self, mode: str) -> None:
        # REQ-3.4.3.9: the request uses the remote host's own proxy settings.
        test = _remote_wrapped({"method": "GET", "url": "http://target.local", "proxy_mode": mode})

        result = test_service._validate_test_data(test, context="save")

        assert _node_errors(result, "http-body") == []

    def test_default_http_node_inside_remote_is_valid(self) -> None:
        test = _remote_wrapped({"method": "GET", "url": "http://target.local"})

        result = test_service._validate_test_data(test, context="save")

        assert not any(REMOTE_SUFFIX in m for m in _messages(result))

    def test_other_plugins_inside_remote_are_untouched(self) -> None:
        test = _remote_wrapped({"method": "GET", "url": "http://target.local"})
        log_node = {
            "id": "log-1",
            "type": "workflowNode",
            "position": {"x": 50, "y": 50},
            "data": {
                "elementType": "log",
                "nodeType": "plugin",
                "version": "1.0.0",
                "label": "Log",
                "config": {"values": {"message": "hi", "proxy_mode": "off", "http2": True}},
            },
        }
        test["workflow"]["nodes"].append(log_node)
        test["workflow"]["edges"].append({"id": "e3", "source": "http-body", "target": "log-1"})

        result = test_service._validate_test_data(test, context="save")

        assert not any(REMOTE_SUFFIX in m for m in _messages(result))

    def test_non_plugin_and_configless_members_are_skipped(self) -> None:
        test = _remote_wrapped({"method": "GET", "url": "http://target.local"})
        setter = {
            "id": "setter-1",
            "type": "workflowNode",
            "position": {"x": 10, "y": 10},
            "data": {
                "elementType": "variable-setter",
                "nodeType": "control",
                "version": "1.0.0",
                "label": "Set Variables",
                "config": {"values": {"variables": {"a": "1"}}},
            },
        }
        bare = {
            "id": "bare-1",
            "type": "workflowNode",
            "position": {"x": 20, "y": 20},
            "data": {
                "elementType": "http-client",
                "nodeType": "plugin",
                "version": "1.0.0",
                "label": "Bare HTTP",
                "config": {},
            },
        }
        test["workflow"]["nodes"].extend([setter, bare])
        test["workflow"]["edges"].extend(
            [
                {"id": "e3", "source": "http-body", "target": "setter-1"},
                {"id": "e4", "source": "setter-1", "target": "bare-1"},
            ]
        )

        result = test_service._validate_test_data(test, context="save")

        assert not any(REMOTE_SUFFIX in m for m in _messages(result))

    def test_one_finding_per_offending_aspect(self) -> None:
        # Only the body, response and size caps are refused; TLS pins and the proxy choice are not.
        test = _remote_wrapped(
            {
                "method": "POST",
                "url": "http://target.local",
                "body_mode": "form",
                "form_fields": {"a": "1"},
                "response_mode": "file",
                "max_size": 2048,
                "ca_cert": "/certs/ca.pem",
                "proxy_mode": "off",
            }
        )

        result = test_service._validate_test_data(test, context="save")

        expected = [
            REMOTE_FORM,
            REMOTE_FILE_RESPONSE,
            REMOTE_MAX_SIZE,
        ]
        remote_findings = [m for m in _messages(result) if REMOTE_SUFFIX in m]
        assert sorted(remote_findings) == sorted(expected)

    def test_offending_values_outside_remote_are_valid(self) -> None:
        node = _http_node(
            values={
                "method": "POST",
                "url": "http://example.com",
                "body_mode": "form",
                "form_fields": {"a": "1"},
                "response_mode": "file",
                "max_size": 2048,
                "ca_cert": "/certs/ca.pem",
                "proxy_mode": "off",
                "http2": True,
            }
        )

        result = test_service._validate_test_data(_test_data([node]), context="save")

        assert not any(REMOTE_SUFFIX in m for m in _messages(result))

    def test_error_survives_the_persist_autofix_pipeline(self) -> None:
        """No destructive fix: nodes stay; the error surfaces as residual."""
        test = _remote_wrapped(
            {
                "method": "POST",
                "url": "http://target.local",
                "body_mode": "form",
                "form_fields": {"a": "1"},
            }
        )

        residual = test_service._validate_for_persist(test)

        assert REMOTE_FORM in [e["message"] for e in residual]
        assert [n["id"] for n in test["workflow"]["nodes"]] == ["rex-1", "http-body"]


class TestRemoteBodyMembershipGraph:
    """The body-handle membership walk tolerates malformed edges and
    converging paths - membership stays correct, findings stay single."""

    _FORM_VALUES = {
        "method": "POST",
        "url": "http://target.local",
        "body_mode": "form",
        "form_fields": {"a": "1"},
    }

    def test_a_target_less_edge_does_not_break_the_walk(self) -> None:
        test = _remote_wrapped(dict(self._FORM_VALUES))
        test["workflow"]["edges"].append({"id": "e3", "source": "http-body"})

        result = test_service._validate_test_data(test, context="save")

        assert REMOTE_FORM in _messages(result)

    def test_a_source_less_edge_grants_no_membership(self) -> None:
        test = _remote_wrapped({"method": "GET", "url": "http://target.local"})
        outside = _http_node(node_id="http-out", values=dict(self._FORM_VALUES))
        test["workflow"]["nodes"].append(outside)
        test["workflow"]["edges"].append({"id": "e3", "target": "http-out"})

        result = test_service._validate_test_data(test, context="save")

        assert REMOTE_FORM not in _messages(result)

    def test_converging_body_paths_flag_the_member_once(self) -> None:
        test = _remote_wrapped(dict(self._FORM_VALUES))
        log_node = {
            "id": "log-1",
            "type": "workflowNode",
            "position": {"x": 50, "y": 50},
            "data": {
                "elementType": "log",
                "nodeType": "plugin",
                "version": "1.0.0",
                "label": "Log",
                "config": {"values": {"message": "hi"}},
            },
        }
        test["workflow"]["nodes"].append(log_node)
        test["workflow"]["edges"].extend(
            [
                {"id": "e3", "source": "rex-1", "target": "log-1", "sourceHandle": "body"},
                {"id": "e4", "source": "log-1", "target": "http-body"},
            ]
        )

        result = test_service._validate_test_data(test, context="save")

        assert _messages(result).count(REMOTE_FORM) == 1
