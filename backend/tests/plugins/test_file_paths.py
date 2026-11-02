"""
Tests for the shared plugin path resolver (REQ-3.4.3.1, REQ-3.4.3.2).

One resolver serves every WAVE-side plugin that opens a file: it maps
artifact:// from the run's artifacts directory, testdata:// through an ordered
search of the configured test-data directories, and a plain path to its absolute
form. A relative plain path starts from the base a block with a working directory
passes, and otherwise from the home folder of the user the WAVE server runs as.

A `..` segment is followed wherever it leads, in every form, and a scheme
reference is resolved on its real location. Existence is NOT checked for
artifact:// or plain paths - a write target does not exist yet, and the caller
owns the "file not found" message for a read. testdata:// is the exception: the
ordered search is defined by which candidate exists.

A write target is refused whenever its real location lies inside the Test Data
storage zone or one of the configured test data roots, whatever form the
reference took.
"""

import inspect
import re
from pathlib import Path

import pytest

from wavecore.api.services import storage_paths
from wavecore.plugins import _file_paths
from wavecore.plugins._file_paths import resolve_plugin_path

# Taken before the suite-wide fixture replaces the lookup with a temp folder.
_REAL_HOME_FOLDER = getattr(_file_paths, "home_folder", None)

_READ_ONLY_MESSAGE = (
    "testdata:// paths are read-only. Cannot write, move, or delete testdata files."
)


def _exact(message: str) -> str:
    """Anchored, regex-escaped matcher for an exact error message."""
    return f"^{re.escape(message)}$"


# =============================================================================
# artifact:// scheme
# =============================================================================


class TestArtifactScheme:
    """artifact:// resolves under the run's artifacts directory."""

    def test_resolves_under_artifacts_dir(self, tmp_path):
        result = resolve_plugin_path(
            "artifact://report.xlsx", str(tmp_path), None, read_only_ok=True
        )

        assert result == tmp_path / "report.xlsx"

    def test_returns_a_path_object(self, tmp_path):
        result = resolve_plugin_path("artifact://a.txt", str(tmp_path), None, read_only_ok=True)

        assert isinstance(result, Path)

    def test_resolves_nested_relative_path(self, tmp_path):
        result = resolve_plugin_path(
            "artifact://reports/q1/data.xlsx", str(tmp_path), None, read_only_ok=True
        )

        assert result == tmp_path / "reports" / "q1" / "data.xlsx"

    def test_does_not_require_the_file_to_exist(self, tmp_path):
        """A write target has not been created yet - resolution must not check."""
        result = resolve_plugin_path(
            "artifact://not-created-yet.xlsx", str(tmp_path), None, read_only_ok=True
        )

        assert not result.exists()
        assert result == tmp_path / "not-created-yet.xlsx"

    def test_does_not_require_the_artifacts_dir_to_exist(self, tmp_path):
        """The run creates the directory on first write; resolution precedes it."""
        absent = tmp_path / "artifacts-not-created"

        result = resolve_plugin_path("artifact://a.xlsx", str(absent), None, read_only_ok=True)

        assert result == absent / "a.xlsx"

    def test_writable_when_read_only_not_permitted(self, tmp_path):
        """artifact:// is the writable scheme - read_only_ok=False is fine."""
        result = resolve_plugin_path("artifact://out.xlsx", str(tmp_path), None, read_only_ok=False)

        assert result == tmp_path / "out.xlsx"

    def test_interior_parent_segment_that_stays_inside_is_allowed(self, tmp_path):
        result = resolve_plugin_path(
            "artifact://sub/../data.xlsx", str(tmp_path), None, read_only_ok=True
        )

        assert result == tmp_path / "data.xlsx"

    def test_missing_artifacts_dir_raises_exact_message(self):
        with pytest.raises(
            ValueError,
            match=_exact(
                "artifact:// scheme requires artifacts directory, but none configured in context"
            ),
        ):
            resolve_plugin_path("artifact://a.xlsx", None, None, read_only_ok=True)

    def test_empty_artifacts_dir_raises_exact_message(self):
        with pytest.raises(
            ValueError,
            match=_exact(
                "artifact:// scheme requires artifacts directory, but none configured in context"
            ),
        ):
            resolve_plugin_path("artifact://a.xlsx", "", None, read_only_ok=True)


# =============================================================================
# testdata:// scheme
# =============================================================================


class TestTestdataScheme:
    """testdata:// searches the configured directories in order, read-only."""

    def test_resolves_in_the_only_directory(self, tmp_path):
        (tmp_path / "fixture.csv").write_text("a,b\n")

        result = resolve_plugin_path(
            "testdata://fixture.csv", None, [str(tmp_path)], read_only_ok=True
        )

        assert result == tmp_path / "fixture.csv"

    def test_first_directory_wins(self, tmp_path):
        first = tmp_path / "first"
        second = tmp_path / "second"
        first.mkdir()
        second.mkdir()
        (first / "data.csv").write_text("first\n")
        (second / "data.csv").write_text("second\n")

        result = resolve_plugin_path(
            "testdata://data.csv", None, [str(first), str(second)], read_only_ok=True
        )

        assert result == first / "data.csv"

    def test_falls_through_to_a_later_directory(self, tmp_path):
        first = tmp_path / "first"
        second = tmp_path / "second"
        first.mkdir()
        second.mkdir()
        (second / "only-here.csv").write_text("x\n")

        result = resolve_plugin_path(
            "testdata://only-here.csv", None, [str(first), str(second)], read_only_ok=True
        )

        assert result == second / "only-here.csv"

    def test_resolves_nested_relative_path(self, tmp_path):
        nested = tmp_path / "sheets"
        nested.mkdir()
        (nested / "book.xlsx").write_bytes(b"PK")

        result = resolve_plugin_path(
            "testdata://sheets/book.xlsx", None, [str(tmp_path)], read_only_ok=True
        )

        assert result == nested / "book.xlsx"

    def test_not_found_lists_every_searched_path(self, tmp_path):
        first = tmp_path / "first"
        second = tmp_path / "second"
        first.mkdir()
        second.mkdir()
        searched = f"{first}/gone.csv, {second}/gone.csv"

        with pytest.raises(
            FileNotFoundError,
            match=_exact(
                f"testdata file not found: testdata://gone.csv\nSearched paths: {searched}"
            ),
        ):
            resolve_plugin_path(
                "testdata://gone.csv", None, [str(first), str(second)], read_only_ok=True
            )

    def test_write_target_rejected_with_exact_message(self, tmp_path):
        (tmp_path / "fixture.csv").write_text("a,b\n")

        with pytest.raises(
            ValueError,
            match=_exact(
                "testdata:// paths are read-only. " "Cannot write, move, or delete testdata files."
            ),
        ):
            resolve_plugin_path("testdata://fixture.csv", None, [str(tmp_path)], read_only_ok=False)

    def test_read_only_rule_precedes_the_directory_search(self, tmp_path):
        """A write to testdata:// is refused for being a write, not for being absent."""
        with pytest.raises(
            ValueError,
            match=_exact(
                "testdata:// paths are read-only. " "Cannot write, move, or delete testdata files."
            ),
        ):
            resolve_plugin_path("testdata://absent.csv", None, None, read_only_ok=False)

    def test_missing_testdata_dirs_raises_exact_message(self):
        with pytest.raises(
            ValueError,
            match=_exact(
                "testdata:// scheme requires test data directories, "
                "but none configured in context"
            ),
        ):
            resolve_plugin_path("testdata://a.csv", None, None, read_only_ok=True)

    def test_empty_testdata_dirs_raises_exact_message(self):
        with pytest.raises(
            ValueError,
            match=_exact(
                "testdata:// scheme requires test data directories, "
                "but none configured in context"
            ),
        ):
            resolve_plugin_path("testdata://a.csv", None, [], read_only_ok=True)


