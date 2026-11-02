"""Instance settings in the config file: keys, defaults, value lists and checks (REQ-4.7.17)."""

import copy
from collections.abc import Callable, Iterable, Mapping, MutableMapping
from datetime import date, datetime
from typing import Any, Final, Literal

from wavecore.connectivity.trust_store import BUILTIN, HOST

# The logging formatter owns these names; the config package cannot import it.
LOG_LEVELS: Final[tuple[str, ...]] = ("DEBUG", "INFO", "WARN", "ERROR", "FATAL")
LOG_LEVEL_ALIASES: Final[dict[str, str]] = {"WARNING": "WARN", "CRITICAL": "FATAL"}

MASKING_FLAGS: Final[tuple[str, ...]] = (
    "run_output",
    "test_variables",
    "shared_variables",
    "credential_inputs",
)
HOST_KEY_ACTIONS: Final[tuple[str, ...]] = ("strict", "accept-new", "disabled")
PUBLIC_SOURCES: Final[tuple[str, ...]] = (BUILTIN, HOST)
PROXY_SOURCES: Final[tuple[str, ...]] = ("host", "custom")
PROXY_LIST_MODES: Final[tuple[str, ...]] = ("except", "only")
PROXY_ENTRY_KINDS: Final[tuple[str, ...]] = ("exact", "regex")
MCP_BINDS: Final[tuple[str, ...]] = ("local", "network")

PROXY_PORT_MIN: Final[int] = 1
PROXY_PORT_MAX: Final[int] = 65535
MCP_PORT_MIN: Final[int] = 1024
MCP_PORT_MAX: Final[int] = 65535
COMPRESSION_LEVEL_MIN: Final[int] = 1
COMPRESSION_LEVEL_MAX: Final[int] = 9
MAX_BACKUPS_MIN: Final[int] = 1
_MAX_BACKUPS_KEY: Final[str] = "backup.schedule.max_backups"
# The number rule owns this cap; the config package cannot import it while it loads.
MAX_INTEGER_DIGITS: Final[int] = 19

