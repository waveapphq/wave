"""Who reads and who writes a name inside a Function (REQ-3.1.2.7, FNCFG-5, VMGR-105).

One walker answers it for every caller: the names a block reads, the names it
writes, the blocks of one scope, and the inputs no block uses and the outputs
no block writes. A muted block counts for neither; an unreachable block counts;
a nested Function Block counts through its fields, never through its own body.
"""

from __future__ import annotations

import importlib
from collections.abc import Generator
from types import ModuleType
from typing import Any

import pytest


def _usage() -> ModuleType:
    return importlib.import_module("wavecore.core.variables.usage")


@pytest.fixture(autouse=True)
def _register_core_plugins_and_controls() -> Generator[None, None, None]:
    from wavecore.controls.registry import _registry, register_all_core_controls
    from wavecore.core.plugin_registry import clear_registry, register_plugin
    from wavecore.plugins.log import LogPlugin

    _registry.clear()
    register_all_core_controls(_registry)
    clear_registry()
    register_plugin(LogPlugin())
    yield
    _registry.clear()
    clear_registry()


def _node(
    node_id: str,
    element_type: str,
    values: dict[str, Any],
    *,
    node_type: str = "control",
    expression_fields: list[str] | None = None,
    template_fields: list[str] | None = None,
    output_bindings: dict[str, str] | None = None,
    disabled: bool = False,
    **extra: Any,
) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "label": node_id,
            "elementType": element_type,
            "nodeType": node_type,
            "version": "1.0.0",
            "disabled": disabled,
            "config": {
                "values": values,
                "profileBindings": [],
                "outputBindings": output_bindings or {},
            },
            "displayName": node_id,
            "expressionFields": expression_fields or [],
            "templateFields": template_fields or [],
            **extra,
        },
    }


def _log(
    node_id: str,
    message: str,
    *,
    output_bindings: dict[str, str] | None = None,
    disabled: bool = False,
) -> dict[str, Any]:
    return _node(
        node_id,
        "log",
        {"message": message, "level": "INFO"},
        node_type="plugin",
        expression_fields=["message"],
        output_bindings=output_bindings,
        disabled=disabled,
    )


def _setter(
    node_id: str,
    rows: dict[str, Any],
    *,
    expression_keys: list[str] | None = None,
    template_keys: list[str] | None = None,
    disabled: bool = False,
) -> dict[str, Any]:
    return _node(
        node_id,
        "variable-setter",
        {"variables": rows},
        disabled=disabled,
        variableExpressionKeys=expression_keys or [],
        variableTemplateKeys=template_keys or [],
    )


def _row(
    variable: str = "src", reference: str = "x", *, reference_is_expression: bool = False
) -> dict[str, Any]:
    return {
        "id": "c1",
        "type": "literal",
        "variable": variable,
        "value_type": "string",
        "operator": "equals",
        "reference_value": reference,
        "reference_is_expression": reference_is_expression,
    }


def _function_block(
    node_id: str,
    values: dict[str, Any],
    *,
    expression_fields: list[str] | None = None,
    template_fields: list[str] | None = None,
    body: list[dict[str, Any]] | None = None,
    outputs: list[dict[str, Any]] | None = None,
    **extra: Any,
) -> dict[str, Any]:
    """A Local Function Block whose inputs sit in ``config.values`` like any Block's fields."""
    inner_nodes = body or []
    return _node(
        node_id,
        "function",
        values,
        node_type="function",
        expression_fields=expression_fields,
        template_fields=template_fields,
        functionLifecycle="local",
        localDefinition={
            "name": "inner",
            "inputs": [
                {"name": "x", "type": "string"},
                {"name": "tags", "type": "map"},
            ],
            "outputs": outputs or [],
            "variables": [],
            "workflow": {
                "nodes": inner_nodes,
                "edges": (
                    [{"source": "start-node", "target": inner_nodes[0]["id"]}]
                    if inner_nodes
                    else []
                ),
            },
        },
        **extra,
    )


def _function(
    *,
    inputs: list[str] | None = None,
    outputs: list[dict[str, Any]] | None = None,
    variables: list[dict[str, Any]] | None = None,
    nodes: list[dict[str, Any]] | None = None,
    connected: bool = True,
) -> dict[str, Any]:
    body = nodes or []
    edges = [{"source": "start-node", "target": n["id"]} for n in body] if connected else []
    return {
        "name": "fmt",
        "inputs": [{"name": name, "type": "string"} for name in (inputs or [])],
        "outputs": outputs or [],
        "variables": variables or [],
        "workflow": {"nodes": body, "edges": edges},
    }


