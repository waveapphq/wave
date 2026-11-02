"""SSH Hosts page service: view, policy, change set, parse and placement defaults (REQ-4.5.14)."""

import logging
import re
from collections.abc import Callable
from pathlib import Path
from typing import Any

import asyncssh
import pytest
import yaml

from wavecore.api.exceptions import (
    ConflictException,
    InternalServerException,
    ValidationException,
)
from wavecore.api.services import settings_file, storage_paths
from wavecore.api.services.network import ssh_hosts
from wavecore.core.ssh import trusted_hosts
from wavecore.core.ssh.trusted_hosts import TrustedHostsUnreadable

DEFAULT_POLICY = {"lock_trusted_hosts": False, "default_block_action": "disabled"}
LOCKED_STRICT = {"lock_trusted_hosts": True, "default_block_action": "strict"}
LOCKED_DISABLED = {"lock_trusted_hosts": True, "default_block_action": "disabled"}
UNLOCKED_STRICT = {"lock_trusted_hosts": False, "default_block_action": "strict"}
BROKEN_YAML = "hosts: [unclosed\n"
CONFLICT_MESSAGE = "db1 port 22 already has a trusted ED25519 key; remove it before adding another"
ROW_FIELDS = {"id", "host", "port", "key_type", "fingerprint", "added"}
LABELS = {
    "ssh-ed25519": "ED25519",
    "ecdsa-sha2-nistp256": "ECDSA",
    "ecdsa-sha2-nistp384": "ECDSA",
    "ecdsa-sha2-nistp521": "ECDSA",
    "ssh-rsa": "RSA",
}
SEEDED_AT = "2026-09-01T08:00:00Z"
LOCK_MESSAGE = "Lock trusted hosts must be true or false"
ACTION_MESSAGE = "Default block action must be 'strict', 'accept-new' or 'disabled'"
LOCKED_ACCEPT_NEW = "Default block action cannot be 'accept-new' while trusted hosts are locked"
HASHED_NAME = "|1|JfKTdBh7rNbXkVAQCRp4OQoPfmI=|USECr3SWf1JUPsms5AqfD5QfxkM="


def exact(message: str) -> str:
    return f"^{re.escape(message)}$"


def read_only(path: Path) -> str:
    return exact(f"Settings cannot be saved: the config file {path} is read-only")


def unreadable(path: Path) -> str:
    return "^" + re.escape(f"WAVE's trusted SSH hosts list {path} cannot be read: ") + ".+$"


def logged_warnings(caplog: pytest.LogCaptureFixture) -> list[str]:
    return [
        record.getMessage()
        for record in caplog.records
        if record.name == ssh_hosts.__name__ and record.levelno == logging.WARNING
    ]


def _public(algorithm: str, **options: Any) -> asyncssh.SSHKey:
    return asyncssh.generate_private_key(algorithm, **options).convert_to_public()


def openssh(key: asyncssh.SSHKey) -> str:
    return key.export_public_key("openssh").decode().strip()


def label(key: asyncssh.SSHKey) -> str:
    return LABELS[key.get_algorithm()]


def addition(host: str, port: Any, key: asyncssh.SSHKey) -> dict[str, Any]:
    return {"host": host, "port": port, "key_type": label(key), "key": openssh(key)}


def stored(entry_id: str, host: str, port: Any, key: asyncssh.SSHKey) -> dict[str, Any]:
    return {
        "id": entry_id,
        "host": host,
        "port": port,
        "public_key": openssh(key),
        "added": SEEDED_AT,
    }


def row(entry_id: str, host: str, port: int, key: asyncssh.SSHKey) -> dict[str, Any]:
    return {
        "id": entry_id,
        "host": host,
        "port": port,
        "key_type": label(key),
        "fingerprint": key.get_fingerprint("sha256"),
        "added": SEEDED_AT,
    }


