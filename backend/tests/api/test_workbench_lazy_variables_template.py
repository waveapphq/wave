"""Unit tests for template-kind realization in LazyVariables (REQ-3.1.3.15).

A template is a first-class string value kind: its ``{{ expression }}``
markers render lazily on first reference through the same ``LazyVariables``
machinery expression variables use (REQ-3.1.3.13). These tests pin the
template surface added alongside the existing expression surface:

- A pending template stays invisible to ``len`` / iteration / ``copy`` and
  realizes to its rendered string only on first ``__getitem__``.
- ``{{ }}`` markers route through ``__getitem__`` so a marker referencing
  another template / expression realizes it transitively.
- Literal ``{{}}`` and single braces are preserved (safe for JSON/YAML/XML).
- The shared ``_evaluating`` guard catches template / mixed cycles.
- ``set_template`` re-arms a name as a pending template (mirrors
  ``set_expression``).
"""

from __future__ import annotations

from typing import Any

import pytest

from wavecore.api.services.workbench.lazy_variables import LazyVariables


class TestLazyVariablesTemplateRealization:
    """A pending template renders to a string on first read."""

    def test_template_renders_to_string_on_first_read(self) -> None:
        wrapper = LazyVariables(
            {"user": "Ada"},
            tmpl_map={"greeting": "Hello {{user}}!"},
        )
        assert wrapper["greeting"] == "Hello Ada!"

    def test_template_with_no_markers_is_literal_text(self) -> None:
        wrapper = LazyVariables({}, tmpl_map={"plain": "no markers here"})
        assert wrapper["plain"] == "no markers here"

    def test_empty_marker_pair_left_as_literal(self) -> None:
        # An empty {{}} is NOT a marker - left verbatim so brace-bearing
        # payloads stay safe in template values without escaping.
        wrapper = LazyVariables({}, tmpl_map={"j": "a {{}} b"})
        assert wrapper["j"] == "a {{}} b"

    def test_single_braces_preserved(self) -> None:
        wrapper = LazyVariables({}, tmpl_map={"j": '{ "k": {v} }'})
        assert wrapper["j"] == '{ "k": {v} }'

    def test_marker_converts_non_string_result_to_string(self) -> None:
        wrapper = LazyVariables({"count": 5}, tmpl_map={"label": "n={{count}}"})
        assert wrapper["label"] == "n=5"

    def test_unread_template_stays_pending_and_invisible_to_snapshot(self) -> None:
        wrapper = LazyVariables(
            {"user": "Ada"},
            tmpl_map={"greeting": "Hi {{user}}"},
        )
        # Snapshot surfaces (len / iter / copy) only show realized entries so
        # serializers and diff pushes never realize a template as a side effect.
        assert len(wrapper) == 1
        assert list(iter(wrapper)) == ["user"]
        assert wrapper.copy() == {"user": "Ada"}
        # ...but a pending template is still reachable via ``in``.
        assert "greeting" in wrapper

    def test_realized_template_becomes_visible_in_snapshot(self) -> None:
        wrapper = LazyVariables({"user": "Ada"}, tmpl_map={"greeting": "Hi {{user}}"})
        _ = wrapper["greeting"]
        assert len(wrapper) == 2
        assert sorted(iter(wrapper)) == ["greeting", "user"]
        assert wrapper.copy()["greeting"] == "Hi Ada"

    def test_on_evaluated_fires_once_with_rendered_string(self) -> None:
        captured: list[tuple[str, Any]] = []
        wrapper = LazyVariables(
            {"user": "Ada"},
            tmpl_map={"greeting": "Hi {{user}}"},
            on_evaluated=lambda name, value: captured.append((name, value)),
        )
        assert wrapper["greeting"] == "Hi Ada"
        assert captured == [("greeting", "Hi Ada")]

    def test_second_read_returns_cached_without_refiring_callback(self) -> None:
        captured: list[tuple[str, Any]] = []
        wrapper = LazyVariables(
            {"user": "Ada"},
            tmpl_map={"greeting": "Hi {{user}}"},
            on_evaluated=lambda name, value: captured.append((name, value)),
        )
        assert wrapper["greeting"] == "Hi Ada"
        assert wrapper["greeting"] == "Hi Ada"
        # The render happened exactly once; the second read hit the cache.
        assert captured == [("greeting", "Hi Ada")]

    def test_unknown_name_raises_key_error(self) -> None:
        wrapper = LazyVariables({}, tmpl_map={"greeting": "Hi"})
        with pytest.raises(KeyError):
            _ = wrapper["missing"]