# =============================================================================
# Absolute / plain paths
# =============================================================================


class TestPlainPath:
    """A path with no scheme resolves to itself, absolute and normalized."""

    def test_absolute_path_passes_through(self, tmp_path):
        target = tmp_path / "book.xlsx"

        result = resolve_plugin_path(str(target), None, None, read_only_ok=True)

        assert result == target

    def test_absolute_path_needs_no_directories_configured(self, tmp_path):
        result = resolve_plugin_path(str(tmp_path / "x.xlsx"), None, None, read_only_ok=False)

        assert result == tmp_path / "x.xlsx"

    def test_a_relative_path_starts_from_the_server_users_home(self, server_home):
        result = resolve_plugin_path("sheets/book.xlsx", None, None, read_only_ok=True)

        assert result == server_home / "sheets" / "book.xlsx"

    def test_a_relative_path_never_starts_from_the_server_working_folder(
        self, tmp_path, monkeypatch, server_home
    ):
        elsewhere = tmp_path / "server-process"
        elsewhere.mkdir()
        monkeypatch.chdir(elsewhere)

        result = resolve_plugin_path("book.xlsx", None, None, read_only_ok=False)

        assert result == server_home / "book.xlsx"

    def test_a_relative_path_starts_from_the_base_a_block_passes(self, tmp_path, server_home):
        work = tmp_path / "work"

        result = resolve_plugin_path(
            "scripts/run.sh", None, None, read_only_ok=True, base=str(work)
        )

        assert result == work / "scripts" / "run.sh"

    def test_a_parent_segment_after_a_base_is_followed(self, tmp_path):
        result = resolve_plugin_path(
            "../beside/run.sh", None, None, read_only_ok=True, base=str(tmp_path / "work")
        )

        assert result == tmp_path / "beside" / "run.sh"

    def test_an_absolute_path_ignores_the_base(self, tmp_path):
        target = tmp_path / "abs" / "run.sh"

        result = resolve_plugin_path(
            str(target), None, None, read_only_ok=True, base=str(tmp_path / "work")
        )

        assert result == target

    def test_a_scheme_reference_ignores_the_base(self, tmp_path):
        artifacts = tmp_path / "artifacts"
        artifacts.mkdir()

        result = resolve_plugin_path(
            "artifact://run.sh", str(artifacts), None, read_only_ok=True, base=str(tmp_path)
        )

        assert result == artifacts / "run.sh"

    def test_the_home_lookup_is_the_server_users_home(self, tmp_path, monkeypatch):
        monkeypatch.setenv("HOME", str(tmp_path))

        assert _REAL_HOME_FOLDER() == tmp_path

    def test_a_plain_path_on_its_own_starts_from_the_server_users_home(self, server_home):
        assert _file_paths.plain_path("certs/ca.pem") == server_home / "certs" / "ca.pem"

    def test_a_plain_absolute_path_on_its_own_is_normalized(self, tmp_path):
        assert _file_paths.plain_path(str(tmp_path / "a" / ".." / "ca.pem")) == tmp_path / "ca.pem"

    def test_an_absolute_path_never_looks_up_the_home_folder(self, tmp_path, monkeypatch):
        def no_home() -> Path:
            raise RuntimeError("Could not determine home directory.")

        monkeypatch.setattr(_file_paths, "home_folder", no_home)

        result = resolve_plugin_path(str(tmp_path / "book.xlsx"), None, None, read_only_ok=True)

        assert result == tmp_path / "book.xlsx"

    def test_interior_parent_segments_are_normalized(self, tmp_path):
        result = resolve_plugin_path(
            str(tmp_path / "sub" / ".." / "book.xlsx"), None, None, read_only_ok=True
        )

        assert result == tmp_path / "book.xlsx"

    def test_does_not_require_the_file_to_exist(self, tmp_path):
        result = resolve_plugin_path(str(tmp_path / "absent.xlsx"), None, None, read_only_ok=True)

        assert not result.exists()


# =============================================================================
# Parent segments are followed, in every form
# =============================================================================


