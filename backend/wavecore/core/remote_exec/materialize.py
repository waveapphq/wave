"""Materialize a remote verb's JSON-safe envelope into runtime outputs (REQ-3.4.1.3).

A verb answers with a result envelope whose secrets register with the run
before any output is handed back (REQ-3.1.3.5); a table envelope becomes a
Table and a yaml envelope becomes YAML text. Anything without the type tag
passes through untouched, so the HTTP response dict is the same object out.
"""

from typing import Any

import yaml

from wavecore.core.table import Table

_TYPE_KEY = "__wave_type"


def _render_yaml(value: Any) -> str:
    """The exact text the local read path renders for the yaml output format."""
    if not value:
        return ""
    return yaml.safe_dump(value, sort_keys=True)


def _convert(value: Any) -> Any:
    """One output value: a table or yaml envelope converts, everything else is identity."""
    if not isinstance(value, dict):
        return value
    kind = value.get(_TYPE_KEY)
    if kind == "table":
        return Table.from_dict({key: item for key, item in value.items() if key != _TYPE_KEY})
    if kind == "yaml":
        return _render_yaml(value.get("value"))
    return value


def materialize(value: Any, register_secret: Any = None) -> Any:
    """Register a result envelope's secrets, then return its converted outputs."""
    if not isinstance(value, dict) or value.get(_TYPE_KEY) != "result":
        return _convert(value)
    secrets = value.get("secrets")
    if callable(register_secret) and isinstance(secrets, list):
        for secret in secrets:
            register_secret(secret)
    outputs = value.get("outputs")
    if not isinstance(outputs, dict):
        # Binding nothing would paint the block passed over its previous values.
        raise ValueError("Remote result envelope carries no outputs")
    return {name: _convert(item) for name, item in outputs.items()}
