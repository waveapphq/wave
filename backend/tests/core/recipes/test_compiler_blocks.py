"""Compiler leaf emission: node/edge shapes, config, fields, ids, step map.

REQ-5.2.7.3. Node shapes mirror the live canvas contract.
"""

from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
import yaml

from tests.core.recipes.block_creation_values import (
    HTTP_CREATION_VALUES,
    SSH_OPEN_CREATION_VALUES,
)
from tests.core.recipes.conftest import (
    LOG_STEP,
    create_library_function,
    create_profile,
    find_finding,
    make_recipe,
)
from tests.plugins._stub_plugin import register_stub_plugin

FORBIDDEN_NODE_KEYS = ("height", "measured", "selected", "dragging")


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


def edges(result: dict[str, Any]) -> list[dict[str, Any]]:
    return result["test_data"]["workflow"]["edges"]


def two_block_recipe() -> str:
    return make_recipe(
        [
            {
                "block": "http-client",
                "label": "Fetch home",
                "settings": {
                    "url": "{{ base_url }}/home",
                    "method": "GET",
                    "timeout": {"expr": "1 + 2"},
                },
                "capture": {"status_code": "home_status"},
            },
            LOG_STEP,
        ],
        name="Blocks Under Test",
        variables={"base_url": {"type": "string", "value": "http://shop.local"}},
    )


class TestPluginNodeEmission:
    def test_test_data_carries_the_test_identity(self) -> None:
        text = make_recipe(
            [LOG_STEP],
            name="Identity Test",
            description="What it does",
            tags=["smoke", "checkout"],
        )
        result = compile_clean(text)
        data = result["test_data"]
        assert data["name"] == "Identity Test"
        assert data["description"] == "What it does"
        assert data["metadata"]["tags"] == ["smoke", "checkout"]

    def test_node_identity_comes_from_the_live_registry(self) -> None:
        result = compile_clean(two_block_recipe())
        node = nodes_by_id(result)["node-1"]
        assert node["type"] == "workflowNode"
        data = node["data"]
        assert data["label"] == "Fetch home"
        assert data["elementType"] == "http-client"
        assert data["nodeType"] == "plugin"
        assert "category" not in data
        assert data["version"] == "1.0.0"

    def test_settings_land_in_config_values_verbatim(self) -> None:
        result = compile_clean(two_block_recipe())
        values = nodes_by_id(result)["node-1"]["data"]["config"]["values"]
        assert values == {
            **HTTP_CREATION_VALUES,
            "url": "{{ base_url }}/home",
            "method": "GET",
            "timeout": "1 + 2",
        }

    def test_a_choice_yaml_reads_as_false_is_stored_as_its_word(self) -> None:
        step = {
            "block": "http-client",
            "settings": {"url": "http://shop.local", "method": "GET", "proxy_mode": "off"},
        }
        recipe = make_recipe([step]).replace("'off'", "off")
        assert "proxy_mode: off\n" in recipe
        values = nodes_by_id(compile_clean(recipe))["node-1"]["data"]["config"]["values"]
        assert values["proxy_mode"] == "off"

    def test_expression_settings_are_marked_as_expression_fields(self) -> None:
        result = compile_clean(two_block_recipe())
        data = nodes_by_id(result)["node-1"]["data"]
        assert data["expressionFields"] == ["timeout"]

    def test_template_settings_are_detected_by_double_braces(self) -> None:
        result = compile_clean(two_block_recipe())
        data = nodes_by_id(result)["node-1"]["data"]
        assert data["templateFields"] == ["url"]

    def test_plain_string_settings_are_neither_template_nor_expression(self) -> None:
        result = compile_clean(two_block_recipe())
        data = nodes_by_id(result)["node-2"]["data"]
        assert data["expressionFields"] == []
        assert data["templateFields"] == []

    def test_capture_lands_in_output_bindings(self) -> None:
        result = compile_clean(two_block_recipe())
        config = nodes_by_id(result)["node-1"]["data"]["config"]
        assert config["outputBindings"] == {"status_code": "home_status"}

    def test_label_defaults_to_the_registry_display_name(self) -> None:
        result = compile_clean(two_block_recipe())
        assert nodes_by_id(result)["node-2"]["data"]["label"] == "Log"

    def test_geometry_residue_is_never_emitted(self) -> None:
        result = compile_clean(two_block_recipe())
        for node in result["test_data"]["workflow"]["nodes"]:
            for key in FORBIDDEN_NODE_KEYS:
                assert key not in node, f"{key} must not be emitted on {node['id']}"

    def test_every_node_gets_a_layout_position(self) -> None:
        result = compile_clean(two_block_recipe())
        for node in result["test_data"]["workflow"]["nodes"]:
            position = node["position"]
            assert isinstance(position["x"], int | float)
            assert isinstance(position["y"], int | float)


class TestControlNodeEmission:
    def test_uniform_block_form_works_for_controls(self) -> None:
        text = make_recipe([{"block": "delay", "settings": {"duration": 500}}])
        result = compile_clean(text)
        data = nodes_by_id(result)["node-1"]["data"]
        assert data["elementType"] == "delay"
        assert data["nodeType"] == "control"
        assert "category" not in data
        assert data["version"] == "1.0.0"
        assert data["config"]["values"] == {"duration": 500}


def k8s_get_recipe(**settings: Any) -> str:
    values: dict[str, Any] = {"session": "kubeconfig", "kind": "Pod", "name": "web-1"}
    values.update(settings)
    step = {"block": "k8s-get", "settings": values, "capture": {"result": "pods"}}
    return make_recipe([step])


def declared_variable(result: dict[str, Any], name: str) -> dict[str, Any]:
    variable = result["test_data"]["variables"][name]
    assert isinstance(variable, dict)
    return variable


def shell_script_capture_recipe(
    capture: dict[str, str], variables: dict[str, Any] | None = None
) -> str:
    step = {
        "block": "shell-script",
        "settings": {"script": "COUNT=2", "script_variables": ["COUNT"]},
        "capture": capture,
    }
    return make_recipe([step], variables=variables)


