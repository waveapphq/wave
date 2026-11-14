"""
Note control implementation.

A sticky-note annotation element for visual documentation and flow placeholders.
A Note does nothing when the run reaches it and passes the flow straight on.
"""

from collections.abc import Mapping, Sequence
from typing import Any, TypeVar

from wavecore.controls.base import ControlBase
from wavecore.models.controls.parameters import ControlParameter
from wavecore.models.enums import ControlId

# Valid note colors
VALID_NOTE_COLORS = {"yellow", "pink", "blue", "green", "slate"}

NOTE_NODE_TYPE = "noteNode"

_Node = TypeVar("_Node", bound=Mapping[str, Any])


def edgeless_notes(nodes: Sequence[_Node], edges: Sequence[Mapping[str, Any]]) -> list[_Node]:
    """The Notes nothing connects to: annotations beside the flow, never reached."""
    touched = {str(edge.get("source")) for edge in edges} | {
        str(edge.get("target")) for edge in edges
    }
    return [
        node
        for node in nodes
        if node.get("type") == NOTE_NODE_TYPE and str(node.get("id")) not in touched
    ]


class NoteControl(ControlBase):
    """
    Note control - canvas annotation element.

    Provides sticky-note-style visual documentation on the workflow canvas.
    It does nothing when the run reaches it and passes the flow straight on.
    """

    CONTROL_ID = ControlId.NOTE
    CONTROL_VERSION = "1.0.0"
    CONTROL_NAME = "Note"
    CONTROL_CATEGORY = "misc"

    @property
    def metadata(self) -> dict[str, Any]:
        """Return Note control metadata."""
        return {
            "id": self.CONTROL_ID,
            "version": self.CONTROL_VERSION,
            "name": self.CONTROL_NAME,
            "description": "Sticky-note annotation for visual documentation",
            "category": self.CONTROL_CATEGORY,
            "icon_name": "StickyNote",
            "parameter_schema": [
                ControlParameter(
                    name="text",
                    type="string",
                    required=False,
                    default="",
                    description="Note text content",
                ),
                ControlParameter(
                    name="color",
                    type="string",
                    required=False,
                    default="slate",
                    description="Note background color",
                    enum_values=sorted(VALID_NOTE_COLORS),
                ),
            ],
            "output_schema": [],
            "structure_hints": {
                "type": "sequential",
                "pass_through": True,
            },
        }

    async def execute(self, context: dict[str, Any]) -> None:
        """Execute Note control - no-op pass-through."""
        return None

    async def validate(self, params: dict[str, Any]) -> None:
        """Note has no rule beyond its declared fields; the shared check reads the color list."""
