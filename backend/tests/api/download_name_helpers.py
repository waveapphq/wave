"""A download named with text outside plain ASCII keeps its whole name (REQ-4.6.9)."""

from urllib.parse import quote

from httpx import Response

ENTITY_NAME = "Grüße 測試"
# What the export name builders make of the entity name.
EXPORT_STEM = "Grüße-測試"


def assert_whole_name(response: Response, filename: str) -> None:
    """The download answered, and its header carries the whole name encoded."""
    assert response.status_code == 200, response.text
    encoded = f"filename*=UTF-8''{quote(filename, safe='')}"
    assert encoded in response.headers["content-disposition"]
