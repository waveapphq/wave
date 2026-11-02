"""
Tests for expression_security module.

Tests the centralized security configuration for expression evaluation.
"""

import re
from collections.abc import Collection
from pathlib import Path

import pytest

from wavecore.core.expressions.security import (
    BLOCKED_FUNCTION_NAMES,
    BLOCKED_SUBSTRINGS,
    FIELD_BLOCKED_CONSTRUCTORS,
    MUTATING_METHOD_NAMES,
    SAFE_BUILTINS,
    get_safe_eval_context,
    is_blocked,
)
from wavecore.core.table import ColumnType, Table, TableRowView

TABLE_MUTATORS = (
    "set_cell",
    "set_row",
    "clear",
    "add_row",
    "insert_row",
    "remove_row",
    "add_col",
    "insert_col",
    "remove_col",
)


class TestBlockedPatterns:
    """Tests for blocked patterns configuration."""

    def test_blocked_substrings_contains_dunder(self) -> None:
        """Verify __ is blocked to prevent sandbox escape."""
        assert "__" in BLOCKED_SUBSTRINGS

    def test_blocked_function_names_contains_import(self) -> None:
        """Verify import is blocked."""
        assert "import" in BLOCKED_FUNCTION_NAMES

    def test_blocked_function_names_contains_exec(self) -> None:
        """Verify exec is blocked."""
        assert "exec" in BLOCKED_FUNCTION_NAMES

    def test_blocked_function_names_contains_eval(self) -> None:
        """Verify eval is blocked."""
        assert "eval" in BLOCKED_FUNCTION_NAMES

    def test_blocked_function_names_contains_open(self) -> None:
        """Verify open is blocked."""
        assert "open" in BLOCKED_FUNCTION_NAMES

    def test_blocked_function_names_contains_getattr(self) -> None:
        """Verify getattr is blocked."""
        assert "getattr" in BLOCKED_FUNCTION_NAMES


class TestSafeBuiltins:
    """Tests for SAFE_BUILTINS configuration."""

    def test_safe_builtins_contains_str(self) -> None:
        """Verify str is available."""
        assert SAFE_BUILTINS["str"] is str

    def test_safe_builtins_contains_len(self) -> None:
        """Verify len is available."""
        assert SAFE_BUILTINS["len"] is len

    def test_safe_builtins_contains_int(self) -> None:
        """Verify int is available."""
        assert SAFE_BUILTINS["int"] is int

    def test_safe_builtins_excludes_eval(self) -> None:
        """Verify eval is not in safe builtins."""
        assert "eval" not in SAFE_BUILTINS

    def test_safe_builtins_excludes_exec(self) -> None:
        """Verify exec is not in safe builtins."""
        assert "exec" not in SAFE_BUILTINS

    def test_safe_builtins_excludes_open(self) -> None:
        """Verify open is not in safe builtins."""
        assert "open" not in SAFE_BUILTINS

    def test_safe_builtins_contains_table(self) -> None:
        """Verify Table class is available."""
        assert SAFE_BUILTINS["Table"] is Table

    def test_safe_builtins_contains_tablerowview(self) -> None:
        """Verify TableRowView class is available."""
        assert SAFE_BUILTINS["TableRowView"] is TableRowView

    def test_safe_builtins_contains_columntype(self) -> None:
        """Verify ColumnType enum is available."""
        assert SAFE_BUILTINS["ColumnType"] is ColumnType


FRONTEND_SANDBOX = (
    Path(__file__).resolve().parents[3]
    / "frontend/src/features/workbench/lib/expression-sandbox.ts"
)

# Each frontend set and the backend list it must equal.
SANDBOX_TWINS: dict[str, Collection[str]] = {
    "EXPRESSION_SAFE_NAMES": SAFE_BUILTINS,
    "BLOCKED_SUBSTRINGS": BLOCKED_SUBSTRINGS,
    "BLOCKED_FUNCTION_NAMES": BLOCKED_FUNCTION_NAMES,
    "FIELD_BLOCKED_CONSTRUCTORS": FIELD_BLOCKED_CONSTRUCTORS,
    "MUTATING_METHOD_NAMES": MUTATING_METHOD_NAMES,
}