BLOCK_READS = [
    pytest.param(_log("n", "src.upper()"), {"src"}, id="expression-setting"),
    pytest.param(
        _node(
            "n",
            "log",
            {"message": "Hello {{ src }}", "level": "INFO"},
            node_type="plugin",
            template_fields=["message"],
        ),
        {"src"},
        id="template-setting",
    ),
    pytest.param(
        _node(
            "n",
            "shell-script",
            {"script": "echo $X", "input_vars": {"X": "src"}},
            node_type="plugin",
            expression_fields=["input_vars.X"],
        ),
        {"src"},
        id="map-entry",
    ),
    pytest.param(
        _node(
            "n",
            "shell-script",
            {"script": "echo $1", "arguments": [{"value": "src"}]},
            node_type="plugin",
            expression_fields=["arguments.0.value"],
        ),
        {"src"},
        id="list-entry",
    ),
    pytest.param(_node("n", "for-each", {"collection": "src"}), {"src"}, id="reference-setting"),
    pytest.param(
        _setter("n", {"out": "src + '!'"}, expression_keys=["out"]),
        {"src"},
        id="setter-expression-row",
    ),
    pytest.param(
        _setter("n", {"out": "x-{{ src }}"}, template_keys=["out"]),
        {"src"},
        id="setter-template-row",
    ),
    pytest.param(_node("n", "assert", {"assertions": [_row()]}), {"src"}, id="assert"),
    pytest.param(
        _node(
            "n",
            "if-else",
            {
                "branches": [
                    {"id": "b0", "type": "if", "conditions": [_row()]},
                    {"id": "b1", "type": "else"},
                ]
            },
        ),
        {"src"},
        id="if-else",
    ),
    pytest.param(
        _node(
            "n",
            "switch-case",
            {
                "branches": [
                    {"id": "c0", "type": "case", "conditions": [_row()], "break": True},
                    {"id": "d0", "type": "default"},
                ]
            },
        ),
        {"src"},
        id="switch",
    ),
    pytest.param(
        _node("n", "while", {"mode": "while-do", "conditions": [_row()], "max_iterations": 3}),
        {"src"},
        id="while",
    ),
    pytest.param(
        _node("n", "wait-until", {"conditions": [_row()], "timeout": 1000}),
        {"src"},
        id="wait-until",
    ),
    pytest.param(
        _function_block("n", {"x": "src"}, expression_fields=["x"]),
        {"src"},
        id="function-block-expression-input",
    ),
    pytest.param(
        _function_block("n", {"x": "Hello {{ src }}"}, template_fields=["x"]),
        {"src"},
        id="function-block-template-input",
    ),
    pytest.param(
        _function_block("n", {"tags": {"env": "src"}}, expression_fields=["tags.env"]),
        {"src"},
        id="function-block-map-entry",
    ),
    pytest.param(
        _node(
            "n",
            "assert",
            {"assertions": [_row("other", "src", reference_is_expression=True)]},
        ),
        {"other", "src"},
        id="condition-reference-expression",
    ),
    pytest.param(
        _node("n", "assert", {"assertions": [{"type": "expression", "expression": "src == 'x'"}]}),
        {"src"},
        id="condition-expression-row",
    ),
    pytest.param(
        _node("n", "assert", {"assertions": [{"type": "group", "items": [_row()]}]}),
        {"src"},
        id="condition-nested-group",
    ),
]

FUNCTION_READS = [
    pytest.param(
        {
            "variables": [
                {"name": "v", "type": "string", "value": "src + 'x'", "isExpression": True}
            ]
        },
        id="local-expression-variable",
    ),
    pytest.param(
        {
            "variables": [
                {"name": "v", "type": "string", "value": "x-{{ src }}", "isTemplate": True}
            ]
        },
        id="local-template-variable",
    ),
    pytest.param(
        {
            "outputs": [
                {"name": "out", "type": "string", "default": "src + 'x'", "isExpression": True}
            ]
        },
        id="expression-output",
    ),
    pytest.param(
        {
            "outputs": [
                {"name": "out", "type": "string", "default": "x-{{ src }}", "isTemplate": True}
            ]
        },
        id="template-output",
    ),
]

