"""
Unit tests for WAVE Control Entity Model.

Requirements tested:
- REQ-3.5.0.1: Controls as distinct entity type separate from plugins and blocks
- REQ-3.5.0.2: Control data model with id, version, name, description, category
- REQ-3.5.0.3: Control parameter schema definition (inputs for configuration)
"""

import pytest
from pydantic import ValidationError


class TestControlInventory:
    """Test the fixed set of 15 controls (REQ-3.5.0.1)."""

    def test_control_id_has_exactly_15_controls(self):
        """Verify ControlId contains exactly the 15 controls from design spec."""
        from wavecore.models.enums import ControlId

        expected_controls = {
            # Conditional (3)
            "IF_ELSE",
            "SWITCH_CASE",
            "ASSERT",
            # Loop (5)
            "FOR",
            "FOR_EACH",
            "WHILE",
            "BREAK",
            "CONTINUE",
            # Flow (4)
            "PARALLEL",
            "TRY_CATCH_FINALLY",
            "HALT",
            "VARIABLE_SETTER",
            # Timing (2)
            "DELAY",
            "WAIT_UNTIL",
            # Misc (1)
            "NOTE",
        }

        actual = {member.name for member in ControlId}
        assert actual == expected_controls

    def test_control_id_kebab_case_values_for_api_serialization(self):
        """Verify ControlId values are kebab-case for API/storage consistency."""
        from wavecore.models.enums import ControlId

        # Sample check - API serialization format
        assert ControlId.IF_ELSE.value == "if-else"
        assert ControlId.FOR_EACH.value == "for-each"
        assert ControlId.TRY_CATCH_FINALLY.value == "try-catch-finally"
        assert ControlId.WAIT_UNTIL.value == "wait-until"
        assert ControlId.ASSERT.value == "assert"
        assert ControlId.HALT.value == "halt"

    def test_control_category_has_exactly_5_categories(self):
        """Verify ControlCategory contains exactly 5 categories from design spec."""
        from wavecore.models.enums import ControlCategory

        expected = {"CONDITIONAL", "LOOP", "FLOW", "TIMING", "MISC"}
        actual = {member.name for member in ControlCategory}
        assert actual == expected


class TestControlCategoryMapping:
    """Test category derivation from control identity (REQ-3.5.0.2)."""

    def test_conditional_controls_map_to_conditional_category(self):
        """Verify conditional controls (if-else, switch, assert) map to CONDITIONAL."""
        from wavecore.models.enums import ControlCategory, ControlId, get_control_category

        assert get_control_category(ControlId.IF_ELSE) == ControlCategory.CONDITIONAL
        assert get_control_category(ControlId.SWITCH_CASE) == ControlCategory.CONDITIONAL
        assert get_control_category(ControlId.ASSERT) == ControlCategory.CONDITIONAL

    def test_loop_controls_map_to_loop_category(self):
        """Verify loop controls (for, for-each, while, break, continue) map to LOOP."""
        from wavecore.models.enums import ControlCategory, ControlId, get_control_category

        assert get_control_category(ControlId.FOR) == ControlCategory.LOOP
        assert get_control_category(ControlId.FOR_EACH) == ControlCategory.LOOP
        assert get_control_category(ControlId.WHILE) == ControlCategory.LOOP
        assert get_control_category(ControlId.BREAK) == ControlCategory.LOOP
        assert get_control_category(ControlId.CONTINUE) == ControlCategory.LOOP

    def test_flow_controls_map_to_flow_category(self):
        """Verify flow controls (parallel, try-catch, halt, variable-setter) map to FLOW."""
        from wavecore.models.enums import ControlCategory, ControlId, get_control_category

        assert get_control_category(ControlId.PARALLEL) == ControlCategory.FLOW
        assert get_control_category(ControlId.TRY_CATCH_FINALLY) == ControlCategory.FLOW
        assert get_control_category(ControlId.HALT) == ControlCategory.FLOW
        assert get_control_category(ControlId.VARIABLE_SETTER) == ControlCategory.FLOW

    def test_timing_controls_map_to_timing_category(self):
        """Verify timing controls (delay, wait-until) map to TIMING."""
        from wavecore.models.enums import ControlCategory, ControlId, get_control_category

        assert get_control_category(ControlId.DELAY) == ControlCategory.TIMING
        assert get_control_category(ControlId.WAIT_UNTIL) == ControlCategory.TIMING

    def test_get_controls_by_category_returns_correct_sets(self):
        """Verify controls can be retrieved by category."""
        from wavecore.models.enums import ControlCategory, ControlId, get_controls_by_category

        conditional = get_controls_by_category(ControlCategory.CONDITIONAL)
        assert set(conditional) == {ControlId.IF_ELSE, ControlId.SWITCH_CASE, ControlId.ASSERT}

        loop = get_controls_by_category(ControlCategory.LOOP)
        assert set(loop) == {
            ControlId.FOR,
            ControlId.FOR_EACH,
            ControlId.WHILE,
            ControlId.BREAK,
            ControlId.CONTINUE,
        }

        flow = get_controls_by_category(ControlCategory.FLOW)
        assert set(flow) == {
            ControlId.PARALLEL,
            ControlId.TRY_CATCH_FINALLY,
            ControlId.HALT,
            ControlId.VARIABLE_SETTER,
        }

        timing = get_controls_by_category(ControlCategory.TIMING)
        assert set(timing) == {ControlId.DELAY, ControlId.WAIT_UNTIL}