class TestCaptureTypeFollowsSettings:
    """A capture target is declared at the output's resolved type (K8SREAD-6)."""

    def test_table_format_declares_a_table_variable(self) -> None:
        result = compile_clean(k8s_get_recipe(output_format="table"))
        assert declared_variable(result, "pods") == {"type": "table"}

    def test_json_format_declares_a_string_variable(self) -> None:
        result = compile_clean(k8s_get_recipe(output_format="json"))
        assert declared_variable(result, "pods") == {"type": "string"}

    def test_a_list_read_declares_an_array_variable(self) -> None:
        result = compile_clean(k8s_get_recipe(search_by="list"))
        assert declared_variable(result, "pods") == {"type": "array"}

    def test_events_declares_an_array_variable_with_no_settings(self) -> None:
        step = {
            "block": "k8s-events",
            "settings": {"session": "kubeconfig"},
            "capture": {"result": "events"},
        }
        result = compile_clean(make_recipe([step]))
        assert declared_variable(result, "events") == {"type": "array"}

    def test_a_control_capture_keeps_its_declared_type(self) -> None:
        step = {
            "wait_until": {
                "that": ["pod_phase == 'Running'"],
                "timeout": 1,
                "capture": {"passed": "ready", "elapsed": "waited"},
            }
        }
        result = compile_clean(
            make_recipe([step], variables={"pod_phase": {"type": "string", "value": ""}})
        )
        assert declared_variable(result, "ready") == {"type": "boolean"}
        assert declared_variable(result, "waited") == {"type": "integer"}

    def test_an_undeclared_script_variable_target_is_declared_string(self) -> None:
        result = compile_clean(shell_script_capture_recipe({"COUNT": "script_count"}))
        assert declared_variable(result, "script_count") == {"type": "string"}

    def test_a_declared_script_variable_target_keeps_its_type(self) -> None:
        recipe = shell_script_capture_recipe(
            {"COUNT": "pod_count"}, {"pod_count": {"type": "integer"}}
        )
        result = compile_clean(recipe)
        assert declared_variable(result, "pod_count") == {"type": "integer"}

    def test_a_script_variable_binding_is_carried_verbatim(self) -> None:
        recipe = shell_script_capture_recipe(
            {"COUNT": "pod_count"}, {"pod_count": {"type": "integer"}}
        )
        config = nodes_by_id(compile_clean(recipe))["node-1"]["data"]["config"]
        assert config["outputBindings"] == {"COUNT": "pod_count"}

    def test_a_capture_target_inside_a_local_function_holds_null(self) -> None:
        functions = [
            {
                "name": "probe",
                "inputs": [],
                "outputs": [],
                "flow": [
                    {
                        "block": "http-client",
                        "settings": {"url": "http://x", "method": "GET"},
                        "capture": {"status_code": "inner_status"},
                    },
                    {
                        "wait_until": {
                            "that": ["inner_status == 200"],
                            "timeout": 1,
                            "capture": {"passed": "inner_ready"},
                        }
                    },
                ],
            }
        ]
        flow = [{"function": "probe"}]
        result = compile_clean(make_recipe(flow, functions=functions))
        definition = nodes_by_id(result)["node-1"]["data"]["localDefinition"]
        assert definition["variables"] == [
            {"id": "var-inner_status", "name": "inner_status", "type": "integer"},
            {"id": "var-inner_ready", "name": "inner_ready", "type": "boolean"},
        ]


class TestNestedExpressionEmission:
    """A per-entry expression compiles as an expression, tracked by its dotted key
    (SHRUN-4, REQ-3.4.1.1)."""

    def test_a_map_entry_expression_is_stored_and_marked(self) -> None:
        step = {
            "block": "shell-script",
            "settings": {"script": "echo hi", "input_vars": {"REPLICAS": {"expr": "replicas"}}},
        }
        result = compile_clean(
            make_recipe([step], variables={"replicas": {"type": "integer", "value": 3}})
        )
        data = nodes_by_id(result)["node-1"]["data"]
        assert data["config"]["values"]["input_vars"] == {"REPLICAS": "replicas"}
        assert data["expressionFields"] == ["input_vars.REPLICAS"]

    def test_a_row_field_expression_is_stored_and_marked(self) -> None:
        step = {
            "block": "shell-script",
            "settings": {
                "script": "echo hi",
                "arguments": [{"value": "--env"}, {"value": {"expr": "env_name"}}],
            },
        }
        result = compile_clean(
            make_recipe([step], variables={"env_name": {"type": "string", "value": "staging"}})
        )
        data = nodes_by_id(result)["node-1"]["data"]
        assert data["config"]["values"]["arguments"] == [{"value": "--env"}, {"value": "env_name"}]
        assert data["expressionFields"] == ["arguments.1.value"]

    def test_a_part_field_expression_is_stored_and_marked(self) -> None:
        step = {
            "block": "http-client",
            "settings": {
                "url": "http://x",
                "method": "POST",
                "parts": [{"kind": "text", "name": "comment", "value": {"expr": "note"}}],
            },
        }
        result = compile_clean(
            make_recipe([step], variables={"note": {"type": "string", "value": "hi"}})
        )
        data = nodes_by_id(result)["node-1"]["data"]
        assert data["config"]["values"]["parts"] == [
            {"kind": "text", "name": "comment", "value": "note"}
        ]
        assert data["expressionFields"] == ["parts.0.value"]

    def test_a_whole_setting_expression_keeps_its_plain_name(self) -> None:
        step = {
            "block": "http-client",
            "settings": {
                "url": "http://x",
                "method": "POST",
                "timeout": {"expr": "1 + 2"},
                "parts": [{"kind": "text", "name": "comment", "value": {"expr": "note"}}],
            },
        }
        result = compile_clean(
            make_recipe([step], variables={"note": {"type": "string", "value": "hi"}})
        )
        data = nodes_by_id(result)["node-1"]["data"]
        assert data["config"]["values"]["timeout"] == "1 + 2"
        assert sorted(data["expressionFields"]) == ["parts.0.value", "timeout"]


class TestTypedSettingEmission:
    """A typed map setting stores its literal entries element-typed (REQ-3.1.3.19)."""

    def test_driver_options_entries_carry_their_element_types(self) -> None:
        step = {
            "block": "sql-client",
            "settings": {
                "host": "db",
                "database": "wave",
                "username": "wave",
                "sql": "SELECT 1",
                "driver_options": {
                    "timeout": 16,
                    "app": "2024",
                    "ratio": "2.5",
                    "startup": {"search_path": "x"},
                    "name": {"expr": "'wave-' + 'e2e'"},
                },
            },
            "element_types": {"driver_options": {"ratio": "float"}},
        }
        data = nodes_by_id(compile_clean(make_recipe([step])))["node-1"]["data"]
        assert data["config"]["values"]["driver_options"] == {
            "timeout": "16",
            "app": "2024",
            "ratio": "2.5",
            "startup": '{"search_path": "x"}',
            "name": "'wave-' + 'e2e'",
        }
        assert data["expressionFields"] == ["driver_options.name"]
        assert data["elementTypes"] == {
            "driver_options": {
                "timeout": "integer",
                "app": "string",
                "ratio": "float",
                "startup": "map",
            }
        }

    def test_a_text_only_map_setting_carries_no_element_types(self) -> None:
        step = {
            "block": "http-client",
            "settings": {"url": "http://x", "method": "GET", "headers": {"x-port": 8080}},
        }
        data = nodes_by_id(compile_clean(make_recipe([step])))["node-1"]["data"]
        assert data["config"]["values"]["headers"] == {"x-port": 8080}
        assert "elementTypes" not in data