class TestParentSegments:
    """A `..` segment is never refused: it resolves from the scheme's folder wherever it leads."""

    def test_artifact_parent_segment_leaves_the_artifacts_dir(self, tmp_path):
        artifacts = tmp_path / "artifacts"
        artifacts.mkdir()

        result = resolve_plugin_path(
            "artifact://../outside.xlsx", str(artifacts), None, read_only_ok=True
        )

        assert result == tmp_path / "outside.xlsx"

    def test_artifact_deep_parent_segments_are_followed(self, tmp_path):
        artifacts = tmp_path / "a" / "b" / "artifacts"
        artifacts.mkdir(parents=True)

        result = resolve_plugin_path(
            "artifact://../../../elsewhere/x.txt", str(artifacts), None, read_only_ok=True
        )

        assert result == tmp_path / "elsewhere" / "x.txt"

    def test_an_artifact_that_left_the_folder_is_writable(self, tmp_path):
        artifacts = tmp_path / "artifacts"
        artifacts.mkdir()

        result = resolve_plugin_path(
            "artifact://../escaped.xlsx", str(artifacts), None, read_only_ok=False
        )

        assert result == tmp_path / "escaped.xlsx"

    def test_a_sibling_whose_name_starts_with_the_root_name_is_reached(self, tmp_path):
        artifacts = tmp_path / "artifacts"
        artifacts.mkdir()
        sibling = tmp_path / "artifacts-backup"
        sibling.mkdir()

        result = resolve_plugin_path(
            "artifact://../artifacts-backup/a.xlsx", str(artifacts), None, read_only_ok=True
        )

        assert result == sibling / "a.xlsx"

    def test_testdata_parent_segment_reads_a_file_beside_the_folder(self, tmp_path):
        outside = tmp_path / "shared.csv"
        outside.write_text("shared\n")
        testdata = tmp_path / "testdata"
        testdata.mkdir()

        result = resolve_plugin_path(
            "testdata://../shared.csv", None, [str(testdata)], read_only_ok=True
        )

        assert result == outside

    def test_testdata_parent_segment_keeps_the_ordered_search(self, tmp_path):
        first = tmp_path / "one" / "first"
        second = tmp_path / "two" / "second"
        first.mkdir(parents=True)
        second.mkdir(parents=True)
        (tmp_path / "two" / "x.csv").write_text("x\n")

        result = resolve_plugin_path(
            "testdata://../x.csv", None, [str(first), str(second)], read_only_ok=True
        )

        assert result == tmp_path / "two" / "x.csv"

    def test_testdata_parent_segment_to_nothing_is_not_found(self, tmp_path):
        testdata = tmp_path / "testdata"
        testdata.mkdir()

        with pytest.raises(
            FileNotFoundError,
            match=_exact(
                "testdata file not found: testdata://../gone.csv\n"
                f"Searched paths: {testdata}/../gone.csv"
            ),
        ):
            resolve_plugin_path("testdata://../gone.csv", None, [str(testdata)], read_only_ok=True)

    def test_a_relative_parent_segment_resolves_against_the_server_users_home(self, server_home):
        result = resolve_plugin_path("../beside/book.xlsx", None, None, read_only_ok=True)

        assert result == server_home.parent / "beside" / "book.xlsx"


# =============================================================================
# Symlinks resolve to their real location
# =============================================================================


class TestSymlinks:
    """A scheme reference is resolved on its real location, inside its folder or not."""

    def test_a_symlinked_directory_that_leaves_the_artifacts_root_resolves(self, tmp_path):
        outside = tmp_path / "outside"
        outside.mkdir()
        (outside / "secret.xlsx").write_bytes(b"PK")
        artifacts = tmp_path / "artifacts"
        artifacts.mkdir()
        (artifacts / "link").symlink_to(outside)

        result = resolve_plugin_path(
            "artifact://link/secret.xlsx", str(artifacts), None, read_only_ok=True
        )

        assert result == (outside / "secret.xlsx").resolve()

    def test_a_symlink_that_stays_inside_the_artifacts_root_resolves(self, tmp_path):
        artifacts = tmp_path / "artifacts"
        inner = artifacts / "reports"
        inner.mkdir(parents=True)
        (inner / "q1.xlsx").write_bytes(b"PK")
        (artifacts / "latest").symlink_to(inner)

        result = resolve_plugin_path(
            "artifact://latest/q1.xlsx", str(artifacts), None, read_only_ok=True
        )

        assert result.resolve() == (inner / "q1.xlsx").resolve()

    def test_a_symlinked_artifacts_root_resolves_through_the_link(self, tmp_path):
        real = tmp_path / "real-artifacts"
        real.mkdir()
        link = tmp_path / "artifacts"
        link.symlink_to(real)

        result = resolve_plugin_path("artifact://a.xlsx", str(link), None, read_only_ok=True)

        assert result.resolve() == (real / "a.xlsx").resolve()

    def test_a_symlinked_directory_that_leaves_a_testdata_root_resolves(self, tmp_path):
        outside = tmp_path / "outside"
        outside.mkdir()
        (outside / "secret.csv").write_text("secret\n")
        testdata = tmp_path / "testdata"
        testdata.mkdir()
        (testdata / "link").symlink_to(outside)

        result = resolve_plugin_path(
            "testdata://link/secret.csv", None, [str(testdata)], read_only_ok=True
        )

        assert result == (outside / "secret.csv").resolve()

    def test_a_symlinked_testdata_root_resolves_through_the_link(self, tmp_path):
        real = tmp_path / "real-testdata"
        real.mkdir()
        (real / "fixture.csv").write_text("a,b\n")
        link = tmp_path / "testdata"
        link.symlink_to(real)

        result = resolve_plugin_path("testdata://fixture.csv", None, [str(link)], read_only_ok=True)

        assert result.resolve() == (real / "fixture.csv").resolve()


# =============================================================================
# A bare scheme names its folder
# =============================================================================