def _frontend_list(name: str) -> list[str]:
    """The entries of the frontend set `name`, in file order."""
    source = FRONTEND_SANDBOX.read_text(encoding="utf-8")
    body = re.search(rf"{name}\b[^=]*=\s*new Set\(\[(.*?)\]\)", source, re.DOTALL)
    assert body is not None, f"{name} not found in {FRONTEND_SANDBOX}"
    return re.findall(r"""['"]([A-Za-z_]\w*)['"]""", body.group(1))


class TestFrontendSandboxLists:
    """The frontend reads the sandbox's lists from one file whose sets equal the backend's."""

    @pytest.mark.parametrize("name", SANDBOX_TWINS)
    def test_frontend_set_equals_its_backend_twin(self, name: str) -> None:
        frontend, backend = set(_frontend_list(name)), set(SANDBOX_TWINS[name])
        assert frontend == backend, (
            f"{name}: missing in the frontend: {sorted(backend - frontend)}; "
            f"not in the backend: {sorted(frontend - backend)}"
        )

    @pytest.mark.parametrize("name", SANDBOX_TWINS)
    def test_frontend_set_lists_each_entry_once(self, name: str) -> None:
        entries = _frontend_list(name)
        assert len(entries) == len(set(entries))


class TestIsBlocked:
    """Tests for is_blocked function."""

    def test_is_blocked_returns_pattern_when_blocked(self) -> None:
        """Verify is_blocked returns the blocked pattern."""
        result = is_blocked("__import__('os')")
        assert result == "__"

    def test_is_blocked_returns_none_when_safe(self) -> None:
        """Verify is_blocked returns None for safe expressions."""
        result = is_blocked("username.upper()")
        assert result is None

    def test_is_blocked_case_insensitive(self) -> None:
        """Verify is_blocked is case insensitive for function calls."""
        result = is_blocked("OPEN('/etc/passwd')")
        assert result == "open"

    def test_is_blocked_detects_exec(self) -> None:
        """Verify exec pattern is detected."""
        result = is_blocked("exec('code')")
        assert result == "exec"

    def test_is_blocked_detects_eval(self) -> None:
        """Verify eval pattern is detected."""
        result = is_blocked("eval('code')")
        assert result == "eval"

    def test_is_blocked_detects_open(self) -> None:
        """Verify open pattern is detected."""
        result = is_blocked("open('/etc/passwd')")
        assert result == "open"


class TestGetSafeEvalContext:
    """Tests for get_safe_eval_context function."""

    def test_returns_tuple_of_dicts(self) -> None:
        """Verify function returns tuple of two dicts."""
        globals_dict, locals_dict = get_safe_eval_context()
        assert isinstance(globals_dict, dict)
        assert isinstance(locals_dict, dict)

    def test_globals_contain_safe_builtins(self) -> None:
        """Verify globals contains __builtins__ with safe functions."""
        globals_dict, _ = get_safe_eval_context()
        assert "__builtins__" in globals_dict
        assert globals_dict["__builtins__"] is SAFE_BUILTINS

    def test_locals_empty_by_default(self) -> None:
        """Verify locals is empty when no variables provided."""
        _, locals_dict = get_safe_eval_context()
        assert locals_dict == {}

    def test_locals_contains_provided_variables(self) -> None:
        """Verify locals contains provided variables."""
        my_vars = {"x": 10, "name": "test"}
        _, locals_dict = get_safe_eval_context(my_vars)
        assert locals_dict == my_vars

    def test_can_eval_with_context(self) -> None:
        """Verify the context can be used for safe eval."""
        globals_dict, locals_dict = get_safe_eval_context({"x": 5})
        result = eval("x + 10", globals_dict, locals_dict)
        assert result == 15

    def test_eval_blocks_dangerous_functions(self) -> None:
        """Verify dangerous functions are not available in context."""
        globals_dict, locals_dict = get_safe_eval_context()
        with pytest.raises(NameError):
            eval("open('/etc/passwd')", globals_dict, locals_dict)

    def test_can_eval_with_table(self) -> None:
        """Verify Table can be used in eval context."""
        table = Table.from_list([{"a": 1, "b": 2}, {"a": 3, "b": 4}])
        globals_dict, locals_dict = get_safe_eval_context({"t": table})
        result = eval("t[0][0]", globals_dict, locals_dict)
        assert result == 1

    def test_can_eval_table_methods(self) -> None:
        """Verify Table methods can be called in eval context."""
        table = Table.from_list([{"x": 10}, {"x": 20}, {"x": 30}])
        globals_dict, locals_dict = get_safe_eval_context({"t": table})
        result = eval("t.col('x')", globals_dict, locals_dict)
        assert result == [10, 20, 30]

    def test_can_create_table_in_eval(self) -> None:
        """Verify Table can be created in eval context."""
        globals_dict, locals_dict = get_safe_eval_context()
        result = eval("Table(columns=['a', 'b'])", globals_dict, locals_dict)
        assert isinstance(result, Table)
        assert result.col_names() == ["a", "b"]