OPENSEARCH_VARIABLES: dict[str, Any] = {
    "cluster_url": {"type": "string", "value": "https://opensearch.internal:9200"},
    "service": {"type": "string", "value": "checkout"},
    "level_field": {"type": "string", "value": "log.level"},
    "slow_stat": {"type": "map", "value": {"stat": "max", "field": "latency_ms"}},
}
OPENSEARCH_FIELDS = [{"value": "@timestamp"}, {"value": {"expr": "level_field"}}]
OPENSEARCH_STATS = [
    {"value": {"stat": "count"}},
    {"value": {"stat": "percentile", "field": "latency_ms", "percent": 95}},
    {"value": {"stat": "custom", "json": '{"max": {"field": "bytes"}}', "name": "peak"}},
    {"value": {"expr": "slow_stat"}},
]


def opensearch_step(**settings: Any) -> dict[str, Any]:
    values: dict[str, Any] = {"url": {"expr": "cluster_url"}, "index": "app-logs-*"}
    values.update(settings)
    return {"block": "opensearch", "settings": values}


class TestOpensearchBlockEmission:
    """Fields and Stats rows compile as rows, each row's expression tracked by its dotted key
    (REQ-3.4.1.15, OS-6, OS-7)."""

    def _data(self, step: dict[str, Any]) -> dict[str, Any]:
        result = compile_clean(make_recipe([step], variables=OPENSEARCH_VARIABLES))
        data: dict[str, Any] = nodes_by_id(result)["node-1"]["data"]
        return data

    def test_the_node_is_the_implemented_block(self) -> None:
        data = self._data(opensearch_step())

        assert (data["elementType"], data["nodeType"], data["version"]) == (
            "opensearch",
            "plugin",
            "1.0.0",
        )
        assert data["label"] == "OpenSearch"

    def test_fields_rows_are_stored_with_their_row_expression_marked(self) -> None:
        data = self._data(opensearch_step(mode="search", fields=OPENSEARCH_FIELDS))

        assert data["config"]["values"]["fields"] == [
            {"value": "@timestamp"},
            {"value": "level_field"},
        ]
        assert sorted(data["expressionFields"]) == ["fields.1.value", "url"]

    def test_stats_rows_are_stored_with_their_row_expression_marked(self) -> None:
        data = self._data(opensearch_step(mode="aggregate", stats=OPENSEARCH_STATS))

        assert data["config"]["values"]["stats"] == [
            {"value": {"stat": "count"}},
            {"value": {"stat": "percentile", "field": "latency_ms", "percent": 95}},
            {"value": {"stat": "custom", "json": '{"max": {"field": "bytes"}}', "name": "peak"}},
            {"value": "slow_stat"},
        ]
        assert sorted(data["expressionFields"]) == ["stats.3.value", "url"]

    def test_a_query_with_markers_is_a_template_field(self) -> None:
        data = self._data(opensearch_step(query="service: {{ service }}"))

        assert data["config"]["values"]["query"] == "service: {{ service }}"
        assert data["templateFields"] == ["query"]

    def test_the_compile_raises_no_stub_warning(self) -> None:
        result = compile_recipe(make_recipe([opensearch_step()], variables=OPENSEARCH_VARIABLES))

        assert [f for f in result["findings"] if f["code"] == "STUB_BLOCK"] == []


class TestSqlScriptExpressionEmission:
    """A SQL script given by an expression compiles as a whole-setting expression (SQL-10)."""

    def test_the_script_expression_is_stored_and_marked(self) -> None:
        step = {
            "block": "sql-client",
            "settings": {
                "host": "db",
                "database": "wave",
                "username": "wave",
                "sql": {"expr": "order_query"},
                "parameters": {"min_qty": {"expr": "threshold"}},
            },
        }
        variables = {
            "order_query": {
                "type": "string",
                "value": "SELECT id FROM orders WHERE qty >= :min_qty",
            },
            "threshold": {"type": "integer", "value": 7},
        }

        data = nodes_by_id(compile_clean(make_recipe([step], variables=variables)))["node-1"][
            "data"
        ]

        assert data["config"]["values"]["sql"] == "order_query"
        assert data["config"]["values"]["parameters"] == {"min_qty": "threshold"}
        assert sorted(data["expressionFields"]) == ["parameters.min_qty", "sql"]
        assert data["templateFields"] == []


class TestDeterministicIds:
    def test_node_ids_are_sequential_in_document_order(self) -> None:
        result = compile_clean(two_block_recipe())
        ids = [node["id"] for node in result["test_data"]["workflow"]["nodes"]]
        assert ids == ["node-1", "node-2"]

    def test_same_recipe_compiles_identically_twice(self) -> None:
        first = compile_recipe(two_block_recipe())
        second = compile_recipe(two_block_recipe())
        assert first["test_data"] == second["test_data"]
        assert first["step_map"] == second["step_map"]


class TestWiring:
    def test_flow_chains_from_the_implicit_start_node(self) -> None:
        result = compile_clean(two_block_recipe())
        edge_list = edges(result)
        assert edge_list[0]["source"] == "start-node"
        assert edge_list[0]["target"] == "node-1"
        node_ids = {node["id"] for node in result["test_data"]["workflow"]["nodes"]}
        assert "start-node" not in node_ids

    def test_sequential_steps_chain_in_order(self) -> None:
        result = compile_clean(two_block_recipe())
        pairs = [(edge["source"], edge["target"]) for edge in edges(result)]
        assert pairs == [("start-node", "node-1"), ("node-1", "node-2")]

    def test_edge_ids_follow_the_canvas_convention(self) -> None:
        result = compile_clean(two_block_recipe())
        ids = [edge["id"] for edge in edges(result)]
        assert ids == ["edge-start-node-node-1", "edge-node-1-node-2"]

    def test_plain_sequential_edges_have_no_handles(self) -> None:
        result = compile_clean(two_block_recipe())
        for edge in edges(result):
            assert edge.get("sourceHandle") is None
            assert edge.get("targetHandle") is None


class TestStepMap:
    def test_step_map_covers_every_flow_node(self) -> None:
        result = compile_clean(two_block_recipe())
        assert result["step_map"]["node-1"] == "flow[0]"
        assert result["step_map"]["node-2"] == "flow[1]"


