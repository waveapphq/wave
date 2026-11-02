"""Tests for the profile cache staying true to the profiles storage directory.

The YAML files under the profiles storage directory are the record. The
in-memory cache is an accessory that must reflect them, including when files are
added or removed by something other than the product (a checkout, a restored
backup, a manual delete).
"""

import builtins
import logging
import shutil
from pathlib import Path
from typing import Any

import pytest
import yaml

from wavecore.api.services import entity_cache
from wavecore.api.services.profiles import _common as profile_common
from wavecore.api.services.profiles import import_export
from wavecore.api.services.profiles import service as profile_service
from wavecore.api.services.storage_paths import get_profiles_storage_path
from wavecore.api.services.tests import service as test_service

_LOGGER_NAME = "wavecore.api.services.profiles._common"


def _profile_dir(profile_id: str) -> Path:
    return get_profiles_storage_path() / profile_id


def _profile_file(profile_id: str) -> Path:
    return _profile_dir(profile_id) / "profile.yaml"


def _remove_profile_yaml(profile_id: str) -> None:
    """Delete a profile's YAML behind the product's back, keeping the directory."""
    _profile_file(profile_id).unlink()


def _remove_profile_dir(profile_id: str) -> None:
    """Delete a profile's whole directory behind the product's back."""
    shutil.rmtree(_profile_dir(profile_id))


def _profile_document(profile_id: str, name: str) -> dict[str, Any]:
    return {
        "id": profile_id,
        "name": name,
        "type": "custom",
        "config": {},
        "environment_values": {},
        "tags": [],
        "created_at": "2026-08-23T00:00:00+00:00",
        "updated_at": "2026-08-23T00:00:00+00:00",
    }


def _write_raw_yaml(profile_id: str, contents: str) -> Path:
    directory = _profile_dir(profile_id)
    directory.mkdir(parents=True, exist_ok=True)
    profile_file = directory / "profile.yaml"
    profile_file.write_text(contents)
    return profile_file


def _write_raw_bytes(profile_id: str, contents: bytes) -> Path:
    directory = _profile_dir(profile_id)
    directory.mkdir(parents=True, exist_ok=True)
    profile_file = directory / "profile.yaml"
    profile_file.write_bytes(contents)
    return profile_file


def _write_profile_yaml(profile_id: str, name: str) -> None:
    """Write a well-formed profile file behind the product's back."""
    _write_raw_yaml(profile_id, yaml.safe_dump(_profile_document(profile_id, name)))


def _delete_on_open(monkeypatch: pytest.MonkeyPatch, target: Path) -> None:
    """Delete one file the instant it is opened, reproducing the delete race."""
    real_open = builtins.open

    def racing_open(file: Any, *args: Any, **kwargs: Any) -> Any:
        if Path(str(file)) == target:
            target.unlink(missing_ok=True)
        return real_open(file, *args, **kwargs)

    monkeypatch.setattr(builtins, "open", racing_open)


