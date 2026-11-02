"""Function steps: inline local definitions and library Function references.

REQ-5.2.7.3. A Function step has a block step's form: its settings are the Function's
inputs, stored like every Block's fields. A local Function Block embeds a recursive
localDefinition; a library one pins functionId + functionVersion.
"""

from typing import Any

import pytest

from tests.core.recipes.conftest import (
    LOG_STEP,
    create_library_function,
    find_finding,
    make_recipe,
)

LOCAL_DEFINITION_KEYS = {"name", "workflow", "inputs", "outputs", "variables"}


def compile_recipe(text: str) -> dict[str, Any]:
    from wavecore.core.recipes.compiler import compile_recipe as compile_fn

    return compile_fn(text)


def compile_clean(text: str) -> dict[str, Any]:
    result = compile_recipe(text)
    errors = [f for f in result["findings"] if f["severity"] == "error"]
    assert errors == [], f"expected a clean compile, got {errors!r}"
    assert result["test_data"] is not None
    return result


def nodes_by_id(result: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {node["id"]: node for node in result["test_data"]["workflow"]["nodes"]}


def error_at(step: str, code: str, problem: str, fix: str) -> dict[str, Any]:
    return {"step": step, "code": code, "severity": "error", "problem": problem, "fix": fix}


def local_function_recipe(label: str | None = None) -> str:
    functions = [
        {
            "name": "fetch_status",
            "inputs": [{"name": "url", "type": "string", "required": True}],
            "outputs": [{"name": "status", "type": "integer"}],
            "flow": [{"block": "log", "settings": {"message": "in fn"}}],
        }
    ]
    step: dict[str, Any] = {
        "function": "fetch_status",
        "settings": {"url": {"expr": "base + '/health'"}},
        "capture": {"status": "health_status"},
    }
    if label is not None:
        step["label"] = label
    variables = {"base": {"type": "string", "value": "http://shop.local"}}
    return make_recipe([step], variables=variables, functions=functions)


def seed_library_function(**overrides: Any) -> dict[str, Any]:
    params: dict[str, Any] = {
        "version": "1.2.0",
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
    }
    params.update(overrides)
    return create_library_function("fetch_remote", **params)


class TestLocalFunctionStep:
    def test_a_function_step_emits_a_local_function_block(self) -> None:
        result = compile_clean(local_function_recipe())
        data = nodes_by_id(result)["node-1"]["data"]
        assert data["elementType"] == "function"
        assert data["nodeType"] == "function"
        assert data["functionLifecycle"] == "local"
        assert "functionId" not in data
        assert "functionVersion" not in data

    def test_local_definition_carries_the_exact_canvas_keys(self) -> None:
        result = compile_clean(local_function_recipe())
        definition = nodes_by_id(result)["node-1"]["data"]["localDefinition"]
        assert set(definition.keys()) == LOCAL_DEFINITION_KEYS
        assert definition["name"] == "fetch_status"
        assert definition["variables"] == []

    def test_local_definition_declares_the_contract(self) -> None:
        result = compile_clean(local_function_recipe())
        definition = nodes_by_id(result)["node-1"]["data"]["localDefinition"]
        (input_entry,) = definition["inputs"]
        assert input_entry["name"] == "url"
        assert input_entry["type"] == "string"
        assert input_entry["required"] is True
        (output_entry,) = definition["outputs"]
        assert output_entry["name"] == "status"
        assert output_entry["type"] == "integer"

    def test_local_body_compiles_recursively_from_its_own_start_node(self) -> None:
        result = compile_clean(local_function_recipe())
        workflow = nodes_by_id(result)["node-1"]["data"]["localDefinition"]["workflow"]
        assert len(workflow["nodes"]) == 1
        inner = workflow["nodes"][0]
        assert inner["data"]["elementType"] == "log"
        assert inner["width"] == 160
        assert "measured" not in inner
        (inner_edge,) = workflow["edges"]
        assert inner_edge["source"] == "start-node"
        assert inner_edge["target"] == inner["id"]

    def test_inner_nodes_map_to_function_step_paths(self) -> None:
        result = compile_clean(local_function_recipe())
        workflow = nodes_by_id(result)["node-1"]["data"]["localDefinition"]["workflow"]
        inner_id = workflow["nodes"][0]["id"]
        assert result["step_map"][inner_id] == "functions[fetch_status].flow[0]"

    def test_an_expression_setting_is_stored_as_its_source_with_its_flag(self) -> None:
        result = compile_clean(local_function_recipe())
        data = nodes_by_id(result)["node-1"]["data"]
        assert data["config"]["values"] == {"url": "base + '/health'"}
        assert data["expressionFields"] == ["url"]
        assert data["templateFields"] == []
        assert "inputBindings" not in data

    def test_capture_binds_the_declared_outputs(self) -> None:
        result = compile_clean(local_function_recipe())
        config = nodes_by_id(result)["node-1"]["data"]["config"]
        assert config["outputBindings"] == {"status": "health_status"}

    def test_the_label_defaults_to_the_function_name(self) -> None:
        result = compile_clean(local_function_recipe())
        assert nodes_by_id(result)["node-1"]["data"]["label"] == "fetch_status"

    def test_the_step_label_names_the_function_block(self) -> None:
        result = compile_clean(local_function_recipe("Check health"))
        data = nodes_by_id(result)["node-1"]["data"]
        assert data["label"] == "Check health"
        assert data["localDefinition"]["name"] == "fetch_status"

    def test_local_name_shadows_the_library(self) -> None:
        seed_library_function()
        functions = [
            {
                "name": "fetch_remote",
                "inputs": [],
                "outputs": [],
                "flow": [LOG_STEP],
            }
        ]
        flow = [{"function": "fetch_remote"}]
        result = compile_clean(make_recipe(flow, functions=functions))
        data = nodes_by_id(result)["node-1"]["data"]
        assert data["functionLifecycle"] == "local"
        assert "functionId" not in data


class TestFunctionBlockWidth:
    def test_a_short_function_name_keeps_the_192_function_floor(self) -> None:
        result = compile_clean(local_function_recipe())
        assert nodes_by_id(result)["node-1"]["width"] == 192

    def test_a_long_label_clamps_at_the_360_maximum(self) -> None:
        result = compile_clean(local_function_recipe("Fetch the health status of the shop"))
        assert nodes_by_id(result)["node-1"]["width"] == 360


class TestLibraryFunctionStep:
    def test_a_library_step_pins_id_and_version(self) -> None:
        library = seed_library_function()
        flow = [
            {
                "function": "fetch_remote",
                "version": "1.2.0",
                "settings": {"host": "myhost.local"},
                "capture": {"result": "r"},
            }
        ]
        result = compile_clean(make_recipe(flow))
        data = nodes_by_id(result)["node-1"]["data"]
        assert data["elementType"] == "function"
        assert data["nodeType"] == "function"
        assert data["functionLifecycle"] == "shared"
        assert data["functionId"] == library["id"]
        assert data["functionVersion"] == "1.2.0"
        assert "localDefinition" not in data

    def test_a_literal_text_setting_is_stored_as_its_value(self) -> None:
        seed_library_function()
        flow = [{"function": "fetch_remote", "version": "1.2.0", "settings": {"host": "h.local"}}]
        result = compile_clean(make_recipe(flow))
        data = nodes_by_id(result)["node-1"]["data"]
        assert data["config"]["values"] == {"host": "h.local"}
        assert data["expressionFields"] == []
        assert "inputBindings" not in data

    def test_a_literal_number_setting_is_stored_as_its_number(self) -> None:
        seed_library_function(
            inputs=[
                {
                    "name": "port",
                    "type": "integer",
                    "required": True,
                    "default": None,
                    "description": "",
                }
            ]
        )
        flow = [{"function": "fetch_remote", "version": "1.2.0", "settings": {"port": 8080}}]
        result = compile_clean(make_recipe(flow))
        data = nodes_by_id(result)["node-1"]["data"]
        assert data["config"]["values"] == {"port": 8080}
        assert data["expressionFields"] == []

    def test_capture_binds_library_outputs(self) -> None:
        seed_library_function()
        flow = [
            {
                "function": "fetch_remote",
                "version": "1.2.0",
                "settings": {"host": "h"},
                "capture": {"result": "r"},
            }
        ]
        result = compile_clean(make_recipe(flow))
        config = nodes_by_id(result)["node-1"]["data"]["config"]
        assert config["outputBindings"] == {"result": "r"}


FORMS_FUNCTION: dict[str, Any] = {
    "name": "shape",
    "inputs": [
        {"name": "note", "type": "string"},
        {"name": "headers", "type": "map", "default": {}},
        {"name": "limits", "type": "map", "default": {}},
        {"name": "tags", "type": "array", "default": []},
        {"name": "token", "type": "string", "secret": True},
    ],
    "outputs": [],
    "flow": [LOG_STEP],
}


def forms_data(settings: dict[str, Any], **step: Any) -> dict[str, Any]:
    recipe = make_recipe(
        [{"function": "shape", "settings": settings, **step}],
        variables={"run_id": {"type": "string", "value": "r-1"}},
        functions=[FORMS_FUNCTION],
    )
    data: dict[str, Any] = nodes_by_id(compile_clean(recipe))["node-1"]["data"]
    return data


class TestFunctionStepSettingForms:
    """Each setting form a block step writes is stored the same way on a Function Block:
    the value in config.values, its kind in the expression and template flags, its element
    types beside it (REQ-3.1.1.5, REQ-3.1.3.19)."""

    def test_a_template_setting_is_stored_with_its_template_flag(self) -> None:
        data = forms_data({"note": "id-{{ run_id }}"})
        assert data["config"]["values"] == {"note": "id-{{ run_id }}"}
        assert data["templateFields"] == ["note"]
        assert data["expressionFields"] == []

    def test_an_entry_expression_is_tracked_by_its_dotted_key(self) -> None:
        data = forms_data({"headers": {"X-Id": {"expr": "run_id"}, "Accept": "json"}})
        assert data["config"]["values"] == {"headers": {"X-Id": "run_id", "Accept": "json"}}
        assert data["expressionFields"] == ["headers.X-Id"]

    def test_a_list_item_expression_is_tracked_by_its_index(self) -> None:
        data = forms_data({"tags": [{"expr": "run_id"}, "b"]})
        assert data["config"]["values"] == {"tags": ["run_id", "b"]}
        assert data["expressionFields"] == ["tags.0"]

    def test_a_typed_list_is_stored_with_its_element_types(self) -> None:
        data = forms_data({"tags": [8080, "1.0"]}, element_types={"tags": ["integer", "float"]})
        assert data["config"]["values"] == {"tags": ["8080", "1.0"]}
        assert data["elementTypes"] == {"tags": ["integer", "float"]}

    def test_a_typed_map_is_stored_with_its_element_types(self) -> None:
        data = forms_data(
            {"limits": {"n": 16, "ratio": "1.0"}}, element_types={"limits": {"ratio": "float"}}
        )
        assert data["config"]["values"] == {"limits": {"n": "16", "ratio": "1.0"}}
        assert data["elementTypes"] == {"limits": {"n": "integer", "ratio": "float"}}

    def test_a_secret_input_literal_is_stored_like_a_secret_block_setting(self) -> None:
        data = forms_data({"token": "t0k"})
        assert data["config"]["values"] == {"token": "t0k"}

    def test_a_setting_left_out_is_not_stored(self) -> None:
        data = forms_data({"note": "x"})
        assert data["config"]["values"] == {"note": "x"}
        assert "elementTypes" not in data
        assert "inputBindings" not in data


class TestFunctionStepFindings:
    def test_unknown_function(self) -> None:
        result = compile_recipe(make_recipe([{"function": "nope"}]))
        finding = find_finding(result["findings"], "UNKNOWN_FUNCTION")
        assert finding["severity"] == "error"
        assert finding["step"] == "flow[0]"
        assert finding["problem"] == (
            "Function 'nope' is not defined in this recipe and was not found in the library"
        )
        assert finding["fix"] == (
            "Define it under functions: or use list_functions to find the published name"
        )
        assert result["test_data"] is None

    def test_a_library_step_requires_an_exact_version(self) -> None:
        seed_library_function()
        result = compile_recipe(
            make_recipe([{"function": "fetch_remote", "settings": {"host": "h"}}])
        )
        finding = find_finding(result["findings"], "MISSING_FUNCTION_VERSION")
        assert finding["severity"] == "error"
        assert finding["step"] == "flow[0]"
        assert finding["problem"] == "Published Function 'fetch_remote' requires an exact version"
        assert finding["fix"] == "Add version (see list_functions for available versions)"

    def test_unknown_library_version(self) -> None:
        seed_library_function()
        result = compile_recipe(
            make_recipe(
                [{"function": "fetch_remote", "version": "9.9.9", "settings": {"host": "h"}}]
            )
        )
        finding = find_finding(result["findings"], "UNKNOWN_FUNCTION_VERSION")
        assert finding["problem"] == "Function 'fetch_remote' has no published version 9.9.9"
        assert finding["fix"] == "Use an available version (see list_functions)"

    def test_an_input_the_function_does_not_declare_is_an_unknown_setting(self) -> None:
        seed_library_function()
        step = {"function": "fetch_remote", "version": "1.2.0", "settings": {"host": "h", "x": 1}}
        result = compile_recipe(make_recipe([step]))
        assert find_finding(result["findings"], "UNKNOWN_SETTING") == error_at(
            "flow[0].settings.x",
            "UNKNOWN_SETTING",
            "Block 'fetch_remote' has no setting 'x'",
            "Valid settings: host",
        )
        assert result["test_data"] is None

    def test_a_required_input_left_out_is_a_missing_setting(self) -> None:
        seed_library_function()
        result = compile_recipe(make_recipe([{"function": "fetch_remote", "version": "1.2.0"}]))
        assert find_finding(result["findings"], "MISSING_REQUIRED_SETTING") == error_at(
            "flow[0].settings.host",
            "MISSING_REQUIRED_SETTING",
            "Required setting 'host' is missing for block 'fetch_remote'",
            "Add settings.host",
        )
        assert result["test_data"] is None

    def test_local_function_input_findings_apply_too(self) -> None:
        functions = [
            {
                "name": "fetch_status",
                "inputs": [{"name": "url", "type": "string", "required": True}],
                "outputs": [],
                "flow": [LOG_STEP],
            }
        ]
        flow = [{"function": "fetch_status", "settings": {"bogus": 1, "url": "u"}}]
        result = compile_recipe(make_recipe(flow, functions=functions))
        assert find_finding(result["findings"], "UNKNOWN_SETTING") == error_at(
            "flow[0].settings.bogus",
            "UNKNOWN_SETTING",
            "Block 'fetch_status' has no setting 'bogus'",
            "Valid settings: url",
        )


OUTPUT_KINDS = [
    pytest.param(
        {"name": "size", "type": "integer", "expr": "len(url)"},
        {"name": "size", "type": "integer", "isExpression": True, "default": "len(url)"},
        id="expression",
    ),
    pytest.param(
        {"name": "label", "type": "string", "template": "id-{{ url }}"},
        {"name": "label", "type": "string", "isTemplate": True, "default": "id-{{ url }}"},
        id="template",
    ),
]


def output_kind_recipe(*outputs: dict[str, Any]) -> str:
    functions = [
        {
            "name": "measure",
            "inputs": [{"name": "url", "type": "string", "required": True}],
            "outputs": list(outputs),
            "flow": [LOG_STEP],
        }
    ]
    flow = [{"function": "measure", "settings": {"url": "http://shop.local"}}]
    return make_recipe(flow, functions=functions)


class TestOutputKind:
    """An output declares its kind like a variable: the source sits in `default` under the
    variable's kind keys (REQ-3.1.2.8)."""

    @pytest.mark.parametrize(("authored", "stored"), OUTPUT_KINDS)
    def test_an_output_kind_is_stored_with_the_variable_kind_keys(
        self, authored: dict[str, Any], stored: dict[str, Any]
    ) -> None:
        result = compile_clean(output_kind_recipe(authored))
        definition = nodes_by_id(result)["node-1"]["data"]["localDefinition"]
        assert definition["outputs"] == [stored]

    def test_both_kinds_and_a_plain_default_sit_side_by_side(self) -> None:
        result = compile_clean(
            output_kind_recipe(
                {"name": "size", "type": "integer", "expr": "len(url)"},
                {"name": "label", "type": "string", "template": "id-{{ url }}"},
                {"name": "note", "type": "string", "default": "none"},
            )
        )
        definition = nodes_by_id(result)["node-1"]["data"]["localDefinition"]
        assert definition["outputs"] == [
            {"name": "size", "type": "integer", "isExpression": True, "default": "len(url)"},
            {"name": "label", "type": "string", "isTemplate": True, "default": "id-{{ url }}"},
            {"name": "note", "type": "string", "default": "none"},
        ]


ENUM_INPUT: dict[str, Any] = {
    "name": "level",
    "type": "string",
    "required": True,
    "enumValues": ["low", "high"],
    "default": "low",
}
REQUIRED_INPUT_WITH_DEFAULT: dict[str, Any] = {
    "name": "port",
    "type": "integer",
    "required": True,
    "default": 80,
    "description": "Service port",
}


def declared_inputs_recipe(
    inputs: list[dict[str, Any]],
    settings: dict[str, Any],
    flow: list[Any] | None = None,
) -> str:
    functions = [{"name": "probe", "inputs": inputs, "outputs": [], "flow": flow or [LOG_STEP]}]
    step = {"function": "probe", "settings": settings}
    return make_recipe([step], functions=functions)


class TestInputDeclarationsCompileVerbatim:
    """An enum input and a Required input's default are stored as written, so a compiled
    Test and a hand-built one hold the same declaration (REQ-3.1.2.10, REQ-3.1.2.11)."""

    def test_an_enum_input_is_stored_as_written(self) -> None:
        result = compile_clean(declared_inputs_recipe([ENUM_INPUT], {"level": "high"}))
        definition = nodes_by_id(result)["node-1"]["data"]["localDefinition"]
        assert definition["inputs"] == [ENUM_INPUT]

    def test_a_required_inputs_default_is_stored(self) -> None:
        recipe = declared_inputs_recipe([REQUIRED_INPUT_WITH_DEFAULT], {"port": 8080})
        definition = nodes_by_id(compile_clean(recipe))["node-1"]["data"]["localDefinition"]
        assert definition["inputs"] == [REQUIRED_INPUT_WITH_DEFAULT]

    def test_the_body_types_an_enum_input_by_its_type(self) -> None:
        item = {**ENUM_INPUT, "type": "integer", "enumValues": [1, 2], "default": 1}
        body = [{"assert": {"that": [{"variable": "level", "operator": "is_null"}]}}]
        recipe = declared_inputs_recipe([item], {"level": 2}, flow=body)
        definition = nodes_by_id(compile_clean(recipe))["node-1"]["data"]["localDefinition"]
        (check,) = definition["workflow"]["nodes"][0]["data"]["config"]["values"]["assertions"]
        assert check["value_type"] == "integer"

    def test_a_function_block_still_gives_a_required_input_that_has_a_default(self) -> None:
        # A Function Block never fills a Required input from its default (REQ-3.1.2.10).
        recipe = declared_inputs_recipe([REQUIRED_INPUT_WITH_DEFAULT], {})
        finding = find_finding(compile_recipe(recipe)["findings"], "MISSING_REQUIRED_SETTING")
        assert finding == error_at(
            "flow[0].settings.port",
            "MISSING_REQUIRED_SETTING",
            "Required setting 'port' is missing for block 'probe'",
            "Add settings.port",
        )


class TestLocalVariableDeduplication:
    def test_repeated_captures_into_the_same_local_name_declare_it_once(self) -> None:
        functions = [
            {
                "name": "double_capture",
                "inputs": [],
                "outputs": [],
                "flow": [
                    {
                        "block": "http-client",
                        "settings": {"url": "http://x", "method": "GET"},
                        "capture": {"status_code": "seen"},
                    },
                    {
                        "block": "http-client",
                        "settings": {"url": "http://y", "method": "GET"},
                        "capture": {"status_code": "seen"},
                    },
                ],
            }
        ]
        flow = [{"function": "double_capture"}]
        result = compile_clean(make_recipe(flow, functions=functions))
        definition = nodes_by_id(result)["node-1"]["data"]["localDefinition"]
        names = [entry["name"] for entry in definition["variables"]]
        assert names == ["seen"]


ISSUE_FUNCTION: dict[str, Any] = {
    "name": "issue",
    "inputs": [],
    "outputs": [
        {"name": "token", "type": "string", "secret": True},
        {"name": "status", "type": "integer"},
    ],
    "flow": [LOG_STEP],
}


def issue_step(**extra: Any) -> dict[str, Any]:
    return {"function": "issue", "capture": {"token": "tok", "status": "st"}, **extra}


class TestFunctionStepSecretOutputs:
    """A Function step marks its Secret outputs as the Function Block window does; a capture
    it declares for a marked output is declared secret, and the stored list holds only a
    choice the step made (SECUI-11, REQ-3.1.2.9)."""

    def test_without_a_choice_the_outputs_declared_secret_mark_the_capture(self) -> None:
        result = compile_clean(make_recipe([issue_step()], functions=[ISSUE_FUNCTION]))
        config = nodes_by_id(result)["node-1"]["data"]["config"]
        variables = result["test_data"]["variables"]
        assert "outputSecretFields" not in config
        assert variables["tok"] == {"type": "string", "secret": True}
        assert variables["st"] == {"type": "integer"}

    def test_a_listed_choice_is_the_whole_choice(self) -> None:
        recipe = make_recipe([issue_step(secret_outputs=["status"])], functions=[ISSUE_FUNCTION])
        result = compile_clean(recipe)
        variables = result["test_data"]["variables"]
        assert nodes_by_id(result)["node-1"]["data"]["config"]["outputSecretFields"] == ["status"]
        assert variables["tok"] == {"type": "string"}
        assert variables["st"] == {"type": "integer", "secret": True}

    def test_an_empty_list_marks_none(self) -> None:
        recipe = make_recipe([issue_step(secret_outputs=[])], functions=[ISSUE_FUNCTION])
        result = compile_clean(recipe)
        assert nodes_by_id(result)["node-1"]["data"]["config"]["outputSecretFields"] == []
        assert "secret" not in result["test_data"]["variables"]["tok"]

    def test_marked_outputs_are_stored_in_declaration_order(self) -> None:
        step = issue_step(secret_outputs=["status", "token"])
        result = compile_clean(make_recipe([step], functions=[ISSUE_FUNCTION]))
        config = nodes_by_id(result)["node-1"]["data"]["config"]
        assert config["outputSecretFields"] == ["token", "status"]

    def test_a_later_marked_capture_makes_an_auto_declared_variable_secret(self) -> None:
        flow = [issue_step(secret_outputs=[]), issue_step()]
        result = compile_clean(make_recipe(flow, functions=[ISSUE_FUNCTION]))
        assert result["test_data"]["variables"]["tok"] == {"type": "string", "secret": True}

    def test_a_library_step_marks_the_outputs_its_version_declares_secret(self) -> None:
        seed_library_function(
            outputs=[
                {"name": "result", "type": "string", "description": ""},
                {"name": "token", "type": "string", "secret": True, "description": ""},
            ]
        )
        step = {
            "function": "fetch_remote",
            "version": "1.2.0",
            "settings": {"host": "h"},
            "capture": {"token": "tok"},
        }
        result = compile_clean(make_recipe([step]))
        config = nodes_by_id(result)["node-1"]["data"]["config"]
        assert "outputSecretFields" not in config
        assert result["test_data"]["variables"]["tok"] == {"type": "string", "secret": True}

    def test_a_marked_capture_inside_a_function_body_declares_a_secret_local(self) -> None:
        outer = {
            "name": "outer",
            "inputs": [],
            "outputs": [],
            "flow": [issue_step(secret_outputs=[]), issue_step()],
        }
        flow = [{"function": "outer"}]
        result = compile_clean(make_recipe(flow, functions=[ISSUE_FUNCTION, outer]))
        definition = nodes_by_id(result)["node-1"]["data"]["localDefinition"]
        locals_by_name = {entry["name"]: entry for entry in definition["variables"]}
        assert locals_by_name["tok"] == {
            "id": "var-tok",
            "name": "tok",
            "type": "string",
            "secret": True,
        }
        assert locals_by_name["st"] == {"id": "var-st", "name": "st", "type": "integer"}


def setter_function(variables: dict[str, Any], outputs: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "name": "tally",
        "inputs": [],
        "outputs": outputs,
        "variables": variables,
        "flow": [
            {
                "block": "http-client",
                "settings": {"url": "http://x", "method": "GET"},
                "capture": {"status_code": "seen"},
            },
            {"set": {"count": {"expr": "1 + 1"}, "total": 5, "seen": {"expr": "seen + 1"}}},
        ],
    }


class TestSetterRowTypesInAFunctionBody:
    """A Variable Setter row inside a Function body takes its type from the Function's
    scope, never from a Test variable of the same name (REQ-3.1.2.7)."""

    def test_rows_take_the_types_the_function_scope_declares(self) -> None:
        function = setter_function(
            {"total": {"type": "float", "value": 0.5}}, [{"name": "count", "type": "integer"}]
        )
        variables = {
            "count": {"type": "string", "value": "x"},
            "total": {"type": "string", "value": "y"},
            "seen": {"type": "boolean", "value": True},
        }
        recipe = make_recipe([{"function": "tally"}], variables=variables, functions=[function])
        definition = nodes_by_id(compile_clean(recipe))["node-1"]["data"]["localDefinition"]
        setter = next(
            node
            for node in definition["workflow"]["nodes"]
            if node["data"]["elementType"] == "variable-setter"
        )
        assert setter["data"]["variableTypes"] == {
            "count": "integer",
            "total": "float",
            "seen": "integer",
        }

    def test_an_expression_row_the_function_does_not_declare_stays_untyped(self) -> None:
        function = {
            "name": "tally",
            "inputs": [],
            "outputs": [],
            "flow": [{"set": {"other": {"expr": "1 + 1"}}}],
        }
        recipe = make_recipe(
            [{"function": "tally"}],
            variables={"other": {"type": "string", "value": "x"}},
            functions=[function],
        )
        definition = nodes_by_id(compile_clean(recipe))["node-1"]["data"]["localDefinition"]
        setter = definition["workflow"]["nodes"][0]
        assert setter["data"]["variableTypes"] == {}

    def test_a_test_level_row_still_takes_the_test_declaration(self) -> None:
        recipe = make_recipe(
            [{"set": {"count": {"expr": "1 + 1"}}}],
            variables={"count": {"type": "integer", "value": 0}},
        )
        setter = nodes_by_id(compile_clean(recipe))["node-1"]
        assert setter["data"]["variableTypes"] == {"count": "integer"}


class TestMarkedFunctionCaptureMakesADeclaredVariableSecret:
    """A Function step's marked capture into a variable the recipe declares plain makes it
    secret with a warning, as the Function Block window's Save does after its warning
    (SECUI-11, SECUI-12)."""

    def test_a_test_variable_is_stored_secret_with_a_warning(self) -> None:
        variables = {"tok": {"type": "string"}}
        recipe = make_recipe([issue_step()], variables=variables, functions=[ISSUE_FUNCTION])
        result = compile_clean(recipe)
        assert result["test_data"]["variables"]["tok"] == {"type": "string", "secret": True}
        warning = find_finding(result["findings"], "VARIABLE_MADE_SECRET")
        assert warning["severity"] == "warning"
        assert warning["step"] == "flow[0].capture.token"
        assert warning["problem"] == (
            "Secret output 'token' makes the plain variable 'tok' a secret. "
            "Its value is masked from then on. Making it plain again clears its value"
        )

    def test_a_function_local_is_stored_secret_with_a_warning(self) -> None:
        outer = {
            "name": "outer",
            "inputs": [],
            "outputs": [],
            "variables": {"tok": {"type": "string"}},
            "flow": [issue_step()],
        }
        flow = [{"function": "outer"}]
        result = compile_clean(make_recipe(flow, functions=[ISSUE_FUNCTION, outer]))
        definition = nodes_by_id(result)["node-1"]["data"]["localDefinition"]
        locals_by_name = {entry["name"]: entry for entry in definition["variables"]}
        assert locals_by_name["tok"] == {
            "id": "var-tok",
            "name": "tok",
            "type": "string",
            "secret": True,
        }
        warning = find_finding(result["findings"], "VARIABLE_MADE_SECRET")
        assert warning["step"] == "functions[outer].flow[0].capture.token"

    def test_a_capture_into_a_function_output_is_not_promoted(self) -> None:
        outer = {
            "name": "outer",
            "inputs": [],
            "outputs": [{"name": "tok", "type": "string"}],
            "flow": [{"function": "issue", "capture": {"token": "tok"}}],
        }
        flow = [{"function": "outer"}]
        result = compile_clean(make_recipe(flow, functions=[ISSUE_FUNCTION, outer]))
        definition = nodes_by_id(result)["node-1"]["data"]["localDefinition"]
        assert definition["outputs"] == [{"name": "tok", "type": "string"}]
        assert [f["code"] for f in result["findings"]] == []

    def test_an_unticked_output_leaves_the_variable_plain(self) -> None:
        variables = {"tok": {"type": "string"}}
        flow = [issue_step(secret_outputs=[])]
        result = compile_clean(make_recipe(flow, variables=variables, functions=[ISSUE_FUNCTION]))
        assert result["test_data"]["variables"]["tok"] == {"type": "string"}
        assert [f["code"] for f in result["findings"]] == []

    def test_an_unticked_output_leaves_a_function_local_plain(self) -> None:
        outer = {
            "name": "outer",
            "inputs": [],
            "outputs": [],
            "variables": {"tok": {"type": "string"}},
            "flow": [issue_step(secret_outputs=[])],
        }
        flow = [{"function": "outer"}]
        result = compile_clean(make_recipe(flow, functions=[ISSUE_FUNCTION, outer]))
        definition = nodes_by_id(result)["node-1"]["data"]["localDefinition"]
        locals_by_name = {entry["name"]: entry for entry in definition["variables"]}
        assert locals_by_name["tok"] == {"id": "var-tok", "name": "tok", "type": "string"}
        assert [f["code"] for f in result["findings"]] == []

    def test_a_function_local_already_secret_gets_no_warning(self) -> None:
        outer = {
            "name": "outer",
            "inputs": [],
            "outputs": [],
            "variables": {"tok": {"type": "string", "secret": True}},
            "flow": [issue_step()],
        }
        flow = [{"function": "outer"}]
        result = compile_clean(make_recipe(flow, functions=[ISSUE_FUNCTION, outer]))
        definition = nodes_by_id(result)["node-1"]["data"]["localDefinition"]
        locals_by_name = {entry["name"]: entry for entry in definition["variables"]}
        assert locals_by_name["tok"] == {
            "id": "var-tok",
            "name": "tok",
            "type": "string",
            "secret": True,
        }
        assert "VARIABLE_MADE_SECRET" not in [f["code"] for f in result["findings"]]