class TestProfileBindings:
    def test_profile_binding_resolves_the_profile_by_name(self) -> None:
        profile = create_profile("staging-creds")
        step = {
            "block": "http-client",
            "settings": {"url": "http://x", "method": "GET"},
            "profiles": [
                {
                    "profile": "staging-creds",
                    "alias": "cred",
                    "fields": ["username", "password"],
                }
            ],
        }
        result = compile_clean(make_recipe([step]))
        bindings = nodes_by_id(result)["node-1"]["data"]["config"]["profileBindings"]
        assert len(bindings) == 1
        binding = bindings[0]
        assert binding["profileId"] == profile["id"]
        assert binding["profileName"] == "staging-creds"
        assert binding["profileType"] == "custom"
        assert binding["alias"] == "cred"
        assert binding["fields"] == ["username", "password"]

    def test_block_without_profiles_gets_an_empty_binding_list(self) -> None:
        result = compile_clean(two_block_recipe())
        config = nodes_by_id(result)["node-1"]["data"]["config"]
        assert config.get("profileBindings", []) == []


class TestErrorGating:
    def test_any_error_finding_suppresses_test_data(self) -> None:
        result = compile_recipe(make_recipe([{"block": "no-such-block"}]))
        find_finding(result["findings"], "UNKNOWN_BLOCK")
        assert result["test_data"] is None

    def test_stub_warning_still_compiles(self) -> None:
        stub_id = register_stub_plugin()
        result = compile_recipe(make_recipe([{"block": stub_id}]))
        finding = find_finding(result["findings"], "STUB_BLOCK")
        assert finding["severity"] == "warning"
        assert result["test_data"] is not None
        node = result["test_data"]["workflow"]["nodes"][0]
        assert node["data"]["elementType"] == stub_id

    def test_parse_failure_yields_findings_and_no_test_data(self) -> None:
        result = compile_recipe("test: [unclosed\n")
        find_finding(result["findings"], "RECIPE_PARSE_ERROR")
        assert result["test_data"] is None


class TestNodeWidth:
    """A recipe-built block is sized to fit its name within the canvas resize bounds."""

    def _width_of(self, label: str) -> int:
        step = {"block": "log", "label": label, "settings": {"message": "hello"}}
        return nodes_by_id(compile_clean(make_recipe([step])))["node-1"]["width"]

    def test_a_short_name_sits_at_the_160_minimum(self) -> None:
        assert self._width_of("Log") == 160

    def test_a_ten_character_name_still_fits_the_minimum(self) -> None:
        assert self._width_of("Fetch home") == 160

    def test_a_long_name_widens_the_block_to_fit(self) -> None:
        assert self._width_of("Write push file on sshd host") == 338

    def test_a_very_long_name_clamps_at_the_360_maximum(self) -> None:
        assert self._width_of("Get a namespace that does not exist") == 360

    def test_every_element_node_carries_an_integer_width(self) -> None:
        result = compile_clean(two_block_recipe())
        for node in result["test_data"]["workflow"]["nodes"]:
            assert type(node["width"]) is int, f"{node['id']} width must be an int"

    def test_a_note_carries_no_width(self) -> None:
        flow = [LOG_STEP, {"note": {"text": "Reviewed by QA", "color": "yellow"}}]
        result = compile_clean(make_recipe(flow))
        note = next(n for n in result["test_data"]["workflow"]["nodes"] if n["type"] == "noteNode")
        assert "width" not in note


def testdata_recipe(reference: str = "testdata://examples/customers.csv") -> str:
    return make_recipe(
        [{"block": "excel-parser", "settings": {"operation": "read", "workbook": reference}}]
    )


def testdata_codes(result: dict[str, Any]) -> list[str]:
    return [item["code"] for item in result["findings"] if item["code"] == "TESTDATA_NOT_FOUND"]


class TestTestdataDirsForwarding:
    """compile_recipe hands its test data roots to stage-1 validation."""

    def test_a_root_that_holds_the_file_silences_the_warning(self, tmp_path: Path) -> None:
        (tmp_path / "examples").mkdir()
        (tmp_path / "examples" / "customers.csv").write_text("id\n", encoding="utf-8")
        from wavecore.core.recipes.compiler import compile_recipe as compile_fn

        result = compile_fn(testdata_recipe(), testdata_dirs=[str(tmp_path)])

        assert testdata_codes(result) == []

    def test_a_root_without_the_file_warns(self, tmp_path: Path) -> None:
        from wavecore.core.recipes.compiler import compile_recipe as compile_fn

        result = compile_fn(testdata_recipe(), testdata_dirs=[str(tmp_path)])

        assert testdata_codes(result) == ["TESTDATA_NOT_FOUND"]

    def test_the_default_behaves_as_no_roots(self) -> None:
        from wavecore.core.recipes.compiler import compile_recipe as compile_fn

        assert testdata_codes(compile_fn(testdata_recipe())) == ["TESTDATA_NOT_FOUND"]
        assert testdata_codes(compile_fn(testdata_recipe(), testdata_dirs=None)) == [
            "TESTDATA_NOT_FOUND"
        ]

    def test_the_roots_are_keyword_only(self, tmp_path: Path) -> None:
        from wavecore.core.recipes.compiler import compile_recipe as compile_fn

        with pytest.raises(TypeError):
            compile_fn(testdata_recipe(), [str(tmp_path)])


STRICT_DEFAULT: dict[str, dict[str, Any]] = {
    "ssh-session-open": {"host_key_verification": "strict"}
}


def ssh_open_step(**settings: Any) -> dict[str, Any]:
    return {
        "block": "ssh-session-open",
        "settings": {"host": "node-1", "username": "wave", "password": "pw", **settings},
    }


def compile_placed(text: str, **kwargs: Any) -> dict[str, Any]:
    from wavecore.core.recipes.compiler import compile_recipe as compile_fn

    result = compile_fn(text, **kwargs)
    errors = [f for f in result["findings"] if f["severity"] == "error"]
    assert errors == [], f"expected a clean compile, got {errors!r}"
    assert result["test_data"] is not None
    return result


def node_values(result: dict[str, Any], node_id: str) -> dict[str, Any]:
    values: dict[str, Any] = nodes_by_id(result)[node_id]["data"]["config"]["values"]
    return values