class TestControlMetadata:
    """Test ControlMetadata model (REQ-3.5.0.2, REQ-3.5.0.4)."""

    def test_control_metadata_stores_all_required_fields(self):
        """Verify ControlMetadata stores id, version, name, description, category, icon."""
        from wavecore.models.controls.metadata import ControlMetadata
        from wavecore.models.enums import ControlCategory, ControlId

        metadata = ControlMetadata(
            id=ControlId.IF_ELSE,
            version="1.0.0",
            name="If/Else Conditional",
            description="Conditional branching based on expression evaluation",
            category=ControlCategory.CONDITIONAL,
            icon_name="git-branch",
        )

        assert metadata.id == ControlId.IF_ELSE
        assert metadata.version == "1.0.0"
        assert metadata.name == "If/Else Conditional"
        assert metadata.description == "Conditional branching based on expression evaluation"
        assert metadata.category == ControlCategory.CONDITIONAL
        assert metadata.icon_name == "git-branch"

    def test_control_metadata_rejects_invalid_semver(self):
        """Verify semantic versioning is enforced (REQ-3.5.0.2)."""
        from wavecore.models.controls.metadata import ControlMetadata
        from wavecore.models.enums import ControlCategory, ControlId

        with pytest.raises(ValidationError):
            ControlMetadata(
                id=ControlId.DELAY,
                version="1.0",  # Invalid - missing patch
                name="Delay",
                description="Pause execution",
                category=ControlCategory.TIMING,
                icon_name="clock",
            )

    def test_control_metadata_rejects_empty_name(self):
        """Verify name cannot be empty (UI display requirement)."""
        from wavecore.models.controls.metadata import ControlMetadata
        from wavecore.models.enums import ControlCategory, ControlId

        with pytest.raises(ValidationError):
            ControlMetadata(
                id=ControlId.IF_ELSE,
                version="1.0.0",
                name="",
                description="Test",
                category=ControlCategory.CONDITIONAL,
                icon_name="git-branch",
            )

    def test_control_metadata_rejects_whitespace_only_name(self):
        """Verify whitespace-only name is rejected."""
        from wavecore.models.controls.metadata import ControlMetadata
        from wavecore.models.enums import ControlCategory, ControlId

        with pytest.raises(ValidationError):
            ControlMetadata(
                id=ControlId.IF_ELSE,
                version="1.0.0",
                name="   ",
                description="Test",
                category=ControlCategory.CONDITIONAL,
                icon_name="git-branch",
            )


