"""Unit tests for the unified write-path validation pipeline.

Covers:
- _apply_safe_autofixes: applies NODE/EDGE/VARIABLE fixes, leaves visible codes alone.
- _validate_for_persist: returns residual user-actionable errors after autofixes.
- create_test / update_test: invoke the pipeline and raise SaveValidationError on residuals.
- _validate_test_data: emits INVALID_OUTPUT_BINDING_TYPE on save/run, warning on load.
- POST /tests, PUT /tests/{id}: 422 with top-level message ^Test has \\d+ validation error\\(s\\)$.
- /tests/{id}/fix: preserves visible warnings post-fix.
- validate_test_data_for_create: public dry-run (deep copy, name-conflict prepend, parity).
"""

import re
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient

from wavecore.api.services.tests import service as test_service
from wavecore.api.services.tests.service import SaveValidationError
from wavecore.models import plugins as plugin_models


def _make_workflow_node(
    node_id: str = "node-1",
    element_type: str = "variable-setter",
    node_type: str = "control",
    label: str = "Set Variables",
    version: str = "1.0.0",
    config: dict[str, Any] | None = None,
    position: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a valid workflowNode dict mirroring TestValidateTest._make_workflow_node."""
    if position is None:
        position = {"x": 100, "y": 200}
    if config is None:
        config = {"values": {"variables": {"my_var": "hello"}}}
    return {
        "id": node_id,
        "type": "workflowNode",
        "position": position,
        "data": {
            "elementType": element_type,
            "nodeType": node_type,
            "version": version,
            "label": label,
            "config": config,
        },
    }


def _expected_types_of(nodes: list[dict[str, Any]], var_name: str) -> set[str]:
    """The types the sites naming ``var_name`` expect, as the undeclared-variable fix reads them."""
    return test_service._expected_types(test_service._sites_naming(nodes, var_name))


def _reset_storage_and_registry() -> None:
    """Reset test storage and re-register controls + plugins (some tests rely on the registry)."""
    from wavecore.controls.registry import _registry, register_all_core_controls
    from wavecore.core.plugin_registry import clear_registry, register_plugin
    from wavecore.plugins.http_client import HTTPClientPlugin

    test_service._clear_storage()
    _registry.clear()
    register_all_core_controls(_registry)
    clear_registry()
    register_plugin(HTTPClientPlugin())


class TestApplySafeAutofixes:
    """`_apply_safe_autofixes(test) -> dict` is the first stage of the unified pipeline."""

    def setup_method(self) -> None:
        _reset_storage_and_registry()

    def test_apply_safe_autofixes_skips_fixes_on_fatal_validation(self) -> None:
        """When the pre-fix validation is fatal, autofix returns the test unchanged."""
        # Missing 'workflow' key triggers the MISSING_WORKFLOW fatal check.
        test = {"name": "Fatal Test"}
        result = test_service._apply_safe_autofixes(test)
        # Returned dict is the same input - no edges/nodes added because of fatal short-circuit.
        assert result is test
        assert "workflow" not in result

    def test_validate_output_binding_types_skips_non_dict_bindings(self) -> None:
        """outputBindings shaped as a non-dict is silently ignored (defensive)."""
        node = _make_workflow_node(
            "node-1",
            "http-client",
            "plugin",
            "HTTP Call",
            config={
                "values": {"method": "GET", "url": "http://example.com"},
                "outputBindings": "not-a-dict",
            },
        )
        test = {
            "name": "Non Dict Bindings",
            "workflow": {"nodes": [node], "edges": []},
            "variables": {"my_var": {"type": "string", "value": ""}},
        }
        result = test_service._validate_test_data(test, context="save")
        codes = [e["code"] for e in result.get("errors", [])]
        assert "INVALID_OUTPUT_BINDING_TYPE" not in codes

    def test_validate_output_binding_types_skips_empty_var_name(self) -> None:
        """A binding with an empty var_name is treated as 'no binding'."""
        node = _make_workflow_node(
            "node-1",
            "http-client",
            "plugin",
            "HTTP Call",
            config={
                "values": {"method": "GET", "url": "http://example.com"},
                "outputBindings": {"body": ""},
            },
        )
        test = {
            "name": "Empty Var Name",
            "workflow": {"nodes": [node], "edges": []},
            "variables": {"body": {"type": "string", "value": ""}},
        }
        result = test_service._validate_test_data(test, context="save")
        codes = [e["code"] for e in result.get("errors", [])]
        assert "INVALID_OUTPUT_BINDING_TYPE" not in codes

    def test_validate_output_binding_types_skips_var_with_non_string_type(self) -> None:
        """A variable whose type field is not a string is silently skipped."""
        node = _make_workflow_node(
            "node-1",
            "http-client",
            "plugin",
            "HTTP Call",
            config={
                "values": {"method": "GET", "url": "http://example.com"},
                "outputBindings": {"body": "weird"},
            },
        )
        test = {
            "name": "Weird Var Type",
            "workflow": {"nodes": [node], "edges": []},
            "variables": {"weird": {"type": 42, "value": ""}},
        }
        result = test_service._validate_test_data(test, context="save")
        codes = [e["code"] for e in result.get("errors", [])]
        assert "INVALID_OUTPUT_BINDING_TYPE" not in codes

    def test_process_variables_for_save_passes_non_dict_var_through(self) -> None:
        """Non-dict variable values are stored verbatim (legacy/imported tests)."""
        # Build the test via legacy-data path to bypass the unified pipeline
        # (which validates variable shape strictly). The else branch in
        # _process_variables_for_save fires when var_info is not a dict.
        from wavecore.api.services.tests.service import _process_variables_for_save

        result = _process_variables_for_save({"plain": "raw_string_value"})
        assert result == {"plain": "raw_string_value"}

    def test_normalize_target_handles_clears_stale_handle_on_single_ingress(self) -> None:
        """_post_fix_edge_cleanup drops a stale targetHandle when the target
        has only one ingress."""
        good = _make_workflow_node("node-good")
        # Build a workflow where after autofix the only remaining edge has
        # a stale targetHandle - the normalize step removes it.
        test = {
            "name": "Stale Handle Normalize",
            "workflow": {
                "nodes": [good],
                "edges": [
                    {
                        "id": "e1",
                        "source": "start-node",
                        "target": "node-good",
                        "targetHandle": "stale-handle",
                    }
                ],
            },
            "variables": {"my_var": {"type": "string", "value": ""}},
        }
        test_service._apply_safe_autofixes(test)
        edges = test["workflow"]["edges"]
        # The single ingress edge should have its stale targetHandle cleared.
        assert edges[0].get("targetHandle") is None

    def test_apply_safe_autofixes_is_exported(self) -> None:
        """The new helper is a public symbol of the service module."""
        assert hasattr(test_service, "_apply_safe_autofixes")

    def test_apply_safe_autofixes_returns_test_dict(self) -> None:
        """Returns the test (typically the same dict, mutated in place)."""
        test = {
            "name": "Apply Autofix Returns",
            "workflow": {"nodes": [], "edges": []},
            "variables": {"my_var": {"type": "string", "value": ""}},
        }
        result = test_service._apply_safe_autofixes(test)
        assert isinstance(result, dict)
        assert result.get("name") == "Apply Autofix Returns"

    def test_apply_safe_autofixes_drops_dangling_edges(self) -> None:
        """An edge whose target node does not exist is filtered (DANGLING_EDGE auto-fix)."""
        good = _make_workflow_node("node-good")
        test = {
            "name": "Apply Autofix Dangling",
            "workflow": {
                "nodes": [good],
                "edges": [{"id": "e1", "source": "node-good", "target": "ghost-node"}],
            },
            "variables": {"my_var": {"type": "string", "value": ""}},
        }
        result = test_service._apply_safe_autofixes(test)
        assert result["workflow"]["edges"] == []

    def test_apply_safe_autofixes_does_not_strip_required_param_warnings(self) -> None:
        """Visible codes (REQUIRED_PARAM_*) survive autofix - they are NOT auto-fixable."""
        node_missing_required = _make_workflow_node(
            "node-1",
            "variable-setter",
            "control",
            "Set Variables",
            config={"values": {}},  # variable-setter requires `variables`
        )
        test = {
            "name": "Apply Autofix Keeps Required Warnings",
            "workflow": {"nodes": [node_missing_required], "edges": []},
            "variables": {"my_var": {"type": "string", "value": ""}},
        }
        test_service._apply_safe_autofixes(test)
        # Re-validate at save context: visible codes must still be reported.
        validation = test_service._validate_test_data(test, context="save")
        codes = [e["code"] for e in validation.get("errors", [])]
        assert "REQUIRED_PARAM_MISSING" in codes

    @staticmethod
    def _rejoin_workflow(join_target_handles: tuple[str | None, str | None]) -> dict[str, Any]:
        """Two if-else branches converging on one node, per-edge targetHandle configurable."""
        if_node = _make_workflow_node(
            "node-if",
            "if-else",
            "control",
            "If/Else",
            config={
                "values": {
                    "branches": [
                        {
                            "id": "branch_0",
                            "type": "if",
                            "label": "",
                            "conditions": [
                                {"id": "cond-1", "type": "expression", "expression": "true"}
                            ],
                        },
                        {"id": "branch_1", "type": "else", "label": ""},
                    ]
                }
            },
        )
        left = _make_workflow_node("node-left")
        right = _make_workflow_node("node-right")
        join = _make_workflow_node("node-join")
        left_th, right_th = join_target_handles
        left_edge: dict[str, Any] = {
            "id": "e-left-join",
            "source": "node-left",
            "target": "node-join",
        }
        right_edge: dict[str, Any] = {
            "id": "e-right-join",
            "source": "node-right",
            "target": "node-join",
        }
        if left_th is not None:
            left_edge["targetHandle"] = left_th
        if right_th is not None:
            right_edge["targetHandle"] = right_th
        return {
            "name": "Rejoin Workflow",
            "workflow": {
                "nodes": [if_node, left, right, join],
                "edges": [
                    {"id": "e-start", "source": "start-node", "target": "node-if"},
                    {
                        "id": "e-if-left",
                        "source": "node-if",
                        "target": "node-left",
                        "sourceHandle": "branch_0",
                    },
                    {
                        "id": "e-if-right",
                        "source": "node-if",
                        "target": "node-right",
                        "sourceHandle": "branch_1",
                    },
                    left_edge,
                    right_edge,
                ],
            },
            "variables": {"my_var": {"type": "string", "value": ""}},
        }

    def test_rejoin_edges_on_distinct_ingress_handles_survive_autofix(self) -> None:
        """Branch tails converging on distinct handles (default + ingress_1) are legitimate."""
        test = self._rejoin_workflow((None, "ingress_1"))
        test_service._apply_safe_autofixes(test)
        edge_ids = {e["id"] for e in test["workflow"]["edges"]}
        assert "e-left-join" in edge_ids
        assert "e-right-join" in edge_ids

    def test_duplicate_incoming_edges_on_the_same_handle_are_pruned(self) -> None:
        """Two edges converging on the SAME handle are ambiguous and removed."""
        test = self._rejoin_workflow((None, None))
        test_service._apply_safe_autofixes(test)
        edge_ids = {e["id"] for e in test["workflow"]["edges"]}
        assert "e-left-join" not in edge_ids
        assert "e-right-join" not in edge_ids


class TestValidateForPersist:
    """`_validate_for_persist(test)` returns the residual errors after autofix."""

    def setup_method(self) -> None:
        _reset_storage_and_registry()

    def test_validate_for_persist_is_exported(self) -> None:
        assert hasattr(test_service, "_validate_for_persist")

    def test_validate_for_persist_returns_empty_for_clean_test(self) -> None:
        """Clean workflow yields no errors.

        The default `_make_workflow_node` builds a variable-setter that
        writes `my_var`, so a clean test must also declare `my_var` in the
        variables dict. Per the UNDECLARED_VARIABLE contract (no implicit
        save-time autofix), leaving `variables` empty here would surface
        an UNDECLARED_VARIABLE error instead of an empty residual.
        """
        node = _make_workflow_node("node-1")
        test = {
            "name": "Clean",
            "workflow": {"nodes": [node], "edges": []},
            "variables": {"my_var": {"type": "string", "value": ""}},
        }
        residual = test_service._validate_for_persist(test)
        assert residual == []

    def test_validate_for_persist_surfaces_required_param_missing(self) -> None:
        """REQUIRED_PARAM_MISSING is a residual user-actionable error after autofix."""
        node = _make_workflow_node(
            "node-1",
            "variable-setter",
            "control",
            "Set Variables",
            config={"values": {}},
        )
        test = {
            "name": "Required Missing",
            "workflow": {"nodes": [node], "edges": []},
            "variables": {"my_var": {"type": "string", "value": ""}},
        }
        residual = test_service._validate_for_persist(test)
        codes = [e["code"] for e in residual]
        assert "REQUIRED_PARAM_MISSING" in codes

    def test_validate_for_persist_skips_autofixable_codes(self) -> None:
        """Structural errors that autofix handled are NOT in the residual."""
        good = _make_workflow_node("node-good")
        test = {
            "name": "Autofixable Only",
            "workflow": {
                "nodes": [good],
                "edges": [{"id": "e1", "source": "node-good", "target": "ghost-node"}],
            },
            "variables": {"my_var": {"type": "string", "value": ""}},
        }
        residual = test_service._validate_for_persist(test)
        codes = [e["code"] for e in residual]
        assert "DANGLING_EDGE" not in codes


class TestCreateTestPipeline:
    """create_test runs the full pipeline before persisting."""

    def setup_method(self) -> None:
        _reset_storage_and_registry()

    def test_create_test_with_only_structural_errors_persists_clean(self) -> None:
        """Structural-only errors are auto-fixed silently and the test persists.

        The default `_make_workflow_node` is a variable-setter writing
        `my_var`, so we declare `my_var` in the variables map to keep the
        only outstanding error the structural ghost edge (autofixable).
        """
        good = _make_workflow_node("node-good")
        data = {
            "name": "Auto Fixable Test",
            "workflow": {
                "nodes": [good],
                "edges": [{"id": "e1", "source": "node-good", "target": "ghost-node"}],
            },
            "variables": {"my_var": {"type": "string", "value": ""}},
        }
        result = test_service.create_test(data)
        assert result["workflow"]["edges"] == []

        fetched = test_service.get_test(result["id"])
        assert fetched is not None
        assert fetched["workflow"]["edges"] == []

    def test_create_test_reports_the_repairs_it_applied(self) -> None:
        """A dropped edge is named back to the caller, not swallowed."""
        good = _make_workflow_node("node-good")
        data = {
            "name": "Reported Repair Test",
            "workflow": {
                "nodes": [good],
                "edges": [{"id": "e1", "source": "node-good", "target": "ghost-node"}],
            },
            "variables": {"my_var": {"type": "string", "value": ""}},
        }
        result = test_service.create_test(data)

        repairs = result["repairs"]
        assert [r["kind"] for r in repairs] == ["edge"]
        assert repairs[0]["id"] == "e1"
        assert "ghost-node" in repairs[0]["message"]

    def test_create_test_reports_a_removed_node_with_its_code(self) -> None:
        """A node the pipeline deletes is named with the code that condemned it."""
        bad = _make_workflow_node("node-bad")
        bad["data"]["nodeType"] = "plugin"  # variable-setter is a control
        data = {
            "name": "Reported Node Removal Test",
            "workflow": {"nodes": [bad], "edges": []},
            "variables": {"my_var": {"type": "string", "value": ""}},
        }
        result = test_service.create_test(data)

        assert result["workflow"]["nodes"] == []
        node_repairs = [r for r in result["repairs"] if r["kind"] == "node"]
        assert len(node_repairs) == 1
        assert node_repairs[0]["id"] == "node-bad"
        assert node_repairs[0]["code"] == "NODE_TYPE_MISMATCH"

    def test_create_test_reports_no_repairs_for_a_clean_workflow(self) -> None:
        """A well-formed test carries an empty repair list, never a missing key."""
        good = _make_workflow_node("node-good")
        data = {
            "name": "Clean Repair Test",
            "workflow": {"nodes": [good], "edges": []},
            "variables": {"my_var": {"type": "string", "value": ""}},
        }
        result = test_service.create_test(data)

        assert result["repairs"] == []

    def test_update_test_reports_the_repairs_it_applied(self) -> None:
        """The update path reports repairs the same way create does."""
        good = _make_workflow_node("node-good")
        created = test_service.create_test(
            {
                "name": "Updated Repair Test",
                "workflow": {"nodes": [good], "edges": []},
                "variables": {"my_var": {"type": "string", "value": ""}},
            }
        )
        result = test_service.update_test(
            created["id"],
            {
                "name": "Updated Repair Test",
                "workflow": {
                    "nodes": [good],
                    "edges": [{"id": "e9", "source": "node-good", "target": "ghost-node"}],
                },
                "variables": {"my_var": {"type": "string", "value": ""}},
            },
        )

        assert [r["id"] for r in result["repairs"]] == ["e9"]

    def test_create_test_with_required_param_missing_raises(self) -> None:
        """REQUIRED_PARAM_MISSING blocks save via SaveValidationError."""
        node = _make_workflow_node(
            "node-1",
            "variable-setter",
            "control",
            "Set Variables",
            config={"values": {}},
        )
        data = {
            "name": "Blocked Required",
            "workflow": {"nodes": [node], "edges": []},
            "variables": {"my_var": {"type": "string", "value": ""}},
        }
        with pytest.raises(SaveValidationError) as excinfo:
            test_service.create_test(data)
        codes = [e["code"] for e in excinfo.value.errors]
        assert "REQUIRED_PARAM_MISSING" in codes

    def test_create_test_with_invalid_output_binding_type_raises(self) -> None:
        """Output bound to a wrong-type variable blocks save with INVALID_OUTPUT_BINDING_TYPE."""
        # http-client `body` is a string output; binding it to an integer variable is incompatible
        http_node = _make_workflow_node(
            "node-1",
            "http-client",
            "plugin",
            "HTTP Call",
            config={
                "values": {"method": "GET", "url": "http://example.com"},
                "outputBindings": {"body": "count"},
            },
        )
        data = {
            "name": "Bad Output Binding",
            "workflow": {"nodes": [http_node], "edges": []},
            "variables": {"count": {"type": "integer", "value": 1}},
        }
        with pytest.raises(SaveValidationError) as excinfo:
            test_service.create_test(data)
        codes = [e["code"] for e in excinfo.value.errors]
        assert "INVALID_OUTPUT_BINDING_TYPE" in codes

    def test_create_test_does_not_persist_when_pipeline_raises(self) -> None:
        """If pipeline raises, the test is not stored (caller can list and confirm absence)."""
        node = _make_workflow_node(
            "node-1",
            "variable-setter",
            "control",
            "Set Variables",
            config={"values": {}},
        )
        data = {
            "name": "Should Not Persist",
            "workflow": {"nodes": [node], "edges": []},
            "variables": {"my_var": {"type": "string", "value": ""}},
        }
        with pytest.raises(SaveValidationError):
            test_service.create_test(data)
        listed = [
            t for t in test_service._list_all_tests() if t.get("name") == "Should Not Persist"
        ]
        assert listed == []


class TestBlockNameRulesAtSave:
    """A Block's name rule is the save's: a name the run refuses is never stored."""

    def setup_method(self) -> None:
        from wavecore.core.plugin_registry import register_plugin
        from wavecore.plugins.python import PythonPlugin

        _reset_storage_and_registry()
        register_plugin(PythonPlugin())

    def test_create_test_refuses_a_python_input_variable_name_outside_ascii(self) -> None:
        node = _make_workflow_node(
            "node-1",
            "python",
            "plugin",
            "Python",
            config={"values": {"script": "print(café)", "input_vars": {"café": 1}}},
        )
        data = {
            "name": "Python Name Outside ASCII",
            "workflow": {"nodes": [node], "edges": []},
            "variables": {},
        }

        with pytest.raises(SaveValidationError) as excinfo:
            test_service.create_test(data)

        assert [(e["code"], e["message"], e["path"]) for e in excinfo.value.errors] == [
            (
                "INVALID_NAME",
                "Invalid variable name: 'café'",
                "nodes[0].data.config.values.input_vars",
            )
        ]


class TestShellNameRulesAtSave:
    """Shell Script's name rules are the save's: a name its run refuses is never stored."""

    def setup_method(self) -> None:
        from wavecore.core.plugin_registry import register_plugin
        from wavecore.plugins.shell_script import ShellScriptPlugin

        _reset_storage_and_registry()
        register_plugin(ShellScriptPlugin())

    def _create(self, values: dict[str, Any]) -> list[tuple[str, str, str]]:
        node = _make_workflow_node(
            "node-1", "shell-script", "plugin", "Shell Script", config={"values": values}
        )
        data = {
            "name": "Shell Names",
            "workflow": {"nodes": [node], "edges": []},
            "variables": {},
        }
        with pytest.raises(SaveValidationError) as excinfo:
            test_service.create_test(data)
        return [(e["code"], e["message"], e["path"]) for e in excinfo.value.errors]

    def test_create_test_refuses_an_input_variable_that_takes_the_wave_prefix(self) -> None:
        assert self._create({"script": "echo hi", "input_vars": {"WAVE_X": 1}}) == [
            (
                "INVALID_NAME",
                "Variable names may not start with WAVE_: 'WAVE_X'",
                "nodes[0].data.config.values.input_vars",
            )
        ]

    def test_create_test_refuses_an_export_that_is_not_a_shell_identifier(self) -> None:
        assert self._create({"script": "echo hi", "script_variables": ["1X"]}) == [
            (
                "INVALID_NAME",
                "Invalid script variable name: '1X'",
                "nodes[0].data.config.values.script_variables",
            )
        ]


class TestUpdateTestPipeline:
    """update_test runs the same pipeline as create_test."""

    def setup_method(self) -> None:
        _reset_storage_and_registry()

    def test_update_test_with_structural_errors_persists_clean(self) -> None:
        """Round trip: dangling-edge update saves a clean workflow."""
        created = test_service.create_test(
            {
                "name": "Round Trip",
                "workflow": {"nodes": [_make_workflow_node("node-good")], "edges": []},
                "variables": {"my_var": {"type": "string", "value": ""}},
            }
        )
        result = test_service.update_test(
            created["id"],
            {
                "workflow": {
                    "nodes": [_make_workflow_node("node-good")],
                    "edges": [{"id": "e1", "source": "node-good", "target": "ghost-node"}],
                },
            },
        )
        assert result is not None
        assert result["workflow"]["edges"] == []

        fetched = test_service.get_test(created["id"])
        assert fetched is not None
        assert fetched["workflow"]["edges"] == []

    def test_update_test_with_required_param_missing_raises(self) -> None:
        """REQUIRED_PARAM_MISSING from update payload blocks save."""
        created = test_service.create_test(
            {
                "name": "Update Block Test",
                "workflow": {"nodes": [_make_workflow_node("node-good")], "edges": []},
                "variables": {"my_var": {"type": "string", "value": ""}},
            }
        )
        bad_node = _make_workflow_node(
            "node-1",
            "variable-setter",
            "control",
            "Set Variables",
            config={"values": {}},
        )
        with pytest.raises(SaveValidationError) as excinfo:
            test_service.update_test(
                created["id"],
                {"workflow": {"nodes": [bad_node], "edges": []}},
            )
        codes = [e["code"] for e in excinfo.value.errors]
        assert "REQUIRED_PARAM_MISSING" in codes

    def test_update_test_with_invalid_output_binding_type_raises(self) -> None:
        """INVALID_OUTPUT_BINDING_TYPE from update payload blocks save."""
        created = test_service.create_test(
            {
                "name": "Update Bad Binding",
                "workflow": {"nodes": [_make_workflow_node("node-good")], "edges": []},
                "variables": {
                    "my_var": {"type": "string", "value": ""},
                    "count": {"type": "integer", "value": 1},
                },
            }
        )
        http_node = _make_workflow_node(
            "node-1",
            "http-client",
            "plugin",
            "HTTP Call",
            config={
                "values": {"method": "GET", "url": "http://example.com"},
                "outputBindings": {"body": "count"},
            },
        )
        with pytest.raises(SaveValidationError) as excinfo:
            test_service.update_test(
                created["id"],
                {"workflow": {"nodes": [http_node], "edges": []}},
            )
        codes = [e["code"] for e in excinfo.value.errors]
        assert "INVALID_OUTPUT_BINDING_TYPE" in codes


class TestInvalidOutputBindingTypeValidation:
    """_validate_test_data emits INVALID_OUTPUT_BINDING_TYPE per its class assignment."""

    def setup_method(self) -> None:
        _reset_storage_and_registry()

    def _bad_binding_test(self) -> dict[str, Any]:
        http_node = _make_workflow_node(
            "node-1",
            "http-client",
            "plugin",
            "HTTP Call",
            config={
                "values": {"method": "GET", "url": "http://example.com"},
                "outputBindings": {"body": "count"},
            },
        )
        return {
            "name": "Bad Binding Validation",
            "workflow": {"nodes": [http_node], "edges": []},
            "variables": {"count": {"type": "integer", "value": 1}},
        }

    def test_save_context_emits_error(self) -> None:
        """On save context, INVALID_OUTPUT_BINDING_TYPE is in errors."""
        test = self._bad_binding_test()
        result = test_service._validate_test_data(test, context="save")
        codes = [e["code"] for e in result.get("errors", [])]
        assert "INVALID_OUTPUT_BINDING_TYPE" in codes

    def test_run_context_emits_error(self) -> None:
        """On run context, INVALID_OUTPUT_BINDING_TYPE is in errors."""
        test = self._bad_binding_test()
        result = test_service._validate_test_data(test, context="run")
        codes = [e["code"] for e in result.get("errors", [])]
        assert "INVALID_OUTPUT_BINDING_TYPE" in codes

    def test_load_context_emits_warning(self) -> None:
        """On load context, INVALID_OUTPUT_BINDING_TYPE is a warning, not an error."""
        test = self._bad_binding_test()
        result = test_service._validate_test_data(test, context="load")
        warning_codes = [w["code"] for w in result.get("warnings", [])]
        error_codes = [e["code"] for e in result.get("errors", [])]
        assert "INVALID_OUTPUT_BINDING_TYPE" in warning_codes
        assert "INVALID_OUTPUT_BINDING_TYPE" not in error_codes

    def test_compatible_binding_does_not_emit(self) -> None:
        """A compatible variable binding does not produce the error."""
        http_node = _make_workflow_node(
            "node-1",
            "http-client",
            "plugin",
            "HTTP Call",
            config={
                "values": {"method": "GET", "url": "http://example.com"},
                "outputBindings": {"body": "body_var"},
            },
        )
        test = {
            "name": "Compatible Binding",
            "workflow": {"nodes": [http_node], "edges": []},
            "variables": {"body_var": {"type": "string", "value": ""}},
        }
        result = test_service._validate_test_data(test, context="save")
        codes = [e["code"] for e in result.get("errors", [])]
        assert "INVALID_OUTPUT_BINDING_TYPE" not in codes


class TestResolvedOutputTypeBindingValidation:
    """An output whose declared type follows its own settings is checked at the resolved type."""

    def setup_method(self) -> None:
        _reset_storage_and_registry()
        from wavecore.core.plugin_registry import register_plugin
        from wavecore.plugins.k8s_get import K8sGetPlugin

        register_plugin(K8sGetPlugin())

    @staticmethod
    def _get_node(values: dict[str, Any], node_id: str = "node-1") -> dict[str, Any]:
        settings: dict[str, Any] = {"session": "kubeconfig", "kind": "Pod", "name": "web-1"}
        settings.update(values)
        return _make_workflow_node(
            node_id,
            "k8s-get",
            "plugin",
            "Read Pods",
            config={"values": settings, "outputBindings": {"result": "pods"}},
        )

    @classmethod
    def _get_test(cls, values: dict[str, Any], var_type: str) -> dict[str, Any]:
        return {
            "name": "K8s Result Binding",
            "workflow": {"nodes": [cls._get_node(values)], "edges": []},
            "variables": {"pods": {"type": var_type, "value": None}},
        }

    @staticmethod
    def _binding_entries(test: dict[str, Any], context: str, bucket: str) -> list[dict[str, Any]]:
        result = test_service._validate_test_data(test, context=context)
        entries = result.get(bucket, [])
        return [e for e in entries if e["code"] == "INVALID_OUTPUT_BINDING_TYPE"]

    def test_table_mode_accepts_a_table_variable(self) -> None:
        test = self._get_test({"output_format": "table"}, "table")

        assert self._binding_entries(test, "save", "errors") == []

    def test_table_mode_rejects_a_map_variable(self) -> None:
        test = self._get_test({"output_format": "table"}, "map")

        errors = self._binding_entries(test, "save", "errors")

        assert len(errors) == 1
        assert errors[0]["message"] == (
            "Output 'result' (type table) cannot bind to variable 'pods' (type map)"
        )

    def test_the_same_mismatch_is_a_warning_on_load(self) -> None:
        test = self._get_test({"output_format": "table"}, "map")

        assert self._binding_entries(test, "load", "warnings") != []
        assert self._binding_entries(test, "load", "errors") == []

    def test_an_absent_output_format_resolves_through_the_parameter_default(self) -> None:
        test = self._get_test({}, "map")

        assert self._binding_entries(test, "save", "errors") == []

    def test_a_list_read_in_map_mode_resolves_to_array(self) -> None:
        accepted = self._get_test({"output_format": "map", "search_by": "list"}, "array")
        rejected = self._get_test({"output_format": "map", "search_by": "list"}, "map")

        assert self._binding_entries(accepted, "save", "errors") == []
        assert len(self._binding_entries(rejected, "save", "errors")) == 1

    def test_a_block_without_type_rules_is_unaffected(self) -> None:
        http_node = _make_workflow_node(
            "node-1",
            "http-client",
            "plugin",
            "HTTP Call",
            config={
                "values": {"method": "GET", "url": "http://example.com"},
                "outputBindings": {"body": "body_var"},
            },
        )
        test = {
            "name": "Plain Binding",
            "workflow": {"nodes": [http_node], "edges": []},
            "variables": {"body_var": {"type": "string", "value": ""}},
        }

        assert self._binding_entries(test, "save", "errors") == []

    def test_the_expected_param_type_agrees_with_the_binding_validator(self) -> None:
        table_node = self._get_node({"output_format": "table"})
        map_node = self._get_node({"output_format": "map"}, node_id="node-2")

        assert _expected_types_of([table_node], "pods") == {"table"}
        assert _expected_types_of([map_node], "pods") == {"map"}


class TestMultiTypedParameterExpectedType:
    """A parameter that accepts several types has no single expected type."""

    def setup_method(self) -> None:
        _reset_storage_and_registry()

    @staticmethod
    def _for_each_node(node_id: str = "node-1") -> dict[str, Any]:
        node = _make_workflow_node(
            node_id,
            "for-each",
            "control",
            "Each Item",
            config={"values": {"collection": "items", "timeout": 5}},
        )
        node["data"]["expressionFields"] = ["collection"]
        return node

    def test_a_multi_typed_parameter_has_no_expected_type(self) -> None:
        node = self._for_each_node()

        assert _expected_types_of([node], "items") == set()

    def test_the_undeclared_variable_fix_invents_no_type(self) -> None:
        test = {
            "name": "Loop",
            "workflow": {"nodes": [self._for_each_node()], "edges": []},
            "variables": {},
        }

        result = test_service._validate_test_data(test, context="save")
        undeclared = [e for e in result.get("errors", []) if e["code"] == "UNDECLARED_VARIABLE"]

        assert len(undeclared) == 1
        assert undeclared[0]["fix_action"] == "Add variable to manager (type: string)"

    def test_two_multi_typed_reads_expect_no_type(self) -> None:
        nodes = [self._for_each_node(), self._for_each_node("node-2")]

        assert test_service._expected_types(test_service._sites_naming(nodes, "items")) == set()


class TestAnyTypeParameterExpectedType:
    """A setting that accepts a value of any type sets no expected type (REQ-3.4.2.2)."""

    def setup_method(self) -> None:
        from wavecore.core.plugin_registry import register_plugin
        from wavecore.plugins.log import LogPlugin

        _reset_storage_and_registry()
        register_plugin(LogPlugin())

    @staticmethod
    def _log_node() -> dict[str, Any]:
        node = _make_workflow_node(
            "node-1",
            "log",
            "plugin",
            "Print Count",
            config={"values": {"message": "count", "level": "INFO"}},
        )
        node["data"]["expressionFields"] = ["message"]
        return node

    @staticmethod
    def _loop_node() -> dict[str, Any]:
        node = _make_workflow_node(
            "node-2",
            "for-each",
            "control",
            "Each Item",
            config={"values": {"collection": "[1, 2]", "timeout": "count"}},
        )
        node["data"]["expressionFields"] = ["collection", "timeout"]
        return node

    def test_the_log_message_has_no_expected_type(self) -> None:
        assert _expected_types_of([self._log_node()], "count") == set()

    def test_the_log_level_keeps_its_expected_type(self) -> None:
        node = self._log_node()
        node["data"]["config"]["values"]["level"] = "chosen_level"
        node["data"]["expressionFields"] = ["level"]

        assert _expected_types_of([node], "chosen_level") == {"string"}

    def test_a_log_message_read_adds_no_type_beside_a_typed_read(self) -> None:
        found = test_service._sites_naming([self._log_node(), self._loop_node()], "count")

        assert test_service._expected_types(found) == {"float"}

    def test_the_undeclared_variable_fix_takes_the_typed_usage(self) -> None:
        test = {
            "name": "Count",
            "workflow": {"nodes": [self._log_node(), self._loop_node()], "edges": []},
            "variables": {},
        }

        result = test_service._validate_test_data(test, context="save")
        undeclared = [e for e in result.get("errors", []) if e["code"] == "UNDECLARED_VARIABLE"]

        assert len(undeclared) == 1
        assert undeclared[0]["fix_action"] == "Add variable to manager (type: float)"


class TestFixEndpointPreservesVisibleWarnings:
    """fix_test preserves visible (REQUIRED_PARAM_*) errors as post-fix warnings."""

    def setup_method(self) -> None:
        _reset_storage_and_registry()

    def test_fix_preserves_required_param_missing_in_warnings(self) -> None:
        """A test with autofixable + required-missing keeps the required warning post-fix."""
        from tests.api.test_test_service import _create_test_with_legacy_data

        bad_node = _make_workflow_node(
            "node-1",
            "variable-setter",
            "control",
            "Set Variables",
            config={"values": {}},
        )
        good = _make_workflow_node("node-good")
        test = _create_test_with_legacy_data(
            {
                "name": "Fix Preserves Required",
                "workflow": {
                    "nodes": [bad_node, good],
                    "edges": [{"id": "e1", "source": "node-good", "target": "ghost-node"}],
                },
                "variables": {"my_var": {"type": "string", "value": ""}},
            }
        )

        fix_result = test_service.fix_test(test["id"])
        assert fix_result is not None
        warning_codes = [w["code"] for w in fix_result.get("warnings", [])]
        assert "REQUIRED_PARAM_MISSING" in warning_codes


class TestRoutesUnifiedSaveValidation:
    """POST /tests and PUT /tests/{id} render 422 with the new top-level message."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def setup_method(self) -> None:
        _reset_storage_and_registry()

    def test_post_tests_returns_422_with_new_message_on_required_missing(
        self, client: TestClient
    ) -> None:
        """422 message format is ^Test has \\d+ validation error\\(s\\)$."""
        bad_node = _make_workflow_node(
            "node-1",
            "variable-setter",
            "control",
            "Set Variables",
            config={"values": {}},
        )
        response = client.post(
            "/tests",
            json={
                "name": "POST 422 Required",
                "workflow": {"nodes": [bad_node], "edges": []},
                "variables": {"my_var": {"type": "string", "value": ""}},
            },
        )
        assert response.status_code == 422
        payload = response.json()
        assert payload["success"] is False
        assert payload["error"]["code"] == "VALIDATION_ERROR"
        assert re.match(r"^Test has \d+ validation error\(s\)$", payload["error"]["message"])
        detail_codes = [d["code"] for d in payload["error"]["details"]]
        assert "REQUIRED_PARAM_MISSING" in detail_codes

    def test_post_tests_returns_422_with_invalid_output_binding_type(
        self, client: TestClient
    ) -> None:
        """422 includes INVALID_OUTPUT_BINDING_TYPE in the details array."""
        http_node = _make_workflow_node(
            "node-1",
            "http-client",
            "plugin",
            "HTTP Call",
            config={
                "values": {"method": "GET", "url": "http://example.com"},
                "outputBindings": {"body": "count"},
            },
        )
        response = client.post(
            "/tests",
            json={
                "name": "POST 422 Binding",
                "workflow": {"nodes": [http_node], "edges": []},
                "variables": {"count": {"type": "integer", "value": 1}},
            },
        )
        assert response.status_code == 422
        payload = response.json()
        codes = [d["code"] for d in payload["error"]["details"]]
        assert "INVALID_OUTPUT_BINDING_TYPE" in codes

    def test_put_tests_returns_422_with_new_message_on_required_missing(
        self, client: TestClient
    ) -> None:
        """422 from update has identical envelope to create."""
        created = test_service.create_test(
            {
                "name": "PUT 422 Setup",
                "workflow": {"nodes": [_make_workflow_node("node-good")], "edges": []},
                "variables": {"my_var": {"type": "string", "value": ""}},
            }
        )
        bad_node = _make_workflow_node(
            "node-1",
            "variable-setter",
            "control",
            "Set Variables",
            config={"values": {}},
        )
        response = client.put(
            f"/tests/{created['id']}",
            json={
                "name": "PUT 422 Setup",
                "workflow": {"nodes": [bad_node], "edges": []},
            },
        )
        assert response.status_code == 422
        payload = response.json()
        assert payload["success"] is False
        assert payload["error"]["code"] == "VALIDATION_ERROR"
        assert re.match(r"^Test has \d+ validation error\(s\)$", payload["error"]["message"])
        detail_codes = [d["code"] for d in payload["error"]["details"]]
        assert "REQUIRED_PARAM_MISSING" in detail_codes

    def test_post_tests_with_only_structural_errors_returns_201(self, client: TestClient) -> None:
        """The pipeline auto-fixes structural errors before persisting."""
        response = client.post(
            "/tests",
            json={
                "name": "POST 201 Autofix",
                "workflow": {
                    "nodes": [_make_workflow_node("node-good")],
                    "edges": [{"id": "e1", "source": "node-good", "target": "ghost-node"}],
                },
                "variables": {"my_var": {"type": "string", "value": ""}},
            },
        )
        assert response.status_code == 201
        payload = response.json()
        assert payload["data"]["workflow"]["edges"] == []


class TestRoutesHaveNoSaveValidationHelper:
    """Save validation lives in the service pipeline, not in a route helper."""

    def test_routes_module_has_no_check_save_validation(self) -> None:
        """`_check_save_validation` is not a symbol of the routes module.

        The pipeline runs unconditionally inside the service layer.
        """
        from wavecore.api.routes.tests import routes as tests_routes

        assert not hasattr(tests_routes, "_check_save_validation")


class TestUpdateTestUndeclaredVariableBlocksSave:
    """UNDECLARED_VARIABLE save-time behavior under the user-initiated-fix contract.

    update_test raises SaveValidationError when the payload
    references a variable that is not declared - the FE catches the 422 and
    surfaces the Fix-or-Cancel dialog, and only the user-initiated Fix
    button (which routes through `fix_test`) actually recreates the
    variable. UNDECLARED_VARIABLE lives in `_ON_DEMAND_VARIABLE_FIX_CODES`,
    not `_VARIABLE_FIX_CODES`.
    """

    def setup_method(self) -> None:
        _reset_storage_and_registry()

    def test_update_test_raises_on_undeclared_variable(self) -> None:
        """UNDECLARED_VARIABLE is NOT silently auto-fixed during save.

        update_test must raise SaveValidationError so the FE shows the
        Fix-or-Cancel dialog rather than the BE quietly recreating the
        variable behind the user's back.
        """
        created = test_service.create_test(
            {
                "name": "Undeclared Auto Fix",
                "workflow": {"nodes": [_make_workflow_node("node-good")], "edges": []},
                "variables": {"my_var": {"type": "string", "value": ""}},
            }
        )

        # http-client `body` has type string. ghost_body is undeclared in variables.
        http_node = _make_workflow_node(
            "node-2",
            "http-client",
            "plugin",
            "HTTP Call",
            config={
                "values": {"method": "GET", "url": "http://example.com"},
                "outputBindings": {"body": "ghost_body"},
            },
        )

        with pytest.raises(SaveValidationError) as excinfo:
            test_service.update_test(
                created["id"],
                {"workflow": {"nodes": [_make_workflow_node("node-good"), http_node], "edges": []}},
            )
        codes = [e["code"] for e in excinfo.value.errors]
        assert "UNDECLARED_VARIABLE" in codes


class TestValidateTestDataForCreate:
    """Public dry-run wrapper for the create pipeline (REQ-5.2.7.9).

    Runs the persist validation on a deep copy plus the create-path
    name-conflict scan; persists nothing and never mutates the caller's dict.
    """

    def setup_method(self) -> None:
        _reset_storage_and_registry()

    @staticmethod
    def _clean_data(name: str) -> dict[str, Any]:
        return {
            "name": name,
            "workflow": {"nodes": [_make_workflow_node("node-good")], "edges": []},
            "variables": {"my_var": {"type": "string", "value": ""}},
        }

    @staticmethod
    def _invalid_data(name: str) -> dict[str, Any]:
        node = _make_workflow_node(
            "node-1",
            "variable-setter",
            "control",
            "Set Variables",
            config={"values": {}},
        )
        return {
            "name": name,
            "workflow": {"nodes": [node], "edges": []},
            "variables": {"my_var": {"type": "string", "value": ""}},
        }

    def test_clean_data_returns_no_errors(self) -> None:
        assert test_service.validate_test_data_for_create(self._clean_data("Dry Clean")) == []

    def test_input_dict_is_never_mutated(self) -> None:
        import copy

        data = self._clean_data("Dry Untouched")
        # A ghost edge is autofixed in the pipeline; the dry run must apply
        # that fix to its own deep copy only.
        data["workflow"]["edges"] = [{"id": "e1", "source": "node-good", "target": "ghost-node"}]
        snapshot = copy.deepcopy(data)
        test_service.validate_test_data_for_create(data)
        assert data == snapshot

    def test_input_dict_is_not_mutated_on_residual_errors(self) -> None:
        import copy

        data = self._invalid_data("Dry Invalid Untouched")
        snapshot = copy.deepcopy(data)
        test_service.validate_test_data_for_create(data)
        assert data == snapshot

    def test_name_conflict_entry_uses_the_create_path_message(self) -> None:
        test_service.create_test(self._clean_data("Taken Test"))
        errors = test_service.validate_test_data_for_create(self._clean_data("Taken Test"))
        assert len(errors) == 1
        assert errors[0]["code"] == "NAME_CONFLICT"
        assert errors[0]["message"] == "Test with name 'Taken Test' already exists"

    def test_name_conflict_is_prepended_to_residual_errors(self) -> None:
        test_service.create_test(self._clean_data("Taken Twice"))
        errors = test_service.validate_test_data_for_create(self._invalid_data("Taken Twice"))
        assert errors[0]["code"] == "NAME_CONFLICT"
        residual_codes = [e["code"] for e in errors[1:]]
        assert "REQUIRED_PARAM_MISSING" in residual_codes

    def test_residual_errors_match_the_create_pipeline(self) -> None:
        import copy

        data = self._invalid_data("Dry Parity")
        dry_run_errors = test_service.validate_test_data_for_create(copy.deepcopy(data))
        with pytest.raises(SaveValidationError) as excinfo:
            test_service.create_test(copy.deepcopy(data))
        assert [e["code"] for e in dry_run_errors] == [e["code"] for e in excinfo.value.errors]

    def test_dry_run_persists_nothing(self) -> None:
        test_service.validate_test_data_for_create(self._clean_data("Dry Run Only"))
        names = [t.get("name") for t in test_service._list_all_tests()]
        assert "Dry Run Only" not in names

    @staticmethod
    def _shared_instance(function_id: str, function_version: str) -> dict[str, Any]:
        """A top-level block that uses one version of a library Function."""
        return {
            "id": "fn-1",
            "type": "workflowNode",
            "position": {"x": 300, "y": 200},
            "data": {
                "elementType": "function",
                "nodeType": "function",
                "version": "1.0.0",
                "label": "Authenticate",
                "functionLifecycle": "shared",
                "functionId": function_id,
                "functionVersion": function_version,
                "config": {"values": {}, "outputBindings": {}, "profileBindings": []},
            },
        }

    @classmethod
    def _data_using(cls, name: str, function_id: str, function_version: str) -> dict[str, Any]:
        data = cls._clean_data(name)
        data["workflow"]["nodes"].append(cls._shared_instance(function_id, function_version))
        return data

    @staticmethod
    def _findings(errors: list[dict[str, Any]]) -> list[tuple[str, str]]:
        return [(error["code"], error["message"]) for error in errors]

    def test_check_name_false_skips_the_name_scan(self) -> None:
        test_service.create_test(self._clean_data("Taken Unchecked"))

        clean = test_service.validate_test_data_for_create(
            self._clean_data("Taken Unchecked"), check_name=False
        )
        invalid = test_service.validate_test_data_for_create(
            self._invalid_data("Taken Unchecked"), check_name=False
        )

        assert clean == []
        codes = [error["code"] for error in invalid]
        assert "NAME_CONFLICT" not in codes
        assert "REQUIRED_PARAM_MISSING" in codes

    def test_a_taken_name_is_still_reported_by_default(self) -> None:
        test_service.create_test(self._clean_data("Taken Default"))

        by_default = test_service.validate_test_data_for_create(self._clean_data("Taken Default"))
        asked = test_service.validate_test_data_for_create(
            self._clean_data("Taken Default"), check_name=True
        )

        assert self._findings(by_default) == [
            ("NAME_CONFLICT", "Test with name 'Taken Default' already exists")
        ]
        assert asked == by_default

    def test_a_given_library_replaces_the_one_on_disk(self) -> None:
        function_id = str(uuid.uuid4())
        registry = {function_id: {"available_versions": ["1.0.0"]}}
        contracts = {
            (function_id, "1.0.0"): {
                "inputs": [{"name": "user_id", "type": "string", "required": True}],
                "outputs": [],
            }
        }

        def _contract(asked_id: str, asked_version: str) -> dict[str, Any] | None:
            return contracts.get((asked_id, asked_version))

        on_disk = test_service.validate_test_data_for_create(
            self._data_using("Library On Disk", function_id, "1.0.0")
        )
        given = test_service.validate_test_data_for_create(
            self._data_using("Library Given", function_id, "1.0.0"),
            function_registry=registry,
            contract_loader=_contract,
        )
        given_other_version = test_service.validate_test_data_for_create(
            self._data_using("Library Given Other Version", function_id, "2.0.0"),
            function_registry=registry,
            contract_loader=_contract,
        )

        assert self._findings(on_disk) == [
            ("MISSING_FUNCTION_ID", f"References unknown Function '{function_id}'")
        ]
        assert self._findings(given) == [
            ("REQUIRED_PARAM_MISSING", "Required parameter 'user_id' is missing")
        ]
        assert self._findings(given_other_version) == [
            (
                "MISSING_FUNCTION_VERSION",
                "Pinned version 2.0.0 is no longer available in the library",
            )
        ]

    def test_a_given_reference_index_replaces_the_one_on_disk(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from wavecore.api.services.functions import _storage as function_storage

        function_id = str(uuid.uuid4())
        reads: list[str] = []

        def _read_from_disk() -> dict[str, set[str]]:
            reads.append("read")
            return {}

        monkeypatch.setattr(function_storage, "load_reference_index", _read_from_disk)

        def _validate(**library: Any) -> list[dict[str, Any]]:
            return test_service.validate_test_data_for_create(
                self._data_using("Index Given", function_id, "1.0.0"),
                function_registry={function_id: {"available_versions": ["1.0.0"]}},
                contract_loader=lambda _id, _version: {"inputs": [], "outputs": []},
                **library,
            )

        given = _validate(reference_index={function_id: {function_id}})
        read_for_given = list(reads)
        on_disk = _validate()

        assert self._findings(given) == [
            (
                "SELF_REFERENTIAL_FUNCTION",
                "Function 'Authenticate' cannot be nested inside itself "
                f"(composition cycle: {function_id} -> {function_id})",
            )
        ]
        assert read_for_given == []
        assert on_disk == []
        assert reads != []

    def test_the_given_document_is_not_changed_with_the_new_arguments(self) -> None:
        import copy

        function_id = str(uuid.uuid4())
        data = self._data_using("Dry Untouched Library", function_id, "1.0.0")
        # A ghost edge is autofixed in the pipeline, on the copy only.
        data["workflow"]["edges"] = [{"id": "e1", "source": "node-good", "target": "ghost-node"}]
        snapshot = copy.deepcopy(data)

        test_service.validate_test_data_for_create(
            data,
            check_name=False,
            function_registry={function_id: {"available_versions": ["1.0.0"]}},
            contract_loader=lambda _id, _version: {"inputs": [], "outputs": []},
        )

        assert data == snapshot


class TestHaltFunctionScopeValidation:
    """`function` Halt scope is only valid inside a Function body.

    The FE hides the option outside a Function; the backend rejects it on the
    import / hand-edited paths the FE guard does not cover. A Halt inside a
    Function body keeps the scope (validated via the embedded-Function walk).
    """

    def setup_method(self) -> None:
        _reset_storage_and_registry()

    def test_top_level_function_scope_halt_is_rejected(self) -> None:
        halt = _make_workflow_node(
            "halt-1",
            "halt",
            "control",
            "Halt",
            config={"values": {"scope": "function", "status": "failed"}},
        )
        test = {
            "name": "Top-Level Function Halt",
            "workflow": {"nodes": [halt], "edges": []},
            "variables": {},
        }
        result = test_service._validate_test_data(test, context="save")
        codes = [e["code"] for e in result.get("errors", [])]
        assert "HALT_FUNCTION_SCOPE_OUTSIDE_FUNCTION" in codes

    def test_top_level_test_scope_halt_is_allowed(self) -> None:
        halt = _make_workflow_node(
            "halt-1",
            "halt",
            "control",
            "Halt",
            config={"values": {"scope": "test", "status": "failed"}},
        )
        test = {
            "name": "Top-Level Test Halt",
            "workflow": {"nodes": [halt], "edges": []},
            "variables": {},
        }
        result = test_service._validate_test_data(test, context="save")
        codes = [e["code"] for e in result.get("errors", [])]
        assert "HALT_FUNCTION_SCOPE_OUTSIDE_FUNCTION" not in codes

    def test_function_scope_halt_inside_function_is_allowed(self) -> None:
        inner_halt = {
            "id": "inner-halt",
            "type": "workflowNode",
            "position": {"x": 50, "y": 50},
            "data": {
                "elementType": "halt",
                "nodeType": "control",
                "version": "1.0.0",
                "label": "Halt",
                "config": {"values": {"scope": "function", "status": "failed"}},
            },
        }
        fn_node = {
            "id": "fn-1",
            "type": "workflowNode",
            "position": {"x": 100, "y": 100},
            "data": {
                "elementType": "function",
                "nodeType": "function",
                "functionLifecycle": "local",
                "version": "1.0.0",
                "label": "Fn",
                "config": {"values": {}, "outputBindings": {}, "profileBindings": []},
                "localDefinition": {
                    "name": "Fn",
                    "description": "",
                    "tags": [],
                    "inputs": [],
                    "outputs": [],
                    "dependencies": {"functions": [], "plugins": []},
                    "workflow": {
                        "nodes": [inner_halt],
                        "edges": [{"source": "start-node", "target": "inner-halt"}],
                    },
                },
            },
        }
        test = {
            "name": "Function-Scoped Halt Inside Function",
            "workflow": {"nodes": [fn_node], "edges": []},
            "variables": {},
        }
        result = test_service._validate_test_data(test, context="save")
        codes = [e["code"] for e in result.get("errors", [])]
        assert "HALT_FUNCTION_SCOPE_OUTSIDE_FUNCTION" not in codes


# ---------------------------------------------------------------------------
# validate_test_data_for_update: the update-path dry-run seam (amend loop).
# The amend loop dry-runs an amended workflow before persisting; distinct
# per-(target, targetHandle) ingress_N rejoins must survive as zero errors.
# ---------------------------------------------------------------------------


def _clean_v1_data(name: str) -> dict[str, Any]:
    """A minimal clean test used as the amend target (version 1.0.0)."""
    return {
        "name": name,
        "workflow": {"nodes": [_make_workflow_node("node-good")], "edges": []},
        "variables": {"my_var": {"type": "string", "value": ""}},
    }


def _required_missing_node() -> dict[str, Any]:
    """A variable-setter with no `variables` value - surfaces REQUIRED_PARAM_MISSING."""
    return _make_workflow_node(
        "node-1",
        "variable-setter",
        "control",
        "Set Variables",
        config={"values": {}},
    )


def _invalid_amend_data(name: str) -> dict[str, Any]:
    """Amended data whose only residual is a required-param error."""
    return {
        "name": name,
        "workflow": {"nodes": [_required_missing_node()], "edges": []},
        "variables": {"my_var": {"type": "string", "value": ""}},
    }


def _if_rejoin_data(name: str) -> dict[str, Any]:
    """If/Else whose two branch tails rejoin on default + ingress_1 handles."""
    if_node = _make_workflow_node(
        "node-if",
        "if-else",
        "control",
        "If/Else",
        config={
            "values": {
                "branches": [
                    {
                        "id": "branch_0",
                        "type": "if",
                        "label": "",
                        "conditions": [
                            {"id": "cond-1", "type": "expression", "expression": "true"}
                        ],
                    },
                    {"id": "branch_1", "type": "else", "label": ""},
                ]
            }
        },
    )
    return {
        "name": name,
        "workflow": {
            "nodes": [
                if_node,
                _make_workflow_node("node-left"),
                _make_workflow_node("node-right"),
                _make_workflow_node("node-join"),
            ],
            "edges": [
                {"id": "e-start", "source": "start-node", "target": "node-if"},
                {
                    "id": "e-if-l",
                    "source": "node-if",
                    "target": "node-left",
                    "sourceHandle": "branch_0",
                },
                {
                    "id": "e-if-r",
                    "source": "node-if",
                    "target": "node-right",
                    "sourceHandle": "branch_1",
                },
                {"id": "e-l-j", "source": "node-left", "target": "node-join"},
                {
                    "id": "e-r-j",
                    "source": "node-right",
                    "target": "node-join",
                    "targetHandle": "ingress_1",
                },
            ],
        },
        "variables": {"my_var": {"type": "string", "value": ""}},
    }


def _switch_rejoin_data(name: str) -> dict[str, Any]:
    """Switch/Case whose case + default tails rejoin, alongside the `then` egress."""
    switch_node = _make_workflow_node(
        "node-sw",
        "switch-case",
        "control",
        "Switch",
        config={
            "values": {
                "branches": [
                    {
                        "id": "branch_0",
                        "type": "case",
                        "label": "",
                        "conditions": [
                            {"id": "cond-1", "type": "expression", "expression": "true"}
                        ],
                        "break": True,
                    },
                    {
                        "id": "branch_1",
                        "type": "case",
                        "label": "",
                        "conditions": [
                            {"id": "cond-2", "type": "expression", "expression": "false"}
                        ],
                        "break": False,
                    },
                    {"id": "branch_2", "type": "default", "label": ""},
                ]
            }
        },
    )
    return {
        "name": name,
        "workflow": {
            "nodes": [
                switch_node,
                _make_workflow_node("node-c1"),
                _make_workflow_node("node-c2"),
                _make_workflow_node("node-cd"),
                _make_workflow_node("node-join"),
                _make_workflow_node("node-then"),
            ],
            "edges": [
                {"id": "e-start", "source": "start-node", "target": "node-sw"},
                {
                    "id": "e-c1",
                    "source": "node-sw",
                    "target": "node-c1",
                    "sourceHandle": "branch_0",
                },
                {
                    "id": "e-c2",
                    "source": "node-sw",
                    "target": "node-c2",
                    "sourceHandle": "branch_1",
                },
                {
                    "id": "e-cd",
                    "source": "node-sw",
                    "target": "node-cd",
                    "sourceHandle": "branch_2",
                },
                {
                    "id": "e-then",
                    "source": "node-sw",
                    "target": "node-then",
                    "sourceHandle": "then",
                },
                {"id": "e-c1-j", "source": "node-c1", "target": "node-join"},
                {
                    "id": "e-c2-j",
                    "source": "node-c2",
                    "target": "node-join",
                    "targetHandle": "ingress_1",
                },
                {
                    "id": "e-cd-j",
                    "source": "node-cd",
                    "target": "node-join",
                    "targetHandle": "ingress_2",
                },
            ],
        },
        "variables": {"my_var": {"type": "string", "value": ""}},
    }


def _parallel_rejoin_data(name: str) -> dict[str, Any]:
    """Parallel whose two branch tails rejoin on default + ingress_1."""
    parallel_node = _make_workflow_node(
        "node-par",
        "parallel",
        "control",
        "Parallel",
        config={
            "values": {
                "branches": [
                    {"id": "branch_1", "name": ""},
                    {"id": "branch_2", "name": ""},
                ]
            }
        },
    )
    return {
        "name": name,
        "workflow": {
            "nodes": [
                parallel_node,
                _make_workflow_node("node-p1"),
                _make_workflow_node("node-p2"),
                _make_workflow_node("node-join"),
            ],
            "edges": [
                {"id": "e-start", "source": "start-node", "target": "node-par"},
                {
                    "id": "e-p1",
                    "source": "node-par",
                    "target": "node-p1",
                    "sourceHandle": "branch_1",
                },
                {
                    "id": "e-p2",
                    "source": "node-par",
                    "target": "node-p2",
                    "sourceHandle": "branch_2",
                },
                {"id": "e-p1-j", "source": "node-p1", "target": "node-join"},
                {
                    "id": "e-p2-j",
                    "source": "node-p2",
                    "target": "node-join",
                    "targetHandle": "ingress_1",
                },
            ],
        },
        "variables": {"my_var": {"type": "string", "value": ""}},
    }


def _assert_split_rejoin_data(name: str) -> dict[str, Any]:
    """Assert (split mode) whose pass/fail tails rejoin on default + ingress_1."""
    assert_node = _make_workflow_node(
        "node-as",
        "assert",
        "control",
        "Assert",
        config={
            "values": {
                "assertions": [{"id": "cond-1", "type": "expression", "expression": "true"}],
                "mode": "split",
            }
        },
    )
    return {
        "name": name,
        "workflow": {
            "nodes": [
                assert_node,
                _make_workflow_node("node-pass"),
                _make_workflow_node("node-fail"),
                _make_workflow_node("node-join"),
            ],
            "edges": [
                {"id": "e-start", "source": "start-node", "target": "node-as"},
                {
                    "id": "e-pass",
                    "source": "node-as",
                    "target": "node-pass",
                    "sourceHandle": "pass",
                },
                {
                    "id": "e-fail",
                    "source": "node-as",
                    "target": "node-fail",
                    "sourceHandle": "fail",
                },
                {"id": "e-pass-j", "source": "node-pass", "target": "node-join"},
                {
                    "id": "e-fail-j",
                    "source": "node-fail",
                    "target": "node-join",
                    "targetHandle": "ingress_1",
                },
            ],
        },
        "variables": {"my_var": {"type": "string", "value": ""}},
    }


def _combined_rejoin_data(name: str) -> dict[str, Any]:
    """An if-rejoin feeding a parallel-rejoin - two distinct-ingress joins in one graph."""
    if_node = _make_workflow_node(
        "node-if",
        "if-else",
        "control",
        "If/Else",
        config={
            "values": {
                "branches": [
                    {
                        "id": "branch_0",
                        "type": "if",
                        "label": "",
                        "conditions": [
                            {"id": "cond-1", "type": "expression", "expression": "true"}
                        ],
                    },
                    {"id": "branch_1", "type": "else", "label": ""},
                ]
            }
        },
    )
    parallel_node = _make_workflow_node(
        "node-par",
        "parallel",
        "control",
        "Parallel",
        config={
            "values": {
                "branches": [
                    {"id": "branch_1", "name": ""},
                    {"id": "branch_2", "name": ""},
                ]
            }
        },
    )
    return {
        "name": name,
        "workflow": {
            "nodes": [
                if_node,
                _make_workflow_node("node-left"),
                _make_workflow_node("node-right"),
                parallel_node,
                _make_workflow_node("node-p1"),
                _make_workflow_node("node-p2"),
                _make_workflow_node("node-join"),
            ],
            "edges": [
                {"id": "e-start", "source": "start-node", "target": "node-if"},
                {
                    "id": "e-if-l",
                    "source": "node-if",
                    "target": "node-left",
                    "sourceHandle": "branch_0",
                },
                {
                    "id": "e-if-r",
                    "source": "node-if",
                    "target": "node-right",
                    "sourceHandle": "branch_1",
                },
                {"id": "e-l-par", "source": "node-left", "target": "node-par"},
                {
                    "id": "e-r-par",
                    "source": "node-right",
                    "target": "node-par",
                    "targetHandle": "ingress_1",
                },
                {
                    "id": "e-par-p1",
                    "source": "node-par",
                    "target": "node-p1",
                    "sourceHandle": "branch_1",
                },
                {
                    "id": "e-par-p2",
                    "source": "node-par",
                    "target": "node-p2",
                    "sourceHandle": "branch_2",
                },
                {"id": "e-p1-j", "source": "node-p1", "target": "node-join"},
                {
                    "id": "e-p2-j",
                    "source": "node-p2",
                    "target": "node-join",
                    "targetHandle": "ingress_1",
                },
            ],
        },
        "variables": {"my_var": {"type": "string", "value": ""}},
    }


class TestValidateTestDataForUpdate:
    """Public dry-run wrapper for the UPDATE pipeline (amend loop).

    Mirrors validate_test_data_for_create: runs the persist validation on a
    deep copy, does not flag the target's own name as a conflict, persists
    nothing, and never mutates the caller's dict.
    """

    def setup_method(self) -> None:
        _reset_storage_and_registry()

    def test_clean_amended_data_returns_no_errors(self) -> None:
        """A clean amended workflow yields no residual errors."""
        import copy

        created = test_service.create_test(_clean_v1_data("Update Clean"))
        amend = _clean_v1_data("Update Clean")
        amend["workflow"] = {
            "nodes": [_make_workflow_node("node-x"), _make_workflow_node("node-y")],
            "edges": [{"id": "e-xy", "source": "node-x", "target": "node-y"}],
        }
        errors = test_service.validate_test_data_for_update(created["id"], copy.deepcopy(amend))
        assert errors == []

    def test_input_dict_is_never_mutated(self) -> None:
        """A ghost edge is autofixed on the dry run's own deep copy only."""
        import copy

        created = test_service.create_test(_clean_v1_data("Update Untouched"))
        amend = _clean_v1_data("Update Untouched")
        amend["workflow"]["edges"] = [{"id": "e1", "source": "node-good", "target": "ghost-node"}]
        snapshot = copy.deepcopy(amend)
        test_service.validate_test_data_for_update(created["id"], amend)
        assert amend == snapshot

    def test_input_dict_is_not_mutated_on_residual_errors(self) -> None:
        """The caller's dict is untouched even when residual errors are returned."""
        import copy

        created = test_service.create_test(_clean_v1_data("Update Invalid Untouched"))
        amend = _invalid_amend_data("Update Invalid Untouched")
        snapshot = copy.deepcopy(amend)
        test_service.validate_test_data_for_update(created["id"], amend)
        assert amend == snapshot

    def test_residual_errors_match_the_update_pipeline(self) -> None:
        """Dry-run codes equal the codes update_test raises for the same payload."""
        import copy

        created = test_service.create_test(_clean_v1_data("Update Parity"))
        invalid = _invalid_amend_data("Update Parity")
        dry_run_errors = test_service.validate_test_data_for_update(
            created["id"], copy.deepcopy(invalid)
        )
        with pytest.raises(SaveValidationError) as excinfo:
            test_service.update_test(created["id"], copy.deepcopy(invalid))
        assert [e["code"] for e in dry_run_errors] == [e["code"] for e in excinfo.value.errors]

    def test_residual_errors_include_required_param_missing(self) -> None:
        """The invalid amend surfaces the expected residual code."""
        import copy

        created = test_service.create_test(_clean_v1_data("Update Residual"))
        errors = test_service.validate_test_data_for_update(
            created["id"], copy.deepcopy(_invalid_amend_data("Update Residual"))
        )
        codes = [e["code"] for e in errors]
        assert "REQUIRED_PARAM_MISSING" in codes

    def test_dry_run_persists_nothing(self) -> None:
        """The target keeps its stored version and workflow after a dry run."""
        import copy

        created = test_service.create_test(_clean_v1_data("Update Dry Only"))
        original_version = created["version"]
        test_service.validate_test_data_for_update(
            created["id"], copy.deepcopy(_if_rejoin_data("Update Dry Only"))
        )
        fetched = test_service.get_test(created["id"])
        assert fetched is not None
        assert fetched["version"] == original_version
        node_ids = {n["id"] for n in fetched["workflow"]["nodes"]}
        assert "node-if" not in node_ids

    def test_keeping_the_targets_own_name_is_not_a_conflict(self) -> None:
        """An amend that reuses the target's own name is not a NAME_CONFLICT."""
        import copy

        created = test_service.create_test(_clean_v1_data("Keep Own Name"))
        errors = test_service.validate_test_data_for_update(
            created["id"], copy.deepcopy(_if_rejoin_data("Keep Own Name"))
        )
        codes = [e["code"] for e in errors]
        assert "NAME_CONFLICT" not in codes
        assert errors == []

    def test_unknown_test_id_returns_a_not_found_entry(self) -> None:
        """A dry run against a missing test id reports NOT_FOUND, not a crash."""

        ghost_id = str(uuid.uuid4())
        errors = test_service.validate_test_data_for_update(ghost_id, {})
        assert len(errors) == 1
        assert errors[0]["code"] == "NOT_FOUND"
        assert errors[0]["message"] == f"Test with ID '{ghost_id}' not found"


class TestRejoinPreservationOnUpdate:
    """Amended workflows with per-(target, targetHandle) ingress_N rejoins validate clean.

    Each construct's branch tails converge on one join node using DISTINCT
    ingress handles (default, ingress_1, ingress_2 ...). The dry run must
    preserve every rejoin - no MULTIPLE_EDGES / DANGLING_EDGE finding - and
    return zero errors.
    """

    def setup_method(self) -> None:
        _reset_storage_and_registry()

    def _dry_run_amend(self, amend_data: dict[str, Any]) -> list[dict[str, Any]]:
        """Create a v1 target sharing the amend's name, then dry-run the amend."""
        import copy

        created = test_service.create_test(_clean_v1_data(amend_data["name"]))
        return test_service.validate_test_data_for_update(created["id"], copy.deepcopy(amend_data))

    def test_if_else_rejoin_validates_clean(self) -> None:
        assert self._dry_run_amend(_if_rejoin_data("If Rejoin Update")) == []

    def test_switch_rejoin_validates_clean(self) -> None:
        """Clean, and provably not clean-by-deletion: every wired handle survives."""
        # Guard: the autofixer must not delete the offending edges before the check.
        import copy

        data = _switch_rejoin_data("Switch Rejoin Update")
        pairs = {(e["source"], e.get("sourceHandle")) for e in data["workflow"]["edges"]}

        assert self._dry_run_amend(data) == []

        fixed = test_service._apply_safe_autofixes(copy.deepcopy(data))
        assert len(fixed["workflow"]["edges"]) == len(data["workflow"]["edges"])
        assert {(e["source"], e.get("sourceHandle")) for e in fixed["workflow"]["edges"]} == pairs

    def test_parallel_rejoin_validates_clean(self) -> None:
        assert self._dry_run_amend(_parallel_rejoin_data("Parallel Rejoin Update")) == []

    def test_assert_split_rejoin_validates_clean(self) -> None:
        assert self._dry_run_amend(_assert_split_rejoin_data("Assert Rejoin Update")) == []

    def test_combined_multi_construct_rejoin_validates_clean(self) -> None:
        assert self._dry_run_amend(_combined_rejoin_data("Combined Rejoin Update")) == []

    def test_no_multiple_edges_or_dangling_edge_findings(self) -> None:
        """Distinct-ingress rejoins never trip the edge-multiplicity guards."""
        errors = self._dry_run_amend(_combined_rejoin_data("Combined Edge Guard"))
        codes = [e["code"] for e in errors]
        assert "MULTIPLE_EDGES" not in codes
        assert "DANGLING_EDGE" not in codes


class TestConditionallyRequiredParameters:
    """A required_when condition reads the referenced field, or its declared default."""

    def test_an_unset_field_falls_back_to_the_referenced_parameter_default(self) -> None:
        """An untouched mode selector still makes its dependent parameter required."""
        schema = [
            {"name": "mode", "default": "count"},
            {"name": "count", "required_when": {"field": "mode", "values": ["count"]}},
        ]

        required = plugin_models.is_conditionally_required(
            {"field": "mode", "values": ["count"]}, {}, schema
        )

        assert required is True

    def test_an_unset_field_with_no_declared_parameter_is_not_required(self) -> None:
        """A condition pointing at a field the schema does not declare stays off."""
        required = plugin_models.is_conditionally_required(
            {"field": "mode", "values": ["count"]}, {}, []
        )

        assert required is False

    def test_an_explicit_value_wins_over_the_declared_default(self) -> None:
        """A field the author set is read as set, not as its default."""
        schema = [{"name": "mode", "default": "count"}]

        required = plugin_models.is_conditionally_required(
            {"field": "mode", "values": ["count"]}, {"mode": "range"}, schema
        )

        assert required is False

    def test_a_boolean_field_compares_against_the_lowercase_convention(self) -> None:
        """Schemas spell a boolean condition 'true' / 'false', not Python's True / False."""
        schema = [{"name": "scoped", "type": "boolean", "default": False}]

        assert (
            plugin_models.is_conditionally_required(
                {"field": "scoped", "values": ["true"]}, {"scoped": True}, schema
            )
            is True
        )
        assert (
            plugin_models.is_conditionally_required(
                {"field": "scoped", "values": ["false"]}, {"scoped": False}, schema
            )
            is True
        )

    def test_a_boolean_default_is_read_the_same_way(self) -> None:
        """An untouched tick falls back to its declared default and stays off."""
        schema = [{"name": "scoped", "type": "boolean", "default": False}]

        required = plugin_models.is_conditionally_required(
            {"field": "scoped", "values": ["true"]}, {}, schema
        )

        assert required is False


class TestConjunctivelyRequiredParameters:
    """required_when_all makes a parameter required only while EVERY condition matches."""

    SCHEMA = [
        {"name": "scoped", "type": "boolean", "default": False},
        {"name": "object_type", "default": "default"},
        {
            "name": "object_kind",
            "required_when_all": [
                {"field": "scoped", "values": ["true"]},
                {"field": "object_type", "values": ["default"]},
            ],
        },
    ]

    def _param(self, name: str) -> dict[str, Any]:
        return next(p for p in self.SCHEMA if p["name"] == name)

    def test_every_condition_matching_makes_the_parameter_required(self) -> None:
        required = plugin_models.is_param_required(
            self._param("object_kind"),
            {"scoped": True, "object_type": "default"},
            self.SCHEMA,
        )

        assert required is True

    def test_one_condition_failing_leaves_the_parameter_optional(self) -> None:
        required = plugin_models.is_param_required(
            self._param("object_kind"),
            {"scoped": True, "object_type": "custom"},
            self.SCHEMA,
        )

        assert required is False

    def test_an_unset_field_falls_back_to_its_declared_default(self) -> None:
        """The tick is off by default, so the conjunction fails with no values at all."""
        required = plugin_models.is_param_required(self._param("object_kind"), {}, self.SCHEMA)

        assert required is False

    def test_an_unconditionally_required_parameter_needs_no_conditions(self) -> None:
        required = plugin_models.is_param_required({"name": "session", "required": True}, {}, [])

        assert required is True

    def test_a_parameter_with_neither_form_is_optional(self) -> None:
        required = plugin_models.is_param_required({"name": "reason"}, {}, [])

        assert required is False

    def test_an_empty_conjunction_leaves_the_parameter_optional(self) -> None:
        """An empty condition list is no condition at all, not a vacuous match."""
        required = plugin_models.is_param_required(
            {"name": "object_kind", "required_when_all": []}, {}, []
        )

        assert required is False


# ---------------------------------------------------------------------------
# The K8s read blocks are gated before the run, not only at the failing block
# ---------------------------------------------------------------------------

_K8S_SESSION = "kubeconfig-text"


def _k8s_node(element_type: str, label: str, values: dict[str, Any]) -> dict[str, Any]:
    """One K8s read block carrying a session and the values under test."""
    return {
        "id": "k8s-1",
        "type": "workflowNode",
        "position": {"x": 100, "y": 200},
        "data": {
            "elementType": element_type,
            "nodeType": "plugin",
            "version": "1.0.0",
            "label": label,
            "config": {"values": {"session": _K8S_SESSION, **values}},
        },
    }


def _gate_errors(element_type: str, label: str, values: dict[str, Any]) -> list[dict[str, Any]]:
    """What the pre-run gate reports for a saved test holding that one block."""
    node = _k8s_node(element_type, label, values)
    data = {
        "name": "K8s Read Gate",
        "workflow": {
            "nodes": [node],
            "edges": [{"id": "e1", "source": "start-node", "target": node["id"]}],
        },
        "variables": {},
    }
    return test_service._validate_test_data(data, context="run")["errors"]


def _k8s_plugin(element_type: str) -> Any:
    from wavecore.plugins.k8s_events import K8sEventsPlugin
    from wavecore.plugins.k8s_get import K8sGetPlugin
    from wavecore.plugins.k8s_top import K8sTopPlugin

    return {
        "k8s-get": K8sGetPlugin,
        "k8s-events": K8sEventsPlugin,
        "k8s-top": K8sTopPlugin,
    }[element_type]()


# id, element type, block label, the parameter left unset, the rest of the values
_K8S_CONDITIONAL_CASES = [
    (
        "get-kind-custom",
        "k8s-get",
        "K8s Get",
        "kind_custom",
        {"resource_type": "custom", "search_by": "list"},
    ),
    (
        "get-name",
        "k8s-get",
        "K8s Get",
        "name",
        {"resource_type": "default", "kind": "Pod", "search_by": "name"},
    ),
    (
        "events-object-kind-custom",
        "k8s-events",
        "K8s Events",
        "object_kind_custom",
        {"scope_to_object": True, "object_type": "custom", "object_name": "web-1"},
    ),
    (
        "events-object-name",
        "k8s-events",
        "K8s Events",
        "object_name",
        {"scope_to_object": True, "object_type": "default", "object_kind": "Pod"},
    ),
    ("top-name", "k8s-top", "K8s Top", "name", {"scope": "pod", "select_by": "name"}),
]

# id, element type, block label, the kind picker left unset (it declares the default Pod), the rest
_K8S_KIND_PICKER_CASES = [
    ("get-kind", "k8s-get", "K8s Get", "kind", {"resource_type": "default", "search_by": "list"}),
    ("get-kind-default-resource-type", "k8s-get", "K8s Get", "kind", {"search_by": "list"}),
    (
        "events-object-kind",
        "k8s-events",
        "K8s Events",
        "object_kind",
        {"scope_to_object": True, "object_type": "default", "object_name": "web-1"},
    ),
]

# id, element type, values that hold every conditionally required field the mode asks for
_K8S_SATISFIED_CASES = [
    (
        "get-custom-kind",
        "k8s-get",
        {"resource_type": "custom", "kind_custom": "widgets", "search_by": "list"},
    ),
    ("get-list-mode", "k8s-get", {"resource_type": "default", "kind": "Pod", "search_by": "list"}),
    (
        "get-selector-mode",
        "k8s-get",
        {"resource_type": "default", "kind": "Pod", "search_by": "selector"},
    ),
    ("events-unscoped", "k8s-events", {"scope_to_object": False}),
    (
        "events-scoped",
        "k8s-events",
        {
            "scope_to_object": True,
            "object_type": "default",
            "object_kind": "Pod",
            "object_name": "web-1",
        },
    ),
    ("top-all", "k8s-top", {"scope": "pod", "select_by": "all"}),
    ("top-default-select-by", "k8s-top", {"scope": "pod"}),
]

# id, element type, block label, the parameter left unset, values with the mode selector absent
_K8S_DEFAULT_FALLBACK_CASES = [
    ("get-name-default-search-by", "k8s-get", "K8s Get", "name", {"kind": "Pod"}),
]


def _ids(cases: list[Any]) -> list[str]:
    return [str(case[0]) for case in cases]


class TestK8sReadBlocksAreGatedBeforeTheRun:
    """A saved test with a half-filled K8s read block is refused, naming block and field."""

    @pytest.fixture(autouse=True)
    def _registered_k8s_plugins(self) -> Any:
        from wavecore.controls.registry import _registry, register_all_core_controls
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.k8s_events import K8sEventsPlugin
        from wavecore.plugins.k8s_get import K8sGetPlugin
        from wavecore.plugins.k8s_logs import K8sLogsPlugin
        from wavecore.plugins.k8s_top import K8sTopPlugin

        test_service._clear_storage()
        _registry.clear()
        register_all_core_controls(_registry)
        clear_registry()
        register_plugin(K8sGetPlugin())
        register_plugin(K8sEventsPlugin())
        register_plugin(K8sLogsPlugin())
        register_plugin(K8sTopPlugin())
        yield
        clear_registry()

    @pytest.mark.parametrize(
        ("element_type", "label", "param_name", "values"),
        [case[1:] for case in _K8S_CONDITIONAL_CASES],
        ids=_ids(_K8S_CONDITIONAL_CASES),
    )
    def test_an_unset_conditional_parameter_is_refused(
        self, element_type: str, label: str, param_name: str, values: dict[str, Any]
    ) -> None:
        errors = _gate_errors(element_type, label, values)

        assert [(e["node_label"], e["code"], e["message"]) for e in errors] == [
            (label, "REQUIRED_PARAM_MISSING", f"Required parameter '{param_name}' is missing")
        ]

    @pytest.mark.parametrize(
        ("element_type", "label", "param_name", "values"),
        [case[1:] for case in _K8S_KIND_PICKER_CASES],
        ids=_ids(_K8S_KIND_PICKER_CASES),
    )
    def test_an_unset_kind_picker_reads_as_its_declared_default(
        self, element_type: str, label: str, param_name: str, values: dict[str, Any]
    ) -> None:
        """The run fills the kind picker's default, so Save does not ask for it."""
        assert _gate_errors(element_type, label, values) == []

    @pytest.mark.parametrize(
        ("element_type", "label", "param_name", "values"),
        [case[1:] for case in _K8S_CONDITIONAL_CASES + _K8S_KIND_PICKER_CASES],
        ids=_ids(_K8S_CONDITIONAL_CASES + _K8S_KIND_PICKER_CASES),
    )
    def test_a_blank_conditional_parameter_is_refused_as_empty(
        self, element_type: str, label: str, param_name: str, values: dict[str, Any]
    ) -> None:
        errors = _gate_errors(element_type, label, {**values, param_name: "   "})

        assert [(e["node_label"], e["code"], e["message"]) for e in errors] == [
            (label, "REQUIRED_PARAM_EMPTY", f"Required parameter '{param_name}' is empty")
        ]

    @pytest.mark.parametrize(
        ("element_type", "label", "param_name", "values"),
        [case[1:] for case in _K8S_DEFAULT_FALLBACK_CASES],
        ids=_ids(_K8S_DEFAULT_FALLBACK_CASES),
    )
    def test_an_untouched_mode_selector_reads_as_its_declared_default(
        self, element_type: str, label: str, param_name: str, values: dict[str, Any]
    ) -> None:
        """The mode selector is absent from the saved values, so its default decides."""
        errors = _gate_errors(element_type, label, values)

        assert [e["message"] for e in errors] == [f"Required parameter '{param_name}' is missing"]

    @pytest.mark.parametrize(
        ("element_type", "values"),
        [case[1:] for case in _K8S_SATISFIED_CASES],
        ids=_ids(_K8S_SATISFIED_CASES),
    )
    def test_a_mode_that_does_not_ask_for_the_field_passes_the_gate(
        self, element_type: str, values: dict[str, Any]
    ) -> None:
        assert _gate_errors(element_type, "K8s Read", values) == []

    @pytest.mark.parametrize(
        ("element_type", "param_name", "values"),
        [(case[1], case[3], case[4]) for case in _K8S_CONDITIONAL_CASES],
        ids=_ids(_K8S_CONDITIONAL_CASES),
    )
    async def test_the_block_refuses_the_same_shape_at_run_time(
        self, element_type: str, param_name: str, values: dict[str, Any]
    ) -> None:
        """The gate and the block's own validate() agree on what is missing."""
        with pytest.raises(ValueError, match=f"^Missing required parameter: {param_name}$"):
            await _k8s_plugin(element_type).validate({"session": _K8S_SESSION, **values})

    @pytest.mark.parametrize(
        ("element_type", "param_name", "values"),
        [(case[1], case[3], case[4]) for case in _K8S_KIND_PICKER_CASES],
        ids=_ids(_K8S_KIND_PICKER_CASES),
    )
    async def test_a_direct_block_call_still_refuses_an_unset_kind_picker(
        self, element_type: str, param_name: str, values: dict[str, Any]
    ) -> None:
        """A direct call gets no default fill, so the block's own validate() still refuses."""
        with pytest.raises(ValueError, match=f"^Missing required parameter: {param_name}$"):
            await _k8s_plugin(element_type).validate({"session": _K8S_SESSION, **values})

    @pytest.mark.parametrize(
        ("element_type", "values"),
        [case[1:] for case in _K8S_SATISFIED_CASES],
        ids=_ids(_K8S_SATISFIED_CASES),
    )
    async def test_the_block_accepts_what_the_gate_accepts(
        self, element_type: str, values: dict[str, Any]
    ) -> None:
        await _k8s_plugin(element_type).validate({"session": _K8S_SESSION, **values})


# ---------------------------------------------------------------------------
# HTTP Request and SSH Session Open are refused half-filled at save and run
# ---------------------------------------------------------------------------

# The values each Block needs whatever its mode, so only the field under test is missing.
_BASE_VALUES: dict[str, dict[str, Any]] = {
    "http-client": {"url": "http://example.com"},
    "ssh-session-open": {"host": "node-1", "username": "wave", "password": "pw"},
}

_ON = {"auth_enabled": True}

# id, element type, block label, the parameter left unset, the mode values that ask for it
_HALF_FILLED_CASES = [
    (
        "basic-username",
        "http-client",
        "HTTP Request",
        "auth_username",
        {**_ON, "auth_mode": "basic", "auth_password": "pw"},
    ),
    (
        "basic-password",
        "http-client",
        "HTTP Request",
        "auth_password",
        {**_ON, "auth_mode": "basic", "auth_username": "alice"},
    ),
    (
        "basic-by-default-mode",
        "http-client",
        "HTTP Request",
        "auth_password",
        {**_ON, "auth_username": "alice"},
    ),
    ("bearer-token", "http-client", "HTTP Request", "auth_token", {**_ON, "auth_mode": "bearer"}),
    ("api-key", "http-client", "HTTP Request", "auth_key", {**_ON, "auth_mode": "api_key"}),
    ("file-source", "http-client", "HTTP Request", "file_source", {"body_mode": "file"}),
    (
        "parent-session",
        "ssh-session-open",
        "SSH Session Open",
        "parent_session_id",
        {"use_parent": True},
    ),
]

# The API-key header name declares a default, so only a blank one is a hole.
_BLANK_ONLY_CASES = [
    (
        "api-key-header-name",
        "http-client",
        "HTTP Request",
        "auth_header_name",
        {**_ON, "auth_mode": "api_key", "auth_key": "k"},
    ),
]

# id, element type, values whose mode does not ask for the field or that fill it
_FILLED_OR_NOT_ASKED_CASES = [
    ("auth-untouched", "http-client", {"auth_mode": "bearer"}),
    ("auth-off", "http-client", {"auth_enabled": False, "auth_mode": "api_key"}),
    (
        "basic-filled",
        "http-client",
        {**_ON, "auth_mode": "basic", "auth_username": "alice", "auth_password": "pw"},
    ),
    ("bearer-filled", "http-client", {**_ON, "auth_mode": "bearer", "auth_token": "t"}),
    ("api-key-default-header", "http-client", {**_ON, "auth_mode": "api_key", "auth_key": "k"}),
    ("text-body", "http-client", {"body_mode": "text"}),
    ("file-body-filled", "http-client", {"body_mode": "file", "file_source": "artifact://in.bin"}),
    ("direct-untouched", "ssh-session-open", {}),
    ("direct", "ssh-session-open", {"use_parent": False}),
    ("via-parent-filled", "ssh-session-open", {"use_parent": True, "parent_session_id": "sid"}),
]


def _half_filled_test(element_type: str, label: str, values: dict[str, Any]) -> dict[str, Any]:
    """A Test holding one Block with its base values plus the values under test."""
    node = _make_workflow_node(
        "blk-1",
        element_type,
        "plugin",
        label,
        config={"values": {**_BASE_VALUES[element_type], **values}},
    )
    return {
        "name": f"Half Filled {uuid.uuid4().hex[:8]}",
        "workflow": {
            "nodes": [node],
            "edges": [{"id": "e1", "source": "start-node", "target": "blk-1"}],
        },
        "variables": {},
    }


class TestHalfFilledHttpAndSshOpenBlocks:
    """A field the mode makes required is refused while empty, naming Block and field."""

    @pytest.fixture(autouse=True)
    def _registered_plugins(self) -> Any:
        from wavecore.controls.registry import _registry, register_all_core_controls
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.http_client import HTTPClientPlugin
        from wavecore.plugins.ssh_session_open import SSHSessionOpenPlugin

        test_service._clear_storage()
        _registry.clear()
        register_all_core_controls(_registry)
        clear_registry()
        register_plugin(HTTPClientPlugin())
        register_plugin(SSHSessionOpenPlugin())
        yield
        clear_registry()

    @pytest.mark.parametrize(
        ("element_type", "label", "param_name", "values"),
        [case[1:] for case in _HALF_FILLED_CASES],
        ids=_ids(_HALF_FILLED_CASES),
    )
    def test_save_refuses_an_unset_conditional_field(
        self, element_type: str, label: str, param_name: str, values: dict[str, Any]
    ) -> None:
        with pytest.raises(SaveValidationError) as excinfo:
            test_service.create_test(_half_filled_test(element_type, label, values))

        assert [(e["code"], e["message"], e["path"]) for e in excinfo.value.errors] == [
            (
                "REQUIRED_PARAM_MISSING",
                f"Required parameter '{param_name}' is missing",
                f"nodes[0].data.config.values.{param_name}",
            )
        ]

    @pytest.mark.parametrize(
        ("element_type", "label", "param_name", "values"),
        [case[1:] for case in _HALF_FILLED_CASES],
        ids=_ids(_HALF_FILLED_CASES),
    )
    def test_the_run_gate_refuses_an_unset_conditional_field(
        self, element_type: str, label: str, param_name: str, values: dict[str, Any]
    ) -> None:
        data = _half_filled_test(element_type, label, values)

        errors = test_service._validate_test_data(data, context="run")["errors"]

        assert [(e["node_label"], e["code"], e["message"]) for e in errors] == [
            (label, "REQUIRED_PARAM_MISSING", f"Required parameter '{param_name}' is missing")
        ]

    @pytest.mark.parametrize(
        ("element_type", "label", "param_name", "values"),
        [case[1:] for case in _HALF_FILLED_CASES + _BLANK_ONLY_CASES],
        ids=_ids(_HALF_FILLED_CASES + _BLANK_ONLY_CASES),
    )
    def test_a_blank_conditional_field_is_refused_as_empty(
        self, element_type: str, label: str, param_name: str, values: dict[str, Any]
    ) -> None:
        data = _half_filled_test(element_type, label, {**values, param_name: "   "})

        errors = test_service._validate_test_data(data, context="save")["errors"]

        assert [(e["node_label"], e["code"], e["message"]) for e in errors] == [
            (label, "REQUIRED_PARAM_EMPTY", f"Required parameter '{param_name}' is empty")
        ]

    @pytest.mark.parametrize(
        ("element_type", "values"),
        [case[1:] for case in _FILLED_OR_NOT_ASKED_CASES],
        ids=_ids(_FILLED_OR_NOT_ASKED_CASES),
    )
    def test_a_filled_block_or_one_whose_mode_does_not_ask_passes(
        self, element_type: str, values: dict[str, Any]
    ) -> None:
        data = _half_filled_test(element_type, "Block", values)

        assert test_service._validate_test_data(data, context="run")["errors"] == []


# ---------------------------------------------------------------------------
# Read-only fields are refused at save, not only at run
# ---------------------------------------------------------------------------


def _log_node(
    node_id: str,
    message: str,
    *,
    expression_fields: list[str] | None = None,
    template_fields: list[str] | None = None,
    label: str = "Log",
) -> dict[str, Any]:
    """A Log block whose message is an expression or a template."""
    node = _make_workflow_node(
        node_id,
        "log",
        "plugin",
        label,
        config={"values": {"message": message, "level": "INFO"}},
    )
    node["data"]["expressionFields"] = expression_fields or []
    node["data"]["templateFields"] = template_fields or []
    return node


def _setter_node(
    node_id: str,
    values: dict[str, Any],
    *,
    expression_keys: list[str] | None = None,
    template_keys: list[str] | None = None,
    label: str = "Variable Setter",
) -> dict[str, Any]:
    """A Variable Setter whose entries are expressions or templates."""
    node = _make_workflow_node(
        node_id,
        "variable-setter",
        "control",
        label,
        config={"values": {"variables": values}},
    )
    node["data"]["variableExpressionKeys"] = expression_keys or []
    node["data"]["variableTemplateKeys"] = template_keys or []
    return node


def _test_with(nodes: list[dict[str, Any]], variables: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": "Read Only Save",
        "workflow": {"nodes": nodes, "edges": []},
        "variables": variables,
    }


_ROWS = {"rows": {"type": "array", "value": [1]}}


class TestReadOnlyFieldsAreRefusedAtSave:
    """A field that changes a variable is refused when the test is saved.

    The run-time gate stays the backstop; this stops an author saving a test
    that is guaranteed to fail later.
    """

    def setup_method(self) -> None:
        _reset_storage_and_registry()

    def test_template_field_that_changes_a_variable_is_refused(self) -> None:
        test = _test_with(
            [_log_node("n1", "{{rows.append(9)}}", template_fields=["message"])],
            _ROWS,
        )
        residual = test_service._validate_for_persist(test)
        assert [e["code"] for e in residual] == ["EXPRESSION_CHANGES_DATA"]
        assert residual[0]["message"] == (
            "The append method changes data. An expression can only read data, "
            "not change it. To change a variable, add a Variable Setter Block. "
            "Block: Log. Field: message."
        )
        assert residual[0]["node_id"] == "n1"
        assert residual[0]["node_label"] == "Log"
        assert residual[0]["fix_action"] is None

    def test_expression_field_that_changes_a_variable_is_refused(self) -> None:
        test = _test_with(
            [_log_node("n1", "str(rows.append(9))", expression_fields=["message"])],
            _ROWS,
        )
        residual = test_service._validate_for_persist(test)
        assert [e["code"] for e in residual] == ["EXPRESSION_CHANGES_DATA"]
        assert "add a Variable Setter Block" in residual[0]["message"]

    def test_setter_expression_entry_that_changes_a_variable_is_refused(self) -> None:
        test = _test_with(
            [_setter_node("n1", {"out": "rows.append(9)"}, expression_keys=["out"])],
            {**_ROWS, "out": {"type": "string", "value": ""}},
        )
        residual = test_service._validate_for_persist(test)
        assert [e["code"] for e in residual] == ["EXPRESSION_CHANGES_DATA"]
        assert residual[0]["message"].endswith("Block: Variable Setter. Field: out.")

    def test_setter_template_entry_that_changes_a_variable_is_refused(self) -> None:
        test = _test_with(
            [_setter_node("n1", {"out": "{{rows.append(9)}}"}, template_keys=["out"])],
            {**_ROWS, "out": {"type": "string", "value": ""}},
        )
        residual = test_service._validate_for_persist(test)
        assert [e["code"] for e in residual] == ["EXPRESSION_CHANGES_DATA"]

    def test_expression_variable_that_changes_another_variable_is_refused(self) -> None:
        test = _test_with(
            [],
            {
                **_ROWS,
                "sneaky": {"type": "string", "value": "rows.append(9)", "isExpression": True},
            },
        )
        residual = test_service._validate_for_persist(test)
        assert [e["code"] for e in residual] == ["EXPRESSION_CHANGES_DATA"]
        assert residual[0]["message"] == (
            "The append method changes data. An expression can only read data, "
            "not change it. To change a variable, add a Variable Setter Block. "
            "Variable: sneaky."
        )
        assert residual[0]["path"] == "variables.sneaky"

    def test_template_variable_that_changes_another_variable_is_refused(self) -> None:
        test = _test_with(
            [],
            {
                **_ROWS,
                "sneaky": {"type": "string", "value": "n={{rows.append(9)}}", "isTemplate": True},
            },
        )
        residual = test_service._validate_for_persist(test)
        assert [e["code"] for e in residual] == ["EXPRESSION_CHANGES_DATA"]

    def test_the_constructor_half_of_the_rule_is_refused_too(self) -> None:
        test = _test_with(
            [_log_node("n1", "{{list(rows)}}", template_fields=["message"])],
            _ROWS,
        )
        residual = test_service._validate_for_persist(test)
        assert [e["code"] for e in residual] == ["EXPRESSION_CHANGES_DATA"]
        assert residual[0]["message"] == (
            "The list function is not available in an expression. "
            "To build a list, write the items out like [a, b]. "
            "Block: Log. Field: message."
        )

    def test_create_test_refuses_the_save(self) -> None:
        test = _test_with(
            [_log_node("n1", "{{rows.append(9)}}", template_fields=["message"])],
            _ROWS,
        )
        test["name"] = f"Read Only Save {uuid.uuid4().hex[:8]}"
        with pytest.raises(SaveValidationError) as exc_info:
            test_service.create_test(test)
        codes = [e["code"] for e in exc_info.value.errors]
        assert "EXPRESSION_CHANGES_DATA" in codes

    def test_fields_that_only_read_still_save(self) -> None:
        test = _test_with(
            [
                _log_node("n1", "count={{len(rows)}}", template_fields=["message"]),
                _log_node("n2", "sorted(rows)", expression_fields=["message"], label="Log Two"),
                _setter_node("n3", {"out": "len(rows)"}, expression_keys=["out"]),
            ],
            {
                **_ROWS,
                "out": {"type": "integer", "value": 0},
                "total": {"type": "integer", "value": "len(rows)", "isExpression": True},
                "shown": {"type": "string", "value": "n={{len(rows)}}", "isTemplate": True},
            },
        )
        assert test_service._validate_for_persist(test) == []

    def test_a_non_string_field_value_is_not_checked(self) -> None:
        test = _test_with(
            [_log_node("n1", "{{len(rows)}}", template_fields=["message", "level"])],
            _ROWS,
        )
        assert test_service._validate_for_persist(test) == []


class TestReadOnlySaveWalkerShapes:
    """The save-time walker copes with every shape a stored node can carry."""

    def setup_method(self) -> None:
        _reset_storage_and_registry()

    def test_an_array_parameter_entry_is_addressed_by_index(self) -> None:
        node = _make_workflow_node(
            "n1",
            "http-client",
            "plugin",
            "HTTP",
            config={"values": {"headers": [{"value": "rows.append(9)"}]}},
        )
        node["data"]["expressionFields"] = ["headers.0.value"]
        test = _test_with([node], _ROWS)
        codes = [e["code"] for e in test_service._validate_for_persist(test)]
        assert "EXPRESSION_CHANGES_DATA" in codes

    def test_a_field_name_that_addresses_nothing_is_skipped(self) -> None:
        node = _make_workflow_node(
            "n1",
            "log",
            "plugin",
            "Log",
            config={"values": {"message": "'hi'", "level": "INFO"}},
        )
        node["data"]["expressionFields"] = ["headers.0.value", "message.deep", "missing"]
        assert test_service._validate_for_persist(_test_with([node], _ROWS)) == []

    def test_a_node_with_no_config_values_is_skipped(self) -> None:
        from wavecore.api.services.block_node_checks import node_read_only_violations

        node = _make_workflow_node("n1", "log", "plugin", "Log", config={"values": {}})
        node["data"]["config"] = {}
        node["data"]["templateFields"] = ["message"]
        assert node_read_only_violations(node["data"]) == []

    def test_a_setter_with_no_variables_map_is_skipped(self) -> None:
        from wavecore.api.services.block_node_checks import node_read_only_violations

        node = _setter_node("n1", {}, template_keys=["out"])
        node["data"]["config"]["values"] = {"variables": None}
        assert node_read_only_violations(node["data"]) == []

    @pytest.mark.parametrize(
        "var_info",
        [
            {"value": 5, "isExpression": True},
            {"value": "", "isExpression": True},
            {"value": "rows.append(9)", "type": "string"},
            [1, 2],
        ],
        ids=["non-string-source", "empty-source", "plain-value", "bare-value"],
    )
    def test_a_variable_that_is_not_an_expression_or_template_is_skipped(
        self, var_info: Any
    ) -> None:
        from wavecore.api.services.block_node_checks import validate_read_only_expressions

        errors: list[dict[str, Any]] = []
        validate_read_only_expressions([], {"rows": var_info}, errors)
        assert errors == []


class TestReferenceParametersAreRefusedAtSave:
    """A parameter that names a variable is evaluated as an expression at run,
    so the save walk checks it with the same rule."""

    def setup_method(self) -> None:
        _reset_storage_and_registry()
        from wavecore.core.plugin_registry import register_plugin
        from wavecore.plugins.csv_parser import CSVParserPlugin
        from wavecore.plugins.excel_parser import ExcelParserPlugin

        register_plugin(CSVParserPlugin())
        register_plugin(ExcelParserPlugin())

    def test_a_csv_table_parameter_that_changes_a_table_is_refused(self) -> None:
        node = _make_workflow_node(
            "n1",
            "csv-parser",
            "plugin",
            "CSV Serialize",
            config={
                "values": {
                    "operation": "serialize",
                    "table": "orders.add_col(['x'], 'flag', 'string')",
                }
            },
        )
        test = _test_with([node], {"orders": {"type": "table", "value": []}})
        residual = test_service._validate_for_persist(test)
        assert [e["code"] for e in residual] == ["EXPRESSION_CHANGES_DATA"]
        assert residual[0]["message"] == (
            "The add_col method changes data. An expression can only read data, "
            "not change it. To change a variable, add a Variable Setter Block. "
            "Block: CSV Serialize. Field: table."
        )
        assert residual[0]["node_id"] == "n1"

    def test_an_excel_schema_source_parameter_is_refused(self) -> None:
        node = _make_workflow_node(
            "n1",
            "excel-parser",
            "plugin",
            "Excel Parse",
            config={
                "values": {
                    "operation": "read",
                    "workbook": "/srv/in/book.xlsx",
                    "schema_source": "orders.add_col(['x'], 'flag', 'string')",
                }
            },
        )
        test = _test_with([node], {"orders": {"type": "table", "value": []}})
        codes = [e["code"] for e in test_service._validate_for_persist(test)]
        assert codes == ["EXPRESSION_CHANGES_DATA"]

    def test_a_for_each_collection_that_changes_a_variable_is_refused(self) -> None:
        node = _make_workflow_node(
            "n1",
            "for-each",
            "control",
            "For Each",
            config={"values": {"collection": "rows.append(9)"}},
        )
        test = _test_with([node], _ROWS)
        residual = test_service._validate_for_persist(test)
        assert [e["code"] for e in residual] == ["EXPRESSION_CHANGES_DATA"]
        assert residual[0]["message"].endswith("Block: For Each. Field: collection.")

    def test_a_reference_parameter_that_only_names_a_variable_still_saves(self) -> None:
        node = _make_workflow_node(
            "n1",
            "csv-parser",
            "plugin",
            "CSV Serialize",
            config={"values": {"operation": "serialize", "table": "orders"}},
        )
        test = _test_with([node], {"orders": {"type": "table", "value": []}})
        assert test_service._validate_for_persist(test) == []

    def test_a_reference_parameter_also_marked_an_expression_is_reported_once(self) -> None:
        node = _make_workflow_node(
            "n1",
            "csv-parser",
            "plugin",
            "CSV Serialize",
            config={
                "values": {
                    "operation": "serialize",
                    "table": "orders.add_col(['x'], 'flag', 'string')",
                }
            },
        )
        node["data"]["expressionFields"] = ["table"]
        test = _test_with([node], {"orders": {"type": "table", "value": []}})
        residual = test_service._validate_for_persist(test)
        assert [e["code"] for e in residual] == ["EXPRESSION_CHANGES_DATA"]

    def test_an_unregistered_element_has_no_reference_parameters(self) -> None:
        from wavecore.api.services.block_node_checks import node_read_only_violations
        from wavecore.core.variables.usage import reference_settings

        node = _make_workflow_node(
            "n1",
            "not-a-real-plugin",
            "plugin",
            "Mystery",
            config={"values": {"table": "orders.add_col(['x'], 'flag', 'string')"}},
        )
        assert reference_settings(node["data"]) == set()
        assert node_read_only_violations(node["data"]) == []


class TestShellExecIsAKnownBlock:
    """SHRUN-17 / REQ-3.4.1.18: a saved Shell Exec block is a known element type, so the
    save-stage autofix keeps it instead of removing it as unknown."""

    def setup_method(self) -> None:
        _reset_storage_and_registry()

    @staticmethod
    def _shell_exec_test() -> dict[str, Any]:
        node = _make_workflow_node(
            "shell-exec-1",
            "shell-exec",
            "plugin",
            "Shell Exec",
            config={"values": {"command": "echo hi"}},
        )
        return {
            "name": "Shell Exec Save",
            "workflow": {"nodes": [node], "edges": []},
            "variables": {},
        }

    def test_shell_exec_node_is_not_an_unknown_element_type(self) -> None:
        errors = test_service._validate_test_data(self._shell_exec_test(), context="run")["errors"]

        assert not [
            error
            for error in errors
            if re.fullmatch(r"Unknown block type: 'shell-exec'", error["message"])
        ]

    def test_saving_a_test_keeps_its_shell_exec_node(self) -> None:
        result = test_service.create_test(self._shell_exec_test())

        assert [n["data"]["elementType"] for n in result["workflow"]["nodes"]] == ["shell-exec"]


# ---------------------------------------------------------------------------
# A saved Block's values get the same checks the recipe gives them
# ---------------------------------------------------------------------------


def _one_block_test(
    element_type: str,
    node_type: str,
    label: str,
    values: dict[str, Any],
    *,
    expression_fields: list[str] | None = None,
) -> dict[str, Any]:
    node = _make_workflow_node("n1", element_type, node_type, label, config={"values": values})
    node["data"]["expressionFields"] = expression_fields or []
    return {"name": "Field Values", "workflow": {"nodes": [node], "edges": []}, "variables": {}}


def _save_findings(test: dict[str, Any]) -> list[tuple[Any, ...]]:
    return [
        (e["node_label"], e["code"], e["message"], e["fix_action"])
        for e in test_service._validate_for_persist(test)
    ]


def _for_each_test(values: dict[str, Any]) -> dict[str, Any]:
    test = _one_block_test("for-each", "control", "Loop", values)
    test["variables"] = {"items": {"type": "array", "value": [1]}}
    return test


def _declared(plugin: Any, name: str) -> dict[str, Any]:
    return next(p for p in plugin.metadata["parameters"] if p["name"] == name)


_HTTP_VALUES = {"method": "GET", "url": "http://example.com"}
_SQL_LOAD_VALUES = {
    "operation": "load_table",
    "database_type": "sqlite",
    "file": "orders.db",
    "target_table": "orders",
    "mode": "add",
}


class TestFieldValuesAreCheckedAtSave:
    """REQ-3.1.1.5: type, allowed values, bounds, unknown names and blank {x} entries."""

    @pytest.fixture(autouse=True)
    def _registered_plugins(self) -> Any:
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.k8s_get import K8sGetPlugin
        from wavecore.plugins.ping import PingPlugin
        from wavecore.plugins.sql_client import SQLClientPlugin

        _reset_storage_and_registry()
        register_plugin(PingPlugin())
        register_plugin(K8sGetPlugin())
        register_plugin(SQLClientPlugin())
        yield
        clear_registry()

    def test_a_value_of_the_wrong_type_is_refused(self) -> None:
        test = _one_block_test(
            "http-client", "plugin", "HTTP Call", {**_HTTP_VALUES, "timeout": "abc"}
        )

        assert _save_findings(test) == [
            (
                "HTTP Call",
                "INVALID_SETTING_TYPE",
                "Setting 'timeout' of block 'http-client' expects integer, got string",
                "Provide an integer value",
            )
        ]

    def test_a_value_outside_the_allowed_values_is_refused(self) -> None:
        from wavecore.plugins.http_client import HTTPClientPlugin

        listed = ", ".join(_declared(HTTPClientPlugin(), "method")["enum_values"])
        test = _one_block_test(
            "http-client", "plugin", "HTTP Call", {**_HTTP_VALUES, "method": "YEET"}
        )

        assert _save_findings(test) == [
            (
                "HTTP Call",
                "INVALID_ENUM_VALUE",
                f"Setting 'method' of block 'http-client' must be one of: {listed}",
                "Use one of the listed values",
            )
        ]

    def test_a_value_below_the_minimum_is_refused(self) -> None:
        test = _one_block_test("ping", "plugin", "Ping", {"host": "example.com", "count": 0})

        assert _save_findings(test) == [
            (
                "Ping",
                "SETTING_BELOW_MINIMUM",
                "Setting 'count' of block 'ping' must be at least 1, got 0",
                "Provide a value of at least 1",
            )
        ]

    def test_a_value_above_the_maximum_is_refused(self) -> None:
        from wavecore.plugins.ping import PingPlugin

        maximum = _declared(PingPlugin(), "count")["maximum"]
        test = _one_block_test(
            "ping", "plugin", "Ping", {"host": "example.com", "count": maximum + 1}
        )

        assert _save_findings(test) == [
            (
                "Ping",
                "SETTING_ABOVE_MAXIMUM",
                f"Setting 'count' of block 'ping' must be at most {maximum}, got {maximum + 1}",
                f"Provide a value of at most {maximum}",
            )
        ]

    def test_a_control_value_below_the_minimum_is_refused(self) -> None:
        test = _one_block_test("delay", "control", "Wait", {"duration": 0})

        assert _save_findings(test) == [
            (
                "Wait",
                "SETTING_BELOW_MINIMUM",
                "Setting 'duration' of block 'delay' must be at least 1, got 0",
                "Provide a value of at least 1",
            )
        ]

    def test_a_setting_the_block_does_not_declare_is_refused(self) -> None:
        from wavecore.plugins.http_client import HTTPClientPlugin

        valid = ", ".join(sorted(p["name"] for p in HTTPClientPlugin().metadata["parameters"]))
        test = _one_block_test("http-client", "plugin", "HTTP Call", {**_HTTP_VALUES, "nope": 1})

        assert _save_findings(test) == [
            (
                "HTTP Call",
                "UNKNOWN_SETTING",
                "Block 'http-client' has no setting 'nope'",
                f"Valid settings: {valid}",
            )
        ]

    def test_a_blank_expression_entry_is_refused(self) -> None:
        test = _one_block_test(
            "http-client",
            "plugin",
            "HTTP Call",
            {**_HTTP_VALUES, "headers": {"X-Id": "  "}},
            expression_fields=["headers.X-Id"],
        )

        assert _save_findings(test) == [
            ("HTTP Call", "REQUIRED_PARAM_EMPTY", "'X-Id' in 'headers' is required", None)
        ]

    @pytest.mark.parametrize(
        "table",
        [
            "testdata://orders.csv",
            "artifact://export/orders.xlsx",
            "/data/orders.csv",
            [{"id": 1, "note": "a"}],
            {"columns": [{"name": "id", "type": "integer"}], "rows": [[1]]},
        ],
        ids=["testdata-file", "artifact-file", "plain-path", "row-maps", "stored-table"],
    )
    def test_a_sql_load_table_takes_a_file_path_or_a_table(self, table: Any) -> None:
        test = _one_block_test("sql-client", "plugin", "Load", {**_SQL_LOAD_VALUES, "table": table})

        assert _save_findings(test) == []

    @pytest.mark.parametrize(
        ("table", "got"),
        [(5, "integer"), ([1, 2], "array")],
        ids=["integer", "plain-items"],
    )
    def test_a_sql_load_table_that_is_neither_text_nor_a_table_is_refused(
        self, table: Any, got: str
    ) -> None:
        test = _one_block_test("sql-client", "plugin", "Load", {**_SQL_LOAD_VALUES, "table": table})

        assert _save_findings(test) == [
            (
                "Load",
                "INVALID_SETTING_TYPE",
                f"Setting 'table' of block 'sql-client' expects table, got {got}",
                "Provide a table value",
            )
        ]

    @pytest.mark.parametrize("collection_type", ["array", "map", "table"])
    def test_a_for_each_collection_type_of_the_three_types_is_accepted(
        self, collection_type: str
    ) -> None:
        test = _for_each_test({"collection": "items", "collection_type": collection_type})

        assert _save_findings(test) == []

    def test_a_for_each_collection_type_outside_the_three_types_is_refused(self) -> None:
        test = _for_each_test({"collection": "items", "collection_type": "string"})

        assert _save_findings(test) == [
            (
                "Loop",
                "INVALID_ENUM_VALUE",
                "Setting 'collection_type' of block 'for-each' must be one of: array, map, table",
                "Use one of the listed values",
            )
        ]

    def test_a_conditionally_required_field_that_applies_is_refused(self) -> None:
        test = _one_block_test(
            "k8s-get",
            "plugin",
            "K8s Get",
            {"session": _K8S_SESSION, "resource_type": "custom", "search_by": "list"},
        )

        assert _save_findings(test) == [
            (
                "K8s Get",
                "REQUIRED_PARAM_MISSING",
                "Required parameter 'kind_custom' is missing",
                None,
            )
        ]


class TestNumbersFollowTheOneRuleAtSave:
    """REQ-3.1.3.14: every number a Test holds follows the one number rule at Save."""

    @pytest.fixture(autouse=True)
    def _registered_plugins(self) -> Any:
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.ping import PingPlugin

        _reset_storage_and_registry()
        register_plugin(PingPlugin())
        yield
        clear_registry()

    def test_digit_text_in_a_number_field_is_its_number(self) -> None:
        test = _one_block_test("ping", "plugin", "Ping", {"host": "example.com", "count": "3"})

        assert _save_findings(test) == []

    def test_digit_text_below_a_minimum_is_refused_by_its_bound(self) -> None:
        test = _one_block_test("ping", "plugin", "Ping", {"host": "example.com", "count": "0"})

        assert _save_findings(test) == [
            (
                "Ping",
                "SETTING_BELOW_MINIMUM",
                "Setting 'count' of block 'ping' must be at least 1, got 0",
                "Provide a value of at least 1",
            )
        ]

    def test_a_number_past_19_digits_is_refused(self) -> None:
        values = {"host": "example.com", "count": "12345678901234567890"}
        test = _one_block_test("ping", "plugin", "Ping", values)

        assert _save_findings(test) == [
            (
                "Ping",
                "SETTING_TOO_MANY_DIGITS",
                "Setting 'count' of block 'ping' allows at most 19 digits, got 20",
                "Provide at most 19 digits",
            )
        ]

    def test_a_test_variable_value_that_breaks_the_rule_is_refused(self) -> None:
        test = _one_block_test("ping", "plugin", "Ping", {"host": "example.com"})
        test["variables"] = {"retries": {"type": "integer", "value": "1e3"}}

        assert [
            (e["path"], e["code"], e["message"], e["fix_action"])
            for e in test_service._validate_for_persist(test)
        ] == [
            (
                "variables.retries.value",
                "INVALID_VARIABLE_VALUE",
                "Value for variable 'retries' is not a valid integer",
                "Provide an integer value",
            )
        ]

    def test_a_literal_setter_row_is_held_to_its_target_type(self) -> None:
        test = _one_block_test("variable-setter", "control", "Set", {"variables": {"n": "1e3"}})
        test["workflow"]["nodes"][0]["data"]["variableTypes"] = {"n": "integer"}
        test["variables"] = {"n": {"type": "integer", "value": "1"}}

        assert [
            (e["path"], e["code"], e["message"]) for e in test_service._validate_for_persist(test)
        ] == [
            (
                "nodes[0].data.config.values.variables.n",
                "INVALID_VARIABLE_VALUE",
                "Value for variable 'n' is not a valid integer",
            )
        ]

    def test_a_literal_compare_to_value_is_held_to_its_row_type(self) -> None:
        row = {
            "id": "a1",
            "type": "literal",
            "variable": "n",
            "value_type": "integer",
            "operator": "equals",
            "reference_value": "12345678901234567890",
            "reference_is_expression": False,
        }
        test = _one_block_test("assert", "control", "Check", {"assertions": [row]})
        test["variables"] = {"n": {"type": "integer", "value": "1"}}

        assert [
            (e["path"], e["code"], e["message"]) for e in test_service._validate_for_persist(test)
        ] == [
            (
                "nodes[0].data.config.values.assertions.0.reference_value",
                "INVALID_COMPARE_VALUE",
                "The value compared with 'n' allows at most 19 digits, got 20",
            )
        ]