class TestPlacementDefaults:
    """A recipe step that omits a setting gets the placement default (REQ-4.5.14)."""

    def test_an_ssh_open_step_that_omits_the_policy_gets_the_default(self) -> None:
        result = compile_placed(make_recipe([ssh_open_step()]), placement_defaults=STRICT_DEFAULT)

        assert node_values(result, "node-1")["host_key_verification"] == "strict"

    def test_the_stamped_value_is_a_plain_value(self) -> None:
        result = compile_placed(make_recipe([ssh_open_step()]), placement_defaults=STRICT_DEFAULT)

        data = nodes_by_id(result)["node-1"]["data"]
        assert data["expressionFields"] == []
        assert data["templateFields"] == []

    @pytest.mark.parametrize(
        ("value", "default"),
        [("accept-new", "strict"), ("disabled", "strict"), ("strict", "disabled")],
    )
    def test_a_step_that_sets_the_policy_keeps_its_value(self, value: str, default: str) -> None:
        result = compile_placed(
            make_recipe([ssh_open_step(host_key_verification=value)]),
            placement_defaults={"ssh-session-open": {"host_key_verification": default}},
        )

        assert node_values(result, "node-1")["host_key_verification"] == value

    def test_a_step_that_sets_the_policy_by_expression_keeps_it(self) -> None:
        recipe = make_recipe(
            [ssh_open_step(host_key_verification={"expr": "policy"})],
            variables={"policy": {"type": "string", "value": "accept-new"}},
        )

        result = compile_placed(recipe, placement_defaults=STRICT_DEFAULT)

        data = nodes_by_id(result)["node-1"]["data"]
        assert data["config"]["values"]["host_key_verification"] == "policy"
        assert data["expressionFields"] == ["host_key_verification"]

    def test_without_placement_defaults_the_block_holds_its_declared_default(self) -> None:
        result = compile_placed(make_recipe([ssh_open_step()]))

        assert node_values(result, "node-1")["host_key_verification"] == "disabled"

    @pytest.mark.parametrize("defaults", [None, {}], ids=["none", "empty"])
    def test_no_defaults_given_writes_the_declared_default(self, defaults: Any) -> None:
        result = compile_placed(make_recipe([ssh_open_step()]), placement_defaults=defaults)

        assert node_values(result, "node-1")["host_key_verification"] == "disabled"

    def test_the_stamp_sits_on_top_of_every_other_creation_value(self) -> None:
        result = compile_placed(make_recipe([ssh_open_step()]), placement_defaults=STRICT_DEFAULT)

        assert node_values(result, "node-1") == {
            "host": "node-1",
            "username": "wave",
            "password": "pw",
            **SSH_OPEN_CREATION_VALUES,
            "host_key_verification": "strict",
        }

    def test_other_block_types_are_untouched(self) -> None:
        exec_step = {
            "block": "ssh-session-exec",
            "settings": {"session_id": "{{ sid }}", "command": "uptime"},
        }
        recipe = make_recipe(
            [ssh_open_step(), exec_step, LOG_STEP],
            variables={"sid": {"type": "string", "value": ""}},
        )
        plain = compile_placed(recipe)

        result = compile_placed(recipe, placement_defaults=STRICT_DEFAULT)

        assert node_values(result, "node-2") == node_values(plain, "node-2")
        assert node_values(result, "node-3") == node_values(plain, "node-3")
        assert "host_key_verification" not in node_values(result, "node-2")

    def test_every_ssh_open_step_is_stamped_including_nested_ones(self) -> None:
        recipe = make_recipe(
            [
                ssh_open_step(),
                {"if": {"when": "x == 1", "then": [ssh_open_step(host="node-2")]}},
            ],
            variables={"x": {"type": "integer", "value": 1}},
        )

        result = compile_placed(recipe, placement_defaults=STRICT_DEFAULT)

        opens = [
            node
            for node in result["test_data"]["workflow"]["nodes"]
            if node["data"].get("elementType") == "ssh-session-open"
        ]
        assert len(opens) == 2
        assert [n["data"]["config"]["values"]["host_key_verification"] for n in opens] == [
            "strict",
            "strict",
        ]

    def test_the_readback_emits_the_stamped_value(self) -> None:
        from wavecore.core.recipes.decompiler import decompile_test_data

        result = compile_placed(make_recipe([ssh_open_step()]), placement_defaults=STRICT_DEFAULT)

        recipe = yaml.safe_load(decompile_test_data(result["test_data"])["recipe"])
        assert recipe["flow"][0]["settings"]["host_key_verification"] == "strict"

    def test_the_readback_recompiles_to_the_stored_value_under_another_default(self) -> None:
        from wavecore.core.recipes.decompiler import decompile_test_data

        first = compile_placed(make_recipe([ssh_open_step()]), placement_defaults=STRICT_DEFAULT)
        readback = decompile_test_data(first["test_data"])["recipe"]

        second = compile_placed(
            readback, placement_defaults={"ssh-session-open": {"host_key_verification": "disabled"}}
        )

        assert node_values(second, "node-1")["host_key_verification"] == "strict"


def settings_placement_defaults() -> dict[str, dict[str, Any]]:
    """The placement defaults every recipe entry point hands the compiler."""
    from wavecore.api.services.network import ssh_hosts

    return ssh_hosts.placement_defaults()


def save_default_block_action(action: str) -> None:
    """Save the SSH Hosts default block action the way a Settings Save stores it."""
    from wavecore.core.ssh import trusted_hosts

    trusted_hosts.save_policy({"lock_trusted_hosts": False, "default_block_action": action})


class TestTheSettingsDefaultIsStamped:
    """A step that omits the host key policy takes the SSH Hosts default (REQ-4.5.14)."""

    def test_a_step_without_the_setting_compiles_with_disabled_by_default(self) -> None:
        result = compile_placed(
            make_recipe([ssh_open_step()]), placement_defaults=settings_placement_defaults()
        )

        assert node_values(result, "node-1")["host_key_verification"] == "disabled"

    def test_it_compiles_with_strict_after_the_default_is_saved_as_strict(self) -> None:
        save_default_block_action("strict")

        result = compile_placed(
            make_recipe([ssh_open_step()]), placement_defaults=settings_placement_defaults()
        )

        assert node_values(result, "node-1")["host_key_verification"] == "strict"

    def test_a_default_set_in_the_config_file_is_stamped(
        self, load_config: Callable[..., Any]
    ) -> None:
        policy = {"lock_trusted_hosts": False, "default_block_action": "strict"}
        load_config({"network": {"ssh_hosts": policy}})

        result = compile_placed(
            make_recipe([ssh_open_step()]), placement_defaults=settings_placement_defaults()
        )

        assert node_values(result, "node-1")["host_key_verification"] == "strict"

    def test_the_readback_returns_the_stored_default(self) -> None:
        from wavecore.core.recipes.decompiler import decompile_test_data

        result = compile_placed(
            make_recipe([ssh_open_step()]), placement_defaults=settings_placement_defaults()
        )

        recipe = yaml.safe_load(decompile_test_data(result["test_data"])["recipe"])
        assert recipe["flow"][0]["settings"]["host_key_verification"] == "disabled"

    def test_the_readback_keeps_the_stored_value_after_the_default_is_saved_as_strict(
        self,
    ) -> None:
        from wavecore.core.recipes.decompiler import decompile_test_data

        first = compile_placed(
            make_recipe([ssh_open_step()]), placement_defaults=settings_placement_defaults()
        )
        readback = decompile_test_data(first["test_data"])["recipe"]
        save_default_block_action("strict")

        second = compile_placed(readback, placement_defaults=settings_placement_defaults())

        assert node_values(second, "node-1")["host_key_verification"] == "disabled"


