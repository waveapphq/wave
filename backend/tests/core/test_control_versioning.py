"""
Unit tests for WAVE Control Versioning.

Requirements tested:
- REQ-3.5.0.5: Independent semantic versioning per control type
- REQ-3.5.0.6: Test/Block models support control references (controlId + controlVersion)
- REQ-3.5.0.7: Multiple control versions available simultaneously
"""

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError


class TestControlVersionMetadata:
    """Test version-specific metadata for controls (REQ-3.5.0.5)."""

    def test_control_version_stores_release_date(self):
        """Verify control versions track release date for audit trails."""
        from wavecore.models.controls.versioning import ControlVersionMetadata
        from wavecore.models.enums import ControlCategory, ControlId

        version_meta = ControlVersionMetadata(
            id=ControlId.IF_ELSE,
            version="1.0.0",
            name="If/Else",
            description="Conditional branching",
            category=ControlCategory.CONDITIONAL,
            icon_name="git-branch",
            release_date=datetime(2025, 1, 15, tzinfo=UTC),
        )

        assert version_meta.release_date == datetime(2025, 1, 15, tzinfo=UTC)

    def test_control_version_stores_changelog_entries(self):
        """Verify control versions store changelog entries for version history."""
        from wavecore.models.controls.versioning import ControlVersionMetadata
        from wavecore.models.enums import ControlCategory, ControlId

        version_meta = ControlVersionMetadata(
            id=ControlId.DELAY,
            version="2.0.0",
            name="Delay",
            description="Pause execution for a specified duration",
            category=ControlCategory.TIMING,
            icon_name="clock",
            release_date=datetime(2025, 3, 1, tzinfo=UTC),
            changelog=["Added jitter support", "Breaking: duration now requires unit suffix"],
        )

        assert len(version_meta.changelog) == 2
        assert "Added jitter support" in version_meta.changelog
        assert "Breaking: duration now requires unit suffix" in version_meta.changelog

    def test_control_version_stores_compatibility_notes(self):
        """Verify control versions store compatibility notes for migration guidance."""
        from wavecore.models.controls.versioning import ControlVersionMetadata
        from wavecore.models.enums import ControlCategory, ControlId

        version_meta = ControlVersionMetadata(
            id=ControlId.FOR,
            version="2.0.0",
            name="For Loop",
            description="Iterate over a numeric range",
            category=ControlCategory.LOOP,
            icon_name="repeat",
            release_date=datetime(2025, 2, 15, tzinfo=UTC),
            compatibility_notes="Incompatible with v1.x: 'step' parameter now required",
        )

        assert (
            version_meta.compatibility_notes
            == "Incompatible with v1.x: 'step' parameter now required"
        )

    def test_control_version_tracks_deprecation_status(self):
        """Verify control versions can be marked as deprecated."""
        from wavecore.models.controls.versioning import ControlVersionMetadata
        from wavecore.models.enums import ControlCategory, ControlId

        version_meta = ControlVersionMetadata(
            id=ControlId.WHILE,
            version="1.0.0",
            name="While Loop",
            description="Repeat while condition is true",
            category=ControlCategory.LOOP,
            icon_name="refresh-cw",
            release_date=datetime(2025, 1, 1, tzinfo=UTC),
            deprecated=True,
            deprecation_date=datetime(2025, 6, 1, tzinfo=UTC),
        )

        assert version_meta.deprecated is True
        assert version_meta.deprecation_date == datetime(2025, 6, 1, tzinfo=UTC)

    def test_control_version_defaults_changelog_empty(self):
        """Verify changelog defaults to empty list when not provided."""
        from wavecore.models.controls.versioning import ControlVersionMetadata
        from wavecore.models.enums import ControlCategory, ControlId

        version_meta = ControlVersionMetadata(
            id=ControlId.BREAK,
            version="1.0.0",
            name="Break",
            description="Exit the current loop",
            category=ControlCategory.LOOP,
            icon_name="x-circle",
            release_date=datetime(2025, 1, 1, tzinfo=UTC),
        )

        assert version_meta.changelog == []

    def test_control_version_defaults_not_deprecated(self):
        """Verify deprecated defaults to False when not provided."""
        from wavecore.models.controls.versioning import ControlVersionMetadata
        from wavecore.models.enums import ControlCategory, ControlId

        version_meta = ControlVersionMetadata(
            id=ControlId.CONTINUE,
            version="1.0.0",
            name="Continue",
            description="Skip to next iteration",
            category=ControlCategory.LOOP,
            icon_name="skip-forward",
            release_date=datetime(2025, 1, 1, tzinfo=UTC),
        )

        assert version_meta.deprecated is False
        assert version_meta.deprecation_date is None

    def test_control_version_requires_release_date(self):
        """Verify release_date is required for version metadata."""
        from wavecore.models.controls.versioning import ControlVersionMetadata
        from wavecore.models.enums import ControlCategory, ControlId

        with pytest.raises(ValidationError) as exc_info:
            ControlVersionMetadata(
                id=ControlId.HALT,
                version="1.0.0",
                name="Halt",
                description="Stop execution",
                category=ControlCategory.FLOW,
                icon_name="octagon",
                # Missing release_date
            )

        errors = exc_info.value.errors()
        assert any("release_date" in str(e) for e in errors)

    def test_control_version_rejects_invalid_semver(self):
        """Verify invalid semantic version is rejected."""
        from wavecore.models.controls.versioning import ControlVersionMetadata
        from wavecore.models.enums import ControlCategory, ControlId

        with pytest.raises(ValidationError) as exc_info:
            ControlVersionMetadata(
                id=ControlId.DELAY,
                version="not-a-version",
                name="Delay",
                description="Pause execution",
                category=ControlCategory.TIMING,
                icon_name="clock",
                release_date=datetime(2025, 1, 1, tzinfo=UTC),
            )

        errors = exc_info.value.errors()
        assert any("version" in str(e) for e in errors)

    def test_control_version_rejects_deprecation_date_when_not_deprecated(self):
        """Verify deprecation_date cannot be set when deprecated is False."""
        from wavecore.models.controls.versioning import ControlVersionMetadata
        from wavecore.models.enums import ControlCategory, ControlId

        with pytest.raises(ValidationError) as exc_info:
            ControlVersionMetadata(
                id=ControlId.FOR,
                version="1.0.0",
                name="For Loop",
                description="Iterate over range",
                category=ControlCategory.LOOP,
                icon_name="repeat",
                release_date=datetime(2025, 1, 1, tzinfo=UTC),
                deprecated=False,
                deprecation_date=datetime(2025, 6, 1, tzinfo=UTC),  # Invalid
            )

        errors = exc_info.value.errors()
        assert any("deprecation_date" in str(e) or "deprecated" in str(e) for e in errors)