NOT_A_READ = [
    pytest.param(_log("n", "'src'"), set(), id="string-literal"),
    pytest.param(_log("n", "[src for src in other]"), {"other"}, id="comprehension-variable"),
    pytest.param(_log("n", "'hi'", output_bindings={"line": "src"}), set(), id="output-target"),
    pytest.param(
        _node("n", "assert", {"assertions": [_row("other", "src")]}),
        {"other"},
        id="literal-compare-to",
    ),
    pytest.param(_setter("n", {"out": "src"}), set(), id="setter-literal-row"),
    pytest.param(_function_block("n", {"x": "src"}), set(), id="function-block-literal-input"),
    pytest.param(
        _function_block("n", {}, inputBindings={"x": "src"}),
        set(),
        id="function-block-input-bindings-key",
    ),
]


class TestBlockReads:
    @pytest.mark.parametrize(("node", "expected"), BLOCK_READS)
    def test_the_names_a_block_reads(self, node: dict[str, Any], expected: set[str]) -> None:
        assert _usage().block_reads(node) == expected

    @pytest.mark.parametrize(("node", "expected"), BLOCK_READS)
    def test_an_input_the_block_reads_is_used(
        self, node: dict[str, Any], expected: set[str]
    ) -> None:
        function_def = _function(inputs=["src"], nodes=[node])

        assert _usage().unused_inputs(function_def) == []
        assert _usage().function_reads(function_def) == expected


class TestFunctionLevelReads:
    @pytest.mark.parametrize("declarations", FUNCTION_READS)
    def test_a_computed_variable_or_output_reads_the_input(
        self, declarations: dict[str, Any]
    ) -> None:
        function_def = {**_function(inputs=["src"]), **declarations}

        assert _usage().function_reads(function_def) == {"src"}
        assert _usage().unused_inputs(function_def) == []


class TestNotARead:
    @pytest.mark.parametrize(("node", "expected"), NOT_A_READ)
    def test_the_block_does_not_read_the_name(
        self, node: dict[str, Any], expected: set[str]
    ) -> None:
        assert _usage().block_reads(node) == expected

    @pytest.mark.parametrize(("node", "expected"), NOT_A_READ)
    def test_the_input_stays_unused(self, node: dict[str, Any], expected: set[str]) -> None:
        function_def = _function(inputs=["src"], nodes=[node])

        assert _usage().unused_inputs(function_def) == ["src"]

    def test_a_muted_block_reads_nothing(self) -> None:
        function_def = _function(inputs=["src"], nodes=[_log("muted", "src", disabled=True)])

        assert _usage().function_reads(function_def) == set()
        assert _usage().unused_inputs(function_def) == ["src"]

    def test_an_unreachable_block_still_reads(self) -> None:
        function_def = _function(inputs=["src"], nodes=[_log("island", "src")], connected=False)

        assert _usage().function_reads(function_def) == {"src"}
        assert _usage().unused_inputs(function_def) == []


class TestWrites:
    def test_a_setter_target_is_written(self) -> None:
        setter = _setter("n", {"out": "'v'"})
        function_def = _function(outputs=[{"name": "out", "type": "string"}], nodes=[setter])

        assert _usage().block_writes(setter) == {"out"}
        assert _usage().function_writes(function_def) == {"out"}
        assert _usage().unwritten_outputs(function_def) == []

    def test_an_output_binding_target_is_written(self) -> None:
        writer = _log("n", "'v'", output_bindings={"line": "out"})
        function_def = _function(outputs=[{"name": "out", "type": "string"}], nodes=[writer])

        assert _usage().block_writes(writer) == {"out"}
        assert _usage().unwritten_outputs(function_def) == []

    @pytest.mark.parametrize(
        "output",
        [
            pytest.param(
                {"name": "out", "type": "string", "default": "'a' + 'b'", "isExpression": True},
                id="expression-output",
            ),
            pytest.param(
                {"name": "out", "type": "string", "default": "a-{{ 'b' }}", "isTemplate": True},
                id="template-output",
            ),
        ],
    )
    def test_a_computed_output_counts_as_written(self, output: dict[str, Any]) -> None:
        function_def = _function(outputs=[output])

        assert _usage().function_writes(function_def) == {"out"}
        assert _usage().unwritten_outputs(function_def) == []

    def test_a_muted_writer_does_not_count(self) -> None:
        function_def = _function(
            outputs=[{"name": "out", "type": "string"}],
            nodes=[
                _log("n", "'v'", output_bindings={"line": "out"}, disabled=True),
                _setter("s", {"out": "'v'"}, disabled=True),
            ],
        )

        assert _usage().function_writes(function_def) == set()
        assert _usage().unwritten_outputs(function_def) == ["out"]

    def test_a_default_is_not_a_write(self) -> None:
        function_def = _function(outputs=[{"name": "out", "type": "string", "default": "x"}])

        assert _usage().unwritten_outputs(function_def) == ["out"]

    def test_a_non_mapping_node_is_skipped(self) -> None:
        function_def = {
            "workflow": {
                "nodes": [
                    "not-a-mapping",
                    {"data": {"config": {"outputBindings": {"slot0": "result"}}}},
                ]
            }
        }

        assert _usage().function_writes(function_def) == {"result"}