CHOICE_PARAMETERS: dict[str, dict[str, Any]] = {
    "method": {
        "name": "method",
        "type": "string",
        "required": True,
        "enum_values": ["GET", "POST"],
        "default": "GET",
    },
    "retries": {"name": "retries", "type": "integer", "enum_values": [1, 2, 3], "default": 2},
    "ratio": {"name": "ratio", "type": "float", "enum_values": [0.5, 2.5], "default": 2.5},
    "verify": {"name": "verify", "type": "boolean", "default": True},
    "compress": {"name": "compress", "type": "boolean", "default": False},
    "timeout": {"name": "timeout", "type": "integer", "default": 30},
    "label": {"name": "label", "type": "string", "default": "probe"},
    "url": {"name": "url", "type": "string", "required": True},
}
CHOICE_DEFAULTS: dict[str, Any] = {
    "method": "GET",
    "retries": 2,
    "ratio": 2.5,
    "verify": True,
    "compress": False,
}


def creation_of(
    parameters: dict[str, dict[str, Any]],
    placement: dict[str, Any] | None = None,
    **values: Any,
) -> dict[str, Any]:
    from wavecore.core.recipes.compiler import creation_values

    result: dict[str, Any] = creation_values(parameters, placement or {}, values=values)
    return result


def catalog_parameters(block_id: str) -> dict[str, dict[str, Any]]:
    from wavecore.core.recipes.validator import load_block_catalog

    return load_block_catalog()[block_id].parameters


def is_choice_field(param: dict[str, Any]) -> bool:
    return bool(param.get("enum_values")) or param.get("type") == "boolean"


class TestCreationValues:
    """A new Block holds a value for every choice list and true / false field (FIELD-8,
    REQ-3.1.1.5, REQ-3.4.2.2)."""

    def test_every_choice_list_and_true_false_default_is_written(self) -> None:
        assert creation_of(CHOICE_PARAMETERS) == CHOICE_DEFAULTS

    def test_a_free_entry_field_is_never_written(self) -> None:
        written = creation_of(CHOICE_PARAMETERS)

        assert [name for name in ("timeout", "label", "url") if name in written] == []

    def test_a_typed_choice_value_keeps_its_type(self) -> None:
        written = creation_of(CHOICE_PARAMETERS)

        assert (type(written["retries"]), type(written["ratio"])) == (int, float)

    def test_a_false_default_is_written(self) -> None:
        assert creation_of(CHOICE_PARAMETERS)["compress"] is False

    def test_the_placement_stamp_sits_on_top_of_the_default(self) -> None:
        written = creation_of(CHOICE_PARAMETERS, {"method": "POST"})

        assert written == {**CHOICE_DEFAULTS, "method": "POST"}

    def test_a_value_the_step_sets_wins(self) -> None:
        written = creation_of(CHOICE_PARAMETERS, {"method": "POST"}, method="GET", verify=False)

        assert written == {**CHOICE_DEFAULTS, "method": "GET", "verify": False}

    def test_the_step_values_are_kept_beside_the_creation_values(self) -> None:
        written = creation_of(CHOICE_PARAMETERS, url="http://x", timeout=5)

        assert written == {**CHOICE_DEFAULTS, "url": "http://x", "timeout": 5}

    def test_the_step_values_are_keyword_only(self) -> None:
        from wavecore.core.recipes.compiler import creation_values

        with pytest.raises(TypeError):
            creation_values(CHOICE_PARAMETERS, {}, {})

    def test_the_ssh_stamp_sits_on_top_of_the_declared_default(self) -> None:
        written = creation_of(
            catalog_parameters("ssh-session-open"), {"host_key_verification": "strict"}
        )

        assert written == {**SSH_OPEN_CREATION_VALUES, "host_key_verification": "strict"}

    def test_every_catalog_block_holds_every_choice_list_and_true_false_field(self) -> None:
        from wavecore.core.recipes.validator import load_block_catalog

        differing: dict[str, tuple[dict[str, Any], dict[str, Any]]] = {}
        for block_id, entry in load_block_catalog().items():
            expected = {
                name: param.get("default")
                for name, param in entry.parameters.items()
                # The For Each collection row's stored type, not a choice made at creation.
                if is_choice_field(param) and (block_id, name) != ("for-each", "collection_type")
            }
            if block_id == "sql-client":
                expected["tls"] = False
            written = creation_of(entry.parameters)
            if written != expected:
                differing[block_id] = (written, expected)

        assert differing == {}


SQL_CONNECTION: dict[str, Any] = {
    "host": "db",
    "database": "wave",
    "username": "wave",
    "sql": "SELECT 1",
}


class TestSqlTlsCreationValue:
    """SQL `tls` has no fixed default: a new Block holds the database type's own
    (FIELD-8, REQ-3.4.2.2)."""

    @pytest.mark.parametrize(
        ("database_type", "tls"),
        [
            ("postgresql", False),
            ("mysql", False),
            ("oracle", False),
            ("mssql", True),
            ("sqlite", False),
        ],
    )
    def test_each_database_type_writes_its_own_tls_default(
        self, database_type: str, tls: bool
    ) -> None:
        written = creation_of(catalog_parameters("sql-client"), database_type=database_type)

        assert written["tls"] is tls

    def test_without_a_database_type_the_default_type_decides(self) -> None:
        written = creation_of(catalog_parameters("sql-client"))

        assert (written["database_type"], written["tls"]) == ("postgresql", False)

    def test_a_tls_the_step_sets_wins(self) -> None:
        written = creation_of(catalog_parameters("sql-client"), database_type="mssql", tls=False)

        assert written["tls"] is False

    def test_a_compiled_sql_server_block_holds_tls_on(self) -> None:
        step = {"block": "sql-client", "settings": {**SQL_CONNECTION, "database_type": "mssql"}}

        values = node_values(compile_clean(make_recipe([step])), "node-1")

        assert values["tls"] is True

    def test_a_compiled_block_without_a_database_type_holds_tls_off(self) -> None:
        step = {"block": "sql-client", "settings": dict(SQL_CONNECTION)}

        values = node_values(compile_clean(make_recipe([step])), "node-1")

        assert (values["database_type"], values["tls"]) == ("postgresql", False)


