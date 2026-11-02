"""Text UTF-8 cannot write: the one walk, its fast path and the YAML reader (REQ-4.6.9).

Every door into WAVE asks this module where parsed data first holds a lone
surrogate. Raw text with no form of a surrogate in it is never walked, and YAML
is read so that one character written as two escapes is that one character.
"""

import datetime
from decimal import Decimal
from typing import Any

import pytest
import yaml

from wavecore.core import utf8_text
from wavecore.core.variables.decimal_value import WaveDecimal


class TestFirstUnencodable:
    """Where the first such text sits, in the path forms every door shows."""

    @pytest.mark.parametrize(
        ("document", "where"),
        [
            pytest.param("cafe\udce9", "the file", id="the-whole-document"),
            pytest.param({"command": "cafe\udce9"}, "command", id="value"),
            pytest.param({"a": {"b": ["x", "y\ud800"]}}, "a.b[1]", id="nested"),
            pytest.param(["x", {"name": "y\ud800"}], "[1].name", id="root-list"),
            pytest.param({"ab\udce9c": 1}, "ab?c", id="key"),
            pytest.param({"a": {"k\ud800": "v\ud800"}}, "a.k?", id="key-before-its-value"),
            pytest.param({1: {"a": "x\ud800"}}, "1.a", id="number-key"),
            pytest.param({None: "x\ud800", True: "y"}, "None", id="null-key"),
            pytest.param([("a", "x\ud800")], "[0][1]", id="pair-of-an-ordered-map"),
            pytest.param({"tags": {"x", "y\ud800"}}, "tags.y?", id="set-member"),
        ],
    )
    def test_the_place_is_named(self, document: Any, where: str) -> None:
        assert utf8_text.first_unencodable(document, "the file") == where

    @pytest.mark.parametrize(
        "document",
        [
            pytest.param({"name": "Grüße 測試 😀", "n": 1, "on": True, "none": None}, id="text"),
            pytest.param({"when": datetime.date(2026, 10, 10), "raw": b"\xed\xb3\xa9"}, id="other"),
            pytest.param({"tags": {"x", "y"}, "pairs": [("a", 1)]}, id="set-and-pairs"),
            pytest.param("", id="empty-text"),
            pytest.param(None, id="nothing"),
        ],
    )
    def test_data_that_can_be_written_has_no_place(self, document: Any) -> None:
        assert utf8_text.first_unencodable(document, "the file") is None

    def test_the_root_word_is_the_callers(self) -> None:
        assert utf8_text.first_unencodable("\ud800", "the recipe") == "the recipe"

    def test_a_deeply_nested_document_is_walked_to_its_end(self) -> None:
        document: Any = "x\ud800"
        for _ in range(3000):
            document = [document]

        assert utf8_text.first_unencodable(document, "the file") == "[0]" * 3000


class TestMayHoldUnencodable:
    """The fast path: raw text with no form of a surrogate in it needs no walk."""

    @pytest.mark.parametrize(
        "raw",
        [
            pytest.param(rb'{"a": "x\udce9"}', id="bytes-escape"),
            pytest.param(rb'a: "x\uDCE9"', id="bytes-upper-case-escape"),
            pytest.param(rb'a: "x\U0000dce9"', id="bytes-eight-digit-escape"),
            pytest.param(b'{"a": "x\xed\xb3\xa9"}', id="bytes-raw-surrogate"),
            pytest.param('a: "x"'.encode("utf-16"), id="bytes-not-utf-8"),
            pytest.param(r'{"a": "x\ud83d"}', id="text-escape"),
            pytest.param(r'a: "x\U0000D83D"', id="text-eight-digit-escape"),
            pytest.param('{"a": "x\udce9"}', id="text-raw-surrogate"),
        ],
    )
    def test_a_form_of_a_surrogate_asks_for_the_walk(self, raw: bytes | str) -> None:
        assert utf8_text.may_hold_unencodable(raw) is True

    @pytest.mark.parametrize(
        "raw",
        [
            pytest.param('{"name": "Grüße 測試 😀"}'.encode(), id="bytes-utf-8"),
            pytest.param(b"\xef\xbb\xbfname: x", id="bytes-byte-order-mark"),
            pytest.param(rb'a: "\u00e9 \U0001F600 \xe9 C:\\users\\d8"', id="bytes-other-escapes"),
            pytest.param(b"", id="bytes-empty"),
            pytest.param('name: "Grüße 測試 😀 \\u00e9 \\U0001F600"', id="text"),
            pytest.param("", id="text-empty"),
        ],
    )
    def test_text_without_one_does_not(self, raw: bytes | str) -> None:
        assert utf8_text.may_hold_unencodable(raw) is False


