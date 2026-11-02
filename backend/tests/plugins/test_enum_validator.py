"""Unit tests for validate_enum_param.

Tests the unified runtime enum validator shared across plugins and controls.
The validator is a public helper on the plugin executor base module.

Error message format (anchored):
    ^Parameter '{name}' must be one of: {a, b, c}; Actual value was '{trimmed_value}'\\.$
"""

from typing import Any

import pytest


class TestValidateEnumParamSuccess:
    """validate_enum_param does nothing when value is in allowed_values."""

    def test_returns_none_for_valid_string_value(self) -> None:
        from wavecore.plugins._executor_base import validate_enum_param

        assert validate_enum_param("method", "GET", ["GET", "POST"]) is None

    def test_returns_none_when_value_matches_first_allowed(self) -> None:
        from wavecore.plugins._executor_base import validate_enum_param

        assert validate_enum_param("scope", "test", ["test", "suite", "regression"]) is None

    def test_returns_none_when_value_matches_last_allowed(self) -> None:
        from wavecore.plugins._executor_base import validate_enum_param

        assert validate_enum_param("scope", "regression", ["test", "suite", "regression"]) is None


class TestValidateEnumParamFailure:
    """validate_enum_param raises ValueError with the exact anchored format."""

    def test_raises_value_error_for_unknown_string_value(self) -> None:
        from wavecore.plugins._executor_base import validate_enum_param

        with pytest.raises(
            ValueError,
            match=r"^Parameter 'method' must be one of: GET, POST; Actual value was 'XYZ'\.$",
        ):
            validate_enum_param("method", "XYZ", ["GET", "POST"])

    def test_raises_value_error_for_full_method_list(self) -> None:
        from wavecore.plugins._executor_base import validate_enum_param

        with pytest.raises(
            ValueError,
            match=(
                r"^Parameter 'method' must be one of: "
                r"GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS; "
                r"Actual value was 'xyz'\.$"
            ),
        ):
            validate_enum_param(
                "method",
                "xyz",
                ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"],
            )

    def test_raises_for_empty_string_value(self) -> None:
        from wavecore.plugins._executor_base import validate_enum_param

        with pytest.raises(
            ValueError,
            match=r"^Parameter 'scope' must be one of: test, suite, regression; Actual value was "
            r"''\.$",
        ):
            validate_enum_param("scope", "", ["test", "suite", "regression"])

    def test_raises_for_case_mismatch(self) -> None:
        from wavecore.plugins._executor_base import validate_enum_param

        with pytest.raises(
            ValueError,
            match=r"^Parameter 'scope' must be one of: test, suite, regression; Actual value was "
            r"'Test'\.$",
        ):
            validate_enum_param("scope", "Test", ["test", "suite", "regression"])


class TestValidateEnumParamLongValueNotEchoed:
    """A value longer than 50 chars is NOT echoed in the error - only its length
    is shown. A truncated prefix would leak part of a secret bound to an enum param,
    and the value-scrub cannot match it."""

    def test_value_at_50_chars_is_shown_in_full(self) -> None:
        from wavecore.plugins._executor_base import validate_enum_param

        boundary_value = "a" * 50
        with pytest.raises(ValueError) as excinfo:
            validate_enum_param("scope", boundary_value, ["test"])
        message = str(excinfo.value)
        assert f"Actual value was '{boundary_value}'." in message

    def test_value_over_50_chars_shows_length_not_content(self) -> None:
        from wavecore.plugins._executor_base import validate_enum_param

        long_value = "a" * 51
        with pytest.raises(ValueError) as excinfo:
            validate_enum_param("scope", long_value, ["test"])
        message = str(excinfo.value)
        assert "Actual value was a 51-character value." in message
        assert "aaaa" not in message

    def test_long_secret_content_is_not_echoed(self) -> None:
        from wavecore.plugins._executor_base import validate_enum_param

        secret = "sk-live-9f8e7d6c5b4a3210_TOPSECRET_TOKEN_abcdef0123456789"
        with pytest.raises(ValueError) as excinfo:
            validate_enum_param("method", secret, ["GET", "POST"])
        message = str(excinfo.value)
        assert "sk-live" not in message
        assert "TOPSECRET" not in message
        assert f"a {len(secret)}-character value" in message

    def test_extremely_long_value_shows_its_length(self) -> None:
        from wavecore.plugins._executor_base import validate_enum_param

        long_value = "x" * 1000
        with pytest.raises(ValueError) as excinfo:
            validate_enum_param("scope", long_value, ["test"])
        message = str(excinfo.value)
        assert "Actual value was a 1000-character value." in message
        assert "xxxx" not in message


class TestValidateEnumParamNonStringValues:
    """Non-string values are stringified before comparison and quoting."""

    def test_integer_value_is_stringified(self) -> None:
        from wavecore.plugins._executor_base import validate_enum_param

        with pytest.raises(
            ValueError,
            match=(
                r"^Parameter 'method' must be one of: "
                r"GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS; "
                r"Actual value was '12345'\.$"
            ),
        ):
            validate_enum_param(
                "method",
                12345,
                ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"],
            )

    def test_none_value_is_stringified_as_None(self) -> None:
        from wavecore.plugins._executor_base import validate_enum_param

        with pytest.raises(
            ValueError,
            match=r"^Parameter 'scope' must be one of: test, suite; Actual value was 'None'\.$",
        ):
            validate_enum_param("scope", None, ["test", "suite"])

    def test_boolean_value_is_stringified(self) -> None:
        from wavecore.plugins._executor_base import validate_enum_param

        with pytest.raises(
            ValueError,
            match=r"^Parameter 'flag' must be one of: yes, no; Actual value was 'True'\.$",
        ):
            validate_enum_param("flag", True, ["yes", "no"])

    def test_long_list_value_shows_length_not_content(self) -> None:
        from wavecore.plugins._executor_base import validate_enum_param

        long_list = list(range(100))
        with pytest.raises(ValueError) as excinfo:
            validate_enum_param("scope", long_list, ["test"])
        message = str(excinfo.value)
        rendered = str(long_list)
        assert f"a {len(rendered)}-character value" in message
        assert "[0, 1, 2" not in message


class TestValidateEnumParamArgumentSurface:
    """The function accepts the documented positional/keyword surface."""

    def test_accepts_positional_arguments(self) -> None:
        from wavecore.plugins._executor_base import validate_enum_param

        validate_enum_param("name", "a", ["a", "b"])

    def test_accepts_keyword_arguments(self) -> None:
        from wavecore.plugins._executor_base import validate_enum_param

        validate_enum_param(param_name="name", value="a", allowed_values=["a", "b"])

    def test_signature_typing(self) -> None:
        """The runtime accepts arbitrary value types (not only strings)."""
        from wavecore.plugins._executor_base import validate_enum_param

        # No raise for str-coerced match on a numeric allowed list (defensive: schema controls
        # types).
        # The validator's contract is membership against the supplied list using the value as-is.
        not_in_list: list[Any] = [1, 2, 3]
        with pytest.raises(ValueError):
            validate_enum_param("n", 4, not_in_list)
