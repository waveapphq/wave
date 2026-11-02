"""Every Function and Test save path returns its validation issues as HTTP 422."""

from __future__ import annotations

import re
import uuid
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

# ---------------------------------------------------------------------------
# Fixtures & helpers
# ---------------------------------------------------------------------------


@pytest.fixture
def client() -> TestClient:
    from wavecore.api.app import app

    return TestClient(app)


@pytest.fixture(autouse=True)
def register_plugins_and_controls() -> Any:
    """Plugins/controls are registered at app startup but the bare ``TestClient``
    used here is not entered as a context manager, so we register them
    explicitly. Mirrors the autouse fixture in ``test_workbench_function_runs``.
    """
    from wavecore.controls.registry import _registry, register_all_core_controls
    from wavecore.core.plugin_registry import clear_registry, register_plugin
    from wavecore.plugins.log import LogPlugin

    _registry.clear()
    register_all_core_controls(_registry)
    clear_registry()
    register_plugin(LogPlugin())
    yield
    _registry.clear()
    clear_registry()


def _make_function_payload(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "name": "valid_name",
        "description": "",
        "tags": [],
        "inputs": [],
        "outputs": [],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {"nodes": [], "edges": []},
    }
    payload.update(overrides)
    return payload


def _make_log_node(
    node_id: str,
    *,
    element_type: str = "log",
    message: str = "'ok'",
    output_bindings: dict[str, str] | None = None,
) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": node_id,
            "elementType": element_type,
            "nodeType": "plugin",
            "version": "1.0.0",
            "config": {
                "values": {"message": message, "level": "INFO"},
                "profileBindings": [],
                "outputBindings": output_bindings or {},
            },
            "displayName": node_id,
            "expressionFields": ["message"],
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    }


def _details(body: dict[str, Any]) -> list[dict[str, Any]]:
    """Return the structured `error.details` entries (each has code + message)."""
    err = body.get("error") or {}
    raw = err.get("details") or []
    if isinstance(raw, list):
        return [d for d in raw if isinstance(d, dict)]
    return []


def _all_messages(body: dict[str, Any]) -> list[str]:
    err = body.get("error") or {}
    out: list[str] = []
    if err.get("message"):
        out.append(err["message"])
    for d in _details(body):
        if d.get("message"):
            out.append(d["message"])
    return out


def _has_code(body: dict[str, Any], code: str) -> bool:
    return any(d.get("code") == code for d in _details(body))


# Anchored message patterns.
RE_NAME_TOO_LONG = re.compile(r"^Function name '.+' exceeds 32 characters$")
RE_INPUT_TYPE_MISSING = re.compile(r"^Function input '.+' has no declared type$")
RE_OUTPUT_TYPE_MISSING = re.compile(r"^Function output '.+' has no declared type$")
RE_DUPLICATE_INPUT_NAME = re.compile(r"^Function declares input '.+' more than once$")
RE_DUPLICATE_OUTPUT_NAME = re.compile(r"^Function declares output '.+' more than once$")
RE_EMPTY_FUNCTION_BODY = re.compile(r"^Function '.+' has no blocks$")
# Canonical save-pipeline message format: parameter-shaped text; the node
# identity travels in the ``node_label`` field so the UI prefixes the message
# once, uniformly.
RE_UNKNOWN_PLUGIN = re.compile(r"^References unknown plugin '.+'$")
RE_UNKNOWN_FUNCTION = re.compile(r"^References unknown Function '.+'$")
RE_REQUIRED_PARAM_MISSING = re.compile(r"^Required parameter '.+' is missing$")
RE_OUTPUT_HAS_NO_PRODUCER = re.compile(r"^Declared output '.+' is not written by any block$")
RE_INPUT_WRITE_FORBIDDEN = re.compile(r"^Writes to declared input '.+'; inputs are read-only$")
RE_EXTERNAL_SCOPE_READ_FORBIDDEN = re.compile(
    r"^Reads variable '.+' from external scope '.+'; " r"only the Function's own scope is visible$"
)
RE_NODE_UNREACHABLE = re.compile(r"^Block is not reachable from the Function's entry$")
RE_TRY_WITHOUT_CATCH = re.compile(r"^Try construct has no matching catch branch$")


# ---------------------------------------------------------------------------
# POST /functions surfaces every dimension as 422 with the anchored message
# ---------------------------------------------------------------------------