class TestAllAllowedFunctions:
    """Comprehensive tests for ALL allowed functions in SAFE_BUILTINS.

    These tests verify that each function in SAFE_BUILTINS actually works
    when used in eval() with the safe context.
    """

    def test_str_function(self) -> None:
        """Verify str() works in safe eval."""
        globals_dict, locals_dict = get_safe_eval_context({"x": 42})
        result = eval("str(x)", globals_dict, locals_dict)
        assert result == "42"

    def test_int_function(self) -> None:
        """Verify int() works in safe eval."""
        globals_dict, locals_dict = get_safe_eval_context({"x": "123"})
        result = eval("int(x)", globals_dict, locals_dict)
        assert result == 123

    def test_float_function(self) -> None:
        """Verify float() works in safe eval."""
        globals_dict, locals_dict = get_safe_eval_context({"x": "3.14"})
        result = eval("float(x)", globals_dict, locals_dict)
        assert result == 3.14

    def test_bool_function(self) -> None:
        """Verify bool() works in safe eval."""
        globals_dict, locals_dict = get_safe_eval_context({"x": 0})
        result = eval("bool(x)", globals_dict, locals_dict)
        assert result is False

    def test_type_function(self) -> None:
        """Verify type() works in safe eval."""
        globals_dict, locals_dict = get_safe_eval_context({"x": 42})
        result = eval("type(x)", globals_dict, locals_dict)
        assert result is int

    def test_list_function(self) -> None:
        """Verify list() works in safe eval."""
        globals_dict, locals_dict = get_safe_eval_context({"x": (1, 2, 3)})
        result = eval("list(x)", globals_dict, locals_dict)
        assert result == [1, 2, 3]

    def test_dict_function(self) -> None:
        """Verify dict() works in safe eval."""
        globals_dict, locals_dict = get_safe_eval_context()
        result = eval("dict(a=1, b=2)", globals_dict, locals_dict)
        assert result == {"a": 1, "b": 2}

    def test_set_function(self) -> None:
        """Verify set() works in safe eval."""
        globals_dict, locals_dict = get_safe_eval_context({"x": [1, 2, 2, 3]})
        result = eval("set(x)", globals_dict, locals_dict)
        assert result == {1, 2, 3}

    def test_abs_function(self) -> None:
        """Verify abs() works in safe eval."""
        globals_dict, locals_dict = get_safe_eval_context({"x": -5})
        result = eval("abs(x)", globals_dict, locals_dict)
        assert result == 5

    def test_round_function(self) -> None:
        """Verify round() works in safe eval."""
        globals_dict, locals_dict = get_safe_eval_context({"x": 3.14159})
        result = eval("round(x, 2)", globals_dict, locals_dict)
        assert result == 3.14

    def test_min_function(self) -> None:
        """Verify min() works in safe eval."""
        globals_dict, locals_dict = get_safe_eval_context({"x": [5, 2, 8, 1]})
        result = eval("min(x)", globals_dict, locals_dict)
        assert result == 1

    def test_max_function(self) -> None:
        """Verify max() works in safe eval."""
        globals_dict, locals_dict = get_safe_eval_context({"x": [5, 2, 8, 1]})
        result = eval("max(x)", globals_dict, locals_dict)
        assert result == 8

    def test_sum_function(self) -> None:
        """Verify sum() works in safe eval."""
        globals_dict, locals_dict = get_safe_eval_context({"x": [1, 2, 3, 4]})
        result = eval("sum(x)", globals_dict, locals_dict)
        assert result == 10

    def test_len_function(self) -> None:
        """Verify len() works in safe eval."""
        globals_dict, locals_dict = get_safe_eval_context({"x": [1, 2, 3]})
        result = eval("len(x)", globals_dict, locals_dict)
        assert result == 3

    def test_sorted_function(self) -> None:
        """Verify sorted() works in safe eval."""
        globals_dict, locals_dict = get_safe_eval_context({"x": [3, 1, 4, 1, 5]})
        result = eval("sorted(x)", globals_dict, locals_dict)
        assert result == [1, 1, 3, 4, 5]

    def test_reversed_function(self) -> None:
        """Verify reversed() works in safe eval."""
        globals_dict, locals_dict = get_safe_eval_context({"x": [1, 2, 3]})
        result = eval("list(reversed(x))", globals_dict, locals_dict)
        assert result == [3, 2, 1]

    def test_range_function(self) -> None:
        """Verify range() works in safe eval."""
        globals_dict, locals_dict = get_safe_eval_context()
        result = eval("list(range(5))", globals_dict, locals_dict)
        assert result == [0, 1, 2, 3, 4]

    def test_map_function(self) -> None:
        """Verify map() works in safe eval with lambda."""
        globals_dict, locals_dict = get_safe_eval_context({"x": [1, 2, 3]})
        result = eval("list(map(lambda n: n * 2, x))", globals_dict, locals_dict)
        assert result == [2, 4, 6]

    def test_filter_function(self) -> None:
        """Verify filter() works in safe eval with lambda."""
        globals_dict, locals_dict = get_safe_eval_context({"x": [1, 2, 3, 4, 5]})
        result = eval("list(filter(lambda n: n > 2, x))", globals_dict, locals_dict)
        assert result == [3, 4, 5]

    def test_slice_function(self) -> None:
        """Verify slice() works in safe eval."""
        globals_dict, locals_dict = get_safe_eval_context({"x": [0, 1, 2, 3, 4]})
        result = eval("x[slice(1, 4)]", globals_dict, locals_dict)
        assert result == [1, 2, 3]

    def test_any_function(self) -> None:
        """Verify any() works in safe eval."""
        globals_dict, locals_dict = get_safe_eval_context({"x": [False, True, False]})
        result = eval("any(x)", globals_dict, locals_dict)
        assert result is True

    def test_all_function(self) -> None:
        """Verify all() works in safe eval."""
        globals_dict, locals_dict = get_safe_eval_context({"x": [True, True, True]})
        result = eval("all(x)", globals_dict, locals_dict)
        assert result is True

    def test_format_function(self) -> None:
        """Verify format() works in safe eval."""
        globals_dict, locals_dict = get_safe_eval_context({"x": 42})
        result = eval("format(x, '05d')", globals_dict, locals_dict)
        assert result == "00042"

    def test_true_constant(self) -> None:
        """Verify True constant is available."""
        globals_dict, locals_dict = get_safe_eval_context()
        result = eval("True", globals_dict, locals_dict)
        assert result is True

    def test_false_constant(self) -> None:
        """Verify False constant is available."""
        globals_dict, locals_dict = get_safe_eval_context()
        result = eval("False", globals_dict, locals_dict)
        assert result is False

    def test_none_constant(self) -> None:
        """Verify None constant is available."""
        globals_dict, locals_dict = get_safe_eval_context()
        result = eval("None", globals_dict, locals_dict)
        assert result is None


