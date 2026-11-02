"""Unit tests for RegressionObject - immutable regression namespace with attribute access."""

import pytest

from wavecore.core.regression_object import RegressionObject


class TestRegressionObjectAttributeAccess:
    """Dot-notation access to regression variables."""

    def test_access_existing_variable(self) -> None:
        """Existing variables are accessible via dot notation."""
        r = RegressionObject({"run_id": "abc-123"}, regression_name="Nightly")
        assert r.run_id == "abc-123"

    def test_access_missing_variable_raises_attribute_error(self) -> None:
        """Missing variables raise AttributeError with descriptive message."""
        r = RegressionObject({"run_id": "abc-123"}, regression_name="Nightly")
        with pytest.raises(
            AttributeError, match="^Regression 'Nightly' has no variable 'missing'$"
        ):
            _ = r.missing

    def test_multiple_variables_accessible(self) -> None:
        """All variables from the data dict are accessible."""
        r = RegressionObject(
            {"run_id": "abc", "env": "staging", "retries": 3},
            regression_name="Nightly",
        )
        assert r.run_id == "abc"
        assert r.env == "staging"
        assert r.retries == 3


class TestRegressionObjectImmutability:
    """RegressionObject must be immutable."""

    def test_setattr_raises_attribute_error(self) -> None:
        """Setting an attribute raises AttributeError."""
        r = RegressionObject({"run_id": "abc"}, regression_name="Nightly")
        with pytest.raises(AttributeError, match="^RegressionObject is immutable$"):
            r.run_id = "changed"

    def test_delattr_raises_attribute_error(self) -> None:
        """Deleting an attribute raises AttributeError."""
        r = RegressionObject({"run_id": "abc"}, regression_name="Nightly")
        with pytest.raises(AttributeError, match="^RegressionObject is immutable$"):
            del r.run_id

    def test_data_copy_is_independent(self) -> None:
        """Mutating the source dict does not affect the RegressionObject."""
        source = {"run_id": "original"}
        r = RegressionObject(source, regression_name="Nightly")
        source["run_id"] = "mutated"
        assert r.run_id == "original"


class TestRegressionObjectMethods:
    """get_values() and get_params() methods."""

    def test_get_values_returns_dict_copy(self) -> None:
        """get_values() returns a dict of all variable values."""
        r = RegressionObject({"run_id": "abc", "retries": 3}, regression_name="Nightly")
        values = r.get_values()
        assert values == {"run_id": "abc", "retries": 3}

    def test_get_values_returns_independent_copy(self) -> None:
        """Mutating the result of get_values() does not affect the object."""
        r = RegressionObject({"run_id": "abc"}, regression_name="Nightly")
        values = r.get_values()
        values["run_id"] = "mutated"
        assert r.run_id == "abc"

    def test_get_params_returns_variable_names(self) -> None:
        """get_params() returns list of variable names."""
        r = RegressionObject({"run_id": "abc", "retries": 3}, regression_name="Nightly")
        params = r.get_params()
        assert set(params) == {"run_id", "retries"}


class TestRegressionObjectStringRepresentation:
    """__str__ and __repr__ formatting."""

    def test_str_shows_table_format(self) -> None:
        """__str__ produces a table with header, column labels, and rows."""
        r = RegressionObject({"run_id": "abc", "retries": 3}, regression_name="Nightly")
        result = str(r)
        assert "Regression: Nightly" in result
        assert "Field" in result
        assert "Value" in result
        assert "run_id" in result
        assert "abc" in result
        assert "retries" in result
        assert "3" in result

    def test_repr_matches_str(self) -> None:
        """__repr__ returns the same as __str__."""
        r = RegressionObject({"run_id": "abc"}, regression_name="Nightly")
        assert repr(r) == str(r)

    def test_empty_regression_shows_empty_marker(self) -> None:
        """Empty regression shows '(empty)' instead of a table."""
        r = RegressionObject({}, regression_name="Empty")
        result = str(r)
        assert "(empty)" in result

    def test_regression_name_in_header(self) -> None:
        """Header uses regression_name when provided."""
        r = RegressionObject({"x": 1}, regression_name="My Regression")
        result = str(r)
        assert "Regression: My Regression" in result

    def test_default_regression_name(self) -> None:
        """Header uses empty regression name when not provided."""
        r = RegressionObject({"x": 1})
        result = str(r)
        assert "Regression: " in result


class TestRegressionObjectProtocol:
    """Container protocol: __contains__, __len__, __eq__, __bool__."""

    def test_contains_existing_key(self) -> None:
        """'field in regression' returns True for existing variables."""
        r = RegressionObject({"run_id": "abc"}, regression_name="Nightly")
        assert "run_id" in r

    def test_contains_missing_key(self) -> None:
        """'field in regression' returns False for missing variables."""
        r = RegressionObject({"run_id": "abc"}, regression_name="Nightly")
        assert "missing" not in r

    def test_len_returns_variable_count(self) -> None:
        """len(regression) returns the number of variables."""
        r = RegressionObject({"a": 1, "b": 2, "c": 3}, regression_name="Test")
        assert len(r) == 3

    def test_eq_same_data(self) -> None:
        """Two RegressionObjects with same data are equal."""
        r1 = RegressionObject({"run_id": "abc"}, regression_name="A")
        r2 = RegressionObject({"run_id": "abc"}, regression_name="B")
        assert r1 == r2

    def test_eq_non_regression_object_returns_not_implemented(self) -> None:
        """Comparing RegressionObject to non-RegressionObject returns NotImplemented."""
        r = RegressionObject({"run_id": "abc"}, regression_name="Nightly")
        assert r.__eq__({"run_id": "abc"}) is NotImplemented

    def test_bool_always_truthy(self) -> None:
        """RegressionObject is always truthy, even when empty."""
        empty = RegressionObject({}, regression_name="Empty")
        non_empty = RegressionObject({"x": 1}, regression_name="Full")
        assert bool(empty) is True
        assert bool(non_empty) is True
