"""Per-major no-backports rule for edit-mode publish (REQ-3.1.2.2).

The no-backports rule is PER-MAJOR, not global. A published target must exceed
the latest version *within its own major line*; it is unconstrained by versions
in other major lines:

- 1.0.1 may be published even when 2.0.0 already exists (different major line).
- 2.0.0 may NOT be published when 2.0.1 already exists (backport within 2.x).
- A target in a major line that holds no versions yet (e.g. publishing 2.x when
  only 1.x and 3.x exist) is unconstrained.

The rejection message names the offending line:
    Target version '<t>' must be greater than the latest version '<l>' in the <M>.x line
"""

from __future__ import annotations

import re
import uuid
from typing import Any

import pytest

from wavecore.api.exceptions import UnprocessableEntityException

pytestmark = pytest.mark.usefixtures("temp_storage_path")


# ---------------------------------------------------------------------------
# Builders / seeding
# ---------------------------------------------------------------------------


def _source_body() -> dict[str, Any]:
    return {
        "inputs": [{"name": "x", "type": "string", "required": True}],
        "outputs": [{"name": "result", "type": "string"}],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {"nodes": [], "edges": []},
    }


def _metadata() -> dict[str, Any]:
    return {
        "description": "say hello",
        "tags": ["demo"],
        "changelog": "seed",
        "details": "",
        "published_at": "2026-01-01T00:00:00Z",
        "published_by": "wave",
    }


def _draft_description_change(name: str = "greet") -> dict[str, Any]:
    """A draft that only edits the description: a clean PATCH/MINOR/MAJOR bump
    so the per-major rule is the only thing that can block a target."""
    return {
        "name": name,
        "description": "new wording",
        "tags": ["demo"],
        "inputs": [{"name": "x", "type": "string", "required": True}],
        "outputs": [{"name": "result", "type": "string"}],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {"nodes": [], "edges": []},
    }


def _seed_versions(*versions: str, name: str = "greet") -> str:
    from wavecore.api.services.functions._storage import save_new_version

    fn_id = str(uuid.uuid4())
    for version in versions:
        save_new_version(fn_id, version, _source_body(), _metadata(), name=name)
    return fn_id


def _publish(
    fn_id: str,
    *,
    source_version: str,
    target_version: str,
    changelog: str = "edit",
) -> dict[str, Any]:
    from wavecore.api.services.functions.service import add_function_version

    return add_function_version(
        fn_id,
        source_version=source_version,
        target_version=target_version,
        draft_definition=_draft_description_change(),
        changelog=changelog,
        description="new wording",
        tags=["demo"],
        details="",
    )


# ---------------------------------------------------------------------------
# A lower / different major line can still receive versions
# ---------------------------------------------------------------------------


class TestPerMajorAllowsOtherMajorLines:
    """'I must be able to create 1.0.1 even if 2.0.0 exists.'"""

    def test_patch_in_one_x_allowed_when_two_x_exists(self) -> None:
        fn_id = _seed_versions("1.0.0", "2.0.0")
        result = _publish(fn_id, source_version="1.0.0", target_version="1.0.1")
        assert result == {"function_id": fn_id, "version": "1.0.1"}

    def test_minor_in_one_x_allowed_when_two_x_exists(self) -> None:
        fn_id = _seed_versions("1.0.0", "2.0.0")
        result = _publish(fn_id, source_version="1.0.0", target_version="1.1.0")
        assert result["version"] == "1.1.0"

    def test_new_version_in_lower_major_is_durable(self) -> None:
        from wavecore.api.services.functions._storage import list_versions

        fn_id = _seed_versions("1.0.0", "2.0.0")
        _publish(fn_id, source_version="1.0.0", target_version="1.0.1")
        versions = {entry["version"] for entry in list_versions(fn_id)["versions"]}
        assert {"1.0.0", "1.0.1", "2.0.0"} <= versions


# ---------------------------------------------------------------------------
# A target must exceed the latest version WITHIN its own major line
# ---------------------------------------------------------------------------


