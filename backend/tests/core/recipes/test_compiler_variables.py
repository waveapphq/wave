"""Variable emission: verbatim declarations, auto-declared captures, findings.

REQ-5.2.7.3. Persisted variable shapes follow the live
test schema: value stored verbatim, secret flag (never a secret type),
isExpression + expression for expression-valued variables.
"""

from typing import Any

import pytest

from tests.core.recipes.conftest import LOG_STEP, find_finding, make_recipe


def compile_recipe(text: str) -> dict[str, Any]:
    from wavecore.core.recipes.compiler import compile_recipe as compile_fn

    return compile_fn(text)


def compile_clean(text: str) -> dict[str, Any]:
    result = compile_recipe(text)
    errors = [f for f in result["findings"] if f["severity"] == "error"]
    assert errors == [], f"expected a clean compile, got {errors!r}"
    assert result["test_data"] is not None
    return result


def variables_of(result: dict[str, Any]) -> dict[str, Any]:
    return result["test_data"]["variables"]


class TestDeclarationEmission:
    def test_value_declarations_are_emitted_in_the_stored_form(self) -> None:
        variables = {
            "base_url": {"type": "string", "value": "http://shop.local"},
            "attempts": {"type": "integer", "value": 3},
            "ratio": {"type": "float", "value": 0.5},
            "enabled": {"type": "boolean", "value": True},
            "items": {"type": "array", "value": [1, 2]},
            "lookup": {"type": "map", "value": {"k": "v"}},
        }
        result = compile_clean(make_recipe([LOG_STEP], variables=variables))
        emitted = variables_of(result)
        assert emitted["base_url"] == {"type": "string", "value": "http://shop.local"}
        assert emitted["attempts"] == {"type": "integer", "value": 3}
        assert emitted["ratio"] == {"type": "float", "value": 0.5}
        assert emitted["enabled"] == {"type": "boolean", "value": True}
        assert emitted["items"] == {
            "type": "array",
            "value": ["1", "2"],
            "elementTypes": ["integer", "integer"],
        }
        assert emitted["lookup"] == {
            "type": "map",
            "value": {"k": "v"},
            "elementTypes": {"k": "string"},
        }

    def test_a_null_value_compiles_for_every_type_and_keeps_the_type(self) -> None:
        names = ("string", "integer", "float", "boolean", "array", "map", "table")
        variables = {f"v_{name}": {"type": name, "value": None} for name in names}
        emitted = variables_of(compile_clean(make_recipe([LOG_STEP], variables=variables)))
        for name in names:
            declaration = emitted[f"v_{name}"]
            assert declaration["type"] == name
            assert declaration.get("value") is None
            assert "isExpression" not in declaration

    def test_secret_declaration_keeps_the_secret_flag(self) -> None:
        variables = {"password": {"type": "string", "secret": True, "value": "hunter2"}}
        result = compile_clean(make_recipe([LOG_STEP], variables=variables))
        assert variables_of(result)["password"] == {
            "type": "string",
            "secret": True,
            "value": "hunter2",
        }

    def test_expression_declaration_keeps_the_secret_flag(self) -> None:
        variables = {
            "base": {"type": "string", "value": "abc"},
            "derived_secret": {"type": "string", "secret": True, "expr": "base + '-x'"},
        }
        result = compile_clean(make_recipe([LOG_STEP], variables=variables))
        assert variables_of(result)["derived_secret"] == {
            "type": "string",
            "isExpression": True,
            "value": "base + '-x'",
            "secret": True,
        }

    def test_expression_declaration_uses_the_expression_keys(self) -> None:
        variables = {
            "base_url": {"type": "string", "value": "http://shop.local"},
            "derived": {"type": "string", "expr": "base_url + '/api'"},
        }
        result = compile_clean(make_recipe([LOG_STEP], variables=variables))
        assert variables_of(result)["derived"] == {
            "type": "string",
            "isExpression": True,
            "value": "base_url + '/api'",
        }

    def test_template_declaration_uses_the_template_keys(self) -> None:
        # REQ-3.1.3.15: a Template variable carries its source in `value`, like an expression.
        variables = {
            "n": {"type": "integer", "value": 3},
            "label": {"type": "string", "template": "id-{{ n }}"},
        }
        result = compile_clean(make_recipe([LOG_STEP], variables=variables))
        assert variables_of(result)["label"] == {
            "type": "string",
            "isTemplate": True,
            "value": "id-{{ n }}",
        }

    def test_template_declaration_keeps_the_secret_flag(self) -> None:
        variables = {
            "n": {"type": "integer", "value": 3},
            "label": {"type": "string", "secret": True, "template": "id-{{ n }}"},
        }
        result = compile_clean(make_recipe([LOG_STEP], variables=variables))
        assert variables_of(result)["label"] == {
            "type": "string",
            "isTemplate": True,
            "value": "id-{{ n }}",
            "secret": True,
        }

    def test_a_null_parameter_default_is_stored_null_and_reads_back(self) -> None:
        # `default: null` is no default: stored null, read back as written.
        import yaml

        from wavecore.core.recipes.decompiler import decompile_test_data

        functions = [
            {
                "name": "fn",
                "inputs": [{"name": "n", "type": "integer", "default": None}],
                "outputs": [{"name": "out", "type": "string", "default": None}],
                "flow": [LOG_STEP],
            }
        ]
        flow = [{"function": "fn"}]
        test_data = compile_clean(make_recipe(flow, functions=functions))["test_data"]
        definition = next(
            node
            for node in test_data["workflow"]["nodes"]
            if node["data"]["elementType"] == "function"
        )["data"]["localDefinition"]
        assert definition["inputs"] == [{"name": "n", "type": "integer", "default": None}]
        assert definition["outputs"] == [{"name": "out", "type": "string", "default": None}]
        (readback,) = yaml.safe_load(decompile_test_data(test_data)["recipe"])["functions"]
        assert readback["inputs"] == [{"name": "n", "type": "integer", "default": None}]
        assert readback["outputs"] == [{"name": "out", "type": "string", "default": None}]


