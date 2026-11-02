"""
Note control implementation.

A sticky-note annotation element for visual documentation and flow placeholders.
Invisible to the execution engine - passes through like a skipped element.
"""

from typing import Any

from wavecore.controls.base import ControlBase
from wavecore.models.controls.parameters import ControlParameter
from wavecore.models.enums import ControlId

# Valid note colors
VALID_NOTE_COLORS = {"yellow", "pink", "blue", "green", "slate"}


class NoteControl(ControlBase):
    """
    Note control - canvas annotation element.

    Provides sticky-note-style visual documentation on the workflow canvas.
    Invisible to the execution engine with pass-through flow connections.
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
        """
        Validate Note parameters.

        Text is optional (any string accepted).
        Color must be one of the valid color presets if provided.

        Args:
            params: Parameter values to validate

        Raises:
            ValueError: If color is not a valid preset
        """
        color = params.get("color")
        if color is not None and color not in VALID_NOTE_COLORS:
            valid = ", ".join(sorted(VALID_NOTE_COLORS))
            raise ValueError(f"Invalid note color: {color!r}. Must be one of: {valid}")
