from decimal import Decimal

import pytest

from wavecore.core.execution.plugin_executor import check_expression_type
from wavecore.core.expressions.errors import ExpressionTypeError


class TestCheckExpressionType:
    def test_string_accepts_str(self) -> None:
        check_expression_type("url", "hello", "string")

    def test_integer_accepts_int(self) -> None:
        check_expression_type("timeout", 42, "integer")

    def test_integer_rejects_float(self) -> None:
        with pytest.raises(ExpressionTypeError, match="expects integer.*got float"):
            check_expression_type("timeout", 3.14, "integer")

    def test_integer_rejects_str(self) -> None:
        with pytest.raises(ExpressionTypeError, match="expects integer.*got str"):
            check_expression_type("timeout", "hello", "integer")

    def test_integer_rejects_bool(self) -> None:
        """bool is a subclass of int in Python, but integer type should reject bools."""
        with pytest.raises(ExpressionTypeError, match="expects integer.*got bool"):
            check_expression_type("count", True, "integer")

    def test_float_accepts_int(self) -> None:
        check_expression_type("factor", 42, "float")

    def test_float_accepts_float(self) -> None:
        check_expression_type("factor", 3.14, "float")

    @pytest.mark.parametrize(
        ("result", "got"),
        [
            (float("nan"), "NaN"),
            (float("inf"), "Infinity"),
            (float("-inf"), "-Infinity"),
            (Decimal("NaN"), "NaN"),
            (Decimal("sNaN"), "NaN"),
            (Decimal("-Infinity"), "-Infinity"),
        ],
        ids=[
            "nan",
            "infinity",
            "minus-infinity",
            "decimal-nan",
            "decimal-signaling-nan",
            "decimal-minus-infinity",
        ],
    )
    def test_float_rejects_a_number_that_is_not_finite(self, result: object, got: str) -> None:
        with pytest.raises(
            ExpressionTypeError, match=rf"^Parameter 'factor' expects float, got {got}$"
        ):
            check_expression_type("factor", result, "float")

    def test_integer_names_a_number_that_is_not_finite(self) -> None:
        with pytest.raises(
            ExpressionTypeError, match=r"^Parameter 'timeout' expects integer, got Infinity$"
        ):
            check_expression_type("timeout", float("inf"), "integer")

    def test_float_rejects_str(self) -> None:
        with pytest.raises(ExpressionTypeError, match="expects float.*got str"):
            check_expression_type("factor", "hello", "float")

    def test_float_rejects_bool(self) -> None:
        """bool is a subclass of int/float in Python, but float type should reject bools."""
        with pytest.raises(ExpressionTypeError, match="expects float.*got bool"):
            check_expression_type("factor", False, "float")

    def test_boolean_accepts_bool(self) -> None:
        check_expression_type("flag", True, "boolean")

    def test_boolean_rejects_int(self) -> None:
        with pytest.raises(ExpressionTypeError, match="expects boolean.*got int"):
            check_expression_type("flag", 1, "boolean")

    def test_array_accepts_list(self) -> None:
        check_expression_type("items", [1, 2], "array")

    def test_array_rejects_tuple(self) -> None:
        with pytest.raises(ExpressionTypeError, match="expects array.*got tuple"):
            check_expression_type("items", (1, 2), "array")

    def test_map_accepts_dict(self) -> None:
        check_expression_type("headers", {"a": "b"}, "map")

    def test_map_rejects_list(self) -> None:
        with pytest.raises(ExpressionTypeError, match="expects map.*got list"):
            check_expression_type("headers", [1], "map")

    def test_none_result_passes_any_type(self) -> None:
        check_expression_type("optional", None, "string")

    def test_unknown_type_passes(self) -> None:
        """Unknown expected_type should not raise."""
        check_expression_type("custom", "value", "unknown_type")

    def test_table_accepts_table(self) -> None:
        from wavecore.core.table import Table

        table = Table(columns=["a"])
        table.add_row(["x"])
        check_expression_type("data", table, "table")

    def test_table_accepts_a_list_of_rows_only(self) -> None:
        """A list of dicts is the Python form of a table; any other list is not."""
        check_expression_type("data", [{"col1": 1}], "table")
        message = r"^Parameter 'data' expects table, got list$"
        with pytest.raises(ExpressionTypeError, match=message):
            check_expression_type("data", [1, 2], "table")

    # --- Multi-type support ---

    def test_multi_type_accepts_any_listed_type(self) -> None:
        """A list of types accepts any of the listed types."""
        check_expression_type("collection", [1, 2], ["array", "map", "table"])
        check_expression_type("collection", {"a": 1}, ["array", "map", "table"])

    def test_multi_type_rejects_unlisted_type(self) -> None:
        """A list of types rejects types not in the list."""
        with pytest.raises(ExpressionTypeError, match="expects array/map/table.*got str"):
            check_expression_type("collection", "hello", ["array", "map", "table"])

    def test_multi_type_rejects_unlisted_type_int(self) -> None:
        """A list of types rejects int when not listed."""
        with pytest.raises(ExpressionTypeError, match="expects array/map.*got int"):
            check_expression_type("data", 42, ["array", "map"])

    def test_multi_type_bool_rejection_when_integer_listed(self) -> None:
        """Bool is rejected when integer is among the listed types."""
        with pytest.raises(ExpressionTypeError, match="expects integer/string.*got bool"):
            check_expression_type("val", True, ["integer", "string"])

    def test_multi_type_bool_accepted_when_boolean_listed(self) -> None:
        """Bool is accepted when boolean is explicitly listed."""
        check_expression_type("val", True, ["boolean", "string"])

    def test_multi_type_none_passes(self) -> None:
        """None values bypass multi-type checking."""
        check_expression_type("val", None, ["array", "map"])

    def test_multi_type_all_unknown_passes(self) -> None:
        """All unknown types in list means no validation."""
        check_expression_type("val", "anything", ["unknown1", "unknown2"])

    def test_multi_type_error_message_shows_all_types(self) -> None:
        """Error message shows slash-separated list of allowed types."""
        with pytest.raises(ExpressionTypeError, match="^Parameter 'x' expects array/map, got int$"):
            check_expression_type("x", 42, ["array", "map"])

    def test_expression_type_error_is_exception(self) -> None:
        """ExpressionTypeError inherits from ExpressionEvaluationError."""
        from wavecore.core.expressions.errors import ExpressionEvaluationError

        err = ExpressionTypeError("test message")
        assert isinstance(err, ExpressionEvaluationError)
        assert str(err) == "test message"
        assert err.expression == ""
        assert err.reason == "type_mismatch"


