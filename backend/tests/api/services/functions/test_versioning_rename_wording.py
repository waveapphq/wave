"""A renamed input/output reads "renamed", not "removed".

When a draft renames a parameter (the old name disappears and a new name of the
same shape - same type, same required flag - appears), wording the bump-blocker
reason as a removal ("... cannot remove inputs (removed 'old')") misleads the
author, who renamed rather than deleted.

The blocked-bump reason builder must recognize the removed+added-same-shape pair
as a rename and word the reason "renamed" instead of "removed".
"""

from __future__ import annotations

from typing import Any

from wavecore.api.services.functions._versioning import compute_allowed_bumps


def _source(inputs: list[dict[str, Any]], outputs: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "name": "greet",
        "tags": ["demo"],
        "inputs": inputs,
        "outputs": outputs,
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {"nodes": [], "edges": []},
    }


def _draft(inputs: list[dict[str, Any]], outputs: list[dict[str, Any]]) -> dict[str, Any]:
    return _source(inputs, outputs)


class TestInputRenameWording:
    """Renaming an OPTIONAL input surfaces as the MINOR blocker (MINOR allows
    adding optional inputs but forbids removing one), so it is the natural place
    a rename is misworded as a removal."""

    def _blocked_minor(self) -> str:
        source = _source(
            inputs=[{"name": "foo", "type": "string", "required": False}],
            outputs=[{"name": "result", "type": "string"}],
        )
        draft = _draft(
            inputs=[{"name": "bar", "type": "string", "required": False}],
            outputs=[{"name": "result", "type": "string"}],
        )
        result = compute_allowed_bumps(source, draft)
        assert "minor" in result["blocked"], result
        return result["blocked"]["minor"]

    def test_minor_reason_says_renamed(self) -> None:
        assert "renamed" in self._blocked_minor().lower()

    def test_minor_reason_does_not_say_removed(self) -> None:
        assert "removed" not in self._blocked_minor().lower()


class TestOutputRenameWording:
    def _blocked_minor(self) -> str:
        source = _source(
            inputs=[{"name": "x", "type": "string", "required": True}],
            outputs=[{"name": "out_old", "type": "string"}],
        )
        draft = _draft(
            inputs=[{"name": "x", "type": "string", "required": True}],
            outputs=[{"name": "out_new", "type": "string"}],
        )
        result = compute_allowed_bumps(source, draft)
        assert "minor" in result["blocked"], result
        return result["blocked"]["minor"]

    def test_minor_reason_says_renamed(self) -> None:
        assert "renamed" in self._blocked_minor().lower()

    def test_minor_reason_does_not_say_removed(self) -> None:
        assert "removed" not in self._blocked_minor().lower()


class TestGenuineRemovalStillSaysRemoved:
    """A genuine removal (no compensating add of the same shape) must keep the
    "removed" wording - the rename relabel only applies to removed+added pairs."""

    def test_pure_removal_minor_reason_still_says_removed(self) -> None:
        source = _source(
            inputs=[
                {"name": "x", "type": "string", "required": True},
                {"name": "gone", "type": "string", "required": False},
            ],
            outputs=[{"name": "result", "type": "string"}],
        )
        draft = _draft(
            inputs=[{"name": "x", "type": "string", "required": True}],
            outputs=[{"name": "result", "type": "string"}],
        )
        result = compute_allowed_bumps(source, draft)
        assert "minor" in result["blocked"], result
        reason = result["blocked"]["minor"].lower()
        assert "removed" in reason
        assert "renamed" not in reason
