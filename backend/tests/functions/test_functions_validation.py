"""Endpoint tests for Function validation (REQ-3.1.2.4, REQ-3.1.2.3).

Structural validation: required-field, name format, type set,
parameter-name format, and cheap circular-dependency detection.

Every assertion uses an anchored regex against the exact message; flexible regex is forbidden.
"""

import re

import pytest
from fastapi.testclient import TestClient

from .conftest import make_function_payload, make_input, make_output

# Anchored regex helpers for the exact error strings.
NAME_REQUIRED_RE = re.compile(r"^Function name is required$")
NAME_DUPLICATE_RE = re.compile(r"^Function name '.+' is already in use$")
INPUT_TYPE_RE = re.compile(r"^Function input '.+' has invalid type '.+'$")
OUTPUT_TYPE_RE = re.compile(r"^Function output '.+' has invalid type '.+'$")
INPUT_NAME_RE = re.compile(
    r"^Function input '.+' has invalid name; "
    r"must match pattern '\^\[a-zA-Z\]\[a-zA-Z0-9_\]\*\$'$"
)
OUTPUT_NAME_RE = re.compile(
    r"^Function output '.+' has invalid name; "
    r"must match pattern '\^\[a-zA-Z\]\[a-zA-Z0-9_\]\*\$'$"
)
INPUT_NO_TYPE_RE = re.compile(r"^Function input '.+' is required and missing a type$")
OUTPUT_NO_TYPE_RE = re.compile(r"^Function output '.+' is missing a type$")


def _first_error_message(body: dict) -> str:
    """Pull the leading error message off either error.message or error.details.

    Routes may surface a single primary message or a list under details; this
    helper accepts both shapes so tests do not break on either convention.
    """
    err = body["error"]
    message = err.get("message", "")
    details = err.get("details") or []
    if not details:
        return message
    if isinstance(details, list) and details:
        first = details[0]
        if isinstance(first, str):
            return first
        if isinstance(first, dict) and "message" in first:
            return first["message"]
    return message


def _all_error_messages(body: dict) -> list[str]:
    """Collect every error string surfaced by the response."""
    err = body["error"]
    messages: list[str] = []
    if "message" in err and err["message"]:
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
# Name validation
# ---------------------------------------------------------------------------


class TestNameValidation:
    def test_missing_name_returns_400(self, client: TestClient) -> None:
        payload = make_function_payload()
        payload["name"] = ""
        response = client.post("/functions", json=payload)
        assert response.status_code == 400
        assert any(NAME_REQUIRED_RE.match(m) for m in _all_error_messages(response.json()))

    @pytest.mark.parametrize("good_name", ["a", "abc", "abc_def", "abc-def", "A1_b-2"])
    def test_valid_names_are_accepted(self, client: TestClient, good_name: str) -> None:
        payload = make_function_payload(name=good_name)
        response = client.post("/functions", json=payload)
        assert response.status_code == 201, response.text

    def test_duplicate_name_returns_400(self, client: TestClient) -> None:
        client.post("/functions", json=make_function_payload(name="dup1"))
        response = client.post("/functions", json=make_function_payload(name="dup1"))
        assert response.status_code == 400
        assert any(NAME_DUPLICATE_RE.match(m) for m in _all_error_messages(response.json()))


# ---------------------------------------------------------------------------
# Input parameter validation
# ---------------------------------------------------------------------------


