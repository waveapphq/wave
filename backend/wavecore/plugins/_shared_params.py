"""Parameter, output and message builders shared by every fail-or-record block (REQ-3.4.2.2)."""

from typing import Any

from wavecore.core.number_rule import is_integer_value
from wavecore.plugins._executor_base import validate_enum_param

# A block's selects: each wire name mapped to its values in order, then its default.
Choices = dict[str, tuple[list[str], str]]

RECORD_GATE: dict[str, Any] = {"field": "on_error", "values": ["record"]}
_ERROR_DESCRIPTION = (
    "The error message when the operation failed under Record and continue; empty otherwise"
)


def on_error_parameter(description: str) -> dict[str, Any]:
    """The failure-handling enum: fail the block or record the error and continue."""
    return {
        "name": "on_error",
        "type": "string",
        "required": False,
        "default": "fail",
        "enum_values": ["fail", "record"],
        "description": description,
    }


def timeout_parameter(default: int, description: str) -> dict[str, Any]:
    """The timeout integer, with a floor of 1 on every Block that declares it."""
    return {
        "name": "timeout",
        "type": "integer",
        "required": False,
        "default": default,
        "minimum": 1,
        "description": description,
    }


def toggle_parameter(name: str, description: str) -> dict[str, Any]:
    """An optional on/off row that starts off."""
    return {
        "name": name,
        "type": "boolean",
        "required": False,
        "default": False,
        "description": description,
    }


def stream_output_parameter(description: str) -> dict[str, Any]:
    """The Log Output switch, in no group; each caller places the row itself."""
    return toggle_parameter("stream_output", description)


def output_core(
    *, gated: bool, success_description: str, reason_description: str
) -> list[dict[str, Any]]:
    """The success/error/reason outputs; gated hides the two error rows outside Record."""
    error: dict[str, Any] = {"name": "error", "type": "string", "description": _ERROR_DESCRIPTION}
    reason: dict[str, Any] = {"name": "reason", "type": "string", "description": reason_description}
    if gated:
        error["show_when"] = dict(RECORD_GATE)
        reason["show_when"] = dict(RECORD_GATE)
    return [
        {"name": "success", "type": "boolean", "description": success_description},
        error,
        reason,
    ]


def limit_parameters(
    *,
    max_size_mib: int,
    max_files: int,
    show_when: dict[str, Any],
    size_description: str,
    files_description: str,
) -> list[dict[str, Any]]:
    """The Max size (MiB) and Max files rows of a bounded transfer."""
    return [
        {
            "name": "max_size_mib",
            "type": "integer",
            "required": False,
            "default": max_size_mib,
            "minimum": 0,
            "show_when": dict(show_when),
            "description": size_description,
        },
        {
            "name": "max_files",
            "type": "integer",
            "required": False,
            "default": max_files,
            "minimum": 0,
            "show_when": dict(show_when),
            "description": files_description,
        },
    ]


def select_parameter(choices: Choices, name: str, description: str, **extra: Any) -> dict[str, Any]:
    """An enum row taken from the block's choice table, with its values in order."""
    values, default = choices[name]
    return {
        "name": name,
        "type": "string",
        "default": default,
        "enum_values": list(values),
        "description": description,
        **extra,
    }


def setting(params: dict[str, Any], name: str, default: Any) -> Any:
    """A setting as given, or its default when nothing was given (absent or a literal None)."""
    value = params.get(name)
    return default if value is None else value


def number_setting(params: dict[str, Any], name: str, default: int) -> int:
    """A number row as given, or its default when nothing was given (absent, None or empty)."""
    value: Any = params.get(name)
    return default if blank_number(value) else int(value)


def chosen(choices: Choices, params: dict[str, Any], name: str) -> Any:
    """A select's value, its default when nothing was given; a value outside its choices fails."""
    values, default = choices[name]
    value = params.get(name)
    if value is None:
        return default
    validate_enum_param(name, value, values)
    return value


def require_positive(params: dict[str, Any], name: str) -> None:
    """Reject a set integer param that is zero or negative."""
    value = params.get(name)
    if value is not None and value <= 0:
        raise ValueError(f"Parameter '{name}' must be positive")


def blank(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def blank_number(value: Any) -> bool:
    return value is None or value == ""


def check_integer(params: dict[str, Any], name: str) -> None:
    value = params.get(name)
    if not blank_number(value) and not is_integer_value(value):
        raise ValueError(f"Parameter '{name}' must be an integer")


def check_boolean(params: dict[str, Any], name: str) -> None:
    value = params.get(name)
    if value is not None and not isinstance(value, bool):
        raise ValueError(f"Parameter '{name}' must be a boolean")


def check_at_least(params: dict[str, Any], name: str, floor: int, message: str) -> None:
    value: Any = params.get(name)
    if is_integer_value(value) and value < floor:
        raise ValueError(message)


def gate(field: str, *values: str) -> dict[str, Any]:
    """A show_when gate: the controlling row and the values that show the gated row."""
    return {"field": field, "values": list(values)}


def check_limits(params: dict[str, Any]) -> None:
    check_integer(params, "max_size_mib")
    check_integer(params, "max_files")
    check_at_least(params, "max_size_mib", 0, "Max size (MiB) must be 0 or more")
    check_at_least(params, "max_files", 0, "Max files must be 0 or more")