def write_store(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")


def on_disk(path: Path) -> dict[str, Any]:
    return dict(yaml.safe_load(path.read_text(encoding="utf-8")))


@pytest.fixture(scope="module")
def keys() -> dict[str, asyncssh.SSHKey]:
    return {
        "ed25519": _public("ssh-ed25519"),
        "ed25519_other": _public("ssh-ed25519"),
        "nistp256": _public("ecdsa-sha2-nistp256"),
        "rsa": _public("ssh-rsa", key_size=1024),
    }


@pytest.fixture
def hosts_file(tmp_path: Path) -> Path:
    storage_paths.set_base_path(tmp_path)
    return tmp_path / "network" / "ssh_hosts.yaml"


@pytest.fixture
def seed_policy(load_config: Callable[..., Any]) -> Callable[[bool, str], None]:
    """Start WAVE on a config file that holds this host key policy."""

    def _seed(lock: bool, action: str) -> None:
        load_config(
            {"network": {"ssh_hosts": {"lock_trusted_hosts": lock, "default_block_action": action}}}
        )

    return _seed


@pytest.fixture
def saved_policy(config_on_disk: Callable[[], dict[str, Any]]) -> Callable[[], dict[str, Any]]:
    """The host key policy as the config file holds it right now."""

    def _read() -> dict[str, Any]:
        return dict(config_on_disk()["network"]["ssh_hosts"])

    return _read


@pytest.fixture
def failing_hosts_write(hosts_file: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Make every write of the hosts file fail as a full disk does."""
    real_write = settings_file.write

    def failing_write(path: Path, values: Any) -> None:
        if Path(path) == hosts_file:
            raise OSError("No space left on device")
        real_write(path, values)

    monkeypatch.setattr(settings_file, "write", failing_write)


@pytest.fixture
def policy_saved_before_the_config_turned_read_only(
    request: pytest.FixtureRequest,
    monkeypatch: pytest.MonkeyPatch,
    saved_policy: Callable[[], dict[str, Any]],
) -> list[dict[str, Any]]:
    """Make the config file read-only at the hosts step; holds the policy saved by then."""
    seen: list[dict[str, Any]] = []
    real_apply_change = trusted_hosts.apply_change

    def apply_change(*args: Any, **kwargs: Any) -> Any:
        seen.append(saved_policy())
        request.getfixturevalue("read_only_config")
        return real_apply_change(*args, **kwargs)

    monkeypatch.setattr(trusted_hosts, "apply_change", apply_change)
    return seen


class TestGetPolicy:
    def test_defaults(self, hosts_file: Path) -> None:
        assert ssh_hosts.get_policy() == DEFAULT_POLICY

    def test_saved_policy(self, hosts_file: Path, seed_policy: Callable[[bool, str], None]) -> None:
        seed_policy(True, "disabled")

        assert ssh_hosts.get_policy() == LOCKED_DISABLED

    def test_a_policy_left_in_the_data_file_is_ignored(self, hosts_file: Path) -> None:
        write_store(hosts_file, {"policy": LOCKED_STRICT, "hosts": []})

        assert ssh_hosts.get_policy() == DEFAULT_POLICY

    def test_is_read_without_the_data_file(
        self, hosts_file: Path, seed_policy: Callable[[bool, str], None]
    ) -> None:
        seed_policy(True, "strict")
        hosts_file.parent.mkdir(parents=True)
        hosts_file.write_text(BROKEN_YAML, encoding="utf-8")

        assert ssh_hosts.get_policy() == LOCKED_STRICT
        assert hosts_file.read_text(encoding="utf-8") == BROKEN_YAML


class TestGetView:
    def test_empty_store(self, hosts_file: Path) -> None:
        assert ssh_hosts.get_view() == {"policy": DEFAULT_POLICY, "hosts": []}

    def test_a_policy_left_in_the_data_file_is_ignored(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        write_store(
            hosts_file,
            {"policy": LOCKED_STRICT, "hosts": [stored("a" * 32, "db1", 22, keys["ed25519"])]},
        )

        assert ssh_hosts.get_view() == {
            "policy": DEFAULT_POLICY,
            "hosts": [row("a" * 32, "db1", 22, keys["ed25519"])],
        }

    def test_rows_carry_label_and_fingerprint_and_no_raw_key(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        write_store(hosts_file, {"hosts": [stored("a" * 32, "db1", 22, keys["ed25519"])]})

        hosts = ssh_hosts.get_view()["hosts"]

        assert hosts == [row("a" * 32, "db1", 22, keys["ed25519"])]
        assert set(hosts[0]) == ROW_FIELDS
        assert hosts[0]["key_type"] == "ED25519"
        assert hosts[0]["fingerprint"].startswith("SHA256:")

    def test_rows_are_ordered_by_host_then_port_then_key_type(
        self,
        hosts_file: Path,
        keys: dict[str, asyncssh.SSHKey],
        seed_policy: Callable[[bool, str], None],
    ) -> None:
        seed_policy(True, "strict")
        write_store(
            hosts_file,
            {
                "hosts": [
                    stored("1" * 32, "db2", 22, keys["ed25519"]),
                    stored("2" * 32, "db1", 2222, keys["rsa"]),
                    stored("3" * 32, "db1", 22, keys["rsa"]),
                    stored("4" * 32, "db1", 822, keys["ed25519"]),
                    stored("5" * 32, "db1", 22, keys["ed25519"]),
                    stored("6" * 32, "db1", 22, keys["nistp256"]),
                    stored("7" * 32, "app", 22, keys["ed25519"]),
                ],
            },
        )

        view = ssh_hosts.get_view()

        assert view["policy"] == {"lock_trusted_hosts": True, "default_block_action": "strict"}
        assert [(r["host"], r["port"], r["key_type"]) for r in view["hosts"]] == [
            ("app", 22, "ED25519"),
            ("db1", 22, "ECDSA"),
            ("db1", 22, "ED25519"),
            ("db1", 22, "RSA"),
            ("db1", 822, "ED25519"),
            ("db1", 2222, "RSA"),
            ("db2", 22, "ED25519"),
        ]


class TestPolicyValidation:
    @pytest.mark.parametrize("value", ["yes", "true", 1, 0])
    def test_lock_must_be_a_boolean(self, hosts_file: Path, value: Any) -> None:
        with pytest.raises(ValidationException, match=exact(LOCK_MESSAGE)):
            ssh_hosts.apply_changes({"lock_trusted_hosts": value}, [], [])

    @pytest.mark.parametrize("value", ["lenient", "Strict", "accept_new", 2, True])
    def test_default_action_must_be_one_of_three(self, hosts_file: Path, value: Any) -> None:
        with pytest.raises(ValidationException, match=exact(ACTION_MESSAGE)):
            ssh_hosts.apply_changes({"default_block_action": value}, [], [])

    def test_explicit_accept_new_while_turning_lock_on(self, hosts_file: Path) -> None:
        with pytest.raises(ValidationException, match=exact(LOCKED_ACCEPT_NEW)):
            ssh_hosts.apply_changes(
                {"lock_trusted_hosts": True, "default_block_action": "accept-new"}, [], []
            )

    def test_explicit_accept_new_while_the_saved_lock_is_on(
        self, hosts_file: Path, seed_policy: Callable[[bool, str], None]
    ) -> None:
        seed_policy(True, "strict")

        with pytest.raises(ValidationException, match=exact(LOCKED_ACCEPT_NEW)):
            ssh_hosts.apply_changes({"default_block_action": "accept-new"}, [], [])


class TestPolicyChanges:
    def test_lock_on_alone_turns_accept_new_into_strict(
        self,
        hosts_file: Path,
        seed_policy: Callable[[bool, str], None],
        saved_policy: Callable[[], dict[str, Any]],
    ) -> None:
        seed_policy(False, "accept-new")

        view = ssh_hosts.apply_changes({"lock_trusted_hosts": True}, [], [])

        assert view["policy"] == LOCKED_STRICT
        assert saved_policy() == LOCKED_STRICT

    def test_lock_on_alone_keeps_disabled(
        self, hosts_file: Path, seed_policy: Callable[[bool, str], None]
    ) -> None:
        seed_policy(False, "disabled")

        view = ssh_hosts.apply_changes({"lock_trusted_hosts": True}, [], [])

        assert view["policy"] == LOCKED_DISABLED

    def test_lock_on_with_strict(self, hosts_file: Path) -> None:
        view = ssh_hosts.apply_changes(
            {"lock_trusted_hosts": True, "default_block_action": "strict"}, [], []
        )

        assert view["policy"] == {"lock_trusted_hosts": True, "default_block_action": "strict"}

    def test_lock_on_with_disabled(self, hosts_file: Path) -> None:
        view = ssh_hosts.apply_changes(
            {"lock_trusted_hosts": True, "default_block_action": "disabled"}, [], []
        )

        assert view["policy"] == {"lock_trusted_hosts": True, "default_block_action": "disabled"}

    def test_disabled_while_the_saved_lock_is_on(
        self, hosts_file: Path, seed_policy: Callable[[bool, str], None]
    ) -> None:
        seed_policy(True, "strict")

        view = ssh_hosts.apply_changes({"default_block_action": "disabled"}, [], [])

        assert view["policy"] == LOCKED_DISABLED

    def test_accept_new_with_lock_turned_off_in_the_same_request(
        self, hosts_file: Path, seed_policy: Callable[[bool, str], None]
    ) -> None:
        seed_policy(True, "strict")

        view = ssh_hosts.apply_changes(
            {"lock_trusted_hosts": False, "default_block_action": "accept-new"}, [], []
        )

        assert view["policy"] == {"lock_trusted_hosts": False, "default_block_action": "accept-new"}
        assert ssh_hosts.get_policy() == view["policy"]

    def test_lock_off_keeps_the_default_action(
        self, hosts_file: Path, seed_policy: Callable[[bool, str], None]
    ) -> None:
        seed_policy(True, "strict")

        view = ssh_hosts.apply_changes({"lock_trusted_hosts": False}, [], [])

        assert view["policy"] == UNLOCKED_STRICT

    @pytest.mark.parametrize("policy", [None, {}])
    def test_no_policy_fields_keep_the_policy(
        self,
        hosts_file: Path,
        seed_policy: Callable[[bool, str], None],
        config_file: Path,
        policy: dict[str, Any] | None,
    ) -> None:
        seed_policy(True, "disabled")
        original = config_file.read_bytes()

        view = ssh_hosts.apply_changes(policy, [], [])

        assert view["policy"] == LOCKED_DISABLED
        assert config_file.read_bytes() == original

    def test_omitted_lock_is_unchanged(self, hosts_file: Path) -> None:
        view = ssh_hosts.apply_changes({"default_block_action": "disabled"}, [], [])

        assert view["policy"] == {"lock_trusted_hosts": False, "default_block_action": "disabled"}

    def test_omitted_default_action_is_unchanged(
        self, hosts_file: Path, seed_policy: Callable[[bool, str], None]
    ) -> None:
        seed_policy(False, "strict")

        view = ssh_hosts.apply_changes({"lock_trusted_hosts": False}, [], [])

        assert view["policy"] == UNLOCKED_STRICT


class TestHostChanges:
    def test_additions_and_removals_return_the_view_after_the_write(
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

        view = ssh_hosts.apply_changes(None, [addition("db3", 2222, keys["nistp256"])], ["a" * 32])

        assert view == ssh_hosts.get_view()
        assert [(r["host"], r["port"], r["key_type"]) for r in view["hosts"]] == [
            ("db2", 22, "RSA"),
            ("db3", 2222, "ECDSA"),
        ]
        added = view["hosts"][1]
        assert set(added) == ROW_FIELDS
        assert added["fingerprint"] == keys["nistp256"].get_fingerprint("sha256")

    def test_additions_are_accepted_while_locked(
        self,
        hosts_file: Path,
        keys: dict[str, asyncssh.SSHKey],
        seed_policy: Callable[[bool, str], None],
    ) -> None:
        seed_policy(True, "strict")

        view = ssh_hosts.apply_changes(None, [addition("db1", 22, keys["ed25519"])], [])

        assert [r["host"] for r in view["hosts"]] == ["db1"]
        assert view["policy"] == LOCKED_STRICT

    def test_additions_are_accepted_while_turning_lock_on(
        self,
        hosts_file: Path,
        keys: dict[str, asyncssh.SSHKey],
        seed_policy: Callable[[bool, str], None],
    ) -> None:
        seed_policy(False, "accept-new")

        view = ssh_hosts.apply_changes(
            {"lock_trusted_hosts": True}, [addition("db1", 22, keys["ed25519"])], []
        )

        assert [r["host"] for r in view["hosts"]] == ["db1"]
        assert view["policy"] == LOCKED_STRICT
        assert ssh_hosts.get_policy() == LOCKED_STRICT

    def test_additions_are_numbered_from_one(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        bad = {**addition("db2", 22, keys["rsa"]), "host": ""}

        with pytest.raises(ValidationException, match=exact("Addition 2: host is required")):
            ssh_hosts.apply_changes(None, [addition("db1", 22, keys["ed25519"]), bad], [])

    @pytest.mark.parametrize(
        ("change", "message"),
        [
            (
                lambda k: {"host": HASHED_NAME},
                "Addition 1: hashed host name, run ssh-keyscan without -H and paste again",
            ),
            (lambda k: {"host": "*.lab"}, "Addition 1: wildcard host patterns are not supported"),
            (lambda k: {"port": 65536}, "Addition 1: port must be from 1 to 65535"),
            (lambda k: {"key_type": "DSA"}, "Addition 1: unsupported key type DSA"),
            (lambda k: {"key": "ssh-ed25519 AAAAnotakey"}, "Addition 1: unreadable key"),
            (
                lambda k: {"key_type": "RSA"},
                "Addition 1: key type RSA does not match the key",
            ),
        ],
        ids=["hashed", "wildcard", "port", "key-type", "unreadable", "mismatch"],
    )
    def test_addition_checks(
        self,
        hosts_file: Path,
        keys: dict[str, asyncssh.SSHKey],
        change: Callable[[dict[str, asyncssh.SSHKey]], dict[str, Any]],
        message: str,
    ) -> None:
        entry = {**addition("db1", 22, keys["ed25519"]), **change(keys)}

        with pytest.raises(ValidationException, match=exact(message)):
            ssh_hosts.apply_changes(None, [entry], [])

    @pytest.mark.parametrize(
        ("request_body", "message"),
        [
            (
                lambda k: (
                    {"lock_trusted_hosts": "yes"},
                    [addition("db3", 22, k["rsa"])],
                    ["a" * 32],
                ),
                LOCK_MESSAGE,
            ),
            (
                lambda k: (
                    {"default_block_action": "accept-new"},
                    [addition("db3", 22, k["rsa"])],
                    ["a" * 32],
                ),
                LOCKED_ACCEPT_NEW,
            ),
            (
                lambda k: (
                    {"default_block_action": "disabled"},
                    [addition("db3", 22, k["rsa"]), {**addition("db4", 22, k["rsa"]), "key": "x"}],
                    ["a" * 32],
                ),
                "Addition 2: unreadable key",
            ),
        ],
        ids=["bad-lock", "accept-new-under-lock", "bad-second-addition"],
    )
    def test_a_refused_request_leaves_both_files_unchanged(
        self,
        hosts_file: Path,
        keys: dict[str, asyncssh.SSHKey],
        seed_policy: Callable[[bool, str], None],
        config_file: Path,
        request_body: Callable[[dict[str, asyncssh.SSHKey]], tuple[Any, Any, Any]],
        message: str,
    ) -> None:
        seed_policy(True, "strict")
        write_store(hosts_file, {"hosts": [stored("a" * 32, "db1", 22, keys["ed25519"])]})
        original = hosts_file.read_bytes()
        original_config = config_file.read_bytes()

        with pytest.raises(ValidationException, match=exact(message)):
            ssh_hosts.apply_changes(*request_body(keys))

        assert hosts_file.read_bytes() == original
        assert sorted(hosts_file.parent.iterdir()) == [hosts_file]
        assert config_file.read_bytes() == original_config
        assert ssh_hosts.get_policy() == LOCKED_STRICT

    def test_conflict_with_a_kept_entry_is_409_and_writes_nothing(
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
            ConflictException,
            match=exact(
                "db1 port 22 already has a trusted ED25519 key; remove it before adding another"
            ),
        ):
            ssh_hosts.apply_changes(
                {"default_block_action": "disabled"},
                [addition("db1", 22, keys["ed25519_other"])],
                ["b" * 32],
            )

        assert hosts_file.read_bytes() == original

    def test_conflict_with_an_earlier_addition_is_409_and_writes_nothing(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        write_store(hosts_file, {"hosts": [stored("b" * 32, "db2", 22, keys["rsa"])]})
        original = hosts_file.read_bytes()

        with pytest.raises(
            ConflictException,
            match=exact(
                "db1 port 22 already has a trusted ED25519 key; remove it before adding another"
            ),
        ):
            ssh_hosts.apply_changes(
                None,
                [addition("db1", 22, keys["ed25519"]), addition("db1", 22, keys["ed25519_other"])],
                [],
            )

        assert hosts_file.read_bytes() == original

    def test_removing_the_old_key_lets_the_new_one_in(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        write_store(hosts_file, {"hosts": [stored("a" * 32, "db1", 22, keys["ed25519"])]})

        view = ssh_hosts.apply_changes(
            None, [addition("db1", 22, keys["ed25519_other"])], ["a" * 32]
        )

        assert [r["fingerprint"] for r in view["hosts"]] == [
            keys["ed25519_other"].get_fingerprint("sha256")
        ]

    def test_removing_a_missing_id_and_re_adding_a_trusted_key_are_no_ops(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        write_store(hosts_file, {"hosts": [stored("a" * 32, "db1", 22, keys["ed25519"])]})

        view = ssh_hosts.apply_changes(None, [addition("db1", 22, keys["ed25519"])], ["f" * 32])

        assert view["hosts"] == [row("a" * 32, "db1", 22, keys["ed25519"])]


class TestTwoStoreSave:
    def test_the_policy_goes_to_the_config_file_and_the_host_to_the_data_file(
        self,
        hosts_file: Path,
        keys: dict[str, asyncssh.SSHKey],
        saved_policy: Callable[[], dict[str, Any]],
    ) -> None:
        view = ssh_hosts.apply_changes(LOCKED_STRICT, [addition("db1", 22, keys["ed25519"])], [])

        assert saved_policy() == LOCKED_STRICT
        written = on_disk(hosts_file)
        assert set(written) == {"hosts"}
        assert [(e["host"], e["port"], e["public_key"]) for e in written["hosts"]] == [
            ("db1", 22, openssh(keys["ed25519"]))
        ]
        assert view["policy"] == LOCKED_STRICT
        assert [(r["host"], r["port"], r["key_type"]) for r in view["hosts"]] == [
            ("db1", 22, "ED25519")
        ]
        assert view == ssh_hosts.get_view()

    def test_a_saved_policy_survives_a_restart_through_the_config_file_alone(
        self, hosts_file: Path, load_config: Callable[..., Any]
    ) -> None:
        ssh_hosts.apply_changes(LOCKED_STRICT, [], [])

        load_config()

        assert not hosts_file.parent.exists()
        assert ssh_hosts.get_policy() == LOCKED_STRICT

    def test_the_config_file_is_written_before_the_data_file(
        self,
        hosts_file: Path,
        keys: dict[str, asyncssh.SSHKey],
        config_on_disk: Callable[[], dict[str, Any]],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        config_at_the_hosts_write: list[Any] = []
        real_write = settings_file.write

        def spy(path: Path, values: Any) -> None:
            if Path(path) == hosts_file:
                config_at_the_hosts_write.append(config_on_disk().get("network"))
            real_write(path, values)

        monkeypatch.setattr(settings_file, "write", spy)

        ssh_hosts.apply_changes(LOCKED_STRICT, [addition("db1", 22, keys["ed25519"])], [])

        assert config_at_the_hosts_write == [{"ssh_hosts": LOCKED_STRICT}]

    def test_a_policy_only_change_writes_no_data_file(
        self, hosts_file: Path, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        view = ssh_hosts.apply_changes({"default_block_action": "strict"}, [], [])

        assert view == {"policy": UNLOCKED_STRICT, "hosts": []}
        assert config_on_disk()["network"]["ssh_hosts"]["default_block_action"] == "strict"
        assert not hosts_file.parent.exists()

    def test_a_policy_only_change_leaves_an_existing_data_file_untouched(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        write_store(
            hosts_file,
            {"policy": LOCKED_STRICT, "hosts": [stored("a" * 32, "db1", 22, keys["ed25519"])]},
        )
        original = hosts_file.read_bytes()

        view = ssh_hosts.apply_changes({"default_block_action": "strict"}, [], [])

        assert view["policy"] == UNLOCKED_STRICT
        assert hosts_file.read_bytes() == original
        assert sorted(hosts_file.parent.iterdir()) == [hosts_file]

    def test_a_hosts_only_change_writes_no_config(
        self,
        hosts_file: Path,
        keys: dict[str, asyncssh.SSHKey],
        seed_policy: Callable[[bool, str], None],
        config_file: Path,
    ) -> None:
        seed_policy(True, "strict")
        original = config_file.read_bytes()

        view = ssh_hosts.apply_changes(None, [addition("db1", 22, keys["ed25519"])], [])

        assert config_file.read_bytes() == original
        assert view["policy"] == LOCKED_STRICT
        assert set(on_disk(hosts_file)) == {"hosts"}

    def test_a_policy_left_in_the_data_file_is_dropped_by_the_next_hosts_write(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        write_store(
            hosts_file,
            {"policy": LOCKED_STRICT, "hosts": [stored("a" * 32, "db1", 22, keys["ed25519"])]},
        )

        view = ssh_hosts.apply_changes(None, [addition("db2", 22, keys["rsa"])], [])

        assert view["policy"] == DEFAULT_POLICY
        written = on_disk(hosts_file)
        assert set(written) == {"hosts"}
        assert [e["host"] for e in written["hosts"]] == ["db1", "db2"]

    def test_a_conflict_puts_the_previous_policy_back(
        self,
        hosts_file: Path,
        keys: dict[str, asyncssh.SSHKey],
        seed_policy: Callable[[bool, str], None],
        saved_policy: Callable[[], dict[str, Any]],
        load_config: Callable[..., Any],
    ) -> None:
        seed_policy(False, "strict")
        write_store(hosts_file, {"hosts": [stored("a" * 32, "db1", 22, keys["ed25519"])]})
        original = hosts_file.read_bytes()

        with pytest.raises(ConflictException, match=exact(CONFLICT_MESSAGE)):
            ssh_hosts.apply_changes(
                LOCKED_DISABLED, [addition("db1", 22, keys["ed25519_other"])], []
            )

        assert ssh_hosts.get_policy() == UNLOCKED_STRICT
        assert saved_policy() == UNLOCKED_STRICT
        assert hosts_file.read_bytes() == original
        assert sorted(hosts_file.parent.iterdir()) == [hosts_file]
        load_config()
        assert ssh_hosts.get_policy() == UNLOCKED_STRICT

    def test_a_failed_hosts_write_puts_the_previous_policy_back_and_raises(
        self,
        hosts_file: Path,
        keys: dict[str, asyncssh.SSHKey],
        seed_policy: Callable[[bool, str], None],
        saved_policy: Callable[[], dict[str, Any]],
        load_config: Callable[..., Any],
        failing_hosts_write: None,
    ) -> None:
        seed_policy(False, "strict")

        with pytest.raises(OSError, match=exact("No space left on device")):
            ssh_hosts.apply_changes(LOCKED_DISABLED, [addition("db1", 22, keys["ed25519"])], [])

        assert ssh_hosts.get_policy() == UNLOCKED_STRICT
        assert saved_policy() == UNLOCKED_STRICT
        assert not hosts_file.exists()
        load_config()
        assert ssh_hosts.get_policy() == UNLOCKED_STRICT

    @pytest.mark.parametrize(
        "with_addition", [True, False], ids=["policy-and-addition", "policy-alone"]
    )
    def test_an_unreadable_hosts_file_refuses_and_keeps_the_previous_policy(
        self,
        hosts_file: Path,
        keys: dict[str, asyncssh.SSHKey],
        seed_policy: Callable[[bool, str], None],
        saved_policy: Callable[[], dict[str, Any]],
        load_config: Callable[..., Any],
        with_addition: bool,
    ) -> None:
        seed_policy(False, "strict")
        hosts_file.parent.mkdir(parents=True)
        hosts_file.write_text(BROKEN_YAML, encoding="utf-8")
        add = [addition("db1", 22, keys["ed25519"])] if with_addition else []

        with pytest.raises(
            (TrustedHostsUnreadable, InternalServerException), match=unreadable(hosts_file)
        ):
            ssh_hosts.apply_changes(LOCKED_DISABLED, add, [])

        assert ssh_hosts.get_policy() == UNLOCKED_STRICT
        assert saved_policy() == UNLOCKED_STRICT
        assert hosts_file.read_text(encoding="utf-8") == BROKEN_YAML
        assert sorted(hosts_file.parent.iterdir()) == [hosts_file]
        load_config()
        assert ssh_hosts.get_policy() == UNLOCKED_STRICT

    def test_a_conflict_is_still_raised_when_the_previous_policy_cannot_be_put_back(
        self,
        hosts_file: Path,
        keys: dict[str, asyncssh.SSHKey],
        seed_policy: Callable[[bool, str], None],
        policy_saved_before_the_config_turned_read_only: list[dict[str, Any]],
    ) -> None:
        seed_policy(False, "strict")
        write_store(hosts_file, {"hosts": [stored("a" * 32, "db1", 22, keys["ed25519"])]})
        original = hosts_file.read_bytes()

        with pytest.raises(ConflictException, match=exact(CONFLICT_MESSAGE)):
            ssh_hosts.apply_changes(
                LOCKED_DISABLED, [addition("db1", 22, keys["ed25519_other"])], []
            )

        assert policy_saved_before_the_config_turned_read_only == [LOCKED_DISABLED]
        assert hosts_file.read_bytes() == original

    def test_a_failed_hosts_write_is_still_raised_when_the_previous_policy_cannot_be_put_back(
        self,
        hosts_file: Path,
        keys: dict[str, asyncssh.SSHKey],
        seed_policy: Callable[[bool, str], None],
        failing_hosts_write: None,
        policy_saved_before_the_config_turned_read_only: list[dict[str, Any]],
    ) -> None:
        seed_policy(False, "strict")

        with pytest.raises(OSError, match=exact("No space left on device")):
            ssh_hosts.apply_changes(LOCKED_DISABLED, [addition("db1", 22, keys["ed25519"])], [])

        assert policy_saved_before_the_config_turned_read_only == [LOCKED_DISABLED]
        assert not hosts_file.exists()

    def test_a_policy_that_cannot_be_put_back_is_logged_as_one_warning(
        self,
        hosts_file: Path,
        keys: dict[str, asyncssh.SSHKey],
        seed_policy: Callable[[bool, str], None],
        saved_policy: Callable[[], dict[str, Any]],
        config_file: Path,
        failing_hosts_write: None,
        policy_saved_before_the_config_turned_read_only: list[dict[str, Any]],
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        seed_policy(False, "strict")

        with (
            caplog.at_level(logging.WARNING, logger=ssh_hosts.__name__),
            pytest.raises(OSError, match=exact("No space left on device")),
        ):
            ssh_hosts.apply_changes(LOCKED_DISABLED, [addition("db1", 22, keys["ed25519"])], [])

        assert logged_warnings(caplog) == [
            "SSH host policy could not be put back after a failed Save; "
            "the config file keeps the new values: "
            f"Settings cannot be saved: the config file {config_file} is read-only"
        ]
        assert saved_policy() == LOCKED_DISABLED
        assert ssh_hosts.get_policy() == LOCKED_DISABLED

    def test_a_policy_that_is_put_back_logs_no_warning(
        self,
        hosts_file: Path,
        keys: dict[str, asyncssh.SSHKey],
        seed_policy: Callable[[bool, str], None],
        saved_policy: Callable[[], dict[str, Any]],
        failing_hosts_write: None,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        seed_policy(False, "strict")

        with (
            caplog.at_level(logging.WARNING, logger=ssh_hosts.__name__),
            pytest.raises(OSError, match=exact("No space left on device")),
        ):
            ssh_hosts.apply_changes(LOCKED_DISABLED, [addition("db1", 22, keys["ed25519"])], [])

        assert logged_warnings(caplog) == []
        assert saved_policy() == UNLOCKED_STRICT

    def test_a_read_only_config_file_refuses_and_writes_no_data_file(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey], read_only_config: Path
    ) -> None:
        from wavecore.api.config.write_back import ConfigWriteError

        original = read_only_config.read_bytes()

        with pytest.raises(ConfigWriteError, match=read_only(read_only_config)):
            ssh_hosts.apply_changes(LOCKED_STRICT, [addition("db1", 22, keys["ed25519"])], [])

        assert read_only_config.read_bytes() == original
        assert ssh_hosts.get_policy() == DEFAULT_POLICY
        assert not hosts_file.parent.exists()

    def test_a_read_only_config_file_leaves_an_existing_data_file_untouched(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey], read_only_config: Path
    ) -> None:
        from wavecore.api.config.write_back import ConfigWriteError

        write_store(hosts_file, {"hosts": [stored("a" * 32, "db1", 22, keys["ed25519"])]})
        original = hosts_file.read_bytes()

        with pytest.raises(ConfigWriteError, match=read_only(read_only_config)):
            ssh_hosts.apply_changes(LOCKED_STRICT, [addition("db2", 22, keys["rsa"])], ["a" * 32])

        assert hosts_file.read_bytes() == original
        assert sorted(hosts_file.parent.iterdir()) == [hosts_file]
        assert ssh_hosts.get_view() == {
            "policy": DEFAULT_POLICY,
            "hosts": [row("a" * 32, "db1", 22, keys["ed25519"])],
        }


class TestUnchangedPolicy:
    @pytest.mark.parametrize(
        "policy",
        [LOCKED_STRICT, {"lock_trusted_hosts": True}, {"default_block_action": "strict"}],
        ids=["both-fields", "lock-only", "action-only"],
    )
    def test_a_repeated_policy_writes_no_config(
        self,
        hosts_file: Path,
        seed_policy: Callable[[bool, str], None],
        config_file: Path,
        policy: dict[str, Any],
    ) -> None:
        seed_policy(True, "strict")
        original = config_file.read_bytes()

        view = ssh_hosts.apply_changes(policy, [], [])

        assert view == {"policy": LOCKED_STRICT, "hosts": []}
        assert config_file.read_bytes() == original
        assert not hosts_file.parent.exists()

    def test_the_default_policy_repeated_on_an_empty_config_file_writes_nothing(
        self, hosts_file: Path, config_file: Path
    ) -> None:
        original = config_file.read_bytes()

        view = ssh_hosts.apply_changes(DEFAULT_POLICY, [], [])

        assert view == {"policy": DEFAULT_POLICY, "hosts": []}
        assert config_file.read_bytes() == original
        assert not hosts_file.parent.exists()

    def test_a_repeated_policy_is_accepted_on_a_read_only_config_file(
        self,
        hosts_file: Path,
        keys: dict[str, asyncssh.SSHKey],
        seed_policy: Callable[[bool, str], None],
        read_only_config: Path,
    ) -> None:
        seed_policy(True, "strict")
        original = read_only_config.read_bytes()

        view = ssh_hosts.apply_changes(LOCKED_STRICT, [addition("db1", 22, keys["ed25519"])], [])

        assert view["policy"] == LOCKED_STRICT
        assert [r["host"] for r in view["hosts"]] == ["db1"]
        assert read_only_config.read_bytes() == original
        assert set(on_disk(hosts_file)) == {"hosts"}

    def test_one_changed_field_on_a_read_only_config_file_is_refused(
        self,
        hosts_file: Path,
        seed_policy: Callable[[bool, str], None],
        read_only_config: Path,
    ) -> None:
        from wavecore.api.config.write_back import ConfigWriteError

        seed_policy(True, "strict")
        original = read_only_config.read_bytes()

        with pytest.raises(ConfigWriteError, match=read_only(read_only_config)):
            ssh_hosts.apply_changes(LOCKED_DISABLED, [], [])

        assert read_only_config.read_bytes() == original
        assert ssh_hosts.get_policy() == LOCKED_STRICT
        assert not hosts_file.parent.exists()


class TestUnreadableStore:
    @pytest.mark.parametrize(
        "call",
        [
            ssh_hosts.get_view,
            lambda: ssh_hosts.apply_changes({"lock_trusted_hosts": True}, [], []),
        ],
        ids=["get_view", "apply_changes"],
    )
    def test_names_the_file_and_the_error(self, hosts_file: Path, call: Callable[[], Any]) -> None:
        hosts_file.parent.mkdir(parents=True)
        hosts_file.write_text(BROKEN_YAML, encoding="utf-8")
        pattern = (
            "^" + re.escape(f"WAVE's trusted SSH hosts list {hosts_file} cannot be read: ") + ".+$"
        )

        with pytest.raises((TrustedHostsUnreadable, InternalServerException), match=pattern):
            call()

        assert hosts_file.read_text(encoding="utf-8") == BROKEN_YAML


class TestParse:
    def test_response_shape(self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]) -> None:
        text = (
            f"jump-02,10.20.4.40 {openssh(keys['ed25519'])}\n"
            f"{HASHED_NAME} {openssh(keys['rsa'])}\n"
            f"[db1]:2222 {openssh(keys['rsa'])} root@db1\n"
        )

        assert ssh_hosts.parse(text) == {
            "entries": [
                {
                    "host_names": ["jump-02", "10.20.4.40"],
                    "port": 22,
                    "key_type": "ED25519",
                    "key": openssh(keys["ed25519"]),
                    "fingerprint": keys["ed25519"].get_fingerprint("sha256"),
                },
                {
                    "host_names": ["db1"],
                    "port": 2222,
                    "key_type": "RSA",
                    "key": openssh(keys["rsa"]),
                    "fingerprint": keys["rsa"].get_fingerprint("sha256"),
                },
            ],
            "errors": [
                {
                    "line": 2,
                    "message": "hashed host name, run ssh-keyscan without -H and paste again",
                }
            ],
        }

    def test_blank_text(self, hosts_file: Path) -> None:
        assert ssh_hosts.parse("") == {"entries": [], "errors": []}

    def test_writes_nothing(self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]) -> None:
        ssh_hosts.parse(f"db1 {openssh(keys['ed25519'])}\n")

        assert not hosts_file.parent.exists()


class TestPlacementDefaults:
    def test_default_is_disabled(self, hosts_file: Path) -> None:
        assert ssh_hosts.placement_defaults() == {
            "ssh-session-open": {"host_key_verification": "disabled"}
        }

    @pytest.mark.parametrize("action", ["strict", "accept-new", "disabled"])
    def test_follows_the_saved_default_action(
        self, hosts_file: Path, seed_policy: Callable[[bool, str], None], action: str
    ) -> None:
        seed_policy(False, action)

        assert ssh_hosts.placement_defaults() == {
            "ssh-session-open": {"host_key_verification": action}
        }

    def test_follows_lock_turning_the_default_to_strict(
        self, hosts_file: Path, seed_policy: Callable[[bool, str], None]
    ) -> None:
        seed_policy(False, "accept-new")

        ssh_hosts.apply_changes({"lock_trusted_hosts": True}, [], [])

        assert ssh_hosts.placement_defaults() == {
            "ssh-session-open": {"host_key_verification": "strict"}
        }

    def test_ignores_an_action_left_in_the_data_file(self, hosts_file: Path) -> None:
        write_store(hosts_file, {"policy": LOCKED_STRICT, "hosts": []})

        assert ssh_hosts.placement_defaults() == {
            "ssh-session-open": {"host_key_verification": "disabled"}
        }


class TestEntryLabel:
    """The name a backed-up SSH host goes by (REQ-5.2.4.9.6)."""

    @pytest.mark.parametrize(
        ("key_name", "key_type"),
        [("ed25519", "ED25519"), ("nistp256", "ECDSA"), ("rsa", "RSA")],
    )
    def test_the_label_is_host_port_and_key_type(
        self, keys: dict[str, asyncssh.SSHKey], key_name: str, key_type: str
    ) -> None:
        entry = stored("a" * 32, "db1", 2222, keys[key_name])

        assert ssh_hosts.entry_label(entry) == f"db1 port 2222 ({key_type})"

    def test_the_label_leaves_the_key_type_out_when_it_is_unknown(
        self, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        entry = {**stored("a" * 32, "db1", 22, keys["ed25519"]), "public_key": "AAAAnotakey"}

        assert ssh_hosts.entry_label(entry) == "db1 port 22"

    @pytest.mark.parametrize(
        "host_field", [{}, {"host": None}, {"host": ""}], ids=["absent", "null", "empty"]
    )
    def test_the_label_is_empty_when_the_entry_has_no_readable_host(
        self, keys: dict[str, asyncssh.SSHKey], host_field: dict[str, Any]
    ) -> None:
        entry = stored("a" * 32, "db1", 22, keys["ed25519"])
        del entry["host"]
        entry.update(host_field)

        assert ssh_hosts.entry_label(entry) == ""


class TestRestoreEntries:
    """Backed-up SSH hosts merged into the trusted list (REQ-5.2.4.9.2, REQ-5.2.4.9.6)."""

    def test_an_entry_it_cannot_read_counts_as_fatal_in_its_input_position(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        write_store(hosts_file, {"hosts": [stored("a" * 32, "db1", 22, keys["ed25519"])]})
        no_host = stored("c" * 32, "db3", 22, keys["nistp256"])
        del no_host["host"]
        broken = {**stored("e" * 32, "db4", 22, keys["rsa"]), "public_key": "ssh-rsa AAAAnotakey"}

        result = ssh_hosts.restore_entries(
            [
                stored("b" * 32, "db2", 22, keys["rsa"]),
                no_host,
                stored("d" * 32, "db1", 22, keys["ed25519_other"]),
                broken,
                stored("f" * 32, "db5", 2222, keys["nistp256"]),
            ],
            "skip",
        )

        outcomes = ["imported", "fatal", "skipped", "fatal", "imported"]
        assert result == {"imported": 2, "skipped": 1, "fatal": 2, "outcomes": outcomes}
        hosts = on_disk(hosts_file)["hosts"]
        assert sorted((e["host"], e["port"], e["public_key"]) for e in hosts) == sorted(
            [
                ("db1", 22, openssh(keys["ed25519"])),
                ("db2", 22, openssh(keys["rsa"])),
                ("db5", 2222, openssh(keys["nistp256"])),
            ]
        )


class TestPortDigits:
    """A port sent or backed up as its digits is the number it stands for (REQ-3.1.3.14)."""

    def test_an_addition_with_the_port_as_its_digits_stores_the_number(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        view = ssh_hosts.apply_changes(None, [addition("db1", "0022", keys["ed25519"])], [])

        assert [(entry["host"], entry["port"]) for entry in view["hosts"]] == [("db1", 22)]
        assert on_disk(hosts_file)["hosts"][0]["port"] == 22

    def test_a_backed_up_port_as_its_digits_is_the_same_host_and_is_stored_as_the_number(
        self, hosts_file: Path, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        write_store(hosts_file, {"hosts": [stored("a" * 32, "db1", 22, keys["ed25519"])]})
        same = stored("b" * 32, "db1", "22", keys["ed25519_other"])
        other = stored("c" * 32, "db2", "2222", keys["rsa"])

        assert ssh_hosts.conflict_key(same) == ssh_hosts.conflict_key(
            stored("a" * 32, "db1", 22, keys["ed25519"])
        )
        result = ssh_hosts.restore_entries([same, other], "skip")

        assert result["outcomes"] == ["skipped", "imported"]
        assert sorted((e["host"], e["port"]) for e in on_disk(hosts_file)["hosts"]) == [
            ("db1", 22),
            ("db2", 2222),
        ]

    def test_a_backed_up_port_that_is_not_one_is_unreadable(
        self, keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        entry = stored("a" * 32, "db1", True, keys["ed25519"])

        assert ssh_hosts.backup_entry_problem(entry) == "SSH host db1 port True: unreadable key"
        assert ssh_hosts.conflict_key(entry)[1] is True