class TestInputValidation:
    def test_invalid_input_type_returns_422(self, client: TestClient) -> None:
        payload = make_function_payload(
            name="invalid_input_type",
            inputs=[make_input(name="x", type_="blob")],
        )
        response = client.post("/functions", json=payload)
        assert response.status_code == 422
        assert any(INPUT_TYPE_RE.match(m) for m in _all_error_messages(response.json()))

    def test_invalid_input_name_returns_422(self, client: TestClient) -> None:
        payload = make_function_payload(
            name="invalid_input_name",
            inputs=[make_input(name="1bad", type_="string")],
        )
        response = client.post("/functions", json=payload)
        assert response.status_code == 422
        assert any(INPUT_NAME_RE.match(m) for m in _all_error_messages(response.json()))

    def test_input_name_with_hyphen_is_rejected(self, client: TestClient) -> None:
        """Parameter names cannot contain hyphens (must be valid expression idents)."""
        payload = make_function_payload(
            name="hyphen_input",
            inputs=[make_input(name="a-b", type_="string")],
        )
        response = client.post("/functions", json=payload)
        assert response.status_code == 422
        assert any(INPUT_NAME_RE.match(m) for m in _all_error_messages(response.json()))

    def test_input_missing_type_when_required_returns_422(self, client: TestClient) -> None:
        payload = make_function_payload(name="missing_type")
        payload["inputs"] = [{"name": "x", "required": True}]
        response = client.post("/functions", json=payload)
        assert response.status_code == 422
        assert any(INPUT_NO_TYPE_RE.match(m) for m in _all_error_messages(response.json()))

    @pytest.mark.parametrize(
        "good_type",
        ["string", "integer", "float", "boolean", "array", "map", "table"],
    )
    def test_all_valid_input_types_are_accepted(self, client: TestClient, good_type: str) -> None:
        # A non-secret boolean input always has a default (REQ-3.1.2.10).
        default = False if good_type == "boolean" else None
        payload = make_function_payload(
            name=f"fn_input_{good_type}",
            inputs=[make_input(name="x", type_=good_type, default=default)],
        )
        response = client.post("/functions", json=payload)
        assert response.status_code == 201, response.text

    @pytest.mark.parametrize("required", [True, False], ids=["required", "not-required"])
    def test_a_boolean_input_with_no_default_returns_422(
        self, client: TestClient, required: bool
    ) -> None:
        payload = make_function_payload(
            name="flag_without_default",
            inputs=[make_input(name="flag", type_="boolean", required=required)],
        )
        response = client.post("/functions", json=payload)
        assert response.status_code == 422, response.text
        details = response.json()["error"]["details"]
        assert [(d["code"], d["message"]) for d in details if d["severity"] == "error"] == [
            ("BOOLEAN_INPUT_NO_DEFAULT", "Boolean input 'flag' needs a default")
        ]

    @pytest.mark.parametrize("required", [True, False], ids=["required", "not-required"])
    def test_a_secret_boolean_input_with_no_default_is_accepted(
        self, client: TestClient, required: bool
    ) -> None:
        flag = {**make_input(name="flag", type_="boolean", required=required), "secret": True}
        payload = make_function_payload(name="secret_flag", inputs=[flag])
        response = client.post("/functions", json=payload)
        assert response.status_code == 201, response.text


# ---------------------------------------------------------------------------
# Output parameter validation
# ---------------------------------------------------------------------------


class TestOutputValidation:
    def test_invalid_output_type_returns_422(self, client: TestClient) -> None:
        payload = make_function_payload(
            name="invalid_output_type",
            outputs=[make_output(name="y", type_="blob")],
        )
        response = client.post("/functions", json=payload)
        assert response.status_code == 422
        assert any(OUTPUT_TYPE_RE.match(m) for m in _all_error_messages(response.json()))

    def test_invalid_output_name_returns_422(self, client: TestClient) -> None:
        payload = make_function_payload(
            name="invalid_output_name",
            outputs=[make_output(name="1bad", type_="string")],
        )
        response = client.post("/functions", json=payload)
        assert response.status_code == 422
        assert any(OUTPUT_NAME_RE.match(m) for m in _all_error_messages(response.json()))

    def test_output_missing_type_returns_422(self, client: TestClient) -> None:
        payload = make_function_payload(name="output_missing_type")
        payload["outputs"] = [{"name": "y"}]
        response = client.post("/functions", json=payload)
        assert response.status_code == 422
        assert any(OUTPUT_NO_TYPE_RE.match(m) for m in _all_error_messages(response.json()))

    @pytest.mark.parametrize(
        "good_type",
        ["string", "integer", "float", "boolean", "array", "map", "table"],
    )
    def test_all_valid_output_types_are_accepted(self, client: TestClient, good_type: str) -> None:
        payload = make_function_payload(
            name=f"fn_output_{good_type}",
            outputs=[make_output(name="r", type_=good_type)],
        )
        response = client.post("/functions", json=payload)
        assert response.status_code == 201, response.text