class TestCompiledBlockHoldsItsCreationValues:
    """A compiled Block holds every choice-list and true / false value, shown or hidden;
    a free-entry setting left out stays unset (FIELD-2, FIELD-8, REQ-5.2.7.3)."""

    def test_a_step_that_leaves_every_choice_out_holds_each_default(self) -> None:
        step = {"block": "http-client", "settings": {"url": "http://shop.local"}}

        data = nodes_by_id(compile_clean(make_recipe([step])))["node-1"]["data"]

        assert data["config"]["values"] == {**HTTP_CREATION_VALUES, "url": "http://shop.local"}
        assert (data["expressionFields"], data["templateFields"]) == ([], [])

    def test_a_choice_given_by_expression_stays_an_expression(self) -> None:
        step = {"block": "http-client", "settings": {"url": "http://x", "method": {"expr": "verb"}}}
        recipe = make_recipe([step], variables={"verb": {"type": "string", "value": "POST"}})

        data = nodes_by_id(compile_clean(recipe))["node-1"]["data"]

        assert data["config"]["values"] == {
            **HTTP_CREATION_VALUES,
            "url": "http://x",
            "method": "verb",
        }
        assert data["expressionFields"] == ["method"]

    def test_a_control_block_step_holds_its_creation_values(self) -> None:
        step = {"block": "halt", "settings": {"message": "stop"}}

        values = node_values(compile_clean(make_recipe([step])), "node-1")

        assert values == {"scope": "test", "status": "failed", "message": "stop"}

    def test_a_block_inside_a_function_flow_holds_its_creation_values(self) -> None:
        functions = [
            {
                "name": "probe",
                "inputs": [],
                "outputs": [],
                "flow": [{"block": "http-client", "settings": {"url": "http://x"}}],
            }
        ]
        result = compile_clean(make_recipe([{"function": "probe"}], functions=functions))

        definition = nodes_by_id(result)["node-1"]["data"]["localDefinition"]
        (inner,) = definition["workflow"]["nodes"]
        assert inner["data"]["config"]["values"] == {**HTTP_CREATION_VALUES, "url": "http://x"}


PROBE_INPUTS: list[dict[str, Any]] = [
    {
        "name": "level",
        "type": "string",
        "required": True,
        "enumValues": ["low", "high"],
        "default": "low",
    },
    {"name": "retries", "type": "integer", "required": True, "enumValues": [1, 2], "default": 2},
    {"name": "strict", "type": "boolean", "required": True, "default": True},
    {"name": "verbose", "type": "boolean", "default": False},
    {"name": "note", "type": "string", "default": "hi"},
]
PROBE_CREATION_VALUES: dict[str, Any] = {
    "level": "low",
    "retries": 2,
    "strict": True,
    "verbose": False,
}


def probe_recipe(step: dict[str, Any], variables: dict[str, Any] | None = None) -> str:
    functions = [{"name": "probe", "inputs": PROBE_INPUTS, "outputs": [], "flow": [LOG_STEP]}]
    return make_recipe([step], functions=functions, variables=variables)


def function_block_data(result: dict[str, Any]) -> dict[str, Any]:
    data: dict[str, Any] = nodes_by_id(result)["node-1"]["data"]
    return data


class TestFunctionBlockCreationValues:
    """A Function step writes each choice-list and true / false input from the Function's
    default, Required included (VMGR-113, FNCFG-9, REQ-3.1.2.10)."""

    def test_a_step_that_sets_nothing_holds_each_choice_and_true_false_default(self) -> None:
        data = function_block_data(compile_clean(probe_recipe({"function": "probe"})))

        assert data["config"]["values"] == PROBE_CREATION_VALUES

    def test_a_typed_choice_input_keeps_its_type(self) -> None:
        data = function_block_data(compile_clean(probe_recipe({"function": "probe"})))

        assert type(data["config"]["values"]["retries"]) is int

    def test_a_value_the_step_sets_wins(self) -> None:
        step = {"function": "probe", "settings": {"level": "high", "verbose": True, "note": "x"}}

        data = function_block_data(compile_clean(probe_recipe(step)))

        assert data["config"]["values"] == {
            **PROBE_CREATION_VALUES,
            "level": "high",
            "verbose": True,
            "note": "x",
        }

    def test_an_input_given_by_expression_stays_an_expression(self) -> None:
        step = {"function": "probe", "settings": {"level": {"expr": "chosen"}}}
        variables = {"chosen": {"type": "string", "value": "high"}}

        data = function_block_data(compile_clean(probe_recipe(step, variables)))

        assert data["config"]["values"]["level"] == "chosen"
        assert data["expressionFields"] == ["level"]

    def test_the_block_carries_no_input_bindings(self) -> None:
        data = function_block_data(compile_clean(probe_recipe({"function": "probe"})))

        assert "inputBindings" not in data

    @pytest.mark.parametrize(("version", "level"), [("1.0.0", "low"), ("1.1.0", "high")])
    def test_a_library_function_block_writes_its_pinned_versions_default(
        self, version: str, level: str
    ) -> None:
        from wavecore.api.services.functions import service as function_service

        level_input = {**PROBE_INPUTS[0]}
        created = create_library_function("lib_probe", inputs=[level_input])
        function_service.add_function_version(
            str(created["id"]),
            source_version="1.0.0",
            target_version="1.1.0",
            draft_definition={
                "name": "lib_probe",
                "description": "",
                "tags": [],
                "inputs": [{**level_input, "default": "high"}],
                "outputs": [],
                "dependencies": {"functions": [], "plugins": []},
                "workflow": {"nodes": [], "edges": []},
            },
            changelog="Default high",
            description="",
            tags=[],
            details="",
        )

        step = {"function": "lib_probe", "version": version}
        data = function_block_data(compile_clean(make_recipe([step])))

        assert data["config"]["values"] == {"level": level}


def k8s_connect_step(**extra: Any) -> dict[str, Any]:
    return {
        "block": "k8s-connect",
        "settings": {"api_url": "https://k8s.local"},
        "capture": {"session": "kube", "cluster_version": "ver"},
        **extra,
    }


def block_config(result: dict[str, Any]) -> dict[str, Any]:
    config: dict[str, Any] = nodes_by_id(result)["node-1"]["data"]["config"]
    return config


