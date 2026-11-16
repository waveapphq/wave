"""An untrusted value written into one server log entry (REQ-6.4.1)."""

import base64
import re

# Plain text holds no control character, line or paragraph separator, or bidirectional control.
_PLAIN_TEXT = r"[^\x00-\x1f\x7f-\x9f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]*\Z"

_BASE64_PREFIX = "base64:"


def log_safe(value: object) -> str:
    """The value as it is when it is plain text, else ``base64:`` and its UTF-8 bytes in Base64."""
    text = str(value)
    if re.match(_PLAIN_TEXT, text):
        return text
    return _BASE64_PREFIX + base64.b64encode(text.encode("utf-8", "surrogatepass")).decode("ascii")