class TestPostFunctionsSurfacesEveryDimension:
    """Each validation dimension's failure surfaces through POST /functions as 422."""

    def test_unknown_plugin_returns_422(self, client: TestClient) -> None:
        payload = _make_function_payload(
            name="unknownplug",
            workflow={
                "nodes": [
                    _make_log_node("n-1", element_type="totally_made_up"),
                ],
                "edges": [{"source": "start-node", "target": "n-1"}],
            },
        )
        resp = client.post("/functions", json=payload)
        assert resp.status_code == 422
        body = resp.json()
        assert _has_code(body, "UNKNOWN_PLUGIN")
        assert any(RE_UNKNOWN_PLUGIN.match(m) for m in _all_messages(body))

    def test_unknown_function_returns_422(self, client: TestClient) -> None:
        missing_fn_id = str(uuid.uuid4())
        payload = _make_function_payload(
            name="unknownfn",
            workflow={
                "nodes": [
                    {
                        "id": "callee",
                        "type": "workflowNode",
                        "data": {
                            "label": "callee",
                            "elementType": "function",
                            "nodeType": "function",
                            "version": "1.0.0",
                            "functionLifecycle": "shared",
                            "functionId": missing_fn_id,
                            "config": {
                                "values": {},
                                "profileBindings": [],
                                "outputBindings": {},
                            },
                        },
                    },
                ],
                "edges": [{"source": "start-node", "target": "callee"}],
            },
        )
        resp = client.post("/functions", json=payload)
        assert resp.status_code == 422
        body = resp.json()
        # Per REQ-3.1.2.2: unknown function id surfaces missing_function_id.
        assert _has_code(body, "MISSING_FUNCTION_ID")
        assert any(RE_UNKNOWN_FUNCTION.match(m) for m in _all_messages(body))

    def test_required_binding_missing_returns_422(self, client: TestClient) -> None:
        payload = _make_function_payload(
            name="reqmissing",
            workflow={
                "nodes": [
                    # log requires message; omit it.
                    {
                        "id": "n-1",
                        "type": "workflowNode",
                        "data": {
                            "label": "n-1",
                            "elementType": "log",
                            "nodeType": "plugin",
                            "version": "1.0.0",
                            "config": {
                                "values": {"level": "INFO"},
                                "profileBindings": [],
                                "outputBindings": {},
                            },
                        },
                    },
                ],
                "edges": [{"source": "start-node", "target": "n-1"}],
            },
        )
        resp = client.post("/functions", json=payload)
        assert resp.status_code == 422
        body = resp.json()
        assert _has_code(body, "REQUIRED_PARAM_MISSING")
        assert any(RE_REQUIRED_PARAM_MISSING.match(m) for m in _all_messages(body))

    def test_input_write_forbidden_returns_422(self, client: TestClient) -> None:
        payload = _make_function_payload(
            name="writesinput",
            inputs=[{"name": "x", "type": "string", "required": True}],
            workflow={
                "nodes": [
                    _make_log_node(
                        "n-1",
                        message="'overwrite'",
                        output_bindings={"line": "x"},
                    ),
                ],
                "edges": [{"source": "start-node", "target": "n-1"}],
            },
        )
        resp = client.post("/functions", json=payload)
        assert resp.status_code == 422
        body = resp.json()
        assert _has_code(body, "INPUT_WRITE_FORBIDDEN")
        assert any(RE_INPUT_WRITE_FORBIDDEN.match(m) for m in _all_messages(body))

    def test_external_scope_read_returns_422(self, client: TestClient) -> None:
        payload = _make_function_payload(
            name="extread",
            workflow={
                "nodes": [
                    _make_log_node(
                        "n-1",
                        message="regression.value",
                    ),
                ],
                "edges": [{"source": "start-node", "target": "n-1"}],
            },
        )
        resp = client.post("/functions", json=payload)
        assert resp.status_code == 422
        body = resp.json()
        assert _has_code(body, "EXTERNAL_SCOPE_READ_FORBIDDEN")
        assert any(RE_EXTERNAL_SCOPE_READ_FORBIDDEN.match(m) for m in _all_messages(body))

    def test_unreachable_node_returns_422(self, client: TestClient) -> None:
        payload = _make_function_payload(
            name="unreach",
            workflow={
                "nodes": [
                    _make_log_node("reachable", message="'r'"),
                    _make_log_node("orphan", message="'o'"),
                ],
                "edges": [{"source": "start-node", "target": "reachable"}],
            },
        )
        resp = client.post("/functions", json=payload)
        assert resp.status_code == 422
        body = resp.json()
        assert _has_code(body, "NODE_UNREACHABLE")
        assert any(RE_NODE_UNREACHABLE.match(m) for m in _all_messages(body))


# ---------------------------------------------------------------------------
# Warnings do not block save (severity=warning persists)
# ---------------------------------------------------------------------------


class TestWarningsDoNotBlockSave:
    """A definition with ONLY warnings is saved successfully."""

    def test_empty_body_warning_does_not_block(self, client: TestClient) -> None:
        payload = _make_function_payload(
            name="emptywarn",
            workflow={"nodes": [], "edges": []},
        )
        resp = client.post("/functions", json=payload)
        assert resp.status_code in (200, 201), resp.text

    def test_output_without_producer_warning_does_not_block(self, client: TestClient) -> None:
        payload = _make_function_payload(
            name="nooutwriter",
            outputs=[{"name": "untouched", "type": "string"}],
            workflow={
                "nodes": [_make_log_node("n-1", message="'side'")],
                "edges": [{"source": "start-node", "target": "n-1"}],
            },
        )
        resp = client.post("/functions", json=payload)
        assert resp.status_code in (200, 201), resp.text


# ---------------------------------------------------------------------------
# POST /tests + PUT /tests/{id} surface Function validation for embedded Function instances
# ---------------------------------------------------------------------------


