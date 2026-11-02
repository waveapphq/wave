"""Discover tools contract beyond the catalog (REQ-5.2.7.8).

Functions cards + deep inspect, test/suite/regression summaries with MASKED
variables, environments, masked profiles, system/global variables, and
execution listing with filters. Secret plaintext must never appear in any
payload.
"""

import uuid
from collections.abc import Generator
from pathlib import Path
from typing import Any

import pytest
import yaml

from tests.mcp.conftest import make_minimal_execution
from wavecore.api.exceptions import NotFoundException, ValidationException
from wavecore.core.secrets.cipher import ENVELOPE_PREFIX
from wavecore.core.secrets.masking import MASK_PLACEHOLDER

TEST_ROW_KEYS = {"id", "name", "description", "tags", "version", "status", "last_run"}
EXECUTION_ROW_KEYS = {
    "id",
    "name",
    "entity_type",
    "status",
    "triggered_by",
    "started_at",
    "duration",
}


@pytest.fixture(autouse=True)
def _registries(seed_registries: None) -> None:
    """Discover tests seed tests with a Log node; the registry must know it."""


@pytest.fixture(autouse=True)
def clear_entity_caches(temp_storage_path: Path) -> Generator[None, None, None]:
    from wavecore.api.services import variable_service
    from wavecore.api.services.functions import service as function_service
    from wavecore.api.services.profiles import _common as profile_common
    from wavecore.api.services.suites import _storage as suite_storage

    def _clear() -> None:
        suite_storage._clear_storage()
        profile_common._clear_in_memory_cache()
        function_service._clear_in_memory_cache()
        variable_service._variable_storage.clear()
        variable_service._watch_storage.clear()
        variable_service._system_cache_loaded = False

    _clear()
    yield
    _clear()


def _function_payload(name: str, **overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "name": name,
        "description": f"{name} does things.",
        "tags": ["mcp"],
        "inputs": [
            {
                "name": "host",
                "type": "string",
                "required": True,
                "default": None,
                "description": "Target host",
            }
        ],
        "outputs": [{"name": "result", "type": "string", "description": "Outcome"}],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {"nodes": [], "edges": []},
    }
    payload.update(overrides)
    return payload


def _create_function(name: str, **overrides: Any) -> dict[str, Any]:
    from wavecore.api.services.functions import service as function_service

    definition, _etag = function_service.create_function(_function_payload(name, **overrides))
    return definition


def _write_test_referencing_function(function_id: str) -> str:
    from wavecore.api.services.storage_paths import get_tests_storage_path
    from wavecore.api.services.tests.service import _clear_in_memory_cache

    test_id = str(uuid.uuid4())
    test_dir = get_tests_storage_path() / test_id
    test_dir.mkdir(parents=True, exist_ok=True)
    (test_dir / "test.yaml").write_text(
        yaml.dump(
            {
                "id": test_id,
                "name": f"Uses Function {test_id[:8]}",
                "version": "1.0.0",
                "description": "",
                "workflow": {
                    "nodes": [
                        {
                            "id": "node-fn-1",
                            "type": "workflowNode",
                            "data": {
                                "nodeType": "function",
                                "elementType": "function",
                                "functionId": function_id,
                                "functionVersion": "1.0.0",
                                "config": {
                                    "values": {"host": "db.local"},
                                    "outputBindings": {},
                                    "profileBindings": [],
                                },
                            },
                        }
                    ],
                    "edges": [],
                },
                "variables": {},
                "metadata": {},
                "created_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-01T00:00:00+00:00",
            }
        )
    )
    _clear_in_memory_cache()
    return test_id


