"""The /network/proxy endpoints (REQ-4.7.14, REQ-3.4.2.10).

    GET    /network/proxy            -> ProxySettings
    PATCH  /network/proxy            -> ProxySettings after the write; only the sent fields change
    POST   /network/proxy/validate   -> {problems}; every problem of the staged values, no write
    GET    /network/proxy/blocks     -> {supported, unsupported, not_applicable}

Success bodies are plain models; failures ride the standard error envelope. The password is
write-only: a response says only whether one is stored. There is no PUT.
"""

from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from httpx import Response

from wavecore.core import plugin_registry
from wavecore.plugins.base import PluginBase

BASE = "/network/proxy"
VALIDATE = f"{BASE}/validate"
BLOCKS = f"{BASE}/blocks"
HOST_VARIABLES = ("HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY")
NO_HOST_VALUES = {"https_proxy": None, "http_proxy": None, "no_proxy": None}
DEFAULTS: dict[str, Any] = {
    "enabled": False,
    "source": "host",
    "host": "",
    "port": None,
    "username": "",
    "password_set": False,
    "list_mode": "except",
    "entries": [],
    "proxy_local_addresses": False,
    "host_values": NO_HOST_VALUES,
}
EXACT_ENTRY = {"kind": "exact", "address": "https://api.lab.example"}
REGEX_ENTRY = {"kind": "regex", "address": "^https://.+[.]lab[.]example$"}
CUSTOM_PROXY: dict[str, Any] = {
    "enabled": True,
    "source": "custom",
    "host": "proxy.lab.example",
    "port": 3128,
    "username": "svc-proxy",
    "list_mode": "only",
    "entries": [EXACT_ENTRY, REGEX_ENTRY],
    "proxy_local_addresses": True,
}
# The proxy on with a plain Custom proxy: the page shows every Custom field.
ON_CUSTOM: dict[str, Any] = {
    "enabled": True,
    "source": "custom",
    "host": "proxy.lab.example",
    "port": 3128,
}
SECRET_TEXT = "pr0xy-s3cret"
PROBLEM_KEYS = {"field", "row", "message"}

HOST_REQUIRED = "IP or Hostname is required when the source is Custom"
PORT_RANGE = "Port must be a whole number from 1 to 65535"
ADDRESS_REQUIRED = "An address is required"
EXACT_FORM = "An exact address is http:// or https://, a host and an optional port"
NO_HOST_PROXY = (
    "This WAVE host has no HTTPS_PROXY or HTTP_PROXY set: choose Custom or turn the proxy off"
)
USERNAME_REQUIRED = "Username is required when a proxy password is set"
USERNAME_COLON = "Username must not contain a colon"
ENTRIES_SHAPE = "The address list must be a list of entries with a kind and an address"

WRONG_TYPES = [
    pytest.param({"enabled": "yes"}, "enabled", "Use a proxy must be true or false", id="enabled"),
    pytest.param({"source": 5}, "source", "Source must be 'host' or 'custom'", id="source"),
    pytest.param({"host": 5}, "host", "IP or Hostname must be text", id="host"),
    pytest.param({"port": "+3128"}, "port", PORT_RANGE, id="port-text"),
    pytest.param({"port": True}, "port", PORT_RANGE, id="port-boolean"),
    pytest.param({"port": 3128.5}, "port", PORT_RANGE, id="port-fraction"),
    pytest.param(
        {"list_mode": 5},
        "list_mode",
        "Use the proxy for must be 'except' or 'only'",
        id="list-mode",
    ),
    pytest.param({"entries": "https://api.lab.example"}, "entries", ENTRIES_SHAPE, id="entries"),
    pytest.param(
        {"entries": ["https://api.lab.example"]}, "entries", ENTRIES_SHAPE, id="entries-of-text"
    ),
    pytest.param(
        {"proxy_local_addresses": "no"},
        "proxy_local_addresses",
        "Use the proxy for local addresses too must be true or false",
        id="proxy-local-addresses",
    ),
]
MALFORMED_BODIES = [
    pytest.param({"username": 5}, id="username-number"),
    pytest.param({"username": ["svc-proxy"]}, id="username-list"),
    pytest.param({"password": 5}, id="password-number"),
    pytest.param({"password": {"value": SECRET_TEXT}}, id="password-map"),
]
SEVERAL_FAULTS: dict[str, Any] = {
    "enabled": True,
    "source": "custom",
    "host": "",
    "port": 70000,
    "entries": [
        EXACT_ENTRY,
        {"kind": "exact", "address": ""},
        {"kind": "exact", "address": "api.lab.example"},
    ],
}
SEVERAL_PROBLEMS = [
    {"field": "host", "row": None, "message": HOST_REQUIRED},
    {"field": "port", "row": None, "message": PORT_RANGE},
    {"field": "entries", "row": 2, "message": ADDRESS_REQUIRED},
    {"field": "entries", "row": 3, "message": EXACT_FORM},
]


