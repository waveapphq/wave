"""Instance settings in the config file: keys, defaults and startup checks (REQ-4.7.17)."""

import copy
import importlib
import re
from collections.abc import Callable
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

from wavecore.api.config import loader
from wavecore.api.config.loader import Config, ConfigValidationError, get_config
from wavecore.connectivity import trust_store
from wavecore.core.logging import formatter
from wavecore.core.secrets.key_provider import get_cipher

LoadConfig = Callable[..., Config]

DEFAULTS: list[tuple[str, Any]] = [
    ("logging.level", "INFO"),
    ("secret_masking.run_output", False),
    ("secret_masking.test_variables", False),
    ("secret_masking.shared_variables", False),
    ("secret_masking.credential_inputs", False),
    ("network.ssh_hosts.lock_trusted_hosts", False),
    ("network.ssh_hosts.default_block_action", "disabled"),
    ("network.certificates.public_source", "builtin"),
    ("network.proxy.enabled", False),
    ("network.proxy.source", "host"),
    ("network.proxy.host", ""),
    ("network.proxy.port", None),
    ("network.proxy.username", ""),
    ("network.proxy.password", None),
    ("network.proxy.list_mode", "except"),
    ("network.proxy.entries", []),
    ("network.proxy.proxy_local_addresses", False),
    ("mcp.enabled", False),
    ("mcp.port", 8765),
    ("mcp.bind", "local"),
    ("mcp.auth_enabled", False),
    ("mcp.auth_username", ""),
    ("mcp.auth_password", None),
    ("backup.schedule.enabled", False),
    ("backup.schedule.cron", ""),
    ("backup.schedule.entity_types", None),
    ("backup.schedule.max_backups", 5),
    ("backup.schedule.save_directory", "~/wave-backups"),
    ("backup.schedule.format", "yaml"),
    ("backup.schedule.compression_method", "deflate"),
    ("backup.schedule.compression_level", 6),
    ("backup.schedule.secrets", "mask"),
    ("backup.schedule.last_run", None),
    ("backup.schedule.last_run_status", None),
]
DEFAULT_KEYS = [key for key, _ in DEFAULTS]

SECTION_DEFAULTS: dict[str, dict[str, Any]] = {
    "secret_masking": {
        "run_output": False,
        "test_variables": False,
        "shared_variables": False,
        "credential_inputs": False,
    },
    "network": {
        "ssh_hosts": {"lock_trusted_hosts": False, "default_block_action": "disabled"},
        "certificates": {"public_source": "builtin"},
        "proxy": {
            "enabled": False,
            "source": "host",
            "host": "",
            "port": None,
            "username": "",
            "password": None,
            "list_mode": "except",
            "entries": [],
            "proxy_local_addresses": False,
        },
    },
    "mcp": {
        "enabled": False,
        "port": 8765,
        "bind": "local",
        "auth_enabled": False,
        "auth_username": "",
        "auth_password": None,
    },
    "backup": {
        "schedule": {
            "enabled": False,
            "cron": "",
            "entity_types": None,
            "max_backups": 5,
            "save_directory": "~/wave-backups",
            "format": "yaml",
            "compression_method": "deflate",
            "compression_level": 6,
            "secrets": "mask",
            "last_run": None,
            "last_run_status": None,
        },
    },
}

LEVEL_RULE = "must be one of DEBUG, INFO, WARN, ERROR, FATAL"
BOOLEAN_RULE = "must be true or false"
ACTION_RULE = "must be strict, accept-new or disabled"
LOCK_RULE = "cannot be accept-new while network.ssh_hosts.lock_trusted_hosts is true"
SOURCE_RULE = "must be builtin or host"
PROXY_SOURCE_RULE = "must be host or custom"
PROXY_PORT_RULE = "must be a whole number from 1 to 65535 or empty"
PROXY_PASSWORD_RULE = "must be set from Settings > Network > Proxy, where it is stored sealed"
LIST_MODE_RULE = "must be except or only"
ENTRIES_RULE = "must be a list of entries with a kind (exact or regex) and an address"
PORT_RULE = "must be a whole number from 1024 to 65535"
BIND_RULE = "must be local or network"
TEXT_RULE = "must be text"
PASSWORD_RULE = "must be set from Settings > MCP Server, where it is stored sealed"
REQUIRED_RULE = "is required while mcp.auth_enabled is true"
ENTITY_TYPES_RULE = "must be a list of entity type names or null"
MAX_BACKUPS_RULE = "must be a whole number of 1 or more"
MAX_BACKUPS_CAP_RULE = "must be a whole number of at most 19 digits"
COMPRESSION_LEVEL_RULE = "must be a whole number from 1 to 9"
LAST_RUN_RULE = "must be a timestamp or null"
LAST_RUN_STATUS_RULE = "must be success, failed or null"
SECTION_RULE = "must be a section"

BOOLEAN_KEYS = (
    "secret_masking.run_output",
    "secret_masking.test_variables",
    "secret_masking.shared_variables",
    "secret_masking.credential_inputs",
    "network.ssh_hosts.lock_trusted_hosts",
    "network.proxy.enabled",
    "network.proxy.proxy_local_addresses",
    "mcp.enabled",
    "mcp.auth_enabled",
    "backup.schedule.enabled",
)
TEXT_KEYS = (
    "network.proxy.host",
    "network.proxy.username",
    "mcp.auth_username",
    "backup.schedule.cron",
    "backup.schedule.save_directory",
    "backup.schedule.format",
    "backup.schedule.compression_method",
    "backup.schedule.secrets",
)
SECTION_KEYS = (
    "secret_masking",
    "network",
    "network.ssh_hosts",
    "network.certificates",
    "network.proxy",
    "mcp",
    "backup",
    "backup.schedule",
)

EXACT_ENTRY = {"kind": "exact", "address": "https://a.example"}
REGEX_ENTRY = {"kind": "regex", "address": r"^https://.*\.b\.example(:\d+)?$"}
# Values that are not a list of entries with a kind of exact or regex and a text address.
MISSHAPEN_ENTRIES: list[Any] = [
    "https://a.example",
    5,
    EXACT_ENTRY,
    ["https://a.example"],
    [5],
    [{"kind": "exact"}],
    [{"address": "https://a.example"}],
    [EXACT_ENTRY, {"kind": "regex"}],
    [{"kind": "glob", "address": "https://a.example"}],
    [{"kind": "Exact", "address": "https://a.example"}],
    [{"kind": 5, "address": "https://a.example"}],
    [{"kind": None, "address": "https://a.example"}],
    [{"kind": "exact", "address": 5}],
    [{"kind": "exact", "address": None}],
    [{"kind": "exact", "address": ["https://a.example"]}],
    [EXACT_ENTRY, {"kind": "glob", "address": "https://b.example"}],
]

