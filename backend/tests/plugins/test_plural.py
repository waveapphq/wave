"""The count-and-noun wording the Blocks and the remote bundle share."""

import pytest

from wavecore.plugins._plural import plural


class TestPlural:
    """The noun is singular only for exactly one."""

    @pytest.mark.parametrize("count", [1, 1.0])
    def test_exactly_one_takes_the_singular(self, count: float) -> None:
        assert plural(count, "second", "seconds") == f"{count} second"

    @pytest.mark.parametrize(
        ("count", "expected"),
        [(0, "0 seconds"), (2, "2 seconds"), (0.05, "0.05 seconds"), (1.5, "1.5 seconds")],
    )
    def test_any_other_count_takes_the_plural(self, count: float, expected: str) -> None:
        assert plural(count, "second", "seconds") == expected

    def test_an_irregular_plural_is_the_one_given(self) -> None:
        assert plural(3, "entry", "entries") == "3 entries"