class TestExcludedBuiltins:
    """Noise builtins with no use in WAVE expressions stay out of SAFE_BUILTINS."""

    def test_tuple_not_available(self) -> None:
        """Verify tuple() is not in SAFE_BUILTINS."""
        assert "tuple" not in SAFE_BUILTINS

    def test_pow_not_available(self) -> None:
        """Verify pow() is not in SAFE_BUILTINS (use ** operator instead)."""
        assert "pow" not in SAFE_BUILTINS

    def test_divmod_not_available(self) -> None:
        """Verify divmod() is not in SAFE_BUILTINS."""
        assert "divmod" not in SAFE_BUILTINS

    def test_enumerate_not_available(self) -> None:
        """Verify enumerate() is not in SAFE_BUILTINS."""
        assert "enumerate" not in SAFE_BUILTINS

    def test_zip_not_available(self) -> None:
        """Verify zip() is not in SAFE_BUILTINS."""
        assert "zip" not in SAFE_BUILTINS

    def test_chr_not_available(self) -> None:
        """Verify chr() is not in SAFE_BUILTINS."""
        assert "chr" not in SAFE_BUILTINS

    def test_ord_not_available(self) -> None:
        """Verify ord() is not in SAFE_BUILTINS."""
        assert "ord" not in SAFE_BUILTINS

    def test_bin_not_available(self) -> None:
        """Verify bin() is not in SAFE_BUILTINS."""
        assert "bin" not in SAFE_BUILTINS

    def test_hex_not_available(self) -> None:
        """Verify hex() is not in SAFE_BUILTINS."""
        assert "hex" not in SAFE_BUILTINS

    def test_oct_not_available(self) -> None:
        """Verify oct() is not in SAFE_BUILTINS."""
        assert "oct" not in SAFE_BUILTINS

    def test_ascii_not_available(self) -> None:
        """Verify ascii() is not in SAFE_BUILTINS."""
        assert "ascii" not in SAFE_BUILTINS

    def test_repr_not_available(self) -> None:
        """Verify repr() is not in SAFE_BUILTINS."""
        assert "repr" not in SAFE_BUILTINS

    def test_excluded_builtins_raise_name_error(self) -> None:
        """Verify excluded builtins raise NameError in eval context."""
        globals_dict, locals_dict = get_safe_eval_context({"x": [1, 2, 3]})

        excluded_calls = [
            "tuple(x)",
            "pow(2, 3)",
            "divmod(10, 3)",
            "enumerate(x)",
            "zip(x, x)",
            "chr(65)",
            "ord('A')",
            "bin(10)",
            "hex(255)",
            "oct(8)",
            "ascii('hello')",
            "repr(x)",
        ]

        for expr in excluded_calls:
            with pytest.raises(NameError):
                eval(expr, globals_dict, locals_dict)