class _Block(PluginBase):
    """A plugin that states the given ``proxy_support``, or nothing."""

    def __init__(
        self,
        plugin_id: str,
        name: str,
        category: str,
        stated: str | None = None,
        version: str = "1.0.0",
    ) -> None:
        self._identity = {"id": plugin_id, "name": name, "category": category, "version": version}
        self._stated = stated

    @property
    def metadata(self) -> dict[str, Any]:
        metadata: dict[str, Any] = {
            **self._identity,
            "description": "A block that exists only in these tests",
            "parameters": [],
            "return_type": "map",
            "output_schema": [],
        }
        if self._stated is not None:
            metadata["proxy_support"] = self._stated
        return metadata

    async def execute(self, context: dict[str, Any]) -> Any:
        return {}

    async def validate(self, params: dict[str, Any]) -> None:
        return None


REGISTERED_BLOCKS = [
    _Block("web-call", "Web Call", "network", "supported"),
    _Block("web-call", "Web Call", "network", "supported", version="2.0.0"),
    _Block("cluster-read", "Cluster Read", "kubernetes", "supported"),
    _Block("local-script", "Local Script", "system", "unsupported"),
    _Block("port-check", "Port Check", "network"),
    _Block("table-read", "Table Read", "data", "not_applicable"),
]
BLOCK_LISTS = {
    "supported": [
        {"id": "cluster-read", "name": "Cluster Read", "category": "kubernetes"},
        {"id": "web-call", "name": "Web Call", "category": "network"},
    ],
    "unsupported": [{"id": "local-script", "name": "Local Script", "category": "system"}],
    "not_applicable": [
        {"id": "port-check", "name": "Port Check", "category": "network"},
        {"id": "table-read", "name": "Table Read", "category": "data"},
    ],
}


def _view(stored: dict[str, Any], *, password_set: bool = False) -> dict[str, Any]:
    """The ProxySettings those stored values read as while the WAVE host sets no variable."""
    return {**DEFAULTS, **stored, "password_set": password_set}


def _refusal(response: Response, status: int, code: str) -> str:
    """The exact message of the app's error envelope, after checking status and code."""
    assert response.status_code == status, response.text
    body = response.json()
    assert body["success"] is False
    assert body["error"]["code"] == code
    return str(body["error"]["message"])


def _problems(response: Response) -> list[dict[str, Any]]:
    """The problems of a validate answer, after checking its status and shape."""
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {"problems"}
    assert all(set(problem) == PROBLEM_KEYS for problem in body["problems"])
    return list(body["problems"])


