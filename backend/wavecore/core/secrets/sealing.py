"""Seal/unseal helpers and secret-surface locators (REQ-4.5.1)."""

import copy
from collections.abc import Callable, Collection, Iterator, Mapping, MutableMapping
from dataclasses import dataclass
from typing import Any

from wavecore.core.functions.references import function_holders, iter_blocks
from wavecore.core.secrets import masking_settings
from wavecore.core.secrets.key_provider import get_cipher
from wavecore.core.secrets.masking import MASK_PLACEHOLDER, holds_secret_value, structural_mask

_SETTER_ELEMENT_TYPE = "variable-setter"

_SETTER = "setter"
_SETTER_TYPES = "setter-types"
_CREDENTIAL = "credential"
_LOCAL = "local"
_OUTPUT = "output"
_DECLARED = frozenset({_LOCAL, _OUTPUT})
_FUNCTION_KINDS = _DECLARED
_REPORTED = frozenset({_SETTER, _CREDENTIAL, _LOCAL, _OUTPUT})
_ALL = _REPORTED | {_SETTER_TYPES}

SecretInputNames = Callable[[Mapping[str, Any]], Collection[str]]
_Transform = Callable[[Any], Any]


def seal_value(value: Any) -> Any:
    """The one sealing step: a held value becomes an envelope, an empty one stays as it is."""
    return get_cipher().seal(value) if holds_secret_value(value) else value


def unseal_all(obj: Any) -> Any:
    """Recursively unseal every envelope in a nested structure; copies, never mutates."""
    cipher = get_cipher()

    def _walk(node: Any) -> Any:
        if isinstance(node, dict):
            return {key: _walk(value) for key, value in node.items()}
        if isinstance(node, list):
            return [_walk(item) for item in node]
        return cipher.unseal(node)

    return _walk(obj)


def seal_variables(variables: dict[str, Any]) -> dict[str, Any]:
    """Copy a name-keyed variables dict, sealing each secret-flagged entry's value."""
    result: dict[str, Any] = {}
    for name, var_info in variables.items():
        if isinstance(var_info, dict) and var_info.get("secret") and "value" in var_info:
            result[name] = {**var_info, "value": seal_value(var_info["value"])}
        else:
            result[name] = var_info
    return result


def unseal_variables(variables: dict[str, Any]) -> dict[str, Any]:
    """Copy a name-keyed variables dict, unsealing each secret-flagged entry's value."""
    result: dict[str, Any] = {}
    for name, var_info in variables.items():
        if isinstance(var_info, dict) and var_info.get("secret") and "value" in var_info:
            result[name] = {**var_info, "value": get_cipher().unseal(var_info["value"])}
        else:
            result[name] = var_info
    return result


def _sealed_field(field: str, value: Any) -> Any:
    """The sealed form of one profile field, or the value unchanged."""
    from wavecore.api.services.profiles._common import (
        SECRET_FIELDS,
        _is_typed_entry,
        _is_typed_secret,
    )

    if _is_typed_secret(value):
        return {**value, "value": seal_value(value["value"])} if "value" in value else value
    if _is_typed_entry(value):
        return value
    if field in SECRET_FIELDS:
        return seal_value(value)
    return value


def seal_profile(config: dict[str, Any], profile_type: str) -> dict[str, Any]:
    """Copy a profile config, sealing the per-type secret credential fields."""
    # Function-level import: profiles/_common imports this module back at load time.
    from wavecore.api.services.profiles._common import TYPE_SCHEMAS, _is_typed_entry

    result = {field: _sealed_field(field, value) for field, value in config.items()}

    properties = TYPE_SCHEMAS.get(profile_type, {}).get("properties", {})
    for field, field_schema in properties.items():
        if field_schema.get("secret") and field in result and not _is_typed_entry(result[field]):
            result[field] = seal_value(result[field])

    return result


# ---------------------------------------------------------------------------
# The one walk over every place a workflow or a Function definition holds a secret
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _Slot:
    """One secret place: its address, its name, the mapping holding it and its owner."""

    place: tuple[str, ...]
    name: str
    holder: MutableMapping[Any, Any]
    key: Any
    kind: str
    owner: MutableMapping[str, Any]

    @property
    def value(self) -> Any:
        return self.holder[self.key]