REFUSED: list[tuple[str, Any, str]] = [
    ("logging.level", "TRACE", LEVEL_RULE),
    ("logging.level", "verbose", LEVEL_RULE),
    ("logging.level", "", LEVEL_RULE),
    ("logging.level", 5, LEVEL_RULE),
    *[(key, value, BOOLEAN_RULE) for key in BOOLEAN_KEYS for value in ("true", "yes")],
    ("network.ssh_hosts.default_block_action", "ask", ACTION_RULE),
    ("network.ssh_hosts.default_block_action", 5, ACTION_RULE),
    ("network.certificates.public_source", "system", SOURCE_RULE),
    ("network.certificates.public_source", 5, SOURCE_RULE),
    ("network.proxy.source", "system", PROXY_SOURCE_RULE),
    ("network.proxy.source", 5, PROXY_SOURCE_RULE),
    ("network.proxy.port", 0, PROXY_PORT_RULE),
    ("network.proxy.port", -1, PROXY_PORT_RULE),
    ("network.proxy.port", 65536, PROXY_PORT_RULE),
    ("network.proxy.port", "+3128", PROXY_PORT_RULE),
    ("network.proxy.port", "3128.0", PROXY_PORT_RULE),
    ("network.proxy.port", 3128.5, PROXY_PORT_RULE),
    ("network.proxy.password", "plain", PROXY_PASSWORD_RULE),
    ("network.proxy.password", 5, PROXY_PASSWORD_RULE),
    ("network.proxy.list_mode", "all", LIST_MODE_RULE),
    ("network.proxy.list_mode", 5, LIST_MODE_RULE),
    *[("network.proxy.entries", value, ENTRIES_RULE) for value in MISSHAPEN_ENTRIES],
    ("mcp.port", 1023, PORT_RULE),
    ("mcp.port", 65536, PORT_RULE),
    ("mcp.port", 0, PORT_RULE),
    ("mcp.port", " 8765", PORT_RULE),
    ("mcp.port", "12345678901234567890", PORT_RULE),
    ("mcp.port", 8765.5, PORT_RULE),
    ("mcp.bind", "public", BIND_RULE),
    ("mcp.bind", 5, BIND_RULE),
    *[(key, value, TEXT_RULE) for key in TEXT_KEYS for value in (5, ["item"])],
    ("mcp.auth_password", "plain", PASSWORD_RULE),
    ("mcp.auth_password", 5, PASSWORD_RULE),
    ("backup.schedule.entity_types", "tests", ENTITY_TYPES_RULE),
    ("backup.schedule.entity_types", 5, ENTITY_TYPES_RULE),
    ("backup.schedule.entity_types", ["tests", 5], ENTITY_TYPES_RULE),
    ("backup.schedule.entity_types", {"tests": True}, ENTITY_TYPES_RULE),
    ("backup.schedule.max_backups", 0, MAX_BACKUPS_RULE),
    ("backup.schedule.max_backups", -1, MAX_BACKUPS_RULE),
    ("backup.schedule.max_backups", "5.0", MAX_BACKUPS_RULE),
    ("backup.schedule.max_backups", "-12345678901234567890", MAX_BACKUPS_RULE),
    ("backup.schedule.max_backups", 10**19, MAX_BACKUPS_CAP_RULE),
    ("backup.schedule.max_backups", "12345678901234567890", MAX_BACKUPS_CAP_RULE),
    ("backup.schedule.max_backups", 2.5, MAX_BACKUPS_RULE),
    ("backup.schedule.compression_level", 0, COMPRESSION_LEVEL_RULE),
    ("backup.schedule.compression_level", 10, COMPRESSION_LEVEL_RULE),
    ("backup.schedule.compression_level", "6.0", COMPRESSION_LEVEL_RULE),
    ("backup.schedule.compression_level", 6.5, COMPRESSION_LEVEL_RULE),
    ("backup.schedule.last_run", 5, LAST_RUN_RULE),
    ("backup.schedule.last_run", "yesterday", LAST_RUN_RULE),
    ("backup.schedule.last_run", ["2026-10-04T10:00:00+00:00"], LAST_RUN_RULE),
    ("backup.schedule.last_run_status", "ok", LAST_RUN_STATUS_RULE),
    ("backup.schedule.last_run_status", 5, LAST_RUN_STATUS_RULE),
    *[(key, value, SECTION_RULE) for key in SECTION_KEYS for value in (5, "text", ["item"])],
]

ACCEPTED: list[tuple[str, Any]] = [
    *[(key, True) for key in BOOLEAN_KEYS if key != "mcp.auth_enabled"],
    ("network.ssh_hosts.default_block_action", "strict"),
    ("network.ssh_hosts.default_block_action", "accept-new"),
    ("network.ssh_hosts.default_block_action", "disabled"),
    ("network.certificates.public_source", "host"),
    ("network.proxy.source", "host"),
    ("network.proxy.source", "custom"),
    ("network.proxy.host", "proxy.corp.example"),
    ("network.proxy.port", 1),
    ("network.proxy.port", 3128),
    ("network.proxy.port", 65535),
    ("network.proxy.port", "3128"),
    ("network.proxy.username", "alice"),
    ("network.proxy.list_mode", "except"),
    ("network.proxy.list_mode", "only"),
    ("network.proxy.entries", []),
    ("network.proxy.entries", [EXACT_ENTRY]),
    ("network.proxy.entries", [EXACT_ENTRY, REGEX_ENTRY]),
    ("network.proxy.entries", [{"kind": "exact", "address": ""}]),
    ("network.proxy.entries", [{"kind": "exact", "address": "a.example"}]),
    ("network.proxy.entries", [{"kind": "regex", "address": "("}]),
    ("network.proxy.entries", [EXACT_ENTRY, dict(EXACT_ENTRY)]),
    ("mcp.port", 1024),
    ("mcp.port", 65535),
    ("mcp.port", "8765"),
    ("mcp.bind", "network"),
    ("mcp.auth_username", "alice"),
    ("backup.schedule.cron", "0 2 * * *"),
    ("backup.schedule.entity_types", ["tests", "suites"]),
    ("backup.schedule.max_backups", 1),
    ("backup.schedule.max_backups", 500),
    ("backup.schedule.max_backups", "5"),
    ("backup.schedule.max_backups", 10**19 - 1),
    ("backup.schedule.save_directory", "/srv/wave-backups"),
    ("backup.schedule.format", "json"),
    ("backup.schedule.compression_method", "stored"),
    ("backup.schedule.compression_level", 1),
    ("backup.schedule.compression_level", 9),
    ("backup.schedule.compression_level", "06"),
    ("backup.schedule.secrets", "encrypted"),
    ("backup.schedule.last_run", "2026-10-04T10:00:00+00:00"),
    ("backup.schedule.last_run_status", "success"),
    ("backup.schedule.last_run_status", "failed"),
]