class TestSavePipelineForEmbeddedFunctionInstance:
    """Function validation runs over Function instances embedded in a Test's workflow."""

    def _test_payload_with_function_instance(
        self,
        local_definition: dict[str, Any],
        values: dict[str, Any] | None = None,
        output_bindings: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        return {
            "id": str(uuid.uuid4()),
            "name": "FunctionInstanceTest",
            "version": "1.0.0",
            "description": "",
            "tags": [],
            "variables": {},
            "workflow": {
                "nodes": [
                    {
                        "id": "fn-1",
                        "type": "workflowNode",
                        "data": {
                            "label": "fn-1",
                            "elementType": "function",
                            "nodeType": "function",
                            "version": "1.0.0",
                            "functionLifecycle": "local",
                            "localDefinition": local_definition,
                            "config": {
                                "values": values or {},
                                "profileBindings": [],
                                "outputBindings": output_bindings or {},
                            },
                        },
                    },
                ],
                "edges": [{"source": "start-node", "target": "fn-1"}],
            },
        }

    def test_post_tests_with_invalid_local_definition_returns_422(self, client: TestClient) -> None:
        local = {
            "name": "innerfn",
            "description": "",
            "tags": [],
            "inputs": [],
            "outputs": [],
            "dependencies": {"functions": [], "plugins": []},
            "workflow": {
                "nodes": [_make_log_node("bad", element_type="nonexistent_plugin")],
                "edges": [{"source": "start-node", "target": "bad"}],
            },
        }
        payload = self._test_payload_with_function_instance(local)
        resp = client.post("/tests", json=payload)
        assert resp.status_code == 422, resp.text
        body = resp.json()
        # Either via top-level "details" or via "error.details" - both must mention
        # the embedded Function's UNKNOWN_PLUGIN violation.
        messages = _all_messages(body)
        assert any(RE_UNKNOWN_PLUGIN.match(m) for m in messages), messages

    def _nested_shared_local_definition(
        self, function_id: str, *, function_version: str = ""
    ) -> dict[str, Any]:
        """Local Function body containing one Shared instance reference."""
        return {
            "name": "outerlocal",
            "description": "",
            "tags": [],
            "inputs": [],
            "outputs": [],
            "dependencies": {"functions": [], "plugins": []},
            "workflow": {
                "nodes": [
                    {
                        "id": "nested-shared",
                        "type": "workflowNode",
                        "data": {
                            "label": "nested-shared",
                            "elementType": "function",
                            "nodeType": "function",
                            "version": "1.0.0",
                            "functionLifecycle": "shared",
                            "functionId": function_id,
                            "functionVersion": function_version,
                            "config": {
                                "values": {},
                                "profileBindings": [],
                                "outputBindings": {},
                            },
                        },
                    },
                ],
                "edges": [{"source": "start-node", "target": "nested-shared"}],
            },
        }

    def test_post_tests_nested_shared_in_local_resolves_against_library(
        self, client: TestClient
    ) -> None:
        # A Shared instance nested inside a Local Function body must resolve
        # against the library: the embedded-body validator receives
        # the same registry the top-level Function-save path uses.
        pub = client.post(
            "/functions",
            json=_make_function_payload(
                name="nested_pub",
                workflow={
                    "nodes": [_make_log_node("inner")],
                    "edges": [{"source": "start-node", "target": "inner"}],
                },
            ),
        )
        assert pub.status_code == 201, pub.text
        pub_id = pub.json()["data"]["id"]

        local = self._nested_shared_local_definition(pub_id)
        payload = self._test_payload_with_function_instance(local)
        resp = client.post("/tests", json=payload)
        assert resp.status_code in (200, 201), resp.text

    def test_post_tests_nested_shared_unknown_id_returns_422(self, client: TestClient) -> None:
        # Validation stays on: an unknown nested Shared id is
        # still surfaced as missing_function_id.
        local = self._nested_shared_local_definition(str(uuid.uuid4()))
        payload = self._test_payload_with_function_instance(local)
        resp = client.post("/tests", json=payload)
        assert resp.status_code == 422, resp.text
        assert _has_code(resp.json(), "MISSING_FUNCTION_ID")


# ---------------------------------------------------------------------------
# Declaration rules reach the library save and the Test save as 422
# (REQ-3.1.2.4, REQ-3.1.2.10, REQ-3.1.2.11)
# ---------------------------------------------------------------------------


def _level(**fields: Any) -> dict[str, Any]:
    """A well-formed String enum input ``level`` with ``fields`` laid over it."""
    return {
        "name": "level",
        "type": "string",
        "required": True,
        "enumValues": ["low", "high"],
        "default": "low",
        **fields,
    }


_OLD_ARRAY_ENUM = {
    "name": "level",
    "type": "array",
    "required": True,
    "enumValueType": "string",
    "enumValues": ["low", "high"],
}
_ENUM_INPUT_TYPE = (
    "ENUM_INPUT_TYPE",
    "Enum input 'level' must be of type string, integer or float",
)

_DECLARATION_CASES = [
    pytest.param({"inputs": [_OLD_ARRAY_ENUM]}, _ENUM_INPUT_TYPE, id="old-array-enum"),
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
        {"inputs": [_level(type="integer", enumValues=[1, "abc"], default=1)]},
        ("ENUM_VALUE_TYPE", "Allowed value 'abc' of enum input 'level' is not a valid integer"),
        id="enum-value-type",
    ),
    pytest.param(
        {"inputs": [_level(enumValues=["", "low"])]},
        ("ENUM_VALUE_EMPTY", "Enum input 'level' has an empty allowed value"),
        id="enum-value-empty",
    ),
    pytest.param(
        {"inputs": [_level(enumValues=["low", "low"])]},
        (
            "ENUM_VALUE_REPEATED",
            "Allowed value 'low' of enum input 'level' is listed more than once",
        ),
        id="enum-value-repeated",
    ),
    pytest.param(
        {"inputs": [_level(default=None)]},
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
        {"inputs": [_level(secret=True)]},
        ("SECRET_ENUM_INPUT", "Input 'level' cannot be both secret and an enum"),
        id="secret-enum",
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
        {
            "inputs": [{"name": "id", "type": "string", "required": False}],
            "variables": [{"name": "id", "type": "string", "value": "x"}],
        },
        (
            "DUPLICATE_PARAMETER_NAME",
            "Function declares 'id' as both an input and a local variable",
        ),
        id="input-and-local",
    ),
    pytest.param(
        {
            "outputs": [{"name": "id", "type": "string"}],
            "variables": [{"name": "id", "type": "string", "value": "x"}],
        },
        (
            "DUPLICATE_PARAMETER_NAME",
            "Function declares 'id' as both an output and a local variable",
        ),
        id="output-and-local",
    ),
    pytest.param(
        {
            "variables": [
                {"name": "n", "type": "integer", "value": 1},
                {"name": "n", "type": "integer", "value": 2},
            ]
        },
        ("DUPLICATE_VARIABLE_NAME", "Function declares local variable 'n' more than once"),
        id="local-twice",
    ),
]