def _by_id(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(blocks, key=lambda block: str(block["id"]))


def _stored_password(config_on_disk: Callable[[], dict[str, Any]]) -> Any:
    """The password as the config file holds it on disk right now."""
    return config_on_disk().get("network", {}).get("proxy", {}).get("password")


@pytest.fixture
def client() -> TestClient:
    from wavecore.api.app import app

    return TestClient(app)


@pytest.fixture(autouse=True)
def no_host_proxy_variables(monkeypatch: pytest.MonkeyPatch) -> None:
    """The WAVE host sets no proxy variable unless a test sets one."""
    for name in HOST_VARIABLES:
        monkeypatch.delenv(name, raising=False)
        monkeypatch.delenv(name.lower(), raising=False)


@pytest.fixture
def custom_proxy(load_config: Callable[..., Any]) -> None:
    """A custom proxy with a two-entry list is stored, without a password."""
    load_config({"network": {"proxy": {**CUSTOM_PROXY, "password": None}}})


@pytest.fixture
def custom_on(load_config: Callable[..., Any]) -> None:
    """The stored setting is on with the Custom proxy of ``ON_CUSTOM``."""
    load_config({"network": {"proxy": ON_CUSTOM}})


@pytest.fixture
def saved_password(client: TestClient) -> Response:
    """The answer to the save that stored a Custom proxy with a username and a password."""
    return client.patch(BASE, json={**ON_CUSTOM, "username": "svc-proxy", "password": SECRET_TEXT})


@pytest.fixture
def registered_blocks(monkeypatch: pytest.MonkeyPatch) -> None:
    """The registry holds only this module's blocks, one of them in two versions."""
    monkeypatch.setattr(plugin_registry._registry, "_plugins", {})
    for block in REGISTERED_BLOCKS:
        plugin_registry.register_plugin(block)


@pytest.fixture
def empty_registry(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(plugin_registry._registry, "_plugins", {})


class TestGet:
    def test_defaults_when_nothing_is_stored(self, client: TestClient) -> None:
        response = client.get(BASE)

        assert response.status_code == 200, response.text
        assert response.json() == DEFAULTS

    @pytest.mark.usefixtures("custom_proxy")
    def test_the_stored_settings(self, client: TestClient) -> None:
        response = client.get(BASE)

        assert response.status_code == 200, response.text
        assert response.json() == _view(CUSTOM_PROXY)

    def test_the_wave_host_values_are_read_on_each_call_with_passwords_masked(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("HTTPS_PROXY", f"http://svc-proxy:{SECRET_TEXT}@proxy.lab.example:3128")
        monkeypatch.setenv("NO_PROXY", "localhost,.lab.example")

        first = client.get(BASE)
        monkeypatch.setenv("HTTP_PROXY", "http://proxy.lab.example:8080")
        second = client.get(BASE)

        assert first.status_code == 200, first.text
        assert first.json() == {
            **DEFAULTS,
            "host_values": {
                "https_proxy": "http://svc-proxy:********@proxy.lab.example:3128",
                "http_proxy": None,
                "no_proxy": "localhost,.lab.example",
            },
        }
        assert SECRET_TEXT not in first.text
        assert second.json()["host_values"]["http_proxy"] == "http://proxy.lab.example:8080"


class TestPatch:
    def test_the_whole_setup_in_one_save(self, client: TestClient) -> None:
        response = client.patch(BASE, json=CUSTOM_PROXY)

        assert response.status_code == 200, response.text
        assert response.json() == _view(CUSTOM_PROXY)
        assert client.get(BASE).json() == response.json()

    @pytest.mark.usefixtures("custom_proxy")
    def test_a_partial_body_changes_only_the_sent_fields(
        self, client: TestClient, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        response = client.patch(BASE, json={"proxy_local_addresses": False})

        assert response.status_code == 200, response.text
        assert response.json() == _view({**CUSTOM_PROXY, "proxy_local_addresses": False})
        assert client.get(BASE).json() == response.json()
        assert config_on_disk()["network"]["proxy"] == {
            **CUSTOM_PROXY,
            "password": None,
            "proxy_local_addresses": False,
        }

    @pytest.mark.usefixtures("custom_proxy")
    def test_entries_replace_the_whole_list(self, client: TestClient) -> None:
        entries = [{"kind": "exact", "address": "http://files.lab.example:8080"}]

        response = client.patch(BASE, json={"entries": entries})

        assert response.status_code == 200, response.text
        assert response.json() == _view({**CUSTOM_PROXY, "entries": entries})

    @pytest.mark.usefixtures("custom_on")
    def test_an_explicit_empty_port_is_read_as_cleared_not_as_omitted(
        self, client: TestClient
    ) -> None:
        response = client.patch(BASE, json={"port": None})

        assert _refusal(response, 400, "VALIDATION_ERROR") == (
            "Port is required when the source is Custom"
        )

    @pytest.mark.usefixtures("saved_password")
    def test_an_explicit_null_username_or_password_is_read_as_omitted(
        self, client: TestClient
    ) -> None:
        response = client.patch(
            BASE, json={"username": None, "password": None, "proxy_local_addresses": True}
        )

        assert response.status_code == 200, response.text
        assert response.json() == _view(
            {**ON_CUSTOM, "username": "svc-proxy", "proxy_local_addresses": True},
            password_set=True,
        )

    @pytest.mark.usefixtures("custom_on")
    def test_unknown_fields_are_ignored(self, client: TestClient) -> None:
        response = client.patch(
            BASE,
            json={
                "proxy_local_addresses": True,
                "password_set": True,
                "host_values": {"https_proxy": "http://other.lab.example:3128"},
                "color": "blue",
            },
        )

        assert response.status_code == 200, response.text
        assert response.json() == _view({**ON_CUSTOM, "proxy_local_addresses": True})

    def test_a_body_of_unknown_fields_alone_changes_nothing(
        self, client: TestClient, config_file: Path
    ) -> None:
        before = config_file.read_bytes()

        response = client.patch(BASE, json={"password_set": True, "color": "blue"})

        assert response.status_code == 200, response.text
        assert response.json() == DEFAULTS
        assert config_file.read_bytes() == before


class TestWhatThePageHidesIsDiscarded:
    """A Save keeps only what the page shows for the saved choice (REQ-4.7.16)."""

    @pytest.mark.usefixtures("saved_password")
    def test_turning_the_proxy_off_discards_everything_else(
        self, client: TestClient, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        response = client.patch(BASE, json={"enabled": False})

        assert response.status_code == 200, response.text
        assert response.json() == DEFAULTS
        assert client.get(BASE).json() == DEFAULTS
        assert _stored_password(config_on_disk) is None

    @pytest.mark.usefixtures("saved_password")
    def test_choosing_the_host_source_discards_the_custom_proxy(
        self,
        client: TestClient,
        monkeypatch: pytest.MonkeyPatch,
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "http://host-proxy.lab.example:3128")

        response = client.patch(BASE, json={"source": "host"})

        assert response.status_code == 200, response.text
        assert response.json() == {
            **DEFAULTS,
            "enabled": True,
            "host_values": {**NO_HOST_VALUES, "https_proxy": "http://host-proxy.lab.example:3128"},
        }
        assert _stored_password(config_on_disk) is None

    @pytest.mark.usefixtures("custom_on")
    def test_a_bad_value_the_page_hides_does_not_stop_the_save(self, client: TestClient) -> None:
        body = {"enabled": False, "host": "http://proxy", "port": 70000}

        assert _problems(client.post(VALIDATE, json=body)) == []
        response = client.patch(BASE, json=body)

        assert response.status_code == 200, response.text
        assert response.json() == DEFAULTS

    def test_what_the_file_holds_while_the_proxy_is_off_is_not_read(
        self, client: TestClient, load_config: Callable[..., Any]
    ) -> None:
        load_config({"network": {"proxy": {**CUSTOM_PROXY, "enabled": False}}})

        assert client.get(BASE).json() == DEFAULTS

    def test_values_sent_while_the_proxy_is_off_are_not_stored(self, client: TestClient) -> None:
        response = client.patch(BASE, json={**CUSTOM_PROXY, "enabled": False})

        assert response.status_code == 200, response.text
        assert response.json() == DEFAULTS
        assert client.get(BASE).json() == DEFAULTS


class TestPatchRefusals:
    @pytest.mark.parametrize(
        ("body", "message"),
        [
            pytest.param({"enabled": True, "source": "custom"}, HOST_REQUIRED, id="no-address"),
            pytest.param({**ON_CUSTOM, "port": 70000}, PORT_RANGE, id="port-out-of-range"),
            pytest.param({"enabled": True}, NO_HOST_PROXY, id="host-source-without-variables"),
            pytest.param(
                {
                    **ON_CUSTOM,
                    "entries": [EXACT_ENTRY, {"kind": "exact", "address": "api.lab.example"}],
                },
                f"Entry 2: {EXACT_FORM}",
                id="bad-entry",
            ),
        ],
    )
    def test_a_rule_failure_is_a_400_and_writes_nothing(
        self, client: TestClient, config_file: Path, body: dict[str, Any], message: str
    ) -> None:
        before = config_file.read_bytes()

        response = client.patch(BASE, json=body)

        assert _refusal(response, 400, "VALIDATION_ERROR") == message
        assert config_file.read_bytes() == before
        assert client.get(BASE).json() == DEFAULTS

    @pytest.mark.parametrize(
        "body",
        [
            pytest.param({**ON_CUSTOM, "username": "svc:proxy"}, id="username-alone"),
            pytest.param(
                {**ON_CUSTOM, "username": "svc:proxy", "password": SECRET_TEXT},
                id="with-a-password",
            ),
            pytest.param({**CUSTOM_PROXY, "username": "svc:proxy"}, id="whole-setup"),
        ],
    )
    def test_a_colon_in_the_username_is_a_400_and_writes_nothing(
        self, client: TestClient, config_file: Path, body: dict[str, Any]
    ) -> None:
        before = config_file.read_bytes()

        response = client.patch(BASE, json=body)

        assert _refusal(response, 400, "VALIDATION_ERROR") == USERNAME_COLON
        assert SECRET_TEXT not in response.text
        assert config_file.read_bytes() == before
        assert client.get(BASE).json() == DEFAULTS

    def test_a_colon_in_the_password_is_saved(
        self, client: TestClient, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        response = client.patch(
            BASE, json={**ON_CUSTOM, "username": "svc-proxy", "password": "pr0xy:s3cret"}
        )

        assert response.status_code == 200, response.text
        assert response.json() == _view({**ON_CUSTOM, "username": "svc-proxy"}, password_set=True)
        assert isinstance(_stored_password(config_on_disk), str)

    @pytest.mark.usefixtures("custom_on")
    @pytest.mark.parametrize(("body", "field", "message"), WRONG_TYPES)
    def test_a_wrong_type_gets_the_message_of_its_own_field(
        self, client: TestClient, config_file: Path, body: dict[str, Any], field: str, message: str
    ) -> None:
        before = config_file.read_bytes()

        response = client.patch(BASE, json=body)

        assert _refusal(response, 400, "VALIDATION_ERROR") == message
        assert config_file.read_bytes() == before

    @pytest.mark.parametrize("path", [BASE, VALIDATE], ids=["patch", "validate"])
    @pytest.mark.parametrize("body", MALFORMED_BODIES)
    def test_a_username_or_password_that_is_not_text_is_a_malformed_body(
        self, client: TestClient, config_file: Path, path: str, body: dict[str, Any]
    ) -> None:
        before = config_file.read_bytes()
        method = "PATCH" if path == BASE else "POST"

        response = client.request(method, path, json=body)

        assert response.status_code == 400, response.text
        assert config_file.read_bytes() == before

    def test_a_read_only_config_file_is_a_500_and_writes_nothing(
        self, client: TestClient, read_only_config: Path
    ) -> None:
        before = read_only_config.read_bytes()

        response = client.patch(BASE, json=ON_CUSTOM)

        assert _refusal(response, 500, "INTERNAL_ERROR") == (
            f"Settings cannot be saved: the config file {read_only_config} is read-only"
        )
        assert read_only_config.read_bytes() == before
        assert client.get(BASE).json() == DEFAULTS

    def test_the_refusal_is_the_first_problem_the_check_lists(self, client: TestClient) -> None:
        listed = _problems(client.post(VALIDATE, json=SEVERAL_FAULTS))

        response = client.patch(BASE, json=SEVERAL_FAULTS)

        assert _refusal(response, 400, "VALIDATION_ERROR") == listed[0]["message"]
        assert listed[0]["message"] == HOST_REQUIRED


class TestPasswordIsWriteOnly:
    def test_a_saved_password_shows_only_as_password_set(
        self,
        client: TestClient,
        saved_password: Response,
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        read = client.get(BASE)

        for response in (saved_password, read):
            assert response.status_code == 200, response.text
            assert response.json() == _view(
                {**ON_CUSTOM, "username": "svc-proxy"}, password_set=True
            )
            assert "password" not in response.json()
            assert SECRET_TEXT not in response.text
        stored = _stored_password(config_on_disk)
        assert isinstance(stored, str)
        assert stored not in saved_password.text
        assert stored not in read.text

    @pytest.mark.usefixtures("saved_password")
    def test_an_omitted_password_stays_and_an_empty_one_removes_it(
        self, client: TestClient
    ) -> None:
        kept = client.patch(BASE, json={"proxy_local_addresses": True})
        removed = client.patch(BASE, json={"password": ""})

        assert kept.status_code == 200, kept.text
        assert kept.json()["password_set"] is True
        assert removed.status_code == 200, removed.text
        assert removed.json() == _view(
            {**ON_CUSTOM, "username": "svc-proxy", "proxy_local_addresses": True}
        )

    @pytest.mark.usefixtures("custom_on")
    def test_a_refusal_does_not_repeat_the_password(self, client: TestClient) -> None:
        response = client.patch(BASE, json={"password": SECRET_TEXT})

        assert _refusal(response, 400, "VALIDATION_ERROR") == USERNAME_REQUIRED
        assert SECRET_TEXT not in response.text
        assert client.get(BASE).json() == _view(ON_CUSTOM)

    @pytest.mark.usefixtures("custom_on")
    def test_the_check_does_not_repeat_the_password(self, client: TestClient) -> None:
        response = client.post(VALIDATE, json={"password": SECRET_TEXT})

        assert _problems(response) == [
            {"field": "username", "row": None, "message": USERNAME_REQUIRED}
        ]
        assert SECRET_TEXT not in response.text


class TestNoPut:
    def test_put_is_not_allowed(self, client: TestClient, config_file: Path) -> None:
        before = config_file.read_bytes()

        response = client.put(BASE, json=CUSTOM_PROXY)

        assert response.status_code == 405, response.text
        assert config_file.read_bytes() == before


class TestValidate:
    @pytest.mark.parametrize("body", [{}, CUSTOM_PROXY], ids=["nothing-staged", "custom-proxy"])
    def test_nothing_wrong_is_an_empty_list(self, client: TestClient, body: dict[str, Any]) -> None:
        response = client.post(VALIDATE, json=body)

        assert response.status_code == 200, response.text
        assert response.json() == {"problems": []}

    def test_every_problem_is_listed_at_once_in_rule_order(self, client: TestClient) -> None:
        response = client.post(VALIDATE, json=SEVERAL_FAULTS)

        assert _problems(response) == SEVERAL_PROBLEMS

    @pytest.mark.usefixtures("custom_on")
    @pytest.mark.parametrize(("body", "field", "message"), WRONG_TYPES)
    def test_a_wrong_type_is_a_problem_of_its_own_field(
        self, client: TestClient, body: dict[str, Any], field: str, message: str
    ) -> None:
        response = client.post(VALIDATE, json=body)

        assert _problems(response)[0] == {"field": field, "row": None, "message": message}

    @pytest.mark.usefixtures("custom_proxy")
    def test_the_staged_values_are_checked_over_the_stored_settings(
        self, client: TestClient
    ) -> None:
        response = client.post(VALIDATE, json={"host": ""})

        assert _problems(response) == [{"field": "host", "row": None, "message": HOST_REQUIRED}]

    @pytest.mark.usefixtures("custom_on")
    def test_a_colon_in_the_username_is_a_problem_of_the_username_with_no_row(
        self, client: TestClient
    ) -> None:
        response = client.post(VALIDATE, json={"username": "svc:proxy"})

        assert _problems(response) == [
            {"field": "username", "row": None, "message": USERNAME_COLON}
        ]

    def test_a_colon_in_the_password_is_no_problem(self, client: TestClient) -> None:
        response = client.post(VALIDATE, json={"username": "svc-proxy", "password": "pr0xy:s3cret"})

        assert _problems(response) == []

    @pytest.mark.parametrize("body", [CUSTOM_PROXY, SEVERAL_FAULTS], ids=["valid", "faulty"])
    def test_nothing_is_written(
        self, client: TestClient, config_file: Path, body: dict[str, Any]
    ) -> None:
        before = config_file.read_bytes()

        response = client.post(VALIDATE, json=body)

        assert response.status_code == 200, response.text
        assert config_file.read_bytes() == before
        assert client.get(BASE).json() == DEFAULTS

    def test_a_body_that_is_not_json_is_a_malformed_request(self, client: TestClient) -> None:
        response = client.post(
            VALIDATE, content=b"not json", headers={"content-type": "application/json"}
        )

        assert response.status_code == 400, response.text


class TestBlocks:
    @pytest.mark.usefixtures("registered_blocks")
    def test_every_registered_plugin_is_listed_once_under_what_it_declares(
        self, client: TestClient
    ) -> None:
        response = client.get(BLOCKS)

        assert response.status_code == 200, response.text
        body = response.json()
        assert set(body) == set(BLOCK_LISTS)
        assert {name: _by_id(blocks) for name, blocks in body.items()} == BLOCK_LISTS

    @pytest.mark.usefixtures("empty_registry")
    def test_the_three_lists_are_there_when_nothing_is_registered(self, client: TestClient) -> None:
        response = client.get(BLOCKS)

        assert response.status_code == 200, response.text
        assert response.json() == {"supported": [], "unsupported": [], "not_applicable": []}
