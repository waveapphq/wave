"""Author tool handlers: recipe guide, dry-run validation, create, amend, readback.

Recipe problems always come back as data findings; creation and amendment persist
ONLY through the strict tests-service save pipeline and never partially. Amendment
refuses tests whose hand-built wiring a recipe cannot express.
"""

import contextlib
from collections.abc import Callable
from pathlib import Path
from typing import Any

import yaml

from wavecore.api.services.network import ssh_hosts
from wavecore.api.services.storage_paths import get_test_testdata_path
from wavecore.api.services.tests import service as test_service
from wavecore.api.services.tests.service import SaveValidationError
from wavecore.core.recipes.compiler import compile_recipe
from wavecore.core.recipes.decompiler import decompile_test_data
from wavecore.core.recipes.model import finding
from wavecore.core.recipes.parser import parse_recipe
from wavecore.core.recipes.relay import map_platform_errors
from wavecore.core.secrets.file_reference import (
    SecretFileNotFoundError,
    SecretFileOutsideRootError,
    SecretsDirNotConfiguredError,
    read_secret_file,
)
from wavecore.core.secrets.owed import owed_in_test
from wavecore.core.utf8_text import dump_exact_yaml, load_exact_yaml, unencodable_place
from wavecore.mcp.tools._findings import owed_action_items

_GUIDE_DIR = Path(__file__).resolve().parent.parent / "guide"

NAME_CONFLICT_FIX = (
    "Choose a different test name, or amend the existing test with amend_test_from_recipe."
)

TARGET_NOT_EXPRESSIBLE_PROBLEM = (
    "The target test uses connectivity the recipe format cannot express; "
    "amending it through a recipe would drop that wiring."
)
TARGET_NOT_EXPRESSIBLE_FIX = (
    "Edit this test directly in the workbench. Recipe amendment is available "
    "only for tests that round-trip fully."
)

SESSION_HELD_FIX = (
    "Another editor currently holds the workbench session. Ask them to release "
    "it or hand it over, then retry."
)


def run_held_write(
    session_id: str | None,
    result_key: str,
    write: Callable[[], dict[str, Any]],
) -> dict[str, Any]:
    """Hold the workbench slot as the MCP around one atomic authoring write.

    A pending take-over is honored by the release after the write; a forced
    displacement mid-write leaves the release a no-op.
    """
    from wavecore.api.exceptions import ConflictException
    from wavecore.api.services.workbench import ownership
    from wavecore.mcp import state as mcp_state

    holder_id = session_id or "mcp"
    try:
        ownership.claim(holder_id, mcp_state.mcp_holder_label(holder_id), "mcp")
    except ConflictException as exc:
        return {
            result_key: False,
            "findings": [finding("test", "SESSION_HELD", exc.message, SESSION_HELD_FIX)],
        }
    try:
        return write()
    finally:
        with contextlib.suppress(ConflictException):
            ownership.release(holder_id, "handoff")


def get_recipe_guide() -> dict[str, Any]:
    """The recipe format guide and the packaged worked examples."""
    guide = (_GUIDE_DIR / "recipe-format.md").read_text(encoding="utf-8")
    examples: list[dict[str, str]] = []
    for path in sorted((_GUIDE_DIR / "examples").glob("*.yaml")):
        text = path.read_text(encoding="utf-8")
        document = yaml.safe_load(text)
        description = str(((document or {}).get("test") or {}).get("description") or "")
        examples.append({"name": path.stem, "description": description, "recipe": text})
    return {"guide": guide, "examples": examples}