class TestSchemeRoot:
    """artifact:// and testdata:// with nothing after them resolve to the folder itself."""

    def test_the_resolver_takes_no_root_switch(self):
        assert "allow_root" not in inspect.signature(resolve_plugin_path).parameters

    def test_the_artifact_root_resolves_to_the_artifacts_dir(self, tmp_path):
        result = resolve_plugin_path("artifact://", str(tmp_path), None, read_only_ok=True)

        assert result == tmp_path.resolve()

    def test_the_testdata_root_resolves_to_the_testdata_dir(self, tmp_path):
        result = resolve_plugin_path("testdata://", None, [str(tmp_path)], read_only_ok=True)

        assert result == tmp_path.resolve()

    def test_the_testdata_root_search_skips_a_directory_that_does_not_exist(self, tmp_path):
        first = tmp_path / "first"
        second = tmp_path / "second"
        second.mkdir()

        result = resolve_plugin_path(
            "testdata://", None, [str(first), str(second)], read_only_ok=True
        )

        assert result == second.resolve()

    @pytest.mark.parametrize("reference", ["artifact:///", "artifact://./", "artifact://sub/.."])
    def test_slashes_and_dot_segments_alone_name_the_artifacts_dir(self, tmp_path, reference):
        result = resolve_plugin_path(reference, str(tmp_path), None, read_only_ok=True)

        assert result == tmp_path.resolve()

    @pytest.mark.parametrize("reference", ["artifact:///report.txt", "artifact:////report.txt"])
    def test_slashes_after_the_artifact_scheme_stay_in_the_folder(self, tmp_path, reference):
        result = resolve_plugin_path(reference, str(tmp_path), None, read_only_ok=True)

        assert result == tmp_path.resolve() / "report.txt"

    def test_slashes_after_the_testdata_scheme_stay_in_the_folder(self, tmp_path):
        folder = tmp_path / "testdata"
        folder.mkdir()
        (folder / "input.csv").write_text("a,b\n", encoding="utf-8")
        (tmp_path / "outside.csv").write_text("x", encoding="utf-8")

        inside = resolve_plugin_path(
            "testdata:///input.csv", None, [str(folder)], read_only_ok=True
        )

        assert inside == folder.resolve() / "input.csv"
        with pytest.raises(FileNotFoundError):
            resolve_plugin_path(
                f"testdata://{tmp_path / 'outside.csv'}", None, [str(folder)], read_only_ok=True
            )


# =============================================================================
# Removal flavor: the run's artifacts folder itself is never deleted or moved
# =============================================================================

_ARTIFACTS_FOLDER_MESSAGE = (
    "artifact:// is the run's artifacts folder and cannot be deleted or moved"
)


class TestRemovalFlavorRefusesTheArtifactsFolder:
    """An artifact:// reference naming the artifacts folder itself is refused for removal."""

    @pytest.mark.parametrize(
        "reference",
        ["artifact://", "artifact:///", "artifact://.", "artifact://./", "artifact://sub/.."],
    )
    def test_the_folder_itself_is_refused(self, tmp_path, reference):
        with pytest.raises(ValueError, match=_exact(_ARTIFACTS_FOLDER_MESSAGE)):
            resolve_plugin_path(reference, str(tmp_path), None, read_only_ok=False, removes=True)

    def test_a_symlink_to_the_folder_itself_is_refused(self, tmp_path):
        artifacts = tmp_path / "artifacts"
        artifacts.mkdir()
        (artifacts / "self").symlink_to(artifacts)

        with pytest.raises(ValueError, match=_exact(_ARTIFACTS_FOLDER_MESSAGE)):
            resolve_plugin_path(
                "artifact://self", str(artifacts), None, read_only_ok=False, removes=True
            )

    def test_an_artifacts_dir_given_through_a_symlink_is_refused(self, tmp_path):
        real = tmp_path / "real"
        real.mkdir()
        link = tmp_path / "link"
        link.symlink_to(real)

        with pytest.raises(ValueError, match=_exact(_ARTIFACTS_FOLDER_MESSAGE)):
            resolve_plugin_path("artifact://", str(link), None, read_only_ok=False, removes=True)

    @pytest.mark.parametrize(
        ("reference", "expected"),
        [("artifact://sub", "sub"), ("artifact://sub/../keep.txt", "keep.txt")],
    )
    def test_a_path_inside_the_folder_resolves(self, tmp_path, reference, expected):
        result = resolve_plugin_path(
            reference, str(tmp_path), None, read_only_ok=False, removes=True
        )

        assert result == tmp_path.resolve() / expected

    def test_a_parent_segment_out_of_the_folder_resolves(self, tmp_path):
        artifacts = tmp_path / "artifacts"
        artifacts.mkdir()

        result = resolve_plugin_path(
            "artifact://..", str(artifacts), None, read_only_ok=False, removes=True
        )

        assert result == tmp_path.resolve()

    @pytest.mark.parametrize("read_only_ok", [True, False])
    def test_without_removal_the_folder_resolves(self, tmp_path, read_only_ok):
        result = resolve_plugin_path("artifact://", str(tmp_path), None, read_only_ok=read_only_ok)

        assert result == tmp_path.resolve()

    def test_removal_is_off_unless_asked_for(self):
        parameter = inspect.signature(resolve_plugin_path).parameters["removes"]

        assert parameter.default is False
        assert parameter.kind is inspect.Parameter.KEYWORD_ONLY

    def test_a_bare_testdata_root_keeps_the_read_only_refusal(self, tmp_path):
        with pytest.raises(ValueError, match=_exact(_READ_ONLY_MESSAGE)):
            resolve_plugin_path(
                "testdata://", None, [str(tmp_path)], read_only_ok=False, removes=True
            )


# =============================================================================
# Write flavor: nothing inside the Test Data area may be written
# =============================================================================


def _zone_folder(test_id: str) -> Path:
    folder = storage_paths.get_test_testdata_path(test_id)
    folder.mkdir(parents=True, exist_ok=True)
    return folder


