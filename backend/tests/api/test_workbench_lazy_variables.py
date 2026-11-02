"""Unit tests for the LazyVariables MutableMapping (REQ-3.1.3.13).

The wrapper exposes a dict-like surface over a mix of realized literal
values and pending expression variables. These tests pin the behavior of
the surface methods (``__setitem__``, ``__delitem__``, ``__len__``,
``__contains__``, ``copy``, ``pending_expression_names``,
``has_pending_expressions``) and the cycle-detection branch of
``_evaluate``. The integration with the workbench session lifecycle is
covered by tests in ``test_workbench_service.py``.
"""

from __future__ import annotations

import re
from typing import Any

import pytest

from wavecore.api.services.workbench.lazy_variables import LazyVariables


class TestLazyVariablesSurface:
    """Pin the dict-like surface used by the workbench code."""

    def test_setitem_supersedes_pending_expression(self) -> None:
        wrapper = LazyVariables(
            {},
            expr_map={"a": ("1 + 1", "integer")},
        )
        wrapper["a"] = 99
        assert wrapper["a"] == 99
        # Direct write removed the pending expression entry, so first-read
        # never re-evaluates the expression.
        assert not wrapper.has_pending_expressions()

    def test_setitem_writes_new_literal(self) -> None:
        wrapper = LazyVariables({})
        wrapper["b"] = "hello"
        assert wrapper["b"] == "hello"

    def test_delitem_removes_realized_value(self) -> None:
        wrapper = LazyVariables({"x": 1, "y": 2})
        del wrapper["x"]
        assert "x" not in wrapper
        assert wrapper["y"] == 2

    def test_delitem_drops_pending_expression(self) -> None:
        wrapper = LazyVariables(
            {"x": 1},
            expr_map={"y": ("x + 1", "integer")},
        )
        # Realize then delete - confirms both maps are cleared.
        wrapper["x"] = 5
        del wrapper["x"]
        assert "x" not in wrapper

    def test_len_reports_only_realized_entries(self) -> None:
        wrapper = LazyVariables(
            {"a": 1, "b": 2},
            expr_map={"c": ("a + b", "integer")},
        )
        assert len(wrapper) == 2

    def test_iter_yields_realized_names_only(self) -> None:
        wrapper = LazyVariables(
            {"a": 1, "b": 2},
            expr_map={"c": ("a + b", "integer")},
        )
        # Iteration drives the snapshot path used by serializers / diffs;
        # pending expressions stay invisible here so they do not realize
        # as a side effect of writing JSON or computing a diff.
        assert sorted(iter(wrapper)) == ["a", "b"]

    def test_contains_returns_false_for_non_string_key(self) -> None:
        wrapper = LazyVariables({"a": 1})
        # Defensive guard: a stray non-string key in a serializer must not
        # raise; it should simply be reported as absent.
        assert (123 in wrapper) is False

    def test_copy_returns_realized_snapshot_only(self) -> None:
        wrapper = LazyVariables(
            {"a": 1, "b": "two"},
            expr_map={"c": ("a + 1", "integer")},
        )
        snapshot = wrapper.copy()
        assert snapshot == {"a": 1, "b": "two"}
        # Mutating the snapshot must not leak into the wrapper.
        snapshot["a"] = 999
        assert wrapper["a"] == 1
        # Pending expression remains pending (copy did not realize it).
        assert wrapper.has_pending_expressions()

    def test_pending_expression_names_iterates_pending_entries(self) -> None:
        wrapper = LazyVariables(
            {},
            expr_map={"a": ("1", "integer"), "b": ("2", "integer")},
        )
        names = list(wrapper.pending_expression_names())
        assert sorted(names) == ["a", "b"]

    def test_has_pending_expressions_reflects_state(self) -> None:
        empty = LazyVariables({})
        assert empty.has_pending_expressions() is False

        with_pending = LazyVariables({}, expr_map={"a": ("1", "integer")})
        assert with_pending.has_pending_expressions() is True


