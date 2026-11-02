"""
Tests for NoteControl.

Tests metadata, validation, and execution behavior of the Note control.
"""

import asyncio

import pytest


class TestNoteControlMetadata:
    """Test Note control metadata declaration."""

    def test_metadata_has_correct_id(self):
        """Verify Note control has id=NOTE."""
        from wavecore.controls.note import NoteControl
        from wavecore.models.enums import ControlId

        control = NoteControl()
        assert control.metadata["id"] == ControlId.NOTE

    def test_metadata_has_correct_version(self):
        """Verify Note control version is 1.0.0."""
        from wavecore.controls.note import NoteControl

        control = NoteControl()
        assert control.metadata["version"] == "1.0.0"

    def test_metadata_has_correct_name(self):
        """Verify Note control name is 'Note'."""
        from wavecore.controls.note import NoteControl

        control = NoteControl()
        assert control.metadata["name"] == "Note"

    def test_metadata_has_correct_category(self):
        """Verify Note control category is 'misc'."""
        from wavecore.controls.note import NoteControl

        control = NoteControl()
        assert control.metadata["category"] == "misc"

    def test_metadata_has_correct_icon_name(self):
        """Verify Note control icon is 'StickyNote'."""
        from wavecore.controls.note import NoteControl

        control = NoteControl()
        assert control.metadata["icon_name"] == "StickyNote"

    def test_metadata_has_correct_description(self):
        """Verify Note control has description."""
        from wavecore.controls.note import NoteControl

        control = NoteControl()
        assert control.metadata["description"] == "Sticky-note annotation for visual documentation"

    def test_metadata_has_text_parameter(self):
        """Verify Note control has text parameter."""
        from wavecore.controls.note import NoteControl

        control = NoteControl()
        params = control.metadata["parameter_schema"]
        text_param = next(p for p in params if p.name == "text")
        assert text_param.type == "string"
        assert text_param.required is False
        assert text_param.default == ""

    def test_metadata_has_color_parameter(self):
        """Verify Note control has color parameter with enum values."""
        from wavecore.controls.note import NoteControl

        control = NoteControl()
        params = control.metadata["parameter_schema"]
        color_param = next(p for p in params if p.name == "color")
        assert color_param.type == "string"
        assert color_param.required is False
        assert color_param.default == "slate"
        assert set(color_param.enum_values) == {"yellow", "pink", "blue", "green", "slate"}

    def test_metadata_has_empty_output_schema(self):
        """Verify Note control has no outputs."""
        from wavecore.controls.note import NoteControl

        control = NoteControl()
        assert control.metadata["output_schema"] == []

    def test_metadata_has_pass_through_structure_hint(self):
        """Verify Note control has pass_through structure hint."""
        from wavecore.controls.note import NoteControl

        control = NoteControl()
        hints = control.metadata["structure_hints"]
        assert hints["type"] == "sequential"
        assert hints["pass_through"] is True


class TestNoteControlValidation:
    """Test Note control parameter validation."""

    def test_validate_accepts_empty_params(self):
        """Verify validation passes with no params (all optional)."""
        from wavecore.controls.note import NoteControl

        control = NoteControl()
        asyncio.run(control.validate({}))

    def test_validate_accepts_valid_text(self):
        """Verify validation passes with text."""
        from wavecore.controls.note import NoteControl

        control = NoteControl()
        asyncio.run(control.validate({"text": "My note"}))

    def test_validate_accepts_empty_text(self):
        """Verify validation passes with empty text."""
        from wavecore.controls.note import NoteControl

        control = NoteControl()
        asyncio.run(control.validate({"text": ""}))

    @pytest.mark.parametrize("color", ["yellow", "pink", "blue", "green", "slate"])
    def test_validate_accepts_valid_colors(self, color: str):
        """Verify validation passes for each valid color."""
        from wavecore.controls.note import NoteControl

        control = NoteControl()
        asyncio.run(control.validate({"color": color}))

    def test_validate_rejects_invalid_color(self):
        """Verify validation rejects invalid color."""
        from wavecore.controls.note import NoteControl

        control = NoteControl()
        with pytest.raises(
            ValueError,
            match=r"^Invalid note color: 'red'\. Must be one of: blue, green, pink, slate, yellow$",
        ):
            asyncio.run(control.validate({"color": "red"}))

    def test_validate_accepts_both_params(self):
        """Verify validation passes with both text and color."""
        from wavecore.controls.note import NoteControl

        control = NoteControl()
        asyncio.run(control.validate({"text": "Hello", "color": "blue"}))


class TestNoteControlExecution:
    """Test Note control execution behavior."""

    def test_execute_returns_none(self):
        """Verify execute is a no-op returning None."""
        from wavecore.controls.note import NoteControl

        control = NoteControl()
        context = {"parameters": {"text": "test", "color": "slate"}}
        result = asyncio.run(control.execute(context))
        assert result is None

    def test_execute_with_empty_context(self):
        """Verify execute works with minimal context."""
        from wavecore.controls.note import NoteControl

        control = NoteControl()
        result = asyncio.run(control.execute({}))
        assert result is None


class TestNoteControlRegistration:
    """Test Note control registration in the global registry."""

    def test_note_is_registered(self):
        """Verify Note is discoverable in the registry after registration."""
        from wavecore.controls.registry import (
            ControlImplementationRegistry,
            register_all_core_controls,
        )
        from wavecore.models.enums import ControlId

        registry = ControlImplementationRegistry()
        register_all_core_controls(registry)

        impl = registry.get(ControlId.NOTE, "1.0.0")
        assert impl is not None

    def test_note_category_is_misc(self):
        """Verify Note's category resolves to MISC."""
        from wavecore.models.enums import ControlCategory, ControlId, get_control_category

        category = get_control_category(ControlId.NOTE)
        assert category == ControlCategory.MISC