class TestIndependentVersionEvolution:
    """Test independent version lineage per control type (REQ-3.5.0.5)."""

    def test_different_controls_can_have_different_versions(self):
        """Verify each control type evolves independently."""
        from wavecore.models.controls.registry import ControlRegistry
        from wavecore.models.enums import ControlId

        registry = ControlRegistry()

        # Register different versions for different controls
        registry.register_core_control(ControlId.DELAY, "2.0.0")
        registry.register_core_control(ControlId.IF_ELSE, "1.0.0")

        delay_version = registry.get_latest_version(ControlId.DELAY)
        ifelse_version = registry.get_latest_version(ControlId.IF_ELSE)

        assert delay_version == "2.0.0"
        assert ifelse_version == "1.0.0"

    def test_version_progression_follows_semver_major(self):
        """Verify MAJOR version changes indicate breaking changes."""
        from wavecore.models.controls.registry import ControlRegistry
        from wavecore.models.enums import ControlId

        registry = ControlRegistry()
        registry.register_core_control(ControlId.FOR, "1.0.0")
        registry.register_core_control(ControlId.FOR, "2.0.0")

        versions = registry.get_all_versions(ControlId.FOR)
        assert "1.0.0" in versions
        assert "2.0.0" in versions

    def test_version_progression_follows_semver_minor(self):
        """Verify MINOR version changes indicate backward-compatible additions."""
        from wavecore.models.controls.registry import ControlRegistry
        from wavecore.models.enums import ControlId

        registry = ControlRegistry()
        registry.register_core_control(ControlId.PARALLEL, "1.0.0")
        registry.register_core_control(ControlId.PARALLEL, "1.1.0")
        registry.register_core_control(ControlId.PARALLEL, "1.2.0")

        versions = registry.get_all_versions(ControlId.PARALLEL)
        assert versions == ["1.0.0", "1.1.0", "1.2.0"]

    def test_version_progression_follows_semver_patch(self):
        """Verify PATCH version changes indicate bug fixes."""
        from wavecore.models.controls.registry import ControlRegistry
        from wavecore.models.enums import ControlId

        registry = ControlRegistry()
        registry.register_core_control(ControlId.ASSERT, "1.0.0")
        registry.register_core_control(ControlId.ASSERT, "1.0.1")
        registry.register_core_control(ControlId.ASSERT, "1.0.2")

        versions = registry.get_all_versions(ControlId.ASSERT)
        assert "1.0.0" in versions
        assert "1.0.1" in versions
        assert "1.0.2" in versions