class TestWhatTheStoreWasGiven:
    """A default seeds a name; only a write gives it a value of its own (REQ-3.2.1.5)."""

    def test_a_default_seeds_a_missing_name_without_noting_a_write(self) -> None:
        store = LazyVariables()

        assert store.setdefault("port", 8080) == 8080
        assert store["port"] == 8080
        assert store.written_names() == frozenset()

    def test_a_default_leaves_a_name_that_holds_a_value(self) -> None:
        store = LazyVariables({"port": 8080})

        assert store.setdefault("port", 9090) == 8080
        assert store["port"] == 8080

    def test_a_default_leaves_a_written_name_noted_as_written(self) -> None:
        store = LazyVariables()
        store["port"] = 8080

        store.setdefault("port", 9090)

        assert store.written_names() == frozenset({"port"})

    def test_a_default_reads_a_pending_expression_instead_of_replacing_it(self) -> None:
        store = LazyVariables({"a": 1}, expr_map={"b": ("a + 1", "integer")})

        assert store.setdefault("b", 99) == 2

    def test_given_holds_only_the_written_names(self) -> None:
        store = LazyVariables({"seeded": "s"})
        store.setdefault("defaulted", "d")
        store["written"] = "w"

        assert dict(store.given()) == {"written": "w"}

    def test_given_keeps_the_order_the_names_entered_the_store(self) -> None:
        store = LazyVariables({"b": 0, "a": 0, "c": 0})
        for name in ("c", "a", "b"):
            store[name] = 1

        assert list(store.given()) == ["b", "a", "c"]

    def test_given_names_stay_written_in_the_copy(self) -> None:
        store = LazyVariables()
        store["written"] = "w"

        assert store.given().written_names() == frozenset({"written"})
        assert dict(store.given().given()) == {"written": "w"}

    def test_given_is_a_store_of_its_own(self) -> None:
        store = LazyVariables()
        store["written"] = "w"

        copy = store.given()
        copy["written"] = "changed"
        copy["other"] = 1

        assert dict(store) == {"written": "w"}
        assert store.written_names() == frozenset({"written"})


class TestWhatAResultWasEvaluatedFrom:
    """The store notes the source of each evaluated result it still holds (REQ-3.2.1.5)."""

    @staticmethod
    def _evaluated() -> LazyVariables:
        store = LazyVariables(
            {"a": 1},
            expr_map={"b": ("a + 1", "integer")},
            tmpl_map={"t": "a={{ a }}"},
        )
        assert (store["b"], store["t"]) == (2, "a=1")
        return store

    def test_nothing_is_noted_before_a_read(self) -> None:
        store = LazyVariables({"a": 1}, expr_map={"b": ("a + 1", "integer")})

        assert store.evaluated_sources() == {}

    def test_an_expression_notes_its_source_and_type_and_a_template_its_source(self) -> None:
        assert self._evaluated().evaluated_sources() == {
            "b": ("a + 1", "integer"),
            "t": "a={{ a }}",
        }

    def test_a_write_forgets_the_note(self) -> None:
        store = self._evaluated()
        store["b"] = 5

        assert store.evaluated_sources() == {"t": "a={{ a }}"}

    def test_a_delete_forgets_the_note(self) -> None:
        store = self._evaluated()
        del store["t"]

        assert store.evaluated_sources() == {"b": ("a + 1", "integer")}

    def test_a_re_armed_expression_forgets_the_note(self) -> None:
        store = self._evaluated()
        store.set_expression("b", "a + 2", "integer")

        assert store.evaluated_sources() == {"t": "a={{ a }}"}

    def test_a_re_armed_template_forgets_the_note(self) -> None:
        store = self._evaluated()
        store.set_template("t", "{{ a }}")

        assert store.evaluated_sources() == {"b": ("a + 1", "integer")}

    def test_notes_handed_over_at_the_start_are_kept(self) -> None:
        store = LazyVariables({"b": 2}, evaluated={"b": ("a + 1", "integer")})

        assert store.evaluated_sources() == {"b": ("a + 1", "integer")}

    def test_the_notes_handed_out_are_a_copy(self) -> None:
        store = self._evaluated()
        store.evaluated_sources().clear()

        assert store.evaluated_sources() == {"b": ("a + 1", "integer"), "t": "a={{ a }}"}

    def test_only_an_evaluated_result_is_marked_stale(self) -> None:
        store = self._evaluated()
        store.mark_stale(["b", "a", "missing"])

        assert store.stale_names() == frozenset({"b"})

    def test_a_write_clears_the_stale_mark(self) -> None:
        store = self._evaluated()
        store.mark_stale(["b", "t"])
        store["b"] = 5

        assert store.stale_names() == frozenset({"t"})

    def test_a_result_stays_inside_a_run_when_a_block_writes_a_variable_it_reads(self) -> None:
        store = self._evaluated()
        store["a"] = 10

        assert (store["b"], store["t"]) == (2, "a=1")