def _record_opens(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Every profile.yaml opened from here on, so a re-parse cannot hide."""
    opened: list[str] = []
    real_open = builtins.open

    def watching_open(file: Any, *args: Any, **kwargs: Any) -> Any:
        if Path(str(file)).name == "profile.yaml":
            opened.append(str(file))
        return real_open(file, *args, **kwargs)

    monkeypatch.setattr(builtins, "open", watching_open)
    return opened


def _names(result: dict[str, Any]) -> list[str]:
    return sorted(row["name"] for row in result["profiles"])


def _warnings(caplog: pytest.LogCaptureFixture) -> list[str]:
    return [
        record.getMessage()
        for record in caplog.records
        if record.levelno >= logging.WARNING and record.name == _LOGGER_NAME
    ]


class TestListReflectsTheDirectory:
    """The Profiles list must not advertise what the directory no longer holds."""

    def setup_method(self) -> None:
        profile_common._clear_storage()

    def test_list_omits_profile_whose_directory_was_removed(self) -> None:
        created = profile_service.create_profile("Phantom", "custom")

        _remove_profile_dir(created["id"])

        result = profile_service.list_profiles()
        assert result["profiles"] == []
        assert result["total"] == 0

    def test_list_omits_profile_whose_file_was_removed(self) -> None:
        profile_service.create_profile("Kept", "custom")
        gone = profile_service.create_profile("Gone", "custom")

        _remove_profile_yaml(gone["id"])

        result = profile_service.list_profiles()
        assert _names(result) == ["Kept"]
        assert result["total"] == 1

    def test_list_includes_profile_that_appeared_underneath(self) -> None:
        profile_service.create_profile("Existing", "custom")

        _write_profile_yaml("11111111-1111-4111-8111-111111111111", "Checked Out")

        result = profile_service.list_profiles()
        assert _names(result) == ["Checked Out", "Existing"]
        assert result["total"] == 2

    def test_list_ignores_entries_that_are_not_profile_directories(self) -> None:
        profile_service.create_profile("Existing", "custom")
        (get_profiles_storage_path() / "stray.txt").write_text("not a profile")
        (get_profiles_storage_path() / "empty-dir").mkdir()

        assert _names(profile_service.list_profiles()) == ["Existing"]

    def test_tag_list_reflects_the_directory(self) -> None:
        created = profile_service.create_profile("Tagged", "custom", tags=["smoke"])
        profile_service.create_profile("Other", "custom", tags=["nightly"])

        _remove_profile_dir(created["id"])

        assert profile_service.list_all_tags() == ["nightly"]

    def test_list_does_not_reparse_profiles_it_already_knows(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        profile_service.create_profile("Existing", "custom")
        profile_service.list_profiles()

        opened = _record_opens(monkeypatch)
        profile_service.list_profiles()

        assert opened == []

    def test_list_reads_only_the_profile_it_does_not_know(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        profile_service.create_profile("Existing", "custom")
        profile_service.list_profiles()
        appeared = "11111111-1111-4111-8111-111111111111"
        _write_profile_yaml(appeared, "Checked Out")

        opened = _record_opens(monkeypatch)
        result = profile_service.list_profiles()

        assert opened == [str(_profile_file(appeared))]
        assert _names(result) == ["Checked Out", "Existing"]


class TestReadEvictsAMissingProfile:
    """A read that finds nothing must leave the cache without that entry."""

    def setup_method(self) -> None:
        profile_common._clear_storage()

    def test_get_profile_returns_none_and_drops_the_cache_entry(self) -> None:
        created = profile_service.create_profile("Phantom", "custom")
        _remove_profile_yaml(created["id"])

        assert profile_service.get_profile(created["id"]) is None
        assert created["id"] not in profile_common._profile_storage

    def test_update_profile_returns_none_when_the_file_is_gone(self) -> None:
        created = profile_service.create_profile("Phantom", "custom")
        _remove_profile_yaml(created["id"])

        assert profile_service.update_profile(created["id"], name="Renamed") is None
        assert created["id"] not in profile_common._profile_storage

    def test_delete_profile_reports_not_found_when_the_file_is_gone(self) -> None:
        created = profile_service.create_profile("Phantom", "custom")
        _remove_profile_dir(created["id"])

        assert profile_service.delete_profile(created["id"]) is False
        assert created["id"] not in profile_common._profile_storage

    def test_execution_config_is_not_served_for_a_deleted_profile(self) -> None:
        created = profile_service.create_profile("Phantom", "custom", config={"host": "db"})
        _remove_profile_yaml(created["id"])

        assert profile_service.get_profile_config_for_execution(created["id"]) is None

    def test_duplicate_returns_none_when_the_source_file_is_gone(self) -> None:
        created = profile_service.create_profile("Phantom", "custom")
        _remove_profile_yaml(created["id"])

        assert profile_service.duplicate_profile(created["id"], "Copy") is None

    def test_export_returns_none_when_the_file_is_gone(self) -> None:
        created = profile_service.create_profile("Phantom", "custom")
        _remove_profile_yaml(created["id"])

        assert import_export.export_profile(created["id"]) is None

    def test_name_is_free_again_after_a_read_finds_nothing(self) -> None:
        created = profile_service.create_profile("Phantom", "custom")
        _remove_profile_dir(created["id"])

        assert profile_service.get_profile(created["id"]) is None
        recreated = profile_service.create_profile("Phantom", "custom")
        assert recreated["id"] != created["id"]


class TestUnreadableFileDoesNotBreakTheList:
    """A file that cannot be read is skipped and logged; the list still answers."""

    def setup_method(self) -> None:
        profile_common._clear_storage()

    def test_list_survives_a_profile_file_that_is_not_utf8(self) -> None:
        profile_service.create_profile("Kept", "custom")
        _write_raw_bytes("77777777-7777-4777-8777-777777777777", b"name: \xff\xfe cafe\xe9\n")

        assert _names(profile_service.list_profiles()) == ["Kept"]

    def test_list_survives_a_profile_file_the_process_cannot_read(self) -> None:
        profile_service.create_profile("Kept", "custom")
        unreadable = _write_raw_bytes(
            "88888888-8888-4888-8888-888888888888", b"id: locked\nname: Locked\n"
        )
        unreadable.chmod(0o000)

        assert _names(profile_service.list_profiles()) == ["Kept"]

    def test_list_survives_a_directory_where_the_profile_file_should_be(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        profile_service.create_profile("Kept", "custom")
        directory_id = "99999999-9999-4999-8999-999999999999"
        _profile_file(directory_id).mkdir(parents=True)

        with caplog.at_level(logging.WARNING, logger=_LOGGER_NAME):
            result = profile_service.list_profiles()

        assert _names(result) == ["Kept"]
        assert len(_warnings(caplog)) == 1
        assert str(_profile_file(directory_id)) in _warnings(caplog)[0]
        assert "IsADirectoryError" in _warnings(caplog)[0]

    def test_list_survives_a_file_removed_between_the_scan_and_the_read(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        profile_service.create_profile("Kept", "custom")
        racing_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        _write_profile_yaml(racing_id, "Deleted Mid Scan")
        _delete_on_open(monkeypatch, _profile_file(racing_id))

        assert _names(profile_service.list_profiles()) == ["Kept"]

    def test_list_survives_an_unparsable_profile_file(self) -> None:
        profile_service.create_profile("Kept", "custom")
        _write_raw_yaml("55555555-5555-4555-8555-555555555555", "name: [unclosed\n")

        assert _names(profile_service.list_profiles()) == ["Kept"]

    def test_list_survives_a_profile_file_without_an_id(self) -> None:
        profile_service.create_profile("Kept", "custom")
        _write_raw_yaml("44444444-4444-4444-8444-444444444444", "name: No Id\n")

        assert _names(profile_service.list_profiles()) == ["Kept"]

    def test_list_survives_a_profile_file_that_is_not_a_mapping(self) -> None:
        profile_service.create_profile("Kept", "custom")
        _write_raw_yaml("33333333-3333-4333-8333-333333333333", "- one\n- two\n")

        assert _names(profile_service.list_profiles()) == ["Kept"]

    def test_skipped_file_is_logged_with_its_path_and_reason(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        bad_id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
        _write_raw_bytes(bad_id, b"name: \xff\xfe\n")

        with caplog.at_level(logging.WARNING, logger=_LOGGER_NAME):
            profile_service.list_profiles()

        messages = _warnings(caplog)
        assert any(str(_profile_file(bad_id)) in message for message in messages)
        assert any("UnicodeDecodeError" in message for message in messages)

    def test_an_unreadable_file_is_reported_once_not_once_per_list(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        _write_raw_bytes("15151515-1515-4151-8151-151515151515", b"name: \xff\xfe\n")

        with caplog.at_level(logging.WARNING, logger=_LOGGER_NAME):
            profile_service.list_profiles()
            profile_service.list_profiles()
            profile_service.list_profiles()

        assert len(_warnings(caplog)) == 1

    def test_a_file_that_vanished_is_not_reported_as_unreadable(
        self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ) -> None:
        profile_service.create_profile("Kept", "custom")
        gone_id = "14141414-1414-4141-8141-141414141414"
        _write_profile_yaml(gone_id, "Deleted Mid Scan")
        _delete_on_open(monkeypatch, _profile_file(gone_id))

        with caplog.at_level(logging.WARNING, logger=_LOGGER_NAME):
            result = profile_service.list_profiles()

        assert _names(result) == ["Kept"]
        assert _warnings(caplog) == []

    def test_a_file_that_comes_back_broken_is_reported_again(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        broken_id = "16161616-1616-4161-8161-161616161616"
        _write_raw_bytes(broken_id, b"name: \xff\xfe\n")

        with caplog.at_level(logging.WARNING, logger=_LOGGER_NAME):
            profile_service.list_profiles()
            _remove_profile_dir(broken_id)
            profile_service.list_profiles()
            _write_raw_bytes(broken_id, b"name: \xff\xfe\n")
            profile_service.list_profiles()

        assert len(_warnings(caplog)) == 2

    def test_a_repaired_file_is_listed_without_a_restart(self) -> None:
        broken_id = "17171717-1717-4171-8171-171717171717"
        _write_raw_bytes(broken_id, b"name: \xff\xfe\n")

        assert profile_service.list_profiles()["total"] == 0

        _write_profile_yaml(broken_id, "Repaired")

        assert _names(profile_service.list_profiles()) == ["Repaired"]


class TestOrdinaryLifecycleIsUnchanged:
    """Create, read, update, delete through the product still behave."""

    def setup_method(self) -> None:
        profile_common._clear_storage()

    def test_create_read_update_delete_cycle(self) -> None:
        created = profile_service.create_profile(
            "Login DB", "database", config={"host": "db"}, description="signs in"
        )
        profile_id = created["id"]

        fetched = profile_service.get_profile(profile_id)
        assert fetched is not None
        assert fetched["name"] == "Login DB"
        assert _names(profile_service.list_profiles()) == ["Login DB"]

        updated = profile_service.update_profile(profile_id, name="Login DB v2")
        assert updated is not None
        assert updated["name"] == "Login DB v2"
        assert _names(profile_service.list_profiles()) == ["Login DB v2"]

        assert profile_service.delete_profile(profile_id) is True
        assert profile_service.get_profile(profile_id) is None
        assert profile_service.list_profiles()["total"] == 0
        assert profile_id not in profile_common._profile_storage

    def test_duplicate_name_is_still_rejected(self) -> None:
        profile_service.create_profile("Login DB", "custom")

        with pytest.raises(Exception, match="Profile with name 'Login DB' already exists"):
            profile_service.create_profile("Login DB", "custom")


class TestUsageCountDoesNotScanTheTestsDirectory:
    """Counting which tests bind a profile must not reconcile the tests directory."""

    def setup_method(self) -> None:
        profile_common._clear_storage()
        test_service._clear_storage()

    @staticmethod
    def _count_scans(monkeypatch: pytest.MonkeyPatch) -> list[str]:
        scanned: list[str] = []
        real_scan = entity_cache.scan_entity_ids

        def counting_scan(storage_dir: Path, filename: str) -> set[str]:
            scanned.append(storage_dir.name)
            return real_scan(storage_dir, filename)

        monkeypatch.setattr(entity_cache, "scan_entity_ids", counting_scan)
        return scanned

    def test_list_profiles_scans_profiles_only(self, monkeypatch: pytest.MonkeyPatch) -> None:
        profile_service.create_profile("Bound", "custom")
        test_service.create_test({"name": "A Test"})
        test_service.list_tests()
        profile_service.list_profiles()

        scanned = self._count_scans(monkeypatch)
        profile_service.list_profiles()

        assert scanned == ["api_profiles"]

    def test_reading_one_profile_scans_neither_directory(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        created = profile_service.create_profile("Bound", "custom")
        test_service.create_test({"name": "A Test"})
        test_service.list_tests()
        profile_service.list_profiles()

        scanned = self._count_scans(monkeypatch)
        profile_service.get_profile(created["id"])

        assert scanned == []

    def test_usage_count_still_counts_the_tests_that_bind_the_profile(self) -> None:
        created = profile_service.create_profile("Bound", "custom")
        test_service.create_test({"name": "Binds It", "metadata": {"profile_id": created["id"]}})
        test_service.create_test({"name": "Binds Nothing"})

        rows = profile_service.list_profiles()["profiles"]

        assert [(row["name"], row["usage"]) for row in rows] == [("Bound", 1)]

    def test_a_test_deleted_through_the_product_stops_counting(self) -> None:
        created = profile_service.create_profile("Bound", "custom")
        bound = test_service.create_test(
            {"name": "Binds It", "metadata": {"profile_id": created["id"]}}
        )

        test_service.delete_test(bound["id"])

        rows = profile_service.list_profiles()["profiles"]
        assert [(row["name"], row["usage"]) for row in rows] == [("Bound", 0)]