def _with_conflict_fix(findings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    for item in findings:
        if item["code"] == "NAME_CONFLICT" and item["fix"] is None:
            item["fix"] = NAME_CONFLICT_FIX
    return findings


def _stage2_findings(test_data: dict[str, Any], step_map: dict[str, str]) -> list[dict[str, Any]]:
    errors = test_service.validate_test_data_for_create(test_data)
    return _with_conflict_fix(map_platform_errors(errors, step_map))


TARGET_NOT_FOUND_FIX = "Check the reference with the list_tests tool"


def no_value_action_items(test_data: dict[str, Any]) -> list[dict[str, Any]]:
    """Manual action items for every secret place of the Test that holds nothing."""
    from wavecore.api.services.functions.service import secret_input_names

    return owed_action_items(owed_in_test(test_data, secret_inputs=secret_input_names))


def _target_not_expressible_finding() -> dict[str, Any]:
    return finding(
        "test",
        "TARGET_NOT_RECIPE_EXPRESSIBLE",
        TARGET_NOT_EXPRESSIBLE_PROBLEM,
        TARGET_NOT_EXPRESSIBLE_FIX,
    )


def _secret_file_finding(name: str, code: str, problem: str, fix: str) -> dict[str, Any]:
    return finding(f"variables.{name}", code, problem, fix)


def _read_referenced_secret(name: str, file_name: str) -> tuple[str | None, dict[str, Any] | None]:
    """(value, None) on success, or (None, finding) naming why the read failed."""
    try:
        return read_secret_file(file_name), None
    except SecretsDirNotConfiguredError:
        return None, _secret_file_finding(
            name,
            "SECRETS_DIR_NOT_CONFIGURED",
            "This deployment has no secrets input directory configured, so "
            "value_from_file cannot be used.",
            "Ask an administrator to configure it, or provide the value inline.",
        )
    except SecretFileOutsideRootError:
        return None, _secret_file_finding(
            name,
            "SECRET_FILE_OUTSIDE_ROOT",
            f"The secret file reference '{file_name}' resolves outside the "
            "configured secrets input directory and was rejected.",
            "Reference a file inside the configured secrets input directory.",
        )
    except SecretFileNotFoundError:
        return None, _secret_file_finding(
            name,
            "SECRET_FILE_NOT_FOUND",
            f"The secret file '{file_name}' was not found in the configured "
            "secrets input directory.",
            "Place the file in the configured secrets input directory or use a provided value.",
        )


def _resolve_secret_files(recipe: str) -> tuple[str, list[dict[str, Any]]]:
    """Resolve value_from_file secret vars to sealed-in-place values.

    Returns (recipe text, findings). With no value_from_file, the original text
    is returned unchanged; on any file error the findings are returned and the
    recipe is not rewritten.
    """
    try:
        document = load_exact_yaml(recipe)
    except yaml.YAMLError:
        return recipe, []
    if not isinstance(document, dict):
        return recipe, []
    # Left for the parser to report: it names the place.
    if unencodable_place(recipe, document, "the recipe") is not None:
        return recipe, []
    variables = document.get("variables")
    if not isinstance(variables, dict):
        return recipe, []

    findings: list[dict[str, Any]] = []
    changed = False
    for name, declaration in variables.items():
        if not isinstance(declaration, dict) or "value_from_file" not in declaration:
            continue
        file_name = str(declaration.get("value_from_file") or "")
        value, problem = _read_referenced_secret(str(name), file_name)
        if problem is not None:
            findings.append(problem)
            continue
        declaration.pop("value_from_file")
        declaration["value"] = value
        changed = True

    if findings:
        return recipe, findings
    if changed:
        return dump_exact_yaml(document), []
    return recipe, []


def _testdata_dirs_of(target: dict[str, Any]) -> list[str]:
    """The one root a recipe's testdata:// literals resolve against: the target's own folder."""
    return [str(get_test_testdata_path(str(target.get("id"))))]


def validate_recipe(recipe: str, test_ref: str | None = None) -> dict[str, Any]:
    """Dry-run validation; persists nothing. With test_ref, validate as an amendment."""
    from wavecore.api.exceptions import NotFoundException
    from wavecore.mcp.tools.discover import resolve_test

    doc, _parse_findings = parse_recipe(recipe)
    target: dict[str, Any] | None = None
    target_finding: dict[str, Any] | None = None
    if test_ref is not None:
        try:
            target = resolve_test(test_ref)
        except NotFoundException as exc:
            target_finding = finding("test", "TARGET_NOT_FOUND", exc.message, TARGET_NOT_FOUND_FIX)
    result = compile_recipe(
        recipe,
        testdata_dirs=_testdata_dirs_of(target) if target is not None else [],
        placement_defaults=ssh_hosts.placement_defaults(),
    )
    findings = list(result["findings"])
    if target_finding is not None:
        findings.append(target_finding)
    elif target is not None:
        findings.extend(_amend_dry_run_findings(result, target))
    elif result["test_data"] is not None:
        findings.extend(_stage2_findings(result["test_data"], result["step_map"]))
    valid = not any(item["severity"] == "error" for item in findings)
    return {
        "valid": valid,
        "test_name": doc.name if doc is not None else None,
        "findings": findings,
    }


def name_conflict_finding(name: str, exclude_id: str | None = None) -> dict[str, Any] | None:
    """A NAME_CONFLICT finding when an existing (non-excluded) test shares the name."""
    for test in test_service._list_all_tests():
        if test.get("name") == name and str(test.get("id")) != exclude_id:
            return finding(
                "test",
                "NAME_CONFLICT",
                f"Test with name '{name}' already exists",
                NAME_CONFLICT_FIX,
            )
    return None


def _amend_dry_run_findings(result: dict[str, Any], target: dict[str, Any]) -> list[dict[str, Any]]:
    target_id = str(target.get("id"))
    findings: list[dict[str, Any]] = []
    if not decompile_test_data(target)["expressible"]:
        findings.append(_target_not_expressible_finding())
    test_data = result["test_data"]
    if test_data is not None:
        conflict = name_conflict_finding(str(test_data.get("name") or ""), target_id)
        if conflict is not None:
            findings.append(conflict)
        errors = test_service.validate_test_data_for_update(target_id, test_data)
        findings.extend(_with_conflict_fix(map_platform_errors(errors, result["step_map"])))
    return findings


def create_test_from_recipe(recipe: str) -> dict[str, Any]:
    """Compile and persist through the strict create pipeline, or create nothing."""
    from wavecore.api.exceptions import ConflictException

    recipe, secret_findings = _resolve_secret_files(recipe)
    if secret_findings:
        return {"created": False, "findings": secret_findings}

    result = compile_recipe(
        recipe, testdata_dirs=[], placement_defaults=ssh_hosts.placement_defaults()
    )
    findings = list(result["findings"])
    if result["test_data"] is None:
        return {"created": False, "findings": findings}
    warnings = [item for item in findings if item["severity"] == "warning"]
    try:
        created = test_service.create_test(result["test_data"])
    except ConflictException as exc:
        findings.append(finding("test", "NAME_CONFLICT", exc.message, NAME_CONFLICT_FIX))
        return {"created": False, "findings": findings}
    except SaveValidationError as exc:
        findings.extend(_with_conflict_fix(map_platform_errors(exc.errors, result["step_map"])))
        return {"created": False, "findings": findings}
    return {
        "created": True,
        "test_id": created["id"],
        "name": created["name"],
        "version": created["version"],
        "warnings": warnings,
        "repairs": created.get("repairs", []),
        "action_items": no_value_action_items(result["test_data"]),
    }


def get_test_recipe(test_ref: str) -> dict[str, Any]:
    """Readback a test as a recipe with an inexpressibility verdict (never destructive)."""
    from wavecore.mcp.tools.discover import resolve_test

    test = resolve_test(test_ref)
    readback = decompile_test_data(test)
    return {
        "test_id": test.get("id"),
        "name": test.get("name"),
        "version": test.get("version"),
        "recipe": readback["recipe"],
        "expressible": readback["expressible"],
        "inexpressible": readback["inexpressible"],
    }


_SIZE_KEYS = ("width", "height")


def _harvest_layout(
    target: dict[str, Any],
) -> tuple[dict[str, dict[str, float]], dict[str, dict[str, float]]]:
    """Stored positions and hand-set sizes of the target's recipe-built nodes, keyed by recipeKey.

    A width equal to the one the compiler would generate is the compiler's, so it is
    left out and regenerated for the node's current name.
    """
    from wavecore.core.layout.dimensions import fit_node_width
    from wavecore.core.layout.engine import ingress_counts

    workflow = target.get("workflow") or {}
    ingress = ingress_counts(workflow.get("edges") or [])
    positions: dict[str, dict[str, float]] = {}
    sizes: dict[str, dict[str, float]] = {}
    for node in workflow.get("nodes") or []:
        key = (node.get("data") or {}).get("recipeKey")
        if key is None:
            continue
        position = node.get("position")
        if isinstance(position, dict):
            positions[str(key)] = position
        size = {axis: node[axis] for axis in _SIZE_KEYS if isinstance(node.get(axis), int | float)}
        if size.get("width") == fit_node_width(node, ingress.get(str(node.get("id")), 0)):
            del size["width"]
        if size:
            sizes[str(key)] = size
    return positions, sizes


def _apply_pinned_layout(target: dict[str, Any], test_data: dict[str, Any]) -> None:
    """Keep untouched (incl. human-dragged and hand-resized) node geometry across an amend."""
    from wavecore.core.layout.engine import layout_workflow

    old_positions, old_sizes = _harvest_layout(target)
    new_nodes = test_data["workflow"]["nodes"]
    new_edges = test_data["workflow"]["edges"]
    for node in new_nodes:
        key = str((node.get("data") or {}).get("recipeKey"))
        if key in old_sizes:
            node.update(old_sizes[key])
    pinned = {
        str(node["id"]): old_positions[str((node.get("data") or {}).get("recipeKey"))]
        for node in new_nodes
        if str((node.get("data") or {}).get("recipeKey")) in old_positions
    }
    if not pinned:
        return
    positions = layout_workflow(new_nodes, new_edges, pinned)
    for node in new_nodes:
        if node["id"] in positions:
            node["position"] = positions[node["id"]]


def _stale_version_finding(recipe: str, target: dict[str, Any]) -> dict[str, Any] | None:
    """A readback carries the version it was taken from; if the test has moved on
    since, applying the whole recipe would silently discard the newer content."""
    from wavecore.core.recipes.parser import parse_recipe

    doc, _ = parse_recipe(recipe)
    submitted = doc.version if doc is not None else None
    current = str(target.get("version") or "")
    if not submitted or submitted == current:
        return None
    return finding(
        "test.version",
        "STALE_RECIPE_VERSION",
        f"This recipe was read back at version {submitted} but the test is now at {current}",
        "Read the test back again and re-apply your changes",
    )


def amend_test_from_recipe(test_ref: str, recipe: str) -> dict[str, Any]:
    """Recompile a fully-expressible test from a revised recipe, or amend nothing."""
    from wavecore.api.exceptions import ConflictException
    from wavecore.mcp.tools.discover import resolve_test

    target = resolve_test(test_ref)
    if not decompile_test_data(target)["expressible"]:
        return {"amended": False, "findings": [_target_not_expressible_finding()]}

    stale = _stale_version_finding(recipe, target)
    if stale is not None:
        return {"amended": False, "findings": [stale]}

    recipe, secret_findings = _resolve_secret_files(recipe)
    if secret_findings:
        return {"amended": False, "findings": secret_findings}

    result = compile_recipe(
        recipe,
        testdata_dirs=_testdata_dirs_of(target),
        placement_defaults=ssh_hosts.placement_defaults(),
    )
    findings = list(result["findings"])
    if result["test_data"] is None:
        return {"amended": False, "findings": findings}

    target_id = str(target.get("id"))
    test_data = result["test_data"]
    conflict = name_conflict_finding(str(test_data.get("name") or ""), target_id)
    if conflict is not None:
        findings.append(conflict)
        return {"amended": False, "findings": findings}

    _apply_pinned_layout(target, test_data)
    warnings = [item for item in findings if item["severity"] == "warning"]
    try:
        updated = test_service.update_test(target_id, test_data, etag=None)
    except SaveValidationError as exc:
        findings.extend(_with_conflict_fix(map_platform_errors(exc.errors, result["step_map"])))
        return {"amended": False, "findings": findings}
    except ConflictException as exc:
        findings.append(finding("test", "NAME_CONFLICT", exc.message, NAME_CONFLICT_FIX))
        return {"amended": False, "findings": findings}
    if updated is None:
        return {"amended": False, "findings": findings}
    return {
        "amended": True,
        "test_id": updated["id"],
        "name": updated["name"],
        "version": updated["version"],
        "warnings": warnings,
        "repairs": updated.get("repairs", []),
        "action_items": no_value_action_items(test_data),
    }
