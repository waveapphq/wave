"""The typed numbers a REST client sends and the form a save stores them in (REQ-3.1.3.14)."""

from typing import Any

TINY = 1e-07
BIG = 1234567890123456789

SENT_VARIABLES: dict[str, dict[str, Any]] = {
    "rate": {"type": "float", "value": TINY},
    "big": {"type": "integer", "value": BIG},
    "whole": {"type": "float", "value": 30.0},
    "half": {"type": "float", "value": 2.5},
    "count": {"type": "integer", "value": 30},
}

STORED_VARIABLES: dict[str, dict[str, Any]] = {
    "rate": {"type": "float", "value": "0.0000001"},
    "big": {"type": "integer", "value": "1234567890123456789"},
    "whole": {"type": "float", "value": "30.0"},
    "half": {"type": "float", "value": 2.5},
    "count": {"type": "integer", "value": 30},
}


def http_node(node_id: str = "http", **values: Any) -> dict[str, Any]:
    """An HTTP Block with its required fields and ``values``."""
    return {
        "id": node_id,
        "type": "workflowNode",
        "position": {"x": 0, "y": 0},
        "data": {
            "elementType": "http-client",
            "nodeType": "plugin",
            "version": "1.0.0",
            "label": "HTTP Call",
            "config": {"values": {"method": "GET", "url": "http://example.com", **values}},
        },
    }


SENT_HTTP_NUMBERS: dict[str, Any] = {
    "retry_delay": TINY,
    "max_size": BIG,
    "retry_backoff_factor": 30.0,
    "timeout": 30,
}

STORED_HTTP_NUMBERS: dict[str, Any] = {
    "retry_delay": "0.0000001",
    "max_size": "1234567890123456789",
    "retry_backoff_factor": "30.0",
    "timeout": 30,
}


def http_numbers(node: dict[str, Any]) -> dict[str, Any]:
    """The number fields an HTTP Block holds."""
    values: dict[str, Any] = node["data"]["config"]["values"]
    return {name: values[name] for name in SENT_HTTP_NUMBERS if name in values}