class TestCompiledVariablesAreRuntimeReadable:
    """The runtime routes an expression variable on its ``value`` key; a compiled
    test must therefore carry the same shape the workbench saves."""

    def test_expression_declaration_reaches_the_runtime_expression_map(self) -> None:
        from wavecore.api.services.workbench.service import _flatten_variables

        variables = {
            "base_url": {"type": "string", "value": "http://shop.local"},
            "derived": {"type": "string", "expr": "base_url + '/api'"},
        }
        result = compile_clean(make_recipe([LOG_STEP], variables=variables))
        literals, expr_map, _ = _flatten_variables(variables_of(result))
        assert expr_map["derived"] == ("base_url + '/api'", "string")
        assert "derived" not in literals

    def test_secret_expression_declaration_reaches_the_runtime_expression_map(self) -> None:
        from wavecore.api.services.workbench.service import _flatten_variables

        variables = {
            "base": {"type": "string", "value": "abc"},
            "derived_secret": {"type": "string", "secret": True, "expr": "base + '-x'"},
        }
        result = compile_clean(make_recipe([LOG_STEP], variables=variables))
        literals, expr_map, _ = _flatten_variables(variables_of(result))
        assert expr_map["derived_secret"] == ("base + '-x'", "string")
        assert "derived_secret" not in literals

    def test_template_declaration_reaches_the_runtime_template_map(self) -> None:
        from wavecore.api.services.workbench.service import _flatten_variables

        variables = {
            "n": {"type": "integer", "value": 3},
            "label": {"type": "string", "template": "id-{{ n }}"},
        }
        result = compile_clean(make_recipe([LOG_STEP], variables=variables))
        literals, _, template_map = _flatten_variables(variables_of(result))
        assert template_map == {"label": "id-{{ n }}"}
        assert "label" not in literals


class TestAutoDeclaredCaptures:
    """An undeclared capture target is declared with the output's type and holds
    null until the block writes it (REQ-5.2.7.3, REQ-3.1.3.20)."""

    def test_capture_target_is_auto_declared_from_the_output_schema(self) -> None:
        step = {
            "block": "http-client",
            "settings": {"url": "http://x", "method": "GET"},
            "capture": {"status_code": "home_status", "body": "home_body"},
        }
        result = compile_clean(make_recipe([step]))
        emitted = variables_of(result)
        assert emitted["home_status"] == {"type": "integer"}
        assert emitted["home_body"] == {"type": "string"}

    def test_auto_declared_types_cover_all_output_kinds(self) -> None:
        step = {
            "block": "http-client",
            "settings": {"url": "http://x", "method": "GET"},
            "capture": {"headers": "resp_headers", "response_time": "elapsed"},
        }
        result = compile_clean(make_recipe([step]))
        emitted = variables_of(result)
        assert emitted["resp_headers"] == {"type": "map"}
        assert emitted["elapsed"] == {"type": "float"}

    def test_explicit_declaration_wins_over_auto_declaration(self) -> None:
        step = {
            "block": "http-client",
            "settings": {"url": "http://x", "method": "GET"},
            "capture": {"status_code": "home_status"},
        }
        variables = {"home_status": {"type": "integer", "value": 7}}
        result = compile_clean(make_recipe([step], variables=variables))
        assert variables_of(result)["home_status"] == {"type": "integer", "value": 7}

    def test_construct_captures_are_auto_declared_too(self) -> None:
        flow = [
            {
                "try": {
                    "steps": [LOG_STEP],
                    "catch": [LOG_STEP],
                    "capture": {"error": "err", "caught": "was_caught"},
                }
            }
        ]
        result = compile_clean(make_recipe(flow))
        emitted = variables_of(result)
        assert emitted["err"] == {"type": "map"}
        assert emitted["was_caught"] == {"type": "boolean"}


