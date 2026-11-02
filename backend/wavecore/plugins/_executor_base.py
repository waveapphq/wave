"""The shared runtime enum validator used by plugins and controls."""

from typing import Any

_ENUM_VALUE_DISPLAY_LIMIT = 50


def validate_enum_param(param_name: str, value: Any, allowed_values: list[Any]) -> None:
    """Raise ValueError if `value` is not in `allowed_values`.

    The error message format (anchored) is:
        Parameter '{name}' must be one of: {a, b, c}; Actual value was '{value}'.

    A value whose string form exceeds 50 characters is shown only by length
    ("a {N}-character value"), never its content: a truncated prefix cannot be
    matched by the run's value-scrub, so echoing one would leak a secret bound
    to an enum param.
    """
    if value in allowed_values:
        return
    rendered = str(value)
    if len(rendered) > _ENUM_VALUE_DISPLAY_LIMIT:
        shown = f"a {len(rendered)}-character value"
    else:
        shown = f"'{rendered}'"
    allowed_str = ", ".join(str(v) for v in allowed_values)
    raise ValueError(
        f"Parameter '{param_name}' must be one of: {allowed_str}; Actual value was {shown}."
    )


def validate_enum_from_schema(
    param_name: str, value: Any, parameters_schema: list[dict[str, Any]]
) -> None:
    """Convenience wrapper: look up `param_name` in `parameters_schema` and
    apply `validate_enum_param` against its `enum_values` list.

    Avoids each plugin call site duplicating the schema-lookup boilerplate.
    """
    allowed = next(p["enum_values"] for p in parameters_schema if p["name"] == param_name)
    validate_enum_param(param_name, value, allowed)
