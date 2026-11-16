"""WAVE's trusted SSH hosts: the list in the data folder, the policy in the config (REQ-4.5.14)."""

import base64
import hashlib
import inspect
import os
import re
import threading
import uuid
from collections.abc import Callable, Mapping
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import asyncssh
import pytest
import yaml

from wavecore.api.config import get_config
from wavecore.api.services import settings_file, storage_paths
from wavecore.core.ssh import trusted_hosts
from wavecore.core.ssh.trusted_hosts import TrustedHostConflict, TrustedHostsUnreadable

DEFAULT_POLICY = {"lock_trusted_hosts": False, "default_block_action": "disabled"}
LOCKED_STRICT = {"lock_trusted_hosts": True, "default_block_action": "strict"}
UNLOCKED_ACCEPT_NEW = {"lock_trusted_hosts": False, "default_block_action": "accept-new"}
BROKEN_YAML = "hosts: [unclosed\n"
HOST_FIELDS = {"id", "host", "port", "public_key", "added"}
LABELS = {
    "ssh-ed25519": "ED25519",
    "ecdsa-sha2-nistp256": "ECDSA",
    "ecdsa-sha2-nistp384": "ECDSA",
    "ecdsa-sha2-nistp521": "ECDSA",
    "ssh-rsa": "RSA",
}
SEEDED_AT = "2026-09-01T08:00:00Z"


def exact(message: str) -> str:
    return f"^{re.escape(message)}$"


def unreadable(path: Path) -> str:
    return "^" + re.escape(f"WAVE's trusted SSH hosts list {path} cannot be read: ") + ".+$"


def read_only(path: Path) -> str:
    return exact(f"Settings cannot be saved: the config file {path} is read-only")


def ssh_section(policy: Mapping[str, Any]) -> dict[str, Any]:
    return {"network": {"ssh_hosts": dict(policy)}}


def _public(algorithm: str, **options: Any) -> asyncssh.SSHKey:
    return asyncssh.generate_private_key(algorithm, **options).convert_to_public()


def openssh(key: asyncssh.SSHKey) -> str:
    return key.export_public_key("openssh").decode().strip()


def label(key: asyncssh.SSHKey) -> str:
    return LABELS[key.get_algorithm()]


def addition(host: str, port: int, key: asyncssh.SSHKey) -> dict[str, Any]:
    return {"host": host, "port": port, "key_type": label(key), "key": openssh(key)}


def stored(entry_id: str, host: str, port: int, key: asyncssh.SSHKey) -> dict[str, Any]:
    return {
        "id": entry_id,
        "host": host,
        "port": port,
        "public_key": openssh(key),
        "added": SEEDED_AT,
    }


