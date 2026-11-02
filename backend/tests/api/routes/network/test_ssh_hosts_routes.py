"""/network/ssh-hosts routes: view, policy, change set, paste parsing, detect (REQ-4.5.14)."""

import base64
import re
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import asyncssh
import pytest
import yaml
from fastapi.testclient import TestClient
from httpx import Response

from wavecore.api.exceptions import ValidationException
from wavecore.api.services import storage_paths
from wavecore.api.services.network import ssh_hosts as ssh_hosts_service
from wavecore.core.ssh import trusted_hosts

KEY_A = asyncssh.generate_private_key("ssh-ed25519")
KEY_B = asyncssh.generate_private_key("ssh-ed25519")
KEY_EC = asyncssh.generate_private_key("ecdsa-sha2-nistp256")

DEFAULT_POLICY = {"lock_trusted_hosts": False, "default_block_action": "disabled"}
LOCKED_STRICT = {"lock_trusted_hosts": True, "default_block_action": "strict"}
LOCKED_DISABLED = {"lock_trusted_hosts": True, "default_block_action": "disabled"}
UNLOCKED_STRICT = {"lock_trusted_hosts": False, "default_block_action": "strict"}
HOST_ROW_KEYS = {"id", "host", "port", "key_type", "fingerprint", "added"}
STORED_ADDED = "2026-09-01T10:00:00+00:00"
ID_DB1 = "a" * 32
ID_DB1_ALT_PORT = "b" * 32
ID_WEB1 = "c" * 32
MISSING_ID = "f" * 32


def _text(key: asyncssh.SSHKey) -> str:
    return f"{key.get_algorithm()} {base64.b64encode(key.public_data).decode()}"


def _fingerprint(key: asyncssh.SSHKey) -> str:
    return key.get_fingerprint("sha256")


def _stored_host(host_id: str, host: str, port: int, key: asyncssh.SSHKey) -> dict[str, Any]:
    return {
        "id": host_id,
        "host": host,
        "port": port,
        "public_key": _text(key),
        "added": STORED_ADDED,
    }


def _addition(host: str, port: Any, key_type: str, key: asyncssh.SSHKey) -> dict[str, Any]:
    return {"host": host, "port": port, "key_type": key_type, "key": _text(key)}


@pytest.fixture
def client() -> TestClient:
    from wavecore.api.app import app

    return TestClient(app)


@pytest.fixture(autouse=True)
def data_folder(tmp_path: Path) -> Path:
    folder = tmp_path / "data"
    folder.mkdir()
    storage_paths.set_base_path(folder)
    return folder


@pytest.fixture
def store_file(data_folder: Path) -> Path:
    return data_folder / "network" / "ssh_hosts.yaml"


@pytest.fixture
def policy_saved_before_the_config_turned_read_only(
    request: pytest.FixtureRequest,
    monkeypatch: pytest.MonkeyPatch,
    config_on_disk: Callable[[], dict[str, Any]],
) -> list[dict[str, Any]]:
    """Make the config file read-only at the hosts step; holds the policy saved by then."""
    seen: list[dict[str, Any]] = []
    real_apply_change = trusted_hosts.apply_change

    def apply_change(*args: Any, **kwargs: Any) -> Any:
        seen.append(dict(config_on_disk()["network"]["ssh_hosts"]))
        request.getfixturevalue("read_only_config")
        return real_apply_change(*args, **kwargs)

    monkeypatch.setattr(trusted_hosts, "apply_change", apply_change)
    return seen


def _seed(store_file: Path, hosts: list[dict[str, Any]]) -> None:
    store_file.parent.mkdir(parents=True, exist_ok=True)
    store_file.write_text(yaml.safe_dump({"hosts": hosts}), encoding="utf-8")


def _seed_with_leftover_policy(
    store_file: Path, hosts: list[dict[str, Any]], policy: dict[str, Any]
) -> None:
    store_file.parent.mkdir(parents=True, exist_ok=True)
    store_file.write_text(yaml.safe_dump({"policy": policy, "hosts": hosts}), encoding="utf-8")


def _ssh_section(policy: dict[str, Any]) -> dict[str, Any]:
    return {"network": {"ssh_hosts": dict(policy)}}


def _make_unreadable(store_file: Path) -> None:
    store_file.mkdir(parents=True)


