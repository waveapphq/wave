"""Node size estimation mirroring the canvas card; the compiler stores the fitted width."""

import math
from typing import Any

from wavecore.controls.note import NOTE_NODE_TYPE

NODE_MIN_WIDTH = 160
NODE_FUNCTION_MIN_WIDTH = 192
NODE_MAX_WIDTH = 360
NODE_DEFAULT_HEIGHT = 44

# Title row chrome: 1 px borders, 12 px side padding, 24 px icon, 8 px gap.
TITLE_CHROME_WIDTH = 58
# Average glyph advance of the 16 px bold title font.
TITLE_CHAR_WIDTH = 10

# Card body: 1 px borders, 10 px top and 6 px bottom padding, the 24 px title row.
BODY_CHROME_HEIGHT = 42
DESCRIPTION_GAP = 4
# 12 px description text at a 1.375 line height, two lines unless expanded.
DESCRIPTION_LINE_HEIGHT = 16.5
DESCRIPTION_MAX_LINES = 2
# Description text box chrome: 1 px borders, 12 px side padding, the 32 px indent.
DESCRIPTION_CHROME_WIDTH = 58
# Room an expanded description leaves beside it for the chevron.
DESCRIPTION_CHEVRON_WIDTH = 20
# The title's glyph advance scaled to the 12 px description font.
DESCRIPTION_CHAR_WIDTH = TITLE_CHAR_WIDTH * 12 / 16
# The persistent status bar: a 28 px bar and its 1 px bottom border.
STATUS_BAR_HEIGHT = 29
TALLEST_COLLAPSED_HEIGHT = (
    BODY_CHROME_HEIGHT
    + DESCRIPTION_GAP
    + DESCRIPTION_MAX_LINES * DESCRIPTION_LINE_HEIGHT
    + STATUS_BAR_HEIGHT
)

# An unresized Note: 8 px glyphs, 26 px side chrome, 22.75 px lines, 18 px padding, 33 px bar.
NOTE_MIN_WIDTH = 120
NOTE_MIN_HEIGHT = 60
NOTE_CHAR_WIDTH = 8
NOTE_CHROME_WIDTH = 26
NOTE_LINE_HEIGHT = 22.75
NOTE_CHROME_HEIGHT = 18 + 33

_HANDLE_EDGE_PAD = 96
_HANDLE_STEP = 64
_INGRESS_STEP = 80
_HANDLE_MIN = 120
_SPLIT_FOOTPRINT = 160

_LOOP_LIKE = {"for", "for-each", "while", "remote-execution"}
_BRANCH_LIST_LANES = {"switch-case", "parallel"}


def _handle_footprint(handle_count: int) -> int:
    return _HANDLE_EDGE_PAD + (handle_count - 1) * _HANDLE_STEP


def _try_handles(values: dict[str, Any]) -> int:
    enabled_catch = 1 if values.get("enable_catch", True) else 0
    enabled_finally = 1 if values.get("enable_finally", False) else 0
    return 2 + enabled_catch + enabled_finally


def _if_else_handles(values: dict[str, Any]) -> int | None:
    branches = values.get("branches") or []
    return len(branches) if isinstance(branches, list) and branches else None


def _branch_list_handles(values: dict[str, Any]) -> int | None:
    branches = values.get("branches")
    # Every branch gets a lane, plus one for the guaranteed 'then' egress.
    return len(branches) + 1 if isinstance(branches, list) and branches else None


def _output_footprint(element_type: str, values: dict[str, Any]) -> int:
    if element_type == "assert":
        return _SPLIT_FOOTPRINT if values.get("mode", "split") == "split" else _HANDLE_MIN
    if element_type == "wait-until":
        # Watch mode renders the single default egress, Retry renders two lanes.
        return _HANDLE_MIN if values.get("mode", "retry") == "watch" else _handle_footprint(2)
    if element_type in _LOOP_LIKE:
        handles: int | None = 2
    elif element_type == "try-catch-finally":
        handles = _try_handles(values)
    elif element_type == "if-else":
        handles = _if_else_handles(values)
    elif element_type in _BRANCH_LIST_LANES:
        handles = _branch_list_handles(values)
    else:
        handles = None
    return _handle_footprint(handles) if handles is not None else _HANDLE_MIN


def _width_floor(data: dict[str, Any]) -> int:
    return NODE_FUNCTION_MIN_WIDTH if data.get("nodeType") == "function" else NODE_MIN_WIDTH


def _clamp_width(width: int, data: dict[str, Any]) -> int:
    return max(_width_floor(data), min(width, NODE_MAX_WIDTH))


def _handle_min(data: dict[str, Any], ingress_count: int) -> int:
    element_type = str(data.get("elementType") or "")
    values = (data.get("config") or {}).get("values") or {}
    return max(
        _HANDLE_MIN,
        max(1, ingress_count) * _INGRESS_STEP,
        _output_footprint(element_type, values),
    )


def fit_node_width(node: dict[str, Any], ingress_count: int) -> int:
    """The width drawn for a block fitted to its title, within resize bounds and its handle row."""
    data = node.get("data") or {}
    title = str(data.get("label") or data.get("elementType") or "")
    text_fit = _clamp_width(TITLE_CHROME_WIDTH + TITLE_CHAR_WIDTH * len(title), data)
    return max(text_fit, _handle_min(data, ingress_count))


def _description_lines(description: str, width: int, expanded: bool) -> int:
    text_width = width - DESCRIPTION_CHROME_WIDTH - (DESCRIPTION_CHEVRON_WIDTH if expanded else 0)
    lines = sum(
        max(1, math.ceil(len(line) * DESCRIPTION_CHAR_WIDTH / text_width))
        for line in description.splitlines()
    )
    return lines if expanded else min(lines, DESCRIPTION_MAX_LINES)


def _card_height(data: dict[str, Any], width: int) -> float:
    description = str(data.get("description") or "")
    body = float(NODE_DEFAULT_HEIGHT)
    if description:
        lines = _description_lines(description, width, bool(data.get("descriptionExpanded")))
        body = max(body, BODY_CHROME_HEIGHT + DESCRIPTION_GAP + lines * DESCRIPTION_LINE_HEIGHT)
    return body + STATUS_BAR_HEIGHT


def _note_size(node: dict[str, Any]) -> tuple[int, float]:
    """A Note's stored width and height, each one unset estimated from its text (REQ-5.2.7.4)."""
    values = (node.get("data") or {}).get("config", {}).get("values") or {}
    lines = str(values.get("text") or "").split("\n")
    width, height = node.get("width"), node.get("height")
    if not isinstance(width, int | float):
        longest = max(len(line) for line in lines)
        width = max(NOTE_MIN_WIDTH, NOTE_CHROME_WIDTH + NOTE_CHAR_WIDTH * longest)
    if not isinstance(height, int | float):
        height = max(NOTE_MIN_HEIGHT, len(lines) * NOTE_LINE_HEIGHT + NOTE_CHROME_HEIGHT)
    return math.ceil(width), math.ceil(height)


def estimate_node_size(node: dict[str, Any], ingress_count: int) -> tuple[int, float]:
    """Estimated (width, height) for a node given its incoming edge count."""
    if node.get("type") == NOTE_NODE_TYPE:
        return _note_size(node)
    data = node.get("data") or {}

    # A stored width is honored as on the canvas, else the floor; the height follows content only.
    stored = node.get("width")
    base = (
        _clamp_width(round(stored), data) if isinstance(stored, int | float) else _width_floor(data)
    )
    width = max(base, _handle_min(data, ingress_count))
    return width, _card_height(data, width)
