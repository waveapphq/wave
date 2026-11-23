"""Parser query outputs in a recipe (REQ-5.2.7.3, REQ-3.4.1.16, REQ-3.4.1.11)."""

from typing import Any

import pytest

from tests.core.recipes.conftest import codes, find_finding, make_recipe
from tests.core.recipes.test_validator import (
    assert_message,
    python_step,
    shell_script_step,
    validate,
)

QUERIES = {
    "json-parser": {"order_id": "$.id", "status": "$.status"},
    "xml-parser": {"order_id": "/order/id", "status": "/order/status"},
}
CONTENT = {
    "json-parser": ("json_content", '{"id": 7, "status": "open"}'),
    "xml-parser": ("xml_content", "<order><id>7</id><status>open</status></order>"),
}
PARSERS = ["json-parser", "xml-parser"]
SELF_BOUND = {"order_id": "order_id", "status": "status"}


def parser_step(
    block: str,
    capture: dict[str, str] | None = None,
    *,
    mode: Any = "individual",
    **settings: Any,
) -> dict[str, Any]:
    content_key, content = CONTENT[block]
    values: dict[str, Any] = {
        content_key: content,
        "queries": dict(QUERIES[block]),
        "query_output_types": {"order_id": "integer"},
    }
    if mode is not None:
        values["output_mode"] = mode
    values.update(settings)
    step: dict[str, Any] = {"block": block, "settings": values}
    if capture is not None:
        step["capture"] = capture
    return step


def compile_clean(text: str) -> dict[str, Any]:
    from wavecore.core.recipes.compiler import compile_recipe

    result = compile_recipe(text)
    errors = [f for f in result["findings"] if f["severity"] == "error"]
    assert errors == [], f"expected a clean compile, got {errors!r}"
    assert result["test_data"] is not None
    return result


def compiled_variables(*steps: dict[str, Any], variables: Any = None) -> dict[str, Any]:
    test_data = compile_clean(make_recipe(list(steps), variables=variables))["test_data"]
    stored: dict[str, Any] = test_data["variables"]
    return stored


@pytest.mark.parametrize("block", PARSERS)
class TestIndividualModeCaptures:
    """In Individual mode each query name is an output."""

    def test_capturing_each_query_into_its_own_name_is_clean(self, block: str) -> None:
        assert validate(make_recipe([parser_step(block, SELF_BOUND)])) == []

    def test_each_capture_declares_the_query_type(self, block: str) -> None:
        variables = compiled_variables(parser_step(block, SELF_BOUND))

        assert variables["order_id"]["type"] == "integer"
        assert variables["status"]["type"] == "string"

    def test_a_query_given_as_an_expression_is_a_string(self, block: str) -> None:
        queries = {**QUERIES[block], "order_id": {"expr": "id_path"}}
        step = parser_step(block, SELF_BOUND, queries=queries)
        declared = {"id_path": {"type": "string", "value": "$.id"}}

        variables = compiled_variables(step, variables=declared)

        assert variables["order_id"]["type"] == "string"

    def test_a_query_with_a_float_type_is_a_float(self, block: str) -> None:
        step = parser_step(block, SELF_BOUND, query_output_types={"order_id": "float"})

        assert compiled_variables(step)["order_id"]["type"] == "float"

    def test_the_block_stores_the_captures(self, block: str) -> None:
        test_data = compile_clean(make_recipe([parser_step(block, SELF_BOUND)]))["test_data"]
        (node,) = test_data["workflow"]["nodes"]

        assert node["data"]["config"]["outputBindings"] == SELF_BOUND

    def test_capturing_results_is_refused(self, block: str) -> None:
        finding = find_finding(
            validate(make_recipe([parser_step(block, {"results": "results"})])),
            "UNKNOWN_CAPTURE_OUTPUT",
        )

        assert finding["step"] == "flow[0].capture.results"
        assert_message(rf"^Block '{block}' has no output 'results' to capture$", finding["problem"])

    def test_a_name_that_is_not_a_query_is_refused(self, block: str) -> None:
        finding = find_finding(
            validate(make_recipe([parser_step(block, {"total": "total"})])),
            "UNKNOWN_CAPTURE_OUTPUT",
        )

        assert finding["step"] == "flow[0].capture.total"