def _refusal(response: Response, status: int, code: str) -> str:
    """The exact message of the app's error envelope, after checking status and code."""
    assert response.status_code == status
    body = response.json()
    assert body["success"] is False
    assert body["error"]["code"] == code
    return str(body["error"]["message"])


def _unreadable_message(store_file: Path) -> str:
    return rf"^WAVE's trusted SSH hosts list {re.escape(str(store_file))} cannot be read: .+$"


def _hosts_of(client: TestClient) -> list[tuple[str, int, str, str]]:
    rows = client.get("/network/ssh-hosts").json()["hosts"]
    return [(row["host"], row["port"], row["key_type"], row["fingerprint"]) for row in rows]


class TestGetView:
    def test_defaults_when_nothing_is_stored(self, client: TestClient) -> None:
        response = client.get("/network/ssh-hosts")

        assert response.status_code == 200
        assert response.json() == {"policy": DEFAULT_POLICY, "hosts": []}

    def test_rows_come_from_the_store_ordered_by_host_then_port(
        self, client: TestClient, store_file: Path, load_config: Callable[..., Any]
    ) -> None:
        load_config(_ssh_section(LOCKED_STRICT))
        _seed(
            store_file,
            [
                _stored_host(ID_WEB1, "web1", 22, KEY_A),
                _stored_host(ID_DB1_ALT_PORT, "db1", 2222, KEY_EC),
                _stored_host(ID_DB1, "db1", 22, KEY_B),
            ],
        )

        response = client.get("/network/ssh-hosts")

        assert response.status_code == 200
        body = response.json()
        assert set(body.keys()) == {"policy", "hosts"}
        assert body["policy"] == LOCKED_STRICT
        assert [(row["id"], row["host"], row["port"]) for row in body["hosts"]] == [
            (ID_DB1, "db1", 22),
            (ID_DB1_ALT_PORT, "db1", 2222),
            (ID_WEB1, "web1", 22),
        ]
        first, second, _ = body["hosts"]
        assert set(first.keys()) == HOST_ROW_KEYS
        assert first["key_type"] == "ED25519"
        assert first["fingerprint"] == _fingerprint(KEY_B)
        assert first["fingerprint"].startswith("SHA256:")
        assert not first["fingerprint"].endswith("=")
        assert second["key_type"] == "ECDSA"
        assert second["fingerprint"] == _fingerprint(KEY_EC)
        assert datetime.fromisoformat(first["added"]) == datetime(2026, 9, 1, 10, 0, tzinfo=UTC)

    def test_a_policy_left_in_the_data_file_is_ignored(
        self, client: TestClient, store_file: Path
    ) -> None:
        _seed_with_leftover_policy(
            store_file, [_stored_host(ID_DB1, "db1", 22, KEY_A)], LOCKED_STRICT
        )

        response = client.get("/network/ssh-hosts")

        assert response.status_code == 200
        body = response.json()
        assert body["policy"] == DEFAULT_POLICY
        assert [row["id"] for row in body["hosts"]] == [ID_DB1]

    def test_an_unreadable_store_is_a_500(self, client: TestClient, store_file: Path) -> None:
        _make_unreadable(store_file)

        message = _refusal(client.get("/network/ssh-hosts"), 500, "INTERNAL_ERROR")

        assert re.match(_unreadable_message(store_file), message)


class TestGetPolicy:
    def test_defaults_when_nothing_is_stored(self, client: TestClient) -> None:
        response = client.get("/network/ssh-hosts/policy")

        assert response.status_code == 200
        assert response.json() == DEFAULT_POLICY

    def test_the_saved_policy(self, client: TestClient, load_config: Callable[..., Any]) -> None:
        load_config(_ssh_section(LOCKED_STRICT))

        response = client.get("/network/ssh-hosts/policy")

        assert response.status_code == 200
        assert response.json() == LOCKED_STRICT

    def test_a_policy_left_in_the_data_file_is_ignored(
        self, client: TestClient, store_file: Path
    ) -> None:
        _seed_with_leftover_policy(store_file, [], LOCKED_STRICT)

        response = client.get("/network/ssh-hosts/policy")

        assert response.status_code == 200
        assert response.json() == DEFAULT_POLICY

    def test_an_unreadable_store_does_not_block_the_policy(
        self, client: TestClient, store_file: Path, load_config: Callable[..., Any]
    ) -> None:
        load_config(_ssh_section(LOCKED_STRICT))
        _make_unreadable(store_file)

        response = client.get("/network/ssh-hosts/policy")

        assert response.status_code == 200
        assert response.json() == LOCKED_STRICT


