"""Unit tests for SuiteObject - immutable suite namespace with attribute access."""

import pytest

from wavecore.core.suite_object import SuiteObject


class TestSuiteObjectAttributeAccess:
    """Dot-notation access to suite variables."""

    def test_access_existing_variable(self) -> None:
        """Existing variables are accessible via dot notation."""
        s = SuiteObject({"base_url": "http://api.test"}, suite_name="Auth Suite")
        assert s.base_url == "http://api.test"

    def test_access_missing_variable_raises_attribute_error(self) -> None:
        """Missing variables raise AttributeError with descriptive message."""
        s = SuiteObject({"base_url": "http://api.test"}, suite_name="Auth Suite")
        with pytest.raises(AttributeError, match="^Suite 'Auth Suite' has no variable 'missing'$"):
            _ = s.missing

    def test_multiple_variables_accessible(self) -> None:
        """All variables from the data dict are accessible."""
        s = SuiteObject(
            {"host": "db.local", "port": 5432, "timeout": 30},
            suite_name="DB Suite",
        )
        assert s.host == "db.local"
        assert s.port == 5432
        assert s.timeout == 30


class TestSuiteObjectImmutability:
    """SuiteObject must be immutable."""

    def test_setattr_raises_attribute_error(self) -> None:
        """Setting an attribute raises AttributeError."""
        s = SuiteObject({"base_url": "http://api.test"}, suite_name="Auth Suite")
        with pytest.raises(AttributeError, match="^SuiteObject is immutable$"):
            s.base_url = "http://changed.com"

    def test_delattr_raises_attribute_error(self) -> None:
        """Deleting an attribute raises AttributeError."""
        s = SuiteObject({"base_url": "http://api.test"}, suite_name="Auth Suite")
        with pytest.raises(AttributeError, match="^SuiteObject is immutable$"):
            del s.base_url

    def test_data_copy_is_independent(self) -> None:
        """Mutating the source dict does not affect the SuiteObject."""
        source = {"base_url": "http://original.com"}
        s = SuiteObject(source, suite_name="Test")
        source["base_url"] = "http://mutated.com"
        assert s.base_url == "http://original.com"


class TestSuiteObjectMethods:
    """get_values() and get_params() methods."""

    def test_get_values_returns_dict_copy(self) -> None:
        """get_values() returns a dict of all variable values."""
        s = SuiteObject({"host": "api.test", "timeout": 5000}, suite_name="Auth")
        values = s.get_values()
        assert values == {"host": "api.test", "timeout": 5000}

    def test_get_values_returns_independent_copy(self) -> None:
        """Mutating the result of get_values() does not affect the object."""
        s = SuiteObject({"host": "api.test"}, suite_name="Auth")
        values = s.get_values()
        values["host"] = "mutated"
        assert s.host == "api.test"

    def test_get_params_returns_variable_names(self) -> None:
        """get_params() returns list of variable names."""
        s = SuiteObject({"host": "db.local", "port": 5432}, suite_name="DB")
        params = s.get_params()
        assert set(params) == {"host", "port"}


class TestSuiteObjectStringRepresentation:
    """__str__ and __repr__ formatting."""

    def test_str_shows_table_format(self) -> None:
        """__str__ produces a table with header, column labels, and rows."""
        s = SuiteObject(
            {"host": "api.test", "timeout": 5000},
            suite_name="Auth Suite",
        )
        result = str(s)
        assert "Suite: Auth Suite" in result
        assert "Field" in result
        assert "Value" in result
        assert "host" in result
        assert "api.test" in result
        assert "timeout" in result
        assert "5000" in result

    def test_repr_matches_str(self) -> None:
        """__repr__ returns the same as __str__."""
        s = SuiteObject({"host": "api.test"}, suite_name="Auth")
        assert repr(s) == str(s)

    def test_empty_suite_shows_empty_marker(self) -> None:
        """Empty suite shows '(empty)' instead of a table."""
        s = SuiteObject({}, suite_name="Empty")
        result = str(s)
        assert "(empty)" in result

    def test_suite_name_in_header(self) -> None:
        """Header uses suite_name when provided."""
        s = SuiteObject({"x": 1}, suite_name="My Suite")
        result = str(s)
        assert "Suite: My Suite" in result

    def test_default_suite_name(self) -> None:
        """Header uses empty suite name when not provided."""
        s = SuiteObject({"x": 1})
        result = str(s)
        assert "Suite: " in result


class TestSuiteObjectProtocol:
    """Container protocol: __contains__, __len__, __eq__, __bool__."""

    def test_contains_existing_key(self) -> None:
        """'field in suite' returns True for existing variables."""
        s = SuiteObject({"host": "api.test"}, suite_name="Auth")
        assert "host" in s

    def test_contains_missing_key(self) -> None:
        """'field in suite' returns False for missing variables."""
        s = SuiteObject({"host": "api.test"}, suite_name="Auth")
        assert "missing" not in s

    def test_len_returns_variable_count(self) -> None:
        """len(suite) returns the number of variables."""
        s = SuiteObject({"a": 1, "b": 2, "c": 3}, suite_name="Test")
        assert len(s) == 3

    def test_eq_same_data(self) -> None:
        """Two SuiteObjects with same data are equal."""
        s1 = SuiteObject({"host": "api.test"}, suite_name="A")
        s2 = SuiteObject({"host": "api.test"}, suite_name="B")
        assert s1 == s2

    def test_eq_non_suite_object_returns_not_implemented(self) -> None:
        """Comparing SuiteObject to non-SuiteObject returns NotImplemented."""
        s = SuiteObject({"host": "api.test"}, suite_name="Auth")
        assert s.__eq__({"host": "api.test"}) is NotImplemented

    def test_bool_always_truthy(self) -> None:
        """SuiteObject is always truthy, even when empty."""
        empty = SuiteObject({}, suite_name="Empty")
        non_empty = SuiteObject({"x": 1}, suite_name="Full")
        assert bool(empty) is True
        assert bool(non_empty) is True