# One of each declaration a save accepts.
_WELL_FORMED_DECLARATIONS: dict[str, Any] = {
    "inputs": [
        _level(description="How loud"),
        {"name": "count", "type": "integer", "required": True, "default": 3},
        {"name": "flag", "type": "boolean", "required": True, "default": False},
        {"name": "verbose", "type": "boolean", "required": False, "default": True},
        {"name": "tok", "type": "string", "required": False, "secret": True},
    ],
    "outputs": [{"name": "result", "type": "string"}],
    "variables": [{"name": "step", "type": "integer", "value": 1}],
}
_WELL_FORMED_VALUES = {"level": "low", "count": 3, "flag": True}


def _declaring_body(**declarations: Any) -> dict[str, Any]:
    return _make_function_payload(
        name="declares",
        workflow={
            "nodes": [_make_log_node("n-1")],
            "edges": [{"source": "start-node", "target": "n-1"}],
        },
        **declarations,
    )


def _test_holding(
    local_definition: dict[str, Any],
    values: dict[str, Any],
    *,
    expression_fields: list[str] | None = None,
    template_fields: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "name": f"declarations-{uuid.uuid4().hex[:8]}",
        "version": "1.0.0",
        "description": "",
        "tags": [],
        "variables": {},
        "workflow": {
            "nodes": [
                {
                    "id": "fn-1",
                    "type": "workflowNode",
                    "position": {"x": 0, "y": 0},
                    "data": {
                        "label": "fn-1",
                        "elementType": "function",
                        "nodeType": "function",
                        "version": "1.0.0",
                        "functionLifecycle": "local",
                        "localDefinition": local_definition,
                        "expressionFields": expression_fields or [],
                        "templateFields": template_fields or [],
                        "config": {"values": values, "profileBindings": [], "outputBindings": {}},
                    },
                }
            ],
            "edges": [{"source": "start-node", "target": "fn-1"}],
        },
    }


def _issue(body: dict[str, Any], expected: tuple[str, str]) -> dict[str, Any]:
    """The one `error.details` entry carrying ``expected`` (code, message)."""
    found = [d for d in _details(body) if (d.get("code"), d.get("message")) == expected]
    assert len(found) == 1, body
    return found[0]


class TestDeclarationRulesReachEverySave:
    """Enum rules, the true/false default and one name per Function are refused at
    the library save and at the Test save, each with its exact message."""

    @pytest.mark.parametrize(("declarations", "expected"), _DECLARATION_CASES)
    def test_post_functions_refuses_it(
        self, client: TestClient, declarations: dict[str, Any], expected: tuple[str, str]
    ) -> None:
        resp = client.post("/functions", json=_declaring_body(**declarations))

        assert resp.status_code == 422, resp.text
        assert _issue(resp.json(), expected)["severity"] == "error"

    @pytest.mark.parametrize(("declarations", "expected"), _DECLARATION_CASES)
    def test_post_tests_refuses_it_on_the_local_function_block(
        self, client: TestClient, declarations: dict[str, Any], expected: tuple[str, str]
    ) -> None:
        payload = _test_holding(_declaring_body(**declarations), {})

        resp = client.post("/tests", json=payload)

        assert resp.status_code == 422, resp.text
        assert _issue(resp.json(), expected)["node_id"] == "fn-1"

    @pytest.mark.parametrize(("declarations", "expected"), _DECLARATION_CASES)
    def test_put_tests_refuses_it_on_the_local_function_block(
        self, client: TestClient, declarations: dict[str, Any], expected: tuple[str, str]
    ) -> None:
        created = client.post("/tests", json=_test_holding(_declaring_body(), {}))
        assert created.status_code in (200, 201), created.text
        test_id = created.json()["data"]["id"]
        broken = _test_holding(_declaring_body(**declarations), {})

        resp = client.put(f"/tests/{test_id}", json={"workflow": broken["workflow"]})

        assert resp.status_code == 422, resp.text
        assert _issue(resp.json(), expected)["node_id"] == "fn-1"

    def test_post_functions_accepts_well_formed_declarations(self, client: TestClient) -> None:
        resp = client.post("/functions", json=_declaring_body(**_WELL_FORMED_DECLARATIONS))

        assert resp.status_code == 201, resp.text

    def test_post_tests_accepts_well_formed_declarations(self, client: TestClient) -> None:
        payload = _test_holding(_declaring_body(**_WELL_FORMED_DECLARATIONS), _WELL_FORMED_VALUES)

        resp = client.post("/tests", json=payload)

        assert resp.status_code in (200, 201), resp.text

    def test_post_functions_refuses_an_input_name_starting_with_an_underscore(
        self, client: TestClient
    ) -> None:
        payload = _declaring_body(inputs=[{"name": "_id", "type": "string", "required": False}])

        resp = client.post("/functions", json=payload)

        assert resp.status_code == 422, resp.text
        assert resp.json()["error"]["message"] == (
            "Function input '_id' has invalid name; must match pattern '^[a-zA-Z][a-zA-Z0-9_]*$'"
        )

    def test_promoting_a_stored_old_array_enum_is_refused(self, client: TestClient) -> None:
        from wavecore.api.services.tests import service as test_service

        test_id = str(uuid.uuid4())
        stored = _test_holding(_declaring_body(inputs=[_OLD_ARRAY_ENUM]), {})
        # Written straight to storage: the Test save itself would refuse it.
        test_service._save_test({**stored, "id": test_id, "metadata": {}})

        resp = client.post(
            f"/tests/{test_id}/functions/publish", json={"node_id": "fn-1", "name": "promoted"}
        )

        assert resp.status_code == 422, resp.text
        assert _issue(resp.json(), _ENUM_INPUT_TYPE)["severity"] == "error"

    @pytest.mark.parametrize("required", [True, False], ids=["required", "not-required"])
    def test_post_functions_accepts_a_secret_boolean_with_no_default(
        self, client: TestClient, required: bool
    ) -> None:
        flag = {"name": "flag", "type": "boolean", "required": required, "secret": True}

        resp = client.post("/functions", json=_declaring_body(inputs=[flag]))

        assert resp.status_code == 201, resp.text