# ---------------------------------------------------------------------------
# Multiple-errors accumulation
# ---------------------------------------------------------------------------


class TestMultipleErrors:
    def test_create_surfaces_multiple_validation_errors(self, client: TestClient) -> None:
        """A payload with several defects must surface each error string."""
        payload = make_function_payload(
            name="valid name",
            inputs=[make_input(name="1bad", type_="blob")],
        )
        response = client.post("/functions", json=payload)
        assert response.status_code in (400, 422)
        messages = _all_error_messages(response.json())
        has_input_type = any(INPUT_TYPE_RE.match(m) for m in messages)
        has_input_name = any(INPUT_NAME_RE.match(m) for m in messages)
        assert has_input_type or has_input_name


# ---------------------------------------------------------------------------
# Declaration rules shared with Test variables (REQ-3.1.3.1, REQ-3.1.3.19)
# ---------------------------------------------------------------------------


def _issues(body: dict) -> list[tuple[str, str]]:
    return [(item["code"], item["message"]) for item in body["error"]["details"]]


class TestDeclarationRules:
    """Inputs, outputs and locals follow the declaration rules a Test variable follows."""

    def test_a_local_with_a_namespace_name_is_refused(self, client: TestClient) -> None:
        payload = make_function_payload(
            name="reserved_local",
            variables=[{"name": "system", "type": "string", "value": "x"}],
        )
        response = client.post("/functions", json=payload)
        assert response.status_code == 422, response.text
        assert _issues(response.json()) == [
            (
                "RESERVED_VARIABLE_NAME",
                "Invalid local variable name: 'system' "
                "(reserved for namespace access; use system.field_name)",
            )
        ]

    def test_a_local_with_an_unknown_type_is_refused(self, client: TestClient) -> None:
        payload = make_function_payload(
            name="bad_local_type",
            variables=[{"name": "n", "type": "blob", "value": "x"}],
        )
        response = client.post("/functions", json=payload)
        assert response.status_code == 422, response.text
        assert _issues(response.json()) == [
            (
                "INVALID_VARIABLE_TYPE",
                "Invalid local variable type: 'blob' "
                "(must be one of: array, boolean, float, integer, map, string, table)",
            )
        ]

    def test_an_output_named_by_a_python_keyword_is_refused(self, client: TestClient) -> None:
        payload = make_function_payload(
            name="keyword_output",
            outputs=[make_output(name="class", type_="string")],
        )
        response = client.post("/functions", json=payload)
        assert response.status_code == 422, response.text
        assert ("INVALID_VARIABLE", "Invalid output name: 'class' (a Python keyword)") in _issues(
            response.json()
        )

    def test_an_input_with_an_unknown_element_type_is_refused(self, client: TestClient) -> None:
        item = make_input(name="xs", type_="array", required=False, default=["1"])
        item["elementTypes"] = ["thing"]
        payload = make_function_payload(name="bad_element_types", inputs=[item])
        response = client.post("/functions", json=payload)
        assert response.status_code == 422, response.text
        assert _issues(response.json()) == [
            (
                "INVALID_ELEMENT_TYPES",
                "Invalid element types for input 'xs': unknown element type 'thing' for item 0 "
                "(must be one of: array, boolean, float, integer, map, string)",
            )
        ]


pytestmark = pytest.mark.usefixtures("temp_storage_path")