def _setter_secret_target(node: dict[str, Any]) -> tuple[dict[str, Any], list[Any]] | None:
    """The (variables map, secret-key list) of a Variable Setter node, or None
    when ``node`` is not a setter node carrying a variables map."""
    data = node.get("data")
    if not isinstance(data, dict) or data.get("elementType") != _SETTER_ELEMENT_TYPE:
        return None
    config = data.get("config")
    if not isinstance(config, dict):
        return None
    variables = (config.get("values") or {}).get("variables")
    if not isinstance(variables, dict):
        return None
    return variables, config.get("variableSecretKeys") or []


def _own_definition(data: Mapping[str, Any]) -> Any:
    """The Function definition a Function Block carries itself, the one its run executes."""
    if data.get("functionLifecycle", "local") == "local":
        return data.get("localDefinition")
    return data.get("draft") if data.get("editMode") else None


def _secret_field_names(
    data: Mapping[str, Any], secret_inputs: SecretInputNames | None
) -> set[str]:
    """The secret fields a Block declares: a plugin's credentials, a Function Block's secret
    inputs, read from the Block's schema; ``secret_inputs`` names a pinned version's own."""
    from wavecore.api.services.block_schema import block_schema

    pinned = _own_definition(data) is None and bool(data.get("functionId"))
    if pinned and secret_inputs is not None:
        return {str(name) for name in secret_inputs(data)}
    return {
        str(field["name"])
        for field in block_schema(data).fields
        if isinstance(field, Mapping) and field.get("secret")
    }


def _field_credential_target(
    data: Any, secret_inputs: SecretInputNames | None
) -> tuple[dict[str, Any], set[str]] | None:
    """The (config-values map, secret field names) of a Block declaring secret fields, or
    None (REQ-3.1.3.18, REQ-3.1.2.9)."""
    if not isinstance(data, dict):
        return None
    config = data.get("config")
    values = config.get("values") if isinstance(config, dict) else None
    if not isinstance(values, dict):
        return None
    names = _secret_field_names(data, secret_inputs)
    # Expression / template mode stores the expression text, not a literal secret.
    names -= {str(field) for field in data.get("expressionFields") or []}
    names -= {str(field) for field in data.get("templateFields") or []}
    return (values, names) if names else None


def _setter_slots(node: dict[str, Any], place: tuple[str, ...]) -> Iterator[_Slot]:
    target = _setter_secret_target(node)
    if target is None:
        return
    variables, secret_keys = target
    data = node["data"]
    # A secret row's element types name its keys, so they travel with its value.
    element_types = data.get("variableElementTypes")
    for key in secret_keys:
        if key in variables:
            yield _Slot((*place, _SETTER, str(key)), str(key), variables, key, _SETTER, data)
        if isinstance(element_types, dict) and key in element_types:
            types_place = (*place, _SETTER_TYPES, str(key))
            yield _Slot(types_place, str(key), element_types, key, _SETTER_TYPES, data)


def _credential_slots(
    node: dict[str, Any], place: tuple[str, ...], secret_inputs: SecretInputNames | None
) -> Iterator[_Slot]:
    target = _field_credential_target(node.get("data"), secret_inputs)
    if target is None:
        return
    values, names = target
    for key in sorted(names):
        if key in values:
            yield _Slot((*place, _CREDENTIAL, key), key, values, key, _CREDENTIAL, values)


def _declared_slots(
    entries: Any, place: tuple[str, ...], key: str, kind: str, echoed: bool
) -> Iterator[_Slot]:
    """Secret entries; with ``echoed``, also an entry echoing the mask with its flag dropped."""
    for entry in entries if isinstance(entries, list) else []:
        if not isinstance(entry, dict) or key not in entry:
            continue
        if entry.get("secret") or (echoed and entry[key] == MASK_PLACEHOLDER):
            name = str(entry.get("name", ""))
            yield _Slot((*place, kind, name), name, entry, key, kind, entry)


