"""Unit tests for variable management endpoints (REQ-5.2.4.7).

This module tests the variable management endpoints providing unified access
to the hierarchical variable system enabling scope discovery, variable
manipulation, expression evaluation, and runtime variable watching.

Test Coverage:
- Scope discovery: List available variable scopes
- Variable retrieval: Entity-specific variable retrieval with metadata
- Variable modification: Set, update, delete operations
- Expression evaluation: Evaluate expressions with context
- Expression validation: Pre-flight syntax checking
- Variable watching: Debug-oriented watch functionality
- Secret handling: Masked values in responses
- Inheritance semantics: Hierarchical scoping
- Type system: Typed variables with metadata
- Error handling: Validation errors, not found, bad request
- Caching and performance: Cache headers
"""

import re
import uuid
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from tests.api.body_shape_support import NOT_OBJECT_BODIES, assert_refused, send_text
from wavecore.api.exceptions import NotFoundException, ValidationException


class TestListVariableScopesEndpoint:
    """Test suite for GET /variables/scopes endpoint (scope discovery)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_list_scopes_returns_200_with_ordered_scopes(self, client: TestClient) -> None:
        """Test that GET /variables/scopes returns ordered list of scopes."""
        with patch(
            "wavecore.api.routes.variables.routes.variable_service.list_scopes"
        ) as mock_list:
            mock_list.return_value = {"scopes": ["system", "regression", "suite", "test", "block"]}

            response = client.get("/variables/scopes")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["scopes"] == [
                "system",
                "regression",
                "suite",
                "test",
                "block",
            ]

    def test_list_scopes_returns_scopes_from_broadest_to_narrowest(
        self, client: TestClient
    ) -> None:
        """Test that scopes are ordered from broadest to narrowest (REQ-5.2.4.7)."""
        with patch(
            "wavecore.api.routes.variables.routes.variable_service.list_scopes"
        ) as mock_list:
            mock_list.return_value = {"scopes": ["system", "regression", "suite", "test", "block"]}

            response = client.get("/variables/scopes")

            assert response.status_code == 200
            data = response.json()
            scopes = data["data"]["scopes"]
            # Verify order: system is broadest, block is narrowest
            assert scopes.index("system") < scopes.index("regression")
            assert scopes.index("regression") < scopes.index("suite")
            assert scopes.index("suite") < scopes.index("test")
            assert scopes.index("test") < scopes.index("block")


class TestGetEntityVariablesEndpoint:
    """Test suite for GET /variables/{scope}/{entity_id} endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_variables_returns_200_with_variables(self, client: TestClient) -> None:
        """Test that GET /variables/{scope}/{entity_id} returns entity variables."""
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.variables.routes.variable_service.get_entity_variables"
        ) as mock_get:
            mock_get.return_value = {
                "variables": {
                    "username": {
                        "type": "string",
                        "value": "admin",
                        "secret": False,
                        "computed": False,
                    },
                    "timeout": {
                        "type": "integer",
                        "value": 30,
                        "secret": False,
                        "computed": False,
                    },
                }
            }

            response = client.get(f"/variables/test/{entity_id}")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert "username" in data["data"]["variables"]
            assert "timeout" in data["data"]["variables"]
            mock_get.assert_called_once_with("test", entity_id)

    def test_get_variables_includes_type_metadata(self, client: TestClient) -> None:
        """Test that response includes variable type information (REQ-5.2.4.7)."""
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.variables.routes.variable_service.get_entity_variables"
        ) as mock_get:
            mock_get.return_value = {
                "variables": {
                    "count": {
                        "type": "integer",
                        "value": 10,
                        "secret": False,
                        "computed": False,
                    },
                }
            }

            response = client.get(f"/variables/test/{entity_id}")

            assert response.status_code == 200
            data = response.json()
            assert data["data"]["variables"]["count"]["type"] == "integer"

    def test_get_variables_includes_secret_indicator(self, client: TestClient) -> None:
        """Test that response includes secret indicator (REQ-5.2.4.7)."""
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.variables.routes.variable_service.get_entity_variables"
        ) as mock_get:
            mock_get.return_value = {
                "variables": {
                    "api_key": {
                        "type": "string",
                        "value": "********",
                        "secret": True,
                        "computed": False,
                        "masked": True,
                    },
                }
            }

            response = client.get(f"/variables/test/{entity_id}")

            assert response.status_code == 200
            data = response.json()
            assert data["data"]["variables"]["api_key"]["secret"] is True
            assert data["data"]["variables"]["api_key"]["masked"] is True

    def test_get_variables_includes_computed_status(self, client: TestClient) -> None:
        """Test that response includes computed expression status (REQ-5.2.4.7)."""
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.variables.routes.variable_service.get_entity_variables"
        ) as mock_get:
            mock_get.return_value = {
                "variables": {
                    "total": {
                        "type": "integer",
                        "computed": True,
                        "expression": "count * price",
                        "secret": False,
                    },
                }
            }

            response = client.get(f"/variables/test/{entity_id}")

            assert response.status_code == 200
            data = response.json()
            assert data["data"]["variables"]["total"]["computed"] is True

    def test_get_variables_returns_404_when_entity_not_found(self, client: TestClient) -> None:
        """Test that GET returns 404 when entity not found (REQ-5.2.4.7)."""
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.variables.routes.variable_service.get_entity_variables"
        ) as mock_get:
            mock_get.return_value = None

            response = client.get(f"/variables/test/{entity_id}")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert re.match(
                rf"^Entity with ID '{entity_id}' not found in scope 'test'$",
                data["error"]["message"],
            )

    def test_get_variables_returns_400_for_invalid_scope(self, client: TestClient) -> None:
        """Test that GET returns 400 for invalid scope identifier (REQ-5.2.4.7)."""
        entity_id = str(uuid.uuid4())

        response = client.get(f"/variables/invalid_scope/{entity_id}")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert "Invalid scope" in data["error"]["message"]
        # Should enumerate valid scopes
        assert "system" in data["error"]["message"] or "valid" in data["error"]["message"].lower()

    def test_get_variables_validates_entity_id_format(self, client: TestClient) -> None:
        """Test that GET validates entity_id as valid UUID."""
        response = client.get("/variables/test/invalid-uuid-format")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Invalid UUID format for entity_id: 'invalid-uuid-format'$",
            data["error"]["message"],
        )