class TestListFunctions:
    def test_cards_carry_the_contract(self) -> None:
        from wavecore.mcp.tools import discover

        created = _create_function("alpha_fn")

        cards = discover.list_functions()

        assert len(cards) == 1
        card = cards[0]
        assert {
            "id",
            "name",
            "description",
            "tags",
            "latest_version",
            "inputs",
            "outputs",
        }.issubset(card.keys())
        assert card["id"] == created["id"]
        assert card["name"] == "alpha_fn"
        assert card["latest_version"] == "1.0.0"
        assert card["inputs"][0]["name"] == "host"
        assert card["inputs"][0]["type"] == "string"
        assert card["outputs"][0]["name"] == "result"

    def test_search_filters_by_name_substring(self) -> None:
        from wavecore.mcp.tools import discover

        _create_function("alpha_fn")
        _create_function("beta_alpha_fn")
        _create_function("gamma_fn")

        names = {card["name"] for card in discover.list_functions(search="alpha")}

        assert names == {"alpha_fn", "beta_alpha_fn"}

    def test_cards_carry_the_output_kind(self) -> None:
        # REQ-3.1.2.8, REQ-5.2.7.8: the kind keys and the source text, like a variable's.
        from wavecore.mcp.tools import discover

        _create_function("kind_fn", outputs=KIND_OUTPUTS)

        (card,) = discover.list_functions()

        assert card["outputs"] == KIND_OUTPUTS

    def test_a_secret_output_default_is_masked(self) -> None:
        # SECUI-11: a secret output default is masked in every read tool.
        from wavecore.mcp.tools import discover

        _create_function("secret_out_fn", outputs=[SECRET_OUTPUT])

        cards = discover.list_functions()

        (output,) = cards[0]["outputs"]
        assert output["secret"] is True
        assert output["default"] == MASK_PLACEHOLDER
        assert SECRET_OUTPUT_DEFAULT not in repr(cards)


SECRET_OUTPUT_DEFAULT = "canary-secret-output-default"
SECRET_OUTPUT: dict[str, Any] = {
    "name": "token",
    "type": "string",
    "secret": True,
    "default": SECRET_OUTPUT_DEFAULT,
    "description": "Issued token",
}
NESTED_VALUES: dict[str, Any] = {
    "who": "host",
    "labels": ["a", 1],
    "greeting": "hi {{ host }}",
}


def _nested_function_block() -> dict[str, Any]:
    """A Local Function Block whose inputs hold an expression, a typed list and a template."""
    return {
        "id": "inner",
        "type": "workflowNode",
        "data": {
            "label": "inner",
            "elementType": "function",
            "nodeType": "function",
            "version": "1.0.0",
            "functionLifecycle": "local",
            "localDefinition": {
                "name": "inner",
                "description": "",
                "tags": [],
                "inputs": [
                    {"name": "who", "type": "string", "required": True},
                    {"name": "labels", "type": "array", "required": False, "default": None},
                    {"name": "greeting", "type": "string", "required": False, "default": None},
                ],
                "outputs": [],
                "dependencies": {"functions": [], "plugins": []},
                "workflow": {"nodes": [], "edges": []},
            },
            "config": {
                "values": dict(NESTED_VALUES),
                "outputBindings": {},
                "profileBindings": [],
            },
            "expressionFields": ["who"],
            "templateFields": ["greeting"],
            "elementTypes": {"labels": ["string", "integer"]},
        },
    }


KIND_OUTPUTS: list[dict[str, Any]] = [
    {"name": "size", "type": "integer", "isExpression": True, "default": "len(host)"},
    {"name": "label", "type": "string", "isTemplate": True, "default": "id-{{ host }}"},
]