def write_store(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")


def on_disk(path: Path) -> dict[str, Any]:
    return dict(yaml.safe_load(path.read_text(encoding="utf-8")))


def assert_new_id(entry_id: str) -> None:
    assert isinstance(entry_id, str)
    assert uuid.UUID(hex=entry_id).hex == entry_id
    assert uuid.UUID(hex=entry_id).version == 4


def assert_added_now(added: str, before: datetime, after: datetime) -> None:
    assert isinstance(added, str)
    stamp = datetime.fromisoformat(added)
    assert stamp.utcoffset() == timedelta(0)
    assert before.replace(microsecond=0) <= stamp <= after + timedelta(seconds=1)


def lines_of(data: bytes) -> list[str]:
    return [line for line in data.decode().splitlines() if line.strip()]


@pytest.fixture(scope="module")
def keys() -> dict[str, asyncssh.SSHKey]:
    return {
        "ed25519": _public("ssh-ed25519"),
        "ed25519_other": _public("ssh-ed25519"),
        "nistp256": _public("ecdsa-sha2-nistp256"),
        "nistp384": _public("ecdsa-sha2-nistp384"),
        "nistp521": _public("ecdsa-sha2-nistp521"),
        "rsa": _public("ssh-rsa", key_size=1024),
        "rsa_other": _public("ssh-rsa", key_size=1024),
    }


@pytest.fixture
def hosts_file(tmp_path: Path) -> Path:
    storage_paths.set_base_path(tmp_path)
    return tmp_path / "network" / "ssh_hosts.yaml"


HOSTS_WRITES: list[Callable[[dict[str, asyncssh.SSHKey]], Any]] = [
    lambda keys: trusted_hosts.record_first_contact("db9", 22, keys["nistp256"]),
    lambda keys: trusted_hosts.apply_change([addition("db9", 22, keys["nistp256"])], []),
    lambda keys: trusted_hosts.clear_hosts(),
    lambda keys: trusted_hosts.restore_entries(
        [stored("c" * 32, "db9", 22, keys["nistp256"])], "skip"
    ),
]
HOSTS_WRITE_IDS = ["record_first_contact", "apply_change", "clear_hosts", "restore"]


class TestLoad:
    def test_there_is_no_default_policy_constant(self) -> None:
        assert not hasattr(trusted_hosts, "DEFAULT_POLICY")

    def test_missing_file_gives_no_hosts(self, hosts_file: Path) -> None:
        assert trusted_hosts.load() == {"hosts": []}
        assert not hosts_file.exists()

    def test_stored_hosts_come_without_a_policy(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        entry = stored("a" * 32, "db1", 22, keys["ed25519"])
        write_store(hosts_file, {"hosts": [entry]})

        assert trusted_hosts.load() == {"hosts": [entry]}

    def test_full_store_is_returned_as_stored(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        data = {
            "hosts": [
                stored("a" * 32, "db1", 22, keys["ed25519"]),
                stored("b" * 32, "db2", 2222, keys["rsa"]),
            ],
        }
        write_store(hosts_file, data)

        assert trusted_hosts.load() == data

    def test_the_config_policy_is_not_part_of_the_store(
        self, hosts_file: Path, load_config: Callable[..., Any]
    ) -> None:
        load_config(ssh_section(LOCKED_STRICT))

        assert trusted_hosts.load() == {"hosts": []}

    def test_changing_a_loaded_value_does_not_change_the_defaults(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        trusted_hosts.load()["hosts"].append(stored("a" * 32, "db1", 22, keys["ed25519"]))

        assert trusted_hosts.load() == {"hosts": []}


class TestPolicy:
    def test_defaults(self, hosts_file: Path) -> None:
        assert trusted_hosts.policy() == DEFAULT_POLICY

    def test_comes_from_the_config_file(
        self, hosts_file: Path, load_config: Callable[..., Any]
    ) -> None:
        load_config(ssh_section(LOCKED_STRICT))

        assert trusted_hosts.policy() == LOCKED_STRICT

    @pytest.mark.parametrize(
        ("in_the_file", "expected"),
        [
            (
                {"lock_trusted_hosts": True},
                {"lock_trusted_hosts": True, "default_block_action": "disabled"},
            ),
            (
                {"default_block_action": "strict"},
                {"lock_trusted_hosts": False, "default_block_action": "strict"},
            ),
        ],
        ids=["lock-only", "action-only"],
    )
    def test_a_field_missing_from_the_config_file_takes_its_default(
        self,
        hosts_file: Path,
        load_config: Callable[..., Any],
        in_the_file: dict[str, Any],
        expected: dict[str, Any],
    ) -> None:
        load_config(ssh_section(in_the_file))

        assert trusted_hosts.policy() == expected

    def test_holds_the_two_policy_fields_only(
        self, hosts_file: Path, load_config: Callable[..., Any]
    ) -> None:
        load_config(ssh_section({**LOCKED_STRICT, "note": "kept by hand"}))

        assert trusted_hosts.policy() == LOCKED_STRICT

    def test_ignores_a_policy_left_in_the_hosts_file(self, hosts_file: Path) -> None:
        write_store(hosts_file, {"policy": LOCKED_STRICT, "hosts": []})

        assert trusted_hosts.policy() == DEFAULT_POLICY


class TestSavePolicy:
    def test_writes_the_policy_into_the_config_file(
        self, hosts_file: Path, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        assert trusted_hosts.save_policy(LOCKED_STRICT) is None

        assert config_on_disk()["network"]["ssh_hosts"] == LOCKED_STRICT
        assert trusted_hosts.policy() == LOCKED_STRICT
        assert get_config().get("network.ssh_hosts.lock_trusted_hosts") is True
        assert get_config().get("network.ssh_hosts.default_block_action") == "strict"

    def test_survives_a_restart(self, hosts_file: Path, load_config: Callable[..., Any]) -> None:
        trusted_hosts.save_policy(LOCKED_STRICT)

        load_config()

        assert trusted_hosts.policy() == LOCKED_STRICT

    def test_replaces_the_saved_policy(
        self,
        hosts_file: Path,
        load_config: Callable[..., Any],
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        load_config(ssh_section(LOCKED_STRICT))

        trusted_hosts.save_policy(UNLOCKED_ACCEPT_NEW)

        assert config_on_disk()["network"]["ssh_hosts"] == UNLOCKED_ACCEPT_NEW
        assert trusted_hosts.policy() == UNLOCKED_ACCEPT_NEW

    def test_keeps_the_rest_of_the_config_file(
        self,
        hosts_file: Path,
        load_config: Callable[..., Any],
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        load_config({"network": {"certificates": {"public_source": "host"}}})

        trusted_hosts.save_policy(LOCKED_STRICT)

        assert config_on_disk() == {
            "network": {"certificates": {"public_source": "host"}, "ssh_hosts": LOCKED_STRICT}
        }

    def test_writes_no_hosts_file(self, hosts_file: Path) -> None:
        trusted_hosts.save_policy(LOCKED_STRICT)

        assert not hosts_file.parent.exists()

    def test_leaves_an_existing_hosts_file_untouched(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        write_store(hosts_file, {"hosts": [stored("a" * 32, "db1", 22, keys["ed25519"])]})
        original = hosts_file.read_bytes()

        trusted_hosts.save_policy(LOCKED_STRICT)

        assert hosts_file.read_bytes() == original
        assert sorted(hosts_file.parent.iterdir()) == [hosts_file]

    def test_a_read_only_config_file_refuses_and_changes_nothing(
        self, hosts_file: Path, read_only_config: Path
    ) -> None:
        from wavecore.api.config.write_back import ConfigWriteError

        original = read_only_config.read_bytes()

        with pytest.raises(ConfigWriteError, match=read_only(read_only_config)):
            trusted_hosts.save_policy(LOCKED_STRICT)

        assert read_only_config.read_bytes() == original
        assert trusted_hosts.policy() == DEFAULT_POLICY


class TestUnreadableStore:
    def test_invalid_yaml(self, hosts_file: Path) -> None:
        hosts_file.parent.mkdir(parents=True)
        hosts_file.write_text(BROKEN_YAML, encoding="utf-8")

        with pytest.raises(TrustedHostsUnreadable, match=unreadable(hosts_file)):
            trusted_hosts.load()

    def test_folder_in_place_of_the_file(self, hosts_file: Path) -> None:
        hosts_file.mkdir(parents=True)

        with pytest.raises(TrustedHostsUnreadable, match=unreadable(hosts_file)):
            trusted_hosts.load()

    @pytest.mark.parametrize(
        "read",
        [trusted_hosts.load, trusted_hosts.known_hosts_bytes],
        ids=["load", "known_hosts_bytes"],
    )
    def test_every_read_refuses(self, hosts_file: Path, read: Callable[[], Any]) -> None:
        hosts_file.parent.mkdir(parents=True)
        hosts_file.write_text(BROKEN_YAML, encoding="utf-8")

        with pytest.raises(TrustedHostsUnreadable, match=unreadable(hosts_file)):
            read()

    @pytest.mark.parametrize("change", HOSTS_WRITES, ids=HOSTS_WRITE_IDS)
    def test_every_write_refuses_and_keeps_the_file(
        self,
        hosts_file: Path,
        keys: dict[str, asyncssh.SSHKey],
        change: Callable[[dict[str, asyncssh.SSHKey]], Any],
    ) -> None:
        hosts_file.parent.mkdir(parents=True)
        hosts_file.write_text(BROKEN_YAML, encoding="utf-8")

        with pytest.raises(TrustedHostsUnreadable, match=unreadable(hosts_file)):
            change(keys)

        assert hosts_file.read_text(encoding="utf-8") == BROKEN_YAML
        assert sorted(hosts_file.parent.iterdir()) == [hosts_file]

    def test_the_policy_is_read_and_saved_without_the_hosts_file(self, hosts_file: Path) -> None:
        hosts_file.parent.mkdir(parents=True)
        hosts_file.write_text(BROKEN_YAML, encoding="utf-8")

        trusted_hosts.save_policy(LOCKED_STRICT)
        assert trusted_hosts.policy() == LOCKED_STRICT
        assert trusted_hosts.is_locked() is True

        trusted_hosts.reset_policy()
        assert trusted_hosts.policy() == DEFAULT_POLICY
        assert trusted_hosts.is_locked() is False

        assert hosts_file.read_text(encoding="utf-8") == BROKEN_YAML
        assert sorted(hosts_file.parent.iterdir()) == [hosts_file]


class TestHostsFileShape:
    @pytest.mark.parametrize("change", HOSTS_WRITES, ids=HOSTS_WRITE_IDS)
    def test_every_write_leaves_only_the_hosts_and_drops_a_leftover_policy(
        self,
        hosts_file: Path,
        keys: dict[str, asyncssh.SSHKey],
        change: Callable[[dict[str, asyncssh.SSHKey]], Any],
    ) -> None:
        write_store(
            hosts_file,
            {"policy": LOCKED_STRICT, "hosts": [stored("a" * 32, "db1", 22, keys["ed25519"])]},
        )

        change(keys)

        written = on_disk(hosts_file)
        assert set(written) == {"hosts"}
        assert trusted_hosts.load() == written

    @pytest.mark.parametrize("change", HOSTS_WRITES, ids=HOSTS_WRITE_IDS)
    def test_no_hosts_write_touches_the_config_policy(
        self,
        hosts_file: Path,
        keys: dict[str, asyncssh.SSHKey],
        load_config: Callable[..., Any],
        config_file: Path,
        change: Callable[[dict[str, asyncssh.SSHKey]], Any],
    ) -> None:
        load_config(ssh_section(LOCKED_STRICT))
        write_store(hosts_file, {"hosts": [stored("a" * 32, "db1", 22, keys["ed25519"])]})
        original = config_file.read_bytes()

        change(keys)

        assert config_file.read_bytes() == original
        assert trusted_hosts.policy() == LOCKED_STRICT


class TestKnownHostsBytes:
    def test_port_22_uses_the_bare_host_and_other_ports_use_brackets(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        write_store(
            hosts_file,
            {
                "hosts": [
                    stored("a" * 32, "db1", 22, keys["ed25519"]),
                    stored("b" * 32, "db2", 2222, keys["nistp256"]),
                ]
            },
        )

        data = trusted_hosts.known_hosts_bytes()

        assert isinstance(data, bytes)
        assert sorted(lines_of(data)) == sorted(
            [
                f"db1 {openssh(keys['ed25519'])}",
                f"[db2]:2222 {openssh(keys['nistp256'])}",
            ]
        )

    def test_one_line_per_entry(self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]) -> None:
        write_store(
            hosts_file,
            {
                "hosts": [
                    stored("a" * 32, "db1", 22, keys["ed25519"]),
                    stored("b" * 32, "db1", 22, keys["nistp384"]),
                    stored("c" * 32, "db1", 22, keys["rsa"]),
                ]
            },
        )

        assert len(lines_of(trusted_hosts.known_hosts_bytes())) == 3

    def test_asyncssh_reads_the_bytes_and_matches_each_entry(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        write_store(
            hosts_file,
            {
                "hosts": [
                    stored("a" * 32, "db1", 22, keys["ed25519"]),
                    stored("b" * 32, "db2", 2222, keys["nistp521"]),
                    stored("c" * 32, "db2", 2222, keys["rsa"]),
                ]
            },
        )

        known = asyncssh.import_known_hosts(trusted_hosts.known_hosts_bytes().decode())

        assert known.match("db1", "", 22)[0] == [keys["ed25519"]]
        assert known.match("db2", "", 2222)[0] == [keys["nistp521"], keys["rsa"]]
        assert known.match("db2", "", 22)[0] == []

    def test_empty_store_has_no_lines(self, hosts_file: Path) -> None:
        data = trusted_hosts.known_hosts_bytes()

        assert isinstance(data, bytes)
        assert data.strip() == b""


class TestIsLocked:
    def test_unlocked_by_default(self, hosts_file: Path) -> None:
        assert trusted_hosts.is_locked() is False

    def test_follows_each_saved_policy(self, hosts_file: Path) -> None:
        trusted_hosts.save_policy(LOCKED_STRICT)
        assert trusted_hosts.is_locked() is True

        trusted_hosts.save_policy({"lock_trusted_hosts": False, "default_block_action": "strict"})
        assert trusted_hosts.is_locked() is False

        trusted_hosts.save_policy(LOCKED_STRICT)
        assert trusted_hosts.is_locked() is True

    def test_follows_the_config_file_after_a_restart(
        self, hosts_file: Path, load_config: Callable[..., Any]
    ) -> None:
        load_config(ssh_section({"lock_trusted_hosts": True}))

        assert trusted_hosts.is_locked() is True

    def test_ignores_a_lock_left_in_the_hosts_file(self, hosts_file: Path) -> None:
        write_store(hosts_file, {"policy": {"lock_trusted_hosts": True}, "hosts": []})

        assert trusted_hosts.is_locked() is False

    def test_does_not_read_the_hosts_file(
        self, hosts_file: Path, load_config: Callable[..., Any]
    ) -> None:
        load_config(ssh_section({"lock_trusted_hosts": True}))
        hosts_file.parent.mkdir(parents=True)
        hosts_file.write_text(BROKEN_YAML, encoding="utf-8")

        assert trusted_hosts.is_locked() is True


class TestRecordFirstContact:
    def test_appends_one_entry(self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]) -> None:
        before = datetime.now(UTC)
        trusted_hosts.record_first_contact("db1", 22, keys["ed25519"])
        after = datetime.now(UTC)

        hosts = trusted_hosts.load()["hosts"]
        assert len(hosts) == 1
        entry = hosts[0]
        assert set(entry) == HOST_FIELDS
        assert (entry["host"], entry["port"], entry["public_key"]) == (
            "db1",
            22,
            openssh(keys["ed25519"]),
        )
        assert_new_id(entry["id"])
        assert_added_now(entry["added"], before, after)

    def test_other_port_is_recorded_with_its_port(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        trusted_hosts.record_first_contact("db1", 2222, keys["rsa"])

        entry = trusted_hosts.load()["hosts"][0]
        assert (entry["host"], entry["port"], entry["public_key"]) == (
            "db1",
            2222,
            openssh(keys["rsa"]),
        )
        assert lines_of(trusted_hosts.known_hosts_bytes()) == [f"[db1]:2222 {openssh(keys['rsa'])}"]

    def test_keeps_the_other_entries_and_drops_a_leftover_policy(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        existing = stored("a" * 32, "db1", 22, keys["ed25519"])
        write_store(hosts_file, {"policy": LOCKED_STRICT, "hosts": [existing]})

        trusted_hosts.record_first_contact("db2", 22, keys["nistp256"])

        written = on_disk(hosts_file)
        assert set(written) == {"hosts"}
        assert written["hosts"][0] == existing
        assert [(e["host"], e["public_key"]) for e in written["hosts"]] == [
            ("db1", openssh(keys["ed25519"])),
            ("db2", openssh(keys["nistp256"])),
        ]
        assert trusted_hosts.load() == written

    def test_public_key_drops_the_key_comment(self, hosts_file: Path) -> None:
        key = asyncssh.generate_private_key("ssh-ed25519", comment="root@db1").convert_to_public()

        trusted_hosts.record_first_contact("db1", 22, key)

        public_key = trusted_hosts.load()["hosts"][0]["public_key"]
        algorithm, blob = public_key.split(" ")
        assert algorithm == "ssh-ed25519"
        assert asyncssh.import_public_key(public_key) == key
        assert blob == openssh(key).split(" ")[1]

    def test_each_record_gets_its_own_id(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        trusted_hosts.record_first_contact("db1", 22, keys["ed25519"])
        trusted_hosts.record_first_contact("db2", 22, keys["ed25519"])

        first, second = trusted_hosts.load()["hosts"]
        assert first["id"] != second["id"]

    def test_creates_the_network_folder(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        assert not hosts_file.parent.exists()

        trusted_hosts.record_first_contact("db1", 22, keys["ed25519"])

        assert sorted(hosts_file.parent.iterdir()) == [hosts_file]

    def test_concurrent_first_contacts_lose_no_entry(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        count = 12
        barrier = threading.Barrier(count)
        failures: list[Exception] = []

        def contact(index: int) -> None:
            try:
                barrier.wait()
                trusted_hosts.record_first_contact(f"host-{index}", 22, keys["ed25519"])
            except Exception as exc:
                failures.append(exc)

        threads = [threading.Thread(target=contact, args=(i,)) for i in range(count)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        assert failures == []
        hosts = trusted_hosts.load()["hosts"]
        assert sorted(entry["host"] for entry in hosts) == sorted(f"host-{i}" for i in range(count))

    def test_the_same_key_recorded_again_stays_one_entry_and_writes_nothing(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        trusted_hosts.record_first_contact("db1", 2222, keys["ed25519"])
        original = hosts_file.read_bytes()

        trusted_hosts.record_first_contact("db1", 2222, keys["ed25519"])

        assert hosts_file.read_bytes() == original
        assert len(trusted_hosts.load()["hosts"]) == 1

    def test_another_key_of_the_same_type_recorded_meanwhile_is_a_conflict(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        write_store(hosts_file, {"hosts": [stored("a" * 32, "db1", 22, keys["ed25519"])]})
        original = hosts_file.read_bytes()

        with pytest.raises(
            TrustedHostConflict,
            match=exact(
                "db1 port 22 already has a trusted ED25519 key; remove it before adding another"
            ),
        ):
            trusted_hosts.record_first_contact("db1", 22, keys["ed25519_other"])

        assert hosts_file.read_bytes() == original


class TestApplyChange:
    def test_takes_additions_and_removals_only(self) -> None:
        assert list(inspect.signature(trusted_hosts.apply_change).parameters) == ["add", "remove"]

    def test_additions_are_stored_as_new_entries(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        before = datetime.now(UTC)
        trusted_hosts.apply_change(
            [addition("db1", 22, keys["ed25519"]), addition("db2", 2222, keys["rsa"])], []
        )
        after = datetime.now(UTC)

        hosts = trusted_hosts.load()["hosts"]
        assert [(e["host"], e["port"], e["public_key"]) for e in hosts] == [
            ("db1", 22, openssh(keys["ed25519"])),
            ("db2", 2222, openssh(keys["rsa"])),
        ]
        for entry in hosts:
            assert set(entry) == HOST_FIELDS
            assert_new_id(entry["id"])
            assert_added_now(entry["added"], before, after)

    def test_returns_the_stored_hosts(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        result = trusted_hosts.apply_change([addition("db1", 22, keys["ed25519"])], [])

        assert result == trusted_hosts.load()
        assert set(result) == {"hosts"}
        assert [(e["host"], e["port"]) for e in result["hosts"]] == [("db1", 22)]

    def test_writes_the_hosts_and_nothing_else(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        result = trusted_hosts.apply_change([addition("db1", 22, keys["ed25519"])], [])

        assert on_disk(hosts_file) == {"hosts": result["hosts"]}

    def test_removals_apply_before_additions(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        write_store(hosts_file, {"hosts": [stored("a" * 32, "db1", 22, keys["ed25519"])]})

        trusted_hosts.apply_change([addition("db1", 22, keys["ed25519_other"])], ["a" * 32])

        hosts = trusted_hosts.load()["hosts"]
        assert [(e["host"], e["port"], e["public_key"]) for e in hosts] == [
            ("db1", 22, openssh(keys["ed25519_other"]))
        ]

    def test_removals_and_additions_land_together(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        kept = stored("b" * 32, "db2", 22, keys["rsa"])
        write_store(hosts_file, {"hosts": [stored("a" * 32, "db1", 22, keys["ed25519"]), kept]})

        trusted_hosts.apply_change([addition("db3", 22, keys["nistp256"])], ["a" * 32])

        store = trusted_hosts.load()
        assert set(store) == {"hosts"}
        assert store["hosts"][0] == kept
        assert [e["host"] for e in store["hosts"]] == ["db2", "db3"]

    def test_removing_a_missing_id_is_a_no_op(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        entry = stored("a" * 32, "db1", 22, keys["ed25519"])
        write_store(hosts_file, {"hosts": [entry]})

        result = trusted_hosts.apply_change([], ["f" * 32])

        assert result["hosts"] == [entry]
        assert trusted_hosts.load()["hosts"] == [entry]

    def test_re_adding_an_identical_entry_is_a_no_op(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        entry = stored("a" * 32, "db1", 22, keys["ed25519"])
        write_store(hosts_file, {"hosts": [entry]})

        trusted_hosts.apply_change([addition("db1", 22, keys["ed25519"])], [])

        assert trusted_hosts.load()["hosts"] == [entry]

    def test_identical_additions_in_one_request_store_one_entry(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        trusted_hosts.apply_change(
            [addition("db1", 22, keys["ed25519"]), addition("db1", 22, keys["ed25519"])], []
        )

        assert len(trusted_hosts.load()["hosts"]) == 1

    def test_same_host_on_another_port_is_its_own_entry(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        write_store(hosts_file, {"hosts": [stored("a" * 32, "db1", 22, keys["ed25519"])]})

        trusted_hosts.apply_change([addition("db1", 2222, keys["ed25519_other"])], [])

        assert [(e["host"], e["port"]) for e in trusted_hosts.load()["hosts"]] == [
            ("db1", 22),
            ("db1", 2222),
        ]

    def test_same_host_with_another_key_type_is_its_own_entry(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        write_store(hosts_file, {"hosts": [stored("a" * 32, "db1", 22, keys["ed25519"])]})

        trusted_hosts.apply_change(
            [addition("db1", 22, keys["rsa"]), addition("db1", 22, keys["nistp256"])], []
        )

        assert len(trusted_hosts.load()["hosts"]) == 3

    def test_conflict_with_a_kept_entry_writes_nothing(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        write_store(
            hosts_file,
            {
                "hosts": [
                    stored("a" * 32, "db1", 22, keys["ed25519"]),
                    stored("b" * 32, "db2", 22, keys["rsa"]),
                ]
            },
        )
        original = hosts_file.read_bytes()

        with pytest.raises(
            TrustedHostConflict,
            match=exact(
                "db1 port 22 already has a trusted ED25519 key; remove it before adding another"
            ),
        ):
            trusted_hosts.apply_change(
                [addition("db3", 22, keys["nistp256"]), addition("db1", 22, keys["ed25519_other"])],
                ["b" * 32],
            )

        assert hosts_file.read_bytes() == original
        assert sorted(hosts_file.parent.iterdir()) == [hosts_file]

    def test_conflict_with_an_earlier_addition_writes_nothing(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        write_store(hosts_file, {"hosts": [stored("b" * 32, "db2", 22, keys["rsa"])]})
        original = hosts_file.read_bytes()

        with pytest.raises(
            TrustedHostConflict,
            match=exact(
                "db1 port 22 already has a trusted ED25519 key; remove it before adding another"
            ),
        ):
            trusted_hosts.apply_change(
                [addition("db1", 22, keys["ed25519"]), addition("db1", 22, keys["ed25519_other"])],
                [],
            )

        assert hosts_file.read_bytes() == original

    def test_conflict_on_an_empty_store_creates_no_file(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        with pytest.raises(TrustedHostConflict):
            trusted_hosts.apply_change(
                [addition("db1", 22, keys["ed25519"]), addition("db1", 22, keys["ed25519_other"])],
                [],
            )

        assert not hosts_file.exists()

    @pytest.mark.parametrize(
        ("host", "port", "first", "second", "key_type"),
        [
            ("db2", 2222, "rsa", "rsa_other", "RSA"),
            ("db3", 22, "nistp256", "nistp384", "ECDSA"),
        ],
    )
    def test_conflict_message_names_host_port_and_key_type(
        self,
        hosts_file: Path,
        keys: dict[str, asyncssh.SSHKey],
        host: str,
        port: int,
        first: str,
        second: str,
        key_type: str,
    ) -> None:
        write_store(hosts_file, {"hosts": [stored("a" * 32, host, port, keys[first])]})

        with pytest.raises(
            TrustedHostConflict,
            match=exact(
                f"{host} port {port} already has a trusted {key_type} key; "
                "remove it before adding another"
            ),
        ):
            trusted_hosts.apply_change([addition(host, port, keys[second])], [])

    def test_a_change_set_is_one_write(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        write_store(hosts_file, {"hosts": [stored("a" * 32, "db1", 22, keys["ed25519"])]})
        targets: list[Path] = []
        real_replace = os.replace

        def counting_replace(src: Any, dst: Any, *args: Any, **kwargs: Any) -> None:
            targets.append(Path(dst))
            real_replace(src, dst, *args, **kwargs)

        monkeypatch.setattr(os, "replace", counting_replace)

        trusted_hosts.apply_change(
            [addition("db2", 22, keys["rsa"]), addition("db3", 22, keys["nistp256"])],
            ["a" * 32],
        )

        assert targets == [hosts_file]

    def test_writes_through_the_settings_file_helper(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        written: list[Path] = []
        real_write = settings_file.write

        def spy(path: Path, values: Any) -> None:
            written.append(Path(path))
            real_write(path, values)

        monkeypatch.setattr(settings_file, "write", spy)

        trusted_hosts.apply_change([addition("db1", 22, keys["ed25519"])], [])

        assert written == [hosts_file]

    def test_leaves_no_temp_file_beside_the_store(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        trusted_hosts.apply_change([addition("db1", 22, keys["ed25519"])], [])
        trusted_hosts.apply_change([addition("db2", 22, keys["rsa"])], [])

        assert sorted(hosts_file.parent.iterdir()) == [hosts_file]


class TestKeyFacts:
    @pytest.mark.parametrize(
        ("name", "key_type"),
        [
            ("ed25519", "ED25519"),
            ("nistp256", "ECDSA"),
            ("nistp384", "ECDSA"),
            ("nistp521", "ECDSA"),
            ("rsa", "RSA"),
        ],
    )
    def test_key_type_label(
        self, keys: dict[str, asyncssh.SSHKey], name: str, key_type: str
    ) -> None:
        assert trusted_hosts.key_type_label(keys[name]) == key_type

    @pytest.mark.parametrize("name", ["ed25519", "nistp384", "rsa"])
    def test_fingerprint_is_sha256_unpadded_base64(
        self, keys: dict[str, asyncssh.SSHKey], name: str
    ) -> None:
        key = keys[name]
        digest = hashlib.sha256(key.public_data).digest()

        fingerprint = trusted_hosts.fingerprint(key)

        assert fingerprint == "SHA256:" + base64.b64encode(digest).decode().rstrip("=")
        assert fingerprint == key.get_fingerprint("sha256")
        assert "=" not in fingerprint


class TestClearHosts:
    def test_returns_the_count_and_empties_the_hosts(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        write_store(
            hosts_file,
            {
                "hosts": [
                    stored("a" * 32, "db1", 22, keys["ed25519"]),
                    stored("b" * 32, "db2", 22, keys["rsa"]),
                    stored("c" * 32, "db3", 2222, keys["nistp256"]),
                ],
            },
        )

        assert trusted_hosts.clear_hosts() == 3
        assert trusted_hosts.load() == {"hosts": []}
        assert on_disk(hosts_file) == {"hosts": []}

    def test_empty_store_clears_nothing(self, hosts_file: Path) -> None:
        assert trusted_hosts.clear_hosts() == 0
        assert trusted_hosts.load()["hosts"] == []


class TestResetPolicy:
    def test_puts_the_default_policy_into_the_config_file_and_keeps_the_hosts(
        self,
        hosts_file: Path,
        keys: dict[str, asyncssh.SSHKey],
        load_config: Callable[..., Any],
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        load_config(ssh_section(LOCKED_STRICT))
        hosts = [stored("a" * 32, "db1", 22, keys["ed25519"])]
        write_store(hosts_file, {"hosts": hosts})
        original = hosts_file.read_bytes()

        assert trusted_hosts.reset_policy() is None

        assert trusted_hosts.policy() == DEFAULT_POLICY
        assert config_on_disk()["network"]["ssh_hosts"] == DEFAULT_POLICY
        assert hosts_file.read_bytes() == original
        assert trusted_hosts.load() == {"hosts": hosts}

    def test_the_default_policy_survives_a_restart(
        self, hosts_file: Path, load_config: Callable[..., Any]
    ) -> None:
        load_config(ssh_section(LOCKED_STRICT))

        trusted_hosts.reset_policy()
        load_config()

        assert trusted_hosts.policy() == DEFAULT_POLICY

    def test_writes_no_hosts_file(self, hosts_file: Path) -> None:
        trusted_hosts.reset_policy()

        assert not hosts_file.parent.exists()

    def test_a_read_only_config_file_refuses_and_keeps_the_policy(
        self, hosts_file: Path, load_config: Callable[..., Any], read_only_config: Path
    ) -> None:
        from wavecore.api.config.write_back import ConfigWriteError

        load_config(ssh_section(LOCKED_STRICT))
        original = read_only_config.read_bytes()

        with pytest.raises(ConfigWriteError, match=read_only(read_only_config)):
            trusted_hosts.reset_policy()

        assert read_only_config.read_bytes() == original
        assert trusted_hosts.policy() == LOCKED_STRICT


class TestRestoreEntries:
    @pytest.mark.parametrize("resolution", ["skip", "overwrite", "rename"])
    def test_new_entry_is_imported(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey], resolution: str
    ) -> None:
        existing = stored("a" * 32, "db1", 22, keys["ed25519"])
        write_store(hosts_file, {"hosts": [existing]})

        result = trusted_hosts.restore_entries(
            [stored("b" * 32, "db2", 2222, keys["rsa"])], resolution
        )

        assert result == {"imported": 1, "skipped": 0, "fatal": 0, "outcomes": ["imported"]}
        hosts = trusted_hosts.load()["hosts"]
        assert hosts[0] == existing
        assert [(e["host"], e["port"], e["public_key"]) for e in hosts[1:]] == [
            ("db2", 2222, openssh(keys["rsa"]))
        ]

    @pytest.mark.parametrize("resolution", ["skip", "rename"])
    def test_conflict_is_skipped(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey], resolution: str
    ) -> None:
        existing = stored("a" * 32, "db1", 22, keys["ed25519"])
        write_store(hosts_file, {"hosts": [existing]})

        result = trusted_hosts.restore_entries(
            [stored("b" * 32, "db1", 22, keys["ed25519_other"])], resolution
        )

        assert result == {"imported": 0, "skipped": 1, "fatal": 0, "outcomes": ["skipped"]}
        assert trusted_hosts.load()["hosts"] == [existing]

    def test_overwrite_replaces_the_key(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        write_store(
            hosts_file,
            {
                "hosts": [
                    stored("a" * 32, "db1", 22, keys["ed25519"]),
                    stored("c" * 32, "db1", 22, keys["rsa"]),
                ]
            },
        )

        result = trusted_hosts.restore_entries(
            [stored("b" * 32, "db1", 22, keys["ed25519_other"])], "overwrite"
        )

        assert result == {"imported": 1, "skipped": 0, "fatal": 0, "outcomes": ["imported"]}
        hosts = trusted_hosts.load()["hosts"]
        assert sorted((e["host"], e["port"], e["public_key"]) for e in hosts) == sorted(
            [
                ("db1", 22, openssh(keys["ed25519_other"])),
                ("db1", 22, openssh(keys["rsa"])),
            ]
        )

    def test_identical_entry_is_skipped(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        existing = stored("a" * 32, "db1", 22, keys["ed25519"])
        write_store(hosts_file, {"hosts": [existing]})

        result = trusted_hosts.restore_entries(
            [stored("b" * 32, "db1", 22, keys["ed25519"])], "skip"
        )

        assert result == {"imported": 0, "skipped": 1, "fatal": 0, "outcomes": ["skipped"]}
        assert trusted_hosts.load()["hosts"] == [existing]

    def test_counts_add_up_over_the_items(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        write_store(hosts_file, {"hosts": [stored("a" * 32, "db1", 22, keys["ed25519"])]})

        result = trusted_hosts.restore_entries(
            [
                stored("b" * 32, "db1", 22, keys["ed25519_other"]),
                stored("c" * 32, "db2", 22, keys["rsa"]),
                stored("d" * 32, "db3", 22, keys["nistp256"]),
            ],
            "skip",
        )

        assert result == {
            "imported": 2,
            "skipped": 1,
            "fatal": 0,
            "outcomes": ["skipped", "imported", "imported"],
        }
        assert [e["host"] for e in trusted_hosts.load()["hosts"]] == ["db1", "db2", "db3"]

    def test_the_result_holds_one_outcome_per_entry_in_input_order(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        write_store(hosts_file, {"hosts": [stored("a" * 32, "db1", 22, keys["ed25519"])]})
        broken = {**stored("c" * 32, "db2", 22, keys["rsa"]), "public_key": "ssh-rsa AAAAnotakey"}

        result = trusted_hosts.restore_entries(
            [
                stored("b" * 32, "db1", 22, keys["ed25519_other"]),
                broken,
                stored("d" * 32, "db3", 22, keys["rsa"]),
                stored("e" * 32, "db1", 22, keys["ed25519"]),
                stored("f" * 32, "db4", 2222, keys["nistp256"]),
            ],
            "skip",
        )

        outcomes = ["skipped", "fatal", "imported", "skipped", "imported"]
        assert result == {"imported": 2, "skipped": 2, "fatal": 1, "outcomes": outcomes}

    @pytest.mark.parametrize(
        ("resolution", "other_key_outcome", "counts", "db1_key"),
        [
            ("skip", "skipped", {"imported": 3, "skipped": 2, "fatal": 1}, "ed25519"),
            ("overwrite", "imported", {"imported": 4, "skipped": 1, "fatal": 1}, "ed25519_other"),
            ("rename", "skipped", {"imported": 3, "skipped": 2, "fatal": 1}, "ed25519"),
        ],
        ids=["skip", "overwrite", "rename"],
    )
    def test_the_conflict_rules_are_unchanged(
        self,
        hosts_file: Path,
        keys: dict[str, asyncssh.SSHKey],
        resolution: str,
        other_key_outcome: str,
        counts: dict[str, int],
        db1_key: str,
    ) -> None:
        write_store(hosts_file, {"hosts": [stored("a" * 32, "db1", 22, keys["ed25519"])]})
        broken = {**stored("g" * 32, "db3", 22, keys["rsa"]), "public_key": "ssh-rsa AAAAnotakey"}

        result = trusted_hosts.restore_entries(
            [
                stored("b" * 32, "db1", 22, keys["ed25519"]),
                stored("c" * 32, "db1", 22, keys["ed25519_other"]),
                stored("d" * 32, "db1", 22, keys["rsa"]),
                stored("e" * 32, "db1", 2222, keys["ed25519_other"]),
                stored("f" * 32, "db2", 22, keys["ed25519_other"]),
                broken,
            ],
            resolution,
        )

        assert result == {
            **counts,
            "outcomes": ["skipped", other_key_outcome, "imported", "imported", "imported", "fatal"],
        }
        hosts = trusted_hosts.load()["hosts"]
        assert sorted((e["host"], e["port"], e["public_key"]) for e in hosts) == sorted(
            [
                ("db1", 22, openssh(keys[db1_key])),
                ("db1", 22, openssh(keys["rsa"])),
                ("db1", 2222, openssh(keys["ed25519_other"])),
                ("db2", 22, openssh(keys["ed25519_other"])),
            ]
        )

    def test_unreadable_key_is_fatal_and_not_stored(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        existing = stored("a" * 32, "db1", 22, keys["ed25519"])
        write_store(hosts_file, {"hosts": [existing]})
        broken = {**stored("b" * 32, "db2", 22, keys["rsa"]), "public_key": "ssh-rsa AAAAnotakey"}

        result = trusted_hosts.restore_entries([broken], "skip")

        assert result == {"imported": 0, "skipped": 0, "fatal": 1, "outcomes": ["fatal"]}
        assert trusted_hosts.load()["hosts"] == [existing]

    def test_a_key_type_the_list_cannot_hold_is_fatal_and_not_stored(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        existing = stored("a" * 32, "db1", 22, keys["ed25519"])
        write_store(hosts_file, {"hosts": [existing]})
        ed448 = stored("b" * 32, "db2", 22, _public("ssh-ed448"))

        result = trusted_hosts.restore_entries([ed448], "overwrite")

        assert result == {"imported": 0, "skipped": 0, "fatal": 1, "outcomes": ["fatal"]}
        assert trusted_hosts.load()["hosts"] == [existing]

    def test_writes_the_hosts_and_nothing_else(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        trusted_hosts.restore_entries([stored("b" * 32, "db2", 22, keys["rsa"])], "overwrite")

        written = on_disk(hosts_file)
        assert set(written) == {"hosts"}
        assert [(e["host"], e["port"], e["public_key"]) for e in written["hosts"]] == [
            ("db2", 22, openssh(keys["rsa"]))
        ]