def _definition_slots(
    definition: Any,
    place: tuple[str, ...],
    secret_inputs: SecretInputNames | None,
    echoed: bool = False,
) -> Iterator[_Slot]:
    if not isinstance(definition, dict):
        return
    yield from _declared_slots(definition.get("variables"), place, "value", _LOCAL, echoed)
    yield from _declared_slots(definition.get("outputs"), place, "default", _OUTPUT, echoed)
    yield from _workflow_slots(definition.get("workflow"), (*place, "nodes"), secret_inputs, echoed)


def _workflow_slots(
    workflow: Any,
    place: tuple[str, ...],
    secret_inputs: SecretInputNames | None,
    echoed: bool = False,
) -> Iterator[_Slot]:
    nodes = workflow.get("nodes") if isinstance(workflow, dict) else None
    for index, node in enumerate(nodes if isinstance(nodes, list) else []):
        if not isinstance(node, dict):
            continue
        node_place = (*place, str(node.get("id") or f"#{index}"))
        yield from _setter_slots(node, node_place)
        yield from _credential_slots(node, node_place, secret_inputs)
        for position, holder in enumerate(function_holders({"nodes": [node]})):
            yield from _definition_slots(
                holder, (*node_place, f"fn{position}"), secret_inputs, echoed
            )


_SlotSource = Callable[[Any], Iterator[_Slot]]


def _workflow_source(
    secret_inputs: SecretInputNames | None = None, *, echoed: bool = False
) -> _SlotSource:
    return lambda workflow: _workflow_slots(workflow, (), secret_inputs, echoed)


def _definition_source(
    secret_inputs: SecretInputNames | None = None, *, echoed: bool = False
) -> _SlotSource:
    return lambda definition: _definition_slots(definition, (), secret_inputs, echoed)


def _credential_value(value: Any, transform: _Transform) -> Any:
    """A map credential carries its secrets in the values; the keys name them and stay
    readable, so the map keeps its shape and its type across a seal and a reveal."""
    if isinstance(value, dict):
        return {key: transform(item) for key, item in value.items()}
    return transform(value)


def _apply(slot: _Slot, transform: _Transform) -> None:
    value = slot.value
    if slot.kind == _CREDENTIAL:
        slot.holder[slot.key] = _credential_value(value, transform)
    else:
        slot.holder[slot.key] = transform(value)


def _transformed[
    Document
](document: Document, source: _SlotSource, transform: _Transform, kinds: Any) -> Document:
    result = copy.deepcopy(document)
    for slot in source(result):
        if slot.kind in kinds:
            _apply(slot, transform)
    return result


def _mask(slot: _Slot) -> None:
    """A masked secret shows the placeholder; nothing beside it names its keys (REQ-3.1.3.5)."""
    if slot.kind == _SETTER_TYPES:
        del slot.holder[slot.key]
        if not slot.holder:
            slot.owner.pop("variableElementTypes", None)
        return
    if slot.kind in _DECLARED and holds_secret_value(slot.value):
        slot.owner.pop("elementTypes", None)
        slot.owner["masked"] = True
    _apply(slot, structural_mask)


def _masked[Document](document: Document, source: _SlotSource, kinds: Any) -> Document:
    result = copy.deepcopy(document)
    for slot in source(result):
        if slot.kind in kinds:
            _mask(slot)
    return result


def _shown[Document](document: Document, source: _SlotSource) -> Document:
    """A read: Function secrets and credentials in the clear only while their reveal is on."""
    reveal_function = masking_settings.is_test_variables_revealed()
    reveal_credentials = masking_settings.is_credential_inputs_revealed()
    unseal = get_cipher().unseal
    result = copy.deepcopy(document)
    for slot in source(result):
        if slot.kind in _FUNCTION_KINDS:
            if reveal_function:
                _apply(slot, unseal)
            else:
                _mask(slot)
        elif slot.kind == _CREDENTIAL and reveal_credentials:
            _apply(slot, unseal)
    return result


def _kept(value: Any, kept: Any) -> Any:
    """The stored value where the placeholder stands; a map credential keeps each item."""
    if isinstance(value, dict) and isinstance(kept, dict):
        return {key: _kept(item, kept.get(key)) for key, item in value.items()}
    return kept if value == MASK_PLACEHOLDER and holds_secret_value(kept) else value