class TestUnsetDeclarations:
    """A declared variable with no initial value: valid to author, stored valueless,
    and read back the same way."""

    def test_type_alone_is_a_valid_declaration(self) -> None:
        result = compile_clean(make_recipe([LOG_STEP], variables={"foo": {"type": "string"}}))
        assert variables_of(result)["foo"] == {"type": "string"}

    def test_every_type_may_be_declared_unset(self) -> None:
        variables = {
            f"v_{name}": {"type": name}
            for name in ("string", "integer", "float", "boolean", "array", "map", "table")
        }
        emitted = variables_of(compile_clean(make_recipe([LOG_STEP], variables=variables)))
        for name in ("string", "integer", "float", "boolean", "array", "map", "table"):
            assert emitted[f"v_{name}"] == {"type": name}

    def test_unset_secret_keeps_its_flag_and_no_value(self) -> None:
        variables = {"token": {"type": "string", "secret": True}}
        result = compile_clean(make_recipe([LOG_STEP], variables=variables))
        assert variables_of(result)["token"] == {"type": "string", "secret": True}

    def test_readback_omits_the_value_key(self) -> None:
        from wavecore.core.recipes.decompiler import _decompile_variables

        assert _decompile_variables({"session": {"type": "string"}}) == {
            "session": {"type": "string"}
        }

    def test_readback_keeps_a_stored_empty_string(self) -> None:
        from wavecore.core.recipes.decompiler import _decompile_variables

        assert _decompile_variables({"blank": {"type": "string", "value": ""}}) == {
            "blank": {"type": "string", "value": ""}
        }

    def test_compile_readback_compile_round_trips(self) -> None:
        import yaml

        from wavecore.core.recipes.decompiler import decompile_test_data

        recipe = make_recipe([LOG_STEP], variables={"session": {"type": "string"}})
        first = compile_clean(recipe)["test_data"]
        readback = decompile_test_data(first)
        assert yaml.safe_load(readback["recipe"])["variables"] == {"session": {"type": "string"}}
        second = compile_clean(readback["recipe"])["test_data"]
        assert second["variables"] == first["variables"]


class TestVariableFindings:
    @pytest.mark.parametrize(
        "declaration",
        [pytest.param({"value": 1}, id="no-type"), pytest.param({"type": ""}, id="empty-type")],
    )
    def test_declaration_without_a_type(self, declaration: dict[str, Any]) -> None:
        result = compile_recipe(make_recipe([LOG_STEP], variables={"foo": declaration}))
        finding = find_finding(result["findings"], "INVALID_VARIABLE_DECLARATION")
        assert finding["severity"] == "error"
        assert finding["step"] == "variables.foo"
        assert finding["problem"] == "Variable 'foo' must declare a type"
        assert finding["fix"] == "Add a type"
        assert result["test_data"] is None

    def test_invalid_variable_type(self) -> None:
        result = compile_recipe(
            make_recipe([LOG_STEP], variables={"foo": {"type": "text", "value": "x"}})
        )
        finding = find_finding(result["findings"], "INVALID_VARIABLE_TYPE")
        assert finding["severity"] == "error"
        assert finding["step"] == "variables.foo"
        assert finding["problem"] == (
            "Invalid variable type: 'text' "
            "(must be one of: array, boolean, float, integer, map, string, table)"
        )
        assert finding["fix"] == "Use a valid type"

    def test_secret_is_a_flag_not_a_type(self) -> None:
        result = compile_recipe(
            make_recipe([LOG_STEP], variables={"foo": {"type": "secret", "value": "x"}})
        )
        finding = find_finding(result["findings"], "INVALID_VARIABLE_TYPE")
        assert finding["problem"] == (
            "Invalid variable type: 'secret' "
            "(must be one of: array, boolean, float, integer, map, string, table)"
        )

    def test_invalid_variable_name(self) -> None:
        result = compile_recipe(
            make_recipe([LOG_STEP], variables={"9lives": {"type": "string", "value": ""}})
        )
        finding = find_finding(result["findings"], "INVALID_VARIABLE")
        assert finding["severity"] == "error"
        assert finding["step"] == "variables.9lives"
        assert finding["problem"] == (
            "Invalid variable name: '9lives' (must match [a-zA-Z_][a-zA-Z0-9_]*)"
        )
        assert finding["fix"] == "Rename the variable"

    def test_recipe_without_variables_emits_an_empty_map(self) -> None:
        result = compile_clean(make_recipe([LOG_STEP]))
        assert variables_of(result) == {}


