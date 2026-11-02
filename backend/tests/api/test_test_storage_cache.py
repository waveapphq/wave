"""Tests for the test service metadata cache staying true to the storage directory.

The YAML files under the tests storage directory are the record. The in-memory
cache is an accessory that must reflect them, including when files are added or
removed by something other than the product (a checkout, a restored backup, a
manual delete).
"""

import builtins
import logging
from pathlib import Path
from typing import Any

import pytest
import yaml

from wavecore.api.services.storage_paths import get_tests_storage_path
from wavecore.api.services.tests import service as test_service


def _test_dir(test_id: str) -> Path:
    return get_tests_storage_path() / test_id


def _test_file(test_id: str) -> Path:
    return _test_dir(test_id) / "test.yaml"


def _remove_test_yaml(test_id: str) -> None:
    """Delete a test's YAML behind the product's back, leaving the directory."""
    _test_file(test_id).unlink()


def _remove_test_dir(test_id: str) -> None:
    """Delete a test's whole directory behind the product's back."""
    import shutil

    shutil.rmtree(_test_dir(test_id))


def _write_test_yaml(test_id: str, name: str) -> None:
    """Write a well-formed test file behind the product's back."""
    _write_raw_yaml(test_id, yaml.safe_dump(_test_document(test_id, name)))


def _test_document(test_id: str, name: str) -> dict[str, Any]:
    return {
        "id": test_id,
        "name": name,
        "version": "1.0.0",
        "description": "appeared underneath",
        "workflow": {"nodes": [], "edges": []},
        "variables": {},
        "metadata": {},
        "created_at": "2026-08-23T00:00:00+00:00",
        "updated_at": "2026-08-23T00:00:00+00:00",
    }


def _write_raw_yaml(test_id: str, contents: str) -> None:
    directory = _test_dir(test_id)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "test.yaml").write_text(contents)


def _write_raw_bytes(test_id: str, contents: bytes) -> Path:
    """Write raw bytes behind the product's back, returning the file."""
    directory = _test_dir(test_id)
    directory.mkdir(parents=True, exist_ok=True)
    test_file = directory / "test.yaml"
    test_file.write_bytes(contents)
    return test_file


def _delete_on_open(monkeypatch: pytest.MonkeyPatch, target: Path) -> None:
    """Delete one file the instant it is opened, reproducing the delete race."""
    real_open = builtins.open

    def racing_open(file: Any, *args: Any, **kwargs: Any) -> Any:
        if Path(str(file)) == target:
            target.unlink(missing_ok=True)
        return real_open(file, *args, **kwargs)

    monkeypatch.setattr(builtins, "open", racing_open)