def _published_function_id(client: TestClient) -> str:
    resp = client.post("/functions", json=_declaring_body())
    assert resp.status_code == 201, resp.text
    function_id: str = resp.json()["data"]["id"]
    return function_id


def _test_holding_draft(
    function_id: str, draft: dict[str, Any], values: dict[str, Any]
) -> dict[str, Any]:
    """A Test whose Shared Function Block ``fn-1`` is in edit mode on ``draft``."""
    payload = _test_holding(draft, values)
    data = payload["workflow"]["nodes"][0]["data"]
    del data["localDefinition"]
    data.update(
        functionLifecycle="shared",
        functionId=function_id,
        functionVersion="1.0.0",
        editMode=True,
        upstreamLink={"functionId": function_id, "sourceVersion": "1.0.0"},
        draft=draft,
    )
    return payload


class TestDeclarationRulesReachASharedFunctionBlockDraft:
    """A Test save refuses a malformed declaration in a Shared Function Block's edit-mode draft
    as it does in a Local body (REQ-3.1.2.4, REQ-3.1.2.11)."""

    @pytest.mark.parametrize(("declarations", "expected"), _DECLARATION_CASES)
    def test_post_tests_refuses_it(
        self, client: TestClient, declarations: dict[str, Any], expected: tuple[str, str]
    ) -> None:
        function_id = _published_function_id(client)
        payload = _test_holding_draft(function_id, _declaring_body(**declarations), {})

        resp = client.post("/tests", json=payload)

        assert resp.status_code == 422, resp.text
        assert _issue(resp.json(), expected)["node_id"] == "fn-1"

    @pytest.mark.parametrize(("declarations", "expected"), _DECLARATION_CASES)
    def test_put_tests_refuses_it(
        self, client: TestClient, declarations: dict[str, Any], expected: tuple[str, str]
    ) -> None:
        function_id = _published_function_id(client)
        created = client.post(
            "/tests", json=_test_holding_draft(function_id, _declaring_body(), {})
        )
        assert created.status_code in (200, 201), created.text
        test_id = created.json()["data"]["id"]
        broken = _test_holding_draft(function_id, _declaring_body(**declarations), {})

        resp = client.put(f"/tests/{test_id}", json={"workflow": broken["workflow"]})

        assert resp.status_code == 422, resp.text
        assert _issue(resp.json(), expected)["node_id"] == "fn-1"

    def test_post_tests_accepts_a_well_formed_draft(self, client: TestClient) -> None:
        function_id = _published_function_id(client)
        draft = _declaring_body(**_WELL_FORMED_DECLARATIONS)

        resp = client.post(
            "/tests", json=_test_holding_draft(function_id, draft, _WELL_FORMED_VALUES)
        )

        assert resp.status_code in (200, 201), resp.text


def _counting(**input_fields: Any) -> dict[str, Any]:
    """A Required integer input ``count`` with ``input_fields`` laid over it."""
    return {"name": "count", "type": "integer", "required": True, **input_fields}


_MISSING_COUNT = ("REQUIRED_PARAM_MISSING", "Required parameter 'count' is missing")


class TestALocalFunctionBlockGivesEveryRequiredInput:
    """A Test save refuses a Local Function Block that leaves a Required input with no value;
    the input's default never counts as one (REQ-3.1.2.4, REQ-3.1.2.10, REQ-3.1.2.11)."""

    @pytest.mark.parametrize(
        ("declared", "expected"),
        [
            pytest.param(_counting(), _MISSING_COUNT, id="no-default"),
            pytest.param(_counting(default=3), _MISSING_COUNT, id="with-default"),
            pytest.param(
                _level(),
                ("REQUIRED_PARAM_MISSING", "Required parameter 'level' is missing"),
                id="enum",
            ),
        ],
    )
    def test_post_tests_refuses_an_unbound_required_input(
        self, client: TestClient, declared: dict[str, Any], expected: tuple[str, str]
    ) -> None:
        payload = _test_holding(_declaring_body(inputs=[declared]), {})

        resp = client.post("/tests", json=payload)

        assert resp.status_code == 422, resp.text
        assert _issue(resp.json(), expected)["node_id"] == "fn-1"

    def test_put_tests_refuses_a_picked_value_the_narrowed_allowed_values_dropped(
        self, client: TestClient
    ) -> None:
        wide = _declaring_body(inputs=[_level(enumValues=["low", "mid", "high"])])
        created = client.post("/tests", json=_test_holding(wide, {"level": "mid"}))
        assert created.status_code in (200, 201), created.text
        test_id = created.json()["data"]["id"]
        narrowed = _test_holding(_declaring_body(inputs=[_level()]), {})

        resp = client.put(f"/tests/{test_id}", json={"workflow": narrowed["workflow"]})

        assert resp.status_code == 422, resp.text
        missing = ("REQUIRED_PARAM_MISSING", "Required parameter 'level' is missing")
        assert _issue(resp.json(), missing)["node_id"] == "fn-1"

    def test_post_tests_accepts_a_muted_block_with_an_unbound_required_input(
        self, client: TestClient
    ) -> None:
        payload = _test_holding(_declaring_body(inputs=[_counting()]), {})
        payload["workflow"]["nodes"][0]["data"]["disabled"] = True

        resp = client.post("/tests", json=payload)

        assert resp.status_code in (200, 201), resp.text

    @pytest.mark.parametrize(
        ("value", "expression_fields"),
        [pytest.param(4, [], id="literal"), pytest.param("base + 1", ["count"], id="expression")],
    )
    def test_post_tests_accepts_a_required_input_given_a_value(
        self, client: TestClient, value: Any, expression_fields: list[str]
    ) -> None:
        payload = _test_holding(
            _declaring_body(inputs=[_counting(default=3)]),
            {"count": value},
            expression_fields=expression_fields,
        )
        payload["variables"] = {"base": {"type": "integer", "value": 2}}

        resp = client.post("/tests", json=payload)

        assert resp.status_code in (200, 201), resp.text