class TestLazyVariablesTemplateReferenceRecursion:
    """A marker that references another computed var realizes it via __getitem__."""

    def test_template_references_literal_variable(self) -> None:
        wrapper = LazyVariables(
            {"host": "localhost", "port": 8000},
            tmpl_map={"url": "http://{{host}}:{{port}}/api"},
        )
        assert wrapper["url"] == "http://localhost:8000/api"

    def test_template_references_expression_variable_realizing_it(self) -> None:
        wrapper = LazyVariables(
            {"n": 3},
            expr_map={"doubled": ("n * 2", "integer")},
            tmpl_map={"label": "value={{doubled}}"},
        )
        assert wrapper["label"] == "value=6"
        # The referenced expression realized transitively and is now cached.
        assert wrapper["doubled"] == 6

    def test_template_references_another_template_realizing_it(self) -> None:
        wrapper = LazyVariables(
            {"name": "Ada"},
            tmpl_map={"greeting": "Hello {{name}}", "message": "{{greeting}}!"},
        )
        assert wrapper["message"] == "Hello Ada!"

    def test_reference_recursion_fires_callbacks_inner_then_outer(self) -> None:
        captured: list[tuple[str, Any]] = []
        wrapper = LazyVariables(
            {"n": 3},
            expr_map={"doubled": ("n * 2", "integer")},
            tmpl_map={"label": "{{doubled}}"},
            on_evaluated=lambda name, value: captured.append((name, value)),
        )
        assert wrapper["label"] == "6"
        # The inner expression realizes during the template render (before the
        # template caches), so its callback fires first.
        assert captured == [("doubled", 6), ("label", "6")]

    def test_single_pass_does_not_rescan_substituted_braces(self) -> None:
        # The rendered output is not re-scanned: a substituted value that itself
        # contains {{ }} is left as literal text, not re-evaluated.
        wrapper = LazyVariables(
            {"raw": "{{user}}"},
            tmpl_map={"echo": "got {{raw}}"},
        )
        assert wrapper["echo"] == "got {{user}}"


class TestLazyVariablesTemplateCycleDetection:
    """The shared ``_evaluating`` guard catches template / mixed cycles."""

    def test_self_referential_template_raises_circular(self) -> None:
        captured: list[tuple[str, Any]] = []
        wrapper = LazyVariables(
            {},
            tmpl_map={"loop": "{{loop}}"},
            on_evaluated=lambda name, value: captured.append((name, value)),
        )
        with pytest.raises(
            Exception,
            match=(
                r"^Expression evaluation failed for 'loop': "
                r"Circular reference detected for variable 'loop': loop -> loop$"
            ),
        ):
            _ = wrapper["loop"]
        # Evaluation aborted before caching, so the callback never fired.
        assert captured == []

    def test_template_expression_cycle_raises_circular(self) -> None:
        # tmpl a -> {{b}} ; expr b -> a : a mixed template/expression cycle.
        wrapper = LazyVariables(
            {},
            expr_map={"b": ("a", "string")},
            tmpl_map={"a": "{{b}}"},
        )
        with pytest.raises(
            Exception,
            match=(
                r"^Expression evaluation failed for 'a': "
                r"Circular reference detected for variable 'a': a -> b -> a$"
            ),
        ):
            _ = wrapper["a"]