# One invalid value per key, in the order the keys are checked.
ORDERED_PROBLEMS: list[tuple[str, Any, str]] = [
    ("logging.level", "TRACE", LEVEL_RULE),
    ("secret_masking.run_output", "yes", BOOLEAN_RULE),
    ("secret_masking.test_variables", "yes", BOOLEAN_RULE),
    ("secret_masking.shared_variables", "yes", BOOLEAN_RULE),
    ("secret_masking.credential_inputs", "yes", BOOLEAN_RULE),
    ("network.ssh_hosts.lock_trusted_hosts", "yes", BOOLEAN_RULE),
    ("network.ssh_hosts.default_block_action", "ask", ACTION_RULE),
    ("network.certificates.public_source", "system", SOURCE_RULE),
    ("network.proxy.enabled", "yes", BOOLEAN_RULE),
    ("network.proxy.source", "system", PROXY_SOURCE_RULE),
    ("network.proxy.host", 5, TEXT_RULE),
    ("network.proxy.port", 0, PROXY_PORT_RULE),
    ("network.proxy.username", 5, TEXT_RULE),
    ("network.proxy.password", "plain", PROXY_PASSWORD_RULE),
    ("network.proxy.list_mode", "all", LIST_MODE_RULE),
    ("network.proxy.entries", "https://a.example", ENTRIES_RULE),
    ("network.proxy.proxy_local_addresses", "yes", BOOLEAN_RULE),
    ("mcp.enabled", "yes", BOOLEAN_RULE),
    ("mcp.port", 80, PORT_RULE),
    ("mcp.bind", "public", BIND_RULE),
    ("mcp.auth_enabled", "yes", BOOLEAN_RULE),
    ("mcp.auth_username", 5, TEXT_RULE),
    ("mcp.auth_password", "plain", PASSWORD_RULE),
    ("backup.schedule.enabled", "yes", BOOLEAN_RULE),
    ("backup.schedule.cron", 5, TEXT_RULE),
    ("backup.schedule.entity_types", "tests", ENTITY_TYPES_RULE),
    ("backup.schedule.max_backups", 0, MAX_BACKUPS_RULE),
    ("backup.schedule.save_directory", 5, TEXT_RULE),
    ("backup.schedule.format", 5, TEXT_RULE),
    ("backup.schedule.compression_method", 5, TEXT_RULE),
    ("backup.schedule.compression_level", 10, COMPRESSION_LEVEL_RULE),
    ("backup.schedule.secrets", 5, TEXT_RULE),
    ("backup.schedule.last_run", 5, LAST_RUN_RULE),
    ("backup.schedule.last_run_status", "ok", LAST_RUN_STATUS_RULE),
]
KEY_RULES = {key: rule for key, _, rule in ORDERED_PROBLEMS}

NULLABLE_KEYS = (
    "network.proxy.port",
    "network.proxy.password",
    "mcp.auth_password",
    "backup.schedule.entity_types",
    "backup.schedule.last_run",
    "backup.schedule.last_run_status",
)
NOT_NULLABLE_KEYS = [key for key in DEFAULT_KEYS if key not in NULLABLE_KEYS]
WHOLE_NUMBER_KEYS = (
    "network.proxy.port",
    "mcp.port",
    "backup.schedule.max_backups",
    "backup.schedule.compression_level",
)
WRONG_CASE: list[tuple[str, str]] = [
    ("network.ssh_hosts.default_block_action", "Strict"),
    ("network.ssh_hosts.default_block_action", "DISABLED"),
    ("network.certificates.public_source", "BUILTIN"),
    ("network.certificates.public_source", "Host"),
    ("network.proxy.source", "Host"),
    ("network.proxy.source", "CUSTOM"),
    ("network.proxy.list_mode", "Except"),
    ("network.proxy.list_mode", "ONLY"),
    ("mcp.bind", "Local"),
    ("mcp.bind", "NETWORK"),
    ("backup.schedule.last_run_status", "Success"),
    ("backup.schedule.last_run_status", "FAILED"),
]
KNOWN_SECTIONS = ("server", "storage", "logging", "integration", "security")

USERNAME_REQUIRED = ("mcp.auth_username", REQUIRED_RULE)
PASSWORD_REQUIRED = ("mcp.auth_password", REQUIRED_RULE)


def _settings() -> ModuleType:
    return importlib.import_module("wavecore.api.config.instance_settings")


def _put(content: dict[str, Any], key: str, value: Any) -> dict[str, Any]:
    *parents, name = key.split(".")
    node = content
    for parent in parents:
        node = node.setdefault(parent, {})
    node[name] = value
    return content


def _file(key: str, value: Any) -> dict[str, Any]:
    return _put({}, key, value)


def _refusal(path: Path, key: str, rule: str) -> str:
    return rf"^Config file {re.escape(str(path))}: {re.escape(f'{key} {rule}')}$"


def _is(value: Any, expected: Any) -> bool:
    if expected is None or isinstance(expected, bool):
        return value is expected
    same_kind = isinstance(value, type(expected)) and not isinstance(value, bool)
    return same_kind and value == expected


def _case_ids(cases: list[tuple[Any, ...]]) -> list[str]:
    return [f"{case[0]}={case[1]!r}" for case in cases]


def _sections() -> dict[str, dict[str, Any]]:
    return {"logging": {"level": "INFO"}, **copy.deepcopy(SECTION_DEFAULTS)}


def _empty_section(key: str) -> str:
    """YAML text where the section key has nothing under it."""
    return "".join(f"{'  ' * depth}{part}:\n" for depth, part in enumerate(key.split(".")))


def _content(*settings: tuple[str, Any]) -> dict[str, Any]:
    content: dict[str, Any] = {}
    for key, value in settings:
        _put(content, key, value)
    return content


class TestDefaults:
    @pytest.mark.parametrize(("key", "expected"), DEFAULTS, ids=DEFAULT_KEYS)
    def test_empty_file_gives_the_default(self, key: str, expected: Any) -> None:
        assert _is(get_config().get(key), expected)

    def test_section_defaults_hold_every_settings_owned_key(self) -> None:
        assert _settings().SECTION_DEFAULTS == SECTION_DEFAULTS

    def test_sections_are_read_by_attribute_access(self) -> None:
        config = get_config()

        assert config.secret_masking.run_output is False
        assert config.network.ssh_hosts.lock_trusted_hosts is False
        assert config.network.ssh_hosts.default_block_action == "disabled"
        assert config.network.certificates.public_source == "builtin"
        assert config.mcp.port == 8765
        assert config.backup.schedule.save_directory == "~/wave-backups"

    def test_two_configs_do_not_share_their_defaults(self, config_file: Path) -> None:
        first = Config(config_file=str(config_file))
        second = Config(config_file=str(config_file))

        first.set("network.ssh_hosts.lock_trusted_hosts", True, validate=False)

        assert second.get("network.ssh_hosts.lock_trusted_hosts") is False
        assert _settings().SECTION_DEFAULTS == SECTION_DEFAULTS

    def test_two_configs_do_not_share_the_default_address_list(self, config_file: Path) -> None:
        first = Config(config_file=str(config_file))
        second = Config(config_file=str(config_file))

        first.get("network.proxy.entries").append(dict(EXACT_ENTRY))

        assert second.get("network.proxy.entries") == []
        assert _settings().SECTION_DEFAULTS == SECTION_DEFAULTS


class TestAbsentKeys:
    def test_network_section_is_merged_one_level_deeper(self, load_config: LoadConfig) -> None:
        config = load_config({"network": {"ssh_hosts": {"lock_trusted_hosts": True}}})

        assert config.get("network.ssh_hosts.lock_trusted_hosts") is True
        assert config.get("network.ssh_hosts.default_block_action") == "disabled"
        assert config.get("network.certificates.public_source") == "builtin"

    def test_proxy_section_is_merged_one_level_deeper(self, load_config: LoadConfig) -> None:
        config = load_config({"network": {"proxy": {"enabled": True}}})

        assert config.get("network.proxy.enabled") is True
        assert config.get("network.proxy.source") == "host"
        assert config.get("network.proxy.port") is None
        assert config.get("network.proxy.entries") == []
        assert config.get("network.ssh_hosts.default_block_action") == "disabled"

    def test_backup_schedule_is_merged_one_level_deeper(self, load_config: LoadConfig) -> None:
        config = load_config({"backup": {"schedule": {"cron": "0 2 * * *"}}})

        assert config.get("backup.schedule.cron") == "0 2 * * *"
        assert config.get("backup.schedule.max_backups") == 5
        assert config.get("backup.schedule.save_directory") == "~/wave-backups"
        assert config.get("backup.schedule.last_run") is None

    def test_flat_sections_keep_their_other_defaults(self, load_config: LoadConfig) -> None:
        config = load_config({"mcp": {"port": 9000}, "secret_masking": {"run_output": True}})

        assert config.get("mcp.port") == 9000
        assert config.get("mcp.bind") == "local"
        assert config.get("mcp.auth_password") is None
        assert config.get("secret_masking.run_output") is True
        assert config.get("secret_masking.credential_inputs") is False

    @pytest.mark.parametrize(("key", "expected"), DEFAULTS[1:], ids=DEFAULT_KEYS[1:])
    def test_empty_sections_take_every_default(
        self, key: str, expected: Any, load_config: LoadConfig
    ) -> None:
        config = load_config(
            {
                "secret_masking": {},
                "network": {"ssh_hosts": {}, "certificates": {}, "proxy": {}},
                "mcp": {},
                "backup": {"schedule": {}},
            }
        )

        assert _is(config.get(key), expected)