class TestUnencodablePlace:
    """The fast path and the walk together, as a door calls them."""

    def test_raw_text_without_a_form_is_not_walked(self) -> None:
        assert utf8_text.unencodable_place(b"name: x", {"name": "x\ud800"}, "the file") is None

    def test_raw_text_with_a_form_is_walked(self) -> None:
        place = utf8_text.unencodable_place(rb'name: "x\ud800"', {"name": "x\ud800"}, "the file")

        assert place == "name"

    def test_a_form_that_made_no_surrogate_has_no_place(self) -> None:
        raw = rb"name: C:\ud800 as plain text"

        assert utf8_text.unencodable_place(raw, yaml.safe_load(raw), "the file") is None


class TestLoadYaml:
    """YAML read as yaml.safe_load reads it, except that two escapes of one character join."""

    def test_a_character_written_as_two_escapes_is_one_character(self) -> None:
        loaded = utf8_text.load_yaml(r'"k \uD83D\uDE00": "v \ud83d\ude00 \uD83D\uDE00"')

        assert loaded == {"k 😀": "v 😀 😀"}

    def test_the_plain_reader_leaves_them_apart(self) -> None:
        assert yaml.safe_load(r'a: "\uD83D\uDE00"') == {"a": "\ud83d\ude00"}

    @pytest.mark.parametrize(
        ("text", "value"),
        [
            pytest.param(r'a: "x\uDCE9"', "x\udce9", id="lone-low"),
            pytest.param(r'a: "x\uD83D"', "x\ud83d", id="lone-high"),
            pytest.param(r'a: "\uDE00\uD83D"', "\ude00\ud83d", id="low-then-high"),
            pytest.param(r'a: "\U0000DCE9"', "\udce9", id="eight-digit-escape"),
            pytest.param(r'a: "\uD83D\uD83D\uDE00"', "\ud83d😀", id="lone-high-before-a-pair"),
        ],
    )
    def test_a_lone_surrogate_stays_for_the_walk_to_find(self, text: str, value: str) -> None:
        assert utf8_text.load_yaml(text) == {"a": value}

    @pytest.mark.parametrize(
        "text",
        [r"a: C:\uD83D\uDE00", r"a: 'C:\uD83D\uDE00'", "a: |\n  C:\\uD83D\\uDE00\n"],
        ids=["plain", "single-quoted", "block"],
    )
    def test_text_that_is_not_an_escape_is_kept_as_written(self, text: str) -> None:
        assert utf8_text.load_yaml(text)["a"].strip() == r"C:\uD83D\uDE00"

    @pytest.mark.parametrize(
        "text",
        [
            "name: Grüße 測試 😀\ncount: 3\non: true\nnone: null\nwhen: 2026-10-10\n",
            "- a\n- [1, 2.5]\n- {k: v}\n",
            "!!set {a, b}\n",
            "",
        ],
        ids=["mapping", "list", "set", "empty"],
    )
    def test_every_other_document_reads_as_the_plain_reader_reads_it(self, text: str) -> None:
        assert utf8_text.load_yaml(text) == yaml.safe_load(text)

    def test_bytes_are_read_like_text(self) -> None:
        assert utf8_text.load_yaml(rb'a: "\uD83D\uDE00"') == {"a": "😀"}

    @pytest.mark.parametrize(
        "text", ["a: [unclosed\n", "a: 1\n---\nb: 2\n", "a: !!python/object:os.system x\n"]
    )
    def test_what_the_plain_reader_refuses_is_refused_the_same_way(self, text: str) -> None:
        with pytest.raises(yaml.YAMLError) as plain:
            yaml.safe_load(text)

        with pytest.raises(type(plain.value)):
            utf8_text.load_yaml(text)