class TestSetEntityVariablesEndpoint:
    """Test suite for POST /variables/{scope}/{entity_id} endpoint (set/replace)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_set_variables_returns_200_on_success(self, client: TestClient) -> None:
        """Test that POST /variables/{scope}/{entity_id} sets variables."""
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.variables.routes.variable_service.set_entity_variables"
        ) as mock_set:
            mock_set.return_value = {
                "variables": {
                    "host": {"type": "string", "value": "localhost"},
                }
            }

            response = client.post(
                f"/variables/test/{entity_id}",
                json={
                    "variables": {
                        "host": {"type": "string", "value": "localhost"},
                    }
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert "host" in data["data"]["variables"]

    def test_set_variables_replaces_entire_collection(self, client: TestClient) -> None:
        """Test that POST replaces entire variable collection (REQ-5.2.4.7)."""
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.variables.routes.variable_service.set_entity_variables"
        ) as mock_set:
            mock_set.return_value = {
                "variables": {
                    "new_var": {"type": "string", "value": "new"},
                }
            }

            response = client.post(
                f"/variables/test/{entity_id}",
                json={
                    "variables": {
                        "new_var": {"type": "string", "value": "new"},
                    }
                },
            )

            assert response.status_code == 200
            # Verify service was called with replace semantics
            mock_set.assert_called_once()
            call_args = mock_set.call_args
            assert call_args[0][0] == "test"
            assert call_args[0][1] == entity_id

    def test_set_variables_validates_variable_names(self, client: TestClient) -> None:
        """Test that POST validates variable names (REQ-5.2.4.7)."""
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.variables.routes.variable_service.set_entity_variables"
        ) as mock_set:
            mock_set.side_effect = ValidationException(
                "Invalid variable name: '123invalid' (must match [a-zA-Z_][a-zA-Z0-9_]*)"
            )

            response = client.post(
                f"/variables/test/{entity_id}",
                json={
                    "variables": {
                        "123invalid": {"type": "string", "value": "bad"},
                    }
                },
            )

            assert response.status_code == 400
            data = response.json()
            assert data["success"] is False
            assert "Invalid variable name" in data["error"]["message"]

    def test_set_variables_validates_types(self, client: TestClient) -> None:
        """Test that POST validates variable types (REQ-5.2.4.7)."""
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.variables.routes.variable_service.set_entity_variables"
        ) as mock_set:
            mock_set.side_effect = ValidationException(
                "Invalid variable type: 'unknown_type' "
                "(must be one of: array, boolean, float, integer, map, string, table)"
            )

            response = client.post(
                f"/variables/test/{entity_id}",
                json={
                    "variables": {
                        "var": {"type": "unknown_type", "value": "value"},
                    }
                },
            )

            assert response.status_code == 400
            data = response.json()
            assert data["success"] is False
            assert "Invalid variable type" in data["error"]["message"]

    def test_set_variables_validates_expression_syntax(self, client: TestClient) -> None:
        """Test that POST validates expression syntax for computed variables."""
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.variables.routes.variable_service.set_entity_variables"
        ) as mock_set:
            mock_set.side_effect = ValidationException(
                "Invalid expression syntax for variable 'total': unclosed brace at position 5"
            )

            response = client.post(
                f"/variables/test/{entity_id}",
                json={
                    "variables": {
                        "total": {
                            "type": "integer",
                            "computed": True,
                            "expression": "count(",
                        },
                    }
                },
            )

            assert response.status_code == 400
            data = response.json()
            assert data["success"] is False
            assert "expression syntax" in data["error"]["message"].lower()

    def test_set_variables_requires_variables_field(self, client: TestClient) -> None:
        """Test that POST requires 'variables' field in request body."""
        entity_id = str(uuid.uuid4())

        response = client.post(
            f"/variables/test/{entity_id}",
            json={"other_field": "value"},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Field 'variables' is required$",
            data["error"]["message"],
        )


class TestUpdateEntityVariablesEndpoint:
    """Test suite for PATCH /variables/{scope}/{entity_id} endpoint (merge)."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_update_variables_returns_200_on_success(self, client: TestClient) -> None:
        """Test that PATCH /variables/{scope}/{entity_id} updates variables."""
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.variables.routes.variable_service.update_entity_variables"
        ) as mock_update:
            mock_update.return_value = {
                "variables": {
                    "existing": {"type": "string", "value": "kept"},
                    "new": {"type": "string", "value": "added"},
                }
            }

            response = client.patch(
                f"/variables/test/{entity_id}",
                json={
                    "variables": {
                        "new": {"type": "string", "value": "added"},
                    }
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True

    def test_update_variables_uses_merge_semantics(self, client: TestClient) -> None:
        """Test that PATCH uses merge semantics preserving unmentioned vars (REQ-5.2.4.7)."""
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.variables.routes.variable_service.update_entity_variables"
        ) as mock_update:
            mock_update.return_value = {
                "variables": {
                    "existing": {"type": "string", "value": "preserved"},
                    "new": {"type": "string", "value": "added"},
                }
            }

            response = client.patch(
                f"/variables/test/{entity_id}",
                json={
                    "variables": {
                        "new": {"type": "string", "value": "added"},
                    }
                },
            )

            assert response.status_code == 200
            data = response.json()
            # Both existing and new variables should be present
            assert "existing" in data["data"]["variables"]
            assert "new" in data["data"]["variables"]

    def test_update_variables_returns_404_when_entity_not_found(self, client: TestClient) -> None:
        """Test that PATCH returns 404 when entity not found."""
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.variables.routes.variable_service.update_entity_variables"
        ) as mock_update:
            mock_update.return_value = None

            response = client.patch(
                f"/variables/test/{entity_id}",
                json={
                    "variables": {
                        "var": {"type": "string", "value": "value"},
                    }
                },
            )

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False

    def test_update_variables_validates_type_consistency(self, client: TestClient) -> None:
        """Test that PATCH validates type consistency when modifying vars."""
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.variables.routes.variable_service.update_entity_variables"
        ) as mock_update:
            mock_update.side_effect = ValidationException(
                "Type mismatch for variable 'count': expected 'integer', got 'string'"
            )

            response = client.patch(
                f"/variables/test/{entity_id}",
                json={
                    "variables": {
                        "count": {"type": "string", "value": "not-a-number"},
                    }
                },
            )

            assert response.status_code == 400
            data = response.json()
            assert data["success"] is False
            assert "Type mismatch" in data["error"]["message"]