def _restore_companions(slot: _Slot, stored: _Slot, kept: Mapping[tuple[str, ...], _Slot]) -> None:
    """Restore what travels with a restored value: its element types while the type holds."""
    if slot.kind in _DECLARED:
        slot.owner.pop("elementTypes", None)
        if "elementTypes" in stored.owner and slot.owner.get("type") == stored.owner.get("type"):
            slot.owner["elementTypes"] = copy.deepcopy(stored.owner["elementTypes"])
        return
    if slot.kind != _SETTER:
        return
    stored_types = kept.get((*slot.place[:-2], _SETTER_TYPES, slot.place[-1]))
    if stored_types is not None:
        element_types = slot.owner.setdefault("variableElementTypes", {})
        if isinstance(element_types, dict):
            element_types.setdefault(slot.key, copy.deepcopy(stored_types.value))


def _restore(slot: _Slot, kept: Mapping[tuple[str, ...], _Slot]) -> None:
    if slot.kind in _DECLARED:
        slot.owner.pop("masked", None)
    stored = kept.get(slot.place)
    if stored is None:
        return
    if slot.value == MASK_PLACEHOLDER and holds_secret_value(stored.value):
        _restore_companions(slot, stored, kept)
        if slot.kind in _DECLARED:
            slot.owner["secret"] = True
    slot.holder[slot.key] = _kept(slot.value, stored.value)


def _restored[
    Document
](submitted: Document, stored: Any, source: _SlotSource, echo_source: _SlotSource) -> Document:
    """``echo_source`` also finds an echoed mask whose secret flag was dropped (REQ-3.1.3.5)."""
    kept = {slot.place: slot for slot in source(stored)}
    result = copy.deepcopy(submitted)
    for slot in echo_source(result):
        _restore(slot, kept)
    return result


def _items(document: Any, source: _SlotSource, kinds: Any) -> list[tuple[str, Any]]:
    return [(slot.name, slot.value) for slot in source(document) if slot.kind in kinds]


# ---------------------------------------------------------------------------
# Workflows: a Test's or a Function body's, every nested body included
# ---------------------------------------------------------------------------


def collect_setter_secret_names(workflow: dict[str, Any]) -> set[str]:
    """The variable names every Variable Setter marks secret, at every depth."""
    names: set[str] = set()
    for block in iter_blocks(workflow):
        target = _setter_secret_target(block)
        if target is not None:
            names.update(target[1])
    return names


def seal_workflow_node_secrets(
    workflow: dict[str, Any], *, secret_inputs: SecretInputNames | None = None
) -> dict[str, Any]:
    """Seal every secret a workflow holds; ``secret_inputs`` names a pinned Function's own."""
    return _transformed(workflow, _workflow_source(secret_inputs), seal_value, _ALL)


def unseal_workflow_node_secrets(workflow: dict[str, Any]) -> dict[str, Any]:
    """Unseal every secret a workflow holds, at run-load."""
    return _transformed(workflow, _workflow_source(), get_cipher().unseal, _ALL)


def mask_workflow_node_secrets(workflow: dict[str, Any]) -> dict[str, Any]:
    """Replace every secret a workflow holds with the placeholder (share-safe export)."""
    return _masked(workflow, _workflow_source(), _ALL)


def mask_workflow_function_secrets(workflow: dict[str, Any]) -> dict[str, Any]:
    """A workflow with its Function locals and output defaults masked."""
    return _masked(workflow, _workflow_source(), _FUNCTION_KINDS)


def read_workflow_secrets(workflow: dict[str, Any]) -> dict[str, Any]:
    """Read a workflow under the test-variables and credential-inputs reveals (REQ-3.1.3.17)."""
    return _shown(workflow, _workflow_source())


def transform_setter_node_secrets(
    workflow: dict[str, Any], transform: Callable[[Any], Any]
) -> dict[str, Any]:
    """Copy a workflow, applying ``transform`` to every secret value it holds."""
    return _transformed(workflow, _workflow_source(), transform, _ALL)


def restore_masked_workflow_secrets(submitted: Any, stored: Any) -> Any:
    """A placeholder at a secret place keeps the secret stored at that same place."""
    return _restored(submitted, stored, _workflow_source(), _workflow_source(echoed=True))