class TestAcceptedValues:
    @pytest.mark.parametrize(("key", "value"), ACCEPTED, ids=_case_ids(ACCEPTED))
    def test_valid_value_is_loaded(self, key: str, value: Any, load_config: LoadConfig) -> None:
        config = load_config(_file(key, value))

        expected = int(value) if key in WHOLE_NUMBER_KEYS and isinstance(value, str) else value
        assert _is(config.get(key), expected)

    @pytest.mark.parametrize("written", ["0x223D", "0o21075", "8_765", "+8765"])
    def test_a_port_written_in_another_number_form_is_text_and_refused(
        self, written: str, config_file: Path, load_config: LoadConfig
    ) -> None:
        with pytest.raises(
            ConfigValidationError, match=_refusal(config_file, "mcp.port", PORT_RULE)
        ):
            load_config(f"mcp:\n  port: {written}\n")

    def test_a_port_written_as_plain_digits_is_the_number(self, load_config: LoadConfig) -> None:
        config = load_config("mcp:\n  port: 08765\n")

        assert _is(config.get("mcp.port"), 8765)

    @pytest.mark.parametrize(
        ("level", "canonical"),
        [
            ("DEBUG", "DEBUG"),
            ("INFO", "INFO"),
            ("WARN", "WARN"),
            ("ERROR", "ERROR"),
            ("FATAL", "FATAL"),
            ("debug", "DEBUG"),
            ("Warn", "WARN"),
            ("WARNING", "WARN"),
            ("warning", "WARN"),
            ("CRITICAL", "FATAL"),
            ("critical", "FATAL"),
        ],
    )
    def test_log_level_names_and_aliases_load_in_any_case(
        self, level: str, canonical: str, load_config: LoadConfig
    ) -> None:
        config = load_config({"logging": {"level": level}})

        assert _settings().canonical_log_level(config.logging.level) == canonical

    def test_text_settings_are_not_checked_against_value_lists(
        self, load_config: LoadConfig
    ) -> None:
        schedule = {
            "cron": "not a cron",
            "save_directory": "relative/folder",
            "format": "xml",
            "compression_method": "zstd",
            "secrets": "clear",
        }

        config = load_config({"backup": {"schedule": schedule}})

        for name, value in schedule.items():
            assert config.get(f"backup.schedule.{name}") == value

    def test_null_optional_values_are_loaded(self, load_config: LoadConfig) -> None:
        config = load_config(
            "mcp:\n"
            "  auth_password: null\n"
            "backup:\n"
            "  schedule:\n"
            "    entity_types: null\n"
            "    last_run: null\n"
            "    last_run_status: null\n"
        )

        assert config.get("mcp.auth_password") is None
        assert config.get("backup.schedule.entity_types") is None
        assert config.get("backup.schedule.last_run") is None
        assert config.get("backup.schedule.last_run_status") is None

    @pytest.mark.parametrize("written", ["port:", "port: null"], ids=["nothing", "null"])
    def test_empty_proxy_port_is_loaded(self, written: str, load_config: LoadConfig) -> None:
        config = load_config(f"network:\n  proxy:\n    host: proxy.corp.example\n    {written}\n")

        assert config.get("network.proxy.port") is None
        assert config.get("network.proxy.host") == "proxy.corp.example"
        assert config.get("network.proxy.source") == "host"

    @pytest.mark.parametrize("written", ["2026-10-04T10:00:00Z", "2026-10-04T10:00:00+00:00"])
    def test_last_run_written_without_quotes_is_loaded(
        self, written: str, load_config: LoadConfig
    ) -> None:
        config = load_config(f"backup:\n  schedule:\n    last_run: {written}\n")

        assert config.get("backup.schedule.last_run") is not None
        assert config.get("backup.schedule.max_backups") == 5


class TestEmptySections:
    @pytest.mark.parametrize("section", SECTION_KEYS)
    def test_section_with_nothing_under_it_takes_its_defaults(
        self, section: str, load_config: LoadConfig
    ) -> None:
        config = load_config(_empty_section(section))

        for key, expected in DEFAULTS:
            assert _is(config.get(key), expected), key

    def test_every_section_empty_at_once_takes_every_default(self, load_config: LoadConfig) -> None:
        config = load_config(
            "secret_masking:\n"
            "network:\n"
            "  ssh_hosts:\n"
            "  certificates:\n"
            "  proxy:\n"
            "mcp:\n"
            "backup:\n"
            "  schedule:\n"
        )

        for key, expected in DEFAULTS:
            assert _is(config.get(key), expected), key

    def test_section_with_only_comments_under_it_takes_its_defaults(
        self, load_config: LoadConfig
    ) -> None:
        config = load_config(
            "mcp:\n" "  # port: 9000\n" "backup:\n" "  schedule:\n" "    # cron: 0 2 * * *\n"
        )

        for key, expected in DEFAULTS:
            assert _is(config.get(key), expected), key

    def test_empty_section_beside_a_filled_one_keeps_the_filled_values(
        self, load_config: LoadConfig
    ) -> None:
        config = load_config(
            "network:\n" "  ssh_hosts:\n" "  certificates:\n" "    public_source: host\n"
        )

        assert config.get("network.ssh_hosts.lock_trusted_hosts") is False
        assert config.get("network.ssh_hosts.default_block_action") == "disabled"
        assert config.get("network.certificates.public_source") == "host"


class TestKnownSections:
    @pytest.mark.parametrize("name", KNOWN_SECTIONS)
    @pytest.mark.parametrize("value", [5, "text", ["item"]], ids=["number", "text", "list"])
    def test_section_holding_a_value_is_refused(
        self, name: str, value: Any, config_file: Path, load_config: LoadConfig
    ) -> None:
        with pytest.raises(ConfigValidationError, match=_refusal(config_file, name, SECTION_RULE)):
            load_config({name: value})

    @pytest.mark.parametrize("name", KNOWN_SECTIONS)
    def test_section_with_nothing_under_it_is_not_refused(
        self, name: str, load_config: LoadConfig
    ) -> None:
        config = load_config(f"{name}:\n")

        assert config.server.port == 8000
        assert config.logging.level == "INFO"
        assert config.security.cors_origins == []


