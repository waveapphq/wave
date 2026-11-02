"""Stage-2 relay: platform validation entries mapped into recipe coordinates."""

from typing import Any


def map_platform_errors(
    errors: list[dict[str, Any]], step_map: dict[str, str]
) -> list[dict[str, Any]]:
    """Platform error entries -> recipe findings, order preserved."""
    findings: list[dict[str, Any]] = []
    for entry in errors:
        node_id = entry.get("node_id")
        path = entry.get("path")
        if isinstance(node_id, str) and node_id in step_map:
            step = step_map[node_id]
        elif isinstance(path, str) and path.startswith("variables."):
            step = ".".join(path.split(".")[:2])
        else:
            step = "test"
        findings.append(
            {
                "step": step,
                "code": str(entry.get("code") or ""),
                "severity": str(entry.get("severity") or "error"),
                "problem": str(entry.get("message") or ""),
                "fix": entry.get("fix_action"),
            }
        )
    return findings