@pytest.mark.parametrize("block", PARSERS)
class TestCombinedModeCaptures:
    """In Combined mode the run gives only `results`."""

    @pytest.mark.parametrize("mode", ["combined", None], ids=["given", "default"])
    def test_capturing_a_query_name_is_refused(self, block: str, mode: Any) -> None:
        finding = find_finding(
            validate(make_recipe([parser_step(block, {"order_id": "order_id"}, mode=mode)])),
            "UNKNOWN_CAPTURE_OUTPUT",
        )

        assert finding["step"] == "flow[0].capture.order_id"
        assert_message(
            rf"^Block '{block}' has no output 'order_id' to capture$", finding["problem"]
        )

    def test_capturing_results_is_clean(self, block: str) -> None:
        step = parser_step(block, {"results": "parsed"}, mode="combined")

        assert validate(make_recipe([step])) == []

    def test_an_expression_mode_declares_no_query_output(self, block: str) -> None:
        step = parser_step(block, {"order_id": "order_id"}, mode={"expr": "mode"})
        recipe = make_recipe([step], variables={"mode": {"type": "string", "value": "individual"}})

        finding = find_finding(validate(recipe), "UNKNOWN_CAPTURE_OUTPUT")

        assert finding["step"] == "flow[0].capture.order_id"


@pytest.mark.parametrize("block", PARSERS)
class TestSelfBoundCaptures:
    """A query output is captured only into the variable of the same name."""

    def test_capturing_a_query_into_another_name_is_refused(self, block: str) -> None:
        finding = find_finding(
            validate(make_recipe([parser_step(block, {"order_id": "oid"})])),
            "CAPTURE_NOT_SELF_BOUND",
        )

        assert finding["severity"] == "error"
        assert finding["step"] == "flow[0].capture.order_id"
        assert_message(
            rf"^Block '{block}' output 'order_id' must be captured into variable 'order_id'$",
            finding["problem"],
        )
        assert_message(r"^Capture it as order_id: order_id$", finding["fix"])

    def test_each_query_bound_elsewhere_is_refused(self, block: str) -> None:
        step = parser_step(block, {"order_id": "oid", "status": "state"})

        findings = validate(make_recipe([step]))

        assert sorted(f["step"] for f in findings if f["code"] == "CAPTURE_NOT_SELF_BOUND") == [
            "flow[0].capture.order_id",
            "flow[0].capture.status",
        ]

    def test_a_same_named_variable_of_another_type_is_refused(self, block: str) -> None:
        recipe = make_recipe(
            [parser_step(block, SELF_BOUND)],
            variables={"order_id": {"type": "string"}, "status": {"type": "string"}},
        )

        finding = find_finding(validate(recipe), "INVALID_OUTPUT_BINDING_TYPE")

        assert_message(
            r"^Output 'order_id' \(type integer\) cannot bind to variable 'order_id' "
            r"\(type string\)$",
            finding["problem"],
        )

    def test_a_string_query_into_an_integer_variable_is_refused(self, block: str) -> None:
        recipe = make_recipe(
            [parser_step(block, SELF_BOUND)],
            variables={"order_id": {"type": "integer"}, "status": {"type": "integer"}},
        )

        finding = find_finding(validate(recipe), "INVALID_OUTPUT_BINDING_TYPE")

        assert_message(
            r"^Output 'status' \(type string\) cannot bind to variable 'status' "
            r"\(type integer\)$",
            finding["problem"],
        )

    def test_a_float_query_binds_to_an_integer_variable(self, block: str) -> None:
        step = parser_step(block, SELF_BOUND, query_output_types={"order_id": "float"})
        recipe = make_recipe(
            [step], variables={"order_id": {"type": "integer"}, "status": {"type": "string"}}
        )

        assert validate(recipe) == []

    def test_same_named_variables_of_the_query_types_are_clean(self, block: str) -> None:
        recipe = make_recipe(
            [parser_step(block, SELF_BOUND)],
            variables={"order_id": {"type": "integer"}, "status": {"type": "string"}},
        )

        assert validate(recipe) == []