class TestLazyVariablesCycleDetection:
    """Defensive cycle detection during recursive ``__getitem__``."""

    def test_evaluate_raises_on_self_reference(self) -> None:
        captured: list[tuple[str, Any]] = []

        # An expression that reads its own pending name forces the recursion
        # guard to fire. The plugin executor wraps the ValueError in an
        # InvalidExpressionError, so callers see the same surface as any
        # other expression failure but the underlying message is preserved.
        wrapper = LazyVariables(
            {},
            expr_map={"recursive": ("recursive + 1", "integer")},
            on_evaluated=lambda name, value: captured.append((name, value)),
        )

        with pytest.raises(
            Exception,
            match=(
                r"^Expression evaluation failed for 'recursive \+ 1': "
                r"Circular reference detected for variable 'recursive': recursive -> recursive$"
            ),
        ):
            _ = wrapper["recursive"]

        # The callback never fired because the evaluation aborted.
        assert captured == []


class TestLazyVariablesSetExpression:
    """Re-arm a runtime variable as a pending expression (REQ-3.2.1.6).

    ``set_expression`` is the inverse of ``_evaluate``'s realize step: it
    repopulates ``_expr_map`` and drops any realized value, so the next
    ``__getitem__`` re-evaluates the NEW source lazily. This backs the
    Current-mode expression override (change the source, do not pin a
    literal) so the value re-evaluates on next reference.
    """

    def test_set_expression_returns_none(self) -> None:
        wrapper = LazyVariables({})
        assert wrapper.set_expression("x", "1 + 1", "integer") is None

    def test_set_expression_marks_name_pending(self) -> None:
        wrapper = LazyVariables({})
        wrapper.set_expression("x", "1 + 1", "integer")
        assert wrapper.has_pending_expressions()
        assert "x" in set(wrapper.pending_expression_names())

    def test_set_expression_keeps_name_out_of_realized_snapshot(self) -> None:
        # A re-armed name must stay invisible to serializers / diffs (which
        # read the realized snapshot) until something references it.
        wrapper = LazyVariables({"x": 5})
        wrapper.set_expression("x", "1 + 1", "integer")
        assert "x" not in wrapper.copy()
        assert len(wrapper) == 0
        assert list(iter(wrapper)) == []

    def test_set_expression_discards_prior_realized_value(self) -> None:
        wrapper = LazyVariables({"x": 5})
        wrapper.set_expression("x", "10 + 10", "integer")
        # Next read re-evaluates the NEW source; the old realized 5 is gone.
        assert wrapper["x"] == 20

    def test_set_expression_reevaluates_on_next_getitem(self) -> None:
        wrapper = LazyVariables({})
        wrapper.set_expression("x", "2 + 3", "integer")
        assert wrapper["x"] == 5
        # After the read it is realized, no longer pending.
        assert not wrapper.has_pending_expressions()

    def test_set_expression_supersedes_existing_pending_expression(self) -> None:
        wrapper = LazyVariables({}, expr_map={"x": ("1", "integer")})
        wrapper.set_expression("x", "9", "integer")
        # The new source wins over the prior pending source.
        assert wrapper["x"] == 9

    def test_set_expression_does_not_fire_on_evaluated_callback(self) -> None:
        captured: list[tuple[str, Any]] = []
        wrapper = LazyVariables(
            {"x": 1},
            on_evaluated=lambda name, value: captured.append((name, value)),
        )
        wrapper.set_expression("x", "4 + 4", "integer")
        # Re-arming is silent; the broadcast only fires when the next
        # reference realizes the expression.
        assert captured == []
        assert wrapper["x"] == 8
        assert captured == [("x", 8)]


