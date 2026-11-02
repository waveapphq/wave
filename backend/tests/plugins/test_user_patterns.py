"""The one compile of a pattern a user wrote (REQ-3.4.1.1, REQ-3.4.1.10).

The pass and fail patterns of script blocks, the File I/O pattern and the retry message
pattern compile through it. A pattern that does not compile raises ValueError carrying the
engine's own reason and nothing else, so each caller puts its own words in front. The script
runtime carries the module to remote hosts, so it imports the standard library only.
"""

import re
from pathlib import Path

import pytest

from tests.core.remote_exec._vendorability import (
    imported_names,
    is_stdlib,
    parses_at_the_floor,
    post_floor_names,
)
from wavecore.plugins import _user_patterns
from wavecore.plugins._user_patterns import compile_user_pattern

_PATH = Path(str(_user_patterns.__file__))

UNCLOSED_GROUP = "missing ), unterminated subpattern at position 0"
UNCLOSED_SET = "unterminated character set at position 0"

BROKEN = ["[", "(", "*", "a{2,1}", "(?P<name", "a\n("]


def exact(message: str) -> str:
    """Anchor an exact message for pytest.raises(match=...)."""
    return f"^{re.escape(message)}$"


def engine_reason(pattern: str, flags: int = 0) -> str:
    """The regular-expression engine's own message for a pattern that does not compile."""
    try:
        re.compile(pattern, flags)
    except re.error as error:
        return str(error)
    raise AssertionError(f"{pattern!r} compiles")


class TestAValidPatternCompiles:
    """A pattern the engine accepts comes back compiled."""

    @pytest.mark.parametrize("text", ["", "log", r"^report-.*\.json$", "(a|b)+", r"\bdone\b"])
    def test_it_returns_the_compiled_pattern(self, text: str) -> None:
        compiled = compile_user_pattern(text)

        assert isinstance(compiled, re.Pattern)
        assert compiled.pattern == text

    def test_the_compiled_pattern_is_the_engines_own(self) -> None:
        assert compile_user_pattern(r"^report-.*\.json$") == re.compile(r"^report-.*\.json$")

    def test_the_compiled_pattern_matches_as_the_engine_does(self) -> None:
        compiled = compile_user_pattern(r"^report-(\d+)\.json$")

        found = compiled.search("report-42.json")

        assert found is not None
        assert found.group(1) == "42"
        assert compiled.search("report-42.yaml") is None


class TestAPatternThatDoesNotCompile:
    """The error is a ValueError whose whole text is the engine's own reason."""

    @pytest.mark.parametrize("text", BROKEN)
    def test_the_text_is_the_engines_own_reason(self, text: str) -> None:
        with pytest.raises(ValueError, match=exact(engine_reason(text))):
            compile_user_pattern(text)

    def test_an_unclosed_group(self) -> None:
        with pytest.raises(ValueError, match=exact(UNCLOSED_GROUP)):
            compile_user_pattern("(")

    def test_an_unclosed_character_set(self) -> None:
        with pytest.raises(ValueError, match=exact(UNCLOSED_SET)):
            compile_user_pattern("[")

    @pytest.mark.parametrize("text", BROKEN)
    def test_the_engines_error_is_the_cause(self, text: str) -> None:
        with pytest.raises(ValueError) as caught:
            compile_user_pattern(text)

        cause = caught.value.__cause__
        assert isinstance(cause, re.error)
        assert str(caught.value) == str(cause)

    def test_the_engines_reason_with_flags(self) -> None:
        with pytest.raises(ValueError, match=exact(engine_reason("(", re.IGNORECASE))):
            compile_user_pattern("(", re.IGNORECASE)


class TestFlagsReachTheCompile:
    """The flags a caller passes decide how the pattern matches."""

    def test_no_flags_is_the_default(self) -> None:
        compiled = compile_user_pattern("timeout")

        assert compiled == re.compile("timeout")
        assert compiled.search("Request TIMEOUT") is None

    def test_ignore_case_matches_any_case(self) -> None:
        compiled = compile_user_pattern("timeout", re.IGNORECASE)

        assert compiled.flags & re.IGNORECASE
        assert compiled.search("Request TIMEOUT") is not None

    def test_flags_are_taken_by_name(self) -> None:
        compiled = compile_user_pattern("timeout", flags=re.IGNORECASE)

        assert compiled == re.compile("timeout", re.IGNORECASE)

    def test_more_than_one_flag(self) -> None:
        compiled = compile_user_pattern("^done$", re.IGNORECASE | re.MULTILINE)

        assert compiled.search("first\nDONE\nlast") is not None


class TestRidesToRemoteHosts:
    """The script runtime compiles patterns on remote hosts, so the module is carried verbatim."""

    def test_it_imports_only_the_standard_library(self) -> None:
        names = imported_names(_user_patterns.__name__, _PATH)

        assert all(is_stdlib({name}) for name in names), names

    def test_it_parses_at_the_interpreter_floor(self) -> None:
        source = _PATH.read_text(encoding="utf-8")

        assert parses_at_the_floor(source)
        assert post_floor_names(source) == set()