class TestWriteFlavorRefusesTheTestDataZone:
    """A write target anywhere in the Test Data storage zone is refused, any test's folder."""

    def test_another_tests_folder_is_refused_by_absolute_path(self):
        running = _zone_folder("running-test")
        other = _zone_folder("other-test")

        with pytest.raises(ValueError, match=_exact(_READ_ONLY_MESSAGE)):
            resolve_plugin_path(str(other / "out.csv"), None, [str(running)], read_only_ok=False)

    def test_the_running_tests_folder_is_still_refused_by_absolute_path(self):
        running = _zone_folder("running-test")

        with pytest.raises(ValueError, match=_exact(_READ_ONLY_MESSAGE)):
            resolve_plugin_path(str(running / "out.csv"), None, [str(running)], read_only_ok=False)

    def test_another_tests_folder_is_refused_with_no_roots_configured(self):
        other = _zone_folder("other-test")

        with pytest.raises(ValueError, match=_exact(_READ_ONLY_MESSAGE)):
            resolve_plugin_path(str(other / "nested" / "out.csv"), None, None, read_only_ok=False)

    def test_a_target_at_the_top_of_the_zone_is_refused(self):
        zone = storage_paths.get_testdata_storage_path()
        zone.mkdir(parents=True, exist_ok=True)

        with pytest.raises(ValueError, match=_exact(_READ_ONLY_MESSAGE)):
            resolve_plugin_path(str(zone / "new-folder"), None, None, read_only_ok=False)

    def test_an_artifact_reference_that_climbs_into_another_tests_folder_is_refused(self, tmp_path):
        other = _zone_folder("other-test")
        artifacts = tmp_path / "artifacts"
        artifacts.mkdir()
        climb = "../" * len(artifacts.resolve().parts[1:])

        with pytest.raises(ValueError, match=_exact(_READ_ONLY_MESSAGE)):
            resolve_plugin_path(
                f"artifact://{climb}{str(other.resolve()).lstrip('/')}/out.csv",
                str(artifacts),
                None,
                read_only_ok=False,
            )

    def test_a_testdata_reference_that_climbs_to_another_tests_folder_is_refused(self):
        running = _zone_folder("running-test")
        _zone_folder("other-test")

        with pytest.raises(ValueError, match=_exact(_READ_ONLY_MESSAGE)):
            resolve_plugin_path(
                "testdata://../other-test/out.csv", None, [str(running)], read_only_ok=False
            )

    def test_a_sibling_whose_name_starts_with_the_zone_name_is_writable(self):
        zone = storage_paths.get_testdata_storage_path()
        sibling = zone.parent / f"{zone.name}-backup"
        sibling.mkdir(parents=True, exist_ok=True)

        result = resolve_plugin_path(str(sibling / "out.csv"), None, None, read_only_ok=False)

        assert result == sibling / "out.csv"

    def test_the_read_flavor_reads_another_tests_folder(self):
        running = _zone_folder("running-test")
        other = _zone_folder("other-test")
        (other / "shared.csv").write_text("a,b\n")

        result = resolve_plugin_path(
            "testdata://../other-test/shared.csv", None, [str(running)], read_only_ok=True
        )

        assert result == (other / "shared.csv").resolve()


class TestWriteFlavorTestdataContainment:
    """A write target is refused for LANDING in a configured test data root, whatever form."""

    def test_an_absolute_path_inside_a_testdata_root_is_refused(self, tmp_path):
        testdata = tmp_path / "testdata"
        testdata.mkdir()

        with pytest.raises(ValueError, match=_exact(_READ_ONLY_MESSAGE)):
            resolve_plugin_path(
                str(testdata / "out.csv"), None, [str(testdata)], read_only_ok=False
            )

    def test_a_nested_absolute_path_inside_a_testdata_root_is_refused(self, tmp_path):
        testdata = tmp_path / "testdata"
        (testdata / "sheets").mkdir(parents=True)

        with pytest.raises(ValueError, match=_exact(_READ_ONLY_MESSAGE)):
            resolve_plugin_path(
                str(testdata / "sheets" / "out.xlsx"), None, [str(testdata)], read_only_ok=False
            )

    def test_the_testdata_root_itself_is_refused_as_a_write_target(self, tmp_path):
        testdata = tmp_path / "testdata"
        testdata.mkdir()

        with pytest.raises(ValueError, match=_exact(_READ_ONLY_MESSAGE)):
            resolve_plugin_path(str(testdata), None, [str(testdata)], read_only_ok=False)

    def test_a_later_testdata_root_is_checked_too(self, tmp_path):
        first = tmp_path / "first"
        second = tmp_path / "second"
        first.mkdir()
        second.mkdir()

        with pytest.raises(ValueError, match=_exact(_READ_ONLY_MESSAGE)):
            resolve_plugin_path(
                str(second / "out.csv"), None, [str(first), str(second)], read_only_ok=False
            )

    def test_a_relative_path_that_lands_in_a_testdata_root_is_refused(self, server_home):
        testdata = server_home / "testdata"
        testdata.mkdir()

        with pytest.raises(ValueError, match=_exact(_READ_ONLY_MESSAGE)):
            resolve_plugin_path("testdata/out.csv", None, [str(testdata)], read_only_ok=False)

    def test_a_symlink_whose_real_location_is_in_a_testdata_root_is_refused(self, tmp_path):
        testdata = tmp_path / "testdata"
        testdata.mkdir()
        (testdata / "fixture.csv").write_text("a,b\n")
        elsewhere = tmp_path / "elsewhere"
        elsewhere.mkdir()
        (elsewhere / "link.csv").symlink_to(testdata / "fixture.csv")

        with pytest.raises(ValueError, match=_exact(_READ_ONLY_MESSAGE)):
            resolve_plugin_path(
                str(elsewhere / "link.csv"), None, [str(testdata)], read_only_ok=False
            )

    def test_an_artifact_target_that_lands_in_a_testdata_root_is_refused(self, tmp_path):
        testdata = tmp_path / "testdata"
        artifacts = testdata / "artifacts"
        artifacts.mkdir(parents=True)

        with pytest.raises(ValueError, match=_exact(_READ_ONLY_MESSAGE)):
            resolve_plugin_path(
                "artifact://out.xlsx", str(artifacts), [str(testdata)], read_only_ok=False
            )

    def test_a_sibling_whose_name_starts_with_the_testdata_root_name_is_writable(self, tmp_path):
        testdata = tmp_path / "testdata"
        testdata.mkdir()
        sibling = tmp_path / "testdata-backup"
        sibling.mkdir()

        result = resolve_plugin_path(
            str(sibling / "out.csv"), None, [str(testdata)], read_only_ok=False
        )

        assert result.resolve() == (sibling / "out.csv").resolve()

    def test_a_path_outside_every_testdata_root_is_writable(self, tmp_path):
        testdata = tmp_path / "testdata"
        testdata.mkdir()
        elsewhere = tmp_path / "elsewhere"
        elsewhere.mkdir()

        result = resolve_plugin_path(
            str(elsewhere / "out.csv"), None, [str(testdata)], read_only_ok=False
        )

        assert result.resolve() == (elsewhere / "out.csv").resolve()

    def test_no_testdata_roots_configured_leaves_a_write_alone(self, tmp_path):
        result = resolve_plugin_path(str(tmp_path / "out.csv"), None, None, read_only_ok=False)

        assert result.resolve() == (tmp_path / "out.csv").resolve()

    def test_the_read_flavor_still_reads_from_inside_a_testdata_root(self, tmp_path):
        testdata = tmp_path / "testdata"
        testdata.mkdir()
        (testdata / "fixture.csv").write_text("a,b\n")

        result = resolve_plugin_path(
            str(testdata / "fixture.csv"), None, [str(testdata)], read_only_ok=True
        )

        assert result.resolve() == (testdata / "fixture.csv").resolve()

    def test_the_read_flavor_reads_an_artifact_that_lands_in_a_testdata_root(self, tmp_path):
        testdata = tmp_path / "testdata"
        artifacts = testdata / "artifacts"
        artifacts.mkdir(parents=True)
        (artifacts / "in.xlsx").write_bytes(b"PK")

        result = resolve_plugin_path(
            "artifact://in.xlsx", str(artifacts), [str(testdata)], read_only_ok=True
        )

        assert result.resolve() == (artifacts / "in.xlsx").resolve()