class TestControlReference:
    """Test control references with version constraints (REQ-3.5.0.6)."""

    def test_control_reference_stores_control_id(self):
        """Verify control reference stores control identifier."""
        from wavecore.models.controls.reference import ControlReference
        from wavecore.models.enums import ControlId

        ref = ControlReference(
            control_id=ControlId.IF_ELSE,
            control_version="1.0.0",
        )

        assert ref.control_id == ControlId.IF_ELSE

    def test_control_reference_stores_exact_version(self):
        """Verify control reference stores exact version pin."""
        from wavecore.models.controls.reference import ControlReference
        from wavecore.models.enums import ControlId

        ref = ControlReference(
            control_id=ControlId.DELAY,
            control_version="1.2.3",
        )

        assert ref.control_version == "1.2.3"

    def test_control_reference_accepts_caret_constraint(self):
        """Verify caret constraint (^1.0.0) for compatible minor/patch updates."""
        from wavecore.models.controls.reference import ControlReference
        from wavecore.models.enums import ControlId

        ref = ControlReference(
            control_id=ControlId.FOR,
            control_version="^1.0.0",
        )

        assert ref.control_version == "^1.0.0"

    def test_control_reference_accepts_caret_with_zero_major(self):
        """Verify caret constraint with 0.x version (^0.1.0) is accepted."""
        from wavecore.models.controls.reference import ControlReference
        from wavecore.models.enums import ControlId

        ref = ControlReference(
            control_id=ControlId.WAIT_UNTIL,
            control_version="^0.1.0",
        )

        assert ref.control_version == "^0.1.0"

    def test_control_reference_accepts_tilde_constraint(self):
        """Verify tilde constraint (~1.2.0) for patch updates only."""
        from wavecore.models.controls.reference import ControlReference
        from wavecore.models.enums import ControlId

        ref = ControlReference(
            control_id=ControlId.FOR_EACH,
            control_version="~1.2.0",
        )

        assert ref.control_version == "~1.2.0"

    def test_control_reference_accepts_range_constraint_lower_bound(self):
        """Verify range constraint with lower bound (>=1.0.0)."""
        from wavecore.models.controls.reference import ControlReference
        from wavecore.models.enums import ControlId

        ref = ControlReference(
            control_id=ControlId.WHILE,
            control_version=">=1.0.0",
        )

        assert ref.control_version == ">=1.0.0"

    def test_control_reference_accepts_range_constraint_combined(self):
        """Verify combined range constraint (>=1.0.0 <2.0.0)."""
        from wavecore.models.controls.reference import ControlReference
        from wavecore.models.enums import ControlId

        ref = ControlReference(
            control_id=ControlId.PARALLEL,
            control_version=">=1.0.0 <2.0.0",
        )

        assert ref.control_version == ">=1.0.0 <2.0.0"

    def test_control_reference_accepts_greater_than_constraint(self):
        """Verify greater-than constraint (>1.0.0)."""
        from wavecore.models.controls.reference import ControlReference
        from wavecore.models.enums import ControlId

        ref = ControlReference(
            control_id=ControlId.DELAY,
            control_version=">1.0.0",
        )

        assert ref.control_version == ">1.0.0"

    def test_control_reference_accepts_less_than_constraint(self):
        """Verify less-than constraint (<2.0.0)."""
        from wavecore.models.controls.reference import ControlReference
        from wavecore.models.enums import ControlId

        ref = ControlReference(
            control_id=ControlId.FOR,
            control_version="<2.0.0",
        )

        assert ref.control_version == "<2.0.0"

    def test_control_reference_accepts_less_than_or_equal_constraint(self):
        """Verify less-than-or-equal constraint (<=2.0.0)."""
        from wavecore.models.controls.reference import ControlReference
        from wavecore.models.enums import ControlId

        ref = ControlReference(
            control_id=ControlId.FOR_EACH,
            control_version="<=2.0.0",
        )

        assert ref.control_version == "<=2.0.0"

    def test_control_reference_rejects_invalid_constraint(self):
        """Verify invalid version constraint is rejected."""
        from wavecore.models.controls.reference import ControlReference
        from wavecore.models.enums import ControlId

        with pytest.raises(ValidationError):
            ControlReference(
                control_id=ControlId.IF_ELSE,
                control_version="not-a-version",
            )

    def test_control_reference_rejects_empty_version(self):
        """Verify empty version constraint is rejected."""
        from wavecore.models.controls.reference import ControlReference
        from wavecore.models.enums import ControlId

        with pytest.raises(ValidationError):
            ControlReference(
                control_id=ControlId.DELAY,
                control_version="",
            )