class TestFormatNameError:
    """Tests for format_name_error function."""

    def test_format_unsupported_function(self) -> None:
        """Verify unsupported functions get clear error message."""
        from wavecore.core.expressions.security import format_name_error

        error = NameError("name 'zip' is not defined")
        message = format_name_error(error, "zip([1,2,3])")
        assert message == "Function 'zip' is not supported in expression context"

    def test_format_unknown_function(self) -> None:
        """Verify unknown functions get appropriate error message."""
        from wavecore.core.expressions.security import format_name_error

        error = NameError("name 'my_custom_func' is not defined")
        message = format_name_error(error, "my_custom_func(x)")
        assert message == "Function 'my_custom_func' is not recognized"

    def test_format_unknown_variable(self) -> None:
        """Verify unknown variables get appropriate error message."""
        from wavecore.core.expressions.security import format_name_error

        error = NameError("name 'unknown_var' is not defined")
        message = format_name_error(error, "unknown_var + 1")
        assert message == "Variable 'unknown_var' is not defined"

    def test_format_unsupported_enumerate(self) -> None:
        """Verify enumerate gets clear error message."""
        from wavecore.core.expressions.security import format_name_error

        error = NameError("name 'enumerate' is not defined")
        message = format_name_error(error, "list(enumerate(items))")
        assert message == "Function 'enumerate' is not supported in expression context"

    def test_format_unsupported_eval(self) -> None:
        """Verify eval gets clear error message (security blocked)."""
        from wavecore.core.expressions.security import format_name_error

        error = NameError("name 'eval' is not defined")
        message = format_name_error(error, "eval('code')")
        assert message == "Function 'eval' is not supported in expression context"

    def test_format_unexpected_error_format(self) -> None:
        """Verify fallback for unexpected NameError format (line 226)."""
        from wavecore.core.expressions.security import format_name_error

        # Create a NameError with an unexpected message format
        error = NameError("unexpected error format without the name pattern")
        message = format_name_error(error, "some_expression")
        assert "Expression evaluation failed for 'some_expression'" in message
        assert "unexpected error format" in message