class TestGetFunction:
    def test_deep_inspect_returns_definition_with_dependents(self) -> None:
        from wavecore.mcp.tools import discover

        created = _create_function("alpha_fn")
        dependent_test_id = _write_test_referencing_function(created["id"])

        result = discover.get_function(created["id"])

        assert result["id"] == created["id"]
        assert result["name"] == "alpha_fn"
        assert result["version"] == "1.0.0"
        assert result["inputs"][0]["name"] == "host"
        assert result["workflow"] == {"nodes": [], "edges": []}
        assert "available_versions" in result
        dependents = result["dependents"]
        assert [row["id"] for row in dependents["tests"]] == [dependent_test_id]
        assert dependents["functions"] == []

    def test_version_pin_returns_that_version(self) -> None:
        from wavecore.mcp.tools import discover

        created = _create_function("alpha_fn")

        result = discover.get_function(created["id"], version="1.0.0")

        assert result["version"] == "1.0.0"

    def test_unknown_function_raises_service_message(self) -> None:
        from wavecore.mcp.tools import discover

        with pytest.raises(NotFoundException, match=r"^Function 'ghost' not found$"):
            discover.get_function("ghost")

    def test_unknown_version_raises_service_message(self) -> None:
        from wavecore.mcp.tools import discover

        created = _create_function("alpha_fn")

        with pytest.raises(
            Exception,
            match=rf"^Function '{created['id']}' version '9\.9\.9' not found$",
        ):
            discover.get_function(created["id"], version="9.9.9")

    @pytest.mark.parametrize("version", [None, "1.0.0"], ids=["latest", "pinned"])
    def test_a_secret_output_default_is_masked(self, version: str | None) -> None:
        # SECUI-11: masked on the latest read and on a pinned version alike.
        from wavecore.mcp.tools import discover

        created = _create_function("secret_out_fn", outputs=[SECRET_OUTPUT])

        result = discover.get_function(created["id"], version=version)

        (output,) = result["outputs"]
        assert output["secret"] is True
        assert output["default"] == MASK_PLACEHOLDER
        assert SECRET_OUTPUT_DEFAULT not in repr(result)

    @pytest.mark.parametrize("version", [None, "1.0.0"], ids=["latest", "pinned"])
    def test_a_nested_function_block_comes_back_as_stored(self, version: str | None) -> None:
        from wavecore.mcp.tools import discover

        nested = _nested_function_block()
        created = _create_function(
            "outer_fn",
            workflow={
                "nodes": [nested],
                "edges": [{"source": "start-node", "target": nested["id"]}],
            },
        )

        result = discover.get_function(created["id"], version=version)

        (block,) = result["workflow"]["nodes"]
        data = block["data"]
        assert data["config"]["values"] == NESTED_VALUES
        assert data["expressionFields"] == ["who"]
        assert data["templateFields"] == ["greeting"]
        assert data["elementTypes"] == {"labels": ["string", "integer"]}
        assert "inputBindings" not in data


class TestListTests:
    def test_rows_have_exact_summary_shape(self) -> None:
        from tests.mcp.conftest import create_test_entity
        from wavecore.mcp.tools import discover

        created = create_test_entity("MCP Smoke", description="A smoke test", tags=["smoke", "mcp"])

        rows = discover.list_tests()

        assert len(rows) == 1
        row = rows[0]
        assert set(row.keys()) == TEST_ROW_KEYS
        assert row["id"] == created["id"]
        assert row["name"] == "MCP Smoke"
        assert row["description"] == "A smoke test"
        assert row["tags"] == ["smoke", "mcp"]
        assert row["version"] == "1.0.0"
        assert row["status"] == "never_run"
        assert row["last_run"] is None

    def test_search_and_tag_filters(self) -> None:
        from tests.mcp.conftest import create_test_entity
        from wavecore.mcp.tools import discover

        create_test_entity("Login Flow", tags=["smoke"])
        create_test_entity("Checkout Flow", tags=["regression"])

        assert [row["name"] for row in discover.list_tests(search="login")] == ["Login Flow"]
        assert [row["name"] for row in discover.list_tests(tag="regression")] == ["Checkout Flow"]


class TestGetTest:
    def test_returns_summary_blocks_and_validation_without_workflow(self) -> None:
        from tests.mcp.conftest import create_test_entity
        from wavecore.mcp.tools import discover

        created = create_test_entity("MCP Smoke", description="A smoke test")

        result = discover.get_test(created["id"])

        assert {
            "id",
            "name",
            "description",
            "version",
            "variables",
            "blocks",
            "validation",
        }.issubset(result.keys())
        assert result["id"] == created["id"]
        assert "workflow" not in result
        assert result["blocks"] == [
            {"label": "Say Hello", "elementType": "log", "nodeType": "plugin"}
        ]
        assert isinstance(result["validation"], dict)

    def test_variables_are_masked(self) -> None:
        from tests.mcp.conftest import create_test_entity
        from wavecore.mcp.tools import discover

        created = create_test_entity(
            "Secret Test",
            variables={
                "api_token": {"type": "string", "value": "super-secret-token", "secret": True},
                "region": {"type": "string", "value": "us-west"},
            },
        )

        result = discover.get_test(created["id"])

        assert result["variables"]["api_token"]["value"] == MASK_PLACEHOLDER
        assert result["variables"]["api_token"]["masked"] is True
        assert result["variables"]["region"]["value"] == "us-west"
        assert "super-secret-token" not in str(result)
        assert ENVELOPE_PREFIX not in str(result)

    def test_resolves_by_unique_name(self) -> None:
        from tests.mcp.conftest import create_test_entity
        from wavecore.mcp.tools import discover

        created = create_test_entity("MCP Smoke")

        result = discover.get_test("MCP Smoke")

        assert result["id"] == created["id"]

    def test_unknown_ref_raises_exact_message(self) -> None:
        from wavecore.mcp.tools import discover

        with pytest.raises(NotFoundException, match=r"^Test 'ghost' not found$"):
            discover.get_test("ghost")