def _optional(name: str, value_type: str) -> dict[str, Any]:
    return {"name": name, "type": value_type, "required": False}


class TestRootFlowFunctionBlockFieldsAtTestSave:
    """A Function Block on the Test canvas goes through the one field check every Block uses;
    the block named in the message is its Function (REQ-3.1.1.5, REQ-3.1.2.4)."""

    @pytest.mark.parametrize(
        ("inputs", "values", "expected"),
        [
            pytest.param(
                [_optional("count", "integer")],
                {"count": "many"},
                (
                    "INVALID_SETTING_TYPE",
                    "Setting 'count' of block 'declares' expects integer, got string",
                ),
                id="wrong-type",
            ),
            pytest.param(
                [_level()],
                {"level": "mid"},
                (
                    "INVALID_ENUM_VALUE",
                    "Setting 'level' of block 'declares' must be one of: low, high",
                ),
                id="not-allowed",
            ),
            pytest.param(
                [_optional("count", "integer")],
                {"nope": 1},
                ("UNKNOWN_SETTING", "Block 'declares' has no setting 'nope'"),
                id="unknown-field",
            ),
        ],
    )
    def test_post_tests_refuses_a_field_value(
        self,
        client: TestClient,
        inputs: list[dict[str, Any]],
        values: dict[str, Any],
        expected: tuple[str, str],
    ) -> None:
        payload = _test_holding(_declaring_body(inputs=inputs), values)

        resp = client.post("/tests", json=payload)

        assert resp.status_code == 422, resp.text
        assert _issue(resp.json(), expected)["node_id"] == "fn-1"

    def test_post_tests_refuses_a_blank_map_entry_expression(self, client: TestClient) -> None:
        payload = _test_holding(
            _declaring_body(inputs=[_optional("headers", "map")]),
            {"headers": {"X-Id": "  "}},
            expression_fields=["headers.X-Id"],
        )

        resp = client.post("/tests", json=payload)

        assert resp.status_code == 422, resp.text
        expected = ("REQUIRED_PARAM_EMPTY", "'X-Id' in 'headers' is required")
        assert _issue(resp.json(), expected)["node_id"] == "fn-1"

    def test_post_tests_refuses_an_undeclared_name_in_a_map_entry_expression(
        self, client: TestClient
    ) -> None:
        payload = _test_holding(
            _declaring_body(inputs=[_optional("headers", "map")]),
            {"headers": {"X-Id": "nope"}},
            expression_fields=["headers.X-Id"],
        )

        resp = client.post("/tests", json=payload)

        assert resp.status_code == 422, resp.text
        expected = (
            "UNDECLARED_VARIABLE",
            "Variable 'nope' is used in 1 block(s) but not declared in variable manager",
        )
        assert _issue(resp.json(), expected)["node_id"] == "fn-1"

    def test_post_tests_refuses_an_undeclared_name_in_a_list_item_expression(
        self, client: TestClient
    ) -> None:
        # A plain list item's {x} is flagged by its index: "<input>.<index>".
        payload = _test_holding(
            _declaring_body(inputs=[_optional("tags", "array")]),
            {"tags": ["a", "nope"]},
            expression_fields=["tags.1"],
        )

        resp = client.post("/tests", json=payload)

        assert resp.status_code == 422, resp.text
        expected = (
            "UNDECLARED_VARIABLE",
            "Variable 'nope' is used in 1 block(s) but not declared in variable manager",
        )
        assert _issue(resp.json(), expected)["node_id"] == "fn-1"

    def test_post_tests_refuses_a_blank_list_item_expression(self, client: TestClient) -> None:
        payload = _test_holding(
            _declaring_body(inputs=[_optional("tags", "array")]),
            {"tags": ["a", "  "]},
            expression_fields=["tags.1"],
        )

        resp = client.post("/tests", json=payload)

        assert resp.status_code == 422, resp.text
        expected = ("REQUIRED_PARAM_EMPTY", "Row 2 in 'tags' is required")
        assert _issue(resp.json(), expected)["node_id"] == "fn-1"

    def test_a_list_item_expression_is_saved_and_kept(self, client: TestClient) -> None:
        payload = _test_holding(
            _declaring_body(inputs=[_optional("tags", "array")]),
            {"tags": ["a", "suffix"]},
            expression_fields=["tags.1"],
        )
        payload["variables"] = {"suffix": {"type": "string", "value": "b"}}

        created = client.post("/tests", json=payload)
        assert created.status_code in (200, 201), created.text
        stored = client.get(f"/tests/{created.json()['data']['id']}").json()["data"]

        (node,) = stored["workflow"]["nodes"]
        assert node["data"]["config"]["values"] == {"tags": ["a", "suffix"]}
        assert node["data"]["expressionFields"] == ["tags.1"]

    def test_post_tests_refuses_a_required_input_given_null(self, client: TestClient) -> None:
        payload = _test_holding(_declaring_body(inputs=[_counting()]), {"count": None})

        resp = client.post("/tests", json=payload)

        assert resp.status_code == 422, resp.text
        assert _issue(resp.json(), _MISSING_COUNT)["node_id"] == "fn-1"

    def test_post_tests_accepts_a_required_input_given_zero(self, client: TestClient) -> None:
        payload = _test_holding(_declaring_body(inputs=[_counting()]), {"count": 0})

        resp = client.post("/tests", json=payload)

        assert resp.status_code in (200, 201), resp.text

    def test_a_template_on_a_whole_string_input_is_saved_and_kept(self, client: TestClient) -> None:
        payload = _test_holding(
            _declaring_body(inputs=[_optional("greeting", "string")]),
            {"greeting": "Hi {{ who }}"},
            template_fields=["greeting"],
        )
        payload["variables"] = {"who": {"type": "string", "value": "ann"}}

        created = client.post("/tests", json=payload)
        assert created.status_code in (200, 201), created.text
        stored = client.get(f"/tests/{created.json()['data']['id']}").json()["data"]

        (node,) = stored["workflow"]["nodes"]
        assert node["data"]["config"]["values"] == {"greeting": "Hi {{ who }}"}
        assert node["data"]["templateFields"] == ["greeting"]
        assert "inputBindings" not in node["data"]