class TestPatchApplies:
    def test_an_addition_returns_the_view_after_the_write(
        self, client: TestClient, store_file: Path
    ) -> None:
        response = client.patch(
            "/network/ssh-hosts", json={"add": [_addition("db1", 22, "ED25519", KEY_A)]}
        )

        assert response.status_code == 200
        body = response.json()
        assert body["policy"] == DEFAULT_POLICY
        assert len(body["hosts"]) == 1
        row = body["hosts"][0]
        assert set(row.keys()) == HOST_ROW_KEYS
        assert re.fullmatch(r"[0-9a-f]{32}", row["id"])
        assert (row["host"], row["port"], row["key_type"]) == ("db1", 22, "ED25519")
        assert row["fingerprint"] == _fingerprint(KEY_A)
        assert datetime.fromisoformat(row["added"]).utcoffset() == timedelta(0)
        assert client.get("/network/ssh-hosts").json() == body
        stored = yaml.safe_load(store_file.read_text(encoding="utf-8"))
        assert set(stored) == {"hosts"}
        assert [entry["public_key"] for entry in stored["hosts"]] == [_text(KEY_A)]

    def test_an_addition_with_the_port_as_its_digits_stores_the_number(
        self, client: TestClient, store_file: Path
    ) -> None:
        response = client.patch(
            "/network/ssh-hosts", json={"add": [_addition("db1", "22", "ED25519", KEY_A)]}
        )

        assert response.status_code == 200
        assert [(row["host"], row["port"]) for row in response.json()["hosts"]] == [("db1", 22)]
        stored = yaml.safe_load(store_file.read_text(encoding="utf-8"))
        assert stored["hosts"][0]["port"] == 22

    @pytest.mark.parametrize("port", [True, 22.0, "22.5", " 22"])
    def test_an_addition_with_a_port_that_is_not_one_is_refused(
        self, client: TestClient, store_file: Path, port: Any
    ) -> None:
        response = client.patch(
            "/network/ssh-hosts", json={"add": [_addition("db1", port, "ED25519", KEY_A)]}
        )

        assert _refusal(response, 400, "VALIDATION_ERROR") == (
            "Addition 1: port must be from 1 to 65535"
        )
        assert not store_file.exists()

    def test_a_removal_drops_only_that_row(self, client: TestClient, store_file: Path) -> None:
        _seed(
            store_file,
            [_stored_host(ID_DB1, "db1", 22, KEY_A), _stored_host(ID_WEB1, "web1", 22, KEY_B)],
        )

        response = client.patch("/network/ssh-hosts", json={"remove": [ID_DB1]})

        assert response.status_code == 200
        assert [row["id"] for row in response.json()["hosts"]] == [ID_WEB1]

    def test_a_policy_only_change_keeps_every_host(
        self, client: TestClient, store_file: Path
    ) -> None:
        _seed(store_file, [_stored_host(ID_DB1, "db1", 22, KEY_A)])
        before = store_file.read_bytes()

        response = client.patch(
            "/network/ssh-hosts", json={"policy": {"default_block_action": "strict"}}
        )

        assert response.status_code == 200
        body = response.json()
        assert body["policy"] == UNLOCKED_STRICT
        assert [row["id"] for row in body["hosts"]] == [ID_DB1]
        assert store_file.read_bytes() == before

    def test_an_empty_change_set_changes_nothing(
        self, client: TestClient, store_file: Path, config_file: Path
    ) -> None:
        _seed(store_file, [_stored_host(ID_DB1, "db1", 22, KEY_A)])
        before = client.get("/network/ssh-hosts").json()
        store_before = store_file.read_bytes()
        config_before = config_file.read_bytes()

        response = client.patch("/network/ssh-hosts", json={})

        assert response.status_code == 200
        assert response.json() == before
        assert store_file.read_bytes() == store_before
        assert config_file.read_bytes() == config_before

    def test_lock_on_alone_turns_an_accept_new_default_into_strict(
        self, client: TestClient, load_config: Callable[..., Any]
    ) -> None:
        load_config(
            _ssh_section({"lock_trusted_hosts": False, "default_block_action": "accept-new"})
        )

        response = client.patch("/network/ssh-hosts", json={"policy": {"lock_trusted_hosts": True}})

        assert response.status_code == 200
        assert response.json()["policy"] == LOCKED_STRICT
        assert client.get("/network/ssh-hosts/policy").json() == LOCKED_STRICT

    def test_lock_on_alone_keeps_the_disabled_default(self, client: TestClient) -> None:
        response = client.patch("/network/ssh-hosts", json={"policy": {"lock_trusted_hosts": True}})

        assert response.status_code == 200
        assert response.json()["policy"] == LOCKED_DISABLED

    def test_removals_apply_before_additions(self, client: TestClient, store_file: Path) -> None:
        _seed(store_file, [_stored_host(ID_DB1, "db1", 22, KEY_A)])

        response = client.patch(
            "/network/ssh-hosts",
            json={"remove": [ID_DB1], "add": [_addition("db1", 22, "ED25519", KEY_B)]},
        )

        assert response.status_code == 200
        assert _hosts_of(client) == [("db1", 22, "ED25519", _fingerprint(KEY_B))]

    def test_a_missing_removal_and_an_identical_addition_are_no_ops(
        self, client: TestClient, store_file: Path
    ) -> None:
        _seed(store_file, [_stored_host(ID_DB1, "db1", 22, KEY_A)])

        response = client.patch(
            "/network/ssh-hosts",
            json={"remove": [MISSING_ID], "add": [_addition("db1", 22, "ED25519", KEY_A)]},
        )

        assert response.status_code == 200
        assert [(row["id"], row["fingerprint"]) for row in response.json()["hosts"]] == [
            (ID_DB1, _fingerprint(KEY_A))
        ]