class TestDeclaredElementTypes:
    """A map / list takes the stored element-typed form (REQ-3.1.3.19)."""

    def test_declared_and_native_elements(self) -> None:
        variables = {
            "limits": {
                "type": "map",
                "value": {
                    "retries": 3,
                    "ratio": "1.0",
                    "big": "1234567890123456789",
                    "zip": "02134",
                },
                "element_types": {"ratio": "float", "big": "integer", "zip": "string"},
            },
            "ports": {"type": "array", "value": [8080, [1.5, "a"]]},
        }
        emitted = variables_of(compile_clean(make_recipe([LOG_STEP], variables=variables)))
        assert emitted["limits"] == {
            "type": "map",
            "value": {
                "retries": "3",
                "ratio": "1.0",
                "big": "1234567890123456789",
                "zip": "02134",
            },
            "elementTypes": {
                "retries": "integer",
                "ratio": "float",
                "big": "integer",
                "zip": "string",
            },
        }
        assert emitted["ports"] == {
            "type": "array",
            "value": ["8080", '[1.5, "a"]'],
            "elementTypes": ["integer", "array"],
        }

    def test_a_null_element_is_stored_as_null_under_any_element_type(self) -> None:
        variables = {
            "limits": {
                "type": "map",
                "value": {"n": 1, "z": None},
                "element_types": {"z": "integer"},
            },
            "ports": {
                "type": "array",
                "value": [None, 8080],
                "element_types": ["float", "integer"],
            },
        }
        emitted = variables_of(compile_clean(make_recipe([LOG_STEP], variables=variables)))
        assert emitted["limits"] == {
            "type": "map",
            "value": {"n": "1", "z": None},
            "elementTypes": {"n": "integer", "z": "integer"},
        }
        assert emitted["ports"] == {
            "type": "array",
            "value": [None, "8080"],
            "elementTypes": ["float", "integer"],
        }

    def test_a_set_row_carries_its_element_types(self) -> None:
        flow = [
            {
                "set": {"built": {"n": "16", "s": "16"}, "note": "x"},
                "element_types": {"built": {"n": "integer"}},
            },
        ]
        variables = {"built": {"type": "map"}, "note": {"type": "string"}}
        nodes = compile_clean(make_recipe(flow, variables=variables))["test_data"]["workflow"][
            "nodes"
        ]
        setter = next(node for node in nodes if node["data"]["elementType"] == "variable-setter")
        assert setter["data"]["config"]["values"]["variables"] == {
            "built": {"n": "16", "s": "16"},
            "note": "x",
        }
        assert setter["data"]["variableElementTypes"] == {"built": {"n": "integer", "s": "string"}}

    def test_a_set_step_without_collections_carries_no_element_types(self) -> None:
        flow = [{"set": {"note": "x"}}]
        nodes = compile_clean(make_recipe(flow, variables={"note": {"type": "string"}}))[
            "test_data"
        ]["workflow"]["nodes"]
        setter = next(node for node in nodes if node["data"]["elementType"] == "variable-setter")
        assert "variableElementTypes" not in setter["data"]

    def test_a_local_function_parameter_default_takes_the_stored_form(self) -> None:
        functions = [
            {
                "name": "fn",
                "inputs": [
                    {
                        "name": "cfg",
                        "type": "map",
                        "default": {"n": 1},
                        "element_types": {"n": "float"},
                    },
                    {"name": "label", "type": "string", "default": "x"},
                ],
                "outputs": [{"name": "out", "type": "array", "default": [2]}],
                "flow": [LOG_STEP],
            }
        ]
        flow = [{"function": "fn", "settings": {"label": "y"}}]
        nodes = compile_clean(make_recipe(flow, functions=functions))["test_data"]["workflow"][
            "nodes"
        ]
        definition = next(node for node in nodes if node["data"]["elementType"] == "function")[
            "data"
        ]["localDefinition"]
        assert definition["inputs"] == [
            {"name": "cfg", "type": "map", "default": {"n": "1"}, "elementTypes": {"n": "float"}},
            {"name": "label", "type": "string", "default": "x"},
        ]
        assert definition["outputs"] == [
            {"name": "out", "type": "array", "default": ["2"], "elementTypes": ["integer"]}
        ]

    @pytest.mark.parametrize(
        ("declared_type", "value", "element_types"),
        [
            pytest.param("array", [8080, "1.0"], ["integer", "float"], id="array"),
            pytest.param("map", {"n": 1, "zip": "02134"}, {"zip": "string"}, id="map"),
            pytest.param("string", "plain", None, id="scalar"),
        ],
    )
    def test_a_parameter_default_is_stored_as_a_test_variable_value_is(
        self, declared_type: str, value: Any, element_types: Any
    ) -> None:
        # One declaration path: a default compiles as a variable's value does (REQ-3.1.3.19).
        typed = {} if element_types is None else {"element_types": element_types}
        declared = {"type": declared_type, **typed}
        functions = [
            {
                "name": "fn",
                "inputs": [{"name": "given", **declared, "default": value}],
                "outputs": [{"name": "made", **declared, "default": value}],
                "flow": [LOG_STEP],
            }
        ]
        recipe = make_recipe(
            [{"function": "fn"}],
            variables={"held": {**declared, "value": value}},
            functions=functions,
        )
        result = compile_clean(recipe)
        stored = variables_of(result)["held"]
        definition = next(
            node
            for node in result["test_data"]["workflow"]["nodes"]
            if node["data"]["elementType"] == "function"
        )["data"]["localDefinition"]
        expected = {key: item for key, item in stored.items() if key != "value"}
        expected["default"] = stored["value"]
        assert definition["inputs"] == [{"name": "given", **expected}]
        assert definition["outputs"] == [{"name": "made", **expected}]


