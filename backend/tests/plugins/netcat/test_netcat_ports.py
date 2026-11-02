"""Port range grammar of the Netcat core (REQ-3.4.1.9, NETCAT-2)."""

import re

import pytest

from wavecore.plugins._netcat_core import parse_ports


def exact(message: str) -> str:
    """Anchor an exact message for pytest.raises(match=...)."""
    return f"^{re.escape(message)}$"


def invalid_entry(entry: str) -> str:
    return f"Parameter 'port_range' has an invalid entry: '{entry}'"


def backward(entry: str) -> str:
    return f"Parameter 'port_range' has a range that runs backward: '{entry}'"


OUT_OF_BOUNDS = "Parameter 'port_range' must be between 1 and 65535"


class TestExpansion:
    """Ranges expand ascending, entries keep the written order, repeats stay at their first spot."""

    @pytest.mark.parametrize(
        ("port_range", "expected"),
        [
            ("22, 80, 8000-8010", [22, 80, *range(8000, 8011)]),
            ("5-8", [5, 6, 7, 8]),
            ("9-9", [9]),
            ("443, 22, 80", [443, 22, 80]),
            ("80, 22, 80, 21-23", [80, 22, 21, 23]),
            ("1, 65535", [1, 65535]),
        ],
    )
    def test_ports_in_written_order(self, port_range: str, expected: list[int]) -> None:
        assert parse_ports(port_range) == expected

    @pytest.mark.parametrize(
        ("port_range", "expected"),
        [("080", [80]), ("0080-0081", [80, 81]), (" 22 ,80 ", [22, 80])],
    )
    def test_leading_zeros_and_spaces_around_entries(
        self, port_range: str, expected: list[int]
    ) -> None:
        assert parse_ports(port_range) == expected


class TestInvalidEntry:
    """An entry that is not ASCII digits, or two joined by a hyphen, is refused as written."""

    @pytest.mark.parametrize(
        ("port_range", "entry"),
        [
            ("8000 - 8010", "8000 - 8010"),
            ("+80", "+80"),
            ("8_0", "8_0"),
            ("abc", "abc"),
            ("22,,80", ""),
            ("22,", ""),
            ("\u0668\u0660", "\u0668\u0660"),
        ],
    )
    def test_invalid_entry(self, port_range: str, entry: str) -> None:
        with pytest.raises(ValueError, match=exact(invalid_entry(entry))):
            parse_ports(port_range)

    def test_message_text(self) -> None:
        message = "Parameter 'port_range' has an invalid entry: '8_0'"
        with pytest.raises(ValueError, match=exact(message)):
            parse_ports("8_0")

    def test_non_ascii_digits_are_refused(self) -> None:
        """Arabic-Indic digits are decimal digits to Python, never a port (NETCAT-2)."""
        arabic_indic_22 = "٢٢"
        with pytest.raises(ValueError, match=exact(invalid_entry(arabic_indic_22))):
            parse_ports(arabic_indic_22)


class TestBounds:
    """Each end must be 1-65535; bounds are checked before direction."""

    @pytest.mark.parametrize("port_range", ["0", "65536", "70000-5", "1-65536"])
    def test_out_of_bounds(self, port_range: str) -> None:
        with pytest.raises(ValueError, match=exact(OUT_OF_BOUNDS)):
            parse_ports(port_range)


class TestDirection:
    """A range whose start is above its end is refused, showing the trimmed entry."""

    @pytest.mark.parametrize("port_range", ["10-5", " 10-5 "])
    def test_runs_backward(self, port_range: str) -> None:
        with pytest.raises(ValueError, match=exact(backward("10-5"))):
            parse_ports(port_range)

    def test_message_text(self) -> None:
        message = "Parameter 'port_range' has a range that runs backward: '10-5'"
        with pytest.raises(ValueError, match=exact(message)):
            parse_ports("10-5")


class TestEntryOrder:
    """Entries are checked in written order, so the first bad entry decides the message."""

    @pytest.mark.parametrize(
        ("port_range", "message"),
        [("abc, 70000", invalid_entry("abc")), ("70000, abc", OUT_OF_BOUNDS)],
    )
    def test_first_bad_entry_wins(self, port_range: str, message: str) -> None:
        with pytest.raises(ValueError, match=exact(message)):
            parse_ports(port_range)