class TestVersionConstraintResolution:
    """Test version constraint resolution against registry (REQ-3.5.0.6)."""

    def test_resolve_exact_version_returns_exact_match(self):
        """Verify exact version pin resolves to itself."""
        from wavecore.models.controls.registry import ControlRegistry
        from wavecore.models.enums import ControlId

        registry = ControlRegistry()
        registry.register_core_control(ControlId.DELAY, "1.0.0")
        registry.register_core_control(ControlId.DELAY, "1.1.0")
        registry.register_core_control(ControlId.DELAY, "2.0.0")

        resolved = registry.resolve_version(ControlId.DELAY, "1.0.0")
        assert resolved == "1.0.0"

    def test_resolve_caret_returns_highest_compatible(self):
        """Verify caret constraint resolves to highest compatible version."""
        from wavecore.models.controls.registry import ControlRegistry
        from wavecore.models.enums import ControlId

        registry = ControlRegistry()
        registry.register_core_control(ControlId.FOR, "1.0.0")
        registry.register_core_control(ControlId.FOR, "1.1.0")
        registry.register_core_control(ControlId.FOR, "1.2.5")
        registry.register_core_control(ControlId.FOR, "2.0.0")

        # ^1.0.0 should match highest 1.x.x
        resolved = registry.resolve_version(ControlId.FOR, "^1.0.0")
        assert resolved == "1.2.5"

    def test_resolve_tilde_returns_highest_patch(self):
        """Verify tilde constraint resolves to highest patch version."""
        from wavecore.models.controls.registry import ControlRegistry
        from wavecore.models.enums import ControlId

        registry = ControlRegistry()
        registry.register_core_control(ControlId.ASSERT, "1.2.0")
        registry.register_core_control(ControlId.ASSERT, "1.2.1")
        registry.register_core_control(ControlId.ASSERT, "1.2.5")
        registry.register_core_control(ControlId.ASSERT, "1.3.0")

        # ~1.2.0 should match highest 1.2.x
        resolved = registry.resolve_version(ControlId.ASSERT, "~1.2.0")
        assert resolved == "1.2.5"

    def test_resolve_range_returns_highest_in_range(self):
        """Verify range constraint resolves to highest version in range."""
        from wavecore.models.controls.registry import ControlRegistry
        from wavecore.models.enums import ControlId

        registry = ControlRegistry()
        registry.register_core_control(ControlId.PARALLEL, "1.0.0")
        registry.register_core_control(ControlId.PARALLEL, "1.5.0")
        registry.register_core_control(ControlId.PARALLEL, "2.0.0")
        registry.register_core_control(ControlId.PARALLEL, "2.1.0")

        resolved = registry.resolve_version(ControlId.PARALLEL, ">=1.0.0 <2.0.0")
        assert resolved == "1.5.0"

    def test_resolve_greater_than_excludes_exact_match(self):
        """Verify greater-than constraint excludes the exact version."""
        from wavecore.models.controls.registry import ControlRegistry
        from wavecore.models.enums import ControlId

        registry = ControlRegistry()
        registry.register_core_control(ControlId.HALT, "1.0.0")
        registry.register_core_control(ControlId.HALT, "1.0.1")
        registry.register_core_control(ControlId.HALT, "1.1.0")

        # >1.0.0 should NOT match 1.0.0, but should match 1.0.1 and 1.1.0
        resolved = registry.resolve_version(ControlId.HALT, ">1.0.0")
        assert resolved == "1.1.0"

    def test_resolve_less_than_returns_highest_below(self):
        """Verify less-than constraint resolves to highest version below threshold."""
        from wavecore.models.controls.registry import ControlRegistry
        from wavecore.models.enums import ControlId

        registry = ControlRegistry()
        registry.register_core_control(ControlId.BREAK, "1.0.0")
        registry.register_core_control(ControlId.BREAK, "1.5.0")
        registry.register_core_control(ControlId.BREAK, "2.0.0")
        registry.register_core_control(ControlId.BREAK, "2.1.0")

        # <2.0.0 should match 1.0.0 and 1.5.0, return highest
        resolved = registry.resolve_version(ControlId.BREAK, "<2.0.0")
        assert resolved == "1.5.0"

    def test_resolve_caret_with_zero_major_respects_minor(self):
        """Verify caret constraint with 0.x respects minor version (^0.1.0 only matches 0.1.x)."""
        from wavecore.models.controls.registry import ControlRegistry
        from wavecore.models.enums import ControlId

        registry = ControlRegistry()
        registry.register_core_control(ControlId.WAIT_UNTIL, "0.1.0")
        registry.register_core_control(ControlId.WAIT_UNTIL, "0.1.5")
        registry.register_core_control(ControlId.WAIT_UNTIL, "0.2.0")
        registry.register_core_control(ControlId.WAIT_UNTIL, "1.0.0")

        # ^0.1.0 should only match 0.1.x per semver spec
        resolved = registry.resolve_version(ControlId.WAIT_UNTIL, "^0.1.0")
        assert resolved == "0.1.5"

    def test_resolve_missing_version_raises_error(self):
        """Verify resolution fails immediately when no matching version exists."""
        from wavecore.models.controls.registry import ControlRegistry
        from wavecore.models.controls.versioning import VersionNotFoundError
        from wavecore.models.enums import ControlId

        registry = ControlRegistry()
        registry.register_core_control(ControlId.HALT, "1.0.0")

        with pytest.raises(VersionNotFoundError) as exc_info:
            registry.resolve_version(ControlId.HALT, "2.0.0")

        assert "2.0.0" in str(exc_info.value)
        assert "halt" in str(exc_info.value).lower()

    def test_resolve_constraint_with_no_matches_raises_error(self):
        """Verify resolution fails when constraint matches no available versions."""
        from wavecore.models.controls.registry import ControlRegistry
        from wavecore.models.controls.versioning import VersionNotFoundError
        from wavecore.models.enums import ControlId

        registry = ControlRegistry()
        registry.register_core_control(ControlId.DELAY, "1.0.0")
        registry.register_core_control(ControlId.DELAY, "1.1.0")

        with pytest.raises(VersionNotFoundError):
            registry.resolve_version(ControlId.DELAY, ">=2.0.0")


