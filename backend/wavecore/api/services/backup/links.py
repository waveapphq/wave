"""The id maps of a restore applied to each kind of document (REQ-5.2.4.9.5)."""

import copy
from collections.abc import Mapping
from typing import Any

from wavecore.core.functions.references import iter_blocks, remap_function_ids


def _dig(holder: Any, *keys: str) -> Any:
    for key in keys:
        holder = holder.get(key) if isinstance(holder, dict) else None
    return holder


def _remap_list(holder: Any, key: str, id_map: Mapping[str, str]) -> None:
    ids = _dig(holder, key)
    if isinstance(ids, list):
        holder[key] = [id_map.get(item, item) if isinstance(item, str) else item for item in ids]


def _remap_profile_bindings(workflow: Any, profile_ids: Mapping[str, str]) -> None:
    for block in iter_blocks(workflow):
        bindings = _dig(block, "data", "config", "profileBindings")
        for binding in bindings if isinstance(bindings, list) else []:
            profile_id = _dig(binding, "profileId")
            if isinstance(profile_id, str) and profile_id in profile_ids:
                binding["profileId"] = profile_ids[profile_id]


def _remap_workflow(
    workflow: Any, function_ids: Mapping[str, str], profile_ids: Mapping[str, str]
) -> Any:
    result = remap_function_ids(workflow, function_ids)
    _remap_profile_bindings(result, profile_ids)
    return result


def remap_test(
    document: dict[str, Any],
    *,
    function_ids: Mapping[str, str],
    profile_ids: Mapping[str, str],
) -> dict[str, Any]:
    """A copy of a Test document with its Function ids and profile ids rewritten."""
    return {
        key: (
            _remap_workflow(value, function_ids, profile_ids)
            if key == "workflow"
            else copy.deepcopy(value)
        )
        for key, value in document.items()
    }


def remap_function_document(
    document: dict[str, Any], *, profile_ids: Mapping[str, str]
) -> dict[str, Any]:
    """A copy of a Function export document with the profile ids of every version rewritten."""
    result = copy.deepcopy(document)
    _remap_profile_bindings(result.get("workflow"), profile_ids)
    versions = result.get("versions")
    for record in versions if isinstance(versions, list) else []:
        _remap_profile_bindings(_dig(record, "definition", "workflow"), profile_ids)
    return result


def remap_profile(
    document: dict[str, Any], *, environment_ids: Mapping[str, str]
) -> dict[str, Any]:
    """A copy of a Profile document with the keys of `environment_values` rewritten."""
    result = copy.deepcopy(document)
    values = result.get("environment_values")
    if isinstance(values, dict):
        result["environment_values"] = {
            environment_ids.get(key, key): value for key, value in values.items()
        }
    return result


def remap_suite(document: dict[str, Any], *, test_ids: Mapping[str, str]) -> dict[str, Any]:
    """A copy of a Suite document with its `tests` rewritten."""
    result = copy.deepcopy(document)
    _remap_list(result, "tests", test_ids)
    return result


def remap_regression(
    document: dict[str, Any], history: list[dict[str, Any]], *, suite_ids: Mapping[str, str]
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Copies of a Regression document and its history rows with their `suites` rewritten."""
    result = copy.deepcopy(document)
    _remap_list(result, "suites", suite_ids)
    rows = copy.deepcopy(history)
    for row in rows:
        _remap_list(_dig(row, "snapshot"), "suites", suite_ids)
    return result, rows
