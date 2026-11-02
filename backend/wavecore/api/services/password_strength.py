"""Password strength: a score from 0 to 4 and its one-word label (REQ-5.2.7.1)."""

from collections.abc import Sequence
from typing import Any, Final

from zxcvbn import zxcvbn

# The longest password the library scores; it refuses a longer one.
MAX_SCORED_LENGTH: Final[int] = 72

_LABELS: Final[tuple[str, ...]] = ("Very weak", "Weak", "Fair", "Strong", "Very strong")


def score(password: str, user_inputs: Sequence[str] = ()) -> dict[str, Any]:
    """The score and label of the password, scored on its first characters up to the limit."""
    points = 0
    # The library fails on an empty password.
    if password:
        known = [text for text in user_inputs if text]
        points = int(zxcvbn(password[:MAX_SCORED_LENGTH], user_inputs=known)["score"])
    return {"score": points, "label": _LABELS[points]}