class TestVersionPinningInWorkflows:
    """Test version pinning ensures workflow reproducibility (REQ-3.5.0.6)."""

    def test_workflow_preserves_pinned_version_after_registry_update(self):
        """Verify older workflows continue using pinned versions."""
        from wavecore.models.controls.reference import ControlReference
        from wavecore.models.controls.registry import ControlRegistry
        from wavecore.models.enums import ControlId

        registry = ControlRegistry()
        registry.register_core_control(ControlId.IF_ELSE, "1.0.0")

        # Workflow created with pinned version
        workflow_ref = ControlReference(
            control_id=ControlId.IF_ELSE,
            control_version="1.0.0",
        )

        # Registry gets updated with new version
        registry.register_core_control(ControlId.IF_ELSE, "2.0.0")

        # Workflow still resolves to pinned version
        resolved = registry.resolve_version(workflow_ref.control_id, workflow_ref.control_version)
        assert resolved == "1.0.0"

    def test_validation_fails_for_nonexistent_pinned_version(self):
        """Verify validation surfaces failures immediately at load time."""
        from wavecore.models.controls.registry import ControlRegistry
        from wavecore.models.controls.versioning import VersionNotFoundError
        from wavecore.models.enums import ControlId

        registry = ControlRegistry()
        registry.register_core_control(ControlId.FOR, "1.0.0")

        # Attempt to resolve version that doesn't exist
        with pytest.raises(VersionNotFoundError):
            registry.resolve_version(ControlId.FOR, "3.0.0")


class TestMultiVersionRegistry:
    """Test registry supporting multiple versions simultaneously (REQ-3.5.0.7)."""

    def test_registry_stores_multiple_versions_per_control(self):
        """Verify registry can store multiple versions of same control."""
        from wavecore.models.controls.registry import ControlRegistry
        from wavecore.models.enums import ControlId

        registry = ControlRegistry()
        registry.register_core_control(ControlId.DELAY, "1.0.0")
        registry.register_core_control(ControlId.DELAY, "1.1.0")
        registry.register_core_control(ControlId.DELAY, "2.0.0")

        versions = registry.get_all_versions(ControlId.DELAY)
        assert len(versions) == 3
        assert "1.0.0" in versions
        assert "1.1.0" in versions
        assert "2.0.0" in versions

    def test_registry_get_specific_version(self):
        """Verify specific version can be retrieved from registry."""
        from wavecore.models.controls.registry import ControlRegistry
        from wavecore.models.enums import ControlId

        registry = ControlRegistry()
        registry.register_core_control(ControlId.IF_ELSE, "1.0.0")
        registry.register_core_control(ControlId.IF_ELSE, "2.0.0")

        metadata_v1 = registry.get_version(ControlId.IF_ELSE, "1.0.0")
        metadata_v2 = registry.get_version(ControlId.IF_ELSE, "2.0.0")

        assert metadata_v1.version == "1.0.0"
        assert metadata_v2.version == "2.0.0"

    def test_each_version_has_complete_definition(self):
        """Verify each version has its own complete metadata and parameter schema."""
        from wavecore.models.controls.registry import ControlRegistry
        from wavecore.models.enums import ControlId

        registry = ControlRegistry()
        registry.register_core_control(ControlId.FOR, "1.0.0")
        registry.register_core_control(ControlId.FOR, "2.0.0")

        v1_meta = registry.get_version(ControlId.FOR, "1.0.0")
        v2_meta = registry.get_version(ControlId.FOR, "2.0.0")

        # Each version has complete metadata
        assert v1_meta.id == ControlId.FOR
        assert v1_meta.name is not None
        assert v1_meta.description is not None

        assert v2_meta.id == ControlId.FOR
        assert v2_meta.name is not None
        assert v2_meta.description is not None

    def test_different_workflows_use_different_versions_simultaneously(self):
        """Verify different workflows can use different control versions in same session."""
        from wavecore.models.controls.reference import ControlReference
        from wavecore.models.controls.registry import ControlRegistry
        from wavecore.models.enums import ControlId

        registry = ControlRegistry()
        registry.register_core_control(ControlId.PARALLEL, "1.0.0")
        registry.register_core_control(ControlId.PARALLEL, "2.0.0")

        # Workflow A uses v1
        workflow_a_ref = ControlReference(
            control_id=ControlId.PARALLEL,
            control_version="1.0.0",
        )

        # Workflow B uses v2
        workflow_b_ref = ControlReference(
            control_id=ControlId.PARALLEL,
            control_version="2.0.0",
        )

        # Both resolve correctly
        resolved_a = registry.resolve_version(
            workflow_a_ref.control_id, workflow_a_ref.control_version
        )
        resolved_b = registry.resolve_version(
            workflow_b_ref.control_id, workflow_b_ref.control_version
        )

        assert resolved_a == "1.0.0"
        assert resolved_b == "2.0.0"

    def test_registry_rejects_duplicate_version_registration(self):
        """Verify same version cannot be registered twice."""
        from wavecore.models.controls.registry import ControlRegistry
        from wavecore.models.controls.versioning import DuplicateVersionError
        from wavecore.models.enums import ControlId

        registry = ControlRegistry()
        registry.register_core_control(ControlId.ASSERT, "1.0.0")

        with pytest.raises(DuplicateVersionError):
            registry.register_core_control(ControlId.ASSERT, "1.0.0")

    def test_registry_get_nonexistent_version_raises_error(self):
        """Verify get_version raises error for non-existent version."""
        from wavecore.models.controls.registry import ControlRegistry
        from wavecore.models.controls.versioning import VersionNotFoundError
        from wavecore.models.enums import ControlId

        registry = ControlRegistry()
        registry.register_core_control(ControlId.DELAY, "1.0.0")

        with pytest.raises(VersionNotFoundError) as exc_info:
            registry.get_version(ControlId.DELAY, "99.0.0")

        assert "99.0.0" in str(exc_info.value)
        assert "delay" in str(exc_info.value).lower()