def _record_opens(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Every test.yaml opened from here on, so a re-parse cannot hide."""
    opened: list[str] = []
    real_open = builtins.open

    def watching_open(file: Any, *args: Any, **kwargs: Any) -> Any:
        if Path(str(file)).name == "test.yaml":
            opened.append(str(file))
        return real_open(file, *args, **kwargs)

    monkeypatch.setattr(builtins, "open", watching_open)
    return opened


def _names(result: dict[str, Any]) -> list[str]:
    return [row["name"] for row in result["tests"]]


class TestListReflectsTheDirectory:
    """The Tests list must not advertise what the directory no longer holds."""

    def setup_method(self) -> None:
        test_service._clear_storage()

    def test_list_omits_test_whose_directory_was_removed(self) -> None:
        created = test_service.create_test({"name": "Phantom"})

        _remove_test_dir(created["id"])

        result = test_service.list_tests()
        assert result["total"] == 0
        assert result["tests"] == []

    def test_list_omits_test_whose_file_was_removed(self) -> None:
        kept = test_service.create_test({"name": "Kept"})
        gone = test_service.create_test({"name": "Gone"})

        _remove_test_yaml(gone["id"])

        result = test_service.list_tests()
        assert _names(result) == ["Kept"]
        assert result["total"] == 1
        assert kept["id"] in {row["id"] for row in result["tests"]}

    def test_list_includes_test_that_appeared_underneath(self) -> None:
        test_service.create_test({"name": "Existing"})

        _write_test_yaml("11111111-1111-4111-8111-111111111111", "Checked Out")

        result = test_service.list_tests()
        assert sorted(_names(result)) == ["Checked Out", "Existing"]
        assert result["total"] == 2

    def test_list_ignores_entries_that_are_not_test_directories(self) -> None:
        test_service.create_test({"name": "Existing"})
        (get_tests_storage_path() / "stray.txt").write_text("not a test")
        (get_tests_storage_path() / "empty-dir").mkdir()

        result = test_service.list_tests()
        assert _names(result) == ["Existing"]

    def test_list_ignores_empty_test_file(self) -> None:
        _write_raw_yaml("22222222-2222-4222-8222-222222222222", "")

        assert test_service.list_tests()["total"] == 0

    def test_list_ignores_test_file_that_is_not_a_mapping(self) -> None:
        _write_raw_yaml("33333333-3333-4333-8333-333333333333", "- one\n- two\n")

        assert test_service.list_tests()["total"] == 0

    def test_list_ignores_test_file_without_an_id(self) -> None:
        _write_raw_yaml("44444444-4444-4444-8444-444444444444", "name: No Id\n")

        assert test_service.list_tests()["total"] == 0

    def test_list_ignores_unparsable_test_file(self) -> None:
        test_service.create_test({"name": "Existing"})
        _write_raw_yaml("55555555-5555-4555-8555-555555555555", "name: [unclosed\n")

        result = test_service.list_tests()
        assert _names(result) == ["Existing"]

    def test_list_does_not_reparse_tests_it_already_knows(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        test_service.create_test({"name": "Existing"})
        test_service.list_tests()

        opened = _record_opens(monkeypatch)
        test_service.list_tests()

        assert opened == []

    def test_list_reads_only_the_test_it_does_not_know(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        test_service.create_test({"name": "Existing"})
        test_service.list_tests()
        appeared = "11111111-1111-4111-8111-111111111111"
        _write_test_yaml(appeared, "Checked Out")

        opened = _record_opens(monkeypatch)
        result = test_service.list_tests()

        assert opened == [str(_test_file(appeared))]
        assert sorted(_names(result)) == ["Checked Out", "Existing"]


class TestReadEvictsAMissingTest:
    """A read that finds nothing must leave the cache without that entry."""

    def setup_method(self) -> None:
        test_service._clear_storage()

    def test_get_test_returns_none_and_drops_the_cache_entry(self) -> None:
        created = test_service.create_test({"name": "Phantom"})
        _remove_test_yaml(created["id"])

        assert test_service.get_test(created["id"]) is None
        assert created["id"] not in test_service._test_cache

    def test_name_is_free_again_after_a_read_finds_nothing(self) -> None:
        created = test_service.create_test({"name": "Phantom"})
        _remove_test_dir(created["id"])

        assert test_service.get_test(created["id"]) is None
        recreated = test_service.create_test({"name": "Phantom"})
        assert recreated["id"] != created["id"]


class TestBackupSeesTheSameTests:
    """The full loader used by backup must agree with the list."""

    def setup_method(self) -> None:
        test_service._clear_storage()

    def test_full_list_picks_up_a_test_that_appeared_underneath(self) -> None:
        test_service.create_test({"name": "Existing"})
        _write_test_yaml("66666666-6666-4666-8666-666666666666", "Checked Out")

        full = test_service._list_all_tests_full()
        assert sorted(t["name"] for t in full) == ["Checked Out", "Existing"]
        assert all("workflow" in t for t in full)

    def test_full_list_skips_a_test_whose_file_vanishes_mid_scan(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        test_service.create_test({"name": "Kept"})
        vanishing = test_service.create_test({"name": "Vanishing"})
        _delete_on_open(monkeypatch, _test_dir(vanishing["id"]) / "test.yaml")

        full = test_service._list_all_tests_full()

        assert [t["name"] for t in full] == ["Kept"]


class TestOrdinaryLifecycleIsUnchanged:
    """Create, read, update, delete through the product still behave."""

    def setup_method(self) -> None:
        test_service._clear_storage()

    def test_create_read_update_delete_cycle(self) -> None:
        created = test_service.create_test(
            {"name": "Login", "description": "signs in", "metadata": {"tags": ["smoke"]}}
        )
        test_id = created["id"]

        fetched = test_service.get_test(test_id)
        assert fetched is not None
        assert fetched["name"] == "Login"
        assert _names(test_service.list_tests()) == ["Login"]

        updated = test_service.update_test(test_id, {"name": "Login v2"})
        assert updated is not None
        assert updated["name"] == "Login v2"
        assert _names(test_service.list_tests()) == ["Login v2"]

        assert test_service.delete_test(test_id) is True
        assert test_service.get_test(test_id) is None
        assert test_service.list_tests()["total"] == 0
        assert test_id not in test_service._test_cache

    def test_duplicate_name_is_still_rejected(self) -> None:
        test_service.create_test({"name": "Login"})

        with pytest.raises(Exception, match="Test with name 'Login' already exists"):
            test_service.create_test({"name": "Login"})


class TestUnreadableFileDoesNotBreakTheList:
    """A file that cannot be read is skipped and logged; the list still answers."""

    def setup_method(self) -> None:
        test_service._clear_storage()

    def test_list_survives_a_test_file_that_is_not_utf8(self) -> None:
        test_service.create_test({"name": "Kept"})
        _write_raw_bytes("77777777-7777-4777-8777-777777777777", b"name: \xff\xfe cafe\xe9\n")

        result = test_service.list_tests()

        assert _names(result) == ["Kept"]

    def test_list_survives_a_test_file_the_process_cannot_read(self) -> None:
        test_service.create_test({"name": "Kept"})
        unreadable = _write_raw_bytes(
            "88888888-8888-4888-8888-888888888888", b"id: unreadable\nname: Locked\n"
        )
        unreadable.chmod(0o000)

        result = test_service.list_tests()

        assert _names(result) == ["Kept"]

    def test_list_survives_a_directory_where_the_test_file_should_be(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        test_service.create_test({"name": "Kept"})
        directory_id = "99999999-9999-4999-8999-999999999999"
        (_test_dir(directory_id) / "test.yaml").mkdir(parents=True)

        with caplog.at_level(logging.WARNING, logger="wavecore.api.services.tests.service"):
            result = test_service.list_tests()

        assert _names(result) == ["Kept"]
        warnings = [
            record
            for record in caplog.records
            if record.levelno >= logging.WARNING
            and record.name == "wavecore.api.services.tests.service"
        ]
        assert len(warnings) == 1
        assert str(_test_dir(directory_id) / "test.yaml") in warnings[0].getMessage()
        assert "IsADirectoryError" in warnings[0].getMessage()

    def test_list_survives_a_file_removed_between_the_scan_and_the_read(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        test_service.create_test({"name": "Kept"})
        racing_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        _write_test_yaml(racing_id, "Deleted Mid Scan")
        _delete_on_open(monkeypatch, _test_dir(racing_id) / "test.yaml")

        result = test_service.list_tests()

        assert _names(result) == ["Kept"]

    def test_list_survives_a_truncated_write_in_progress(self) -> None:
        test_service.create_test({"name": "Kept"})
        _write_raw_bytes(
            "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "id: half\nname: Café".encode()[:-1]
        )

        result = test_service.list_tests()

        assert _names(result) == ["Kept"]

    def test_list_survives_a_test_file_whose_metadata_is_not_a_mapping(self) -> None:
        test_service.create_test({"name": "Kept"})
        _write_raw_yaml(
            "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            "id: cccccccc-cccc-4ccc-8ccc-cccccccccccc\nname: Bad Metadata\nmetadata: [1, 2]\n",
        )

        result = test_service.list_tests()

        assert _names(result) == ["Kept"]

    def test_backup_load_survives_an_unreadable_file(self) -> None:
        test_service.create_test({"name": "Kept"})
        _write_raw_bytes("dddddddd-dddd-4ddd-8ddd-dddddddddddd", b"name: \xff\xfe\n")

        full = test_service._list_all_tests_full()

        assert [t["name"] for t in full] == ["Kept"]

    def test_skipped_file_is_logged_with_its_path_and_reason(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        bad_id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
        _write_raw_bytes(bad_id, b"name: \xff\xfe\n")

        with caplog.at_level(logging.WARNING, logger="wavecore.api.services.tests.service"):
            test_service.list_tests()

        messages = [record.getMessage() for record in caplog.records]
        assert any(str(_test_dir(bad_id) / "test.yaml") in m for m in messages)
        assert any("UnicodeDecodeError" in m for m in messages)

    def test_empty_file_is_logged_rather_than_dropped_in_silence(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        empty_id = "ffffffff-ffff-4fff-8fff-ffffffffffff"
        _write_raw_yaml(empty_id, "")

        with caplog.at_level(logging.WARNING, logger="wavecore.api.services.tests.service"):
            test_service.list_tests()

        assert any(
            str(_test_dir(empty_id) / "test.yaml") in record.getMessage()
            for record in caplog.records
        )

    def test_file_without_an_id_is_logged_rather_than_dropped_in_silence(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        no_id = "12121212-1212-4121-8121-121212121212"
        _write_raw_yaml(no_id, "name: No Id\n")

        with caplog.at_level(logging.WARNING, logger="wavecore.api.services.tests.service"):
            test_service.list_tests()

        assert any(
            str(_test_dir(no_id) / "test.yaml") in record.getMessage() for record in caplog.records
        )


class TestApplicationStartsWithAnUnreadableFile:
    """One bad file must not stop the backend from starting."""

    def setup_method(self) -> None:
        test_service._clear_storage()

    @pytest.mark.asyncio
    async def test_startup_completes_and_lists_the_readable_tests(self) -> None:
        from wavecore.api.app import app

        test_service.create_test({"name": "Kept"})
        _write_raw_bytes("13131313-1313-4131-8131-131313131313", b"name: \xff\xfe\n")
        test_service._clear_in_memory_cache()

        async with app.router.lifespan_context(app):
            assert _names(test_service.list_tests()) == ["Kept"]


class TestTheTraceIsUsable:
    """The warning names a file still on disk, once, not once per request."""

    def setup_method(self) -> None:
        test_service._clear_storage()

    def _warnings(self, caplog: pytest.LogCaptureFixture) -> list[str]:
        return [r.getMessage() for r in caplog.records if r.levelno >= logging.WARNING]

    def test_a_file_that_vanished_is_not_reported_as_unreadable(
        self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ) -> None:
        test_service.create_test({"name": "Kept"})
        gone_id = "14141414-1414-4141-8141-141414141414"
        _write_test_yaml(gone_id, "Deleted Mid Scan")
        _delete_on_open(monkeypatch, _test_dir(gone_id) / "test.yaml")

        with caplog.at_level(logging.WARNING, logger="wavecore.api.services.tests.service"):
            result = test_service.list_tests()

        assert _names(result) == ["Kept"]
        assert self._warnings(caplog) == []

    def test_an_unreadable_file_is_reported_once_not_once_per_list(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        _write_raw_bytes("15151515-1515-4151-8151-151515151515", b"name: \xff\xfe\n")

        with caplog.at_level(logging.WARNING, logger="wavecore.api.services.tests.service"):
            test_service.list_tests()
            test_service.list_tests()
            test_service.list_tests()

        assert len(self._warnings(caplog)) == 1

    def test_a_file_that_comes_back_broken_is_reported_again(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        broken_id = "16161616-1616-4161-8161-161616161616"
        _write_raw_bytes(broken_id, b"name: \xff\xfe\n")

        with caplog.at_level(logging.WARNING, logger="wavecore.api.services.tests.service"):
            test_service.list_tests()
            _remove_test_dir(broken_id)
            test_service.list_tests()
            _write_raw_bytes(broken_id, b"name: \xff\xfe\n")
            test_service.list_tests()

        assert len(self._warnings(caplog)) == 2