class TestRefusedValues:
    @pytest.mark.parametrize(("key", "value", "rule"), REFUSED, ids=_case_ids(REFUSED))
    def test_invalid_value_refuses_the_load(
        self, key: str, value: Any, rule: str, config_file: Path, load_config: LoadConfig
    ) -> None:
        with pytest.raises(ConfigValidationError, match=_refusal(config_file, key, rule)):
            load_config(_file(key, value))

    @pytest.mark.parametrize("key", BOOLEAN_KEYS)
    @pytest.mark.parametrize("value", [0, 1])
    def test_integer_is_refused_for_a_boolean(
        self, key: str, value: int, config_file: Path, load_config: LoadConfig
    ) -> None:
        with pytest.raises(ConfigValidationError, match=_refusal(config_file, key, BOOLEAN_RULE)):
            load_config(_file(key, value))

    @pytest.mark.parametrize("key", NOT_NULLABLE_KEYS)
    def test_null_is_refused_where_the_rule_names_no_null(
        self, key: str, config_file: Path, load_config: LoadConfig
    ) -> None:
        with pytest.raises(ConfigValidationError, match=_refusal(config_file, key, KEY_RULES[key])):
            load_config(_file(key, None))

    @pytest.mark.parametrize("key", WHOLE_NUMBER_KEYS)
    @pytest.mark.parametrize("value", [True, False])
    def test_boolean_is_refused_for_a_whole_number(
        self, key: str, value: bool, config_file: Path, load_config: LoadConfig
    ) -> None:
        with pytest.raises(ConfigValidationError, match=_refusal(config_file, key, KEY_RULES[key])):
            load_config(_file(key, value))

    @pytest.mark.parametrize(("key", "value"), WRONG_CASE, ids=_case_ids(WRONG_CASE))
    def test_listed_text_value_in_another_case_is_refused(
        self, key: str, value: str, config_file: Path, load_config: LoadConfig
    ) -> None:
        with pytest.raises(ConfigValidationError, match=_refusal(config_file, key, KEY_RULES[key])):
            load_config(_file(key, value))

    def test_refusal_names_the_file_the_singleton_located(self, config_file: Path) -> None:
        config_file.write_text("mcp:\n  bind: public\n", encoding="utf-8")
        loader._config_instance = None

        with pytest.raises(
            ConfigValidationError, match=_refusal(config_file, "mcp.bind", BIND_RULE)
        ):
            get_config()


class TestLockRule:
    def test_accept_new_while_locked_is_refused(
        self, config_file: Path, load_config: LoadConfig
    ) -> None:
        policy = {"lock_trusted_hosts": True, "default_block_action": "accept-new"}

        with pytest.raises(
            ConfigValidationError,
            match=_refusal(config_file, "network.ssh_hosts.default_block_action", LOCK_RULE),
        ):
            load_config({"network": {"ssh_hosts": policy}})

    def test_accept_new_while_unlocked_is_loaded(self, load_config: LoadConfig) -> None:
        policy = {"lock_trusted_hosts": False, "default_block_action": "accept-new"}

        config = load_config({"network": {"ssh_hosts": policy}})

        assert config.get("network.ssh_hosts.default_block_action") == "accept-new"

    @pytest.mark.parametrize("action", ["strict", "disabled"])
    def test_other_actions_while_locked_are_loaded(
        self, action: str, load_config: LoadConfig
    ) -> None:
        policy = {"lock_trusted_hosts": True, "default_block_action": action}

        config = load_config({"network": {"ssh_hosts": policy}})

        assert config.get("network.ssh_hosts.lock_trusted_hosts") is True
        assert config.get("network.ssh_hosts.default_block_action") == action

    def test_lock_alone_keeps_the_default_action(self, load_config: LoadConfig) -> None:
        config = load_config({"network": {"ssh_hosts": {"lock_trusted_hosts": True}}})

        assert config.get("network.ssh_hosts.default_block_action") == "disabled"


class TestProxyPassword:
    def test_plain_password_is_refused(self, config_file: Path, load_config: LoadConfig) -> None:
        proxy = {"enabled": True, "source": "custom", "username": "ops", "password": "plain"}

        with pytest.raises(
            ConfigValidationError,
            match=_refusal(config_file, "network.proxy.password", PROXY_PASSWORD_RULE),
        ):
            load_config({"network": {"proxy": proxy}})

    def test_empty_password_is_refused(self, config_file: Path, load_config: LoadConfig) -> None:
        with pytest.raises(
            ConfigValidationError,
            match=_refusal(config_file, "network.proxy.password", PROXY_PASSWORD_RULE),
        ):
            load_config({"network": {"proxy": {"password": ""}}})

    def test_sealed_envelope_is_loaded(self, load_config: LoadConfig) -> None:
        envelope = get_cipher().seal("s3cret-value")

        config = load_config({"network": {"proxy": {"username": "ops", "password": envelope}}})

        assert config.get("network.proxy.password") == envelope
        assert config.get("network.proxy.username") == "ops"
        assert config.get("network.proxy.enabled") is False

    def test_null_password_is_loaded(self, load_config: LoadConfig) -> None:
        config = load_config("network:\n  proxy:\n    username: ops\n    password: null\n")

        assert config.get("network.proxy.password") is None
        assert config.get("network.proxy.username") == "ops"
        assert config.get("network.proxy.enabled") is False


class TestProxyShapeOnly:
    """Startup checks the shape of the proxy keys, not the rules a Save applies."""

    @pytest.mark.parametrize(
        "stored",
        [
            {},
            {"port": 3128},
            {"host": "proxy.corp.example"},
            {"host": "", "port": None},
        ],
        ids=["neither", "no-address", "no-port", "both-empty"],
    )
    def test_custom_proxy_without_an_address_or_a_port_is_loaded(
        self, stored: dict[str, Any], load_config: LoadConfig
    ) -> None:
        proxy = {"enabled": True, "source": "custom", **stored}

        config = load_config({"network": {"proxy": proxy}})

        assert config.get("network.proxy.enabled") is True
        assert config.get("network.proxy.source") == "custom"
        assert config.get("network.proxy.host") == stored.get("host", "")
        assert _is(config.get("network.proxy.port"), stored.get("port"))
        assert config.get("network.proxy.list_mode") == "except"

    @pytest.mark.parametrize(
        "entry",
        [
            {"kind": "exact", "address": ""},
            {"kind": "regex", "address": ""},
            {"kind": "exact", "address": "a.example"},
            {"kind": "exact", "address": "ftp://a.example"},
            {"kind": "exact", "address": "https://a.example/path"},
            {"kind": "exact", "address": f"https://{'a' * 260}.example"},
            {"kind": "regex", "address": "("},
        ],
        ids=[
            "empty-exact-address",
            "empty-regex-address",
            "no-protocol",
            "other-protocol",
            "path",
            "too-long",
            "regex-that-does-not-compile",
        ],
    )
    def test_entry_a_save_would_refuse_is_loaded(
        self, entry: dict[str, str], load_config: LoadConfig
    ) -> None:
        proxy = {"enabled": True, "source": "custom", "entries": [entry]}

        config = load_config({"network": {"proxy": proxy}})

        assert config.get("network.proxy.entries") == [entry]
        assert config.get("network.proxy.list_mode") == "except"

    def test_repeated_entry_is_loaded(self, load_config: LoadConfig) -> None:
        entries = [dict(EXACT_ENTRY), dict(EXACT_ENTRY)]

        config = load_config({"network": {"proxy": {"entries": entries}}})

        assert config.get("network.proxy.entries") == entries
        assert config.get("network.proxy.list_mode") == "except"

    def test_more_than_100_entries_are_loaded(self, load_config: LoadConfig) -> None:
        entries = [
            {"kind": "exact", "address": f"https://host{number}.example"} for number in range(101)
        ]
        proxy = {"enabled": True, "source": "custom", "entries": entries}

        config = load_config({"network": {"proxy": proxy}})

        assert config.get("network.proxy.entries") == entries
        assert config.get("network.proxy.list_mode") == "except"