class TestNumberStoredForm:
    """A recipe variable's number is stored in its wire form, every typed digit kept."""

    @pytest.mark.parametrize(
        ("declared", "written", "stored"),
        [
            pytest.param("float", "0.5", 0.5, id="float"),
            pytest.param("float", "2.50", "2.50", id="trailing-zero"),
            pytest.param("float", "30.0", "30.0", id="whole-float"),
            pytest.param(
                "float",
                "1234567890.123456789012345678",
                "1234567890.123456789012345678",
                id="28-digits",
            ),
            pytest.param("integer", "3", 3, id="integer"),
            pytest.param("integer", "9007199254740993", "9007199254740993", id="past-2-53"),
            pytest.param("integer", "'42'", "42", id="exact-text"),
        ],
    )
    def test_a_scalar_number_keeps_every_digit(
        self, declared: str, written: str, stored: Any
    ) -> None:
        variables = {"n": {"type": declared, "value": "__value__"}}
        recipe = make_recipe([LOG_STEP], variables=variables).replace("__value__", written)

        emitted = variables_of(compile_clean(recipe))["n"]

        assert emitted == {"type": declared, "value": stored}
        assert type(emitted["value"]) is type(stored)

    def test_an_exact_float_element_is_stored_as_its_text(self) -> None:
        variables = {
            "limits": {"type": "map", "value": {"ratio": "__ratio__"}},
        }
        recipe = make_recipe([LOG_STEP], variables=variables).replace("__ratio__", "0.10")

        emitted = variables_of(compile_clean(recipe))["limits"]

        assert emitted == {
            "type": "map",
            "value": {"ratio": "0.10"},
            "elementTypes": {"ratio": "float"},
        }

    def test_a_map_key_written_as_a_decimal_number_is_stored_as_its_text(self) -> None:
        flow = [{"set": {"rates": "__rates__"}}]
        variables = {"rates": {"type": "map"}}
        recipe = make_recipe(flow, variables=variables).replace("__rates__", "{1.50: low}")

        result = compile_clean(recipe)

        setter = result["test_data"]["workflow"]["nodes"][0]["data"]
        assert setter["config"]["values"] == {"variables": {"rates": {"1.50": "low"}}}
