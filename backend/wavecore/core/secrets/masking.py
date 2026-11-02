"""Secret masking primitives (REQ-3.1.3.5, REQ-4.5.3).

Two mechanisms share one canonical placeholder: value-scrub of registered
secret byte-forms in outbound text, and flag-based full-opacity masking of
variable displays (no keys, no shape, no counts).
"""

from collections.abc import Mapping, Sequence
from typing import Any

from wavecore.core.secrets.registry import SecretRegistry

MASK_PLACEHOLDER = "********"

_MAX_DEPTH = 100


def holds_secret_value(value: Any) -> bool:
    """Whether a secret slot holds a value: None and "" hold nothing, whitespace is a value."""
    return value is not None and not (isinstance(value, str) and value == "")


def is_unfilled_secret(declaration: Any) -> bool:
    """A declaration flagged secret whose value holds nothing: a person still owes it."""
    return (
        isinstance(declaration, dict)
        and bool(declaration.get("secret"))
        and not holds_secret_value(declaration.get("value"))
    )


def mask_text(text: str, scan_values: Sequence[str]) -> str:
    """Replace every occurrence of each registered value, longest first."""
    for value in sorted(scan_values, key=len, reverse=True):
        text = text.replace(value, MASK_PLACEHOLDER)
    return text


def mask_values(value: Any, scan_values: Sequence[str]) -> Any:
    """Value counterpart of ``mask_text``: recursively scrub registered secret
    byte-forms from a str / list / dict, with no name-flag masking."""
    return _mask_content(value, tuple(scan_values))


def structural_mask(value: Any) -> Any:
    """The one masking step: a held value, whatever its shape, shows as the bare placeholder."""
    return MASK_PLACEHOLDER if holds_secret_value(value) else value


def masked_declaration(
    declaration: Mapping[str, Any], *, flag_masked: bool = False
) -> dict[str, Any]:
    """A secret declaration as a read shows it: a held value masked, its element types gone."""
    if not holds_secret_value(declaration.get("value")):
        return dict(declaration)
    masked = {key: item for key, item in declaration.items() if key != "elementTypes"}
    masked["value"] = structural_mask(declaration["value"])
    if flag_masked:
        masked["masked"] = True
    return masked


def mask_with_metadata(value: Any) -> dict[str, Any]:
    """Mask a value while exposing structure/length metadata only (never keys)."""
    metadata: dict[str, Any] = {}
    if isinstance(value, str):
        metadata["length"] = len(value)
    elif isinstance(value, list):
        metadata = {"type": "array", "size": len(value)}
    elif isinstance(value, dict):
        metadata = {"type": "map", "size": len(value)}
    return {"value": structural_mask(value), "metadata": metadata}


def mask_structure(obj: Any, registry: SecretRegistry) -> Any:
    """Mask a variables-shaped mapping: flagged names collapse, copies scrub by value."""
    scan = registry.scan_values()
    if not isinstance(obj, dict):
        return _mask_content(obj, scan)
    return {
        name: (
            structural_mask(value) if registry.is_secret_name(name) else _mask_content(value, scan)
        )
        for name, value in obj.items()
    }


def _mask_content(value: Any, scan_values: tuple[str, ...], _depth: int = 0) -> Any:
    if _depth >= _MAX_DEPTH:
        return value
    if isinstance(value, str):
        return mask_text(value, scan_values)
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, dict):
        return {key: _mask_content(item, scan_values, _depth + 1) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [_mask_content(item, scan_values, _depth + 1) for item in value]
    if str(value) in scan_values:
        return MASK_PLACEHOLDER
    return value


def secret_param_names(plugin_metadata: Mapping[str, Any]) -> set[str]:
    """Names of secret-declared input parameters in a plugin's metadata.

    Plugin ``parameters`` are declared as dicts (the parameter model carries no
    secret flag), so only the dict form can mark a param secret."""
    return {
        param["name"]
        for param in plugin_metadata.get("parameters") or []
        if isinstance(param, dict) and param.get("secret")
    }


def mask_io_payload(
    payload: dict[str, Any], secret_keys: set[str], sub_key_catalog: set[str]
) -> dict[str, Any]:
    """Declaration-driven mask of an engine harness I/O map.

    A key in ``secret_keys`` collapses its whole value to the placeholder;
    inside a dict value, entries whose lowercased key is in ``sub_key_catalog``
    collapse individually while siblings pass through. Returns a display copy;
    the input is never mutated.
    """
    result: dict[str, Any] = {}
    for key, value in payload.items():
        if key in secret_keys:
            result[key] = structural_mask(value)
        elif isinstance(value, dict) and sub_key_catalog:
            result[key] = {
                sub_key: (
                    structural_mask(sub_value) if sub_key.lower() in sub_key_catalog else sub_value
                )
                for sub_key, sub_value in value.items()
            }
        else:
            result[key] = value
    return result