class TestPatchRefusals:
    @pytest.mark.parametrize(
        ("policy", "message"),
        [
            ({"lock_trusted_hosts": "yes"}, "Lock trusted hosts must be true or false"),
            (
                {"default_block_action": "sometimes"},
                "Default block action must be 'strict', 'accept-new' or 'disabled'",
            ),
            (
                {"lock_trusted_hosts": True, "default_block_action": "accept-new"},
                "Default block action cannot be 'accept-new' while trusted hosts are locked",
            ),
        ],
    )
    def test_a_bad_policy_is_a_400_and_writes_nothing(
        self,
        client: TestClient,
        store_file: Path,
        config_file: Path,
        policy: dict[str, Any],
        message: str,
    ) -> None:
        before = config_file.read_bytes()

        response = client.patch("/network/ssh-hosts", json={"policy": policy})

        assert _refusal(response, 400, "VALIDATION_ERROR") == message
        assert not store_file.exists()
        assert config_file.read_bytes() == before

    def test_a_bad_addition_is_numbered_and_writes_nothing(
        self, client: TestClient, store_file: Path
    ) -> None:
        _seed(store_file, [_stored_host(ID_DB1, "db1", 22, KEY_A)])
        before = store_file.read_bytes()

        response = client.patch(
            "/network/ssh-hosts",
            json={
                "add": [
                    _addition("web1", 22, "ED25519", KEY_B),
                    _addition("", 22, "ED25519", KEY_B),
                ]
            },
        )

        assert _refusal(response, 400, "VALIDATION_ERROR") == "Addition 2: host is required"
        assert store_file.read_bytes() == before

    def test_a_changed_key_against_a_kept_entry_is_a_409(
        self, client: TestClient, store_file: Path
    ) -> None:
        _seed(store_file, [_stored_host(ID_DB1, "db1", 22, KEY_A)])
        before = store_file.read_bytes()

        response = client.patch(
            "/network/ssh-hosts", json={"add": [_addition("db1", 22, "ED25519", KEY_B)]}
        )

        assert _refusal(response, 409, "CONFLICT") == (
            "db1 port 22 already has a trusted ED25519 key; remove it before adding another"
        )
        assert store_file.read_bytes() == before

    def test_a_changed_key_against_an_earlier_addition_is_a_409(
        self, client: TestClient, store_file: Path
    ) -> None:
        response = client.patch(
            "/network/ssh-hosts",
            json={
                "add": [
                    _addition("db1", 2222, "ED25519", KEY_A),
                    _addition("db1", 2222, "ED25519", KEY_B),
                ]
            },
        )

        assert _refusal(response, 409, "CONFLICT") == (
            "db1 port 2222 already has a trusted ED25519 key; remove it before adding another"
        )
        assert not store_file.exists()

    def test_an_unreadable_store_is_a_500(self, client: TestClient, store_file: Path) -> None:
        _make_unreadable(store_file)

        response = client.patch(
            "/network/ssh-hosts", json={"add": [_addition("db1", 22, "ED25519", KEY_A)]}
        )

        assert re.match(_unreadable_message(store_file), _refusal(response, 500, "INTERNAL_ERROR"))