# =============================================================================
# Wildcards: one sftp dialect for both sides of a transfer (REQ-3.4.1.8, SFTP-3)
# =============================================================================

_NO_TESTDATA_MESSAGE = (
    "testdata:// scheme requires test data directories, but none configured in context"
)
_NO_ARTIFACTS_MESSAGE = (
    "artifact:// scheme requires artifacts directory, but none configured in context"
)


def _touch(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("x\n")
    return path


class TestHasWildcard:
    """A reference holds a wildcard when it holds *, ? or [."""

    @pytest.mark.parametrize(
        "text",
        [
            "*",
            "*.csv",
            "report-?.csv",
            "[abc].csv",
            "a[b",
            "in/*/data.csv",
            "testdata://*.csv",
            "artifact://logs/run-[0-9].log",
        ],
    )
    def test_a_star_a_question_mark_or_an_open_bracket_is_a_wildcard(self, text):
        assert _file_paths.has_wildcard(text) is True

    @pytest.mark.parametrize(
        "text",
        [
            "",
            "report.csv",
            "in/data.csv",
            "testdata://in/data.csv",
            "a]b",
            "{a,b}.csv",
            "!a",
            "~/x",
        ],
    )
    def test_anything_else_is_plain_text(self, text):
        assert _file_paths.has_wildcard(text) is False


class TestNameMatches:
    """fnmatchcase over one name, where a name starting with a dot needs a pattern that does."""

    @pytest.mark.parametrize(
        ("name", "pattern"),
        [
            ("report.csv", "report.csv"),
            ("report.csv", "*.csv"),
            ("report.csv", "*"),
            ("a1.txt", "a?.txt"),
            ("b.txt", "[abc].txt"),
            ("file7.csv", "file[0-9].csv"),
            ("b.txt", "[!a].txt"),
            ("a.hidden", "*hidden"),
            ("report.csv", "**.csv"),
            ("report.csv", "**"),
            ("a]b", "a]b"),
            ("a[b", "a[b"),
        ],
    )
    def test_a_name_the_pattern_describes_matches(self, name, pattern):
        assert _file_paths.name_matches(name, pattern) is True

    @pytest.mark.parametrize(
        ("name", "pattern"),
        [
            ("report.csv", "summary.csv"),
            ("report.csv.bak", "*.csv"),
            ("a12.txt", "a?.txt"),
            ("a.txt", "a?.txt"),
            ("d.txt", "[abc].txt"),
            ("a.txt", "[!a].txt"),
        ],
    )
    def test_a_name_the_pattern_does_not_describe_does_not_match(self, name, pattern):
        assert _file_paths.name_matches(name, pattern) is False

    @pytest.mark.parametrize(
        ("name", "pattern"),
        [("Report.CSV", "*.csv"), ("report.csv", "*.CSV"), ("Report.csv", "report.csv")],
    )
    def test_the_match_is_case_sensitive(self, name, pattern):
        assert _file_paths.name_matches(name, pattern) is False

    @pytest.mark.parametrize(
        "pattern", ["*", "**", "?hidden", "*hidden", "[.]hidden", "[!a]hidden"]
    )
    def test_a_dot_name_is_not_matched_by_a_pattern_without_a_leading_dot(self, pattern):
        assert _file_paths.name_matches(".hidden", pattern) is False

    @pytest.mark.parametrize("pattern", [".*", ".hidden", ".h?dden", ".[gh]idden"])
    def test_a_dot_name_is_matched_by_a_pattern_with_a_leading_dot(self, pattern):
        assert _file_paths.name_matches(".hidden", pattern) is True

    @pytest.mark.parametrize(
        ("name", "pattern"),
        [("a*b", "a[*]b"), ("a?b", "a[?]b"), ("a[b", "a[[]b")],
    )
    def test_a_bracketed_wildcard_character_stands_for_itself(self, name, pattern):
        assert _file_paths.name_matches(name, pattern) is True

    @pytest.mark.parametrize(
        ("name", "pattern"),
        [("axb", "a[*]b"), ("axb", "a[?]b"), ("ab", "a[[]b")],
    )
    def test_a_bracketed_wildcard_character_matches_nothing_else(self, name, pattern):
        assert _file_paths.name_matches(name, pattern) is False


class TestResolvePluginMatchesPlainPaths:
    """Every existing WAVE path an absolute or relative wildcard reference names, sorted."""

    def test_a_last_segment_wildcard_names_each_match_in_the_folder(self, tmp_path):
        root = tmp_path.resolve()
        for name in ("b.csv", "a.csv", "c.txt"):
            _touch(root / "in" / name)

        result = _file_paths.resolve_plugin_matches(str(root / "in" / "*.csv"), None, None)

        assert result == [root / "in" / "a.csv", root / "in" / "b.csv"]

    def test_the_result_is_a_list_of_path_objects(self, tmp_path):
        root = tmp_path.resolve()
        _touch(root / "in" / "a.csv")

        result = _file_paths.resolve_plugin_matches(str(root / "in" / "*.csv"), None, None)

        assert isinstance(result, list)
        assert all(isinstance(match, Path) for match in result)

    def test_the_matches_come_back_sorted(self, tmp_path):
        root = tmp_path.resolve()
        for name in ("m.csv", "z.csv", "a.csv", "k.csv"):
            _touch(root / "in" / name)

        result = _file_paths.resolve_plugin_matches(str(root / "in" / "*.csv"), None, None)

        assert result == [root / "in" / name for name in ("a.csv", "k.csv", "m.csv", "z.csv")]

    def test_a_last_segment_wildcard_names_folders_as_well_as_files(self, tmp_path):
        root = tmp_path.resolve()
        _touch(root / "in" / "a.csv")
        (root / "in" / "archive").mkdir()

        result = _file_paths.resolve_plugin_matches(str(root / "in" / "*"), None, None)

        assert result == [root / "in" / "a.csv", root / "in" / "archive"]

    def test_a_middle_segment_wildcard_continues_only_through_folders(self, tmp_path):
        root = tmp_path.resolve()
        _touch(root / "data" / "jan" / "report.csv")
        _touch(root / "data" / "feb" / "report.csv")
        (root / "data" / "mar").mkdir()
        _touch(root / "data" / "apr")

        result = _file_paths.resolve_plugin_matches(
            str(root / "data" / "*" / "report.csv"), None, None
        )

        assert result == [
            root / "data" / "feb" / "report.csv",
            root / "data" / "jan" / "report.csv",
        ]

    def test_a_wildcard_in_several_segments(self, tmp_path):
        root = tmp_path.resolve()
        _touch(root / "data" / "jan" / "a.csv")
        _touch(root / "data" / "jan" / "b.txt")
        _touch(root / "data" / "feb" / "c.csv")

        result = _file_paths.resolve_plugin_matches(str(root / "data" / "*" / "*.csv"), None, None)

        assert result == [root / "data" / "feb" / "c.csv", root / "data" / "jan" / "a.csv"]

    def test_the_match_is_case_sensitive(self, tmp_path):
        root = tmp_path.resolve()
        _touch(root / "in" / "a.csv")
        _touch(root / "in" / "B.CSV")

        result = _file_paths.resolve_plugin_matches(str(root / "in" / "*.csv"), None, None)

        assert result == [root / "in" / "a.csv"]

    def test_a_star_skips_names_that_start_with_a_dot(self, tmp_path):
        root = tmp_path.resolve()
        _touch(root / "in" / "a.csv")
        _touch(root / "in" / ".partial.csv")

        result = _file_paths.resolve_plugin_matches(str(root / "in" / "*.csv"), None, None)

        assert result == [root / "in" / "a.csv"]

    def test_a_pattern_with_a_leading_dot_names_the_dot_entries(self, tmp_path):
        root = tmp_path.resolve()
        _touch(root / "in" / "a.csv")
        _touch(root / "in" / ".env")
        (root / "in" / ".cache").mkdir()

        result = _file_paths.resolve_plugin_matches(str(root / "in" / ".*"), None, None)

        assert result == [root / "in" / ".cache", root / "in" / ".env"]

    def test_a_middle_wildcard_does_not_enter_a_dot_folder(self, tmp_path):
        root = tmp_path.resolve()
        _touch(root / "repo" / "src" / "x.py")
        _touch(root / "repo" / ".git" / "x.py")

        result = _file_paths.resolve_plugin_matches(str(root / "repo" / "*" / "x.py"), None, None)

        assert result == [root / "repo" / "src" / "x.py"]

    def test_a_double_star_segment_matches_one_folder_level_only(self, tmp_path):
        root = tmp_path.resolve()
        _touch(root / "logs" / "a" / "run.log")
        _touch(root / "logs" / "a" / "b" / "run.log")

        result = _file_paths.resolve_plugin_matches(
            str(root / "logs" / "**" / "run.log"), None, None
        )

        assert result == [root / "logs" / "a" / "run.log"]

    def test_a_double_star_in_a_name_does_not_reach_into_subfolders(self, tmp_path):
        root = tmp_path.resolve()
        _touch(root / "logs" / "top.log")
        _touch(root / "logs" / "a" / "deep.log")

        result = _file_paths.resolve_plugin_matches(str(root / "logs" / "**.log"), None, None)

        assert result == [root / "logs" / "top.log"]

    def test_a_bracketed_star_names_the_file_holding_a_star(self, tmp_path):
        root = tmp_path.resolve()
        _touch(root / "in" / "a*b.csv")
        _touch(root / "in" / "axb.csv")

        result = _file_paths.resolve_plugin_matches(str(root / "in" / "a[*]b.csv"), None, None)

        assert result == [root / "in" / "a*b.csv"]

    def test_no_match_gives_an_empty_list(self, tmp_path):
        root = tmp_path.resolve()
        _touch(root / "in" / "a.txt")

        assert _file_paths.resolve_plugin_matches(str(root / "in" / "*.csv"), None, None) == []

    def test_a_fixed_part_that_does_not_exist_gives_an_empty_list(self, tmp_path):
        root = tmp_path.resolve()

        assert _file_paths.resolve_plugin_matches(str(root / "gone" / "*.csv"), None, None) == []

    def test_a_fixed_part_that_is_a_file_gives_an_empty_list(self, tmp_path):
        root = tmp_path.resolve()
        _touch(root / "in.csv")

        assert _file_paths.resolve_plugin_matches(str(root / "in.csv" / "*"), None, None) == []

    def test_a_relative_reference_starts_from_the_server_users_home(self, server_home):
        _touch(server_home / "inbox" / "a.csv")
        _touch(server_home / "inbox" / "b.txt")

        result = _file_paths.resolve_plugin_matches("inbox/*.csv", None, None)

        assert result == [server_home / "inbox" / "a.csv"]

    def test_a_relative_wildcard_first_segment_matches_in_the_home_folder(self, server_home):
        _touch(server_home / "a.csv")
        _touch(server_home / "sub" / "b.csv")

        result = _file_paths.resolve_plugin_matches("*.csv", None, None)

        assert result == [server_home / "a.csv"]


class TestResolvePluginMatchesSymlinks:
    """Symbolic links are not followed from one wildcard segment into the next."""

    def test_a_linked_folder_is_not_followed_past_a_wildcard_segment(self, tmp_path):
        root = tmp_path.resolve()
        _touch(root / "data" / "real" / "x.csv")
        (root / "data" / "link").symlink_to(root / "data" / "real")

        result = _file_paths.resolve_plugin_matches(str(root / "data" / "*" / "x.csv"), None, None)

        assert result == [root / "data" / "real" / "x.csv"]

    def test_a_linked_file_in_the_last_segment_is_named_by_its_own_name(self, tmp_path):
        root = tmp_path.resolve()
        target = _touch(root / "in" / "a.csv")
        (root / "in" / "b.csv").symlink_to(target)

        result = _file_paths.resolve_plugin_matches(str(root / "in" / "*.csv"), None, None)

        assert result == [root / "in" / "a.csv", root / "in" / "b.csv"]

    def test_a_linked_folder_in_the_fixed_part_is_followed(self, tmp_path):
        root = tmp_path.resolve()
        _touch(root / "real" / "x.csv")
        (root / "link").symlink_to(root / "real")

        result = _file_paths.resolve_plugin_matches(str(root / "link" / "*.csv"), None, None)

        assert [match.resolve() for match in result] == [root / "real" / "x.csv"]


class TestResolvePluginMatchesSchemes:
    """testdata:// keeps its ordered search and artifact:// its folder; a bare scheme names it."""

    def test_testdata_matches_in_the_folder_that_holds_the_fixed_part(self, tmp_path):
        root = tmp_path.resolve()
        first = root / "first"
        first.mkdir()
        second = root / "second"
        _touch(second / "sheets" / "a.csv")
        _touch(second / "sheets" / "b.csv")
        _touch(second / "sheets" / "c.txt")

        result = _file_paths.resolve_plugin_matches(
            "testdata://sheets/*.csv", None, [str(first), str(second)]
        )

        assert result == [second / "sheets" / "a.csv", second / "sheets" / "b.csv"]

    def test_the_first_testdata_folder_holding_the_fixed_part_wins(self, tmp_path):
        root = tmp_path.resolve()
        first = root / "first"
        second = root / "second"
        _touch(first / "sheets" / "a.csv")
        _touch(second / "sheets" / "b.csv")

        result = _file_paths.resolve_plugin_matches(
            "testdata://sheets/*.csv", None, [str(first), str(second)]
        )

        assert result == [first / "sheets" / "a.csv"]

    def test_a_bare_testdata_scheme_matches_in_the_first_folder_that_exists(self, tmp_path):
        root = tmp_path.resolve()
        first = root / "first"
        second = root / "second"
        _touch(second / "a.csv")
        _touch(second / "b.txt")

        result = _file_paths.resolve_plugin_matches(
            "testdata://*.csv", None, [str(first), str(second)]
        )

        assert result == [second / "a.csv"]

    def test_a_testdata_middle_wildcard_matches_inside_the_folder(self, tmp_path):
        root = tmp_path.resolve()
        testdata = root / "testdata"
        _touch(testdata / "orders" / "in.csv")
        _touch(testdata / "refunds" / "in.csv")

        result = _file_paths.resolve_plugin_matches("testdata://*/in.csv", None, [str(testdata)])

        assert result == [testdata / "orders" / "in.csv", testdata / "refunds" / "in.csv"]

    def test_a_testdata_fixed_part_found_in_no_folder_gives_an_empty_list(self, tmp_path):
        root = tmp_path.resolve()
        first = root / "first"
        second = root / "second"
        first.mkdir()
        second.mkdir()

        result = _file_paths.resolve_plugin_matches(
            "testdata://sheets/*.csv", None, [str(first), str(second)]
        )

        assert result == []

    def test_artifact_matches_under_the_artifacts_folder(self, tmp_path):
        artifacts = tmp_path.resolve() / "artifacts"
        _touch(artifacts / "b.log")
        _touch(artifacts / "a.log")
        _touch(artifacts / "c.txt")

        result = _file_paths.resolve_plugin_matches("artifact://*.log", str(artifacts), None)

        assert result == [artifacts / "a.log", artifacts / "b.log"]

    def test_an_artifact_fixed_part_below_the_folder_is_searched(self, tmp_path):
        artifacts = tmp_path.resolve() / "artifacts"
        _touch(artifacts / "reports" / "q1.csv")
        _touch(artifacts / "q2.csv")

        result = _file_paths.resolve_plugin_matches(
            "artifact://reports/*.csv", str(artifacts), None
        )

        assert result == [artifacts / "reports" / "q1.csv"]

    def test_an_artifact_fixed_part_that_does_not_exist_gives_an_empty_list(self, tmp_path):
        artifacts = tmp_path.resolve() / "artifacts"
        artifacts.mkdir()

        result = _file_paths.resolve_plugin_matches(
            "artifact://reports/*.csv", str(artifacts), None
        )

        assert result == []

    def test_an_artifacts_folder_not_created_yet_gives_an_empty_list(self, tmp_path):
        absent = tmp_path.resolve() / "artifacts-not-created"

        assert _file_paths.resolve_plugin_matches("artifact://*.csv", str(absent), None) == []

    @pytest.mark.parametrize("testdata_dirs", [None, []])
    def test_testdata_with_no_test_data_folders_raises_the_resolvers_error(self, testdata_dirs):
        with pytest.raises(ValueError, match=_exact(_NO_TESTDATA_MESSAGE)):
            _file_paths.resolve_plugin_matches("testdata://*.csv", None, testdata_dirs)

    @pytest.mark.parametrize("artifacts_dir", [None, ""])
    def test_artifact_with_no_artifacts_folder_raises_the_resolvers_error(self, artifacts_dir):
        with pytest.raises(ValueError, match=_exact(_NO_ARTIFACTS_MESSAGE)):
            _file_paths.resolve_plugin_matches("artifact://*.log", artifacts_dir, None)