class TestNestedFunctionBody:
    def _outer(self) -> dict[str, Any]:
        inner_body = [_log("inner-log", "src", output_bindings={"line": "out"})]
        return _function(
            inputs=["src"],
            outputs=[{"name": "out", "type": "string"}],
            nodes=[_function_block("fn-block", {}, body=inner_body)],
        )

    def test_a_read_inside_a_nested_body_is_not_the_outer_functions(self) -> None:
        outer = self._outer()

        assert _usage().function_reads(outer) == set()
        assert _usage().unused_inputs(outer) == ["src"]

    def test_a_write_inside_a_nested_body_is_not_the_outer_functions(self) -> None:
        outer = self._outer()

        assert _usage().function_writes(outer) == set()
        assert _usage().unwritten_outputs(outer) == ["out"]

    def test_the_scope_holds_the_function_block_not_its_body(self) -> None:
        outer = self._outer()

        assert [node["id"] for node in _usage().scope_blocks(outer["workflow"])] == ["fn-block"]


class TestDeclarationOrder:
    def test_unused_inputs_keep_declaration_order(self) -> None:
        function_def = _function(inputs=["zeta", "alpha", "mid"], nodes=[_log("n", "mid")])

        assert _usage().unused_inputs(function_def) == ["zeta", "alpha"]

    def test_unwritten_outputs_keep_declaration_order(self) -> None:
        function_def = _function(
            outputs=[
                {"name": "zeta", "type": "string"},
                {"name": "alpha", "type": "string"},
                {"name": "mid", "type": "string"},
            ],
            nodes=[_log("n", "'v'", output_bindings={"line": "alpha"})],
        )

        assert _usage().unwritten_outputs(function_def) == ["zeta", "mid"]


class TestScopeBlocks:
    def _workflow(self) -> dict[str, Any]:
        return {
            "nodes": [
                _node("loop", "for", {"mode": "count", "count": 2}),
                _log("body", "src"),
                _log("muted", "other", disabled=True),
            ],
            "edges": [
                {"source": "start-node", "target": "loop"},
                {"source": "loop", "target": "body", "sourceHandle": "body"},
            ],
        }

    def test_muted_blocks_are_skipped_and_containers_kept(self) -> None:
        ids = {node["id"] for node in _usage().scope_blocks(self._workflow())}

        assert ids == {"loop", "body"}

    def test_muted_blocks_are_included_when_asked(self) -> None:
        ids = {node["id"] for node in _usage().scope_blocks(self._workflow(), include_muted=True)}

        assert ids == {"loop", "body", "muted"}


class TestNodeBindingAccessors:
    def test_output_bindings_of_a_block(self) -> None:
        node = _log("n", "'v'", output_bindings={"line": "out"})

        assert _usage().node_output_bindings(node) == {"line": "out"}

    @pytest.mark.parametrize(
        "node",
        [
            pytest.param({}, id="no-data"),
            pytest.param({"data": {"config": "not-a-mapping"}}, id="config-not-a-mapping"),
            pytest.param({"data": {"config": {"outputBindings": ["x"]}}}, id="bindings-a-list"),
        ],
    )
    def test_malformed_output_bindings_read_empty(self, node: dict[str, Any]) -> None:
        assert _usage().node_output_bindings(node) == {}