class TestMcpPassword:
    def test_plain_password_is_refused(self, config_file: Path, load_config: LoadConfig) -> None:
        mcp = {"auth_enabled": True, "auth_username": "ops", "auth_password": "plain"}

        with pytest.raises(
            ConfigValidationError,
            match=_refusal(config_file, "mcp.auth_password", PASSWORD_RULE),
        ):
            load_config({"mcp": mcp})

    def test_empty_password_is_refused(self, config_file: Path, load_config: LoadConfig) -> None:
        with pytest.raises(
            ConfigValidationError,
            match=_refusal(config_file, "mcp.auth_password", PASSWORD_RULE),
        ):
            load_config({"mcp": {"auth_password": ""}})

    def test_sealed_envelope_is_loaded(self, load_config: LoadConfig) -> None:
        envelope = get_cipher().seal("s3cret-value")

        config = load_config({"mcp": {"auth_password": envelope}})

        assert config.get("mcp.auth_password") == envelope


class TestMcpAuthentication:
    def test_absent_username_is_refused_while_authentication_is_on(
        self, config_file: Path, load_config: LoadConfig
    ) -> None:
        with pytest.raises(ConfigValidationError, match=_refusal(config_file, *USERNAME_REQUIRED)):
            load_config({"mcp": {"auth_enabled": True}})

    def test_empty_username_is_refused_while_authentication_is_on(
        self, config_file: Path, load_config: LoadConfig
    ) -> None:
        mcp = {
            "auth_enabled": True,
            "auth_username": "",
            "auth_password": get_cipher().seal("s3cret-value"),
        }

        with pytest.raises(ConfigValidationError, match=_refusal(config_file, *USERNAME_REQUIRED)):
            load_config({"mcp": mcp})

    @pytest.mark.parametrize(
        "mcp",
        [
            {"auth_enabled": True, "auth_username": "ops"},
            {"auth_enabled": True, "auth_username": "ops", "auth_password": None},
        ],
        ids=["absent", "null"],
    )
    def test_null_password_is_refused_while_authentication_is_on(
        self, mcp: dict[str, Any], config_file: Path, load_config: LoadConfig
    ) -> None:
        with pytest.raises(ConfigValidationError, match=_refusal(config_file, *PASSWORD_REQUIRED)):
            load_config({"mcp": mcp})

    def test_username_and_sealed_password_load_with_authentication_on(
        self, load_config: LoadConfig
    ) -> None:
        envelope = get_cipher().seal("s3cret-value")
        mcp = {"auth_enabled": True, "auth_username": "ops", "auth_password": envelope}

        config = load_config({"mcp": mcp})

        assert config.get("mcp.auth_enabled") is True
        assert config.get("mcp.auth_username") == "ops"
        assert config.get("mcp.auth_password") == envelope

    @pytest.mark.parametrize(
        "mcp",
        [
            {},
            {"auth_enabled": False},
            {"auth_enabled": False, "auth_username": "", "auth_password": None},
            {"auth_enabled": False, "auth_username": "ops"},
            {"auth_username": "", "auth_password": None},
        ],
        ids=["defaults", "off", "off-empty-both", "off-username-only", "absent-switch"],
    )
    def test_neither_rule_fires_while_authentication_is_off(
        self, mcp: dict[str, Any], load_config: LoadConfig
    ) -> None:
        config = load_config({"mcp": mcp})

        assert config.get("mcp.auth_enabled") is False
        assert config.get("mcp.auth_password") is None

    def test_username_type_rule_comes_before_the_required_rule(
        self, config_file: Path, load_config: LoadConfig
    ) -> None:
        with pytest.raises(
            ConfigValidationError, match=_refusal(config_file, "mcp.auth_username", TEXT_RULE)
        ):
            load_config({"mcp": {"auth_enabled": True, "auth_username": 5}})

    @pytest.mark.parametrize("password", ["plain", ""], ids=["plain", "empty"])
    def test_password_type_rule_comes_before_the_required_rule(
        self, password: str, config_file: Path, load_config: LoadConfig
    ) -> None:
        mcp = {"auth_enabled": True, "auth_username": "ops", "auth_password": password}

        with pytest.raises(
            ConfigValidationError, match=_refusal(config_file, "mcp.auth_password", PASSWORD_RULE)
        ):
            load_config({"mcp": mcp})

    @pytest.mark.parametrize(
        ("key", "value"),
        [("mcp.auth_password", "plain"), ("backup.schedule.max_backups", 0)],
        ids=["next-key", "later-section"],
    )
    def test_username_rule_is_reported_before_a_later_problem(
        self, key: str, value: Any, config_file: Path, load_config: LoadConfig
    ) -> None:
        content = _content(("mcp.auth_enabled", True), ("mcp.auth_username", ""), (key, value))

        with pytest.raises(ConfigValidationError, match=_refusal(config_file, *USERNAME_REQUIRED)):
            load_config(content)

    @pytest.mark.parametrize(
        ("key", "value"),
        [("mcp.bind", "public"), ("logging.level", "TRACE")],
        ids=["previous-key", "earlier-section"],
    )
    def test_earlier_problem_is_reported_before_the_username_rule(
        self, key: str, value: Any, config_file: Path, load_config: LoadConfig
    ) -> None:
        content = _content(("mcp.auth_enabled", True), ("mcp.auth_username", ""), (key, value))

        with pytest.raises(ConfigValidationError, match=_refusal(config_file, key, KEY_RULES[key])):
            load_config(content)

    @pytest.mark.parametrize(
        ("key", "value"),
        [("backup.schedule.enabled", "yes"), ("backup.schedule.last_run_status", "ok")],
        ids=["next-key", "last-key"],
    )
    def test_password_rule_is_reported_before_a_later_problem(
        self, key: str, value: Any, config_file: Path, load_config: LoadConfig
    ) -> None:
        content = _content(("mcp.auth_enabled", True), ("mcp.auth_username", "ops"), (key, value))

        with pytest.raises(ConfigValidationError, match=_refusal(config_file, *PASSWORD_REQUIRED)):
            load_config(content)

    @pytest.mark.parametrize(
        ("key", "value"),
        [("mcp.port", 80), ("secret_masking.run_output", "yes")],
        ids=["same-section", "earlier-section"],
    )
    def test_earlier_problem_is_reported_before_the_password_rule(
        self, key: str, value: Any, config_file: Path, load_config: LoadConfig
    ) -> None:
        content = _content(("mcp.auth_enabled", True), ("mcp.auth_username", "ops"), (key, value))

        with pytest.raises(ConfigValidationError, match=_refusal(config_file, key, KEY_RULES[key])):
            load_config(content)

    def test_username_rule_is_reported_before_the_password_rule(
        self, config_file: Path, load_config: LoadConfig
    ) -> None:
        mcp = {"auth_enabled": True, "auth_username": "", "auth_password": None}

        with pytest.raises(ConfigValidationError, match=_refusal(config_file, *USERNAME_REQUIRED)):
            load_config({"mcp": mcp})

    def test_invalid_switch_is_reported_before_both_rules(
        self, config_file: Path, load_config: LoadConfig
    ) -> None:
        with pytest.raises(
            ConfigValidationError, match=_refusal(config_file, "mcp.auth_enabled", BOOLEAN_RULE)
        ):
            load_config({"mcp": {"auth_enabled": "yes", "auth_username": ""}})