class TestDeprecatedVersions:
    """Test deprecated version handling (REQ-3.5.0.7)."""

    def test_deprecated_versions_remain_available(self):
        """Verify deprecated versions are still accessible for existing workflows."""
        from wavecore.models.controls.registry import ControlRegistry
        from wavecore.models.enums import ControlId

        registry = ControlRegistry()
        registry.register_core_control(ControlId.WHILE, "1.0.0", deprecated=True)
        registry.register_core_control(ControlId.WHILE, "2.0.0")

        # Deprecated version still available
        v1_meta = registry.get_version(ControlId.WHILE, "1.0.0")
        assert v1_meta is not None
        assert v1_meta.deprecated is True

    def test_deprecated_version_resolution_returns_warning(self):
        """Verify resolving to deprecated version includes deprecation warning."""
        from wavecore.models.controls.registry import ControlRegistry
        from wavecore.models.enums import ControlId

        registry = ControlRegistry()
        registry.register_core_control(ControlId.BREAK, "1.0.0", deprecated=True)
        registry.register_core_control(ControlId.BREAK, "2.0.0")

        resolved, warnings = registry.resolve_version_with_warnings(ControlId.BREAK, "1.0.0")

        assert resolved == "1.0.0"
        assert len(warnings) == 1
        assert "deprecated" in warnings[0].lower()

    def test_caret_constraint_skips_deprecated_versions(self):
        """Verify caret constraint prefers non-deprecated versions."""
        from wavecore.models.controls.registry import ControlRegistry
        from wavecore.models.enums import ControlId

        registry = ControlRegistry()
        registry.register_core_control(ControlId.CONTINUE, "1.0.0")
        registry.register_core_control(ControlId.CONTINUE, "1.1.0")
        registry.register_core_control(ControlId.CONTINUE, "1.2.0", deprecated=True)

        # ^1.0.0 should resolve to 1.1.0 (skips deprecated 1.2.0)
        resolved = registry.resolve_version(ControlId.CONTINUE, "^1.0.0")
        assert resolved == "1.1.0"

    def test_exact_pin_to_deprecated_version_still_works(self):
        """Verify explicit pin to deprecated version still resolves."""
        from wavecore.models.controls.registry import ControlRegistry
        from wavecore.models.enums import ControlId

        registry = ControlRegistry()
        registry.register_core_control(ControlId.HALT, "1.0.0", deprecated=True)
        registry.register_core_control(ControlId.HALT, "2.0.0")

        # Explicit pin should still work
        resolved = registry.resolve_version(ControlId.HALT, "1.0.0")
        assert resolved == "1.0.0"