class TestLoadExactYaml:
    """A recipe's YAML: plain decimal numbers read exactly, every other number form as text."""

    @pytest.mark.parametrize(
        ("text", "value"),
        [
            pytest.param("30", 30, id="integer"),
            pytest.param("-30", -30, id="negative-integer"),
            pytest.param("007", 7, id="leading-zeros"),
            pytest.param("12345678901234567890123", 12345678901234567890123, id="long-integer"),
        ],
    )
    def test_a_plain_integer_is_an_int(self, text: str, value: int) -> None:
        loaded = utf8_text.load_exact_yaml(f"a: {text}")["a"]

        assert loaded == value
        assert type(loaded) is int

    @pytest.mark.parametrize(
        "text",
        ["2.50", "-0.5", "0.0000001", "1234567890123456789.123456789"],
    )
    def test_a_plain_float_is_a_wave_decimal_with_every_digit(self, text: str) -> None:
        loaded = utf8_text.load_exact_yaml(f"a: {text}")["a"]

        assert isinstance(loaded, WaveDecimal)
        assert format(loaded, "f") == text

    @pytest.mark.parametrize(
        "text",
        [
            "0x1F",
            "0o17",
            "0b101",
            "1:30",
            "+5",
            "1_000",
            "+1.5",
            "1.",
            ".5",
            "1.0e+5",
            "1_0.5",
            ".inf",
            "-.inf",
            ".nan",
            "190:20:30.15",
        ],
    )
    def test_every_other_number_form_stays_its_text(self, text: str) -> None:
        assert utf8_text.load_exact_yaml(f"a: {text}") == {"a": text}

    def test_a_tagged_number_follows_the_same_rule(self) -> None:
        loaded = utf8_text.load_exact_yaml("a: !!int '0x1F'\nb: !!float '2.5'\nc: !!int '12'\n")

        assert loaded == {"a": "0x1F", "b": WaveDecimal("2.5"), "c": 12}

    def test_text_and_other_types_read_as_load_yaml_reads_them(self) -> None:
        text = "name: Grüße\non: true\nnone: null\nwhen: 2026-10-10\nquoted: '30'\nlist: [a]\n"

        assert utf8_text.load_exact_yaml(text) == utf8_text.load_yaml(text)

    def test_a_character_written_as_two_escapes_is_one_character(self) -> None:
        assert utf8_text.load_exact_yaml(r'a: "😀"') == {"a": "😀"}

    def test_load_yaml_keeps_the_yaml_number_forms(self) -> None:
        assert utf8_text.load_yaml("a: 0x1F\nb: 2.5\n") == {"a": 31, "b": 2.5}


class TestDumpExactYaml:
    """Recipe YAML out: every finite number in plain digits, read back as the same number."""

    @pytest.mark.parametrize(
        ("value", "written"),
        [
            pytest.param(1e-05, "0.00001", id="small-float"),
            pytest.param(1e20, "100000000000000000000.0", id="large-float"),
            pytest.param(2.5, "2.5", id="float"),
            pytest.param(30.0, "30.0", id="whole-float"),
            pytest.param(WaveDecimal("2.50"), "2.50", id="decimal"),
            pytest.param(Decimal("1E+2"), "100.0", id="decimal-in-exponent-form"),
            pytest.param(30, "30", id="integer"),
        ],
    )
    def test_a_number_is_written_in_plain_digits(self, value: Any, written: str) -> None:
        assert utf8_text.dump_exact_yaml({"a": value}) == f"a: {written}\n"

    @pytest.mark.parametrize(
        ("value", "read"),
        [
            pytest.param(1e-05, Decimal("0.00001"), id="small-float"),
            pytest.param(1e20, Decimal("100000000000000000000.0"), id="large-float"),
            pytest.param(WaveDecimal("2.50"), Decimal("2.50"), id="decimal"),
            pytest.param(12345678901234567890123, 12345678901234567890123, id="long-integer"),
        ],
    )
    def test_what_is_written_reads_back_as_the_same_number(self, value: Any, read: Any) -> None:
        loaded = utf8_text.load_exact_yaml(utf8_text.dump_exact_yaml({"a": value}))["a"]

        assert loaded == read

    @pytest.mark.parametrize(
        ("value", "written"),
        [
            pytest.param(float("inf"), ".inf", id="infinity"),
            pytest.param(float("nan"), ".nan", id="nan"),
            pytest.param(Decimal("NaN"), "NaN", id="decimal-nan"),
            pytest.param(Decimal("-Infinity"), "-Infinity", id="decimal-minus-infinity"),
        ],
    )
    def test_a_value_that_is_not_finite_is_not_written_as_a_number(
        self, value: Any, written: str
    ) -> None:
        dumped = utf8_text.dump_exact_yaml({"a": value})

        assert dumped == f"a: {written}\n"
        assert utf8_text.load_exact_yaml(dumped) == {"a": written}

    def test_keys_keep_their_order_and_text_its_characters(self) -> None:
        dumped = utf8_text.dump_exact_yaml({"z": "Grüße", "a": ["0x1F", "30"], "m": {"k": True}})

        assert dumped == "z: Grüße\na:\n- '0x1F'\n- '30'\nm:\n  k: true\n"