def _cell_row(
    variable: str = "_cell", reference: Any = 5, *, reference_is_expression: bool = False
) -> dict[str, Any]:
    return {
        "id": "f1",
        "type": "literal",
        "variable": variable,
        "value_type": "integer",
        "operator": "greater_than",
        "reference_value": reference,
        "reference_is_expression": reference_is_expression,
    }


def _parser(conditions: list[dict[str, Any]]) -> dict[str, Any]:
    return _node(
        "parse",
        "csv-parser",
        {
            "filters": [
                {
                    "id": "flt-1",
                    "column": {"mode": "name", "value": "amount"},
                    "asType": "integer",
                    "conditions": conditions,
                }
            ]
        },
        node_type="plugin",
    )


class TestFilterRows:
    """A CSV / Excel filter condition reads like a check row; the cell it tests, bound as
    `_cell`, is never a variable (REQ-3.1.2.7, VMGR-105)."""

    @pytest.mark.parametrize(
        ("conditions", "expected"),
        [
            pytest.param([_cell_row()], set(), id="literal-compare-to"),
            pytest.param(
                [_cell_row(reference="limit", reference_is_expression=True)],
                {"limit"},
                id="compare-to-expression",
            ),
            pytest.param(
                [{"id": "e", "type": "expression", "expression": "_cell > limit * 2"}],
                {"limit"},
                id="expression-row",
            ),
            pytest.param(
                [
                    _cell_row(),
                    {"type": "operator", "value": "and"},
                    {
                        "type": "group",
                        "items": [_cell_row("_cell", "top", reference_is_expression=True)],
                    },
                ],
                {"top"},
                id="nested-group",
            ),
        ],
    )
    def test_a_filter_condition_reads_its_compare_to_names(
        self, conditions: list[dict[str, Any]], expected: set[str]
    ) -> None:
        assert _usage().block_reads(_parser(conditions)) == expected

    def test_an_input_read_only_by_a_filter_is_used(self) -> None:
        parser = _parser([_cell_row(reference="limit", reference_is_expression=True)])
        function_def = _function(inputs=["limit"], nodes=[parser])

        assert _usage().unused_inputs(function_def) == []

    def test_the_filter_site_names_its_place_in_the_block(self) -> None:
        parser = _parser([_cell_row(reference="limit", reference_is_expression=True)])

        (site,) = _usage().block_sites(parser)

        assert site.setting == "filters.0.conditions.0.reference_value"
        assert site.names == {"limit"}
        assert site.bound == frozenset({"_cell"})

    def test_a_check_row_on_a_name_called_cell_is_still_a_read(self) -> None:
        node = _node("n", "assert", {"assertions": [_row("_cell")]})

        assert _usage().block_reads(node) == {"_cell"}


class TestBlockSites:
    """Each site names where it sits, so a caller can report or rewrite it."""

    def test_sites_carry_their_kind_path_and_setting(self) -> None:
        node = _node(
            "n",
            "variable-setter",
            {"variables": {"out": "src + 1"}},
            output_bindings={"value": "result"},
            variableExpressionKeys=["out"],
        )

        sites = [
            (site.kind, site.path, site.setting, site.writes) for site in _usage().block_sites(node)
        ]

        assert sites == [
            ("expression", ("config", "values", "variables", "out"), "variables.out", False),
            ("output_binding", ("config", "outputBindings", "value"), "value", True),
            ("setter_target", ("config", "values", "variables", "out"), "variables.out", True),
        ]

    def test_a_function_block_input_site_is_named_by_its_input(self) -> None:
        (site,) = _usage().block_sites(_function_block("n", {"x": "src"}, expression_fields=["x"]))

        assert (site.kind, site.path, site.setting, site.names) == (
            "expression",
            ("config", "values", "x"),
            "x",
            {"src"},
        )

    def test_a_function_block_map_entry_site_is_named_by_its_dotted_place(self) -> None:
        node = _function_block("n", {"tags": {"env": "src"}}, expression_fields=["tags.env"])

        (site,) = _usage().block_sites(node)

        assert (site.kind, site.path, site.setting, site.names) == (
            "expression",
            ("config", "values", "tags", "env"),
            "tags.env",
            {"src"},
        )

    def test_a_function_block_input_bindings_key_is_no_site(self) -> None:
        node = _function_block("n", {}, inputBindings={"x": "src"})

        assert list(_usage().block_sites(node)) == []

    def test_a_literal_row_names_its_variable(self) -> None:
        (site,) = _usage().block_sites(_node("n", "assert", {"assertions": [_row()]}))

        assert (site.kind, site.setting, site.names) == ("name", "assertions.0.variable", {"src"})

    def test_a_template_site_names_what_its_markers_read(self) -> None:
        node = _node(
            "n",
            "log",
            {"message": "Hello {{ src }}", "level": "INFO"},
            node_type="plugin",
            template_fields=["message"],
        )

        (site,) = _usage().block_sites(node)

        assert (site.kind, site.setting, site.names) == ("template", "message", {"src"})

    def test_an_empty_setter_target_names_nothing(self) -> None:
        sites = list(_usage().block_write_sites(_setter("n", {"": "x"})))

        assert [(site.kind, site.names) for site in sites] == [("setter_target", set())]
        assert _usage().block_writes(_setter("n", {"": "x"})) == {""}