class TestPerMajorBlocksWithinOccupiedLine:
    """'I must not be able to create 2.0.0 if 2.0.1 exists.'"""

    def test_target_below_line_head_rejected_with_per_major_message(self) -> None:
        # The 2.x line head is 2.0.1; creating 2.0.0 is a backport within the 2.x line.
        fn_id = _seed_versions("1.0.0", "2.0.1")
        with pytest.raises(UnprocessableEntityException) as exc_info:
            _publish(fn_id, source_version="1.0.0", target_version="2.0.0")
        assert re.match(
            r"^Target version '2\.0\.0' must be greater than the latest version "
            r"'2\.0\.1' in the 2\.x line$",
            exc_info.value.message,
        ), exc_info.value.message

    def test_patch_backport_within_one_x_rejected(self) -> None:
        # The 1.x line already holds 1.0.2; 1.0.1 is a backport within the 1.x line.
        fn_id = _seed_versions("1.0.0", "1.0.2", "2.0.0")
        with pytest.raises(UnprocessableEntityException) as exc_info:
            _publish(fn_id, source_version="1.0.0", target_version="1.0.1")
        assert re.match(
            r"^Target version '1\.0\.1' must be greater than the latest version "
            r"'1\.0\.2' in the 1\.x line$",
            exc_info.value.message,
        ), exc_info.value.message

    def test_prerelease_within_occupied_line_rejected(self) -> None:
        # 2.0.0 is already released; 2.0.0-dev1 sorts below it within the 2.x line.
        fn_id = _seed_versions("1.0.0", "2.0.0")
        with pytest.raises(UnprocessableEntityException) as exc_info:
            _publish(fn_id, source_version="1.0.0", target_version="2.0.0-dev1")
        assert re.match(
            r"^Target version '2\.0\.0-dev1' must be greater than the latest version "
            r"'2\.0\.0' in the 2\.x line$",
            exc_info.value.message,
        ), exc_info.value.message


# ---------------------------------------------------------------------------
# A major line with no versions yet is unconstrained
# ---------------------------------------------------------------------------


class TestPerMajorAllowsEmptyMajorLine:
    def test_middle_major_line_allowed_below_higher_major(self) -> None:
        # Only 1.x and 3.x exist; the 2.x line is empty, so 2.0.0 is allowed even
        # though 3.0.0 (a higher major) already exists.
        fn_id = _seed_versions("1.0.0", "3.0.0")
        result = _publish(fn_id, source_version="1.0.0", target_version="2.0.0")
        assert result["version"] == "2.0.0"

    def test_advancing_to_brand_new_top_major_allowed(self) -> None:
        fn_id = _seed_versions("1.0.0", "2.0.0")
        result = _publish(fn_id, source_version="2.0.0", target_version="3.0.0")
        assert result["version"] == "3.0.0"


# ---------------------------------------------------------------------------
# latest_in_major helper (direct)
# ---------------------------------------------------------------------------


class TestLatestInMajorHelper:
    """``_versioning.latest_in_major(versions, major)`` returns the highest version
    within one major line, or None when that line holds no versions."""

    def test_returns_highest_in_major(self) -> None:
        from wavecore.api.services.functions._versioning import latest_in_major

        versions = [{"version": "1.0.0"}, {"version": "1.0.2"}, {"version": "2.0.0"}]
        assert latest_in_major(versions, 1) == "1.0.2"
        assert latest_in_major(versions, 2) == "2.0.0"

    def test_returns_none_for_empty_line(self) -> None:
        from wavecore.api.services.functions._versioning import latest_in_major

        versions = [{"version": "1.0.0"}, {"version": "3.0.0"}]
        assert latest_in_major(versions, 2) is None

    def test_returns_none_for_no_versions(self) -> None:
        from wavecore.api.services.functions._versioning import latest_in_major

        assert latest_in_major([], 1) is None

    def test_release_outranks_prerelease_in_line(self) -> None:
        from wavecore.api.services.functions._versioning import latest_in_major

        versions = [{"version": "2.0.0-dev1"}, {"version": "2.0.0"}]
        assert latest_in_major(versions, 2) == "2.0.0"
