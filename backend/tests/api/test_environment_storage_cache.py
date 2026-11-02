"""Tests for the environment cache staying true to its storage directory.

The YAML files under the environments storage directory are the record. The
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

from wavecore.api.services.environments import service as environment_service
from wavecore.api.services.storage_paths import get_environments_storage_path

_LOGGER_NAME = "wavecore.api.services.environments.service"


def _env_dir(env_id: str) -> Path:
    return get_environments_storage_path() / env_id


def _env_file(env_id: str) -> Path:
    return _env_dir(env_id) / "environment.yaml"


def _remove_env_yaml(env_id: str) -> None:
    """Delete an environment's YAML behind the product's back."""
    _env_file(env_id).unlink()


def _remove_env_dir(env_id: str) -> None:
    """Delete an environment's whole directory behind the product's back."""
    shutil.rmtree(_env_dir(env_id))


def _env_document(env_id: str, name: str) -> dict[str, Any]:
    return {
        "id": env_id,
        "name": name,
        "tags": [],
        "created_at": "2026-08-23T00:00:00Z",
        "updated_at": "2026-08-23T00:00:00Z",
    }


def _write_raw_yaml(env_id: str, contents: str) -> Path:
    directory = _env_dir(env_id)
    directory.mkdir(parents=True, exist_ok=True)
    env_file = directory / "environment.yaml"
    env_file.write_text(contents)
    return env_file


def _write_raw_bytes(env_id: str, contents: bytes) -> Path:
    directory = _env_dir(env_id)
    directory.mkdir(parents=True, exist_ok=True)
    env_file = directory / "environment.yaml"
    env_file.write_bytes(contents)
    return env_file


def _write_env_yaml(env_id: str, name: str) -> None:
    """Write a well-formed environment file behind the product's back."""
    _write_raw_yaml(env_id, yaml.safe_dump(_env_document(env_id, name)))


def _delete_on_open(monkeypatch: pytest.MonkeyPatch, target: Path) -> None:
    """Delete one file the instant it is opened, reproducing the delete race."""
    real_open = builtins.open

    def racing_open(file: Any, *args: Any, **kwargs: Any) -> Any:
        if Path(str(file)) == target:
            target.unlink(missing_ok=True)
        return real_open(file, *args, **kwargs)

    monkeypatch.setattr(builtins, "open", racing_open)