class TestCheckExpressionTypeDecimal:
    """An exact-precision Decimal satisfies the float type (REQ-3.1.3.14)."""

    def test_float_accepts_decimal(self) -> None:
        check_expression_type("factor", Decimal("3.14"), "float")

    def test_float_accepts_negative_decimal(self) -> None:
        check_expression_type("factor", Decimal("-2123.123213123123699999"), "float")

    def test_multi_type_accepts_decimal_for_float(self) -> None:
        check_expression_type("val", Decimal("3.14"), ["float", "string"])


class TestTableNeedsRows:
    """A table is a Table or a list of row maps; any other list is not a table (REQ-3.1.3.13)."""

    @pytest.mark.parametrize(
        "result",
        [
            pytest.param([1, 2], id="scalars"),
            pytest.param([[1], 2], id="nested-list"),
            pytest.param([{"k": 1}, 2], id="rows-and-a-scalar"),
        ],
    )
    def test_a_list_that_is_not_rows_is_refused(self, result: list[object]) -> None:
        message = r"^Parameter 'data' expects table, got list$"
        with pytest.raises(ExpressionTypeError, match=message):
            check_expression_type("data", result, "table")

    def test_rows_are_a_table(self) -> None:
        check_expression_type("data", [{"k": 1}, {"k": 2}], "table")

    def test_no_rows_are_an_empty_table(self) -> None:
        check_expression_type("data", [], "table")

    def test_a_list_that_is_not_rows_is_refused_where_only_map_or_table_fits(self) -> None:
        message = r"^Parameter 'data' expects map/table, got list$"
        with pytest.raises(ExpressionTypeError, match=message):
            check_expression_type("data", [1, 2], ["map", "table"])