class TestResolveRef:
    def test_named_row_vanishing_before_fetch_raises_not_found(self) -> None:
        from wavecore.mcp.tools.discover import _resolve_ref

        with pytest.raises(NotFoundException, match=r"^Test 'Ghost Row' not found$"):
            _resolve_ref(
                "Ghost Row",
                type_label="test",
                get_by_id=lambda _ref: None,
                list_all=lambda: [{"id": "test-1", "name": "Ghost Row"}],
            )


class TestSuites:
    def _seed(self) -> tuple[str, str]:
        from tests.mcp.conftest import create_test_entity
        from wavecore.api.services.suites import service as suite_service

        test = create_test_entity("Suite Member")
        suite = suite_service.create_suite(
            {
                "name": "MCP Suite",
                "tests": [test["id"]],
                "variables": {
                    "token": {"type": "string", "value": "suite-secret-value", "secret": True}
                },
            }
        )
        return suite["id"], test["id"]

    def test_get_suite_composition_and_masked_variables(self) -> None:
        from wavecore.mcp.tools import discover

        suite_id, test_id = self._seed()

        result = discover.get_suite(suite_id)

        assert result["id"] == suite_id
        assert result["name"] == "MCP Suite"
        assert result["tests"] == [{"id": test_id, "name": "Suite Member"}]
        assert result["variables"]["token"]["value"] == MASK_PLACEHOLDER
        assert "suite-secret-value" not in str(result)

    def test_get_suite_resolves_by_name(self) -> None:
        from wavecore.mcp.tools import discover

        suite_id, _test_id = self._seed()

        assert discover.get_suite("MCP Suite")["id"] == suite_id

    def test_list_suites_masks_variables(self) -> None:
        from wavecore.mcp.tools import discover

        self._seed()

        rows = discover.list_suites()

        assert len(rows) == 1
        row = rows[0]
        assert row["name"] == "MCP Suite"
        assert row["variables"]["token"]["value"] == MASK_PLACEHOLDER
        assert "suite-secret-value" not in str(rows)
        assert ENVELOPE_PREFIX not in str(rows)

    def test_unknown_suite_raises_exact_message(self) -> None:
        from wavecore.mcp.tools import discover

        with pytest.raises(NotFoundException, match=r"^Suite 'ghost' not found$"):
            discover.get_suite("ghost")


class TestRegressions:
    def _seed(self) -> tuple[str, str]:
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service

        suite = suite_service.create_suite({"name": "MCP Suite"})
        regression = regression_service.create_regression(
            {
                "name": "MCP Regression",
                "suites": [suite["id"]],
                "variables": {
                    "token": {"type": "string", "value": "reg-secret-value", "secret": True}
                },
            }
        )
        return regression["id"], suite["id"]

    def test_get_regression_composition_and_masked_variables(self) -> None:
        from wavecore.mcp.tools import discover

        regression_id, suite_id = self._seed()

        result = discover.get_regression(regression_id)

        assert result["id"] == regression_id
        assert result["suites"] == [{"id": suite_id, "name": "MCP Suite"}]
        assert result["variables"]["token"]["value"] == MASK_PLACEHOLDER
        assert "reg-secret-value" not in str(result)

    def test_list_regressions_masks_variables(self) -> None:
        from wavecore.mcp.tools import discover

        self._seed()

        rows = discover.list_regressions()

        assert len(rows) == 1
        assert rows[0]["name"] == "MCP Regression"
        assert rows[0]["variables"]["token"]["value"] == MASK_PLACEHOLDER
        assert "reg-secret-value" not in str(rows)

    def test_unknown_regression_raises_exact_message(self) -> None:
        from wavecore.mcp.tools import discover

        with pytest.raises(NotFoundException, match=r"^Regression 'ghost' not found$"):
            discover.get_regression("ghost")


