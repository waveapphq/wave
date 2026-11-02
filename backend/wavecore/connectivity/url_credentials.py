"""A password written inside a URL, masked for display; stdlib only, so it rides to remote hosts."""

import re
from typing import Any

# The engine's mask placeholder; this module cannot import wavecore.core on a remote host.
MASK = "********"
# A scheme, then the authority up to whatever ends it or ends a quoted value.
_AUTHORITY = re.compile(r"([A-Za-z][A-Za-z0-9+.-]*://)([^\s/?#\"'<>\\`]*)")


def mask_url_passwords(text: str) -> str:
    """Every `scheme://user:password@host` in the text as `scheme://user:********@host`."""
    return _AUTHORITY.sub(_masked, text)


def mask_url_passwords_in(value: Any) -> Any:
    """The value with `mask_url_passwords` applied to every text in it, through lists and maps."""
    if isinstance(value, str):
        return mask_url_passwords(value)
    if isinstance(value, dict):
        return {key: mask_url_passwords_in(item) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [mask_url_passwords_in(item) for item in value]
    return value


def _masked(match: re.Match[str]) -> str:
    userinfo, _at, host = match.group(2).rpartition("@")
    user, _colon, password = userinfo.partition(":")
    if not password:
        return match.group(0)
    return f"{match.group(1)}{user}:{MASK}@{host}"