def _record_opens(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Every environment.yaml opened from here on, so a re-parse cannot hide."""
    opened: list[str] = []
    real_open = builtins.open

    def watching_open(file: Any, *args: Any, **kwargs: Any) -> Any:
        if Path(str(file)).name == "environment.yaml":
            opened.append(str(file))
        return real_open(file, *args, **kwargs)

    monkeypatch.setattr(builtins, "open", watching_open)
    return opened


def _names(result: dict[str, Any]) -> list[str]:
    return sorted(row["name"] for row in result["environments"])


def _warnings(caplog: pytest.LogCaptureFixture) -> list[str]:
    return [
        record.getMessage()
        for record in caplog.records
        if record.levelno >= logging.WARNING and record.name == _LOGGER_NAME
    ]


class TestListReflectsTheDirectory:
    """The Environments list must not advertise what the directory no longer holds."""

    def setup_method(self) -> None:
        environment_service._clear_storage()

    def test_list_omits_environment_whose_directory_was_removed(self) -> None:
        created = environment_service.create_environment("Phantom")

        _remove_env_dir(created["id"])

        result = environment_service.list_environments()
        assert result["environments"] == []
        assert result["total"] == 0

    def test_list_omits_environment_whose_file_was_removed(self) -> None:
        environment_service.create_environment("Kept")
        gone = environment_service.create_environment("Gone")

        _remove_env_yaml(gone["id"])

        result = environment_service.list_environments()
        assert _names(result) == ["Kept"]
        assert result["total"] == 1

    def test_list_includes_environment_that_appeared_underneath(self) -> None:
        environment_service.create_environment("Existing")

        _write_env_yaml("11111111-1111-4111-8111-111111111111", "Checked Out")

        result = environment_service.list_environments()
        assert _names(result) == ["Checked Out", "Existing"]
        assert result["total"] == 2

    def test_list_ignores_entries_that_are_not_environment_directories(self) -> None:
        environment_service.create_environment("Existing")
        (get_environments_storage_path() / "stray.txt").write_text("not an environment")
        (get_environments_storage_path() / "empty-dir").mkdir()

        assert _names(environment_service.list_environments()) == ["Existing"]

    def test_name_dropdown_reflects_the_directory(self) -> None:
        created = environment_service.create_environment("Phantom")
        environment_service.create_environment("Kept")

        _remove_env_dir(created["id"])

        assert [row["name"] for row in environment_service.list_environment_names()] == ["Kept"]

    def test_tag_list_reflects_the_directory(self) -> None:
        created = environment_service.create_environment("Tagged", tags=["smoke"])
        environment_service.create_environment("Other", tags=["nightly"])

        _remove_env_dir(created["id"])

        assert environment_service.list_all_tags() == ["nightly"]

    def test_list_does_not_reparse_environments_it_already_knows(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        environment_service.create_environment("Existing")
        environment_service.list_environments()

        opened = _record_opens(monkeypatch)
        environment_service.list_environments()

        assert opened == []

    def test_list_reads_only_the_environment_it_does_not_know(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        environment_service.create_environment("Existing")
        environment_service.list_environments()
        appeared = "11111111-1111-4111-8111-111111111111"
        _write_env_yaml(appeared, "Checked Out")

        opened = _record_opens(monkeypatch)
        result = environment_service.list_environments()

        assert opened == [str(_env_file(appeared))]
        assert _names(result) == ["Checked Out", "Existing"]


class TestReadEvictsAMissingEnvironment:
    """A read that finds nothing must leave the cache without that entry."""

    def setup_method(self) -> None:
        environment_service._clear_storage()

    def test_get_environment_returns_none_and_drops_the_cache_entry(self) -> None:
        created = environment_service.create_environment("Phantom")
        _remove_env_yaml(created["id"])

        assert environment_service.get_environment(created["id"]) is None
        assert created["id"] not in environment_service._environments

    def test_update_environment_returns_none_when_the_file_is_gone(self) -> None:
        created = environment_service.create_environment("Phantom")
        _remove_env_yaml(created["id"])

        assert environment_service.update_environment(created["id"], name="Renamed") is None
        assert created["id"] not in environment_service._environments

    def test_delete_environment_reports_not_found_when_the_file_is_gone(self) -> None:
        created = environment_service.create_environment("Phantom")
        _remove_env_dir(created["id"])

        assert environment_service.delete_environment(created["id"]) is False
        assert created["id"] not in environment_service._environments

    def test_duplicate_returns_none_when_the_source_file_is_gone(self) -> None:
        created = environment_service.create_environment("Phantom")
        _remove_env_yaml(created["id"])

        assert environment_service.duplicate_environment(created["id"]) is None

    def test_export_returns_none_when_the_file_is_gone(self) -> None:
        created = environment_service.create_environment("Phantom")
        _remove_env_yaml(created["id"])

        assert environment_service.export_environment(created["id"]) is None

    def test_name_is_free_again_after_a_read_finds_nothing(self) -> None:
        created = environment_service.create_environment("Phantom")
        _remove_env_dir(created["id"])

        assert environment_service.get_environment(created["id"]) is None
        recreated = environment_service.create_environment("Phantom")
        assert recreated["id"] != created["id"]


class TestUnreadableFileDoesNotBreakTheList:
    """A file that cannot be read is skipped and logged; the list still answers."""

    def setup_method(self) -> None:
        environment_service._clear_storage()

    def test_list_survives_an_environment_file_that_is_not_utf8(self) -> None:
        environment_service.create_environment("Kept")
        _write_raw_bytes("77777777-7777-4777-8777-777777777777", b"name: \xff\xfe cafe\xe9\n")

        assert _names(environment_service.list_environments()) == ["Kept"]

    def test_list_survives_an_environment_file_the_process_cannot_read(self) -> None:
        environment_service.create_environment("Kept")
        unreadable = _write_raw_bytes(
            "88888888-8888-4888-8888-888888888888", b"id: locked\nname: Locked\n"
        )
        unreadable.chmod(0o000)

        assert _names(environment_service.list_environments()) == ["Kept"]

    def test_list_survives_a_directory_where_the_environment_file_should_be(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        environment_service.create_environment("Kept")
        directory_id = "99999999-9999-4999-8999-999999999999"
        _env_file(directory_id).mkdir(parents=True)

        with caplog.at_level(logging.WARNING, logger=_LOGGER_NAME):
            result = environment_service.list_environments()

        assert _names(result) == ["Kept"]
        assert len(_warnings(caplog)) == 1
        assert str(_env_file(directory_id)) in _warnings(caplog)[0]
        assert "IsADirectoryError" in _warnings(caplog)[0]

    def test_list_survives_a_file_removed_between_the_scan_and_the_read(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        environment_service.create_environment("Kept")
        racing_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        _write_env_yaml(racing_id, "Deleted Mid Scan")
        _delete_on_open(monkeypatch, _env_file(racing_id))

        assert _names(environment_service.list_environments()) == ["Kept"]

    def test_list_survives_an_unparsable_environment_file(self) -> None:
        environment_service.create_environment("Kept")
        _write_raw_yaml("55555555-5555-4555-8555-555555555555", "name: [unclosed\n")

        assert _names(environment_service.list_environments()) == ["Kept"]

    def test_list_survives_an_environment_file_without_an_id(self) -> None:
        environment_service.create_environment("Kept")
        _write_raw_yaml("44444444-4444-4444-8444-444444444444", "name: No Id\n")

        assert _names(environment_service.list_environments()) == ["Kept"]

    def test_list_survives_an_environment_file_that_is_not_a_mapping(self) -> None:
        environment_service.create_environment("Kept")
        _write_raw_yaml("33333333-3333-4333-8333-333333333333", "- one\n- two\n")

        assert _names(environment_service.list_environments()) == ["Kept"]

    def test_skipped_file_is_logged_with_its_path_and_reason(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        bad_id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
        _write_raw_bytes(bad_id, b"name: \xff\xfe\n")

        with caplog.at_level(logging.WARNING, logger=_LOGGER_NAME):
            environment_service.list_environments()

        messages = _warnings(caplog)
        assert any(str(_env_file(bad_id)) in message for message in messages)
        assert any("UnicodeDecodeError" in message for message in messages)

    def test_an_unreadable_file_is_reported_once_not_once_per_list(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        _write_raw_bytes("15151515-1515-4151-8151-151515151515", b"name: \xff\xfe\n")

        with caplog.at_level(logging.WARNING, logger=_LOGGER_NAME):
            environment_service.list_environments()
            environment_service.list_environments()
            environment_service.list_environments()

        assert len(_warnings(caplog)) == 1

    def test_a_file_that_vanished_is_not_reported_as_unreadable(
        self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ) -> None:
        environment_service.create_environment("Kept")
        gone_id = "14141414-1414-4141-8141-141414141414"
        _write_env_yaml(gone_id, "Deleted Mid Scan")
        _delete_on_open(monkeypatch, _env_file(gone_id))

        with caplog.at_level(logging.WARNING, logger=_LOGGER_NAME):
            result = environment_service.list_environments()

        assert _names(result) == ["Kept"]
        assert _warnings(caplog) == []

    def test_a_file_that_comes_back_broken_is_reported_again(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        broken_id = "16161616-1616-4161-8161-161616161616"
        _write_raw_bytes(broken_id, b"name: \xff\xfe\n")

        with caplog.at_level(logging.WARNING, logger=_LOGGER_NAME):
            environment_service.list_environments()
            _remove_env_dir(broken_id)
            environment_service.list_environments()
            _write_raw_bytes(broken_id, b"name: \xff\xfe\n")
            environment_service.list_environments()

        assert len(_warnings(caplog)) == 2

    def test_a_repaired_file_is_listed_without_a_restart(self) -> None:
        broken_id = "17171717-1717-4171-8171-171717171717"
        _write_raw_bytes(broken_id, b"name: \xff\xfe\n")

        assert environment_service.list_environments()["total"] == 0

        _write_env_yaml(broken_id, "Repaired")

        assert _names(environment_service.list_environments()) == ["Repaired"]


class TestOrdinaryLifecycleIsUnchanged:
    """Create, read, update, delete through the product still behave."""

    def setup_method(self) -> None:
        environment_service._clear_storage()

    def test_create_read_update_delete_cycle(self) -> None:
        created = environment_service.create_environment("Staging", description="pre-production")
        env_id = created["id"]

        fetched = environment_service.get_environment(env_id)
        assert fetched is not None
        assert fetched["name"] == "Staging"
        assert _names(environment_service.list_environments()) == ["Staging"]

        updated = environment_service.update_environment(env_id, name="Staging v2")
        assert updated is not None
        assert updated["name"] == "Staging v2"
        assert _names(environment_service.list_environments()) == ["Staging v2"]

        assert environment_service.delete_environment(env_id) is True
        assert environment_service.get_environment(env_id) is None
        assert environment_service.list_environments()["total"] == 0
        assert env_id not in environment_service._environments

    def test_duplicate_name_is_still_rejected(self) -> None:
        environment_service.create_environment("Staging")

        with pytest.raises(Exception, match="Environment with name 'Staging' already exists"):
            environment_service.create_environment("Staging")