class TestLazyVariablesSetTemplate:
    """Re-arm a runtime variable as a pending template (PATCH override path).

    ``set_template`` is the inverse of ``_evaluate_template_var``'s realize
    step: it repopulates the pending template entry and drops any realized
    value, so the next ``__getitem__`` re-renders the NEW source lazily. This
    backs the Current-mode template override (change the source, do not pin a
    literal).
    """

    def test_set_template_returns_none(self) -> None:
        wrapper = LazyVariables({"user": "Ada"})
        assert wrapper.set_template("greeting", "Hi {{user}}") is None

    def test_set_template_marks_name_pending_and_invisible_to_snapshot(self) -> None:
        wrapper = LazyVariables({"user": "Ada"})
        wrapper.set_template("greeting", "Hi {{user}}")
        # Pending: reachable via ``in`` but absent from realized snapshots.
        assert "greeting" in wrapper
        assert "greeting" not in wrapper.copy()
        assert len(wrapper) == 1
        assert list(iter(wrapper)) == ["user"]

    def test_set_template_reevaluates_on_next_getitem(self) -> None:
        wrapper = LazyVariables({"user": "Ada"})
        wrapper.set_template("greeting", "Hi {{user}}")
        assert wrapper["greeting"] == "Hi Ada"

    def test_set_template_discards_prior_realized_value(self) -> None:
        wrapper = LazyVariables({"user": "Ada", "greeting": "stale"})
        wrapper.set_template("greeting", "Hello {{user}}")
        assert wrapper["greeting"] == "Hello Ada"

    def test_set_template_supersedes_existing_pending_template(self) -> None:
        wrapper = LazyVariables({"user": "Ada"}, tmpl_map={"greeting": "Old {{user}}"})
        wrapper.set_template("greeting", "New {{user}}")
        assert wrapper["greeting"] == "New Ada"

    def test_set_template_supersedes_existing_pending_expression(self) -> None:
        wrapper = LazyVariables({"user": "Ada"}, expr_map={"greeting": ("user", "string")})
        wrapper.set_template("greeting", "Hi {{user}}")
        # The name flips kind: it now renders as a template, not an expression.
        assert wrapper["greeting"] == "Hi Ada"

    def test_set_template_is_silent_until_next_reference(self) -> None:
        captured: list[tuple[str, Any]] = []
        wrapper = LazyVariables(
            {"user": "Ada"},
            on_evaluated=lambda name, value: captured.append((name, value)),
        )
        wrapper.set_template("greeting", "Hi {{user}}")
        # Re-arming is silent; the broadcast only fires when the next reference
        # renders the template.
        assert captured == []
        assert wrapper["greeting"] == "Hi Ada"
        assert captured == [("greeting", "Hi Ada")]


class TestTemplateVariablesAreReadOnly:
    """A template variable renders through the same read-only guard as a
    template field: a ``{{ }}`` marker may not change a variable."""

    def test_mutating_marker_is_refused_and_leaves_the_list_alone(self) -> None:
        from wavecore.core.expressions.errors import BlockedExpressionError

        rows: list[int] = [1]
        wrapper = LazyVariables(
            {"rows": rows},
            tmpl_map={"sneaky": "x={{rows.append(77)}}"},
        )
        with pytest.raises(BlockedExpressionError) as exc_info:
            wrapper["sneaky"]
        assert "append" in str(exc_info.value)
        assert rows == [1]

    def test_refused_template_variable_is_not_realized(self) -> None:
        from wavecore.core.expressions.errors import BlockedExpressionError

        wrapper = LazyVariables({"rows": [1]}, tmpl_map={"sneaky": "{{rows.append(77)}}"})
        with pytest.raises(BlockedExpressionError):
            wrapper["sneaky"]
        assert "sneaky" not in wrapper.copy()
        # Still pending, so a second read refuses again rather than serving
        # a half-rendered string.
        with pytest.raises(BlockedExpressionError):
            wrapper["sneaky"]

    def test_reading_marker_is_unaffected(self) -> None:
        wrapper = LazyVariables(
            {"rows": [1, 2, 3]},
            tmpl_map={"summary": "count={{len(rows)}}"},
        )
        assert wrapper["summary"] == "count=3"
