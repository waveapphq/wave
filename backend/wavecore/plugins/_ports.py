"""The standard-library port check the SSH and Netcat blocks and the remote bundle share."""

from typing import Any


def check_port(name: str, value: Any, minimum: int) -> None:
    """Ports are ints (bools excluded) within [minimum, 65535]."""
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= 65535:
        raise ValueError(f"Parameter '{name}' must be between {minimum} and 65535")
