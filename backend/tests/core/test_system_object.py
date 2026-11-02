"""Unit tests for SystemObject - immutable system namespace with attribute access."""

import pytest

from wavecore.core.system_object import SystemObject


class TestSystemObjectAttributeAccess:
    """Dot-notation access to system variables."""

    def test_access_existing_variable(self) -> None:
        """Existing variables are accessible via dot notation."""
        s = SystemObject({"api_host": "localhost"})
        assert s.api_host == "localhost"

    def test_access_missing_variable_raises_attribute_error(self) -> None:
        """Missing variables raise AttributeError with descriptive message."""
        s = SystemObject({"api_host": "localhost"})
        with pytest.raises(AttributeError, match="^System namespace has no variable 'missing'$"):
            _ = s.missing

    def test_multiple_variables_accessible(self) -> None:
        """All variables from the data dict are accessible."""
        s = SystemObject({"host": "localhost", "port": 8080, "debug": True})
        assert s.host == "localhost"
        assert s.port == 8080
        assert s.debug is True


class TestSystemObjectImmutability:
    """SystemObject must be immutable."""

    def test_setattr_raises_attribute_error(self) -> None:
        """Setting an attribute raises AttributeError."""
        s = SystemObject({"api_host": "localhost"})
        with pytest.raises(AttributeError, match="^SystemObject is immutable$"):
            s.api_host = "changed"

    def test_delattr_raises_attribute_error(self) -> None:
        """Deleting an attribute raises AttributeError."""
        s = SystemObject({"api_host": "localhost"})
        with pytest.raises(AttributeError, match="^SystemObject is immutable$"):
            del s.api_host

    def test_data_copy_is_independent(self) -> None:
        """Mutating the source dict does not affect the SystemObject."""
        source = {"api_host": "original"}
        s = SystemObject(source)
        source["api_host"] = "mutated"
        assert s.api_host == "original"


class TestSystemObjectMethods:
    """get_values() and get_params() methods."""

    def test_get_values_returns_dict_copy(self) -> None:
        """get_values() returns a dict of all variable values."""
        s = SystemObject({"host": "localhost", "port": 8080})
        values = s.get_values()
        assert values == {"host": "localhost", "port": 8080}

    def test_get_values_returns_independent_copy(self) -> None:
        """Mutating the result of get_values() does not affect the object."""
        s = SystemObject({"host": "localhost"})
        values = s.get_values()
        values["host"] = "mutated"
        assert s.host == "localhost"

    def test_get_params_returns_variable_names(self) -> None:
        """get_params() returns list of variable names."""
        s = SystemObject({"host": "localhost", "port": 8080})
        params = s.get_params()
        assert set(params) == {"host", "port"}


class TestSystemObjectStringRepresentation:
    """__str__ and __repr__ formatting."""

    def test_str_shows_table_format(self) -> None:
        """__str__ produces a table with header, column labels, and rows."""
        s = SystemObject({"host": "localhost", "port": 8080})
        result = str(s)
        assert "System Variables" in result
        assert "Field" in result
        assert "Value" in result
        assert "host" in result
        assert "localhost" in result
        assert "port" in result
        assert "8080" in result

    def test_repr_matches_str(self) -> None:
        """__repr__ returns the same as __str__."""
        s = SystemObject({"host": "localhost"})
        assert repr(s) == str(s)

    def test_empty_system_shows_empty_marker(self) -> None:
        """Empty system object shows '(empty)' instead of a table."""
        s = SystemObject({})
        result = str(s)
        assert "(empty)" in result

    def test_header_is_system_variables(self) -> None:
        """Header is always 'System Variables'."""
        s = SystemObject({"x": 1})
        result = str(s)
        assert "System Variables" in result


class TestSystemObjectProtocol:
    """Container protocol: __contains__, __len__, __eq__, __bool__."""

    def test_contains_existing_key(self) -> None:
        """'field in system' returns True for existing variables."""
        s = SystemObject({"host": "localhost"})
        assert "host" in s

    def test_contains_missing_key(self) -> None:
        """'field in system' returns False for missing variables."""
        s = SystemObject({"host": "localhost"})
        assert "missing" not in s

    def test_len_returns_variable_count(self) -> None:
        """len(system) returns the number of variables."""
        s = SystemObject({"a": 1, "b": 2, "c": 3})
        assert len(s) == 3

    def test_eq_same_data(self) -> None:
        """Two SystemObjects with same data are equal."""
        s1 = SystemObject({"host": "localhost"})
        s2 = SystemObject({"host": "localhost"})
        assert s1 == s2

    def test_eq_non_system_object_returns_not_implemented(self) -> None:
        """Comparing SystemObject to non-SystemObject returns NotImplemented."""
        s = SystemObject({"host": "localhost"})
        assert s.__eq__({"host": "localhost"}) is NotImplemented

    def test_bool_always_truthy(self) -> None:
        """SystemObject is always truthy, even when empty."""
        empty = SystemObject({})
        non_empty = SystemObject({"x": 1})
        assert bool(empty) is True
        assert bool(non_empty) is True