class TestControlReferenceInBlocks:
    """Test control references in Block model (REQ-3.5.0.6)."""

    def test_block_can_reference_control_with_version(self):
        """Verify Block model can store control reference."""
        from wavecore.models.blocks import Block
        from wavecore.models.controls.reference import ControlReference
        from wavecore.models.enums import ControlId
        from wavecore.models.plugins import BlockMetadata

        block = Block(
            id="test-block",
            version="1.0.0",
            metadata=BlockMetadata(name="Test Block"),
            type="control",
            control_reference=ControlReference(
                control_id=ControlId.IF_ELSE,
                control_version="1.0.0",
            ),
        )

        assert block.control_reference is not None
        assert block.control_reference.control_id == ControlId.IF_ELSE
        assert block.control_reference.control_version == "1.0.0"

    def test_block_control_reference_is_optional(self):
        """Verify control_reference is optional for non-control blocks."""
        from wavecore.models.blocks import Block
        from wavecore.models.plugins import BlockMetadata

        block = Block(
            id="action-block",
            version="1.0.0",
            metadata=BlockMetadata(name="Action Block"),
            type="action",
        )

        assert block.control_reference is None

    def test_control_type_block_requires_control_reference(self):
        """Verify blocks of type 'control' require a control reference."""
        from wavecore.models.blocks import Block
        from wavecore.models.plugins import BlockMetadata

        with pytest.raises(ValidationError) as exc_info:
            Block(
                id="invalid-control-block",
                version="1.0.0",
                metadata=BlockMetadata(name="Invalid Control Block"),
                type="control",
                # Missing control_reference
            )

        errors = exc_info.value.errors()
        error_messages = [str(e) for e in errors]
        assert any("control_reference" in msg for msg in error_messages)


class TestControlReferenceInTests:
    """Test control references in Test model (REQ-3.5.0.6)."""

    def test_test_blocks_can_include_control_blocks(self):
        """Verify Test model can include blocks with control references."""
        from wavecore.models.blocks import Block
        from wavecore.models.controls.reference import ControlReference
        from wavecore.models.entities import Test
        from wavecore.models.enums import ControlId
        from wavecore.models.plugins import BlockMetadata
        from wavecore.models.workflow import WorkflowBlock

        # Create a control block
        control_block = Block(
            id="if-else-block",
            version="1.0.0",
            metadata=BlockMetadata(name="If/Else Block"),
            type="control",
            control_reference=ControlReference(
                control_id=ControlId.IF_ELSE,
                control_version="^1.0.0",
            ),
        )

        # Create a test that references the control block
        test = Test(
            id="test-with-controls",
            name="Test With Controls",
            version="1.0.0",
            blocks=[
                WorkflowBlock(
                    block_id=control_block.id,
                    block_version=control_block.version,
                    order=1,
                ),
            ],
        )

        assert len(test.blocks) == 1
        assert test.blocks[0].block_id == "if-else-block"


class TestVersionRegistryLifecycle:
    """Test registry initialization and lifecycle (REQ-3.5.0.7)."""

    def test_registry_initializes_empty(self):
        """Verify new registry starts with no registered versions."""
        from wavecore.models.controls.registry import ControlRegistry
        from wavecore.models.enums import ControlId

        registry = ControlRegistry()

        for control_id in ControlId:
            versions = registry.get_all_versions(control_id)
            assert versions == []

    def test_registry_load_core_controls_registers_all_15(self):
        """Verify load_core_controls populates all 15 control types."""
        from wavecore.models.controls.registry import ControlRegistry
        from wavecore.models.enums import ControlId

        registry = ControlRegistry()
        registry.load_core_controls()

        for control_id in ControlId:
            versions = registry.get_all_versions(control_id)
            assert len(versions) >= 1, f"Missing versions for {control_id.name}"

    def test_registry_get_latest_version_returns_highest(self):
        """Verify get_latest_version returns highest semver version."""
        from wavecore.models.controls.registry import ControlRegistry
        from wavecore.models.enums import ControlId

        registry = ControlRegistry()
        registry.register_core_control(ControlId.DELAY, "1.0.0")
        registry.register_core_control(ControlId.DELAY, "1.0.10")
        registry.register_core_control(ControlId.DELAY, "1.1.0")
        registry.register_core_control(ControlId.DELAY, "2.0.0")

        latest = registry.get_latest_version(ControlId.DELAY)
        assert latest == "2.0.0"

    def test_registry_get_latest_non_deprecated_version(self):
        """Verify can get latest non-deprecated version."""
        from wavecore.models.controls.registry import ControlRegistry
        from wavecore.models.enums import ControlId

        registry = ControlRegistry()
        registry.register_core_control(ControlId.FOR, "1.0.0")
        registry.register_core_control(ControlId.FOR, "1.1.0")
        registry.register_core_control(ControlId.FOR, "2.0.0", deprecated=True)

        latest = registry.get_latest_version(ControlId.FOR, include_deprecated=False)
        assert latest == "1.1.0"