class TestFormatNullError:
    """A failure caused by a null value reads in WAVE's words (REQ-3.1.3.23)."""

    @pytest.mark.parametrize(
        ("error", "expected"),
        [
            (
                TypeError("unsupported operand type(s) for +: 'NoneType' and 'int'"),
                "A value is null: unsupported operand type(s) for +: 'null' and 'int'",
            ),
            (
                TypeError('can only concatenate str (not "NoneType") to str'),
                'A value is null: can only concatenate str (not "null") to str',
            ),
            (
                TypeError("unsupported operand type(s) for -: 'NoneType' and 'NoneType'"),
                "A value is null: unsupported operand type(s) for -: 'null' and 'null'",
            ),
            (
                AttributeError("'NoneType' object has no attribute 'upper'"),
                "A value is null: 'null' object has no attribute 'upper'",
            ),
            (
                TypeError("'NoneType' object is not subscriptable"),
                "A value is null: 'null' object is not subscriptable",
            ),
        ],
        ids=["single-quotes", "double-quotes", "every-occurrence", "attribute", "subscript"],
    )
    def test_every_none_type_is_written_null(self, error: Exception, expected: str) -> None:
        from wavecore.core.expressions.security import format_null_error

        assert format_null_error(error) == expected

    @pytest.mark.parametrize(
        "error",
        [
            TypeError('can only concatenate str (not "int") to str'),
            ZeroDivisionError("division by zero"),
            KeyError("missing"),
        ],
        ids=["type-error", "division-by-zero", "key-error"],
    )
    def test_a_failure_with_no_none_type_gives_none(self, error: Exception) -> None:
        from wavecore.core.expressions.security import format_null_error

        assert format_null_error(error) is None