class TestEnvironmentsAndProfiles:
    def test_list_environments_returns_rows(self) -> None:
        from wavecore.api.services.environments import service as environment_service
        from wavecore.mcp.tools import discover

        environment_service.create_environment(name="MCP Env", description="For MCP tests")

        rows = discover.list_environments()

        names = {row["name"] for row in rows}
        assert {"Test Environment", "MCP Env"}.issubset(names)
        for row in rows:
            assert {"id", "name", "tags"}.issubset(row.keys())

    def test_list_profiles_masks_credential_fields(self) -> None:
        from wavecore.api.services.profiles import service as profile_service
        from wavecore.mcp.tools import discover

        profile_service.create_profile(
            name="mcp-db",
            profile_type="database",
            config={"host": "db.local", "port": 5432, "password": "profile-secret-pass"},
        )

        rows = discover.list_profiles()

        assert len(rows) == 1
        row = rows[0]
        assert row["name"] == "mcp-db"
        assert row["type"] == "database"
        assert row["config"]["password"] == MASK_PLACEHOLDER
        assert row["config"]["host"] == "db.local"
        assert "profile-secret-pass" not in str(rows)


class TestListVariables:
    def _seed(self) -> None:
        from wavecore.api.services import variable_service

        variable_service.set_system_variables(
            {
                "api_key": {"type": "string", "value": "system-secret-key", "secret": True},
                "region": {"type": "string", "value": "emea"},
            }
        )

    def test_system_scope_masks_secrets(self) -> None:
        from wavecore.mcp.tools import discover

        self._seed()

        result = discover.list_variables("system")

        variables = {row["name"]: row for row in result}
        assert variables["api_key"]["value"] == MASK_PLACEHOLDER
        assert variables["api_key"]["masked"] is True
        assert variables["region"]["value"] == "emea"
        assert "system-secret-key" not in str(result)

    def test_global_scope_is_an_alias_for_the_shared_store(self) -> None:
        from wavecore.mcp.tools import discover

        self._seed()

        assert discover.list_variables("global") == discover.list_variables("system")

    def test_invalid_scope_raises_exact_message(self) -> None:
        from wavecore.mcp.tools import discover

        with pytest.raises(ValidationException, match=r"^Scope must be 'system' or 'global'$"):
            discover.list_variables("test")


class TestListExecutions:
    def test_rows_have_exact_shape_and_are_newest_first(self, clear_execution_state: None) -> None:
        from wavecore.mcp.tools import discover

        make_minimal_execution("passed", name="Old Run", started_offset=0.0)
        make_minimal_execution("failed", name="Mid Run", started_offset=10.0)
        make_minimal_execution("running", name="New Run", started_offset=20.0)

        rows = discover.list_executions()

        assert [row["name"] for row in rows] == ["New Run", "Mid Run", "Old Run"]
        for row in rows:
            assert set(row.keys()) == EXECUTION_ROW_KEYS
        assert rows[0]["status"] == "running"
        assert rows[0]["duration"] is None
        assert rows[2]["duration"] == 1

    def test_non_positive_limit_is_rejected_with_an_exact_message(
        self, clear_execution_state: None
    ) -> None:
        from wavecore.api.exceptions import ValidationException
        from wavecore.mcp.tools import discover

        for bad in (0, -5):
            with pytest.raises(ValidationException, match=r"^limit must be a positive integer$"):
                discover.list_executions(limit=bad)

    def test_unknown_status_is_rejected_with_the_valid_vocabulary(
        self, clear_execution_state: None
    ) -> None:
        from wavecore.api.exceptions import ValidationException
        from wavecore.mcp.tools import discover

        with pytest.raises(
            ValidationException,
            match=(
                r"^Invalid status 'FAILED': valid statuses are "
                r"pending, running, passed, failed, stopped$"
            ),
        ):
            discover.list_executions(status="FAILED")

    def test_unknown_entity_type_is_rejected_with_the_valid_vocabulary(
        self, clear_execution_state: None
    ) -> None:
        from wavecore.api.exceptions import ValidationException
        from wavecore.mcp.tools import discover

        with pytest.raises(
            ValidationException,
            match=r"^Invalid entity_type 'testcase': valid types are test, suite, regression$",
        ):
            discover.list_executions(entity_type="testcase")

    def test_status_and_entity_type_filters(self, clear_execution_state: None) -> None:
        from wavecore.mcp.tools import discover

        make_minimal_execution("passed", name="Passed Test", entity_type="test")
        make_minimal_execution("failed", name="Failed Suite", entity_type="suite")

        assert [row["name"] for row in discover.list_executions(status="failed")] == [
            "Failed Suite"
        ]
        assert [row["name"] for row in discover.list_executions(entity_type="test")] == [
            "Passed Test"
        ]

    def test_limit_caps_the_row_count(self, clear_execution_state: None) -> None:
        from wavecore.mcp.tools import discover

        for index in range(25):
            make_minimal_execution("passed", name=f"Run {index}", started_offset=float(index))

        assert len(discover.list_executions()) == 20
        assert len(discover.list_executions(limit=5)) == 5

    def test_triggered_by_is_surfaced(self, clear_execution_state: None) -> None:
        from wavecore.mcp.tools import discover

        make_minimal_execution("passed", name="MCP Run", triggered_by="mcp:claude-code")

        rows = discover.list_executions()

        assert rows[0]["triggered_by"] == "mcp:claude-code"


