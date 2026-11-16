"""An untrusted value written into one server log entry (REQ-6.4.1)."""

import base64
import uuid

import pytest

from wavecore.core.logging.log_safe import log_safe

CONTROL_CHARACTERS = [chr(code) for code in [*range(0x00, 0x20), *range(0x7F, 0xA0)]]
SEPARATORS_AND_BIDI_CONTROLS = [
    chr(code) for code in [0x061C, 0x200E, 0x200F, *range(0x2028, 0x202F), *range(0x2066, 0x206A)]
]


class TestPlainText:
    """A value with nothing that can break or reorder a log line is written as it is."""

    @pytest.mark.parametrize(
        "value",
        [
            "server.port",
            "3f2b8c1e-0d4a-4c7e-9b1a-6f0e2d3c4b5a",
            "Fix the restore: step 2 (100%), then 'retry' \"now\" \\ / # [x] {y}",
            "Größe 日本語 café",
            "base64:looks-encoded",
            "",
        ],
    )
    def test_plain_text_is_unchanged(self, value: str) -> None:
        assert log_safe(value) == value

    def test_a_value_that_is_not_text_is_written_as_its_text(self) -> None:
        session_id = uuid.UUID("3f2b8c1e-0d4a-4c7e-9b1a-6f0e2d3c4b5a")

        assert log_safe(session_id) == "3f2b8c1e-0d4a-4c7e-9b1a-6f0e2d3c4b5a"
        assert log_safe(42) == "42"
        assert log_safe(None) == "None"


class TestEncodedText:
    """A value that could break or reorder a log line is written as Base64 of its UTF-8 bytes."""

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            ("a\nb", "base64:YQpi"),
            ("a\rb", "base64:YQ1i"),
            ("abc\n", "base64:YWJjCg=="),
            ("tab\there", "base64:dGFiCWhlcmU="),
            ("\x1b[31mred", "base64:G1szMW1yZWQ="),
            ("line\u2028sep", "base64:bGluZeKAqHNlcA=="),
            ("file\u202etxt.exe", "base64:ZmlsZeKArnR4dC5leGU="),
            (
                "E2E reason\r\n12:00:00.000 INFO  [deadbeef] forged",
                "base64:RTJFIHJlYXNvbg0KMTI6MDA6MDAuMDAwIElORk8gIFtkZWFkYmVlZl0gZm9yZ2Vk",
            ),
        ],
    )
    def test_a_value_with_a_break_or_a_control_is_encoded(self, value: str, expected: str) -> None:
        assert log_safe(value) == expected

    @pytest.mark.parametrize("character", CONTROL_CHARACTERS + SEPARATORS_AND_BIDI_CONTROLS)
    def test_every_control_separator_and_bidi_control_is_encoded(self, character: str) -> None:
        rendered = log_safe(f"a{character}b")

        assert rendered.startswith("base64:")
        assert rendered.isascii()
        assert rendered.isprintable()
        assert base64.b64decode(rendered.removeprefix("base64:")).decode("utf-8") == (
            f"a{character}b"
        )

    def test_a_lone_surrogate_is_encoded_without_an_error(self) -> None:
        assert log_safe("\ud800\n") == "base64:7aCACg=="
