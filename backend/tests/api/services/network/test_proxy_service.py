"""Settings > Network > Proxy service (REQ-4.7.14).

The setting is the `network.proxy` section of the test's config file. Every test starts on a
WAVE host that sets none of the proxy variables; a test that needs one sets it.
"""

import contextvars
import os
import re
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest

from wavecore.api.config import get_config
from wavecore.api.config.instance_settings import SECTION_DEFAULTS
from wavecore.api.config.write_back import ConfigWriteError
from wavecore.api.exceptions import ValidationException
from wavecore.api.services.network import proxy as proxy_service
from wavecore.connectivity import proxy
from wavecore.connectivity.proxy import ProxyEndpoint, ProxyError, ProxySpec
from wavecore.connectivity.run_log import RUN_LOG, RunLog
from wavecore.core.secrets.cipher import ENVELOPE_PREFIX, SecretCipher
from wavecore.core.secrets.key_provider import get_cipher
from wavecore.core.secrets.sealing import seal_value

SECRET = "hunter2-secret"
PROXY_VARIABLES = (
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "NO_PROXY",
    "https_proxy",
    "http_proxy",
    "no_proxy",
)

NO_HOST_VALUES: dict[str, str | None] = {"https_proxy": None, "http_proxy": None, "no_proxy": None}
DEFAULT_SETTINGS: dict[str, Any] = {
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
STORED_DEFAULTS: dict[str, Any] = {
    "enabled": False,
    "source": "host",
    "host": "",
    "port": None,
    "username": "",
    "password": None,
    "list_mode": "except",
    "entries": [],
    "proxy_local_addresses": False,
}
CUSTOM_ON: dict[str, Any] = {
    "enabled": True,
    "source": "custom",
    "host": "proxy.example",
    "port": 3128,
}

ENABLED_MESSAGE = "Use a proxy must be true or false"
SOURCE_MESSAGE = "Source must be 'host' or 'custom'"
LIST_MODE_MESSAGE = "Use the proxy for must be 'except' or 'only'"
LOCAL_MESSAGE = "Use the proxy for local addresses too must be true or false"
HOST_TEXT_MESSAGE = "IP or Hostname must be text"
LIST_SHAPE_MESSAGE = "The address list must be a list of entries with a kind and an address"
HOST_REQUIRED_MESSAGE = "IP or Hostname is required when the source is Custom"
HOST_LENGTH_MESSAGE = "IP or Hostname must be 253 characters or fewer"
HOST_FORM_MESSAGE = (
    "IP or Hostname must be an IP address or a host name, with no protocol and no port"
)
PORT_REQUIRED_MESSAGE = "Port is required when the source is Custom"
PORT_MESSAGE = "Port must be a whole number from 1 to 65535"
USERNAME_LENGTH_MESSAGE = "Username must be 255 characters or fewer"
USERNAME_COLON_MESSAGE = "Username must not contain a colon"
PASSWORD_LENGTH_MESSAGE = "Password must be 255 characters or fewer"
USERNAME_REQUIRED_MESSAGE = "Username is required when a proxy password is set"
LIST_LIMIT_MESSAGE = "The address list holds at most 100 entries"
KIND_MESSAGE = "Choose Exact or Regex"
ADDRESS_REQUIRED_MESSAGE = "An address is required"
ADDRESS_LENGTH_MESSAGE = "An address must be 256 characters or fewer"
EXACT_FORM_MESSAGE = "An exact address is http:// or https://, a host and an optional port"
EXACT_TAIL_MESSAGE = "Remove everything after the host and port"
REGEX_MESSAGE_PATTERN = r"Not a valid regular expression: \S.*"
ONLY_EMPTY_MESSAGE = 'Add at least one address, or choose "All addresses except the list"'
NO_HOST_VARIABLE_MESSAGE = (
    "This WAVE host has no HTTPS_PROXY or HTTP_PROXY set: choose Custom or turn the proxy off"
)
DIRECT_WARNING = (
    "The proxy is on with WAVE host's settings, "
    "but this WAVE host sets no HTTPS_PROXY or HTTP_PROXY: connecting directly"
)
UNREADABLE_SECRET_MESSAGE = (
    "Secret decryption failed: ciphertext is corrupt or the encryption key is invalid"
)

Lines = list[tuple[str, str]]


def _unusable_message(value: str) -> str:
    return (
        f"This WAVE host's proxy address {value} is not an http:// address: "
        "choose Custom or turn the proxy off"
    )


def _exactly(message: str) -> str:
    return f"^{re.escape(message)}$"


def _read_only_message(path: Path) -> str:
    return _exactly(f"Settings cannot be saved: the config file {path} is read-only")


def _settings(**changes: Any) -> dict[str, Any]:
    return {**DEFAULT_SETTINGS, **changes}


def _custom(**changes: Any) -> dict[str, Any]:
    """The settings of a WAVE whose stored proxy is the Custom one of ``CUSTOM_ON``."""
    return {**DEFAULT_SETTINGS, **CUSTOM_ON, **changes}


def _host_values(**held: str) -> dict[str, str | None]:
    return {**NO_HOST_VALUES, **held}


def _proxy_config(**values: Any) -> dict[str, Any]:
    return {"network": {"proxy": values}}


def _exact(address: str) -> dict[str, str]:
    return {"kind": "exact", "address": address}


def _regex(address: str) -> dict[str, str]:
    return {"kind": "regex", "address": address}


def _entries(count: int) -> list[dict[str, str]]:
    return [_exact(f"https://host-{number}.example") for number in range(1, count + 1)]


def _problem(field: str, message: str, row: int | None = None) -> dict[str, Any]:
    return {"field": field, "row": row, "message": message}


def _endpoint(
    host: str, port: int, username: str | None = None, password: str | None = None
) -> ProxyEndpoint:
    return ProxyEndpoint(host=host, port=port, username=username, password=password)


CUSTOM_ENDPOINT = _endpoint("proxy.example", 3128)


def _spec() -> ProxySpec:
    """The proxy in force, which the test expects to exist."""
    spec = proxy_service.current_proxy_spec()
    assert isinstance(spec, ProxySpec)
    return spec


def _stored_proxy(config_on_disk: Callable[[], dict[str, Any]]) -> dict[str, Any]:
    """The `network.proxy` section as the config file holds it right now."""
    return dict(config_on_disk().get("network", {}).get("proxy", {}))


def _sealed_by_another_wave(value: str) -> str:
    """The value sealed with a key this WAVE does not hold."""
    return SecretCipher(os.urandom(32)).seal(value)


def _unsealed_on_disk(config_on_disk: Callable[[], dict[str, Any]]) -> Any:
    """The stored proxy password in plain text, unsealed from the config file."""
    sealed = _stored_proxy(config_on_disk)["password"]
    assert isinstance(sealed, str)
    assert sealed.startswith(ENVELOPE_PREFIX)
    return get_cipher().unseal(sealed)


def _in_run(body: Callable[[], object]) -> Lines:
    """Run `body` as one block run of its own and return the lines that run logged."""
    lines: Lines = []

    def run() -> None:
        RUN_LOG.set(RunLog(lambda level, message: lines.append((level, message))))
        body()

    contextvars.copy_context().run(run)
    return lines


@pytest.fixture(autouse=True)
def no_proxy_variables(monkeypatch: pytest.MonkeyPatch) -> None:
    """A WAVE host that sets none of the proxy variables, in either spelling."""
    for name in PROXY_VARIABLES:
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def refused(config_file: Path) -> Callable[..., None]:
    """Assert that an update is refused with exactly this text and that nothing is written."""

    def _refused(message: str, **subset: Any) -> None:
        settings = proxy_service.get_settings()
        on_disk = config_file.read_bytes()
        with pytest.raises(ValidationException, match=_exactly(message)):
            proxy_service.update_settings(**subset)
        assert config_file.read_bytes() == on_disk
        assert proxy_service.get_settings() == settings

    return _refused


@pytest.fixture
def custom_proxy_on(load_config: Callable[..., Any]) -> None:
    """The stored setting is on with a Custom proxy, so the page shows every Custom field."""
    load_config(_proxy_config(**CUSTOM_ON))


@pytest.fixture
def host_source_on(load_config: Callable[..., Any]) -> None:
    """The stored setting is on with the WAVE host's settings, whatever the variables hold."""
    load_config(_proxy_config(enabled=True, source="host"))


@pytest.fixture
def run_lines() -> Iterator[Lines]:
    """One block run: its log sink is active for the test and removed after."""
    lines: Lines = []
    token = RUN_LOG.set(RunLog(lambda level, message: lines.append((level, message))))
    yield lines
    RUN_LOG.reset(token)


class TestDefaults:
    def test_a_fresh_config_gives_the_defaults(self) -> None:
        assert proxy_service.get_settings() == DEFAULT_SETTINGS

    def test_the_password_itself_is_never_part_of_the_settings(self) -> None:
        settings = proxy_service.get_settings()

        assert settings["password_set"] is False
        assert "password" not in settings

    def test_the_wave_hosts_values_are_read_with_the_settings(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        assert proxy_service.get_settings()["host_values"] == NO_HOST_VALUES

        monkeypatch.setenv("HTTPS_PROXY", "http://proxy.example:3128")

        assert proxy_service.get_settings() == _settings(
            host_values=_host_values(https_proxy="http://proxy.example:3128")
        )

    def test_reading_the_settings_writes_nothing(
        self, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        proxy_service.get_settings()

        assert config_on_disk() == {}


class TestStoredSettings:
    def test_the_settings_are_read_from_the_network_proxy_section(
        self, load_config: Callable[..., Any]
    ) -> None:
        load_config(
            _proxy_config(
                enabled=True,
                source="custom",
                host="proxy.example",
                port=3128,
                username="ops",
                password=seal_value(SECRET),
                list_mode="only",
                entries=[_exact("https://a.example")],
                proxy_local_addresses=True,
            )
        )

        assert proxy_service.get_settings() == _settings(
            enabled=True,
            source="custom",
            host="proxy.example",
            port=3128,
            username="ops",
            password_set=True,
            list_mode="only",
            entries=[_exact("https://a.example")],
            proxy_local_addresses=True,
        )

    def test_a_partial_section_is_merged_over_the_defaults(
        self, load_config: Callable[..., Any]
    ) -> None:
        partial = {"enabled": True, "source": "custom", "host": "proxy.example"}
        load_config(_proxy_config(**partial))

        assert proxy_service.get_settings() == _settings(**partial)

    def test_what_the_file_holds_for_a_setting_the_page_hides_is_not_shown(
        self, load_config: Callable[..., Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        custom = {"host": "proxy.example", "port": 3128, "username": "ops", "list_mode": "only"}
        load_config(_proxy_config(source="custom", **custom))

        assert proxy_service.get_settings() == DEFAULT_SETTINGS

        monkeypatch.setenv("HTTPS_PROXY", "http://host-proxy.example:8080")
        load_config(_proxy_config(enabled=True, source="host", **custom))

        assert proxy_service.get_settings() == _settings(
            enabled=True, host_values=_host_values(https_proxy="http://host-proxy.example:8080")
        )

    def test_an_update_returns_the_settings_now_in_force(self) -> None:
        result = proxy_service.update_settings(**CUSTOM_ON)

        assert result == _settings(**CUSTOM_ON)
        assert result == proxy_service.get_settings()

    def test_an_update_changes_the_running_config(self) -> None:
        proxy_service.update_settings(**CUSTOM_ON)

        assert get_config().get("network.proxy.enabled") is True
        assert get_config().get("network.proxy.source") == "custom"
        assert get_config().get("network.proxy.host") == "proxy.example"
        assert get_config().get("network.proxy.port") == 3128

    def test_an_update_survives_a_restart(self, load_config: Callable[..., Any]) -> None:
        saved = proxy_service.update_settings(
            **CUSTOM_ON, username="ops", password=SECRET, entries=[_regex(r"corp\.example")]
        )

        load_config()

        assert proxy_service.get_settings() == saved
        assert _spec().https == _endpoint("proxy.example", 3128, "ops", SECRET)

    def test_a_partial_update_leaves_the_other_values_alone(self) -> None:
        proxy_service.update_settings(**CUSTOM_ON, username="ops")

        result = proxy_service.update_settings(port=8080)

        assert result == _settings(**{**CUSTOM_ON, "port": 8080}, username="ops")

    def test_a_field_the_setting_does_not_hold_is_ignored(self, config_file: Path) -> None:
        before = config_file.read_bytes()
        unknown = {"color": "blue", "password_set": True, "host_values": {"https_proxy": "x"}}

        assert proxy_service.validate_settings(**unknown) == []
        assert proxy_service.update_settings(**unknown) == DEFAULT_SETTINGS
        assert config_file.read_bytes() == before


class TestFieldRules:
    """Each field rule on its own; a refusal writes nothing."""

    @pytest.mark.parametrize("value", ["true", "yes", 1, 0])
    def test_use_a_proxy_is_true_or_false(self, refused: Callable[..., None], value: Any) -> None:
        refused(ENABLED_MESSAGE, enabled=value)

    @pytest.mark.parametrize("value", ["system", "wave", 7])
    @pytest.mark.usefixtures("custom_proxy_on")
    def test_the_source_is_host_or_custom(self, refused: Callable[..., None], value: Any) -> None:
        refused(SOURCE_MESSAGE, source=value)

    @pytest.mark.parametrize("value", ["include", "all", 7])
    @pytest.mark.usefixtures("custom_proxy_on")
    def test_the_list_mode_is_except_or_only(
        self, refused: Callable[..., None], value: Any
    ) -> None:
        refused(LIST_MODE_MESSAGE, list_mode=value)

    @pytest.mark.parametrize("value", ["true", "yes", 1, 0])
    @pytest.mark.usefixtures("custom_proxy_on")
    def test_the_local_addresses_switch_is_true_or_false(
        self, refused: Callable[..., None], value: Any
    ) -> None:
        refused(LOCAL_MESSAGE, proxy_local_addresses=value)

    @pytest.mark.parametrize("value", [5, ["proxy.example"], True])
    @pytest.mark.usefixtures("custom_proxy_on")
    def test_the_address_is_text(self, refused: Callable[..., None], value: Any) -> None:
        refused(HOST_TEXT_MESSAGE, host=value)

    @pytest.mark.parametrize(
        "value",
        [
            pytest.param("https://a.example", id="text"),
            pytest.param(7, id="number"),
            pytest.param({"kind": "exact", "address": "https://a.example"}, id="one-entry-alone"),
            pytest.param(["https://a.example"], id="list-of-text"),
            pytest.param([{"kind": "exact"}], id="entry-without-address"),
            pytest.param([{"address": "https://a.example"}], id="entry-without-kind"),
        ],
    )
    @pytest.mark.usefixtures("custom_proxy_on")
    def test_the_list_holds_entries_with_a_kind_and_an_address(
        self, refused: Callable[..., None], value: Any
    ) -> None:
        refused(LIST_SHAPE_MESSAGE, entries=value)

    @pytest.mark.usefixtures("custom_proxy_on")
    def test_an_address_longer_than_253_characters_is_refused(
        self, refused: Callable[..., None]
    ) -> None:
        refused(HOST_LENGTH_MESSAGE, host="a" * 254)

    @pytest.mark.usefixtures("custom_proxy_on")
    def test_a_host_name_of_253_characters_is_accepted(self) -> None:
        host = ".".join(["a" * 63, "b" * 63, "c" * 63, "d" * 61])
        assert len(host) == 253

        assert proxy_service.update_settings(host=host) == _custom(host=host)

    @pytest.mark.parametrize(
        "value",
        [
            pytest.param("http://proxy.example", id="protocol"),
            pytest.param("proxy.example:3128", id="port"),
            pytest.param("proxy.example/path", id="path"),
            pytest.param("ops@proxy.example", id="login"),
            pytest.param("proxy example", id="space"),
        ],
    )
    @pytest.mark.usefixtures("custom_proxy_on")
    def test_the_address_is_an_ip_address_or_a_host_name_and_nothing_else(
        self, refused: Callable[..., None], value: str
    ) -> None:
        refused(HOST_FORM_MESSAGE, host=value)

    @pytest.mark.parametrize("value", ["10.20.30.40", "proxy.example", "proxy"])
    @pytest.mark.usefixtures("custom_proxy_on")
    def test_an_ip_address_and_a_host_name_are_accepted(self, value: str) -> None:
        assert proxy_service.update_settings(host=value) == _custom(host=value)

    @pytest.mark.parametrize(
        "value",
        [
            pytest.param("[10.20.30.40]", id="ipv4-in-brackets"),
            pytest.param("[proxy.example]", id="host-name-in-brackets"),
            pytest.param("[2001:db8::1", id="bracket-left-open"),
            pytest.param("proxy..example", id="empty-label"),
            pytest.param("   ", id="only-spaces"),
        ],
    )
    @pytest.mark.usefixtures("custom_proxy_on")
    def test_brackets_are_for_an_ipv6_address_and_a_host_name_holds_no_space(
        self, refused: Callable[..., None], value: str
    ) -> None:
        refused(HOST_FORM_MESSAGE, host=value)

    @pytest.mark.parametrize(
        "value",
        [
            pytest.param("2001:db8::1", id="ipv6"),
            pytest.param("[2001:db8::1]", id="ipv6-in-brackets"),
            pytest.param("squid_proxy", id="underscore"),
            pytest.param("pröxy.example", id="letter-outside-ascii"),
            pytest.param("Proxy.Example", id="mixed-case"),
        ],
    )
    @pytest.mark.usefixtures("custom_proxy_on")
    def test_an_ipv6_address_and_any_host_name_are_stored_as_typed(self, value: str) -> None:
        assert proxy_service.update_settings(host=value) == _custom(host=value)

    @pytest.mark.parametrize(
        "value",
        [
            pytest.param(0, id="zero"),
            pytest.param(-1, id="negative"),
            pytest.param(65536, id="above-the-range"),
            pytest.param("+3128", id="digits-with-a-plus"),
            pytest.param("3128.0", id="digits-with-a-dot"),
            pytest.param("65536", id="digits-above-the-range"),
            pytest.param("12345678901234567890", id="digits-past-the-cap"),
            pytest.param("abc", id="text"),
            pytest.param(True, id="true"),
            pytest.param(False, id="false"),
            pytest.param(3128.5, id="fraction"),
        ],
    )
    @pytest.mark.usefixtures("custom_proxy_on")
    def test_the_port_is_a_whole_number_from_1_to_65535(
        self, refused: Callable[..., None], value: Any
    ) -> None:
        refused(PORT_MESSAGE, port=value)

    @pytest.mark.parametrize("value", [1, 3128, 65535])
    @pytest.mark.usefixtures("custom_proxy_on")
    def test_a_port_in_range_is_accepted(self, value: int) -> None:
        result = proxy_service.update_settings(port=value)

        assert result == _custom(port=value)
        assert type(result["port"]) is int

    @pytest.mark.parametrize(("written", "stored"), [("3128", 3128), ("08080", 8080)])
    @pytest.mark.usefixtures("custom_proxy_on")
    def test_a_port_sent_as_its_digits_is_stored_as_the_number(
        self, written: str, stored: int
    ) -> None:
        result = proxy_service.update_settings(port=written)

        assert result == _custom(port=stored)
        assert get_config().get("network.proxy.port") == stored

    @pytest.mark.usefixtures("custom_proxy_on")
    def test_a_username_longer_than_255_characters_is_refused(
        self, refused: Callable[..., None]
    ) -> None:
        refused(USERNAME_LENGTH_MESSAGE, username="u" * 256)

    @pytest.mark.usefixtures("custom_proxy_on")
    def test_a_password_longer_than_255_characters_is_refused(
        self, refused: Callable[..., None]
    ) -> None:
        refused(PASSWORD_LENGTH_MESSAGE, username="ops", password="p" * 256)

    @pytest.mark.usefixtures("custom_proxy_on")
    def test_a_username_and_a_password_of_255_characters_are_accepted(
        self, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        result = proxy_service.update_settings(username="u" * 255, password="p" * 255)

        assert result == _custom(username="u" * 255, password_set=True)
        assert _unsealed_on_disk(config_on_disk) == "p" * 255

    @pytest.mark.parametrize(
        "value",
        [
            pytest.param("ops:team", id="in-the-middle"),
            pytest.param(":ops", id="at-the-start"),
            pytest.param("ops:", id="at-the-end"),
            pytest.param("corp:ops:team", id="twice"),
        ],
    )
    @pytest.mark.usefixtures("custom_proxy_on")
    def test_a_username_with_a_colon_is_refused(
        self, refused: Callable[..., None], value: str
    ) -> None:
        refused(USERNAME_COLON_MESSAGE, username=value)

    @pytest.mark.usefixtures("custom_proxy_on")
    def test_a_username_with_a_colon_is_refused_with_a_password_too(
        self, refused: Callable[..., None], config_file: Path
    ) -> None:
        refused(USERNAME_COLON_MESSAGE, username="ops:team", password=SECRET)

        assert ENVELOPE_PREFIX not in config_file.read_text(encoding="utf-8")

    def test_a_stored_username_with_a_colon_refuses_a_save_of_another_field(
        self, refused: Callable[..., None], load_config: Callable[..., Any]
    ) -> None:
        load_config(_proxy_config(**CUSTOM_ON, username="ops:team"))

        refused(USERNAME_COLON_MESSAGE, port=8080)

    def test_a_stored_username_with_a_colon_can_be_replaced(
        self, load_config: Callable[..., Any]
    ) -> None:
        load_config(_proxy_config(**CUSTOM_ON, username="ops:team"))

        assert proxy_service.update_settings(username="ops") == _custom(username="ops")

    @pytest.mark.usefixtures("custom_proxy_on")
    def test_a_colon_in_the_password_is_allowed(
        self, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        result = proxy_service.update_settings(username="ops", password="pa:ss:w0rd")

        assert result == _custom(username="ops", password_set=True)
        assert _unsealed_on_disk(config_on_disk) == "pa:ss:w0rd"

    def test_a_blank_address_and_an_empty_port_pass_while_the_proxy_is_off(self) -> None:
        assert proxy_service.update_settings(host="", port=None) == DEFAULT_SETTINGS

    def test_a_blank_address_and_an_empty_port_pass_under_the_host_source(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "http://proxy.example:3128")

        result = proxy_service.update_settings(enabled=True, source="host", host="", port=None)

        assert result == _settings(
            enabled=True, host_values=_host_values(https_proxy="http://proxy.example:3128")
        )

    @pytest.mark.usefixtures("custom_proxy_on")
    def test_a_null_username_is_read_as_omitted(self) -> None:
        proxy_service.update_settings(username="ops")

        result = proxy_service.update_settings(username=None, port=3128)

        assert result == _custom(username="ops", port=3128)

    @pytest.mark.usefixtures("custom_proxy_on")
    def test_a_null_password_is_read_as_omitted(
        self, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        proxy_service.update_settings(username="ops", password=SECRET)
        sealed = _stored_proxy(config_on_disk)["password"]

        result = proxy_service.update_settings(password=None)

        assert result == _custom(username="ops", password_set=True)
        assert _stored_proxy(config_on_disk)["password"] == sealed

    def test_a_null_password_is_not_a_new_password(self) -> None:
        assert proxy_service.update_settings(password=None) == DEFAULT_SETTINGS


class TestCustomRules:
    """The rules that apply only while the proxy is on and the source is Custom."""

    def test_a_complete_custom_proxy_is_accepted(self) -> None:
        assert proxy_service.update_settings(**CUSTOM_ON) == _settings(**CUSTOM_ON)

    def test_a_custom_proxy_needs_an_address(self, refused: Callable[..., None]) -> None:
        refused(HOST_REQUIRED_MESSAGE, enabled=True, source="custom", port=3128)

    def test_a_custom_proxy_needs_a_port(self, refused: Callable[..., None]) -> None:
        refused(PORT_REQUIRED_MESSAGE, enabled=True, source="custom", host="proxy.example")

    def test_only_mode_needs_one_entry(self, refused: Callable[..., None]) -> None:
        refused(ONLY_EMPTY_MESSAGE, **CUSTOM_ON, list_mode="only")

    def test_only_mode_with_one_entry_is_accepted(self) -> None:
        entries = [_exact("https://a.example")]

        result = proxy_service.update_settings(**CUSTOM_ON, list_mode="only", entries=entries)

        assert result == _settings(**CUSTOM_ON, list_mode="only", entries=entries)

    def test_the_address_cannot_be_cleared_while_the_custom_proxy_is_on(
        self, refused: Callable[..., None]
    ) -> None:
        proxy_service.update_settings(**CUSTOM_ON)

        refused(HOST_REQUIRED_MESSAGE, host="")

    def test_the_port_cannot_be_cleared_while_the_custom_proxy_is_on(
        self, refused: Callable[..., None]
    ) -> None:
        proxy_service.update_settings(**CUSTOM_ON)

        refused(PORT_REQUIRED_MESSAGE, port=None)

    def test_the_last_entry_cannot_be_removed_in_only_mode(
        self, refused: Callable[..., None]
    ) -> None:
        proxy_service.update_settings(
            **CUSTOM_ON, list_mode="only", entries=[_exact("https://a.example")]
        )

        refused(ONLY_EMPTY_MESSAGE, entries=[])

    def test_a_custom_proxy_the_file_holds_while_off_does_not_come_back(
        self, refused: Callable[..., None], load_config: Callable[..., Any]
    ) -> None:
        # Only a config file edited by hand holds a Custom proxy while the proxy is off.
        load_config(_proxy_config(source="custom", host="proxy.example", port=3128))

        refused(NO_HOST_VARIABLE_MESSAGE, enabled=True)
        refused(HOST_REQUIRED_MESSAGE, enabled=True, source="custom")

    def test_choosing_custom_while_on_needs_the_address_and_the_port(
        self, refused: Callable[..., None], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "http://proxy.example:3128")
        proxy_service.update_settings(enabled=True, source="host")

        refused(HOST_REQUIRED_MESSAGE, source="custom")

    def test_what_the_page_hides_while_the_proxy_is_off_is_not_checked(self) -> None:
        result = proxy_service.update_settings(source="custom", list_mode="only", port=0)

        assert result == DEFAULT_SETTINGS

    def test_what_the_page_hides_under_the_host_source_is_not_checked(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "http://proxy.example:3128")

        result = proxy_service.update_settings(
            enabled=True, source="host", list_mode="only", port=0
        )

        assert result == _settings(
            enabled=True, host_values=_host_values(https_proxy="http://proxy.example:3128")
        )

    def test_turning_the_proxy_off_allows_clearing_the_address_and_the_port(self) -> None:
        proxy_service.update_settings(**CUSTOM_ON)

        result = proxy_service.update_settings(enabled=False, host="", port=None)

        assert result == DEFAULT_SETTINGS


class TestEntryRules:
    """A problem of one list entry reads `Entry {n}: ` plus the entry message."""

    @pytest.mark.usefixtures("custom_proxy_on")
    def test_the_list_holds_at_most_100_entries(self, refused: Callable[..., None]) -> None:
        refused(LIST_LIMIT_MESSAGE, entries=_entries(101))

    @pytest.mark.usefixtures("custom_proxy_on")
    def test_100_entries_are_accepted(self) -> None:
        result = proxy_service.update_settings(entries=_entries(100))

        assert result == _custom(entries=_entries(100))

    @pytest.mark.parametrize(
        ("entry", "message"),
        [
            pytest.param({"kind": "glob", "address": "https://a.example"}, KIND_MESSAGE, id="kind"),
            pytest.param(_exact(""), ADDRESS_REQUIRED_MESSAGE, id="blank-exact"),
            pytest.param(_regex(""), ADDRESS_REQUIRED_MESSAGE, id="blank-regex"),
            pytest.param(_regex("a" * 257), ADDRESS_LENGTH_MESSAGE, id="long-regex"),
            pytest.param(_exact("https://" + "a" * 249), ADDRESS_LENGTH_MESSAGE, id="long-exact"),
            pytest.param(_exact("a.example"), EXACT_FORM_MESSAGE, id="no-protocol"),
            pytest.param(_exact("ftp://a.example"), EXACT_FORM_MESSAGE, id="other-protocol"),
            pytest.param(_exact("https://"), EXACT_FORM_MESSAGE, id="no-host"),
            pytest.param(_exact("https://ops@a.example"), EXACT_FORM_MESSAGE, id="login"),
            pytest.param(_exact("https://a.example?debug=1"), EXACT_FORM_MESSAGE, id="query"),
            pytest.param(_exact("https://a.example#top"), EXACT_FORM_MESSAGE, id="fragment"),
            pytest.param(_exact("https://a.example/"), EXACT_TAIL_MESSAGE, id="trailing-slash"),
            pytest.param(_exact("https://a.example:8443/api"), EXACT_TAIL_MESSAGE, id="path"),
        ],
    )
    @pytest.mark.usefixtures("custom_proxy_on")
    def test_an_entry_problem_names_its_entry(
        self, refused: Callable[..., None], entry: dict[str, str], message: str
    ) -> None:
        refused(f"Entry 2: {message}", entries=[_exact("https://ok.example"), entry])

    @pytest.mark.usefixtures("custom_proxy_on")
    def test_a_regex_that_does_not_compile_names_the_engines_reason(
        self, config_file: Path
    ) -> None:
        before = config_file.read_bytes()

        with pytest.raises(ValidationException, match=f"^Entry 1: {REGEX_MESSAGE_PATTERN}$"):
            proxy_service.update_settings(entries=[_regex("(unclosed")])

        assert config_file.read_bytes() == before
        assert proxy_service.get_settings() == _custom()

    @pytest.mark.usefixtures("custom_proxy_on")
    def test_a_regex_of_256_characters_is_accepted(self) -> None:
        entries = [_regex("a" * 256)]

        assert proxy_service.update_settings(entries=entries) == _custom(entries=entries)

    @pytest.mark.usefixtures("custom_proxy_on")
    def test_an_exact_entry_equal_to_an_earlier_one_is_refused(
        self, refused: Callable[..., None]
    ) -> None:
        refused(
            "Entry 3: The same address as entry 1",
            entries=[
                _exact("https://a.example"),
                _exact("https://b.example"),
                _exact("https://A.example:443"),
            ],
        )

    @pytest.mark.usefixtures("custom_proxy_on")
    def test_a_regex_entry_equal_to_an_earlier_one_is_refused(
        self, refused: Callable[..., None]
    ) -> None:
        refused(
            "Entry 2: The same address as entry 1",
            entries=[_regex(r"corp\.example"), _regex(r"corp\.example")],
        )

    @pytest.mark.usefixtures("custom_proxy_on")
    def test_an_exact_and_a_regex_entry_with_the_same_text_are_two_entries(self) -> None:
        entries = [_exact("https://a.example"), _regex("https://a.example")]

        assert proxy_service.update_settings(entries=entries) == _custom(entries=entries)


class TestRuleOrder:
    """When two rules fail, the refusal is the one that comes first in the rule order."""

    @pytest.mark.parametrize(
        ("subset", "message"),
        [
            pytest.param(
                {"enabled": "yes", "source": "system"}, ENABLED_MESSAGE, id="switch-then-source"
            ),
            pytest.param(
                {"source": "system", "list_mode": "all"}, SOURCE_MESSAGE, id="source-then-mode"
            ),
            pytest.param(
                {"list_mode": "all", "proxy_local_addresses": "yes"},
                LIST_MODE_MESSAGE,
                id="mode-then-local-switch",
            ),
            pytest.param(
                {"proxy_local_addresses": "yes", "host": 5},
                LOCAL_MESSAGE,
                id="local-switch-then-address-type",
            ),
            pytest.param(
                {"host": 5, "entries": "https://a.example"},
                HOST_TEXT_MESSAGE,
                id="address-type-then-list-shape",
            ),
            pytest.param(
                {"enabled": True, "source": "custom", "entries": "https://a.example"},
                LIST_SHAPE_MESSAGE,
                id="list-shape-then-required-address",
            ),
            pytest.param(
                {"host": "", "port": None},
                HOST_REQUIRED_MESSAGE,
                id="required-address-then-required-port",
            ),
            pytest.param(
                {"host": "http://" + "a" * 250},
                HOST_LENGTH_MESSAGE,
                id="address-length-then-address-form",
            ),
            pytest.param(
                {"enabled": True, "source": "custom", "host": "http://proxy.example"},
                HOST_FORM_MESSAGE,
                id="address-form-then-required-port",
            ),
            pytest.param(
                {"port": None, "username": "u" * 256},
                PORT_REQUIRED_MESSAGE,
                id="required-port-then-username-length",
            ),
            pytest.param(
                {"port": 0, "username": "u" * 256},
                PORT_MESSAGE,
                id="port-range-then-username-length",
            ),
            pytest.param(
                {"password": "p" * 256},
                PASSWORD_LENGTH_MESSAGE,
                id="password-length-then-missing-username",
            ),
            pytest.param(
                {"username": "u" * 256, "entries": _entries(101)},
                USERNAME_LENGTH_MESSAGE,
                id="username-length-then-list-limit",
            ),
            pytest.param(
                {"password": "new-secret", "entries": _entries(101)},
                USERNAME_REQUIRED_MESSAGE,
                id="missing-username-then-list-limit",
            ),
            pytest.param(
                {"entries": [{"kind": "glob", "address": "https://a.example"}, *_entries(100)]},
                LIST_LIMIT_MESSAGE,
                id="list-limit-then-entry-kind",
            ),
            pytest.param(
                {"entries": [{"kind": "glob", "address": ""}]},
                f"Entry 1: {KIND_MESSAGE}",
                id="entry-kind-then-blank-address",
            ),
            pytest.param(
                {"entries": [_exact("")]},
                f"Entry 1: {ADDRESS_REQUIRED_MESSAGE}",
                id="blank-address-then-exact-form",
            ),
            pytest.param(
                {"entries": [_exact("a" * 257)]},
                f"Entry 1: {ADDRESS_LENGTH_MESSAGE}",
                id="entry-length-then-exact-form",
            ),
        ],
    )
    @pytest.mark.usefixtures("custom_proxy_on")
    def test_the_earlier_rule_is_the_one_reported(
        self, refused: Callable[..., None], subset: dict[str, Any], message: str
    ) -> None:
        refused(message, **subset)

    @pytest.mark.parametrize(
        ("subset", "message"),
        [
            pytest.param(
                {"port": 0, "username": "ops:team"},
                PORT_MESSAGE,
                id="port-range-then-username-colon",
            ),
            pytest.param(
                {"username": "u:" + "u" * 254},
                USERNAME_LENGTH_MESSAGE,
                id="username-length-then-username-colon",
            ),
            pytest.param(
                {"username": "ops:team", "password": "p" * 256},
                USERNAME_COLON_MESSAGE,
                id="username-colon-then-password-length",
            ),
            pytest.param(
                {"username": "ops:team", "entries": _entries(101)},
                USERNAME_COLON_MESSAGE,
                id="username-colon-then-list-limit",
            ),
        ],
    )
    @pytest.mark.usefixtures("custom_proxy_on")
    def test_the_colon_rule_sits_right_after_the_username_length_rule(
        self, refused: Callable[..., None], subset: dict[str, Any], message: str
    ) -> None:
        refused(message, **subset)

    @pytest.mark.usefixtures("custom_proxy_on")
    def test_a_blank_username_gets_the_missing_username_text_not_the_colon_text(
        self, refused: Callable[..., None]
    ) -> None:
        refused(USERNAME_REQUIRED_MESSAGE, username="", password="pa:ss")


class TestPassword:
    @pytest.mark.usefixtures("custom_proxy_on")
    def test_the_password_is_stored_sealed(
        self, config_file: Path, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        proxy_service.update_settings(username="ops", password=SECRET)

        assert SECRET not in config_file.read_text(encoding="utf-8")
        assert _unsealed_on_disk(config_on_disk) == SECRET

    @pytest.mark.usefixtures("custom_proxy_on")
    def test_the_result_says_only_that_a_password_is_set(self) -> None:
        result = proxy_service.update_settings(username="ops", password=SECRET)

        assert result == _custom(username="ops", password_set=True)
        assert "password" not in result
        assert SECRET not in repr(result)
        assert ENVELOPE_PREFIX not in repr(result)

    @pytest.mark.usefixtures("custom_proxy_on")
    def test_an_omitted_password_keeps_the_stored_one(
        self, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        proxy_service.update_settings(username="ops", password=SECRET)
        sealed = _stored_proxy(config_on_disk)["password"]

        result = proxy_service.update_settings(port=3128)

        assert result == _custom(username="ops", password_set=True, port=3128)
        assert _stored_proxy(config_on_disk)["password"] == sealed

    @pytest.mark.usefixtures("custom_proxy_on")
    def test_an_empty_password_removes_the_stored_one(
        self, config_file: Path, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        proxy_service.update_settings(username="ops", password=SECRET)

        result = proxy_service.update_settings(password="")

        assert result == _custom(username="ops")
        assert _stored_proxy(config_on_disk).get("password") is None
        assert ENVELOPE_PREFIX not in config_file.read_text(encoding="utf-8")

    @pytest.mark.usefixtures("custom_proxy_on")
    def test_an_empty_password_with_none_stored_changes_nothing(self) -> None:
        assert proxy_service.update_settings(username="ops", password="") == _custom(username="ops")

    @pytest.mark.usefixtures("custom_proxy_on")
    def test_a_new_password_replaces_the_stored_one(
        self, config_file: Path, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        proxy_service.update_settings(username="ops", password="first-secret")

        result = proxy_service.update_settings(password="second-secret")

        assert result == _custom(username="ops", password_set=True)
        assert _unsealed_on_disk(config_on_disk) == "second-secret"
        assert "second-secret" not in config_file.read_text(encoding="utf-8")

    @pytest.mark.usefixtures("custom_proxy_on")
    def test_a_username_without_a_password_is_accepted(
        self, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        result = proxy_service.update_settings(username="ops")

        assert result == _custom(username="ops")
        assert _stored_proxy(config_on_disk) == {**CUSTOM_ON, "username": "ops"}

    @pytest.mark.usefixtures("custom_proxy_on")
    def test_a_new_password_with_a_blank_username_is_refused(
        self, refused: Callable[..., None], config_file: Path
    ) -> None:
        refused(USERNAME_REQUIRED_MESSAGE, password=SECRET)

        assert ENVELOPE_PREFIX not in config_file.read_text(encoding="utf-8")

    @pytest.mark.usefixtures("custom_proxy_on")
    def test_a_new_password_sent_with_an_emptied_username_is_refused(
        self, refused: Callable[..., None]
    ) -> None:
        proxy_service.update_settings(username="ops")

        refused(USERNAME_REQUIRED_MESSAGE, username="", password=SECRET)

    @pytest.mark.usefixtures("custom_proxy_on")
    def test_a_new_password_joins_the_stored_username(
        self, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        proxy_service.update_settings(username="ops")

        result = proxy_service.update_settings(password=SECRET)

        assert result == _custom(username="ops", password_set=True)
        assert _unsealed_on_disk(config_on_disk) == SECRET

    @pytest.mark.parametrize(
        "subset",
        [
            pytest.param({"username": ""}, id="password-omitted"),
            pytest.param({"username": "", "password": None}, id="password-null"),
            pytest.param({"username": "", "password": ""}, id="password-empty"),
        ],
    )
    def test_saving_an_empty_username_removes_the_stored_password(
        self,
        subset: dict[str, Any],
        config_file: Path,
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        proxy_service.update_settings(username="ops", password=SECRET)

        result = proxy_service.update_settings(**subset)

        assert result == DEFAULT_SETTINGS
        assert _stored_proxy(config_on_disk).get("password") is None
        assert ENVELOPE_PREFIX not in config_file.read_text(encoding="utf-8")

    @pytest.mark.usefixtures("custom_proxy_on")
    def test_another_username_keeps_the_stored_password(
        self, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        proxy_service.update_settings(username="ops", password=SECRET)

        result = proxy_service.update_settings(username="deploy")

        assert result == _custom(username="deploy", password_set=True)
        assert _unsealed_on_disk(config_on_disk) == SECRET

    @pytest.mark.usefixtures("custom_proxy_on")
    def test_the_sealed_password_survives_a_restart(
        self, load_config: Callable[..., Any], config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        saved = proxy_service.update_settings(username="ops", password=SECRET)

        load_config()

        assert proxy_service.get_settings() == saved
        assert _unsealed_on_disk(config_on_disk) == SECRET


class TestSavedValues:
    _CUSTOM = {
        **CUSTOM_ON,
        "username": "ops",
        "list_mode": "only",
        "entries": [{"kind": "exact", "address": "https://a.example"}],
        "proxy_local_addresses": True,
    }
    # What the config file holds for the settings the page hides: their defaults.
    _DISCARDED = {
        "host": "",
        "port": None,
        "username": "",
        "password": None,
        "list_mode": "except",
        "entries": [],
        "proxy_local_addresses": False,
    }

    def test_custom_values_are_discarded_when_the_source_changes(
        self, monkeypatch: pytest.MonkeyPatch, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "http://host-proxy.example:8080")
        proxy_service.update_settings(**self._CUSTOM, password=SECRET)

        result = proxy_service.update_settings(source="host")

        assert result == _settings(
            enabled=True, host_values=_host_values(https_proxy="http://host-proxy.example:8080")
        )
        assert _stored_proxy(config_on_disk) == {
            "enabled": True,
            "source": "host",
            **self._DISCARDED,
        }

    def test_everything_but_the_switch_is_discarded_when_the_proxy_is_turned_off(
        self, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        proxy_service.update_settings(**self._CUSTOM, password=SECRET)

        result = proxy_service.update_settings(enabled=False)

        assert result == DEFAULT_SETTINGS
        assert _stored_proxy(config_on_disk) == {
            "enabled": False,
            "source": "host",
            **self._DISCARDED,
        }

    def test_nothing_comes_back_when_the_proxy_is_turned_on_again(
        self, refused: Callable[..., None]
    ) -> None:
        proxy_service.update_settings(**self._CUSTOM, password=SECRET)
        proxy_service.update_settings(enabled=False)

        refused(HOST_REQUIRED_MESSAGE, enabled=True, source="custom")

    def test_nothing_comes_back_when_custom_is_chosen_again(
        self, monkeypatch: pytest.MonkeyPatch, refused: Callable[..., None]
    ) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "http://host-proxy.example:8080")
        proxy_service.update_settings(**self._CUSTOM, password=SECRET)
        proxy_service.update_settings(source="host")

        refused(HOST_REQUIRED_MESSAGE, source="custom")

    def test_values_sent_for_what_the_page_hides_are_not_stored(
        self, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        result = proxy_service.update_settings(
            **{**self._CUSTOM, "enabled": False}, password=SECRET
        )

        assert result == DEFAULT_SETTINGS
        assert _stored_proxy(config_on_disk) == {}

    def test_a_bad_value_the_page_hides_does_not_stop_the_save(self) -> None:
        proxy_service.update_settings(**self._CUSTOM)

        result = proxy_service.update_settings(enabled=False, host="http://proxy", port=0)

        assert result == DEFAULT_SETTINGS

    def test_a_password_sent_under_the_host_source_is_not_stored(
        self, monkeypatch: pytest.MonkeyPatch, config_file: Path
    ) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "http://host-proxy.example:8080")

        result = proxy_service.update_settings(
            enabled=True, source="host", username="ops", password=SECRET
        )

        assert result["password_set"] is False
        assert ENVELOPE_PREFIX not in config_file.read_text(encoding="utf-8")

    @pytest.mark.usefixtures("custom_proxy_on")
    def test_entries_come_back_in_normal_form(
        self, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        normal = [
            _exact("https://a.example"),
            _exact("http://b.example"),
            _exact("http://c.example:8080"),
            _exact("https://d.example:8443"),
            _regex(r"^https://.*\.Corp\.Example(:\d+)?$"),
        ]

        result = proxy_service.update_settings(
            entries=[
                _exact("https://A.Example:443"),
                _exact("http://B.example:80"),
                _exact("http://C.EXAMPLE:8080"),
                _exact("https://d.example:8443"),
                _regex(r"^https://.*\.Corp\.Example(:\d+)?$"),
            ]
        )

        assert result == _custom(entries=normal)
        assert proxy_service.get_settings()["entries"] == normal
        assert _stored_proxy(config_on_disk) == {**CUSTOM_ON, "entries": normal}

    @pytest.mark.usefixtures("custom_proxy_on")
    def test_a_new_list_replaces_the_whole_list(self) -> None:
        proxy_service.update_settings(entries=[_exact("https://a.example"), _regex("b")])

        result = proxy_service.update_settings(entries=[_exact("https://c.example")])

        assert result == _custom(entries=[_exact("https://c.example")])

    def test_only_the_value_that_differs_from_its_default_is_written(
        self, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        proxy_service.update_settings(**CUSTOM_ON, list_mode="except", entries=[])

        assert config_on_disk() == {"network": {"proxy": CUSTOM_ON}}

    def test_only_the_changed_keys_are_written(
        self, load_config: Callable[..., Any], config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        stored = {**CUSTOM_ON, "host": "old.example"}
        load_config({"logging": {"level": "INFO"}, "network": {"proxy": stored}})

        proxy_service.update_settings(host="proxy.example", port=3128)

        assert config_on_disk() == {
            "logging": {"level": "INFO"},
            "network": {"proxy": CUSTOM_ON},
        }

    def test_repeating_the_saved_values_is_not_a_write(
        self, request: pytest.FixtureRequest
    ) -> None:
        subset = {**CUSTOM_ON, "username": "ops", "entries": [_exact("https://A.example:443")]}
        saved = proxy_service.update_settings(**subset)
        config_file: Path = request.getfixturevalue("read_only_config")
        before = config_file.read_bytes()

        result = proxy_service.update_settings(**subset)

        assert result == saved
        assert config_file.read_bytes() == before

    def test_nothing_is_written_into_the_data_folder(self, temp_storage_path: Path) -> None:
        proxy_service.update_settings(**CUSTOM_ON, username="ops", password=SECRET)

        assert list(temp_storage_path.rglob("*proxy*")) == []


class TestRefusedConfigWrite:
    def test_a_read_only_config_refuses_the_save(self, read_only_config: Path) -> None:
        before = read_only_config.read_bytes()

        with pytest.raises(ConfigWriteError, match=_read_only_message(read_only_config)) as refusal:
            proxy_service.update_settings(**CUSTOM_ON)

        assert refusal.value.status_code == 500
        assert read_only_config.read_bytes() == before
        assert proxy_service.get_settings() == DEFAULT_SETTINGS
        assert proxy_service.current_proxy_spec() is None

    def test_a_refused_password_save_stores_nothing(self, read_only_config: Path) -> None:
        with pytest.raises(ConfigWriteError, match=_read_only_message(read_only_config)):
            proxy_service.update_settings(**CUSTOM_ON, username="ops", password=SECRET)

        assert proxy_service.get_settings() == DEFAULT_SETTINGS
        assert ENVELOPE_PREFIX not in read_only_config.read_text(encoding="utf-8")

    def test_a_refused_save_keeps_the_proxy_that_was_in_force(
        self, request: pytest.FixtureRequest
    ) -> None:
        saved = proxy_service.update_settings(**CUSTOM_ON, username="ops", password=SECRET)
        config_file: Path = request.getfixturevalue("read_only_config")
        before = config_file.read_bytes()

        with pytest.raises(ConfigWriteError, match=_read_only_message(config_file)):
            proxy_service.update_settings(port=8080, password="second-secret", enabled=False)

        assert config_file.read_bytes() == before
        assert proxy_service.get_settings() == saved
        assert _spec().https == _endpoint("proxy.example", 3128, "ops", SECRET)


class TestHostValues:
    """The WAVE host's three proxy variables as the page shows them."""

    def test_a_host_without_the_variables_gives_none_for_each(self) -> None:
        assert proxy_service.host_values() == NO_HOST_VALUES

    def test_the_uppercase_variables_are_read(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "http://secure-proxy.example:3129")
        monkeypatch.setenv("HTTP_PROXY", "http://plain-proxy.example:3128")
        monkeypatch.setenv("NO_PROXY", "localhost,.corp.example,10.0.0.0/8")

        assert proxy_service.host_values() == {
            "https_proxy": "http://secure-proxy.example:3129",
            "http_proxy": "http://plain-proxy.example:3128",
            "no_proxy": "localhost,.corp.example,10.0.0.0/8",
        }

    def test_the_lowercase_variables_are_read_when_the_uppercase_ones_are_absent(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("https_proxy", "http://secure-proxy.example:3129")
        monkeypatch.setenv("http_proxy", "http://plain-proxy.example:3128")
        monkeypatch.setenv("no_proxy", "localhost,.corp.example")

        assert proxy_service.host_values() == {
            "https_proxy": "http://secure-proxy.example:3129",
            "http_proxy": "http://plain-proxy.example:3128",
            "no_proxy": "localhost,.corp.example",
        }

    def test_an_uppercase_variable_wins_over_its_lowercase_spelling(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "http://upper-secure.example:3129")
        monkeypatch.setenv("https_proxy", "http://lower-secure.example:3129")
        monkeypatch.setenv("HTTP_PROXY", "http://upper-plain.example:3128")
        monkeypatch.setenv("http_proxy", "http://lower-plain.example:3128")
        monkeypatch.setenv("NO_PROXY", "upper.example")
        monkeypatch.setenv("no_proxy", "lower.example")

        assert proxy_service.host_values() == {
            "https_proxy": "http://upper-secure.example:3129",
            "http_proxy": "http://upper-plain.example:3128",
            "no_proxy": "upper.example",
        }

    def test_each_variable_falls_back_on_its_own(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "http://upper-secure.example:3129")
        monkeypatch.setenv("http_proxy", "http://lower-plain.example:3128")

        assert proxy_service.host_values() == _host_values(
            https_proxy="http://upper-secure.example:3129",
            http_proxy="http://lower-plain.example:3128",
        )

    def test_a_password_inside_a_value_is_masked(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("HTTPS_PROXY", f"http://ops:{SECRET}@secure-proxy.example:3129")
        monkeypatch.setenv("http_proxy", f"http://ops:{SECRET}@plain-proxy.example:3128")

        assert proxy_service.host_values() == _host_values(
            https_proxy="http://ops:********@secure-proxy.example:3129",
            http_proxy="http://ops:********@plain-proxy.example:3128",
        )

    def test_a_username_without_a_password_is_shown_as_it_is(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "http://ops@proxy.example:3128")

        assert proxy_service.host_values()["https_proxy"] == "http://ops@proxy.example:3128"

    def test_a_password_in_a_value_without_a_scheme_is_masked_too(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("HTTPS_PROXY", f"ops:{SECRET}@proxy.example:3128")

        shown = proxy_service.host_values()["https_proxy"]

        assert shown is not None
        assert SECRET not in shown
        assert shown.endswith("ops:********@proxy.example:3128")

    def test_the_settings_never_carry_a_password_of_the_wave_host(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("HTTPS_PROXY", f"http://ops:{SECRET}@secure-proxy.example:3129")
        monkeypatch.setenv("HTTP_PROXY", f"ops:{SECRET}@plain-proxy.example:3128")

        assert SECRET not in repr(proxy_service.get_settings())

    def test_all_proxy_is_never_read(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("ALL_PROXY", "http://all-proxy.example:3128")
        monkeypatch.setenv("all_proxy", "http://all-proxy.example:3128")

        assert proxy_service.host_values() == NO_HOST_VALUES

    def test_a_variable_set_to_nothing_is_not_set(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "")
        monkeypatch.setenv("HTTP_PROXY", "")
        monkeypatch.setenv("http_proxy", "http://lower-plain.example:3128")
        monkeypatch.setenv("no_proxy", "")

        assert proxy_service.host_values() == _host_values(
            http_proxy="http://lower-plain.example:3128"
        )

    def test_the_values_are_read_each_time(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("HTTP_PROXY", "http://first.example:3128")
        first = proxy_service.host_values()
        monkeypatch.setenv("HTTP_PROXY", "http://second.example:3128")
        second = proxy_service.host_values()
        monkeypatch.delenv("HTTP_PROXY")

        assert first == _host_values(http_proxy="http://first.example:3128")
        assert second == _host_values(http_proxy="http://second.example:3128")
        assert proxy_service.host_values() == NO_HOST_VALUES


class TestHostSourceAtSave:
    """Saving the WAVE host's settings with the proxy on needs a usable proxy variable."""

    @pytest.mark.parametrize(
        "subset",
        [
            pytest.param({"enabled": True}, id="turned-on-with-the-default-source"),
            pytest.param({"enabled": True, "source": "host"}, id="both-sent"),
        ],
    )
    def test_a_host_without_a_proxy_variable_is_refused(
        self, refused: Callable[..., None], subset: dict[str, Any]
    ) -> None:
        refused(NO_HOST_VARIABLE_MESSAGE, **subset)

    def test_choosing_the_host_source_while_on_is_refused_without_a_variable(
        self, refused: Callable[..., None]
    ) -> None:
        proxy_service.update_settings(**CUSTOM_ON)

        refused(NO_HOST_VARIABLE_MESSAGE, source="host")

    @pytest.mark.parametrize("name", ["NO_PROXY", "no_proxy", "ALL_PROXY", "all_proxy"])
    def test_another_variable_alone_does_not_count(
        self, refused: Callable[..., None], monkeypatch: pytest.MonkeyPatch, name: str
    ) -> None:
        monkeypatch.setenv(name, "http://other.example:3128")

        refused(NO_HOST_VARIABLE_MESSAGE, enabled=True, source="host")

    def test_a_variable_set_to_nothing_does_not_count(
        self, refused: Callable[..., None], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "")
        monkeypatch.setenv("http_proxy", "")

        refused(NO_HOST_VARIABLE_MESSAGE, enabled=True, source="host")

    @pytest.mark.parametrize(
        ("name", "value"),
        [
            pytest.param("HTTPS_PROXY", "http://proxy.example:3128", id="https-proxy"),
            pytest.param("HTTP_PROXY", "http://proxy.example:3128", id="http-proxy"),
            pytest.param("https_proxy", "http://proxy.example:3128", id="lowercase-https-proxy"),
            pytest.param("http_proxy", "http://proxy.example:3128", id="lowercase-http-proxy"),
            pytest.param("HTTPS_PROXY", "proxy.example:3128", id="no-scheme"),
            pytest.param("HTTP_PROXY", "http://proxy.example", id="no-port"),
        ],
    )
    def test_one_usable_variable_is_enough(
        self, monkeypatch: pytest.MonkeyPatch, name: str, value: str
    ) -> None:
        monkeypatch.setenv(name, value)

        result = proxy_service.update_settings(enabled=True, source="host")

        assert result["enabled"] is True
        assert result["source"] == "host"
        assert proxy_service.get_settings() == result

    @pytest.mark.parametrize(
        ("name", "value"),
        [
            pytest.param("HTTPS_PROXY", "https://proxy.example:3128", id="tls-proxy"),
            pytest.param("HTTP_PROXY", "https://proxy.example:3128", id="tls-proxy-for-http"),
            pytest.param("HTTPS_PROXY", "socks5://proxy.example:1080", id="socks-proxy"),
            pytest.param("http_proxy", "socks5://proxy.example:1080", id="lowercase-variable"),
        ],
    )
    def test_a_value_wave_cannot_use_is_refused(
        self,
        refused: Callable[..., None],
        monkeypatch: pytest.MonkeyPatch,
        name: str,
        value: str,
    ) -> None:
        monkeypatch.setenv(name, value)

        refused(_unusable_message(value), enabled=True, source="host")

    def test_the_refusal_masks_a_password_inside_the_value(
        self, refused: Callable[..., None], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("HTTPS_PROXY", f"socks5://ops:{SECRET}@proxy.example:1080")

        refused(
            _unusable_message("socks5://ops:********@proxy.example:1080"),
            enabled=True,
            source="host",
        )

    def test_one_unusable_value_beside_a_usable_one_is_refused(
        self, refused: Callable[..., None], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "http://proxy.example:3128")
        monkeypatch.setenv("HTTP_PROXY", "socks5://proxy.example:1080")

        refused(_unusable_message("socks5://proxy.example:1080"), enabled=True, source="host")

    def test_a_lowercase_value_hidden_by_its_uppercase_spelling_is_not_judged(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "http://proxy.example:3128")
        monkeypatch.setenv("https_proxy", "socks5://proxy.example:1080")

        result = proxy_service.update_settings(enabled=True, source="host")

        assert result == _settings(
            enabled=True, host_values=_host_values(https_proxy="http://proxy.example:3128")
        )

    def test_the_host_values_are_not_checked_while_the_proxy_is_off(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "socks5://proxy.example:1080")

        assert proxy_service.update_settings(source="host") == _settings(
            host_values=_host_values(https_proxy="socks5://proxy.example:1080")
        )

    def test_a_custom_proxy_is_saved_whatever_the_wave_host_sets(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "socks5://proxy.example:1080")

        result = proxy_service.update_settings(**CUSTOM_ON)

        assert result == _settings(
            **CUSTOM_ON, host_values=_host_values(https_proxy="socks5://proxy.example:1080")
        )


class TestSpecWhileOff:
    def test_no_proxy_is_in_force_by_default(self) -> None:
        assert proxy_service.current_proxy_spec() is None

    def test_stored_custom_values_give_no_proxy_while_off(self) -> None:
        proxy_service.update_settings(
            source="custom", host="proxy.example", port=3128, username="ops", password=SECRET
        )

        assert proxy_service.current_proxy_spec() is None

    def test_the_wave_hosts_variables_give_no_proxy_while_off(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "http://host-proxy.example:8080")
        monkeypatch.setenv("HTTP_PROXY", "http://host-proxy.example:8080")

        assert proxy_service.current_proxy_spec() is None

    def test_turning_the_proxy_off_ends_it(self) -> None:
        proxy_service.update_settings(**CUSTOM_ON)
        assert _spec().https == CUSTOM_ENDPOINT

        proxy_service.update_settings(enabled=False)

        assert proxy_service.current_proxy_spec() is None

    def test_no_line_is_written_in_a_run_while_off(self, run_lines: Lines) -> None:
        assert proxy_service.current_proxy_spec() is None

        assert run_lines == []


class TestCustomSpec:
    """Custom fills both protocols from its one address and one login; the list decides."""

    def test_one_endpoint_serves_both_protocols(self) -> None:
        proxy_service.update_settings(**CUSTOM_ON)

        spec = _spec()

        assert spec.https == CUSTOM_ENDPOINT
        assert spec.http == CUSTOM_ENDPOINT

    def test_the_endpoint_carries_the_login_with_the_unsealed_password(self) -> None:
        proxy_service.update_settings(**CUSTOM_ON, username="ops", password=SECRET)

        spec = _spec()

        assert spec.https == _endpoint("proxy.example", 3128, "ops", SECRET)
        assert spec.http == _endpoint("proxy.example", 3128, "ops", SECRET)

    def test_a_username_without_a_password_gives_a_login_without_one(self) -> None:
        proxy_service.update_settings(**CUSTOM_ON, username="ops")

        assert _spec().https == _endpoint("proxy.example", 3128, "ops", None)

    def test_a_sealed_password_in_the_config_file_is_unsealed(
        self, load_config: Callable[..., Any]
    ) -> None:
        load_config(_proxy_config(**CUSTOM_ON, username="ops", password=seal_value(SECRET)))

        assert _spec().http == _endpoint("proxy.example", 3128, "ops", SECRET)

    @pytest.mark.parametrize(
        ("typed", "host"),
        [
            pytest.param("10.20.30.40", "10.20.30.40", id="ipv4"),
            pytest.param("2001:db8::1", "2001:db8::1", id="ipv6"),
            pytest.param("[2001:db8::1]", "2001:db8::1", id="ipv6-in-brackets"),
            pytest.param("proxy.example", "proxy.example", id="host-name"),
        ],
    )
    def test_the_endpoint_host_carries_no_brackets(self, typed: str, host: str) -> None:
        proxy_service.update_settings(enabled=True, source="custom", host=typed, port=3128)

        assert _spec().https == _endpoint(host, 3128)

    def test_every_address_goes_through_the_proxy_by_default(self) -> None:
        proxy_service.update_settings(**CUSTOM_ON)

        spec = _spec()

        assert proxy.route_for("https", "api.example", 443, spec) == CUSTOM_ENDPOINT
        assert proxy.route_for("http", "api.example", 80, spec) == CUSTOM_ENDPOINT
        assert proxy.route_for("http", "api.example", 8080, spec) == CUSTOM_ENDPOINT

    def test_except_mode_connects_directly_to_a_listed_address(self) -> None:
        proxy_service.update_settings(
            **CUSTOM_ON,
            list_mode="except",
            entries=[_exact("https://direct.example"), _regex(r"corp\.example")],
        )

        spec = _spec()

        assert proxy.route_for("https", "direct.example", 443, spec) is None
        assert proxy.route_for("https", "api.corp.example", 443, spec) is None
        assert proxy.route_for("http", "direct.example", 80, spec) == CUSTOM_ENDPOINT
        assert proxy.route_for("https", "direct.example", 8443, spec) == CUSTOM_ENDPOINT
        assert proxy.route_for("https", "other.example", 443, spec) == CUSTOM_ENDPOINT

    def test_only_mode_proxies_only_a_listed_address(self) -> None:
        proxy_service.update_settings(
            **CUSTOM_ON,
            list_mode="only",
            entries=[_exact("http://listed.example:8080"), _regex(r"corp\.example")],
        )

        spec = _spec()

        assert proxy.route_for("http", "listed.example", 8080, spec) == CUSTOM_ENDPOINT
        assert proxy.route_for("https", "api.corp.example", 443, spec) == CUSTOM_ENDPOINT
        assert proxy.route_for("http", "listed.example", 80, spec) is None
        assert proxy.route_for("https", "other.example", 443, spec) is None

    def test_a_local_address_connects_directly(self) -> None:
        proxy_service.update_settings(**CUSTOM_ON)

        spec = _spec()

        assert proxy.route_for("https", "localhost", 8443, spec) is None
        assert proxy.route_for("http", "127.0.0.1", 8080, spec) is None

    def test_a_local_address_follows_the_list_when_the_switch_is_on(self) -> None:
        proxy_service.update_settings(**CUSTOM_ON, proxy_local_addresses=True)

        spec = _spec()

        assert proxy.route_for("https", "localhost", 8443, spec) == CUSTOM_ENDPOINT
        assert proxy.route_for("http", "127.0.0.1", 8080, spec) == CUSTOM_ENDPOINT

    def test_the_wave_hosts_variables_play_no_part(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "http://host-proxy.example:8080")
        monkeypatch.setenv("HTTP_PROXY", "socks5://host-proxy.example:1080")
        monkeypatch.setenv("NO_PROXY", "api.example")
        proxy_service.update_settings(**CUSTOM_ON)

        spec = _spec()

        assert spec.https == CUSTOM_ENDPOINT
        assert spec.http == CUSTOM_ENDPOINT
        assert proxy.route_for("https", "api.example", 443, spec) == CUSTOM_ENDPOINT
        assert proxy.route_for("http", "api.example", 80, spec) == CUSTOM_ENDPOINT

    def test_no_line_is_written_in_a_run(self, run_lines: Lines) -> None:
        proxy_service.update_settings(**CUSTOM_ON)

        _spec()

        assert run_lines == []


@pytest.mark.usefixtures("host_source_on")
class TestHostSourceSpec:
    """The WAVE host's settings fill each protocol from its own variable, read at call time."""

    def test_each_protocol_gets_its_own_endpoint_with_its_own_login(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "http://sec:sec-secret@secure-proxy.example:3129")
        monkeypatch.setenv("HTTP_PROXY", "http://plain:plain-secret@plain-proxy.example:3128")

        spec = _spec()

        assert spec.https == _endpoint("secure-proxy.example", 3129, "sec", "sec-secret")
        assert spec.http == _endpoint("plain-proxy.example", 3128, "plain", "plain-secret")
        assert proxy.route_for("https", "api.example", 443, spec) == spec.https
        assert proxy.route_for("http", "api.example", 80, spec) == spec.http

    def test_a_value_without_a_login_gives_an_endpoint_without_one(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "http://proxy.example:3128")

        assert _spec().https == _endpoint("proxy.example", 3128, None, None)

    def test_https_proxy_alone_leaves_http_targets_direct(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "http://proxy.example:3128")

        spec = _spec()

        assert spec.https == _endpoint("proxy.example", 3128)
        assert spec.http is None
        assert proxy.route_for("https", "api.example", 443, spec) == spec.https
        assert proxy.route_for("http", "api.example", 80, spec) is None

    def test_http_proxy_alone_leaves_https_targets_direct(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("HTTP_PROXY", "http://proxy.example:3128")

        spec = _spec()

        assert spec.http == _endpoint("proxy.example", 3128)
        assert spec.https is None
        assert proxy.route_for("http", "api.example", 80, spec) == spec.http
        assert proxy.route_for("https", "api.example", 443, spec) is None

    def test_all_proxy_fills_no_protocol(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "http://proxy.example:3128")
        monkeypatch.setenv("ALL_PROXY", "http://all-proxy.example:3128")
        monkeypatch.setenv("all_proxy", "http://all-proxy.example:3128")

        spec = _spec()

        assert spec.https == _endpoint("proxy.example", 3128)
        assert spec.http is None

    def test_the_variables_are_read_each_time(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "http://first.example:3128")
        first = _spec()
        monkeypatch.setenv("HTTPS_PROXY", "http://second.example:8080")
        monkeypatch.setenv("HTTP_PROXY", "http://plain.example:3128")
        second = _spec()

        assert first.https == _endpoint("first.example", 3128)
        assert first.http is None
        assert second.https == _endpoint("second.example", 8080)
        assert second.http == _endpoint("plain.example", 3128)

    def test_the_lowercase_variables_are_read_when_the_uppercase_ones_are_absent(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("https_proxy", "http://secure-proxy.example:3129")
        monkeypatch.setenv("http_proxy", "http://plain-proxy.example:3128")
        monkeypatch.setenv("no_proxy", "direct.example")

        spec = _spec()

        assert spec.https == _endpoint("secure-proxy.example", 3129)
        assert spec.http == _endpoint("plain-proxy.example", 3128)
        assert proxy.route_for("https", "direct.example", 443, spec) is None
        assert proxy.route_for("https", "api.example", 443, spec) == spec.https

    def test_an_uppercase_variable_wins_over_its_lowercase_spelling(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "http://upper.example:3129")
        monkeypatch.setenv("https_proxy", "http://lower.example:3129")
        monkeypatch.setenv("NO_PROXY", "upper-direct.example")
        monkeypatch.setenv("no_proxy", "lower-direct.example")

        spec = _spec()

        assert spec.https == _endpoint("upper.example", 3129)
        assert proxy.route_for("https", "upper-direct.example", 443, spec) is None
        assert proxy.route_for("https", "lower-direct.example", 443, spec) == spec.https

    @pytest.mark.parametrize(
        ("value", "endpoint"),
        [
            pytest.param("http://proxy.example", _endpoint("proxy.example", 80), id="no-port"),
            pytest.param("proxy.example:3128", _endpoint("proxy.example", 3128), id="no-scheme"),
            pytest.param("proxy.example", _endpoint("proxy.example", 80), id="host-alone"),
            pytest.param(
                f"ops:{SECRET}@proxy.example:3128",
                _endpoint("proxy.example", 3128, "ops", SECRET),
                id="no-scheme-with-a-login",
            ),
        ],
    )
    @pytest.mark.parametrize("name", ["HTTPS_PROXY", "HTTP_PROXY"])
    def test_a_missing_scheme_means_http_and_a_missing_port_means_80(
        self, monkeypatch: pytest.MonkeyPatch, name: str, value: str, endpoint: ProxyEndpoint
    ) -> None:
        monkeypatch.setenv(name, value)

        spec = _spec()

        assert (spec.https if name == "HTTPS_PROXY" else spec.http) == endpoint

    def test_no_proxy_decides_which_addresses_connect_directly(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "http://proxy.example:3128")
        monkeypatch.setenv("HTTP_PROXY", "http://proxy.example:3128")
        monkeypatch.setenv("NO_PROXY", "direct.example,.corp.example")

        spec = _spec()

        assert proxy.route_for("https", "direct.example", 443, spec) is None
        assert proxy.route_for("http", "direct.example", 80, spec) is None
        assert proxy.route_for("https", "api.corp.example", 443, spec) is None
        assert proxy.route_for("https", "other.example", 443, spec) == spec.https
        assert proxy.route_for("http", "other.example", 80, spec) == spec.http

    def test_no_proxy_is_read_each_time(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "http://proxy.example:3128")
        monkeypatch.setenv("NO_PROXY", "first.example")
        first = _spec()
        assert proxy.route_for("https", "first.example", 443, first) is None
        assert proxy.route_for("https", "second.example", 443, first) == first.https

        monkeypatch.setenv("NO_PROXY", "second.example")
        second = _spec()

        assert proxy.route_for("https", "second.example", 443, second) is None
        assert proxy.route_for("https", "first.example", 443, second) == second.https

    def test_a_lone_asterisk_sends_every_address_direct(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "http://proxy.example:3128")
        monkeypatch.setenv("NO_PROXY", "*")

        spec = _spec()

        assert proxy.route_for("https", "api.example", 443, spec) is None

    def test_a_local_address_always_connects_directly(
        self, load_config: Callable[..., Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        load_config(_proxy_config(enabled=True, source="host", proxy_local_addresses=True))
        monkeypatch.setenv("HTTPS_PROXY", "http://proxy.example:3128")
        monkeypatch.setenv("HTTP_PROXY", "http://proxy.example:3128")

        spec = _spec()

        assert proxy.route_for("https", "localhost", 8443, spec) is None
        assert proxy.route_for("http", "127.0.0.1", 8080, spec) is None

    def test_the_custom_values_play_no_part(
        self, load_config: Callable[..., Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        load_config(
            _proxy_config(
                enabled=True,
                source="host",
                host="custom-proxy.example",
                port=9999,
                username="ops",
                password=seal_value(SECRET),
                list_mode="only",
                entries=[_exact("https://listed.example")],
            )
        )
        monkeypatch.setenv("HTTPS_PROXY", "http://proxy.example:3128")

        spec = _spec()

        assert spec.https == _endpoint("proxy.example", 3128, None, None)
        assert proxy.route_for("https", "unlisted.example", 443, spec) == spec.https

    def test_no_line_is_written_in_a_run_when_a_variable_is_set(
        self, monkeypatch: pytest.MonkeyPatch, run_lines: Lines
    ) -> None:
        monkeypatch.setenv("HTTP_PROXY", "http://proxy.example:3128")

        _spec()

        assert run_lines == []

    def test_a_saved_host_source_gives_the_same_proxy(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "http://proxy.example:3128")
        proxy_service.update_settings(enabled=False)

        proxy_service.update_settings(enabled=True, source="host")

        assert _spec().https == _endpoint("proxy.example", 3128)


@pytest.mark.usefixtures("host_source_on")
class TestUnusableHostValue:
    """A value WAVE cannot use fails only a request that would go through that value."""

    def test_the_proxy_in_force_is_still_built(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "socks5://proxy.example:1080")
        monkeypatch.setenv("HTTP_PROXY", "http://plain-proxy.example:3128")

        spec = _spec()

        assert spec.https is None
        assert spec.http == _endpoint("plain-proxy.example", 3128)

    @pytest.mark.parametrize("value", ["socks5://proxy.example:1080", "https://proxy.example:3128"])
    def test_a_request_of_that_protocol_fails_with_the_text_save_gives(
        self, monkeypatch: pytest.MonkeyPatch, value: str
    ) -> None:
        monkeypatch.setenv("HTTPS_PROXY", value)
        monkeypatch.setenv("HTTP_PROXY", "http://plain-proxy.example:3128")
        spec = _spec()

        with pytest.raises(ProxyError, match=_exactly(_unusable_message(value))):
            proxy.route_for("https", "api.example", 443, spec)

    def test_the_other_protocol_still_goes_through_its_proxy(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "socks5://proxy.example:1080")
        monkeypatch.setenv("HTTP_PROXY", "http://plain-proxy.example:3128")

        spec = _spec()

        assert proxy.route_for("http", "api.example", 80, spec) == _endpoint(
            "plain-proxy.example", 3128
        )

    def test_an_address_no_proxy_sends_direct_never_fails(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "socks5://proxy.example:1080")
        monkeypatch.setenv("NO_PROXY", "direct.example")

        spec = _spec()

        assert proxy.route_for("https", "direct.example", 443, spec) is None
        assert proxy.route_for("https", "localhost", 8443, spec) is None
        with pytest.raises(ProxyError):
            proxy.route_for("https", "api.example", 443, spec)

    def test_an_unusable_http_proxy_fails_only_http_requests(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "http://secure-proxy.example:3129")
        monkeypatch.setenv("HTTP_PROXY", "socks5://proxy.example:1080")

        spec = _spec()

        assert spec.http is None
        assert proxy.route_for("https", "api.example", 443, spec) == _endpoint(
            "secure-proxy.example", 3129
        )
        with pytest.raises(
            ProxyError, match=_exactly(_unusable_message("socks5://proxy.example:1080"))
        ):
            proxy.route_for("http", "api.example", 80, spec)

    def test_an_unusable_value_alone_leaves_the_other_protocol_direct(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("HTTP_PROXY", "socks5://proxy.example:1080")

        spec = _spec()

        assert spec.https is None
        assert proxy.route_for("https", "api.example", 443, spec) is None

    def test_the_text_masks_a_password_inside_the_value(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("HTTPS_PROXY", f"socks5://ops:{SECRET}@proxy.example:1080")
        spec = _spec()

        with pytest.raises(
            ProxyError,
            match=_exactly(_unusable_message("socks5://ops:********@proxy.example:1080")),
        ):
            proxy.route_for("https", "api.example", 443, spec)

    def test_no_warning_is_written_for_an_unusable_value(
        self, monkeypatch: pytest.MonkeyPatch, run_lines: Lines
    ) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "socks5://proxy.example:1080")

        _spec()

        assert run_lines == []


@pytest.mark.usefixtures("host_source_on")
class TestNoHostVariableAtRunTime:
    """On with the WAVE host's settings and no proxy variable: direct, with one warning a run."""

    def test_requests_connect_directly(self) -> None:
        assert proxy_service.current_proxy_spec() is None

    def test_the_warning_is_written_once_per_block_run(self, run_lines: Lines) -> None:
        for _ in range(3):
            assert proxy_service.current_proxy_spec() is None

        assert run_lines == [("WARNING", DIRECT_WARNING)]

    def test_each_block_run_gets_its_own_warning(self) -> None:
        first = _in_run(proxy_service.current_proxy_spec)
        second = _in_run(proxy_service.current_proxy_spec)

        assert first == [("WARNING", DIRECT_WARNING)]
        assert second == [("WARNING", DIRECT_WARNING)]

    def test_a_call_outside_a_run_writes_nothing_and_uses_up_no_warning(self) -> None:
        assert RUN_LOG.get() is None

        assert proxy_service.current_proxy_spec() is None

        assert _in_run(proxy_service.current_proxy_spec) == [("WARNING", DIRECT_WARNING)]

    @pytest.mark.parametrize("name", ["NO_PROXY", "ALL_PROXY"])
    def test_another_variable_alone_changes_nothing(
        self, monkeypatch: pytest.MonkeyPatch, run_lines: Lines, name: str
    ) -> None:
        monkeypatch.setenv(name, "http://other.example:3128")

        assert proxy_service.current_proxy_spec() is None
        assert run_lines == [("WARNING", DIRECT_WARNING)]

    def test_the_proxy_is_back_once_a_variable_is_set(
        self, monkeypatch: pytest.MonkeyPatch, run_lines: Lines
    ) -> None:
        assert proxy_service.current_proxy_spec() is None

        monkeypatch.setenv("HTTPS_PROXY", "http://proxy.example:3128")

        assert _spec().https == _endpoint("proxy.example", 3128)
        assert run_lines == [("WARNING", DIRECT_WARNING)]


STORED_CUSTOM_PROBLEMS = [
    pytest.param({}, HOST_REQUIRED_MESSAGE, id="no-address-and-no-port"),
    pytest.param({"port": 3128}, HOST_REQUIRED_MESSAGE, id="no-address"),
    pytest.param({"host": "proxy.example"}, PORT_REQUIRED_MESSAGE, id="no-port"),
    pytest.param(
        {
            "host": "proxy.example",
            "port": 3128,
            "entries": [_exact("https://ok.example"), _exact("https://a.example/path")],
        },
        f"Entry 2: {EXACT_TAIL_MESSAGE}",
        id="entry-with-a-path",
    ),
    pytest.param(
        {"host": "proxy.example", "port": 3128, "entries": [_exact("ftp://a.example")]},
        f"Entry 1: {EXACT_FORM_MESSAGE}",
        id="entry-with-another-protocol",
    ),
    pytest.param(
        {
            "host": "proxy.example",
            "port": 3128,
            "entries": [_exact("https://a.example"), _exact("https://a.example:443")],
        },
        "Entry 2: The same address as entry 1",
        id="entry-twice",
    ),
]


class TestStoredCustomProxyTheSaveRulesRefuse:
    """A config file edited by hand: the block run fails with the text Save gives."""

    @pytest.mark.parametrize(("stored", "message"), STORED_CUSTOM_PROBLEMS)
    def test_the_run_fails_with_the_save_text(
        self, load_config: Callable[..., Any], stored: dict[str, Any], message: str
    ) -> None:
        load_config(_proxy_config(enabled=True, source="custom", **stored))

        with pytest.raises(ProxyError, match=_exactly(message)):
            proxy_service.current_proxy_spec()

    def test_a_stored_regex_that_does_not_compile_fails_the_run(
        self, load_config: Callable[..., Any]
    ) -> None:
        load_config(_proxy_config(**CUSTOM_ON, entries=[_regex("(unclosed")]))

        with pytest.raises(ProxyError, match=f"^Entry 1: {REGEX_MESSAGE_PATTERN}$"):
            proxy_service.current_proxy_spec()

    def test_a_stored_username_with_a_colon_fails_the_run(
        self, load_config: Callable[..., Any]
    ) -> None:
        load_config(_proxy_config(**CUSTOM_ON, username="ops:team"))

        with pytest.raises(ProxyError, match=_exactly(USERNAME_COLON_MESSAGE)):
            proxy_service.current_proxy_spec()

    @pytest.mark.parametrize(("stored", "message"), STORED_CUSTOM_PROBLEMS)
    def test_the_same_values_do_nothing_while_the_proxy_is_off(
        self, load_config: Callable[..., Any], stored: dict[str, Any], message: str
    ) -> None:
        load_config(_proxy_config(enabled=False, source="custom", **stored))

        assert proxy_service.current_proxy_spec() is None

    @pytest.mark.parametrize(("stored", "message"), STORED_CUSTOM_PROBLEMS)
    def test_the_same_values_do_nothing_under_the_host_source(
        self,
        load_config: Callable[..., Any],
        monkeypatch: pytest.MonkeyPatch,
        stored: dict[str, Any],
        message: str,
    ) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "http://host-proxy.example:8080")
        load_config(_proxy_config(enabled=True, source="host", **stored))

        spec = _spec()

        assert spec.https == _endpoint("host-proxy.example", 8080)
        assert proxy.route_for("https", "a.example", 443, spec) == spec.https

    def test_wave_still_reads_its_settings(self, load_config: Callable[..., Any]) -> None:
        load_config(_proxy_config(enabled=True, source="custom"))

        assert proxy_service.get_settings() == _settings(enabled=True, source="custom")


class TestStoredPasswordThisWaveCannotUnseal:
    """A config file brought from another WAVE: its sealed password cannot be read here."""

    @pytest.fixture(autouse=True)
    def _password_of_another_wave(self, load_config: Callable[..., Any]) -> None:
        sealed = _sealed_by_another_wave(SECRET)
        load_config(_proxy_config(**CUSTOM_ON, username="ops", password=sealed))

    def test_the_run_fails_as_a_proxy_failure_with_the_ciphers_own_text(self) -> None:
        with pytest.raises(ProxyError, match=_exactly(UNREADABLE_SECRET_MESSAGE)):
            proxy_service.current_proxy_spec()

    def test_the_settings_are_still_read(self) -> None:
        assert proxy_service.get_settings() == _settings(
            **CUSTOM_ON, username="ops", password_set=True
        )

    def test_no_password_is_in_force(self) -> None:
        assert proxy_service.passwords_in_force() == []

    def test_a_new_password_puts_the_proxy_back(self) -> None:
        proxy_service.update_settings(password="second-secret")

        assert _spec().https == _endpoint("proxy.example", 3128, "ops", "second-secret")
        assert proxy_service.passwords_in_force() == ["second-secret"]


class TestPasswordsInForce:
    """The proxy passwords a request can send now, for the run's secret masking."""

    def test_none_while_the_proxy_is_off(self) -> None:
        proxy_service.update_settings(
            source="custom", host="proxy.example", port=3128, username="ops", password=SECRET
        )

        assert proxy_service.passwords_in_force() == []

    def test_the_custom_password(self) -> None:
        proxy_service.update_settings(**CUSTOM_ON, username="ops", password=SECRET)

        assert proxy_service.passwords_in_force() == [SECRET]

    def test_none_for_a_custom_proxy_without_a_password(self) -> None:
        proxy_service.update_settings(**CUSTOM_ON, username="ops")

        assert proxy_service.passwords_in_force() == []

    @pytest.mark.usefixtures("host_source_on")
    def test_the_password_of_each_wave_host_variable(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "http://sec:sec-secret@secure-proxy.example:3129")
        monkeypatch.setenv("HTTP_PROXY", "http://plain:pl%40in-secret@plain-proxy.example:3128")

        assert proxy_service.passwords_in_force() == ["sec-secret", "pl@in-secret"]

    @pytest.mark.usefixtures("host_source_on")
    def test_none_for_wave_host_variables_without_a_password(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "http://ops@proxy.example:3128")
        monkeypatch.setenv("HTTP_PROXY", "socks5://ops:socks-secret@proxy.example:1080")

        assert proxy_service.passwords_in_force() == []

    @pytest.mark.usefixtures("host_source_on")
    def test_the_custom_password_is_not_in_force_under_the_wave_hosts_settings(
        self, load_config: Callable[..., Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        stored = {"enabled": True, "source": "host", "username": "ops"}
        load_config(_proxy_config(**stored, password=seal_value(SECRET)))
        monkeypatch.setenv("HTTPS_PROXY", "http://proxy.example:3128")

        assert proxy_service.passwords_in_force() == []


class TestRegisterProxyResolver:
    def test_the_active_proxy_follows_the_saved_setting(self) -> None:
        proxy_service.register_proxy_resolver()
        assert proxy.active_proxy() is None

        proxy_service.update_settings(**CUSTOM_ON)
        first = proxy.active_proxy()
        proxy_service.update_settings(port=8080, username="ops", password=SECRET)
        second = proxy.active_proxy()
        proxy_service.update_settings(enabled=False)

        assert isinstance(first, ProxySpec)
        assert first.https == CUSTOM_ENDPOINT
        assert isinstance(second, ProxySpec)
        assert second.https == _endpoint("proxy.example", 8080, "ops", SECRET)
        assert second.http == _endpoint("proxy.example", 8080, "ops", SECRET)
        assert proxy.active_proxy() is None

    def test_the_active_proxy_follows_the_wave_hosts_variables(
        self, load_config: Callable[..., Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        proxy_service.register_proxy_resolver()
        load_config(_proxy_config(enabled=True, source="host"))
        monkeypatch.setenv("HTTPS_PROXY", "http://first.example:3128")
        first = proxy.active_proxy()
        monkeypatch.setenv("HTTPS_PROXY", "http://second.example:3128")
        second = proxy.active_proxy()

        assert isinstance(first, ProxySpec)
        assert first.https == _endpoint("first.example", 3128)
        assert isinstance(second, ProxySpec)
        assert second.https == _endpoint("second.example", 3128)

    def test_a_stored_proxy_the_save_rules_refuse_fails_the_active_proxy_read(
        self, load_config: Callable[..., Any]
    ) -> None:
        proxy_service.register_proxy_resolver()
        load_config(_proxy_config(enabled=True, source="custom", host="proxy.example"))

        with pytest.raises(ProxyError, match=_exactly(PORT_REQUIRED_MESSAGE)):
            proxy.active_proxy()


class TestValidateSettings:
    """Every problem of the merged result, in rule order, one per field and one per list row."""

    def test_nothing_wrong_gives_an_empty_list(self) -> None:
        assert proxy_service.validate_settings() == []

    def test_a_valid_custom_proxy_gives_an_empty_list(self) -> None:
        problems = proxy_service.validate_settings(
            **CUSTOM_ON,
            username="ops",
            password=SECRET,
            list_mode="only",
            entries=[_exact("https://A.example:443"), _regex(r"corp\.example")],
            proxy_local_addresses=True,
        )

        assert problems == []

    def test_every_field_problem_is_listed_in_rule_order(self) -> None:
        problems = proxy_service.validate_settings(
            username="u" * 256,
            port=0,
            entries="https://a.example",
            host=5,
            proxy_local_addresses="yes",
            list_mode="all",
            source="system",
            enabled="yes",
        )

        assert problems == [
            _problem("enabled", ENABLED_MESSAGE),
            _problem("source", SOURCE_MESSAGE),
            _problem("list_mode", LIST_MODE_MESSAGE),
            _problem("proxy_local_addresses", LOCAL_MESSAGE),
            _problem("host", HOST_TEXT_MESSAGE),
            _problem("entries", LIST_SHAPE_MESSAGE),
            _problem("port", PORT_MESSAGE),
            _problem("username", USERNAME_LENGTH_MESSAGE),
        ]

    def test_every_problem_of_a_custom_proxy_is_listed_in_rule_order(self) -> None:
        problems = proxy_service.validate_settings(
            enabled=True, source="custom", list_mode="only", password=SECRET
        )

        assert problems == [
            _problem("host", HOST_REQUIRED_MESSAGE),
            _problem("port", PORT_REQUIRED_MESSAGE),
            _problem("username", USERNAME_REQUIRED_MESSAGE),
            _problem("entries", ONLY_EMPTY_MESSAGE),
        ]

    @pytest.mark.usefixtures("custom_proxy_on")
    def test_a_password_without_a_username_is_a_problem_of_the_username(self) -> None:
        assert proxy_service.validate_settings(password=SECRET) == [
            _problem("username", USERNAME_REQUIRED_MESSAGE)
        ]

    @pytest.mark.usefixtures("custom_proxy_on")
    def test_a_long_password_is_a_problem_of_the_password(self) -> None:
        assert proxy_service.validate_settings(username="ops", password="p" * 256) == [
            _problem("password", PASSWORD_LENGTH_MESSAGE)
        ]

    @pytest.mark.usefixtures("custom_proxy_on")
    def test_a_colon_in_the_username_is_a_problem_of_the_username(self) -> None:
        assert proxy_service.validate_settings(username="ops:team") == [
            _problem("username", USERNAME_COLON_MESSAGE)
        ]

    def test_a_colon_in_the_stored_username_is_a_problem_of_the_username(
        self, load_config: Callable[..., Any]
    ) -> None:
        load_config(_proxy_config(**CUSTOM_ON, username="ops:team"))

        assert proxy_service.validate_settings(port=8080) == [
            _problem("username", USERNAME_COLON_MESSAGE)
        ]
        assert proxy_service.validate_settings(username="ops") == []

    @pytest.mark.usefixtures("custom_proxy_on")
    def test_a_long_username_with_a_colon_gets_only_the_length_problem(self) -> None:
        assert proxy_service.validate_settings(username="u:" + "u" * 254) == [
            _problem("username", USERNAME_LENGTH_MESSAGE)
        ]

    @pytest.mark.usefixtures("custom_proxy_on")
    def test_the_colon_problem_is_listed_before_a_long_password(self) -> None:
        assert proxy_service.validate_settings(username="ops:team", password="p" * 256) == [
            _problem("username", USERNAME_COLON_MESSAGE),
            _problem("password", PASSWORD_LENGTH_MESSAGE),
        ]

    def test_a_colon_in_the_password_is_no_problem(self) -> None:
        assert proxy_service.validate_settings(username="ops", password="pa:ss:w0rd") == []

    @pytest.mark.usefixtures("custom_proxy_on")
    def test_the_address_form_is_a_problem_of_the_address(self) -> None:
        assert proxy_service.validate_settings(host="http://proxy.example") == [
            _problem("host", HOST_FORM_MESSAGE)
        ]

    @pytest.mark.usefixtures("custom_proxy_on")
    def test_a_field_gets_only_its_first_problem(self) -> None:
        assert proxy_service.validate_settings(host="http://" + "a" * 250) == [
            _problem("host", HOST_LENGTH_MESSAGE)
        ]

    @pytest.mark.usefixtures("custom_proxy_on")
    def test_an_entry_problem_carries_its_row_and_the_bare_entry_message(self) -> None:
        problems = proxy_service.validate_settings(
            entries=[
                {"kind": "glob", "address": "https://a.example"},
                _exact(""),
                _exact("https://c.example/api"),
                _exact("https://d.example"),
                _exact("https://D.example:443"),
            ]
        )

        assert problems == [
            _problem("entries", KIND_MESSAGE, row=1),
            _problem("entries", ADDRESS_REQUIRED_MESSAGE, row=2),
            _problem("entries", EXACT_TAIL_MESSAGE, row=3),
            _problem("entries", "The same address as entry 4", row=5),
        ]

    @pytest.mark.usefixtures("custom_proxy_on")
    def test_a_list_row_gets_only_its_first_problem(self) -> None:
        problems = proxy_service.validate_settings(
            entries=[{"kind": "glob", "address": ""}, _exact("a" * 257)]
        )

        assert problems == [
            _problem("entries", KIND_MESSAGE, row=1),
            _problem("entries", ADDRESS_LENGTH_MESSAGE, row=2),
        ]

    @pytest.mark.usefixtures("custom_proxy_on")
    def test_a_regex_that_does_not_compile_is_a_problem_of_its_row(self) -> None:
        problems = proxy_service.validate_settings(
            entries=[_regex(r"corp\.example"), _regex("(unclosed")]
        )

        assert len(problems) == 1
        assert {key: problems[0][key] for key in ("field", "row")} == {
            "field": "entries",
            "row": 2,
        }
        assert set(problems[0]) == {"field", "row", "message"}
        assert re.fullmatch(REGEX_MESSAGE_PATTERN, problems[0]["message"])

    @pytest.mark.usefixtures("custom_proxy_on")
    def test_the_list_limit_is_a_problem_of_the_list_with_no_row(self) -> None:
        assert proxy_service.validate_settings(entries=_entries(101)) == [
            _problem("entries", LIST_LIMIT_MESSAGE)
        ]

    def test_only_mode_without_an_entry_is_a_problem_of_the_list_with_no_row(self) -> None:
        assert proxy_service.validate_settings(**CUSTOM_ON, list_mode="only") == [
            _problem("entries", ONLY_EMPTY_MESSAGE)
        ]

    def test_a_host_without_a_proxy_variable_is_a_problem_of_the_source(self) -> None:
        assert proxy_service.validate_settings(enabled=True, source="host") == [
            _problem("source", NO_HOST_VARIABLE_MESSAGE)
        ]

    def test_a_value_wave_cannot_use_is_a_problem_of_the_source(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("HTTPS_PROXY", f"socks5://ops:{SECRET}@proxy.example:1080")

        assert proxy_service.validate_settings(enabled=True) == [
            _problem("source", _unusable_message("socks5://ops:********@proxy.example:1080"))
        ]

    def test_two_unusable_values_are_one_problem_of_the_source(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "socks5://proxy.example:1080")
        monkeypatch.setenv("HTTP_PROXY", "socks5://proxy.example:1080")

        assert proxy_service.validate_settings(enabled=True, source="host") == [
            _problem("source", _unusable_message("socks5://proxy.example:1080"))
        ]

    def test_under_the_host_source_only_the_source_can_have_a_problem(self) -> None:
        problems = proxy_service.validate_settings(
            enabled=True, source="host", port=70000, entries=[_exact("https://a.example/")]
        )

        assert problems == [_problem("source", NO_HOST_VARIABLE_MESSAGE)]

    @pytest.mark.parametrize(
        "subset",
        [
            pytest.param({"host": "http://proxy"}, id="a-bad-address"),
            pytest.param({"port": 0}, id="a-bad-port"),
            pytest.param({"username": "ops:team"}, id="a-bad-username"),
            pytest.param({"password": "p" * 256}, id="a-long-password"),
            pytest.param({"entries": [_exact("")]}, id="a-bad-entry"),
            pytest.param({"list_mode": "all"}, id="a-bad-list-mode"),
            pytest.param({"source": "system"}, id="a-bad-source"),
        ],
    )
    def test_what_the_page_hides_while_the_proxy_is_off_has_no_problem(
        self, subset: dict[str, Any]
    ) -> None:
        proxy_service.update_settings(**CUSTOM_ON)

        assert proxy_service.validate_settings(enabled=False, **subset) == []

    def test_a_blank_address_and_an_empty_port_pass_while_the_proxy_is_off(self) -> None:
        assert proxy_service.validate_settings(source="custom", host="", port=None) == []

    def test_a_null_username_and_a_null_password_are_read_as_omitted(self) -> None:
        proxy_service.update_settings(username="ops", password=SECRET)

        assert proxy_service.validate_settings(username=None, password=None) == []

    def test_the_subset_is_merged_with_the_stored_settings(self) -> None:
        assert proxy_service.validate_settings(host="") == []
        assert proxy_service.validate_settings(enabled=True, source="custom") == [
            _problem("host", HOST_REQUIRED_MESSAGE),
            _problem("port", PORT_REQUIRED_MESSAGE),
        ]

        proxy_service.update_settings(**CUSTOM_ON)

        assert proxy_service.validate_settings(enabled=True, source="custom") == []
        assert proxy_service.validate_settings(host="") == [_problem("host", HOST_REQUIRED_MESSAGE)]
        assert proxy_service.validate_settings(list_mode="only") == [
            _problem("entries", ONLY_EMPTY_MESSAGE)
        ]

    @pytest.mark.usefixtures("custom_proxy_on")
    def test_a_new_password_is_checked_against_the_stored_username(self) -> None:
        assert proxy_service.validate_settings(password=SECRET) == [
            _problem("username", USERNAME_REQUIRED_MESSAGE)
        ]

        proxy_service.update_settings(username="ops")

        assert proxy_service.validate_settings(password=SECRET) == []
        assert proxy_service.validate_settings(username="", password=SECRET) == [
            _problem("username", USERNAME_REQUIRED_MESSAGE)
        ]

    def test_emptying_the_username_of_a_stored_password_is_no_problem(self) -> None:
        proxy_service.update_settings(username="ops", password=SECRET)

        assert proxy_service.validate_settings(username="") == []

    def test_a_check_with_problems_writes_nothing(self, config_file: Path) -> None:
        saved = proxy_service.update_settings(**CUSTOM_ON, username="ops", password=SECRET)
        before = config_file.read_bytes()

        problems = proxy_service.validate_settings(host="", port=0, password="second-secret")

        assert [problem["field"] for problem in problems] == ["host", "port"]
        assert config_file.read_bytes() == before
        assert proxy_service.get_settings() == saved
        assert _spec().https == _endpoint("proxy.example", 3128, "ops", SECRET)

    def test_a_check_without_problems_writes_nothing(
        self, config_file: Path, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        before = config_file.read_bytes()

        problems = proxy_service.validate_settings(
            **CUSTOM_ON, username="ops", password=SECRET, entries=[_exact("https://a.example")]
        )

        assert problems == []
        assert config_file.read_bytes() == before
        assert config_on_disk() == {}
        assert proxy_service.get_settings() == DEFAULT_SETTINGS
        assert proxy_service.current_proxy_spec() is None

    def test_a_check_passes_on_a_read_only_config(self, read_only_config: Path) -> None:
        before = read_only_config.read_bytes()

        assert proxy_service.validate_settings(**CUSTOM_ON) == []
        assert read_only_config.read_bytes() == before

    def test_the_save_refuses_with_the_first_problem_of_the_check(
        self, refused: Callable[..., None]
    ) -> None:
        subset: dict[str, Any] = {
            "enabled": True,
            "source": "custom",
            "host": "proxy.example",
            "entries": [_exact("https://ok.example"), _exact("ftp://a.example")],
        }

        problems = proxy_service.validate_settings(**subset)

        assert problems == [
            _problem("port", PORT_REQUIRED_MESSAGE),
            _problem("entries", EXACT_FORM_MESSAGE, row=2),
        ]
        refused(PORT_REQUIRED_MESSAGE, **subset)
        refused(f"Entry 2: {EXACT_FORM_MESSAGE}", **subset, port=3128)


class TestReset:
    def test_reset_restores_the_defaults(self) -> None:
        proxy_service.update_settings(
            **CUSTOM_ON,
            username="ops",
            password=SECRET,
            list_mode="only",
            entries=[_exact("https://a.example"), _regex(r"corp\.example")],
            proxy_local_addresses=True,
        )

        proxy_service.reset()

        assert proxy_service.get_settings() == DEFAULT_SETTINGS
        assert proxy_service.current_proxy_spec() is None

    def test_reset_saves_the_defaults_in_the_config_file(
        self, config_file: Path, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        proxy_service.update_settings(
            **CUSTOM_ON,
            username="ops",
            password=SECRET,
            list_mode="only",
            entries=[_exact("https://a.example")],
            proxy_local_addresses=True,
        )

        proxy_service.reset()

        assert {**STORED_DEFAULTS, **_stored_proxy(config_on_disk)} == STORED_DEFAULTS
        assert ENVELOPE_PREFIX not in config_file.read_text(encoding="utf-8")

    def test_the_defaults_survive_a_restart(self, load_config: Callable[..., Any]) -> None:
        proxy_service.update_settings(**CUSTOM_ON, username="ops", password=SECRET)
        proxy_service.reset()

        load_config()

        assert proxy_service.get_settings() == DEFAULT_SETTINGS

    def test_reset_ends_a_proxy_taken_from_the_wave_host(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("HTTPS_PROXY", "http://proxy.example:3128")
        proxy_service.update_settings(enabled=True, source="host")
        assert _spec().https == _endpoint("proxy.example", 3128)

        proxy_service.reset()

        assert proxy_service.current_proxy_spec() is None
        assert proxy_service.get_settings() == _settings(
            host_values=_host_values(https_proxy="http://proxy.example:3128")
        )

    def test_reset_on_a_fresh_config_leaves_the_defaults(self) -> None:
        proxy_service.reset()

        assert proxy_service.get_settings() == DEFAULT_SETTINGS

    def test_reset_keeps_the_defaults_own_list_out_of_the_running_config(self) -> None:
        proxy_service.reset()

        running = get_config().get("network.proxy.entries")
        assert running == []
        assert running is not SECTION_DEFAULTS["network"]["proxy"]["entries"]

    def test_reset_leaves_the_other_settings_alone(
        self, load_config: Callable[..., Any], config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        load_config(
            {
                "logging": {"level": "INFO"},
                "network": {
                    "certificates": {"public_source": "builtin"},
                    "proxy": {"source": "custom", "host": "proxy.example", "port": 3128},
                },
            }
        )

        proxy_service.reset()

        on_disk = config_on_disk()
        assert on_disk["logging"] == {"level": "INFO"}
        assert on_disk["network"]["certificates"] == {"public_source": "builtin"}
        assert {**STORED_DEFAULTS, **on_disk["network"]["proxy"]} == STORED_DEFAULTS

    def test_reset_with_a_read_only_config_is_refused_and_keeps_the_proxy(
        self, request: pytest.FixtureRequest
    ) -> None:
        saved = proxy_service.update_settings(**CUSTOM_ON, username="ops", password=SECRET)
        config_file: Path = request.getfixturevalue("read_only_config")
        before = config_file.read_bytes()

        with pytest.raises(ConfigWriteError, match=_read_only_message(config_file)):
            proxy_service.reset()

        assert config_file.read_bytes() == before
        assert proxy_service.get_settings() == saved
        assert _spec().https == _endpoint("proxy.example", 3128, "ops", SECRET)