class TestNamespaceReads:
    """The System variables a block uses: what it reads off the ``system`` namespace."""

    @pytest.mark.parametrize(
        ("node", "expected"),
        [
            pytest.param(_log("n", "system.api_tok + 'x'"), {"api_tok"}, id="attribute"),
            pytest.param(_log("n", "system['api_tok']"), {"api_tok"}, id="string-key"),
            pytest.param(_log("n", "system[0] + system[name]"), set(), id="non-string-key"),
            pytest.param(_log("n", "suite.api_tok + other.system"), set(), id="other-namespace"),
            pytest.param(_log("n", "system.("), set(), id="syntax-error"),
            pytest.param(
                _node(
                    "n",
                    "log",
                    {"message": "{{ system.host }} and {{ }}", "level": "INFO"},
                    node_type="plugin",
                    template_fields=["message"],
                ),
                {"host"},
                id="template-marker",
            ),
            pytest.param(
                _node("n", "assert", {"assertions": [_row("system.flag")]}), {"flag"}, id="row"
            ),
            pytest.param(
                _node("n", "assert", {"assertions": [_row("flag")]}), set(), id="row-plain"
            ),
            pytest.param(
                _log("n", "'x'", output_bindings={"message": "system.out"}), set(), id="write"
            ),
        ],
    )
    def test_the_names_a_block_reads_off_a_namespace(
        self, node: dict[str, Any], expected: set[str]
    ) -> None:
        assert _usage().block_namespace_reads(node, "system") == expected


class TestComputedCycles:
    """One check finds a loop among computed sources, for Test and Function variables alike:
    the loop starts at its smallest name and closes on it (REQ-3.1.3.13)."""

    @pytest.mark.parametrize(
        ("expressions", "templates", "path"),
        [
            pytest.param({"x": "x + 1"}, {}, ["x", "x"], id="self"),
            pytest.param({"b": "a + 1", "a": "b + 1"}, {}, ["a", "b", "a"], id="two"),
            pytest.param(
                {"a": "b + 1", "b": "c + 1", "c": "a + 1"}, {}, ["a", "b", "c", "a"], id="three"
            ),
            pytest.param({"b": "len(a)"}, {"a": "id-{{ b }}"}, ["a", "b", "a"], id="template"),
        ],
    )
    def test_a_loop_is_found_from_its_smallest_name(
        self, expressions: dict[str, str], templates: dict[str, str], path: list[str]
    ) -> None:
        usage = _usage()

        assert usage.cycle_path(usage.sources_graph(expressions, templates)) == path

    @pytest.mark.parametrize(
        ("expressions", "templates"),
        [
            pytest.param({"a": "'b' + c", "b": "a + 'x'"}, {}, id="name-inside-a-string"),
            pytest.param({"a": "b + 1"}, {"b": "{{ count }}"}, id="chain"),
            pytest.param({}, {}, id="nothing-computed"),
        ],
    )
    def test_no_loop_is_found_where_none_is_read(
        self, expressions: dict[str, str], templates: dict[str, str]
    ) -> None:
        usage = _usage()

        assert usage.cycle_path(usage.sources_graph(expressions, templates)) is None

    def test_the_message_names_the_loop(self) -> None:
        assert (
            _usage().cycle_message(["a", "b", "a"])
            == "Circular reference detected for variable 'a': a -> b -> a"
        )
