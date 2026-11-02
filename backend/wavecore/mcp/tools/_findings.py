"""Finding helpers shared by the MCP tool families."""

from collections.abc import Iterable
from typing import Any

from wavecore.api.services.reports.builder import owed_secret_finding
from wavecore.core.recipes.model import finding
from wavecore.core.secrets.owed import OwedSecret


def _finding(code: str, problem: str, fix: str | None = None) -> dict[str, Any]:
    """One input finding in the envelope every tool result carries."""
    return finding("input", code, problem, fix)


def _service_finding(exc: Exception) -> dict[str, Any]:
    """A refused service call as one input finding, message verbatim."""
    return _finding("VALIDATION", str(getattr(exc, "message", exc)))


def owed_action_items(owed: Iterable[OwedSecret]) -> list[dict[str, Any]]:
    """The secrets a person still owes, as the warnings an authoring tool returns (REQ-5.2.7.12)."""
    return [
        finding(item["step"], item["code"], item["problem"], item["fix"], severity="warning")
        for item in (
            owed_secret_finding(
                secret.name, step=secret.step, field=secret.field, environment=secret.environment
            )
            for secret in owed
        )
    ]