def _chained(*nodes: dict[str, Any]) -> dict[str, Any]:
    """A Function flow that runs ``nodes`` one after another."""
    ids = ["start-node", *(node["id"] for node in nodes)]
    return {
        "nodes": list(nodes),
        "edges": [
            {"source": source, "target": target}
            for source, target in zip(ids, ids[1:], strict=False)
        ],
    }


def _shared_block(node_id: str, function_id: str, values: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": node_id,
            "elementType": "function",
            "nodeType": "function",
            "version": "1.0.0",
            "functionLifecycle": "shared",
            "functionId": function_id,
            "functionVersion": "1.0.0",
            "config": {"values": values, "profileBindings": [], "outputBindings": {}},
        },
    }


def _setter(node_id: str, rows: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": node_id,
            "elementType": "variable-setter",
            "nodeType": "control",
            "version": "1.0.0",
            "config": {"values": {"variables": rows}, "profileBindings": [], "outputBindings": {}},
        },
    }


class TestFunctionFlowChecksReachPostFunctions:
    """POST /functions runs the root flow's Block checks over the Function flow (REQ-3.1.2.4)."""

    def test_a_muted_block_with_a_missing_setting_saves(self, client: TestClient) -> None:
        muted = _make_log_node("n-1")
        muted["data"]["config"]["values"] = {"level": "INFO"}
        muted["data"]["disabled"] = True

        resp = client.post("/functions", json=_make_function_payload(workflow=_chained(muted)))

        assert resp.status_code == 201, resp.text

    def test_an_unknown_control_returns_422(self, client: TestClient) -> None:
        unknown = _setter("x-1", {})
        unknown["data"]["elementType"] = "x"

        resp = client.post("/functions", json=_make_function_payload(workflow=_chained(unknown)))

        assert resp.status_code == 422, resp.text
        expected = ("UNKNOWN_BLOCK_TYPE", "Unknown block type: 'x'")
        assert _issue(resp.json(), expected)["node_id"] == "x-1"

    def test_a_nested_shared_block_missing_a_required_input_returns_422(
        self, client: TestClient
    ) -> None:
        published = client.post(
            "/functions",
            json=_make_function_payload(
                name="greet",
                inputs=[{"name": "who", "type": "string", "required": True}],
                workflow=_chained(_make_log_node("n-1", message="who")),
            ),
        )
        assert published.status_code == 201, published.text
        nested = _shared_block("fn-1", published.json()["data"]["id"], {})

        resp = client.post(
            "/functions", json=_make_function_payload(name="outer", workflow=_chained(nested))
        )

        assert resp.status_code == 422, resp.text
        expected = ("REQUIRED_PARAM_MISSING", "Required parameter 'who' is missing")
        assert _issue(resp.json(), expected)["node_id"] == "fn-1"

    def test_a_setter_writing_an_input_returns_422(self, client: TestClient) -> None:
        payload = _make_function_payload(
            inputs=[_optional("x", "string")], workflow=_chained(_setter("set-1", {"x": "v"}))
        )

        resp = client.post("/functions", json=payload)

        assert resp.status_code == 422, resp.text
        expected = ("INPUT_WRITE_FORBIDDEN", "Writes to declared input 'x'; inputs are read-only")
        assert _issue(resp.json(), expected)["node_id"] == "set-1"

    def test_an_undeclared_template_marker_returns_422(self, client: TestClient) -> None:
        log = _make_log_node("n-1", message="Hi {{ nope }}")
        log["data"]["expressionFields"] = []
        log["data"]["templateFields"] = ["message"]

        resp = client.post("/functions", json=_make_function_payload(workflow=_chained(log)))

        assert resp.status_code == 422, resp.text
        expected = (
            "UNRESOLVED_VARIABLE_REFERENCE",
            "Variable 'nope' is not defined in this Function's scope "
            "(inputs, outputs, and local variables)",
        )
        assert _issue(resp.json(), expected)["node_id"] == "n-1"