@pytest.mark.parametrize("block", PARSERS)
class TestQueryNameChecks:
    """In Individual mode a query name follows the declared-output name rules."""

    def test_a_name_that_is_not_a_variable_name_is_refused(self, block: str) -> None:
        queries = {"1bad": QUERIES[block]["status"]}
        step = parser_step(block, queries=queries, query_output_types={})

        finding = find_finding(validate(make_recipe([step])), "INVALID_DECLARED_OUTPUT")

        assert finding["step"].startswith("flow[0].settings.queries")
        assert_message(
            rf"^Setting 'queries' of block '{block}' declares an invalid "
            r"output name: '1bad' \(must match \[a-zA-Z_\]\[a-zA-Z0-9_\]\*\)$",
            finding["problem"],
        )
        assert finding["fix"] == "Rename it"

    @pytest.mark.parametrize("name", ["success", "errors"])
    def test_a_fixed_output_name_is_refused(self, block: str, name: str) -> None:
        queries = {name: QUERIES[block]["status"]}
        step = parser_step(block, queries=queries, query_output_types={})

        finding = find_finding(validate(make_recipe([step])), "DECLARED_OUTPUT_CLASH")

        assert finding["step"].startswith("flow[0].settings.queries")
        assert_message(
            rf"^Setting 'queries' of block '{block}' declares '{name}', "
            r"which is already an output of the block$",
            finding["problem"],
        )

    def test_valid_names_raise_no_name_finding(self, block: str) -> None:
        findings = validate(make_recipe([parser_step(block)]))

        assert not {"INVALID_DECLARED_OUTPUT", "DECLARED_OUTPUT_CLASH"} & set(codes(findings))


def duplicate_query_recipe(block: str, mode: str, queries: str) -> str:
    content_key, content = CONTENT[block]
    return (
        "test:\n"
        "  name: Recipe Under Test\n"
        "flow:\n"
        f"  - block: {block}\n"
        "    settings:\n"
        f"      {content_key}: '{content}'\n"
        f"      output_mode: {mode}\n"
        f"      queries: {queries}\n"
    )


@pytest.mark.parametrize("block", PARSERS)
@pytest.mark.parametrize(
    "queries",
    [
        "{status: $.a, status: $.b}",
        '{"status": "$.a", "order_id": "$.id", "status": "$.b"}',
        "\n        status: $.a\n        status: $.b",
    ],
    ids=["flow", "json", "block"],
)
class TestDuplicateQueryNames:
    """A query name written twice is refused, though the loaded map keeps one key."""

    def test_a_repeated_name_is_refused_in_individual_mode(self, block: str, queries: str) -> None:
        findings = validate(duplicate_query_recipe(block, "individual", queries))

        finding = find_finding(findings, "DUPLICATE_DECLARED_OUTPUT")
        assert finding["step"] == "flow[0].settings.queries.status"
        assert_message(
            rf"^Setting 'queries' of block '{block}' declares 'status' more than once$",
            finding["problem"],
        )
        assert finding["fix"] == "Remove the repeated name"
        assert codes(findings).count("DUPLICATE_DECLARED_OUTPUT") == 1

    def test_a_repeated_name_declares_nothing_in_combined_mode(
        self, block: str, queries: str
    ) -> None:
        findings = validate(duplicate_query_recipe(block, "combined", queries))

        assert "DUPLICATE_DECLARED_OUTPUT" not in codes(findings)


class TestScriptBlocksKeepTheirDeclaredOutputs:
    """Shell Script and Python declared outputs capture into any variable name."""

    def test_a_shell_script_variable_captures_into_another_name(self) -> None:
        step = shell_script_step(capture={"COUNT": "pod_count"}, script_variables=["COUNT"])

        assert validate(make_recipe([step])) == []

    def test_a_python_export_captures_into_another_name(self) -> None:
        step = python_step(script_variables=["rows"])
        step["capture"] = {"rows": "customer_rows"}

        assert validate(make_recipe([step])) == []

    def test_a_shell_script_capture_is_auto_declared_string(self) -> None:
        step = shell_script_step(capture={"COUNT": "pod_count"}, script_variables=["COUNT"])

        assert compiled_variables(step)["pod_count"]["type"] == "string"
