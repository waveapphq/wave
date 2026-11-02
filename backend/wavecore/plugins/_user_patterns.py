"""The one compile of a pattern a user wrote (REQ-3.4.1.1, REQ-3.4.1.10)."""

import re


def compile_user_pattern(text: str, flags: int = 0) -> re.Pattern[str]:
    """Compile the pattern; one the engine refuses raises ValueError with the engine's reason."""
    try:
        return re.compile(text, flags)
    except re.error as error:
        raise ValueError(str(error)) from error
