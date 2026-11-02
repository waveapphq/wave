"""Node size estimation mirroring the canvas width formula.

Mirrors frontend workflow-node constants and computeNodeMinWidth; the recipe
compiler persists the fitted width, so a drift here lands in stored tests.
"""

from typing import Any

NODE_MIN_WIDTH = 160
NODE_FUNCTION_MIN_WIDTH = 192
NODE_MAX_WIDTH = 360
NODE_DEFAULT_HEIGHT = 44
DESCRIPTION_HEIGHT = 24

# Title row chrome: 1 px borders, 12 px side padding, 24 px icon, 8 px gap.
TITLE_CHROME_WIDTH = 58
# Average glyph advance of the 16 px bold title font.
TITLE_CHAR_WIDTH = 10

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
    """Width the canvas draws for a block sized to fit its title: the text fit
    within the resize bounds, never narrower than the block's handle row."""
    data = node.get("data") or {}
    title = str(data.get("label") or data.get("elementType") or "")
    text_fit = _clamp_width(TITLE_CHROME_WIDTH + TITLE_CHAR_WIDTH * len(title), data)
    return max(text_fit, _handle_min(data, ingress_count))


def estimate_node_size(node: dict[str, Any], ingress_count: int) -> tuple[int, int]:
    """Estimated (width, height) for a node given its incoming edge count."""
    data = node.get("data") or {}

    # A stored width is honored as on the canvas; un-resized nodes sit at the floor.
    stored = node.get("width")
    base = (
        _clamp_width(round(stored), data) if isinstance(stored, int | float) else _width_floor(data)
    )
    height = NODE_DEFAULT_HEIGHT + (DESCRIPTION_HEIGHT if data.get("description") else 0)
    return max(base, _handle_min(data, ingress_count)), height