class TestLazyVariablesSecretRegistration:
    """Secret-flagged names register their values on write and realization (REQ-3.1.3.5)."""

    @staticmethod
    def _registry() -> Any:
        from wavecore.core.secrets.registry import SecretRegistry

        return SecretRegistry()

    def test_setitem_on_flagged_name_registers_the_value(self) -> None:
        registry = self._registry()
        registry.mark_name("token")
        wrapper = LazyVariables({}, secret_registry=registry)

        wrapper["token"] = "s3cr3t-t0ken-99"

        assert "s3cr3t-t0ken-99" in registry.scan_values()

    def test_setitem_on_unflagged_name_registers_nothing(self) -> None:
        registry = self._registry()
        wrapper = LazyVariables({}, secret_registry=registry)

        wrapper["plain"] = "not-a-secret-value"

        assert registry.scan_values() == ()

    def test_expression_realization_registers_flagged_value(self) -> None:
        registry = self._registry()
        registry.mark_name("token")
        wrapper = LazyVariables(
            {},
            expr_map={"token": ("'s3cr3t-' + 't0ken-99'", "string")},
            secret_registry=registry,
        )

        assert registry.scan_values() == ()
        assert wrapper["token"] == "s3cr3t-t0ken-99"
        assert "s3cr3t-t0ken-99" in registry.scan_values()

    def test_template_realization_registers_flagged_value(self) -> None:
        registry = self._registry()
        registry.mark_name("token")
        wrapper = LazyVariables(
            {"part": "t0ken-99"},
            tmpl_map={"token": "s3cr3t-{{ part }}"},
            secret_registry=registry,
        )

        assert wrapper["token"] == "s3cr3t-t0ken-99"
        assert "s3cr3t-t0ken-99" in registry.scan_values()

    def test_expression_realization_of_unflagged_name_registers_nothing(self) -> None:
        registry = self._registry()
        wrapper = LazyVariables(
            {},
            expr_map={"plain": ("'visible-' + 'value'", "string")},
            secret_registry=registry,
        )

        assert wrapper["plain"] == "visible-value"
        assert registry.scan_values() == ()

    def test_no_registry_keeps_prior_behavior(self) -> None:
        wrapper = LazyVariables({}, expr_map={"a": ("1 + 1", "integer")})

        wrapper["token"] = "s3cr3t-t0ken-99"

        assert wrapper["a"] == 2
        assert wrapper["token"] == "s3cr3t-t0ken-99"


class TestExpressionVariablesAreReadOnly:
    """An expression variable is a read: it may not change another variable.

    Same guard, same message as a Block config expression field. The variable
    stays pending after a refusal so a corrected source can be re-armed.
    """

    def test_mutating_expression_variable_is_refused_on_read(self) -> None:
        from wavecore.core.expressions.errors import BlockedExpressionError

        rows: list[int] = [1, 2]
        wrapper = LazyVariables(
            {"rows": rows},
            expr_map={"sneaky": ("rows.append(99)", "string")},
        )
        with pytest.raises(BlockedExpressionError) as exc_info:
            wrapper["sneaky"]
        assert str(exc_info.value) == (
            "The append method changes data. An expression can only read data, "
            "not change it. To change a variable, add a Variable Setter Block. "
            "Expression: rows.append(99)"
        )
        assert rows == [1, 2]

    def test_refused_expression_variable_stays_pending(self) -> None:
        from wavecore.core.expressions.errors import BlockedExpressionError

        wrapper = LazyVariables(
            {"rows": [1]},
            expr_map={"sneaky": ("rows.append(99)", "string")},
        )
        with pytest.raises(BlockedExpressionError):
            wrapper["sneaky"]
        assert wrapper.has_pending_expressions()
        assert list(wrapper.pending_expression_names()) == ["sneaky"]

    def test_mutating_expression_variable_message_matches_a_config_field(self) -> None:
        from wavecore.core.execution.plugin_executor import resolve_parameters
        from wavecore.core.expressions.errors import BlockedExpressionError

        wrapper = LazyVariables(
            {"rows": [1]},
            expr_map={"sneaky": ("rows.append(99)", "string")},
        )
        with pytest.raises(BlockedExpressionError) as variable_exc:
            wrapper["sneaky"]
        with pytest.raises(BlockedExpressionError) as field_exc:
            resolve_parameters(
                parameters={"body": "rows.append(99)"},
                expression_fields={"body"},
                variables={"rows": [1]},
                parameter_types={},
            )
        assert str(variable_exc.value) == str(field_exc.value)

    def test_reading_expression_variable_is_unaffected(self) -> None:
        wrapper = LazyVariables(
            {"rows": [3, 1, 2]},
            expr_map={"total": ("len(rows)", "integer"), "top": ("sorted(rows)", "array")},
        )
        assert wrapper["total"] == 3
        assert wrapper["top"] == [1, 2, 3]