class TestControlDistinctFromPluginAndBlock:
    """Test controls are distinct entity type (REQ-3.5.0.1)."""

    def test_control_metadata_lacks_plugin_specific_fields(self):
        """Verify ControlMetadata does not have Plugin-specific attributes."""
        from wavecore.models.controls.metadata import ControlMetadata
        from wavecore.models.enums import ControlCategory, ControlId

        metadata = ControlMetadata(
            id=ControlId.IF_ELSE,
            version="1.0.0",
            name="If/Else",
            description="Test",
            category=ControlCategory.CONDITIONAL,
            icon_name="git-branch",
        )

        # Plugin-specific fields should not exist
        assert not hasattr(metadata, "implementation")
        assert not hasattr(metadata, "return_type")

    def test_control_metadata_lacks_block_specific_fields(self):
        """Verify ControlMetadata does not have Block-specific attributes."""
        from wavecore.models.controls.metadata import ControlMetadata
        from wavecore.models.enums import ControlCategory, ControlId

        metadata = ControlMetadata(
            id=ControlId.FOR,
            version="1.0.0",
            name="For Loop",
            description="Test",
            category=ControlCategory.LOOP,
            icon_name="repeat",
        )

        # Block-specific fields should not exist
        assert not hasattr(metadata, "plugins")
        assert not hasattr(metadata, "child_blocks")
        assert not hasattr(metadata, "dependencies")


class TestControlParameterTypes:
    """Test control parameter type support (REQ-3.5.0.3)."""

    def test_control_parameter_supports_expression_type(self):
        """Verify string type for runtime-evaluated conditions (expressions are strings)."""
        from wavecore.models.controls.parameters import ControlParameter

        param = ControlParameter(
            name="condition",
            type="string",
            required=True,
            description="Boolean expression evaluated at runtime",
        )
        assert param.type == "string"

    def test_control_parameter_supports_duration_type(self):
        """Verify integer type for timing controls (duration in milliseconds)."""
        from wavecore.models.controls.parameters import ControlParameter

        param = ControlParameter(
            name="duration",
            type="integer",
            required=True,
            description="Wait duration in milliseconds",
        )
        assert param.type == "integer"

    def test_control_parameter_supports_standard_types(self):
        """Verify string, integer, boolean types are supported."""
        from wavecore.models.controls.parameters import ControlParameter

        str_param = ControlParameter(name="iterator", type="string", required=True)
        num_param = ControlParameter(name="count", type="integer", required=True)
        bool_param = ControlParameter(
            name="inclusive", type="boolean", required=False, default=True
        )

        assert str_param.type == "string"
        assert num_param.type == "integer"
        assert bool_param.type == "boolean"
        assert bool_param.default is True

    def test_control_parameter_supports_array_type(self):
        """Verify array type for controls like for-each."""
        from wavecore.models.controls.parameters import ControlParameter

        param = ControlParameter(
            name="items",
            type="array",
            required=True,
            description="Collection to iterate over",
        )
        assert param.type == "array"

    def test_control_parameter_rejects_invalid_type(self):
        """Verify invalid types are rejected."""
        from wavecore.models.controls.parameters import ControlParameter

        with pytest.raises(ValidationError):
            ControlParameter(name="test", type="invalid_type", required=False)

    def test_control_parameter_rejects_empty_name(self):
        """Verify empty parameter name is rejected."""
        from wavecore.models.controls.parameters import ControlParameter

        with pytest.raises(ValidationError):
            ControlParameter(name="", type="string", required=False)

    def test_control_parameter_required_may_have_default(self):
        """A required row may carry the default the Block window shows (REQ-3.5.0.3)."""
        from wavecore.models.controls.parameters import ControlParameter

        param = ControlParameter(name="test", type="string", required=True, default="value")
        assert (param.required, param.default) == (True, "value")

    def test_control_parameter_enum_values_require_string_type(self):
        """Verify enum_values is rejected when type is not string."""
        from wavecore.models.controls.parameters import ControlParameter

        with pytest.raises(ValidationError, match="enum_values but type is 'integer'"):
            ControlParameter(name="count", type="integer", enum_values=["a", "b"])

    def test_control_parameter_required_when_accepted(self):
        """Verify required_when field is accepted on non-required parameters."""
        from wavecore.models.controls.parameters import ControlParameter, RequiredWhen

        param = ControlParameter(
            name="count",
            type="integer",
            required_when=RequiredWhen(field="mode", values=["count"]),
        )
        assert param.required is False
        assert param.required_when is not None
        assert param.required_when.field == "mode"
        assert param.required_when.values == ["count"]

    def test_control_parameter_required_and_required_when_mutually_exclusive(self):
        """Verify required and required_when cannot both be set."""
        from wavecore.models.controls.parameters import ControlParameter, RequiredWhen

        with pytest.raises(
            ValidationError,
            match="cannot have both 'required' and 'required_when'",
        ):
            ControlParameter(
                name="count",
                type="integer",
                required=True,
                required_when=RequiredWhen(field="mode", values=["count"]),
            )

    def test_required_when_defaults_to_none(self):
        """Verify required_when is None by default."""
        from wavecore.models.controls.parameters import ControlParameter

        param = ControlParameter(name="timeout", type="float")
        assert param.required_when is None

    def test_control_parameter_supports_multi_type(self):
        """Verify type field accepts a list of valid types."""
        from wavecore.models.controls.parameters import ControlParameter

        param = ControlParameter(
            name="collection",
            type=["array", "map", "table"],
            required=True,
            description="Collection to iterate over",
        )
        assert param.type == ["array", "map", "table"]

    def test_control_parameter_multi_type_rejects_invalid_entry(self):
        """Verify multi-type list rejects invalid type strings."""
        from wavecore.models.controls.parameters import ControlParameter

        with pytest.raises(ValidationError):
            ControlParameter(name="test", type=["array", "invalid"], required=False)

    def test_control_parameter_enum_values_rejected_for_multi_type(self):
        """Verify enum_values is rejected when type is a list."""
        from wavecore.models.controls.parameters import ControlParameter

        with pytest.raises(ValidationError, match="must be 'string', not a list"):
            ControlParameter(
                name="test",
                type=["string", "integer"],
                enum_values=["a", "b"],
            )


