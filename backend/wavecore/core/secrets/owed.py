"""What a person still owes: every secret place that holds nothing (REQ-3.1.3.20, REQ-4.5.19)."""

from collections.abc import Collection, Iterator, Mapping
from dataclasses import dataclass
from typing import Any

from wavecore.core.functions.references import function_holders
from wavecore.core.secrets.masking import is_unfilled_secret
from wavecore.core.secrets.sealing import (
    SETTER_ROW,
    SecretInputNames,
    SecretSetting,
    iter_secret_settings,
)
from wavecore.core.variables.usage import block_writes, function_writes, scope_blocks


@dataclass(frozen=True)
class OwedSecret:
    """One secret place that holds nothing: its name, where it sits, and whether it is a field."""

    name: str
    step: str
    field: bool = False
    environment: str | None = None


def owed_variables(
    variables: Mapping[str, Any] | None, *, written: Collection[str] = (), prefix: str = "variables"
) -> list[OwedSecret]:
    """Declared secrets holding nothing that no block writes."""
    return [
        OwedSecret(name, f"{prefix}.{name}")
        for name, declaration in (variables or {}).items()
        if is_unfilled_secret(declaration) and name not in written
    ]


def owed_fields(
    values: Mapping[str, Any] | None,
    secret_fields: Collection[str],
    *,
    prefix: str,
    environment: str | None = None,
) -> list[OwedSecret]:
    """Profile fields: a typed secret entry holding nothing, or a secret field holding null."""
    return [
        OwedSecret(field, f"{prefix}.{field}", field=True, environment=environment)
        for field, value in (values or {}).items()
        if is_unfilled_secret(value) or (field in secret_fields and value is None)
    ]


def _setting_step(prefix: str, setting: SecretSetting) -> str:
    blocks = ".blocks.".join(setting.blocks)
    if setting.kind == SETTER_ROW:
        return f"{prefix}blocks.{blocks}.variables.{setting.name}"
    return f"{prefix}blocks.{blocks}.{setting.name}"


def _owed_settings(
    workflow: Any, prefix: str, secret_inputs: SecretInputNames | None
) -> list[OwedSecret]:
    """A Setter row or credential field holding null; empty text is deliberate."""
    return [
        OwedSecret(setting.name, _setting_step(prefix, setting), field=setting.kind != SETTER_ROW)
        for setting in iter_secret_settings(workflow, secret_inputs=secret_inputs)
        if setting.value is None
    ]


def _owed_declarations(definition: Mapping[str, Any], prefix: str) -> list[OwedSecret]:
    """A Function's secret locals and outputs holding nothing that its body never writes."""
    written = function_writes(definition)
    outputs = {
        str(entry.get("name")): {"secret": entry.get("secret"), "value": entry.get("default")}
        for entry in definition.get("outputs") or []
        if isinstance(entry, Mapping)
    }
    locals_ = {
        str(entry.get("name")): entry
        for entry in definition.get("variables") or []
        if isinstance(entry, Mapping)
    }
    return [
        *owed_variables(locals_, written=written, prefix=f"{prefix}variables"),
        *owed_variables(outputs, written=written, prefix=f"{prefix}outputs"),
    ]


def _held_definitions(workflow: Any, prefix: str) -> Iterator[tuple[str, Mapping[str, Any]]]:
    """Each Local or edit-mode Function definition at any depth, with its block's step prefix."""
    nodes = workflow.get("nodes") if isinstance(workflow, Mapping) else None
    for node in nodes if isinstance(nodes, list) else []:
        for definition in function_holders({"nodes": [node]}):
            step = f"{prefix}blocks.{node.get('id')}."
            yield step, definition
            yield from _held_definitions(definition.get("workflow"), step)


def owed_in_workflow(
    workflow: Any, *, prefix: str = "", secret_inputs: SecretInputNames | None = None
) -> list[OwedSecret]:
    """Every block setting and every held Function declaration of a workflow that holds nothing."""
    owed = _owed_settings(workflow, prefix, secret_inputs)
    for step, definition in _held_definitions(workflow, prefix):
        owed.extend(_owed_declarations(definition, step))
    return owed


def owed_in_test(
    test_data: Mapping[str, Any], *, secret_inputs: SecretInputNames | None = None
) -> list[OwedSecret]:
    """A Test's owed secrets: its variables no block fills, then every place its blocks hold."""
    workflow = test_data.get("workflow") or {}
    filled = {name for node in scope_blocks(workflow) for name in block_writes(node)}
    return [
        *owed_variables(test_data.get("variables"), written=filled),
        *owed_in_workflow(workflow, secret_inputs=secret_inputs),
    ]


def owed_in_function(
    definition: Mapping[str, Any], *, secret_inputs: SecretInputNames | None = None
) -> list[OwedSecret]:
    """A library Function version's owed secrets: its declarations, then its body's places."""
    return [
        *_owed_declarations(definition, ""),
        *owed_in_workflow(definition.get("workflow") or {}, secret_inputs=secret_inputs),
    ]