class TestRefusalReachesTheReaderUnwrapped:
    """A refused expression variable read from inside another expression keeps
    its own sentence: it is not re-wrapped as an evaluation failure."""

    def test_nested_read_of_a_mutating_expression_variable_keeps_the_sentence(self) -> None:
        from wavecore.core.execution.plugin_executor import evaluate_expression
        from wavecore.core.expressions.errors import BlockedExpressionError

        rows: list[int] = [1, 2]
        wrapper = LazyVariables(
            {"rows": rows},
            expr_map={"sneaky": ("rows.append(99)", "string")},
        )
        with pytest.raises(BlockedExpressionError) as exc_info:
            evaluate_expression("str(sneaky)", wrapper)

        assert str(exc_info.value) == (
            "The append method changes data. An expression can only read data, "
            "not change it. To change a variable, add a Variable Setter Block. "
            "Expression: rows.append(99)"
        )
        assert rows == [1, 2]


class TestANestedFailureNamesOneExpression:
    """A failure inside a nested read carries at most one "Expression evaluation failed for"
    context: the one that already names the failing expression; a failure with no such
    context gets the reader's."""

    def test_a_failure_already_named_passes_through_once(self) -> None:
        from wavecore.core.execution.plugin_executor import evaluate_expression
        from wavecore.core.expressions.errors import InvalidExpressionError

        wrapper = LazyVariables({}, expr_map={"inner": ("1 / 0", "integer")})

        with pytest.raises(InvalidExpressionError) as exc_info:
            evaluate_expression("inner * 2", wrapper)

        assert str(exc_info.value) == "Expression evaluation failed for '1 / 0': division by zero"

    def test_a_failure_with_no_context_gets_the_readers(self) -> None:
        from wavecore.core.execution.plugin_executor import evaluate_expression
        from wavecore.core.expressions.errors import InvalidExpressionError

        wrapper = LazyVariables({}, expr_map={"inner": ("missing + 1", "integer")})

        with pytest.raises(InvalidExpressionError) as exc_info:
            evaluate_expression("inner * 2", wrapper)

        assert re.match(
            r"^Expression evaluation failed for 'inner \* 2': Variable 'missing' is not defined",
            str(exc_info.value),
        ), str(exc_info.value)


class TestTemplateVariableNullPieces:
    """A template variable's null piece fails and names the variable (REQ-3.1.3.15)."""

    def test_a_null_piece_names_the_piece_and_the_variable(self) -> None:
        from wavecore.core.expressions.errors import NullValueError

        store = LazyVariables({"user_id": None}, tmpl_map={"profile_url": "/users/{{ user_id }}"})

        message = "'{{ user_id }}' in 'profile_url' is null"
        with pytest.raises(NullValueError, match=f"^{re.escape(message)}$"):
            store["profile_url"]

    def test_an_expression_variable_that_gives_null_fails_the_template_reading_it(self) -> None:
        from wavecore.core.expressions.errors import NullValueError

        store = LazyVariables(
            {"m": {}},
            expr_map={"uid": ("m.get('id')", "integer")},
            tmpl_map={"profile_url": "/users/{{ uid }}"},
        )

        message = "'{{ uid }}' in 'profile_url' is null"
        with pytest.raises(NullValueError, match=f"^{re.escape(message)}$"):
            store["profile_url"]

    def test_a_refused_template_stays_pending_until_its_piece_holds_a_value(self) -> None:
        from wavecore.core.expressions.errors import NullValueError

        captured: list[tuple[str, Any]] = []
        store = LazyVariables(
            {"user_id": None},
            tmpl_map={"profile_url": "/users/{{ user_id }}"},
            on_evaluated=lambda name, value: captured.append((name, value)),
        )
        with pytest.raises(NullValueError):
            store["profile_url"]
        assert captured == []

        store["user_id"] = 7

        assert store["profile_url"] == "/users/7"
        assert captured == [("profile_url", "/users/7")]

    def test_a_piece_that_falls_back_renders(self) -> None:
        store = LazyVariables({"user": None}, tmpl_map={"greeting": "hi {{ user or 'guest' }}"})

        assert store["greeting"] == "hi guest"

    def test_an_expression_reading_the_template_keeps_the_null_message(self) -> None:
        from wavecore.core.execution.plugin_executor import evaluate_expression
        from wavecore.core.expressions.errors import NullValueError

        store = LazyVariables({"user_id": None}, tmpl_map={"greeting": "hi {{ user_id }}"})

        message = "'{{ user_id }}' in 'greeting' is null"
        with pytest.raises(NullValueError, match=f"^{re.escape(message)}$"):
            evaluate_expression("greeting.upper()", store)


