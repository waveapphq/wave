"""Unit tests for regression_variables in GET /tests/{id} response.

Tests that the test detail endpoint returns ``regression_variables`` pre-merged
from all regressions containing the test's parent suites. This mirrors the
existing ``suite_variables`` pattern and eliminates N frontend requests.

Test Coverage:
- regression_variables key present in test detail response
- Empty when test has no regressions
- Correct merge when test is in one regression via one suite
- Correct merge when test is in multiple regressions via different suites
- Deduplication of variables with consistent types
- Variables include name and type (flat list for autocomplete)
"""

from tests.api.regression_test_helpers import clear_regression_storage
from tests.api.suite_test_helpers import clear_suite_storage


class TestRegressionVariablesInTestDetail:
    """Tests for regression_variables in GET /tests/{id} response."""

    def setup_method(self) -> None:
        """Reset storage before each test."""
        from wavecore.api.services.relations import service as relation_service
        from wavecore.api.services.tests.service import _clear_storage as _clear_test_storage

        clear_regression_storage()
        clear_suite_storage()
        _clear_test_storage()
        relation_service._test_to_suites.clear()
        relation_service._initialized = False

    def test_response_includes_regression_variables_key(self) -> None:
        """GET /tests/{id} response includes the regression_variables key."""
        from wavecore.api.services.tests import service as test_service

        test = test_service.create_test({"name": "My Test"})
        result = test_service.get_test(test["id"])

        assert result is not None
        assert "regression_variables" in result

    def test_regression_variables_empty_when_no_regressions(self) -> None:
        """regression_variables is empty when the test is not in any regression."""
        from wavecore.api.services.tests import service as test_service

        test = test_service.create_test({"name": "Orphan Test"})
        result = test_service.get_test(test["id"])

        assert result is not None
        assert result["regression_variables"] == []

    def test_regression_variables_from_single_regression(self) -> None:
        """regression_variables includes variables from a regression containing the test's suite."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.tests import service as test_service

        test = test_service.create_test({"name": "Included Test"})
        suite = suite_service.create_suite(
            {
                "name": "Parent Suite",
                "tests": [test["id"]],
            }
        )
        regression_service.create_regression(
            {
                "name": "Parent Regression",
                "suites": [suite["id"]],
                "variables": {
                    "env": {"type": "string", "value": "production"},
                    "retries": {"type": "integer", "value": 3},
                },
            }
        )

        result = test_service.get_test(test["id"])

        assert result is not None
        reg_vars = result["regression_variables"]
        assert len(reg_vars) == 2
        var_names = {v["name"] for v in reg_vars}
        assert var_names == {"env", "retries"}
        # Verify structure: each entry has name and type
        for v in reg_vars:
            assert "name" in v
            assert "type" in v

    def test_regression_variables_deduplication(self) -> None:
        """Variables with the same name from multiple regressions are deduplicated."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.tests import service as test_service

        test = test_service.create_test({"name": "Shared Test"})
        suite_a = suite_service.create_suite(
            {
                "name": "Suite A",
                "tests": [test["id"]],
            }
        )
        suite_b = suite_service.create_suite(
            {
                "name": "Suite B",
                "tests": [test["id"]],
            }
        )

        regression_service.create_regression(
            {
                "name": "Regression One",
                "suites": [suite_a["id"]],
                "variables": {"env": {"type": "string", "value": "dev"}},
            }
        )
        regression_service.create_regression(
            {
                "name": "Regression Two",
                "suites": [suite_b["id"]],
                "variables": {"env": {"type": "string", "value": "staging"}},
            }
        )

        result = test_service.get_test(test["id"])

        assert result is not None
        reg_vars = result["regression_variables"]
        env_entries = [v for v in reg_vars if v["name"] == "env"]
        # Deduplicated: same name + same type should appear only once
        assert len(env_entries) == 1
        assert env_entries[0]["type"] == "string"

    def test_regression_variables_from_multiple_regressions(self) -> None:
        """Variables from different regressions are merged into one flat list."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.tests import service as test_service

        test = test_service.create_test({"name": "Multi Reg Test"})
        suite_a = suite_service.create_suite(
            {
                "name": "Suite Alpha",
                "tests": [test["id"]],
            }
        )
        suite_b = suite_service.create_suite(
            {
                "name": "Suite Beta",
                "tests": [test["id"]],
            }
        )

        regression_service.create_regression(
            {
                "name": "Regression Alpha",
                "suites": [suite_a["id"]],
                "variables": {"env": {"type": "string", "value": "dev"}},
            }
        )
        regression_service.create_regression(
            {
                "name": "Regression Beta",
                "suites": [suite_b["id"]],
                "variables": {"timeout": {"type": "integer", "value": 30}},
            }
        )

        result = test_service.get_test(test["id"])

        assert result is not None
        reg_vars = result["regression_variables"]
        var_names = {v["name"] for v in reg_vars}
        assert "env" in var_names
        assert "timeout" in var_names

    def test_regression_variables_type_structure(self) -> None:
        """Each regression variable entry has name and type fields only (flat format)."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.tests import service as test_service

        test = test_service.create_test({"name": "Structure Test"})
        suite = suite_service.create_suite(
            {
                "name": "Structure Suite",
                "tests": [test["id"]],
            }
        )
        regression_service.create_regression(
            {
                "name": "Structure Regression",
                "suites": [suite["id"]],
                "variables": {"host": {"type": "string", "value": "example.com"}},
            }
        )

        result = test_service.get_test(test["id"])

        assert result is not None
        reg_vars = result["regression_variables"]
        assert len(reg_vars) == 1
        assert reg_vars[0] == {"name": "host", "type": "string"}

    def test_regression_variables_handles_non_dict_variable(self) -> None:
        """Non-dict regression variables default to type 'string'."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.tests import service as test_service

        test = test_service.create_test({"name": "Plain Var Test"})
        suite = suite_service.create_suite(
            {
                "name": "Plain Suite",
                "tests": [test["id"]],
            }
        )
        regression_service.create_regression(
            {
                "name": "Plain Regression",
                "suites": [suite["id"]],
                "variables": {"simple": "plain_value"},
            }
        )

        result = test_service.get_test(test["id"])

        assert result is not None
        reg_vars = result["regression_variables"]
        simple_entries = [v for v in reg_vars if v["name"] == "simple"]
        assert len(simple_entries) == 1
        assert simple_entries[0]["type"] == "string"

    def test_regression_variables_when_suite_in_no_regression(self) -> None:
        """regression_variables is empty when the test's suite is not in any regression."""
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.tests import service as test_service

        test = test_service.create_test({"name": "No Reg Test"})
        suite_service.create_suite(
            {
                "name": "Standalone Suite",
                "tests": [test["id"]],
            }
        )

        result = test_service.get_test(test["id"])

        assert result is not None
        assert result["regression_variables"] == []

    def test_regression_variables_ignores_unrelated_regressions(self) -> None:
        """Regressions that do not reference the test's suites are skipped entirely."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.tests import service as test_service

        test = test_service.create_test({"name": "Focused Test"})
        owner_suite = suite_service.create_suite(
            {
                "name": "Owner Suite",
                "tests": [test["id"]],
            }
        )
        unrelated_suite = suite_service.create_suite(
            {
                "name": "Unrelated Suite",
            }
        )

        regression_service.create_regression(
            {
                "name": "Owning Regression",
                "suites": [owner_suite["id"]],
                "variables": {"env": {"type": "string", "value": "prod"}},
            }
        )
        # This regression does not touch the test's suite and must be skipped.
        regression_service.create_regression(
            {
                "name": "Unrelated Regression",
                "suites": [unrelated_suite["id"]],
                "variables": {"ignored": {"type": "integer", "value": 999}},
            }
        )

        result = test_service.get_test(test["id"])

        assert result is not None
        var_names = {v["name"] for v in result["regression_variables"]}
        assert "env" in var_names
        assert "ignored" not in var_names


class TestRegressionVariablesEndpoint:
    """Tests for regression_variables via the HTTP endpoint."""

    def setup_method(self) -> None:
        """Reset storage before each test."""
        from wavecore.api.services.relations import service as relation_service
        from wavecore.api.services.tests.service import _clear_storage as _clear_test_storage

        clear_regression_storage()
        clear_suite_storage()
        _clear_test_storage()
        relation_service._test_to_suites.clear()
        relation_service._initialized = False

    def test_endpoint_returns_regression_variables(self) -> None:
        """GET /tests/{id} response JSON includes regression_variables."""
        from fastapi.testclient import TestClient

        from wavecore.api.app import app
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.tests import service as test_service

        client = TestClient(app)

        test = test_service.create_test({"name": "API Test"})
        suite = suite_service.create_suite(
            {
                "name": "API Suite",
                "tests": [test["id"]],
            }
        )
        regression_service.create_regression(
            {
                "name": "API Regression",
                "suites": [suite["id"]],
                "variables": {"base_url": {"type": "string", "value": "http://example.com"}},
            }
        )

        response = client.get(f"/tests/{test['id']}")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        test_data = data["data"]
        assert "regression_variables" in test_data
        reg_vars = test_data["regression_variables"]
        assert len(reg_vars) == 1
        assert reg_vars[0]["name"] == "base_url"
        assert reg_vars[0]["type"] == "string"

    def test_endpoint_returns_empty_regression_variables(self) -> None:
        """GET /tests/{id} returns empty regression_variables when no regressions."""
        from fastapi.testclient import TestClient

        from wavecore.api.app import app
        from wavecore.api.services.tests import service as test_service

        client = TestClient(app)

        test = test_service.create_test({"name": "Solo Test"})

        response = client.get(f"/tests/{test['id']}")

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["regression_variables"] == []
