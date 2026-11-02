"""The reserved namespace names; the rule that refuses them is tested with the declaration rules."""

from wavecore.core.variables.reserved import RESERVED_VARIABLE_NAMES


class TestReservedVariableNames:
    """Test the RESERVED_VARIABLE_NAMES frozenset."""

    def test_contains_suite(self) -> None:
        """'suite' is reserved."""
        assert "suite" in RESERVED_VARIABLE_NAMES

    def test_contains_system(self) -> None:
        """'system' is reserved."""
        assert "system" in RESERVED_VARIABLE_NAMES

    def test_contains_regression(self) -> None:
        """'regression' is reserved."""
        assert "regression" in RESERVED_VARIABLE_NAMES

    def test_is_frozenset(self) -> None:
        """Reserved names are a frozenset (immutable)."""
        assert isinstance(RESERVED_VARIABLE_NAMES, frozenset)
