"""Derive a "{Browser} ({OS})" label from a connection User-Agent.

A recognized browser on an unrecognized OS reads as the browser alone; an
unrecognized (or missing) User-Agent falls back to "Browser".
"""


def _browser(user_agent: str) -> str | None:
    if "Edg/" in user_agent:
        return "Edge"
    if "Firefox/" in user_agent:
        return "Firefox"
    if "Chrome/" in user_agent:
        return "Chrome"
    if "Safari/" in user_agent and "Version/" in user_agent:
        return "Safari"
    return None


def _operating_system(user_agent: str) -> str | None:
    if "Windows NT" in user_agent:
        return "Windows"
    if "Android" in user_agent:
        return "Android"
    if "iPhone" in user_agent or "iPad" in user_agent or "iPod" in user_agent:
        return "iOS"
    if "Mac OS X" in user_agent or "Macintosh" in user_agent:
        return "macOS"
    if "Linux" in user_agent:
        return "Linux"
    return None


def derive_client_label(user_agent: str | None) -> str:
    """Best-effort human label for a browser connection from its User-Agent."""
    if not user_agent:
        return "Browser"
    browser = _browser(user_agent)
    if browser is None:
        return "Browser"
    operating_system = _operating_system(user_agent)
    return f"{browser} ({operating_system})" if operating_system else browser
