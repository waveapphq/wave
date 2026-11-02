"""The shared standard-library port check used by SSH and Netcat (REQ-3.4.1.9)."""

import re
from typing import Any

import pytest

from wavecore.plugins._ports import check_port


def exact(message: str) -> str:
    """Anchor an exact message for pytest.raises(match=...)."""
    return f"^{re.escape(message)}$"


def refusal(name: str, minimum: int) -> str:
    return f"Parameter '{name}' must be between {minimum} and 65535"


class TestAccepted:
    """Integers inside [minimum, 65535] pass silently."""

    @pytest.mark.parametrize(
        ("name", "value", "minimum"),
        [("port", 1, 1), ("port", 22, 1), ("port", 65535, 1), ("local_port", 0, 0)],
    )
    def test_in_range_returns_none(self, name: str, value: int, minimum: int) -> None:
        assert check_port(name, value, minimum) is None


class TestRejected:
    """A bool, a non-integer, or a value outside [minimum, 65535] raises ValueError."""

    @pytest.mark.parametrize(
        ("name", "value", "minimum"),
        [
            ("port", True, 1),
            ("port", False, 1),
            ("local_port", True, 0),
            ("local_port", False, 0),
            ("port", "80", 1),
            ("port", 80.0, 1),
            ("port", None, 1),
        ],
    )
    def test_not_an_integer(self, name: str, value: Any, minimum: int) -> None:
        with pytest.raises(ValueError, match=exact(refusal(name, minimum))):
            check_port(name, value, minimum)

    @pytest.mark.parametrize(
        ("name", "value", "minimum"),
        [("port", 0, 1), ("local_port", -1, 0), ("port", 65536, 1), ("port", 70000, 1)],
    )
    def test_out_of_bounds(self, name: str, value: int, minimum: int) -> None:
        with pytest.raises(ValueError, match=exact(refusal(name, minimum))):
            check_port(name, value, minimum)


class TestMessage:
    """The message names the parameter and the minimum as given."""

    @pytest.mark.parametrize(
        ("name", "value", "minimum", "message"),
        [
            ("port", 0, 1, "Parameter 'port' must be between 1 and 65535"),
            ("local_port", -1, 0, "Parameter 'local_port' must be between 0 and 65535"),
            ("remote_port", 65536, 1, "Parameter 'remote_port' must be between 1 and 65535"),
        ],
    )
    def test_exact_text(self, name: str, value: int, minimum: int, message: str) -> None:
        with pytest.raises(ValueError, match=exact(message)):
            check_port(name, value, minimum)