class TestControlParameterSchemas:
    """Test parameter schemas for specific controls (REQ-3.5.0.3)."""

    def test_if_else_requires_condition_expression(self):
        """Verify if-else control requires condition parameter."""
        from wavecore.models.controls.metadata import ControlParameterSchema
        from wavecore.models.controls.parameters import ControlParameter
        from wavecore.models.enums import ControlId

        schema = ControlParameterSchema(
            control_id=ControlId.IF_ELSE,
            parameters=[
                ControlParameter(
                    name="condition",
                    type="string",
                    required=True,
                    description="Boolean condition expression",
                ),
            ],
        )

        assert schema.control_id == ControlId.IF_ELSE
        assert len(schema.parameters) == 1
        assert schema.parameters[0].name == "condition"
        assert schema.parameters[0].type == "string"
        assert schema.parameters[0].required is True

    def test_for_loop_requires_iterator_start_end(self):
        """Verify for-loop control requires iterator, start, end parameters."""
        from wavecore.models.controls.metadata import ControlParameterSchema
        from wavecore.models.controls.parameters import ControlParameter
        from wavecore.models.enums import ControlId

        schema = ControlParameterSchema(
            control_id=ControlId.FOR,
            parameters=[
                ControlParameter(name="iterator", type="string", required=True),
                ControlParameter(name="start", type="string", required=True),
                ControlParameter(name="end", type="string", required=True),
                ControlParameter(name="step", type="string", required=False, default="1"),
            ],
        )

        assert schema.control_id == ControlId.FOR
        required = [p for p in schema.parameters if p.required]
        assert len(required) == 3
        assert {p.name for p in required} == {"iterator", "start", "end"}

    def test_for_each_requires_iterator_and_collection(self):
        """Verify for-each control requires iterator variable and collection."""
        from wavecore.models.controls.metadata import ControlParameterSchema
        from wavecore.models.controls.parameters import ControlParameter
        from wavecore.models.enums import ControlId

        schema = ControlParameterSchema(
            control_id=ControlId.FOR_EACH,
            parameters=[
                ControlParameter(name="iterator", type="string", required=True),
                ControlParameter(name="collection", type="string", required=True),
            ],
        )

        assert schema.control_id == ControlId.FOR_EACH
        assert len(schema.parameters) == 2

    def test_while_requires_condition(self):
        """Verify while control requires condition parameter."""
        from wavecore.models.controls.metadata import ControlParameterSchema
        from wavecore.models.controls.parameters import ControlParameter
        from wavecore.models.enums import ControlId

        schema = ControlParameterSchema(
            control_id=ControlId.WHILE,
            parameters=[
                ControlParameter(name="condition", type="string", required=True),
                ControlParameter(name="max_iterations", type="integer", required=False),
            ],
        )

        assert schema.control_id == ControlId.WHILE
        assert schema.parameters[0].name == "condition"

    def test_delay_requires_duration(self):
        """Verify delay control requires duration parameter."""
        from wavecore.models.controls.metadata import ControlParameterSchema
        from wavecore.models.controls.parameters import ControlParameter
        from wavecore.models.enums import ControlId

        schema = ControlParameterSchema(
            control_id=ControlId.DELAY,
            parameters=[
                ControlParameter(name="duration", type="integer", required=True),
                ControlParameter(name="jitter", type="integer", required=False, default="0s"),
            ],
        )

        assert schema.control_id == ControlId.DELAY
        assert schema.parameters[0].type == "integer"

    def test_wait_until_requires_conditions_and_timeout(self):
        """Verify wait-until control requires conditions and timeout."""
        from wavecore.models.controls.metadata import ControlParameterSchema
        from wavecore.models.controls.parameters import ControlParameter
        from wavecore.models.enums import ControlId

        schema = ControlParameterSchema(
            control_id=ControlId.WAIT_UNTIL,
            parameters=[
                ControlParameter(name="conditions", type="array", required=True),
                ControlParameter(name="timeout", type="integer", required=True),
                ControlParameter(
                    name="check_interval", type="integer", required=False, default=1000
                ),
            ],
        )

        assert schema.control_id == ControlId.WAIT_UNTIL
        required = [p for p in schema.parameters if p.required]
        assert len(required) == 2

    def test_break_continue_have_no_parameters(self):
        """Verify loop modifiers (break, continue) need no parameters."""
        from wavecore.models.controls.metadata import ControlParameterSchema
        from wavecore.models.enums import ControlId

        for control_id in [ControlId.BREAK, ControlId.CONTINUE]:
            schema = ControlParameterSchema(control_id=control_id, parameters=[])
            assert len(schema.parameters) == 0

    def test_switch_case_requires_branches(self):
        """Verify switch-case control requires the ordered branches array."""
        from wavecore.models.controls.metadata import ControlParameterSchema
        from wavecore.models.controls.parameters import ControlParameter
        from wavecore.models.enums import ControlId

        schema = ControlParameterSchema(
            control_id=ControlId.SWITCH_CASE,
            parameters=[
                ControlParameter(
                    name="branches",
                    type="array",
                    required=True,
                    description=(
                        "Ordered list of case branches with conditions and break, "
                        "plus an optional default"
                    ),
                ),
            ],
        )

        assert schema.control_id == ControlId.SWITCH_CASE
        assert len(schema.parameters) == 1
        assert schema.parameters[0].name == "branches"
        assert schema.parameters[0].type == "array"
        assert schema.parameters[0].required is True

    def test_parallel_requires_branches_join_and_limit(self):
        """Verify parallel control declares branches, a join mode and a time limit."""
        from wavecore.models.controls.metadata import ControlParameterSchema
        from wavecore.models.controls.parameters import ControlParameter
        from wavecore.models.enums import ControlId

        schema = ControlParameterSchema(
            control_id=ControlId.PARALLEL,
            parameters=[
                ControlParameter(
                    name="branches",
                    type="array",
                    required=True,
                    description="Ordered branches, each with a name and an optional time limit",
                ),
                ControlParameter(
                    name="join",
                    type="string",
                    required=False,
                    default="all",
                    enum_values=["all", "first"],
                    description="When the join releases: all branches, or the first to finish",
                ),
                ControlParameter(
                    name="time_limit",
                    type="integer",
                    required=False,
                    description="Time limit for the whole section in milliseconds",
                ),
            ],
        )

        assert schema.control_id == ControlId.PARALLEL
        assert len(schema.parameters) == 3

    def test_try_catch_finally_has_no_parameters(self):
        """Verify try-catch-finally has no parameters (structure is in branches)."""
        from wavecore.models.controls.metadata import ControlParameterSchema
        from wavecore.models.enums import ControlId

        schema = ControlParameterSchema(control_id=ControlId.TRY_CATCH_FINALLY, parameters=[])
        assert len(schema.parameters) == 0

    def test_assert_requires_condition(self):
        """Verify assert control requires condition expression."""
        from wavecore.models.controls.metadata import ControlParameterSchema
        from wavecore.models.controls.parameters import ControlParameter
        from wavecore.models.enums import ControlId

        schema = ControlParameterSchema(
            control_id=ControlId.ASSERT,
            parameters=[
                ControlParameter(
                    name="condition",
                    type="string",
                    required=True,
                    description="Boolean condition that must be true",
                ),
                ControlParameter(
                    name="message",
                    type="string",
                    required=False,
                    description="Message to display on assertion failure",
                ),
            ],
        )

        assert schema.control_id == ControlId.ASSERT
        required = [p for p in schema.parameters if p.required]
        assert len(required) == 1
        assert required[0].name == "condition"

    def test_halt_requires_scope(self):
        """Verify halt control requires scope parameter."""
        from wavecore.models.controls.metadata import ControlParameterSchema
        from wavecore.models.controls.parameters import ControlParameter
        from wavecore.models.enums import ControlId

        schema = ControlParameterSchema(
            control_id=ControlId.HALT,
            parameters=[
                ControlParameter(
                    name="scope",
                    type="string",
                    required=True,
                    description="Halt scope: test, suite, or regression",
                ),
                ControlParameter(
                    name="reason",
                    type="string",
                    required=False,
                    description="Reason for halting execution",
                ),
            ],
        )

        assert schema.control_id == ControlId.HALT
        required = [p for p in schema.parameters if p.required]
        assert len(required) == 1
        assert required[0].name == "scope"

    def test_parameter_schema_rejects_duplicate_names(self):
        """Verify duplicate parameter names are rejected."""
        from wavecore.models.controls.metadata import ControlParameterSchema
        from wavecore.models.controls.parameters import ControlParameter
        from wavecore.models.enums import ControlId

        with pytest.raises(ValidationError):
            ControlParameterSchema(
                control_id=ControlId.FOR,
                parameters=[
                    ControlParameter(name="value", type="string", required=True),
                    ControlParameter(name="value", type="integer", required=False),
                ],
            )