class TestListVariablesRowShape:
    """Listing tools return one object per row; list_blocks is the only
    documented exception, so variables must not wrap either."""

    def _seed(self) -> None:
        from wavecore.api.services import variable_service

        variable_service.set_system_variables(
            {
                "region": {"type": "string", "value": "emea"},
                "api_key": {"type": "string", "value": "system-secret-key", "secret": True},
            }
        )

    def test_rows_are_returned_one_per_variable(self) -> None:
        from wavecore.mcp.tools import discover

        self._seed()
        rows = discover.list_variables("system")

        assert isinstance(rows, list)
        by_name = {row["name"]: row for row in rows}
        assert by_name["region"]["value"] == "emea"
        assert by_name["region"]["type"] == "string"

    def test_secrets_stay_masked_in_the_rows(self) -> None:
        from wavecore.core.secrets.masking import MASK_PLACEHOLDER
        from wavecore.mcp.tools import discover

        self._seed()
        rows = discover.list_variables("global")

        api_key = next(row for row in rows if row["name"] == "api_key")
        assert api_key["value"] == MASK_PLACEHOLDER
        assert "system-secret-key" not in str(rows)


class TestListTestdata:
    """The test's own files, read through the same service the sheet reads (REQ-5.2.7.8)."""

    def _seed(self, name: str) -> dict[str, Any]:
        from tests.mcp.conftest import create_test_entity

        return create_test_entity(name)

    def _write(self, test_id: str, *entries: tuple[str, bytes]) -> None:
        from wavecore.api.services.tests import testdata_service

        testdata_service.write_files(test_id, list(entries))

    def test_the_listing_carries_the_test_identity_and_a_flat_entry_list(self) -> None:
        from wavecore.mcp.tools import discover

        test = self._seed("Testdata Listing")
        self._write(test["id"], ("examples/customers.csv", b"id,name\n"))

        result = discover.list_testdata(test["id"])

        assert set(result.keys()) == {"test_id", "name", "entries"}
        assert result["test_id"] == test["id"]
        assert result["name"] == "Testdata Listing"
        assert [entry["path"] for entry in result["entries"]] == [
            "examples",
            "examples/customers.csv",
        ]
        assert [entry["kind"] for entry in result["entries"]] == ["dir", "file"]
        assert result["entries"][1]["size_bytes"] == len(b"id,name\n")

    def test_a_test_with_no_folder_lists_nothing(self) -> None:
        from wavecore.mcp.tools import discover

        test = self._seed("Testdata Empty")

        assert discover.list_testdata(test["id"])["entries"] == []

    def test_the_test_resolves_by_unique_name(self) -> None:
        from wavecore.mcp.tools import discover

        test = self._seed("Testdata By Name")
        self._write(test["id"], ("customers.csv", b"id\n"))

        result = discover.list_testdata("Testdata By Name")

        assert result["test_id"] == test["id"]
        assert [entry["path"] for entry in result["entries"]] == ["customers.csv"]

    def test_an_unknown_reference_raises(self) -> None:
        from wavecore.mcp.tools import discover

        with pytest.raises(NotFoundException, match=r"^Test 'ghost' not found$"):
            discover.list_testdata("ghost")