class TestCheckOrder:
    def test_every_settings_key_has_a_position(self) -> None:
        assert [key for key, _, _ in ORDERED_PROBLEMS] == DEFAULT_KEYS

    @pytest.mark.parametrize("position", range(len(ORDERED_PROBLEMS)), ids=DEFAULT_KEYS)
    def test_first_problem_in_table_order_is_reported(
        self, position: int, config_file: Path, load_config: LoadConfig
    ) -> None:
        content: dict[str, Any] = {}
        for key, value, _ in ORDERED_PROBLEMS[position:]:
            _put(content, key, value)
        key, _, rule = ORDERED_PROBLEMS[position]

        with pytest.raises(ConfigValidationError, match=_refusal(config_file, key, rule)):
            load_config(content)

    def test_server_checks_come_before_the_instance_settings(
        self, config_file: Path, load_config: LoadConfig
    ) -> None:
        with pytest.raises(
            ConfigValidationError,
            match=_refusal(config_file, "server.port", "must be a whole number from 1 to 65535"),
        ):
            load_config({"server": {"port": 99999}, "logging": {"level": "TRACE"}})


class TestUnknownKeys:
    def test_unknown_keys_are_ignored_and_stay_in_the_file(
        self, config_file: Path, load_config: LoadConfig
    ) -> None:
        text = (
            "secret_masking:\n"
            "  run_output: true\n"
            "  future_flag: maybe\n"
            "network:\n"
            "  future_section:\n"
            "    enabled: true\n"
            "  ssh_hosts:\n"
            "    lock_trusted_hosts: true\n"
            "    future_rule: 5\n"
            "mcp:\n"
            "  transport: sse\n"
            "backup:\n"
            "  retention: weekly\n"
            "  schedule:\n"
            "    jitter: 30\n"
        )

        config = load_config(text)

        assert config_file.read_text(encoding="utf-8") == text
        assert config.get("secret_masking.run_output") is True
        assert config.get("secret_masking.test_variables") is False
        assert config.get("network.ssh_hosts.lock_trusted_hosts") is True
        assert config.get("network.ssh_hosts.default_block_action") == "disabled"
        assert config.get("mcp.port") == 8765
        assert config.get("backup.schedule.max_backups") == 5


class TestCanonicalLogLevel:
    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            ("warn", "WARN"),
            ("WARNING", "WARN"),
            ("warning", "WARN"),
            ("CRITICAL", "FATAL"),
            ("critical", "FATAL"),
            ("debug", "DEBUG"),
            ("Info", "INFO"),
            ("ERROR", "ERROR"),
            ("fatal", "FATAL"),
        ],
    )
    def test_name_or_alias_gives_the_canonical_level(self, value: str, expected: str) -> None:
        assert _settings().canonical_log_level(value) == expected

    @pytest.mark.parametrize("value", ["trace", "verbose", "", 5, None, True, ["INFO"]])
    def test_anything_else_gives_none(self, value: object) -> None:
        assert _settings().canonical_log_level(value) is None


class TestSharedValueLists:
    def test_log_levels_equal_the_formatter_levels(self) -> None:
        levels = _settings().LOG_LEVELS

        assert isinstance(levels, tuple)
        assert len(levels) == len(set(levels))
        assert set(levels) == formatter.VALID_LEVELS

    def test_log_level_aliases(self) -> None:
        assert _settings().LOG_LEVEL_ALIASES == {"WARNING": "WARN", "CRITICAL": "FATAL"}

    def test_every_alias_maps_to_what_the_formatter_returns(self) -> None:
        aliases = _settings().LOG_LEVEL_ALIASES

        assert aliases
        for alias, target in aliases.items():
            assert formatter.canonical_level(alias) == target

    def test_every_level_is_canonical_for_the_formatter(self) -> None:
        levels = _settings().LOG_LEVELS

        assert levels
        for level in levels:
            assert formatter.canonical_level(level) == level

    @pytest.mark.parametrize(
        "name", ["debug", "INFO", "Warn", "warning", "ERROR", "fatal", "CRITICAL"]
    )
    def test_canonical_log_level_agrees_with_the_formatter(self, name: str) -> None:
        assert _settings().canonical_log_level(name) == formatter.canonical_level(name)

    def test_host_key_actions(self) -> None:
        assert _settings().HOST_KEY_ACTIONS == ("strict", "accept-new", "disabled")

    @pytest.mark.parametrize(
        ("name", "expected"),
        [
            (
                "MASKING_FLAGS",
                {"run_output", "test_variables", "shared_variables", "credential_inputs"},
            ),
            ("PUBLIC_SOURCES", {"builtin", "host"}),
            ("MCP_BINDS", {"local", "network"}),
        ],
    )
    def test_value_list(self, name: str, expected: set[str]) -> None:
        values = getattr(_settings(), name)

        assert isinstance(values, tuple)
        assert len(values) == len(expected)
        assert set(values) == expected

    @pytest.mark.parametrize(
        ("name", "expected"),
        [
            ("PROXY_SOURCES", ("host", "custom")),
            ("PROXY_LIST_MODES", ("except", "only")),
            ("PROXY_ENTRY_KINDS", ("exact", "regex")),
        ],
    )
    def test_proxy_value_list(self, name: str, expected: tuple[str, ...]) -> None:
        assert getattr(_settings(), name) == expected

    def test_public_sources_are_the_trust_store_sources(self) -> None:
        assert set(_settings().PUBLIC_SOURCES) == {trust_store.BUILTIN, trust_store.HOST}

    def test_masking_flags_are_the_secret_masking_keys(self) -> None:
        assert set(_settings().MASKING_FLAGS) == set(SECTION_DEFAULTS["secret_masking"])

    @pytest.mark.parametrize(
        ("name", "expected"),
        [
            ("MCP_PORT_MIN", 1024),
            ("MCP_PORT_MAX", 65535),
            ("COMPRESSION_LEVEL_MIN", 1),
            ("COMPRESSION_LEVEL_MAX", 9),
            ("MAX_BACKUPS_MIN", 1),
        ],
    )
    def test_numeric_bound(self, name: str, expected: int) -> None:
        assert _is(getattr(_settings(), name), expected)


class TestMergeOverDefaults:
    def test_stored_values_replace_the_defaults(self) -> None:
        result = _settings().merge_over_defaults({"a": 1, "b": 2}, {"b": 3})

        assert result == {"a": 1, "b": 3}

    def test_no_stored_values_gives_the_defaults(self) -> None:
        defaults = {"a": 1, "nested": {"x": 1}}

        assert _settings().merge_over_defaults(defaults, {}) == defaults

    def test_nested_mapping_is_merged_one_level_deeper(self) -> None:
        defaults = {"nested": {"x": 1, "y": 2}, "other": {"z": 3}}

        result = _settings().merge_over_defaults(defaults, {"nested": {"y": 5}})

        assert result == {"nested": {"x": 1, "y": 5}, "other": {"z": 3}}

    def test_stored_scalar_replaces_a_mapping_default(self) -> None:
        result = _settings().merge_over_defaults({"nested": {"x": 1}}, {"nested": 5})

        assert result == {"nested": 5}

    def test_stored_mapping_replaces_a_scalar_default(self) -> None:
        result = _settings().merge_over_defaults({"a": 1}, {"a": {"x": 1}})

        assert result == {"a": {"x": 1}}

    def test_stored_list_replaces_the_default_list(self) -> None:
        result = _settings().merge_over_defaults({"hosts": []}, {"hosts": [{"id": "a"}]})

        assert result == {"hosts": [{"id": "a"}]}

    def test_stored_key_without_a_default_is_kept(self) -> None:
        result = _settings().merge_over_defaults({"a": 1}, {"extra": {"x": 1}})

        assert result == {"a": 1, "extra": {"x": 1}}

    def test_result_is_a_plain_dict(self) -> None:
        assert type(_settings().merge_over_defaults({"a": 1}, {})) is dict

    def test_changing_the_result_never_changes_the_defaults(self) -> None:
        defaults = {"nested": {"x": 1, "items": [1]}, "hosts": [], "port": 8765}
        snapshot = copy.deepcopy(defaults)

        result = _settings().merge_over_defaults(defaults, {"nested": {"y": 2}})
        result["port"] = 1
        result["hosts"].append({"id": "a"})
        result["nested"]["x"] = 9
        result["nested"]["items"].append(2)

        assert defaults == snapshot

    def test_merging_never_changes_the_stored_values(self) -> None:
        stored = {"nested": {"y": 2}}

        _settings().merge_over_defaults({"nested": {"x": 1}}, stored)

        assert stored == {"nested": {"y": 2}}


