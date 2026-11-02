"""Unit tests for ProfileObject - immutable profile with attribute access."""

import pytest

from wavecore.core.profile_object import ProfileObject


class TestProfileObjectAttributeAccess:
    """Dot-notation access to profile fields."""

    def test_access_existing_field(self) -> None:
        """Existing fields are accessible via dot notation."""
        p = ProfileObject({"url": "http://example.com"}, alias="srv")
        assert p.url == "http://example.com"

    def test_access_missing_field_raises_attribute_error(self) -> None:
        """Missing fields raise AttributeError with descriptive message."""
        p = ProfileObject({"url": "http://example.com"}, alias="srv")
        with pytest.raises(AttributeError, match="Profile 'srv' has no field 'missing'"):
            _ = p.missing

    def test_multiple_fields_accessible(self) -> None:
        """All fields from the data dict are accessible."""
        p = ProfileObject(
            {"host": "db.local", "port": 5432, "name": "mydb"},
            alias="db",
        )
        assert p.host == "db.local"
        assert p.port == 5432
        assert p.name == "mydb"


class TestProfileObjectImmutability:
    """ProfileObject must be immutable."""

    def test_setattr_raises_attribute_error(self) -> None:
        """Setting an attribute raises AttributeError."""
        p = ProfileObject({"url": "http://example.com"}, alias="srv")
        with pytest.raises(AttributeError, match="ProfileObject is immutable"):
            p.url = "http://changed.com"

    def test_delattr_raises_attribute_error(self) -> None:
        """Deleting an attribute raises AttributeError."""
        p = ProfileObject({"url": "http://example.com"}, alias="srv")
        with pytest.raises(AttributeError, match="ProfileObject is immutable"):
            del p.url

    def test_data_copy_is_independent(self) -> None:
        """Mutating the source dict does not affect the ProfileObject."""
        source = {"url": "http://original.com"}
        p = ProfileObject(source, alias="srv")
        source["url"] = "http://mutated.com"
        assert p.url == "http://original.com"


class TestProfileObjectMethods:
    """get_values() and get_params() methods."""

    def test_get_values_returns_dict_copy(self) -> None:
        """get_values() returns a dict of all field values."""
        p = ProfileObject({"url": "http://example.com", "timeout": 5000}, alias="srv")
        values = p.get_values()
        assert values == {"url": "http://example.com", "timeout": 5000}

    def test_get_values_returns_independent_copy(self) -> None:
        """Mutating the result of get_values() does not affect the object."""
        p = ProfileObject({"url": "http://example.com"}, alias="srv")
        values = p.get_values()
        values["url"] = "http://mutated.com"
        assert p.url == "http://example.com"

    def test_get_params_returns_field_names(self) -> None:
        """get_params() returns list of field names."""
        p = ProfileObject({"host": "db.local", "port": 5432}, alias="db")
        params = p.get_params()
        assert set(params) == {"host", "port"}


class TestProfileObjectStringRepresentation:
    """__str__ and __repr__ formatting."""

    def test_str_shows_table_format(self) -> None:
        """__str__ produces a table with header, column labels, and rows."""
        p = ProfileObject(
            {"url": "http://example.com", "timeout": 5000},
            alias="srv",
            profile_name="My Server",
            profile_type="http",
        )
        result = str(p)
        assert "Profile: My Server (http)" in result
        assert "Field" in result
        assert "Value" in result
        assert "url" in result
        assert "http://example.com" in result
        assert "timeout" in result
        assert "5000" in result

    def test_repr_matches_str(self) -> None:
        """__repr__ returns the same as __str__."""
        p = ProfileObject({"url": "http://example.com"}, alias="srv")
        assert repr(p) == str(p)

    def test_empty_profile_shows_empty_marker(self) -> None:
        """Empty profile shows '(empty)' instead of a table."""
        p = ProfileObject({}, alias="empty")
        result = str(p)
        assert "(empty)" in result

    def test_profile_name_in_header(self) -> None:
        """Header uses profile_name when provided."""
        p = ProfileObject({"x": 1}, alias="a", profile_name="My Profile")
        result = str(p)
        assert "Profile: My Profile" in result

    def test_profile_type_in_parentheses(self) -> None:
        """Profile type appears in parentheses after the name."""
        p = ProfileObject({"x": 1}, alias="a", profile_name="P", profile_type="database")
        result = str(p)
        assert "(database)" in result


class TestProfileObjectProtocol:
    """Container protocol: __contains__, __len__, __eq__, __bool__."""

    def test_contains_existing_key(self) -> None:
        """'field in profile' returns True for existing fields."""
        p = ProfileObject({"url": "http://example.com"}, alias="srv")
        assert "url" in p

    def test_contains_missing_key(self) -> None:
        """'field in profile' returns False for missing fields."""
        p = ProfileObject({"url": "http://example.com"}, alias="srv")
        assert "missing" not in p

    def test_len_returns_field_count(self) -> None:
        """len(profile) returns the number of fields."""
        p = ProfileObject({"a": 1, "b": 2, "c": 3}, alias="test")
        assert len(p) == 3

    def test_eq_same_data(self) -> None:
        """Two ProfileObjects with same data are equal."""
        p1 = ProfileObject({"url": "http://example.com"}, alias="a")
        p2 = ProfileObject({"url": "http://example.com"}, alias="b")
        assert p1 == p2

    def test_eq_non_profile_object_returns_not_implemented(self) -> None:
        """Comparing ProfileObject to non-ProfileObject returns NotImplemented."""
        p = ProfileObject({"url": "http://example.com"}, alias="srv")
        assert p.__eq__({"url": "http://example.com"}) is NotImplemented

    def test_bool_always_truthy(self) -> None:
        """ProfileObject is always truthy, even when empty."""
        empty = ProfileObject({}, alias="empty")
        non_empty = ProfileObject({"x": 1}, alias="full")
        assert bool(empty) is True
        assert bool(non_empty) is True