class TestVersionCoverageEdgeCases:
    """Test edge cases for complete code coverage."""

    def test_control_version_metadata_rejects_empty_name(self):
        """Verify empty name is rejected in ControlVersionMetadata."""
        from wavecore.models.controls.versioning import ControlVersionMetadata
        from wavecore.models.enums import ControlCategory, ControlId

        with pytest.raises(ValidationError) as exc_info:
            ControlVersionMetadata(
                id=ControlId.DELAY,
                version="1.0.0",
                name="",  # Empty name
                description="Test",
                category=ControlCategory.TIMING,
                icon_name="clock",
                release_date=datetime(2025, 1, 1, tzinfo=UTC),
            )

        errors = exc_info.value.errors()
        assert any("name" in str(e).lower() or "empty" in str(e).lower() for e in errors)

    def test_control_version_metadata_rejects_whitespace_name(self):
        """Verify whitespace-only name is rejected in ControlVersionMetadata."""
        from wavecore.models.controls.versioning import ControlVersionMetadata
        from wavecore.models.enums import ControlCategory, ControlId

        with pytest.raises(ValidationError) as exc_info:
            ControlVersionMetadata(
                id=ControlId.DELAY,
                version="1.0.0",
                name="   ",  # Whitespace-only name
                description="Test",
                category=ControlCategory.TIMING,
                icon_name="clock",
                release_date=datetime(2025, 1, 1, tzinfo=UTC),
            )

        errors = exc_info.value.errors()
        assert any("name" in str(e).lower() or "empty" in str(e).lower() for e in errors)

    def test_registry_get_latest_version_empty_registry(self):
        """Verify get_latest_version returns empty string for empty registry."""
        from wavecore.models.controls.registry import ControlRegistry
        from wavecore.models.enums import ControlId

        registry = ControlRegistry()
        # Registry is empty, no versions registered

        latest = registry.get_latest_version(ControlId.DELAY)
        assert latest == ""

    def test_registry_get_latest_version_all_deprecated_excluded(self):
        """Verify get_latest_version returns empty string when all versions are deprecated."""
        from wavecore.models.controls.registry import ControlRegistry
        from wavecore.models.enums import ControlId

        registry = ControlRegistry()
        registry.register_core_control(ControlId.WHILE, "1.0.0", deprecated=True)
        registry.register_core_control(ControlId.WHILE, "2.0.0", deprecated=True)

        # All versions are deprecated, exclude them
        latest = registry.get_latest_version(ControlId.WHILE, include_deprecated=False)
        assert latest == ""

    def test_resolve_version_range_all_deprecated_falls_back(self):
        """Verify range resolution falls back to deprecated when all matching are deprecated."""
        from wavecore.models.controls.registry import ControlRegistry
        from wavecore.models.enums import ControlId

        registry = ControlRegistry()
        registry.register_core_control(ControlId.ASSERT, "1.0.0", deprecated=True)
        registry.register_core_control(ControlId.ASSERT, "1.1.0", deprecated=True)

        # Both 1.x versions are deprecated, should fall back to deprecated
        resolved = registry.resolve_version(ControlId.ASSERT, "^1.0.0")
        assert resolved == "1.1.0"

    def test_resolve_less_than_or_equal_constraint(self):
        """Verify <= constraint resolution."""
        from wavecore.models.controls.registry import ControlRegistry
        from wavecore.models.enums import ControlId

        registry = ControlRegistry()
        registry.register_core_control(ControlId.HALT, "1.0.0")
        registry.register_core_control(ControlId.HALT, "1.5.0")
        registry.register_core_control(ControlId.HALT, "2.0.0")
        registry.register_core_control(ControlId.HALT, "2.1.0")

        # <=2.0.0 should match 1.0.0, 1.5.0, and 2.0.0, return highest
        resolved = registry.resolve_version(ControlId.HALT, "<=2.0.0")
        assert resolved == "2.0.0"

    def test_unrecognized_constraint_format_raises_error(self):
        """Verify unrecognized constraint format raises VersionNotFoundError."""
        from wavecore.models.controls.registry import ControlRegistry
        from wavecore.models.controls.versioning import VersionNotFoundError
        from wavecore.models.enums import ControlId

        registry = ControlRegistry()
        registry.register_core_control(ControlId.DELAY, "1.0.0")
        registry.register_core_control(ControlId.DELAY, "2.0.0")

        # An unrecognized constraint format - bypasses ControlReference validation
        # This exercises line 583: return False in _version_matches_constraint
        with pytest.raises(VersionNotFoundError):
            registry.resolve_version(ControlId.DELAY, "invalid-constraint-format")


class TestInternalFunctions:
    """Test internal helper functions for complete coverage."""

    def test_parse_semver_invalid_version(self):
        """Verify _parse_semver raises error for invalid version."""
        # Test internal function for coverage of error path (line 515)
        from wavecore.models.controls.registry import _parse_semver

        with pytest.raises(ValueError, match="Invalid semantic version"):
            _parse_semver("not-a-version")

    def test_check_single_constraint_unknown_operator(self):
        """Verify _check_single_constraint returns False for unknown operator."""
        # Test internal function for coverage of defensive fallback (line 597)
        from wavecore.models.controls.registry import _check_single_constraint

        # Unknown operator should return False (defensive code)
        result = _check_single_constraint("1.0.0", "==", "1.0.0")
        assert result is False