class TestFieldExpressionRestrictions:
    """Tests for field expression mutation blocking configuration."""

    def test_field_blocked_constructors_defined(self) -> None:
        """FIELD_BLOCKED_CONSTRUCTORS contains mutable constructors."""
        assert "list" in FIELD_BLOCKED_CONSTRUCTORS
        assert "dict" in FIELD_BLOCKED_CONSTRUCTORS
        assert "set" in FIELD_BLOCKED_CONSTRUCTORS

    def test_field_blocked_constructors_excludes_immutable(self) -> None:
        """FIELD_BLOCKED_CONSTRUCTORS does not contain immutable constructors."""
        assert "str" not in FIELD_BLOCKED_CONSTRUCTORS
        assert "int" not in FIELD_BLOCKED_CONSTRUCTORS
        assert "float" not in FIELD_BLOCKED_CONSTRUCTORS
        assert "bool" not in FIELD_BLOCKED_CONSTRUCTORS

    def test_mutating_method_names_contains_list_methods(self) -> None:
        """MUTATING_METHOD_NAMES contains list mutating methods."""
        for method in ["append", "extend", "insert", "remove", "pop", "clear", "sort", "reverse"]:
            assert method in MUTATING_METHOD_NAMES, f"Missing list method: {method}"

    def test_mutating_method_names_contains_dict_methods(self) -> None:
        """MUTATING_METHOD_NAMES contains dict mutating methods."""
        for method in ["update", "setdefault", "popitem"]:
            assert method in MUTATING_METHOD_NAMES, f"Missing dict method: {method}"

    def test_mutating_method_names_contains_set_methods(self) -> None:
        """MUTATING_METHOD_NAMES contains set mutating methods."""
        for method in ["add", "discard"]:
            assert method in MUTATING_METHOD_NAMES, f"Missing set method: {method}"

    def test_mutating_method_names_contains_table_methods(self) -> None:
        """MUTATING_METHOD_NAMES contains every method that mutates a table in place."""
        for method in TABLE_MUTATORS:
            assert method in MUTATING_METHOD_NAMES, f"Missing table method: {method}"

    def test_guarded_table_methods_exist_on_the_table_type(self) -> None:
        """A guarded name the type does not have guards nothing."""
        for method in TABLE_MUTATORS:
            assert hasattr(Table, method), f"Guarded name absent from Table: {method}"
        for absent in ("add_column", "remove_column", "rename_column"):
            assert absent not in MUTATING_METHOD_NAMES

    def test_table_query_methods_are_not_blocked(self) -> None:
        """filter and order_by return new tables, so they stay allowed in field expressions."""
        for method in ("filter", "order_by"):
            assert hasattr(Table, method)
            assert method not in MUTATING_METHOD_NAMES

    def test_mutating_method_names_excludes_read_methods(self) -> None:
        """MUTATING_METHOD_NAMES does not contain read-only methods."""
        for method in ["upper", "lower", "split", "join", "keys", "values", "get", "items"]:
            assert (
                method not in MUTATING_METHOD_NAMES
            ), f"Read-only method incorrectly blocked: {method}"


class TestRetiredCredentialHelpers:
    """The credential expression helpers are deleted: auth is
    the HTTP plugin's Auth config section, not an expression-language feature."""

    def test_retired_helper_names_are_not_whitelisted(self) -> None:
        """basic_auth / bearer / secret must not exist in the eval sandbox."""
        for name in ("basic_auth", "bearer", "secret"):
            assert name not in SAFE_BUILTINS

    def test_secret_result_builtins_surface_is_deleted(self) -> None:
        """The secret-result metadata surface is gone with the helpers."""
        import wavecore.core.expressions.security as security

        assert not hasattr(security, "SECRET_RESULT_BUILTINS")

    def test_retired_helpers_fail_evaluation_as_unknown_functions(self) -> None:
        from wavecore.core.execution.plugin_executor import evaluate_expression
        from wavecore.core.expressions.errors import InvalidExpressionError

        with pytest.raises(InvalidExpressionError, match="^Function 'bearer' is not recognized$"):
            evaluate_expression("bearer('tok-9')", {})

    def test_dunder_access_stays_blocked_regardless_of_name(self) -> None:
        assert is_blocked("basic_auth.__globals__") == "__"

    def test_import_dunder_stays_excluded_from_the_whitelist(self) -> None:
        assert "__import__" not in SAFE_BUILTINS