class TestExpressionVariableHoldsNull:
    """An expression variable whose result is null holds null of its type (REQ-3.1.3.20)."""

    @pytest.mark.parametrize(
        "var_type", ["string", "integer", "float", "boolean", "array", "map", "table"]
    )
    def test_a_null_result_is_held_without_error(self, var_type: str) -> None:
        captured: list[tuple[str, Any]] = []
        store = LazyVariables(
            {"headers": {}},
            expr_map={"trace": ("headers.get('X-Trace')", var_type)},
            on_evaluated=lambda name, value: captured.append((name, value)),
        )

        assert store["trace"] is None
        assert store.copy() == {"headers": {}, "trace": None}
        assert captured == [("trace", None)]
        assert not store.has_pending_expressions()


class TestExpressionVariableHoldsItsDeclaredType:
    """An expression variable holds its result as its declared type (REQ-3.1.3.13)."""

    @staticmethod
    def _realized(source: str, var_type: str, initial: dict[str, Any] | None = None) -> Any:
        captured: list[Any] = []
        store = LazyVariables(
            initial,
            expr_map={"computed": (source, var_type)},
            on_evaluated=lambda _name, value: captured.append(value),
        )
        value = store["computed"]
        assert captured == [value]
        assert store.copy()["computed"] is value
        return value

    def test_a_table_is_held_as_a_table_of_its_rows(self) -> None:
        from wavecore.core.table import Table

        value = self._realized("[{'k': 1}, {'k': 2}]", "table")

        assert isinstance(value, Table)
        assert value.col_names() == ["k"]
        assert [row["k"] for row in value] == [1, 2]

    def test_a_table_read_from_another_table_is_that_table(self) -> None:
        from wavecore.core.table import Table

        source = Table.from_list([{"k": 1}])

        assert self._realized("src", "table", {"src": source}) is source

    def test_a_float_is_held_exact(self) -> None:
        from decimal import Decimal

        value = self._realized("1.5 * 3", "float")

        assert isinstance(value, Decimal)
        assert value == Decimal("4.5")

    def test_a_whole_number_given_to_a_float_is_an_exact_float(self) -> None:
        from decimal import Decimal

        from wavecore.core.variables.decimal_value import decimal_to_str

        value = self._realized("2 + 3", "float")

        assert isinstance(value, Decimal)
        assert decimal_to_str(value) == "5"

    @pytest.mark.parametrize(
        "source",
        [
            pytest.param("[1, 2]", id="scalars"),
            pytest.param("[[1], 2]", id="nested-list"),
            pytest.param("[{'k': 1}, 2]", id="rows-and-a-scalar"),
        ],
    )
    def test_a_list_that_is_not_rows_is_refused_as_a_table(self, source: str) -> None:
        from wavecore.core.expressions.errors import ExpressionTypeError

        store = LazyVariables(expr_map={"computed": (source, "table")})

        with pytest.raises(
            ExpressionTypeError, match=r"^Parameter 'computed' expects table, got list$"
        ):
            store["computed"]
        assert store.has_pending_expressions()

    @pytest.mark.parametrize(
        ("source", "var_type", "expected"),
        [
            pytest.param("'[1]' + ''", "string", "[1]", id="string"),
            pytest.param("2 + 3", "integer", 5, id="integer"),
            pytest.param("2 > 1", "boolean", True, id="boolean"),
            pytest.param("['[1]', 1.5]", "array", ["[1]", 1.5], id="array"),
            pytest.param("{'k': '{\"a\": 1}'}", "map", {"k": '{"a": 1}'}, id="map"),
        ],
    )
    def test_any_other_type_keeps_the_result_as_it_is(
        self, source: str, var_type: str, expected: Any
    ) -> None:
        value = self._realized(source, var_type)

        assert value == expected
        assert type(value) is type(expected)