def iter_workflow_secret_items(workflow: Any) -> list[tuple[str, Any]]:
    """Ordered ``(name, stored value)`` pairs for every secret a workflow holds."""
    return _items(workflow, _workflow_source(), _REPORTED)


def iter_function_secret_items(workflow: Any) -> list[tuple[str, Any]]:
    """Ordered ``(name, stored value)`` pairs of the Function locals and output defaults;
    a computed one holds its source text, which is not the secret, so it is left out."""
    return [
        (slot.name, slot.value)
        for slot in _workflow_source()(workflow)
        if slot.kind in _DECLARED
        and not (slot.owner.get("isExpression") or slot.owner.get("isTemplate"))
    ]


SETTER_ROW = _SETTER
CREDENTIAL = _CREDENTIAL
_SETTING_KINDS = frozenset({_SETTER, _CREDENTIAL})


@dataclass(frozen=True)
class SecretSetting:
    """A secret one block setting holds: its block ids outer to inner, kind, name and value."""

    blocks: tuple[str, ...]
    kind: str
    name: str
    value: Any


def iter_secret_settings(
    workflow: Any, *, secret_inputs: SecretInputNames | None = None
) -> list[SecretSetting]:
    """Every Setter row and credential field a workflow holds, at any depth."""
    # A slot's place is (block, "fnN", "nodes", block, ..., kind, name).
    return [
        SecretSetting(slot.place[:-2][::3], slot.kind, slot.name, slot.value)
        for slot in _workflow_slots(workflow, (), secret_inputs)
        if slot.kind in _SETTING_KINDS
    ]


def iter_plugin_credential_secret_items(workflow: dict[str, Any]) -> list[tuple[str, Any]]:
    """Ordered ``(field-name, stored-value)`` pairs for every declared credential field."""
    return _items(workflow, _workflow_source(), {_CREDENTIAL})


# ---------------------------------------------------------------------------
# Function definitions: a library version body or an export document
# ---------------------------------------------------------------------------


def seal_definition_secrets(
    definition: dict[str, Any], *, secret_inputs: SecretInputNames | None = None
) -> dict[str, Any]:
    """Seal every secret a Function definition holds: locals, output defaults, its workflow."""
    return _transformed(definition, _definition_source(secret_inputs), seal_value, _ALL)


def unseal_definition_secrets(definition: dict[str, Any]) -> dict[str, Any]:
    """Unseal every secret a Function definition holds, at run-load."""
    return _transformed(definition, _definition_source(), get_cipher().unseal, _ALL)


def mask_definition_secrets(definition: dict[str, Any]) -> dict[str, Any]:
    """Replace every secret a Function definition holds with the placeholder (export)."""
    return _masked(definition, _definition_source(), _ALL)


def mask_definition_function_secrets(definition: dict[str, Any]) -> dict[str, Any]:
    """A Function definition with its locals and output defaults masked."""
    return _masked(definition, _definition_source(), _FUNCTION_KINDS)


def read_definition_secrets(definition: dict[str, Any]) -> dict[str, Any]:
    """A read of a Function definition, by the reveal rules a workflow read follows."""
    return _shown(definition, _definition_source())


def own_secret_value(definition: Any, name: str) -> Any:
    """The stored value of a Function's own secret local or output default ``name``, else None."""
    return next(
        (
            slot.value
            for slot in _definition_source()(definition)
            if slot.kind in _DECLARED and len(slot.place) == 2 and slot.name == name
        ),
        None,
    )


def transform_definition_secrets(
    definition: dict[str, Any], transform: Callable[[Any], Any]
) -> dict[str, Any]:
    """Copy a Function definition, applying ``transform`` to every secret value it holds."""
    return _transformed(definition, _definition_source(), transform, _ALL)


def restore_masked_definition_secrets(submitted: Any, stored: Any) -> Any:
    """A placeholder at a secret place keeps the secret stored at that same place."""
    return _restored(submitted, stored, _definition_source(), _definition_source(echoed=True))


def iter_definition_secret_items(definition: Any) -> list[tuple[str, Any]]:
    """Ordered ``(name, stored value)`` pairs for every secret a Function definition holds."""
    return _items(definition, _definition_source(), _REPORTED)