SECTION_DEFAULTS: Final[dict[str, dict[str, Any]]] = {
    "secret_masking": dict.fromkeys(MASKING_FLAGS, False),
    "network": {
        "ssh_hosts": {"lock_trusted_hosts": False, "default_block_action": "disabled"},
        "certificates": {"public_source": BUILTIN},
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

# The secret cipher owns this prefix; the config package cannot import it.
_SEALED_PREFIX: Final[str] = "wave:enc:v1:"

_BOOLEAN_RULE: Final[str] = "must be true or false"
_TEXT_RULE: Final[str] = "must be text"
_SECTION_RULE: Final[str] = "must be a section"
_REQUIRED_RULE: Final[str] = "is required while mcp.auth_enabled is true"

# A check gets the value and the section that holds it.
_Check = Callable[[Any, Mapping[str, Any]], bool]

WholeNumberFault = Literal["type", "range", "integer-cap"]


def whole_number_fault(value: Any, low: int, high: int | None = None) -> WholeNumberFault | None:
    """Why a value is not a whole number from ``low`` to ``high``, its digits included."""
    from wavecore.core.number_rule import number_problem

    problem = number_problem(value, "integer")
    if problem == "type":
        return "type"
    if problem is None:
        number = int(value)
        return "range" if number < low or (high is not None and number > high) else None
    # Past the cap the number is beyond every bound a setting has.
    below = value < 0 if isinstance(value, int) else value.startswith("-")
    return "range" if below or high is not None else "integer-cap"


def whole_number(value: Any, low: int, high: int | None = None) -> int | None:
    """The whole number a value stands for when it is one from ``low`` to ``high``, else None."""
    return None if whole_number_fault(value, low, high) else int(value)


def merge_over_defaults(defaults: Mapping[str, Any], stored: Mapping[str, Any]) -> dict[str, Any]:
    """Stored keys over a copy of ``defaults``; a nested mapping default merges one level deeper."""
    result = copy.deepcopy(dict(defaults))
    for key, value in stored.items():
        default = result.get(key)
        if isinstance(default, Mapping) and isinstance(value, Mapping):
            result[key] = {**default, **value}
        else:
            result[key] = value
    return result


def merged(name: str, stored: Mapping[str, Any] | None) -> dict[str, Any]:
    """One section's stored values over its defaults; an empty nested section is its defaults."""
    defaults = SECTION_DEFAULTS[name]
    filled = {
        key: value
        for key, value in (stored or {}).items()
        if value is not None or not isinstance(defaults.get(key), Mapping)
    }
    return merge_over_defaults(defaults, filled)


def canonical_log_level(value: object) -> str | None:
    """The level name for a name or alias in any case, else ``None``."""
    if not isinstance(value, str):
        return None
    name = value.upper()
    name = LOG_LEVEL_ALIASES.get(name, name)
    return name if name in LOG_LEVELS else None


def _spelled(names: tuple[str, ...]) -> str:
    return f"{', '.join(names[:-1])} or {names[-1]}"


def _is_log_level(value: Any, _section: Mapping[str, Any]) -> bool:
    return canonical_log_level(value) is not None


def _is_boolean(value: Any, _section: Mapping[str, Any]) -> bool:
    return isinstance(value, bool)


def _is_text(value: Any, _section: Mapping[str, Any]) -> bool:
    return isinstance(value, str)


def _one_of(allowed: tuple[str | None, ...]) -> _Check:
    def check(value: Any, _section: Mapping[str, Any]) -> bool:
        return value in allowed

    return check


def _whole_number(low: int, high: int | None = None) -> _Check:
    def check(value: Any, _section: Mapping[str, Any]) -> bool:
        return whole_number_fault(value, low, high) in (None, "integer-cap")

    return check


def _within_the_digit_cap(value: Any, _section: Mapping[str, Any]) -> bool:
    return whole_number_fault(value, MAX_BACKUPS_MIN) != "integer-cap"


def _or_null(passes: _Check) -> _Check:
    def check(value: Any, section: Mapping[str, Any]) -> bool:
        return value is None or passes(value, section)

    return check


def _fits_the_lock(value: Any, section: Mapping[str, Any]) -> bool:
    return not (value == "accept-new" and section["lock_trusted_hosts"])


def _is_sealed_or_null(value: Any, _section: Mapping[str, Any]) -> bool:
    return value is None or (isinstance(value, str) and value.startswith(_SEALED_PREFIX))


def _is_proxy_entries(value: Any, _section: Mapping[str, Any]) -> bool:
    return isinstance(value, list) and all(
        isinstance(entry, Mapping)
        and entry.get("kind") in PROXY_ENTRY_KINDS
        and isinstance(entry.get("address"), str)
        for entry in value
    )


def _is_set_while_authenticating(value: Any, section: Mapping[str, Any]) -> bool:
    return bool(value) or not section["auth_enabled"]


def _is_names_or_null(value: Any, _section: Mapping[str, Any]) -> bool:
    if value is None:
        return True
    return isinstance(value, list) and all(isinstance(item, str) for item in value)


def _is_timestamp_or_null(value: Any, _section: Mapping[str, Any]) -> bool:
    if not isinstance(value, str):
        return value is None or isinstance(value, date)
    try:
        datetime.fromisoformat(value)
    except ValueError:
        return False
    return True


# Config file order; a key's own rule comes before a rule that reads another key.
_RULES: Final[tuple[tuple[str, str, _Check], ...]] = (
    ("logging.level", f"must be one of {', '.join(LOG_LEVELS)}", _is_log_level),
    *((f"secret_masking.{flag}", _BOOLEAN_RULE, _is_boolean) for flag in MASKING_FLAGS),
    ("network.ssh_hosts.lock_trusted_hosts", _BOOLEAN_RULE, _is_boolean),
    (
        "network.ssh_hosts.default_block_action",
        f"must be {_spelled(HOST_KEY_ACTIONS)}",
        _one_of(HOST_KEY_ACTIONS),
    ),
    (
        "network.ssh_hosts.default_block_action",
        "cannot be accept-new while network.ssh_hosts.lock_trusted_hosts is true",
        _fits_the_lock,
    ),
    (
        "network.certificates.public_source",
        f"must be {_spelled(PUBLIC_SOURCES)}",
        _one_of(PUBLIC_SOURCES),
    ),
    ("network.proxy.enabled", _BOOLEAN_RULE, _is_boolean),
    ("network.proxy.source", f"must be {_spelled(PROXY_SOURCES)}", _one_of(PROXY_SOURCES)),
    ("network.proxy.host", _TEXT_RULE, _is_text),
    (
        "network.proxy.port",
        f"must be a whole number from {PROXY_PORT_MIN} to {PROXY_PORT_MAX} or empty",
        _or_null(_whole_number(PROXY_PORT_MIN, PROXY_PORT_MAX)),
    ),
    ("network.proxy.username", _TEXT_RULE, _is_text),
    (
        "network.proxy.password",
        "must be set from Settings > Network > Proxy, where it is stored sealed",
        _is_sealed_or_null,
    ),
    (
        "network.proxy.list_mode",
        f"must be {_spelled(PROXY_LIST_MODES)}",
        _one_of(PROXY_LIST_MODES),
    ),
    (
        "network.proxy.entries",
        f"must be a list of entries with a kind ({_spelled(PROXY_ENTRY_KINDS)}) and an address",
        _is_proxy_entries,
    ),
    ("network.proxy.proxy_local_addresses", _BOOLEAN_RULE, _is_boolean),
    ("mcp.enabled", _BOOLEAN_RULE, _is_boolean),
    (
        "mcp.port",
        f"must be a whole number from {MCP_PORT_MIN} to {MCP_PORT_MAX}",
        _whole_number(MCP_PORT_MIN, MCP_PORT_MAX),
    ),
    ("mcp.bind", f"must be {_spelled(MCP_BINDS)}", _one_of(MCP_BINDS)),
    ("mcp.auth_enabled", _BOOLEAN_RULE, _is_boolean),
    ("mcp.auth_username", _TEXT_RULE, _is_text),
    ("mcp.auth_username", _REQUIRED_RULE, _is_set_while_authenticating),
    (
        "mcp.auth_password",
        "must be set from Settings > MCP Server, where it is stored sealed",
        _is_sealed_or_null,
    ),
    ("mcp.auth_password", _REQUIRED_RULE, _is_set_while_authenticating),
    ("backup.schedule.enabled", _BOOLEAN_RULE, _is_boolean),
    ("backup.schedule.cron", _TEXT_RULE, _is_text),
    (
        "backup.schedule.entity_types",
        "must be a list of entity type names or null",
        _is_names_or_null,
    ),
    (
        _MAX_BACKUPS_KEY,
        f"must be a whole number of {MAX_BACKUPS_MIN} or more",
        _whole_number(MAX_BACKUPS_MIN),
    ),
    (
        _MAX_BACKUPS_KEY,
        f"must be a whole number of at most {MAX_INTEGER_DIGITS} digits",
        _within_the_digit_cap,
    ),
    ("backup.schedule.save_directory", _TEXT_RULE, _is_text),
    ("backup.schedule.format", _TEXT_RULE, _is_text),
    ("backup.schedule.compression_method", _TEXT_RULE, _is_text),
    (
        "backup.schedule.compression_level",
        f"must be a whole number from {COMPRESSION_LEVEL_MIN} to {COMPRESSION_LEVEL_MAX}",
        _whole_number(COMPRESSION_LEVEL_MIN, COMPRESSION_LEVEL_MAX),
    ),
    ("backup.schedule.secrets", _TEXT_RULE, _is_text),
    ("backup.schedule.last_run", "must be a timestamp or null", _is_timestamp_or_null),
    (
        "backup.schedule.last_run_status",
        "must be success, failed or null",
        _one_of(("success", "failed", None)),
    ),
)


def section_problem(document: Mapping[str, Any], names: Iterable[str]) -> str | None:
    """``{name} must be a section`` for the first named top-level key that holds a value."""
    for name in names:
        value = document.get(name)
        if value is not None and not isinstance(value, Mapping):
            return f"{name} {_SECTION_RULE}"
    return None


def first_problem(sections: Mapping[str, Mapping[str, Any]]) -> str | None:
    """``{key} {rule}`` for the first invalid setting in config file order, else ``None``."""
    for key, rule, passes in _RULES:
        *parents, name = key.split(".")
        section: Any = sections
        for depth, parent in enumerate(parents, start=1):
            section = section[parent]
            if not isinstance(section, Mapping):
                return f"{'.'.join(parents[:depth])} {_SECTION_RULE}"
        if not passes(section[name], section):
            return f"{key} {rule}"
    return None


# The whole-number settings, each with its bounds.
WHOLE_NUMBER_SETTINGS: Final[dict[str, tuple[int, int | None]]] = {
    "network.proxy.port": (PROXY_PORT_MIN, PROXY_PORT_MAX),
    "mcp.port": (MCP_PORT_MIN, MCP_PORT_MAX),
    _MAX_BACKUPS_KEY: (MAX_BACKUPS_MIN, None),
    "backup.schedule.compression_level": (COMPRESSION_LEVEL_MIN, COMPRESSION_LEVEL_MAX),
}


def _realized(value: Any) -> Any:
    """Digits that are a whole number as that number; anything else as it is."""
    from wavecore.core.number_rule import number_problem

    if isinstance(value, str) and number_problem(value, "integer") is None:
        return int(value)
    return value


def realized_changes(changes: Mapping[str, Any]) -> dict[str, Any]:
    """Dotted changes with each whole-number setting's digits as the number they stand for."""
    return {
        key: _realized(value) if key in WHOLE_NUMBER_SETTINGS else value
        for key, value in changes.items()
    }


def realize_numbers(sections: Mapping[str, Any]) -> None:
    """Turn each whole-number setting written as its digits into the number, in place."""
    for key in WHOLE_NUMBER_SETTINGS:
        *parents, name = key.split(".")
        section: Any = sections
        for parent in parents:
            section = section[parent]
        holder: MutableMapping[str, Any] = section
        holder[name] = _realized(holder[name])
