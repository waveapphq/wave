"""Template variables in the workbench prep path (REQ-3.1.3.13, REQ-3.1.3.15).

- ``_flatten_variables`` routes an ``isTemplate`` entry into the template map
  (``name -> source``), apart from the literals and the expression map.
- ``_validate_expression_variable_dependencies`` refuses a loop among the computed
  variables at session start, expressions and templates in one graph, with the one
  cycle message every check uses.
"""

from __future__ import annotations

import pytest

from wavecore.api.exceptions import ValidationException
from wavecore.api.services.workbench import service as workbench_service


class TestFlattenVariablesTemplateRouting:
    """``_flatten_variables`` routes templates into the template map."""

    def test_template_entry_routed_to_tmpl_map(self) -> None:
        literals, expr_map, tmpl_map = workbench_service._flatten_variables(
            {"greeting": {"value": "Hi {{user}}", "type": "string", "isTemplate": True}}
        )
        assert tmpl_map == {"greeting": "Hi {{user}}"}
        # A template is not a literal and not an expression.
        assert "greeting" not in literals
        assert "greeting" not in expr_map

    def test_template_value_is_stringified(self) -> None:
        # A non-string declared value is coerced to its string source so the
        # template renderer always receives text.
        _literals, _expr_map, tmpl_map = workbench_service._flatten_variables(
            {"t": {"value": 42, "type": "string", "isTemplate": True}}
        )
        assert tmpl_map == {"t": "42"}

    def test_mixed_kinds_routed_to_their_maps(self) -> None:
        literals, expr_map, tmpl_map = workbench_service._flatten_variables(
            {
                "user": {"value": "Ada", "type": "string"},
                "doubled": {"value": "n * 2", "type": "integer", "isExpression": True},
                "greeting": {"value": "Hi {{user}}", "type": "string", "isTemplate": True},
            }
        )
        assert literals == {"user": "Ada"}
        assert expr_map == {"doubled": ("n * 2", "integer")}
        assert tmpl_map == {"greeting": "Hi {{user}}"}

    def test_no_templates_returns_empty_tmpl_map(self) -> None:
        literals, expr_map, tmpl_map = workbench_service._flatten_variables(
            {
                "user": {"value": "Ada", "type": "string"},
                "doubled": {"value": "n * 2", "type": "integer", "isExpression": True},
            }
        )
        assert tmpl_map == {}
        assert literals == {"user": "Ada"}
        assert expr_map == {"doubled": ("n * 2", "integer")}

    def test_a_declaration_with_no_value_starts_null(self) -> None:
        """A declaration with no value must never resolve to the declaration dict:
        that leaks the type name into the run and scrubs it out of other text."""
        entry = {"type": "string", "external_ref": "legacy"}
        literals, expr_map, tmpl_map = workbench_service._flatten_variables({"legacy": entry})
        assert literals == {"legacy": None}
        assert expr_map == {}
        assert tmpl_map == {}

    @pytest.mark.parametrize(
        "declared_type", ["string", "integer", "float", "boolean", "array", "table", "map"]
    )
    def test_a_declaration_with_no_value_starts_null_for_every_type(
        self, declared_type: str
    ) -> None:
        """Null is a value of every type, distinct from empty and zero (REQ-3.1.3.20)."""
        literals, _expr_map, _tmpl_map = workbench_service._flatten_variables(
            {"blank": {"type": declared_type}}
        )
        assert literals == {"blank": None}

    def test_a_secret_with_no_value_starts_null_not_its_declaration(self) -> None:
        """An unfilled secret must never resolve to its own declaration dict:
        that leaks the type name into the run and scrubs it out of other text."""
        literals, expr_map, tmpl_map = workbench_service._flatten_variables(
            {"token": {"type": "string", "secret": True}}
        )
        assert literals == {"token": None}
        assert expr_map == {}
        assert tmpl_map == {}

    @pytest.mark.parametrize(
        "declared_type", ["string", "integer", "float", "boolean", "array", "table", "map"]
    )
    def test_a_stored_null_stays_null_for_every_type(self, declared_type: str) -> None:
        """A declaration holding null and one with no value start the run the same way."""
        literals, _expr_map, _tmpl_map = workbench_service._flatten_variables(
            {"held": {"type": declared_type, "value": None}}
        )
        assert literals == {"held": None}

    def test_a_stored_empty_string_stays_a_value(self) -> None:
        """Set-but-empty and unset are separate states all the way to the run."""
        literals, _expr_map, _tmpl_map = workbench_service._flatten_variables(
            {"blank": {"type": "string", "value": ""}}
        )
        assert literals == {"blank": ""}


class TestRunStartCycleCheck:
    """A loop among computed variables is refused when the session starts, named from its
    smallest name; a name inside a string literal is not a read."""

    @pytest.mark.parametrize(
        ("expressions", "templates", "message"),
        [
            pytest.param(
                {"b": ("a", "string")},
                {"a": "{{b}}"},
                r"^Circular reference detected for variable 'a': a -> b -> a$",
                id="template-and-expression",
            ),
            pytest.param(
                {},
                {"one": "{{two}}", "two": "{{one}}"},
                r"^Circular reference detected for variable 'one': one -> two -> one$",
                id="two-templates",
            ),
            pytest.param(
                {"x": ("x + 1", "integer")},
                {},
                r"^Circular reference detected for variable 'x': x -> x$",
                id="self-reference",
            ),
        ],
    )
    def test_a_loop_is_refused(
        self,
        expressions: dict[str, tuple[str, str]],
        templates: dict[str, str],
        message: str,
    ) -> None:
        with pytest.raises(ValidationException, match=message):
            workbench_service._validate_expression_variable_dependencies(expressions, templates)

    @pytest.mark.parametrize(
        ("expressions", "templates"),
        [
            pytest.param(
                {"a": ("'b' + c", "string"), "b": ("a + 'x'", "string")},
                {},
                id="name-inside-a-string",
            ),
            pytest.param(
                {"base": ("1 + 1", "integer")}, {"label": "value is {{base}}"}, id="chain"
            ),
            pytest.param({}, {}, id="nothing-computed"),
        ],
    )
    def test_no_loop_passes(
        self, expressions: dict[str, tuple[str, str]], templates: dict[str, str]
    ) -> None:
        workbench_service._validate_expression_variable_dependencies(expressions, templates)