class TestBlockSecretOutputs:
    """A block step marks its Secret outputs as the block's outputs table does (SECUI-3/4,
    K8SCON-4): an absent key keeps the schema's boxes, a given list is the whole choice."""

    def test_without_the_key_the_schema_secret_output_is_marked_and_nothing_is_stored(
        self,
    ) -> None:
        result = compile_clean(make_recipe([k8s_connect_step()]))
        assert "outputSecretFields" not in block_config(result)
        assert declared_variable(result, "kube") == {"type": "string", "secret": True}
        assert declared_variable(result, "ver") == {"type": "string"}

    def test_a_listed_choice_is_the_whole_choice(self) -> None:
        result = compile_clean(make_recipe([k8s_connect_step(secret_outputs=["cluster_version"])]))
        assert block_config(result)["outputSecretFields"] == ["cluster_version"]
        assert declared_variable(result, "kube") == {"type": "string"}
        assert declared_variable(result, "ver") == {"type": "string", "secret": True}

    def test_an_empty_list_marks_none(self) -> None:
        result = compile_clean(make_recipe([k8s_connect_step(secret_outputs=[])]))
        assert block_config(result)["outputSecretFields"] == []
        assert declared_variable(result, "kube") == {"type": "string"}

    def test_marked_outputs_are_stored_in_the_outputs_table_order(self) -> None:
        step = k8s_connect_step(secret_outputs=["cluster_version", "session"])
        result = compile_clean(make_recipe([step]))
        assert block_config(result)["outputSecretFields"] == ["session", "cluster_version"]

    def test_a_declared_script_variable_is_marked_after_the_schema_outputs(self) -> None:
        step = {
            "block": "shell-script",
            "settings": {"script": "TOKEN=x", "script_variables": ["COUNT", "TOKEN"]},
            "capture": {"TOKEN": "tok", "COUNT": "count"},
            "secret_outputs": ["TOKEN", "stdout"],
        }
        result = compile_clean(make_recipe([step]))
        assert block_config(result)["outputSecretFields"] == ["stdout", "TOKEN"]
        assert declared_variable(result, "tok") == {"type": "string", "secret": True}
        assert declared_variable(result, "count") == {"type": "string"}


class TestMarkedCaptureMakesADeclaredVariableSecret:
    """A marked capture into a variable the recipe declares plain makes it secret with a
    warning, as a block Save does after its warning (SECUI-12, REQ-3.1.2.9)."""

    def test_the_plain_variable_is_stored_secret_with_a_warning(self) -> None:
        variables = {"kube": {"type": "string"}}
        result = compile_clean(make_recipe([k8s_connect_step()], variables=variables))
        assert declared_variable(result, "kube") == {"type": "string", "secret": True}
        warning = find_finding(result["findings"], "VARIABLE_MADE_SECRET")
        assert warning == {
            "step": "flow[0].capture.session",
            "code": "VARIABLE_MADE_SECRET",
            "severity": "warning",
            "problem": (
                "Secret output 'session' makes the plain variable 'kube' a secret. "
                "Its value is masked from then on. Making it plain again clears its value"
            ),
            "fix": (
                "Declare 'kube' with secret: true, or give secret_outputs without 'session' "
                "to keep it plain"
            ),
        }

    def test_a_variable_declared_secret_gets_no_warning(self) -> None:
        variables = {"kube": {"type": "string", "secret": True}}
        result = compile_clean(make_recipe([k8s_connect_step()], variables=variables))
        assert declared_variable(result, "kube") == {"type": "string", "secret": True}
        assert result["findings"] == []

    def test_an_unmarked_capture_leaves_the_variable_plain(self) -> None:
        variables = {"kube": {"type": "string"}}
        recipe = make_recipe([k8s_connect_step(secret_outputs=[])], variables=variables)
        result = compile_clean(recipe)
        assert declared_variable(result, "kube") == {"type": "string"}
        assert result["findings"] == []

    def test_two_marked_captures_warn_once(self) -> None:
        variables = {"kube": {"type": "string"}}
        result = compile_clean(
            make_recipe([k8s_connect_step(), k8s_connect_step()], variables=variables)
        )
        made_secret = [f for f in result["findings"] if f["code"] == "VARIABLE_MADE_SECRET"]
        assert [f["step"] for f in made_secret] == ["flow[0].capture.session"]

    def test_a_declared_value_stays_with_the_promoted_variable(self) -> None:
        variables = {"kube": {"type": "string", "value": "placeholder"}}
        result = compile_clean(make_recipe([k8s_connect_step()], variables=variables))
        assert declared_variable(result, "kube") == {
            "type": "string",
            "value": "placeholder",
            "secret": True,
        }


def _filter_row(row_id: str, operator: str, reference: Any) -> dict[str, Any]:
    return {
        "id": row_id,
        "type": "literal",
        "variable": "_cell",
        "value_type": "string",
        "operator": operator,
        "reference_value": reference,
        "reference_is_expression": False,
    }


def _csv_step(filters: Any) -> dict[str, Any]:
    return {
        "block": "csv-parser",
        "settings": {"operation": "parse", "csv_content": "name\nann\n", "filters": filters},
    }


def _stored_filters(filters: Any) -> Any:
    return nodes_by_id(compile_clean(make_recipe([_csv_step(filters)])))["node-1"]["data"][
        "config"
    ]["values"]["filters"]


class TestFilterRowCompareToValue:
    """A filter row on an operator taking no compare-to value stores none (REQ-3.1.3.25)."""

    @pytest.mark.parametrize("operator", ["is_null", "is_not_null", "is_true", "is_false"])
    @pytest.mark.parametrize("reference", ["", "abc"])
    def test_a_value_on_such_a_row_is_stored_as_none(self, operator: str, reference: str) -> None:
        filters = [
            {
                "id": "f1",
                "column": {"mode": "name", "value": "name"},
                "asType": "string",
                "conditions": [_filter_row("r1", operator, reference)],
            }
        ]
        assert _stored_filters(filters)[0]["conditions"] == [_filter_row("r1", operator, None)]

    def test_a_grouped_row_follows_the_rule_and_the_other_items_stay_as_written(self) -> None:
        group = {
            "id": "g1",
            "type": "group",
            "items": [_filter_row("r2", "is_null", ""), {"type": "operator", "value": "or"}],
        }
        conditions = [
            _filter_row("r1", "equals", "ann"),
            {"type": "operator", "value": "and"},
            {"id": "e1", "type": "expression", "expression": "_cell != ''"},
            {"type": "operator", "value": "and"},
            group,
        ]
        filters = [
            {
                "id": "f1",
                "column": {"mode": "name", "value": "name"},
                "asType": "string",
                "conditions": conditions,
            }
        ]
        stored = _stored_filters(filters)[0]["conditions"]
        assert stored == [
            *conditions[:4],
            {
                **group,
                "items": [_filter_row("r2", "is_null", None), {"type": "operator", "value": "or"}],
            },
        ]

    def test_a_filter_with_no_rows_and_items_that_are_not_rows_stay_as_written(self) -> None:
        filters = [
            {"id": "f1", "column": {"mode": "name", "value": "name"}, "asType": "string"},
            "not-a-filter",
            {
                "id": "f2",
                "column": {"mode": "name", "value": "name"},
                "asType": "string",
                "conditions": ["x"],
            },
        ]
        assert _stored_filters(filters) == filters

    def test_filters_given_as_an_expression_stay_an_expression(self) -> None:
        assert _stored_filters({"expr": "my_filters"}) == "my_filters"