class TestControlOutputDeclarations:
    """Test controls declare only outputs their runtime writes (REQ-3.5.0.3)."""

    def test_switch_case_declares_no_outputs(self):
        """Verify switch-case produces no bindable outputs."""
        # Guard: switch declared a matchedCase output the runtime never wrote
        from wavecore.controls.conditional import SwitchCaseControl

        assert SwitchCaseControl().metadata["output_schema"] == []


class TestCoreControlsRegistry:
    """Test CORE_CONTROLS registry (REQ-3.5.0.4)."""

    def test_core_controls_contains_all_15_controls(self):
        """Verify CORE_CONTROLS has metadata for all 15 control types."""
        from wavecore.models.controls.metadata import CORE_CONTROLS
        from wavecore.models.enums import ControlId

        for control_id in ControlId:
            assert control_id in CORE_CONTROLS, f"Missing: {control_id.name}"
        assert len(CORE_CONTROLS) == 15

    def test_core_controls_metadata_id_matches_key(self):
        """Verify each registry entry's id matches its key."""
        from wavecore.models.controls.metadata import CORE_CONTROLS
        from wavecore.models.enums import ControlId

        for control_id in ControlId:
            metadata = CORE_CONTROLS[control_id]
            assert metadata.id == control_id

    def test_core_controls_have_non_empty_names_and_descriptions(self):
        """Verify all core controls have populated display metadata."""
        from wavecore.models.controls.metadata import CORE_CONTROLS

        for control_id, metadata in CORE_CONTROLS.items():
            assert metadata.name, f"{control_id.name} missing name"
            assert metadata.description, f"{control_id.name} missing description"
            assert metadata.icon_name, f"{control_id.name} missing icon_name"

    def test_core_controls_categories_match_get_control_category(self):
        """Verify registry categories are consistent with category mapping."""
        from wavecore.models.controls.metadata import CORE_CONTROLS
        from wavecore.models.enums import get_control_category

        for control_id, metadata in CORE_CONTROLS.items():
            expected_category = get_control_category(control_id)
            assert metadata.category == expected_category, (
                f"{control_id.name}: registry has {metadata.category}, "
                f"mapping returns {expected_category}"
            )


class TestControlParameterHasNoSecretField:
    """Input parameters carry no secret designation: secret is a property of a
    variable, never of a plugin/control input parameter."""

    def test_control_parameter_has_no_secret_field(self):
        from wavecore.models.controls.parameters import ControlParameter

        assert "secret" not in ControlParameter.model_fields

    def test_constructed_parameter_exposes_no_secret_attribute(self):
        from wavecore.models.controls.parameters import ControlParameter

        param = ControlParameter(name="password", type="string")

        assert not hasattr(param, "secret")