class TestDeleteVariableEndpoint:
    """Test suite for DELETE /variables/{scope}/{entity_id}/{name} endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_delete_variable_returns_204_on_success(self, client: TestClient) -> None:
        """Test that DELETE /variables/{scope}/{entity_id}/{name} removes variable."""
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.variables.routes.variable_service.delete_variable"
        ) as mock_delete:
            mock_delete.return_value = True

            response = client.delete(f"/variables/test/{entity_id}/my_variable")

            assert response.status_code == 204
            mock_delete.assert_called_once_with("test", entity_id, "my_variable")

    def test_delete_variable_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that DELETE returns 404 when variable not found (REQ-5.2.4.7)."""
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.variables.routes.variable_service.delete_variable"
        ) as mock_delete:
            mock_delete.return_value = False

            response = client.delete(f"/variables/test/{entity_id}/nonexistent")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert "not found" in data["error"]["message"].lower()

    def test_delete_variable_returns_404_when_entity_not_found(self, client: TestClient) -> None:
        """Test that DELETE returns 404 when entity not found."""
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.variables.routes.variable_service.delete_variable"
        ) as mock_delete:
            mock_delete.side_effect = NotFoundException(
                f"Entity with ID '{entity_id}' not found in scope 'test'"
            )

            response = client.delete(f"/variables/test/{entity_id}/some_var")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False