class TestMerged:
    @pytest.mark.parametrize("name", sorted(SECTION_DEFAULTS))
    @pytest.mark.parametrize("stored", [None, {}], ids=["none", "empty"])
    def test_nothing_stored_gives_the_section_defaults(
        self, name: str, stored: dict[str, Any] | None
    ) -> None:
        assert _settings().merged(name, stored) == SECTION_DEFAULTS[name]

    def test_stored_values_are_merged_over_the_section_defaults(self) -> None:
        result = _settings().merged("network", {"ssh_hosts": {"lock_trusted_hosts": True}})

        assert result == {
            "ssh_hosts": {"lock_trusted_hosts": True, "default_block_action": "disabled"},
            "certificates": {"public_source": "builtin"},
            "proxy": SECTION_DEFAULTS["network"]["proxy"],
        }

    def test_stored_proxy_values_are_merged_over_the_proxy_defaults(self) -> None:
        stored = {"proxy": {"enabled": True, "entries": [dict(EXACT_ENTRY)]}}

        result = _settings().merged("network", stored)

        assert result["proxy"] == {
            **SECTION_DEFAULTS["network"]["proxy"],
            "enabled": True,
            "entries": [EXACT_ENTRY],
        }
        assert result["ssh_hosts"] == SECTION_DEFAULTS["network"]["ssh_hosts"]

    def test_changing_the_result_never_changes_the_section_defaults(self) -> None:
        settings = _settings()

        result = settings.merged("backup", None)
        result["schedule"]["max_backups"] = 99

        assert settings.SECTION_DEFAULTS == SECTION_DEFAULTS

    def test_filling_the_default_address_list_never_changes_the_section_defaults(self) -> None:
        settings = _settings()

        result = settings.merged("network", None)
        result["proxy"]["entries"].append(dict(EXACT_ENTRY))

        assert settings.SECTION_DEFAULTS == SECTION_DEFAULTS


class TestFirstProblem:
    def test_defaults_have_no_problem(self) -> None:
        assert _settings().first_problem(_sections()) is None

    def test_problem_is_the_key_and_its_rule(self) -> None:
        sections = _sections()
        sections["mcp"]["port"] = 80

        assert _settings().first_problem(sections) == f"mcp.port {PORT_RULE}"

    def test_proxy_problem_is_the_key_and_its_rule(self) -> None:
        sections = _sections()
        sections["network"]["proxy"]["port"] = 0

        assert _settings().first_problem(sections) == f"network.proxy.port {PROXY_PORT_RULE}"

    def test_earlier_key_wins(self) -> None:
        sections = _sections()
        sections["backup"]["schedule"]["last_run_status"] = "ok"
        sections["secret_masking"]["credential_inputs"] = 1

        problem = _settings().first_problem(sections)

        assert problem == f"secret_masking.credential_inputs {BOOLEAN_RULE}"


class TestToDict:
    @pytest.mark.parametrize("name", ["secret_masking", "backup"])
    def test_to_dict_includes_the_instance_section(self, name: str) -> None:
        assert get_config().to_dict()[name] == SECTION_DEFAULTS[name]

    def test_to_dict_includes_the_network_section(self) -> None:
        section = copy.deepcopy(get_config().to_dict()["network"])
        section["proxy"].pop("password", None)
        expected = copy.deepcopy(SECTION_DEFAULTS["network"])
        del expected["proxy"]["password"]

        assert section == expected

    def test_to_dict_includes_the_mcp_section(self) -> None:
        section = dict(get_config().to_dict()["mcp"])
        section.pop("auth_password", None)
        expected = {
            key: value for key, value in SECTION_DEFAULTS["mcp"].items() if key != "auth_password"
        }

        assert section == expected

    def test_to_dict_never_shows_the_sealed_mcp_password(self, load_config: LoadConfig) -> None:
        envelope = get_cipher().seal("s3cret-value")
        config = load_config({"mcp": {"auth_password": envelope}})

        result = config.to_dict()

        assert result["mcp"].get("auth_password") != envelope
        assert envelope not in repr(result)

    def test_changing_the_result_never_changes_the_running_config(
        self, load_config: LoadConfig
    ) -> None:
        config = load_config({"network": {"proxy": {"entries": [dict(EXACT_ENTRY)]}}})

        result = config.to_dict(include_secrets=True)
        result["network"]["ssh_hosts"]["lock_trusted_hosts"] = True
        result["network"]["proxy"]["entries"].append(dict(REGEX_ENTRY))
        result["backup"]["schedule"]["max_backups"] = 99

        assert config.get("network.ssh_hosts.lock_trusted_hosts") is False
        assert config.get("network.proxy.entries") == [EXACT_ENTRY]
        assert config.get("backup.schedule.max_backups") == 5


class TestExampleFile:
    def test_example_file_loads_with_no_problem(self, example_config: Path) -> None:
        assert get_config().config_file == example_config

    @pytest.mark.parametrize(("key", "expected"), DEFAULTS, ids=DEFAULT_KEYS)
    def test_example_file_holds_every_instance_setting_at_its_default(
        self,
        key: str,
        expected: Any,
        example_config: Path,
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        *parents, name = key.split(".")
        node = config_on_disk()
        for parent in parents:
            node = node[parent]

        assert name in node
        assert _is(node[name], expected)
        assert _is(get_config().get(key), expected)


class TestDigitCap:
    def test_the_settings_cap_is_the_number_rule_cap(self) -> None:
        from wavecore.api.config import instance_settings
        from wavecore.core import number_rule

        assert instance_settings.MAX_INTEGER_DIGITS == number_rule.MAX_INTEGER_DIGITS

    @pytest.mark.parametrize(
        ("value", "low", "high", "fault"),
        [
            ("12", 1, None, None),
            ("012", 1, 99, None),
            ("x", 1, None, "type"),
            (True, 1, None, "type"),
            (0, 1, None, "range"),
            (100, 1, 99, "range"),
            (10**19, 1, None, "integer-cap"),
            ("12345678901234567890", 1, None, "integer-cap"),
            ("12345678901234567890", 1, 99, "range"),
            (-(10**19), 1, None, "range"),
        ],
    )
    def test_whole_number_fault(self, value: Any, low: int, high: int | None, fault: Any) -> None:
        from wavecore.api.config import instance_settings

        assert instance_settings.whole_number_fault(value, low, high) == fault