class TestFunctionNumbersFollowTheOneRuleAtSave:
    """POST /functions holds every declared and literal number to the one rule (REQ-3.1.3.14)."""

    @pytest.mark.parametrize(
        ("declarations", "expected"),
        [
            (
                {"inputs": [{"name": "n", "type": "integer", "required": False, "default": "1e3"}]},
                "Default for input 'n' is not a valid integer",
            ),
            (
                {"outputs": [{"name": "total", "type": "float", "default": "NaN"}]},
                "Default for output 'total' is not a valid float",
            ),
            (
                {
                    "variables": [
                        {"name": "big", "type": "integer", "value": "12345678901234567890"}
                    ]
                },
                "Value for local variable 'big' allows at most 19 digits, got 20",
            ),
        ],
        ids=["input-default", "output-default", "local-value"],
    )
    def test_a_declared_value_that_breaks_the_rule_returns_422(
        self, client: TestClient, declarations: dict[str, Any], expected: str
    ) -> None:
        resp = client.post("/functions", json=_declaring_body(**declarations))

        assert resp.status_code == 422, resp.text
        assert _issue(resp.json(), ("INVALID_VARIABLE_VALUE", expected))["severity"] == "error"

    def test_a_literal_setter_row_that_breaks_the_rule_returns_422(
        self, client: TestClient
    ) -> None:
        setter = _setter("set-1", {"n": "1e3"})
        setter["data"]["variableTypes"] = {"n": "integer"}
        payload = _make_function_payload(
            variables=[{"name": "n", "type": "integer", "value": "1"}],
            workflow=_chained(setter),
        )

        resp = client.post("/functions", json=payload)

        assert resp.status_code == 422, resp.text
        expected = ("INVALID_VARIABLE_VALUE", "Value for variable 'n' is not a valid integer")
        assert _issue(resp.json(), expected)["node_id"] == "set-1"

    def test_a_muted_block_keeps_its_literal_rows_unchecked(self, client: TestClient) -> None:
        setter = _setter("set-1", {"n": "1e3"})
        setter["data"]["variableTypes"] = {"n": "integer"}
        setter["data"]["disabled"] = True
        payload = _make_function_payload(
            variables=[{"name": "n", "type": "integer", "value": "1"}],
            workflow=_chained(setter),
        )

        resp = client.post("/functions", json=payload)

        assert resp.status_code == 201, resp.text


def _remote_execution_workflow() -> dict[str, Any]:
    """A Remote Execution on the Function's `sid` input, its body a Log, then a Log."""
    return {
        "nodes": [
            {
                "id": "rex",
                "type": "workflowNode",
                "data": {
                    "label": "Remote Execution",
                    "elementType": "remote-execution",
                    "nodeType": "plugin",
                    "version": "1.0.0",
                    "config": {
                        "values": {"session_id": "sid"},
                        "profileBindings": [],
                        "outputBindings": {},
                    },
                    "expressionFields": ["session_id"],
                    "templateFields": [],
                    "variableExpressionKeys": [],
                },
            },
            _make_log_node("in-body"),
            _make_log_node("after"),
        ],
        "edges": [
            {"source": "start-node", "target": "rex"},
            {"source": "rex", "target": "in-body", "sourceHandle": "body"},
            {"source": "rex", "target": "after", "sourceHandle": "then"},
        ],
    }


class TestRemoteExecutionInAFunctionBody:
    """The Function library accepts a Remote Execution body the Test surface accepts (FV:31)."""

    def test_post_functions_accepts_it(self, client: TestClient) -> None:
        payload = _make_function_payload(
            name="remote_caller",
            inputs=[{"name": "sid", "type": "string", "required": True}],
            workflow=_remote_execution_workflow(),
        )

        resp = client.post("/functions", json=payload)

        assert resp.status_code == 201, resp.text

    def test_the_reference_check_reports_nothing_for_it(self) -> None:
        from wavecore.api.services.functions._storage import _validate_references

        issues = _validate_references({"workflow": _remote_execution_workflow()})

        assert issues == []


class TestLoadLibraryIndexResilience:
    """`load_library_index` swallows per-entry version-index errors so one
    corrupted library entry cannot poison the save pipeline (service.py 103-104)."""

    def test_records_no_available_versions_when_list_versions_raises(
        self, client: TestClient
    ) -> None:
        from unittest.mock import patch

        from wavecore.api.services.functions.service import load_library_index

        pub = client.post(
            "/functions",
            json=_make_function_payload(
                name="for_missing_index",
                workflow={
                    "nodes": [_make_log_node("n")],
                    "edges": [{"source": "start-node", "target": "n"}],
                },
            ),
        )
        assert pub.status_code == 201, pub.text
        pub_id = pub.json()["data"]["id"]

        with patch(
            "wavecore.api.services.functions._storage.list_versions",
            side_effect=LookupError("simulated"),
        ):
            library = load_library_index()

        assert library[pub_id]["available_versions"] == []

    def test_returns_the_whole_library_when_a_stored_name_is_not_a_string(
        self, client: TestClient, temp_storage_path: Path
    ) -> None:
        """The index build reads ids, never names, so a non-string name is inert."""
        import yaml

        from wavecore.api.services.functions.service import load_library_index

        ids = []
        for i in range(3):
            pub = client.post("/functions", json=_make_function_payload(name=f"named_{i}"))
            assert pub.status_code == 201, pub.text
            ids.append(pub.json()["data"]["id"])

        index_path = temp_storage_path / "functions" / ids[0] / "index.yaml"
        index = yaml.safe_load(index_path.read_text())
        index["name"] = 42
        index_path.write_text(yaml.safe_dump(index, sort_keys=False))

        library = load_library_index()

        assert set(library) == set(ids)


pytestmark = pytest.mark.usefixtures("temp_storage_path")