class TestTableQueryMethodsInExpressions:
    """Table.filter / Table.order_by are callable in expressions and pass the
    field-expression mutation guard. order_by is named to dodge the reserved
    'sort' method name: 'sort' is a mutating-method name the guard
    rejects, so the non-mutating ordering operation must not reuse it."""

    @staticmethod
    def _sales_table() -> Table:
        table = Table(columns=[("region", "string"), ("amount", "integer")])
        table.add_row(["west", 150])
        table.add_row(["east", 90])
        table.add_row(["north", 200])
        return table

    def test_filter_then_order_by_chains_in_expression(self) -> None:
        from wavecore.core.execution.plugin_executor import evaluate_expression

        table = self._sales_table()
        result = evaluate_expression(
            "t.filter('amount').greater_than(100).order_by('region')", {"t": table}
        )

        assert isinstance(result, Table)
        assert result.col("region") == ["north", "west"]
        assert result.col("amount") == [200, 150]

    def test_order_by_not_in_mutating_method_names(self) -> None:
        assert "order_by" not in MUTATING_METHOD_NAMES

    def test_filter_not_in_mutating_method_names(self) -> None:
        assert "filter" not in MUTATING_METHOD_NAMES

    def test_sort_remains_a_mutating_method_name(self) -> None:
        assert "sort" in MUTATING_METHOD_NAMES

    def test_order_by_passes_field_expression_guard(self) -> None:
        from wavecore.core.execution.plugin_executor import _check_field_mutations

        assert _check_field_mutations("t.order_by(('id', 'asc'))") is None

    def test_filter_passes_field_expression_guard(self) -> None:
        from wavecore.core.execution.plugin_executor import _check_field_mutations

        assert _check_field_mutations("t.filter('amount').greater_than(100)") is None

    def test_chained_filter_order_by_passes_field_expression_guard(self) -> None:
        from wavecore.core.execution.plugin_executor import _check_field_mutations

        assert (
            _check_field_mutations("t.filter('amount').greater_than(100).order_by('region')")
            is None
        )

    def test_sort_is_rejected_by_field_expression_guard(self) -> None:
        from wavecore.core.execution.plugin_executor import _check_field_mutations

        assert _check_field_mutations("t.sort()") == (
            "The sort method changes data. An expression can only read data, "
            "not change it. To change a variable, add a Variable Setter Block."
        )


class TestRefusalMessages:
    """Every refusal an author can read: plain, no nested quotes, says what to do."""

    def test_mutating_method_names_the_method_and_the_variable_setter(self) -> None:
        from wavecore.core.expressions.security import mutating_method_message

        assert mutating_method_message("append") == (
            "The append method changes data. An expression can only read data, "
            "not change it. To change a variable, add a Variable Setter Block."
        )

    def test_list_constructor_points_at_a_literal(self) -> None:
        from wavecore.core.expressions.security import blocked_constructor_message

        assert blocked_constructor_message("list") == (
            "The list function is not available in an expression. "
            "To build a list, write the items out like [a, b]."
        )

    def test_dict_constructor_points_at_a_map_literal(self) -> None:
        from wavecore.core.expressions.security import blocked_constructor_message

        assert blocked_constructor_message("dict") == (
            "The dict function is not available in an expression. "
            'To build a map, write the entries out like {"a": 1}.'
        )

    def test_set_constructor_points_at_a_set_literal(self) -> None:
        from wavecore.core.expressions.security import blocked_constructor_message

        assert blocked_constructor_message("set") == (
            "The set function is not available in an expression. "
            "To build a set, write the items out like {a, b}."
        )

    def test_double_underscore_names_the_rule_and_the_python_block(self) -> None:
        from wavecore.core.expressions.security import blocked_pattern_message

        assert blocked_pattern_message("__") == (
            "An expression cannot use names that contain two underscores. "
            "To run code that needs more than an expression, use a Python Block."
        )

    def test_a_blocked_function_names_the_function_and_the_python_block(self) -> None:
        from wavecore.core.expressions.security import blocked_pattern_message

        assert blocked_pattern_message("open") == (
            "The open function is not available in an expression. "
            "To run code that needs more than an expression, use a Python Block."
        )

    def test_no_refusal_nests_quotes_or_blames_security(self) -> None:
        from wavecore.core.execution.plugin_executor import evaluate_expression
        from wavecore.core.expressions.errors import BlockedExpressionError

        for expression in (
            "rows.append(9)",
            "list(rows)",
            "rows.__class__",
            "open('/etc/passwd')",
        ):
            with pytest.raises(BlockedExpressionError) as exc_info:
                evaluate_expression(expression, {"rows": [1]})
            message = str(exc_info.value)
            assert "Blocked pattern" not in message
            assert "security reasons" not in message
            assert "''" not in message
            assert message.endswith(f"Expression: {expression}")