class TestEvaluateExpressionEndpoint:
    """Test suite for POST /variables/evaluate endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_evaluate_returns_200_with_result(self, client: TestClient) -> None:
        """Test that POST /variables/evaluate returns computed result."""
        with patch(
            "wavecore.api.routes.variables.routes.variable_service.evaluate_expression"
        ) as mock_eval:
            mock_eval.return_value = {"result": 42, "type": "integer"}

            response = client.post(
                "/variables/evaluate",
                json={"expression": "count * 2"},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["result"] == 42

    def test_evaluate_supports_variable_references(self, client: TestClient) -> None:
        """Test that evaluation supports hierarchical variable notation (REQ-5.2.4.7)."""
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.variables.routes.variable_service.evaluate_expression"
        ) as mock_eval:
            mock_eval.return_value = {"result": "hello world", "type": "string"}

            response = client.post(
                "/variables/evaluate",
                json={
                    "expression": "f'{greeting} {name}'",
                    "context": {
                        "scope": "test",
                        "entity_id": entity_id,
                    },
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True

    def test_evaluate_supports_arithmetic_operators(self, client: TestClient) -> None:
        """Test that evaluation supports arithmetic operators (REQ-5.2.4.7)."""
        with patch(
            "wavecore.api.routes.variables.routes.variable_service.evaluate_expression"
        ) as mock_eval:
            mock_eval.return_value = {"result": 15, "type": "integer"}

            response = client.post(
                "/variables/evaluate",
                json={
                    "expression": "a + b * c",
                    "context": {
                        "variables": {"a": 5, "b": 2, "c": 5},
                    },
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert data["data"]["result"] == 15

    def test_evaluate_supports_logical_operators(self, client: TestClient) -> None:
        """Test that evaluation supports logical operators (REQ-5.2.4.7)."""
        with patch(
            "wavecore.api.routes.variables.routes.variable_service.evaluate_expression"
        ) as mock_eval:
            mock_eval.return_value = {"result": True, "type": "boolean"}

            response = client.post(
                "/variables/evaluate",
                json={
                    "expression": "a > 5 and b < 10",
                    "context": {
                        "variables": {"a": 10, "b": 5},
                    },
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert data["data"]["result"] is True

    def test_evaluate_supports_string_formatting(self, client: TestClient) -> None:
        """Test that evaluation supports string formatting (REQ-5.2.4.7)."""
        with patch(
            "wavecore.api.routes.variables.routes.variable_service.evaluate_expression"
        ) as mock_eval:
            mock_eval.return_value = {
                "result": "User: admin, Role: tester",
                "type": "string",
            }

            response = client.post(
                "/variables/evaluate",
                json={
                    "expression": "f'User: {username}, Role: {role}'",
                    "context": {
                        "variables": {"username": "admin", "role": "tester"},
                    },
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert "admin" in data["data"]["result"]

    def test_evaluate_supports_builtin_functions(self, client: TestClient) -> None:
        """Test that evaluation supports built-in functions (REQ-5.2.4.7)."""
        with patch(
            "wavecore.api.routes.variables.routes.variable_service.evaluate_expression"
        ) as mock_eval:
            mock_eval.return_value = {"result": 15, "type": "integer"}

            response = client.post(
                "/variables/evaluate",
                json={
                    "expression": "sum(values)",
                    "context": {
                        "variables": {"values": [1, 2, 3, 4, 5]},
                    },
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert data["data"]["result"] == 15

    def test_evaluate_respects_scope_inheritance(self, client: TestClient) -> None:
        """Test that evaluation respects scope inheritance (REQ-5.2.4.7)."""
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.variables.routes.variable_service.evaluate_expression"
        ) as mock_eval:
            mock_eval.return_value = {"result": "inherited_value", "type": "string"}

            response = client.post(
                "/variables/evaluate",
                json={
                    "expression": "inherited_var",
                    "context": {
                        "scope": "test",
                        "entity_id": entity_id,
                    },
                },
            )

            assert response.status_code == 200

    def test_evaluate_returns_400_on_syntax_error(self, client: TestClient) -> None:
        """Test that evaluation returns 400 on expression syntax error."""
        with patch(
            "wavecore.api.routes.variables.routes.variable_service.evaluate_expression"
        ) as mock_eval:
            mock_eval.side_effect = ValidationException(
                "Invalid expression syntax: unclosed brace at position 5"
            )

            response = client.post(
                "/variables/evaluate",
                json={"expression": "unclosed("},
            )

            assert response.status_code == 400
            data = response.json()
            assert data["success"] is False
            assert "syntax" in data["error"]["message"].lower()

    def test_evaluate_requires_expression_field(self, client: TestClient) -> None:
        """Test that evaluation requires 'expression' field."""
        response = client.post(
            "/variables/evaluate",
            json={"context": {}},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Field 'expression' is required$",
            data["error"]["message"],
        )


class TestValidateExpressionEndpoint:
    """Test suite for POST /variables/validate-expression endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_validate_returns_200_for_valid_expression(self, client: TestClient) -> None:
        """Test that POST /variables/validate-expression validates syntax."""
        with patch(
            "wavecore.api.routes.variables.routes.variable_service.validate_expression"
        ) as mock_validate:
            mock_validate.return_value = {
                "valid": True,
                "errors": [],
                "warnings": [],
            }

            response = client.post(
                "/variables/validate-expression",
                json={"expression": "count * price"},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["valid"] is True

    def test_validate_returns_structural_correctness(self, client: TestClient) -> None:
        """Test that validation returns structural correctness (REQ-5.2.4.7)."""
        with patch(
            "wavecore.api.routes.variables.routes.variable_service.validate_expression"
        ) as mock_validate:
            mock_validate.return_value = {
                "valid": False,
                "errors": ["Unclosed brace at position 5"],
                "warnings": [],
            }

            response = client.post(
                "/variables/validate-expression",
                json={"expression": "bad("},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["data"]["valid"] is False
            assert len(data["data"]["errors"]) > 0

    def test_validate_identifies_undefined_references(self, client: TestClient) -> None:
        """Test that validation identifies undefined variable references (REQ-5.2.4.7)."""
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.variables.routes.variable_service.validate_expression"
        ) as mock_validate:
            mock_validate.return_value = {
                "valid": True,
                "errors": [],
                "warnings": ["Variable 'undefined_var' is not defined in context"],
            }

            response = client.post(
                "/variables/validate-expression",
                json={
                    "expression": "undefined_var",
                    "context": {
                        "scope": "test",
                        "entity_id": entity_id,
                    },
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert len(data["data"]["warnings"]) > 0

    def test_validate_reports_type_compatibility_warnings(self, client: TestClient) -> None:
        """Test that validation reports type compatibility warnings (REQ-5.2.4.7)."""
        with patch(
            "wavecore.api.routes.variables.routes.variable_service.validate_expression"
        ) as mock_validate:
            mock_validate.return_value = {
                "valid": True,
                "errors": [],
                "warnings": ["Type mismatch: 'string_var' is string but used in arithmetic"],
            }

            response = client.post(
                "/variables/validate-expression",
                json={
                    "expression": "string_var + 5",
                    "context": {
                        "variables": {"string_var": {"type": "string"}},
                    },
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert len(data["data"]["warnings"]) > 0

    def test_validate_is_idempotent(self, client: TestClient) -> None:
        """Test that validation operates without side effects (REQ-5.2.4.7)."""
        with patch(
            "wavecore.api.routes.variables.routes.variable_service.validate_expression"
        ) as mock_validate:
            mock_validate.return_value = {"valid": True, "errors": [], "warnings": []}

            # Call twice with same input
            response1 = client.post(
                "/variables/validate-expression",
                json={"expression": "x"},
            )
            response2 = client.post(
                "/variables/validate-expression",
                json={"expression": "x"},
            )

            assert response1.status_code == 200
            assert response2.status_code == 200
            # Compare data portion only - meta contains per-request values
            assert response1.json()["data"] == response2.json()["data"]

    def test_validate_requires_expression_field(self, client: TestClient) -> None:
        """Test that validation requires 'expression' field."""
        response = client.post(
            "/variables/validate-expression",
            json={},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Field 'expression' is required$",
            data["error"]["message"],
        )


class TestWatchVariablesEndpoint:
    """Test suite for POST /variables/watch endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_watch_returns_201_with_watch_id(self, client: TestClient) -> None:
        """Test that POST /variables/watch registers watch and returns ID."""
        watch_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.variables.routes.variable_service.register_watch"
        ) as mock_register:
            mock_register.return_value = {"watch_id": watch_id}

            response = client.post(
                "/variables/watch",
                json={
                    "variables": ["count", "total"],
                },
            )

            assert response.status_code == 201
            data = response.json()
            assert data["success"] is True
            assert data["data"]["watch_id"] == watch_id

    def test_watch_accepts_variable_paths(self, client: TestClient) -> None:
        """Test that watch accepts variable paths with scope qualifiers (REQ-5.2.4.7)."""
        watch_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.variables.routes.variable_service.register_watch"
        ) as mock_register:
            mock_register.return_value = {"watch_id": watch_id}

            response = client.post(
                "/variables/watch",
                json={
                    "variables": [
                        "test.my_test.count",
                        "suite.my_suite.config",
                    ],
                },
            )

            assert response.status_code == 201

    def test_watch_accepts_execution_context(self, client: TestClient) -> None:
        """Test that watch accepts execution context for real-time debugging."""
        watch_id = str(uuid.uuid4())
        execution_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.variables.routes.variable_service.register_watch"
        ) as mock_register:
            mock_register.return_value = {"watch_id": watch_id}

            response = client.post(
                "/variables/watch",
                json={
                    "variables": ["count"],
                    "execution_id": execution_id,
                },
            )

            assert response.status_code == 201

    def test_watch_requires_variables_field(self, client: TestClient) -> None:
        """Test that watch requires 'variables' field."""
        response = client.post(
            "/variables/watch",
            json={},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Field 'variables' is required$",
            data["error"]["message"],
        )

    def test_watch_returns_400_for_empty_variables_list(self, client: TestClient) -> None:
        """Test that watch returns 400 for empty variables list."""
        with patch(
            "wavecore.api.routes.variables.routes.variable_service.register_watch"
        ) as mock_register:
            mock_register.side_effect = ValidationException(
                "At least one variable path is required"
            )

            response = client.post(
                "/variables/watch",
                json={"variables": []},
            )

            assert response.status_code == 400
            data = response.json()
            assert data["success"] is False


class TestGetWatchedValuesEndpoint:
    """Test suite for GET /variables/watch/{watch_id} endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_watched_returns_200_with_values(self, client: TestClient) -> None:
        """Test that GET /variables/watch/{watch_id} returns current values."""
        watch_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.variables.routes.variable_service.get_watched_values"
        ) as mock_get:
            mock_get.return_value = {
                "values": {
                    "count": {"value": 42, "type": "integer"},
                    "total": {"value": 100, "type": "integer"},
                }
            }

            response = client.get(f"/variables/watch/{watch_id}")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["values"]["count"]["value"] == 42

    def test_get_watched_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that GET returns 404 for missing watch registration (REQ-5.2.4.7)."""
        watch_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.variables.routes.variable_service.get_watched_values"
        ) as mock_get:
            mock_get.return_value = None

            response = client.get(f"/variables/watch/{watch_id}")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert "not found" in data["error"]["message"].lower()

    def test_get_watched_validates_watch_id_format(self, client: TestClient) -> None:
        """Test that GET validates watch_id as valid UUID."""
        response = client.get("/variables/watch/invalid-uuid")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Invalid UUID format for watch_id: 'invalid-uuid'$",
            data["error"]["message"],
        )


class TestUnwatchVariablesEndpoint:
    """Test suite for DELETE /variables/watch/{watch_id} endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_unwatch_returns_204_on_success(self, client: TestClient) -> None:
        """Test that DELETE /variables/watch/{watch_id} unregisters watch."""
        watch_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.variables.routes.variable_service.unregister_watch"
        ) as mock_unregister:
            mock_unregister.return_value = True

            response = client.delete(f"/variables/watch/{watch_id}")

            assert response.status_code == 204

    def test_unwatch_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that DELETE returns 404 for missing watch (REQ-5.2.4.7)."""
        watch_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.variables.routes.variable_service.unregister_watch"
        ) as mock_unregister:
            mock_unregister.return_value = False

            response = client.delete(f"/variables/watch/{watch_id}")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False


class TestGetSystemVariablesEndpoint:
    """Test suite for GET /variables/system endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_system_returns_200_with_empty_variables(self, client: TestClient) -> None:
        """Test that GET /variables/system returns empty set when none exist."""
        with patch(
            "wavecore.api.routes.variables.routes.variable_service.get_system_variables"
        ) as mock_get:
            mock_get.return_value = {"variables": {}}

            response = client.get("/variables/system")

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert data["data"]["variables"] == {}

    def test_get_system_returns_200_with_variables(self, client: TestClient) -> None:
        """Test that GET /variables/system returns stored variables."""
        with patch(
            "wavecore.api.routes.variables.routes.variable_service.get_system_variables"
        ) as mock_get:
            mock_get.return_value = {
                "variables": {
                    "api_url": {"type": "string", "value": "https://api.example.com"},
                }
            }

            response = client.get("/variables/system")

            assert response.status_code == 200
            data = response.json()
            assert "api_url" in data["data"]["variables"]

    def test_get_system_sets_cache_headers(self, client: TestClient) -> None:
        """Test that GET /variables/system sets cache headers."""
        with patch(
            "wavecore.api.routes.variables.routes.variable_service.get_system_variables"
        ) as mock_get:
            mock_get.return_value = {"variables": {}}

            response = client.get("/variables/system")

            assert response.status_code == 200
            assert "Cache-Control" in response.headers

    def test_get_system_includes_meta(self, client: TestClient) -> None:
        """Test that GET /variables/system includes response metadata."""
        with patch(
            "wavecore.api.routes.variables.routes.variable_service.get_system_variables"
        ) as mock_get:
            mock_get.return_value = {"variables": {}}

            response = client.get("/variables/system")

            data = response.json()
            assert "meta" in data
            assert "request_id" in data["meta"]
            assert "timestamp" in data["meta"]


class TestSetSystemVariablesEndpoint:
    """Test suite for POST /variables/system endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_set_system_returns_200_with_variables(self, client: TestClient) -> None:
        """Test that POST /variables/system sets and returns variables."""
        with patch(
            "wavecore.api.routes.variables.routes.variable_service.set_system_variables"
        ) as mock_set:
            mock_set.return_value = {"variables": {"env": {"type": "string", "value": "prod"}}}

            response = client.post(
                "/variables/system",
                json={"variables": {"env": {"type": "string", "value": "prod"}}},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["success"] is True
            assert "env" in data["data"]["variables"]

    def test_set_system_requires_variables_field(self, client: TestClient) -> None:
        """Test that POST requires 'variables' field."""
        response = client.post(
            "/variables/system",
            json={},
        )

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert re.match(
            r"^Field 'variables' is required$",
            data["error"]["message"],
        )

    def test_set_system_returns_400_for_validation_error(self, client: TestClient) -> None:
        """Test that POST returns 400 for invalid variable data."""
        with patch(
            "wavecore.api.routes.variables.routes.variable_service.set_system_variables"
        ) as mock_set:
            mock_set.side_effect = ValidationException("Invalid variable name '123bad'")

            response = client.post(
                "/variables/system",
                json={"variables": {"123bad": {"type": "string"}}},
            )

            assert response.status_code == 400
            data = response.json()
            assert data["error"]["code"] == "VALIDATION_ERROR"

    def test_set_system_returns_500_for_internal_error(self, client: TestClient) -> None:
        """Test that POST returns 500 for unexpected errors."""
        with patch(
            "wavecore.api.routes.variables.routes.variable_service.set_system_variables"
        ) as mock_set:
            mock_set.side_effect = Exception("Unexpected error")

            response = client.post(
                "/variables/system",
                json={"variables": {"x": {"type": "string"}}},
            )

            assert response.status_code == 500
            data = response.json()
            assert data["error"]["code"] == "INTERNAL_ERROR"
            assert "request_id" in data["meta"]

    def test_set_system_invalidates_cache(self, client: TestClient) -> None:
        """Test that POST invalidates cache."""
        with patch(
            "wavecore.api.routes.variables.routes.variable_service.set_system_variables"
        ) as mock_set:
            mock_set.return_value = {"variables": {}}

            response = client.post(
                "/variables/system",
                json={"variables": {}},
            )

            assert response.status_code == 200
            assert "X-Cache-Invalidated" in response.headers


class TestDeleteAllSystemVariablesEndpoint:
    """Test suite for DELETE /variables/system endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_delete_all_system_returns_204(self, client: TestClient) -> None:
        """Test that DELETE /variables/system returns 204."""
        with patch(
            "wavecore.api.routes.variables.routes.variable_service.delete_all_system_variables"
        ) as mock_delete:
            mock_delete.return_value = None

            response = client.delete("/variables/system")

            assert response.status_code == 204

    def test_delete_all_system_is_idempotent(self, client: TestClient) -> None:
        """Test that DELETE /variables/system is idempotent (always 204)."""
        with patch(
            "wavecore.api.routes.variables.routes.variable_service.delete_all_system_variables"
        ) as mock_delete:
            mock_delete.return_value = None

            response1 = client.delete("/variables/system")
            response2 = client.delete("/variables/system")

            assert response1.status_code == 204
            assert response2.status_code == 204


class TestDeleteSystemVariableEndpoint:
    """Test suite for DELETE /variables/system/{name} endpoint."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_delete_system_variable_returns_204(self, client: TestClient) -> None:
        """Test that DELETE /variables/system/{name} returns 204 on success."""
        with patch(
            "wavecore.api.routes.variables.routes.variable_service.delete_system_variable"
        ) as mock_delete:
            mock_delete.return_value = True

            response = client.delete("/variables/system/my_var")

            assert response.status_code == 204

    def test_delete_system_variable_returns_404_when_not_found(self, client: TestClient) -> None:
        """Test that DELETE returns 404 for non-existent variable."""
        with patch(
            "wavecore.api.routes.variables.routes.variable_service.delete_system_variable"
        ) as mock_delete:
            mock_delete.return_value = False

            response = client.delete("/variables/system/nonexistent")

            assert response.status_code == 404
            data = response.json()
            assert data["success"] is False
            assert "not found" in data["error"]["message"].lower()


class TestSecretHandling:
    """Test suite for secret variable handling across all endpoints."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_variables_masks_secret_values(self, client: TestClient) -> None:
        """Test that secret values are never included in GET responses (REQ-5.2.4.7)."""
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.variables.routes.variable_service.get_entity_variables"
        ) as mock_get:
            mock_get.return_value = {
                "variables": {
                    "api_key": {
                        "type": "string",
                        "value": "********",
                        "secret": True,
                        "masked": True,
                    },
                }
            }

            response = client.get(f"/variables/test/{entity_id}")

            assert response.status_code == 200
            data = response.json()
            var = data["data"]["variables"]["api_key"]
            assert var["value"] == "********"
            assert var["masked"] is True

    def test_set_variables_accepts_secret_values(self, client: TestClient) -> None:
        """Test that modification operations accept secret values for storage."""
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.variables.routes.variable_service.set_entity_variables"
        ) as mock_set:
            mock_set.return_value = {
                "variables": {
                    "password": {
                        "type": "string",
                        "value": "********",
                        "secret": True,
                        "masked": True,
                    },
                }
            }

            response = client.post(
                f"/variables/test/{entity_id}",
                json={
                    "variables": {
                        "password": {
                            "type": "string",
                            "value": "actual_secret_value",
                            "secret": True,
                        },
                    }
                },
            )

            assert response.status_code == 200
            # Response should have masked value
            data = response.json()
            assert data["data"]["variables"]["password"]["masked"] is True

    def test_evaluate_masks_secrets_in_result(self, client: TestClient) -> None:
        """Test that secret indicators propagate through computed expressions."""
        with patch(
            "wavecore.api.routes.variables.routes.variable_service.evaluate_expression"
        ) as mock_eval:
            mock_eval.return_value = {
                "result": "********",
                "type": "string",
                "contains_secret": True,
            }

            response = client.post(
                "/variables/evaluate",
                json={
                    "expression": "f'Bearer {api_key}'",
                    "context": {
                        "variables": {
                            "api_key": {"type": "string", "secret": True},
                        },
                    },
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert data["data"]["contains_secret"] is True


class TestInheritanceSemantics:
    """Test suite for hierarchical scoping and inheritance."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_variables_respects_inheritance(self, client: TestClient) -> None:
        """Test that retrieval reflects declared state, not resolved inheritance."""
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.variables.routes.variable_service.get_entity_variables"
        ) as mock_get:
            # Returns only variables declared at this scope level
            mock_get.return_value = {
                "variables": {
                    "local_var": {"type": "string", "value": "local"},
                }
            }

            response = client.get(f"/variables/test/{entity_id}")

            assert response.status_code == 200
            data = response.json()
            # Should only have locally declared variables
            assert "local_var" in data["data"]["variables"]


class TestCachingAndPerformance:
    """Test suite for caching and performance headers."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_scopes_sets_cache_headers(self, client: TestClient) -> None:
        """Test that GET /variables/scopes sets appropriate cache headers."""
        with patch(
            "wavecore.api.routes.variables.routes.variable_service.list_scopes"
        ) as mock_list:
            mock_list.return_value = {"scopes": ["system", "regression", "suite", "test", "block"]}

            response = client.get("/variables/scopes")

            assert response.status_code == 200
            # Scope list is static, should be cacheable
            assert "Cache-Control" in response.headers

    def test_get_variables_sets_cache_headers(self, client: TestClient) -> None:
        """Test that GET /variables/{scope}/{entity_id} sets cache headers."""
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.variables.routes.variable_service.get_entity_variables"
        ) as mock_get:
            mock_get.return_value = {"variables": {}}

            response = client.get(f"/variables/test/{entity_id}")

            assert response.status_code == 200
            assert "Cache-Control" in response.headers

    def test_set_variables_invalidates_cache(self, client: TestClient) -> None:
        """Test that modification operations invalidate cache."""
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.variables.routes.variable_service.set_entity_variables"
        ) as mock_set:
            mock_set.return_value = {"variables": {}}

            response = client.post(
                f"/variables/test/{entity_id}",
                json={"variables": {}},
            )

            assert response.status_code == 200
            # Should include cache invalidation header
            assert "X-Cache-Invalidated" in response.headers


class TestErrorHandling:
    """Test suite for error handling across all endpoints."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_internal_error_returns_500_with_correlation_id(self, client: TestClient) -> None:
        """Test that internal errors return 500 with correlation identifier."""
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.variables.routes.variable_service.get_entity_variables"
        ) as mock_get:
            mock_get.side_effect = RuntimeError("Unexpected error")

            response = client.get(f"/variables/test/{entity_id}")

            assert response.status_code == 500
            data = response.json()
            assert data["success"] is False
            assert data["error"]["code"] == "INTERNAL_ERROR"
            assert "request_id" in data["meta"]

    def test_malformed_json_returns_error(self, client: TestClient) -> None:
        """Test that malformed JSON returns an error response."""
        entity_id = str(uuid.uuid4())

        response = client.post(
            f"/variables/test/{entity_id}",
            content="not valid json",
            headers={"Content-Type": "application/json"},
        )

        assert response.status_code in (400, 422, 500)
        data = response.json()
        assert data["success"] is False


class TestEndpointCoverage:
    """Test suite for endpoint coverage edge cases."""

    @pytest.fixture
    def client(self) -> TestClient:
        """Create FastAPI test client."""
        from wavecore.api.app import app

        return TestClient(app)

    def test_validate_expression_value_error(self, client: TestClient) -> None:
        """Test validate-expression endpoint with ValueError."""
        with patch(
            "wavecore.api.routes.variables.routes.variable_service.validate_expression"
        ) as mock_validate:
            mock_validate.side_effect = ValidationException("Invalid syntax")

            response = client.post(
                "/variables/validate-expression",
                json={"expression": "x("},
            )

            assert response.status_code == 400
            data = response.json()
            assert data["success"] is False

    def test_unwatch_value_error(self, client: TestClient) -> None:
        """Test unwatch endpoint with invalid UUID."""
        response = client.delete("/variables/watch/not-a-uuid")

        assert response.status_code == 400
        data = response.json()
        assert data["success"] is False
        assert "VALIDATION_ERROR" in data["error"]["code"]

    def test_set_variables_internal_error(self, client: TestClient) -> None:
        """Test set_variables endpoint with internal error."""
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.variables.routes.variable_service.set_entity_variables"
        ) as mock_set:
            # Simulate an unexpected exception (not ValueError)
            mock_set.side_effect = Exception("Unexpected error")

            response = client.post(
                f"/variables/test/{entity_id}",
                json={"variables": {"var": "value"}},
            )

            assert response.status_code == 500
            data = response.json()
            assert data["success"] is False
            assert data["error"]["code"] == "INTERNAL_ERROR"
            assert "request_id" in data["meta"]

    def test_update_variables_requires_variables_field(self, client: TestClient) -> None:
        """Test update endpoint requires variables field."""
        entity_id = str(uuid.uuid4())

        # Set up entity first
        with patch(
            "wavecore.api.routes.variables.routes.variable_service.set_entity_variables"
        ) as mock_set:
            mock_set.return_value = {"variables": {"x": {"type": "string"}}}
            client.post(
                f"/variables/test/{entity_id}",
                json={"variables": {"x": {"type": "string"}}},
            )

        # Try to update without variables field
        response = client.patch(
            f"/variables/test/{entity_id}",
            json={},  # Missing 'variables' field
        )

        assert response.status_code == 400
        data = response.json()
        assert "variables" in data["error"]["message"].lower()

    def test_delete_variable_other_error(self, client: TestClient) -> None:
        """Test delete variable endpoint with non-not-found error."""
        entity_id = str(uuid.uuid4())

        with patch(
            "wavecore.api.routes.variables.routes.variable_service.delete_variable"
        ) as mock_delete:
            mock_delete.side_effect = ValidationException("Invalid scope 'test'")

            response = client.delete(f"/variables/test/{entity_id}/myvar")

            # This should be 400 for generic validation errors
            assert response.status_code == 400
            data = response.json()
            assert data["success"] is False


class TestSystemNumbersAreStoredInWireForm:
    """REQ-3.1.3.14: a Global variable save stores each typed number a client sends in wire form."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_a_set_and_a_merge_store_numbers_in_wire_form(self, client: TestClient) -> None:
        import yaml

        from tests.api.wire_number_cases import SENT_VARIABLES, STORED_VARIABLES
        from wavecore.api.services.storage_paths import get_system_variables_file_path
        from wavecore.api.services.variable_service import SYSTEM_ENTITY_ID

        response = client.post("/variables/system", json={"variables": SENT_VARIABLES})
        assert response.status_code == 200, response.text
        assert response.json()["data"]["variables"] == STORED_VARIABLES

        merged = client.patch(
            f"/variables/system/{SYSTEM_ENTITY_ID}",
            json={"variables": {"small": {"type": "float", "value": 0.00001}}},
        )
        assert merged.status_code == 200, merged.text
        stored = {**STORED_VARIABLES, "small": {"type": "float", "value": "0.00001"}}

        assert client.get("/variables/system").json()["data"]["variables"] == stored
        on_disk = yaml.safe_load(get_system_variables_file_path().read_text(encoding="utf-8"))
        assert on_disk == {"variables": stored}


class TestAVariableBodyThatIsNotAJsonObject:
    """A variable request whose body is not a JSON object is a bad request."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    @pytest.mark.parametrize(
        ("method", "path"),
        [
            pytest.param("POST", "/variables/evaluate", id="evaluate"),
            pytest.param("POST", "/variables/validate-expression", id="validate-expression"),
            pytest.param("POST", "/variables/watch", id="watch"),
            pytest.param("POST", "/variables/system", id="set-system"),
            pytest.param("POST", "/variables/suite/{id}", id="set-entity"),
            pytest.param("PATCH", "/variables/suite/{id}", id="update-entity"),
        ],
    )
    @pytest.mark.parametrize(("text", "message"), NOT_OBJECT_BODIES)
    def test_it_is_refused(
        self, client: TestClient, method: str, path: str, text: str, message: str
    ) -> None:
        response = send_text(client, method, path.format(id=uuid.uuid4()), text)

        assert_refused(response, message)
