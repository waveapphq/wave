"""Stage-2 relay: platform validation entries mapped into recipe coordinates.

Covers the map_platform_errors contract.
"""

from typing import Any


def relay(errors: list[dict[str, Any]], step_map: dict[str, str]) -> list[dict[str, Any]]:
    from wavecore.core.recipes.relay import map_platform_errors

    return map_platform_errors(errors, step_map)


STEP_MAP = {
    "node-1": "flow[0]",
    "node-2": "flow[1].if.then[0]",
    "node-3": "functions[fetch].flow[0]",
}


def full_entry(**overrides: Any) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "path": "nodes[0].data.config.values.url",
        "node_id": "node-1",
        "node_label": "Fetch",
        "element_type": "http-client",
        "code": "REQUIRED_PARAM_EMPTY",
        "message": "Required parameter 'url' is empty",
        "severity": "error",
        "fix_action": "Provide a value",
    }
    entry.update(overrides)
    return entry


class TestNodeMapping:
    def test_full_platform_entry_maps_to_the_step_path(self) -> None:
        result = relay([full_entry()], STEP_MAP)
        assert result == [
            {
                "step": "flow[0]",
                "code": "REQUIRED_PARAM_EMPTY",
                "severity": "error",
                "problem": "Required parameter 'url' is empty",
                "fix": "Provide a value",
            }
        ]

    def test_nested_step_paths_come_from_the_map(self) -> None:
        result = relay([full_entry(node_id="node-2")], STEP_MAP)
        assert result[0]["step"] == "flow[1].if.then[0]"

    def test_function_body_step_paths_come_from_the_map(self) -> None:
        result = relay([full_entry(node_id="node-3")], STEP_MAP)
        assert result[0]["step"] == "functions[fetch].flow[0]"

    def test_message_and_code_pass_through_verbatim(self) -> None:
        entry = full_entry(
            code="UNDECLARED_VARIABLE",
            message="Variable 'missing_var' is not declared",
        )
        result = relay([entry], STEP_MAP)
        assert result[0]["code"] == "UNDECLARED_VARIABLE"
        assert result[0]["problem"] == "Variable 'missing_var' is not declared"


class TestFixActionPassthrough:
    def test_none_fix_action_becomes_null_fix(self) -> None:
        result = relay([full_entry(fix_action=None)], STEP_MAP)
        assert result[0]["fix"] is None

    def test_absent_fix_action_becomes_null_fix(self) -> None:
        entry = full_entry()
        del entry["fix_action"]
        result = relay([entry], STEP_MAP)
        assert result[0]["fix"] is None


class TestVariablePathMapping:
    def test_variables_path_maps_to_the_variable_step(self) -> None:
        entry = full_entry(
            node_id=None,
            path="variables.count",
            code="INVALID_VARIABLE",
            message="Invalid variable name: 'count'",
        )
        result = relay([entry], STEP_MAP)
        assert result[0]["step"] == "variables.count"

    def test_variables_subpath_truncates_to_the_variable_name(self) -> None:
        entry = full_entry(
            node_id=None,
            path="variables.count.type",
            code="INVALID_VARIABLE_TYPE",
            message="Invalid variable type: 'text'",
        )
        result = relay([entry], STEP_MAP)
        assert result[0]["step"] == "variables.count"


class TestFallbackMapping:
    def test_entry_without_node_or_variable_path_maps_to_test(self) -> None:
        entry = full_entry(node_id=None, path="workflow.edges", code="MULTIPLE_EDGES")
        result = relay([entry], STEP_MAP)
        assert result[0]["step"] == "test"

    def test_unmapped_node_id_falls_back_to_test(self) -> None:
        entry = full_entry(node_id="ghost-node", path=None)
        result = relay([entry], STEP_MAP)
        assert result[0]["step"] == "test"


class TestShapeTolerance:
    def test_minimal_entry_without_path_severity_element_type(self) -> None:
        entry = {"code": "SOME_CODE", "message": "boom", "node_id": "node-2"}
        result = relay([entry], STEP_MAP)
        assert result == [
            {
                "step": "flow[1].if.then[0]",
                "code": "SOME_CODE",
                "severity": "error",
                "problem": "boom",
                "fix": None,
            }
        ]

    def test_order_is_preserved_across_entries(self) -> None:
        entries = [
            full_entry(code="A_FIRST"),
            full_entry(node_id="node-2", code="B_SECOND"),
            {"code": "C_THIRD", "message": "m"},
        ]
        result = relay(entries, STEP_MAP)
        assert [finding["code"] for finding in result] == ["A_FIRST", "B_SECOND", "C_THIRD"]

    def test_empty_input_maps_to_empty_output(self) -> None:
        assert relay([], STEP_MAP) == []