class TestPatchTwoStores:
    def test_the_policy_goes_to_the_config_file_and_the_host_to_the_data_file(
        self,
        client: TestClient,
        store_file: Path,
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        response = client.patch(
            "/network/ssh-hosts",
            json={"policy": LOCKED_STRICT, "add": [_addition("db1", 22, "ED25519", KEY_A)]},
        )

        assert response.status_code == 200
        body = response.json()
        assert body["policy"] == LOCKED_STRICT
        assert [(row["host"], row["port"], row["fingerprint"]) for row in body["hosts"]] == [
            ("db1", 22, _fingerprint(KEY_A))
        ]
        assert config_on_disk()["network"]["ssh_hosts"] == LOCKED_STRICT
        stored = yaml.safe_load(store_file.read_text(encoding="utf-8"))
        assert set(stored) == {"hosts"}
        assert [(entry["host"], entry["public_key"]) for entry in stored["hosts"]] == [
            ("db1", _text(KEY_A))
        ]
        assert client.get("/network/ssh-hosts").json() == body

    def test_a_saved_policy_survives_a_restart_through_the_config_file_alone(
        self, client: TestClient, store_file: Path, load_config: Callable[..., Any]
    ) -> None:
        response = client.patch("/network/ssh-hosts", json={"policy": LOCKED_STRICT})
        assert response.status_code == 200

        load_config()

        assert not store_file.exists()
        assert client.get("/network/ssh-hosts/policy").json() == LOCKED_STRICT

    def test_a_policy_only_change_writes_no_data_file(
        self,
        client: TestClient,
        store_file: Path,
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        response = client.patch(
            "/network/ssh-hosts", json={"policy": {"default_block_action": "strict"}}
        )

        assert response.status_code == 200
        assert response.json() == {"policy": UNLOCKED_STRICT, "hosts": []}
        assert config_on_disk()["network"]["ssh_hosts"]["default_block_action"] == "strict"
        assert not store_file.exists()

    def test_a_policy_left_in_the_data_file_is_dropped_by_the_next_hosts_write(
        self, client: TestClient, store_file: Path
    ) -> None:
        _seed_with_leftover_policy(
            store_file, [_stored_host(ID_DB1, "db1", 22, KEY_A)], LOCKED_STRICT
        )

        response = client.patch(
            "/network/ssh-hosts", json={"add": [_addition("web1", 22, "ED25519", KEY_B)]}
        )

        assert response.status_code == 200
        assert response.json()["policy"] == DEFAULT_POLICY
        stored = yaml.safe_load(store_file.read_text(encoding="utf-8"))
        assert set(stored) == {"hosts"}
        assert sorted(entry["host"] for entry in stored["hosts"]) == ["db1", "web1"]

    def test_a_conflict_is_a_409_and_puts_the_previous_policy_back(
        self,
        client: TestClient,
        store_file: Path,
        load_config: Callable[..., Any],
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        load_config(_ssh_section(UNLOCKED_STRICT))
        _seed(store_file, [_stored_host(ID_DB1, "db1", 22, KEY_A)])
        before = store_file.read_bytes()

        response = client.patch(
            "/network/ssh-hosts",
            json={"policy": LOCKED_DISABLED, "add": [_addition("db1", 22, "ED25519", KEY_B)]},
        )

        assert _refusal(response, 409, "CONFLICT") == (
            "db1 port 22 already has a trusted ED25519 key; remove it before adding another"
        )
        assert config_on_disk()["network"]["ssh_hosts"] == UNLOCKED_STRICT
        assert client.get("/network/ssh-hosts/policy").json() == UNLOCKED_STRICT
        assert store_file.read_bytes() == before

    def test_a_failed_hosts_write_is_a_500_and_puts_the_previous_policy_back(
        self,
        client: TestClient,
        data_folder: Path,
        load_config: Callable[..., Any],
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        load_config(_ssh_section(UNLOCKED_STRICT))
        blocker = data_folder / "network"
        blocker.write_text("a file where the network folder goes\n", encoding="utf-8")

        response = client.patch(
            "/network/ssh-hosts",
            json={"policy": LOCKED_DISABLED, "add": [_addition("db1", 22, "ED25519", KEY_A)]},
        )

        _refusal(response, 500, "INTERNAL_ERROR")
        assert config_on_disk()["network"]["ssh_hosts"] == UNLOCKED_STRICT
        assert client.get("/network/ssh-hosts/policy").json() == UNLOCKED_STRICT
        assert blocker.read_text(encoding="utf-8") == "a file where the network folder goes\n"

    def test_a_read_only_config_file_is_a_500_and_writes_nothing(
        self, client: TestClient, store_file: Path, read_only_config: Path
    ) -> None:
        before = read_only_config.read_bytes()

        response = client.patch(
            "/network/ssh-hosts",
            json={"policy": LOCKED_STRICT, "add": [_addition("db1", 22, "ED25519", KEY_A)]},
        )

        assert _refusal(response, 500, "INTERNAL_ERROR") == (
            f"Settings cannot be saved: the config file {read_only_config} is read-only"
        )
        assert read_only_config.read_bytes() == before
        assert client.get("/network/ssh-hosts").json() == {"policy": DEFAULT_POLICY, "hosts": []}
        assert not store_file.exists()

    def test_a_read_only_config_file_leaves_an_existing_data_file_untouched(
        self, client: TestClient, store_file: Path, read_only_config: Path
    ) -> None:
        _seed(store_file, [_stored_host(ID_DB1, "db1", 22, KEY_A)])
        before = store_file.read_bytes()

        response = client.patch(
            "/network/ssh-hosts",
            json={
                "policy": LOCKED_STRICT,
                "add": [_addition("web1", 22, "ED25519", KEY_B)],
                "remove": [ID_DB1],
            },
        )

        assert _refusal(response, 500, "INTERNAL_ERROR") == (
            f"Settings cannot be saved: the config file {read_only_config} is read-only"
        )
        assert store_file.read_bytes() == before
        assert sorted(store_file.parent.iterdir()) == [store_file]
        assert client.get("/network/ssh-hosts/policy").json() == DEFAULT_POLICY

    @pytest.mark.parametrize(
        "add",
        [[_addition("db1", 22, "ED25519", KEY_A)], []],
        ids=["policy-and-addition", "policy-alone"],
    )
    def test_an_unreadable_store_is_a_500_and_keeps_the_previous_policy(
        self,
        client: TestClient,
        store_file: Path,
        load_config: Callable[..., Any],
        config_on_disk: Callable[[], dict[str, Any]],
        add: list[dict[str, Any]],
    ) -> None:
        load_config(_ssh_section(UNLOCKED_STRICT))
        _make_unreadable(store_file)

        response = client.patch("/network/ssh-hosts", json={"policy": LOCKED_DISABLED, "add": add})

        assert re.match(_unreadable_message(store_file), _refusal(response, 500, "INTERNAL_ERROR"))
        assert config_on_disk()["network"]["ssh_hosts"] == UNLOCKED_STRICT
        assert client.get("/network/ssh-hosts/policy").json() == UNLOCKED_STRICT
        assert store_file.is_dir()

    def test_a_conflict_is_still_a_409_when_the_previous_policy_cannot_be_put_back(
        self,
        client: TestClient,
        store_file: Path,
        load_config: Callable[..., Any],
        policy_saved_before_the_config_turned_read_only: list[dict[str, Any]],
    ) -> None:
        load_config(_ssh_section(UNLOCKED_STRICT))
        _seed(store_file, [_stored_host(ID_DB1, "db1", 22, KEY_A)])
        before = store_file.read_bytes()

        response = client.patch(
            "/network/ssh-hosts",
            json={"policy": LOCKED_DISABLED, "add": [_addition("db1", 22, "ED25519", KEY_B)]},
        )

        assert _refusal(response, 409, "CONFLICT") == (
            "db1 port 22 already has a trusted ED25519 key; remove it before adding another"
        )
        assert policy_saved_before_the_config_turned_read_only == [LOCKED_DISABLED]
        assert store_file.read_bytes() == before


class TestPatchUnchangedPolicy:
    def test_a_repeated_policy_writes_no_config_file(
        self,
        client: TestClient,
        store_file: Path,
        load_config: Callable[..., Any],
        config_file: Path,
    ) -> None:
        load_config(_ssh_section(LOCKED_STRICT))
        before = config_file.read_bytes()

        response = client.patch("/network/ssh-hosts", json={"policy": LOCKED_STRICT})

        assert response.status_code == 200
        assert response.json() == {"policy": LOCKED_STRICT, "hosts": []}
        assert config_file.read_bytes() == before
        assert not store_file.exists()

    def test_a_repeated_policy_is_a_200_on_a_read_only_config_file(
        self,
        client: TestClient,
        store_file: Path,
        load_config: Callable[..., Any],
        read_only_config: Path,
    ) -> None:
        load_config(_ssh_section(LOCKED_STRICT))
        before = read_only_config.read_bytes()

        response = client.patch(
            "/network/ssh-hosts",
            json={"policy": LOCKED_STRICT, "add": [_addition("db1", 22, "ED25519", KEY_A)]},
        )

        assert response.status_code == 200
        body = response.json()
        assert body["policy"] == LOCKED_STRICT
        assert [row["host"] for row in body["hosts"]] == ["db1"]
        assert read_only_config.read_bytes() == before
        assert set(yaml.safe_load(store_file.read_text(encoding="utf-8"))) == {"hosts"}

    def test_one_changed_field_on_a_read_only_config_file_is_a_500(
        self,
        client: TestClient,
        store_file: Path,
        load_config: Callable[..., Any],
        read_only_config: Path,
    ) -> None:
        load_config(_ssh_section(LOCKED_STRICT))
        before = read_only_config.read_bytes()

        response = client.patch("/network/ssh-hosts", json={"policy": LOCKED_DISABLED})

        assert _refusal(response, 500, "INTERNAL_ERROR") == (
            f"Settings cannot be saved: the config file {read_only_config} is read-only"
        )
        assert read_only_config.read_bytes() == before
        assert client.get("/network/ssh-hosts/policy").json() == LOCKED_STRICT
        assert not store_file.exists()


class TestParse:
    def test_good_lines_are_returned_beside_numbered_bad_lines(
        self, client: TestClient, store_file: Path
    ) -> None:
        text = "\n".join(
            [
                "# scanned from the lab",
                f"db1 {_text(KEY_A)}",
                "",
                f"[db2]:2222 {_text(KEY_EC)}",
                "HostName ci-02.lab.internal",
                f"jump-02,10.20.4.40 {_text(KEY_B)}",
            ]
        )

        response = client.post("/network/ssh-hosts/parse", json={"text": text})

        assert response.status_code == 200
        assert response.json() == {
            "entries": [
                {
                    "host_names": ["db1"],
                    "port": 22,
                    "key_type": "ED25519",
                    "key": _text(KEY_A),
                    "fingerprint": _fingerprint(KEY_A),
                },
                {
                    "host_names": ["db2"],
                    "port": 2222,
                    "key_type": "ECDSA",
                    "key": _text(KEY_EC),
                    "fingerprint": _fingerprint(KEY_EC),
                },
                {
                    "host_names": ["jump-02", "10.20.4.40"],
                    "port": 22,
                    "key_type": "ED25519",
                    "key": _text(KEY_B),
                    "fingerprint": _fingerprint(KEY_B),
                },
            ],
            "errors": [{"line": 5, "message": "not a known_hosts line"}],
        }
        assert not store_file.exists()

    def test_text_with_only_bad_lines_is_still_a_200(self, client: TestClient) -> None:
        text = f"HostName ci-02.lab.internal\n|1|c2FsdA==|aGFzaA== {_text(KEY_A)}\n"

        response = client.post("/network/ssh-hosts/parse", json={"text": text})

        assert response.status_code == 200
        assert response.json() == {
            "entries": [],
            "errors": [
                {"line": 1, "message": "not a known_hosts line"},
                {
                    "line": 2,
                    "message": "hashed host name, run ssh-keyscan without -H and paste again",
                },
            ],
        }

    @pytest.mark.parametrize("text", ["", "  \n\n"])
    def test_blank_text_yields_nothing(self, client: TestClient, text: str) -> None:
        response = client.post("/network/ssh-hosts/parse", json={"text": text})

        assert response.status_code == 200
        assert response.json() == {"entries": [], "errors": []}


class TestDetect:
    def test_the_service_entries_are_returned(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        asked: list[tuple[str, int]] = []
        entries = [
            {
                "host": "db1.lab.internal",
                "port": 2222,
                "key_type": "ED25519",
                "key": _text(KEY_A),
                "fingerprint": _fingerprint(KEY_A),
            },
            {
                "host": "db1.lab.internal",
                "port": 2222,
                "key_type": "ECDSA",
                "key": _text(KEY_EC),
                "fingerprint": _fingerprint(KEY_EC),
            },
        ]

        async def detect(host: str, port: int) -> dict[str, Any]:
            asked.append((host, port))
            return {"entries": entries}

        monkeypatch.setattr(ssh_hosts_service, "detect_host_keys", detect)

        response = client.post(
            "/network/ssh-hosts/detect", json={"host": "db1.lab.internal", "port": 2222}
        )

        assert response.status_code == 200
        assert response.json() == {"entries": entries}
        assert asked == [("db1.lab.internal", 2222)]

    @pytest.mark.parametrize(
        "message",
        [
            "Could not reach db1.lab.internal:2222: Connection refused",
            "Timed out after 10 seconds reaching db1.lab.internal:2222",
            "db1.lab.internal:2222 did not answer as an SSH server",
            "db1.lab.internal:2222 offered no ED25519, ECDSA or RSA host key",
        ],
    )
    def test_a_service_refusal_is_a_400_with_its_message(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch, message: str
    ) -> None:
        async def detect(host: str, port: int) -> dict[str, Any]:
            raise ValidationException(message)

        monkeypatch.setattr(ssh_hosts_service, "detect_host_keys", detect)

        response = client.post(
            "/network/ssh-hosts/detect", json={"host": "db1.lab.internal", "port": 2222}
        )

        assert _refusal(response, 400, "VALIDATION_ERROR") == message

    @pytest.mark.parametrize(
        ("body", "message"),
        [
            ({"host": "  ", "port": 22}, "Host is required"),
            ({"host": "db1", "port": 0}, "Port must be from 1 to 65535"),
            ({"host": "db1", "port": 65536}, "Port must be from 1 to 65535"),
            ({"host": "db1", "port": True}, "Port must be from 1 to 65535"),
            ({"host": "db1", "port": 22.0}, "Port must be from 1 to 65535"),
            ({"host": "db1", "port": "22.0"}, "Port must be from 1 to 65535"),
            ({"host": "db1", "port": " 22 "}, "Port must be from 1 to 65535"),
            ({"host": "db1", "port": None}, "Port must be from 1 to 65535"),
        ],
    )
    def test_input_checks_reach_the_caller_unchanged(
        self, client: TestClient, store_file: Path, body: dict[str, Any], message: str
    ) -> None:
        response = client.post("/network/ssh-hosts/detect", json=body)

        assert _refusal(response, 400, "VALIDATION_ERROR") == message
        assert not store_file.exists()


class TestNoImmediateWrites:
    @pytest.mark.parametrize(
        ("method", "path"),
        [
            ("POST", "/network/ssh-hosts"),
            ("DELETE", f"/network/ssh-hosts/{ID_DB1}"),
            ("DELETE", "/network/ssh-hosts/batch"),
            ("PUT", "/network/ssh-hosts/policy"),
        ],
    )
    def test_every_write_goes_through_the_patch(
        self, client: TestClient, store_file: Path, config_file: Path, method: str, path: str
    ) -> None:
        _seed(store_file, [_stored_host(ID_DB1, "db1", 22, KEY_A)])
        before = store_file.read_bytes()
        config_before = config_file.read_bytes()
        payloads = {
            "POST": _addition("web1", 22, "ED25519", KEY_B),
            "DELETE": {"ids": [ID_DB1]},
            "PUT": {"lock_trusted_hosts": True, "default_block_action": "strict"},
        }

        response = client.request(method, path, json=payloads[method])

        assert response.status_code in (404, 405)
        assert store_file.read_bytes() == before
        assert config_file.read_bytes() == config_before
