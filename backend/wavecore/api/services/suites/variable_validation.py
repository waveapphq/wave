"""Variable type collision detection for cross-suite consistency.

Detects when a variable update in one suite would introduce type conflicts
with the same variable name in other suites that share tests.
"""

from typing import Any


def compute_variable_delta(
    current_variables: dict[str, Any],
    proposed_variables: dict[str, Any],
) -> list[str]:
    """Return names of variables that are new or have changed type.

    This enables delta-only checking on variable updates - only variables
    whose type actually changed (or are brand new) need cross-suite validation.

    Args:
        current_variables: Existing variable declarations on the suite.
        proposed_variables: New variable declarations being applied.

    Returns:
        List of variable names that are new or whose type changed.
    """
    delta: list[str] = []
    for name, var_info in proposed_variables.items():
        proposed_type = _extract_type(var_info)
        current_info = current_variables.get(name)
        if current_info is None or _extract_type(current_info) != proposed_type:
            delta.append(name)
    return delta


def check_variable_type_collisions(
    suite_id: str,
    variable_names_to_check: list[str],
    proposed_variables: dict[str, Any],
) -> list[dict[str, str]]:
    """Check for type collisions across suites that share tests.

    For each test in the given suite, find all *other* suites containing that
    test. For each other suite, compare the proposed variable types against
    variables with the same name in that suite.

    Args:
        suite_id: The suite being modified.
        variable_names_to_check: Only these variable names are checked.
        proposed_variables: The full proposed variable declarations.

    Returns:
        List of collision dicts with keys: variable, this_type,
        other_suite, other_suite_id, other_type.
    """
    if not variable_names_to_check:
        return []

    from wavecore.api.services.suites._storage import _load_suite

    suite = _load_suite(suite_id)
    if suite is None:
        return []

    test_ids = suite.get("tests", [])
    if not test_ids:
        return []

    other_suite_ids = _collect_other_suite_ids(suite_id, test_ids)
    if not other_suite_ids:
        return []

    proposed_types = _build_proposed_type_map(variable_names_to_check, proposed_variables)
    return _find_collisions(other_suite_ids, proposed_types)


def check_variable_collisions_for_tests(
    exclude_suite_id: str,
    test_ids: list[str],
    proposed_variables: dict[str, Any],
) -> list[dict[str, str]]:
    """Check for variable type collisions using explicit test IDs.

    Unlike ``check_variable_type_collisions`` which reads the suite's test
    list from disk, this function accepts test IDs directly.  This is needed
    when the test list has not yet been persisted (e.g. ``update_suite``
    changing the test membership, or suite import).

    Args:
        exclude_suite_id: Suite ID to exclude from sibling lookup.
        test_ids: Test IDs to check for cross-suite overlap.
        proposed_variables: Variable declarations to validate.

    Returns:
        List of collision dicts (same shape as
        ``check_variable_type_collisions``).
    """
    if not test_ids or not proposed_variables:
        return []

    other_suite_ids = _collect_other_suite_ids(exclude_suite_id, test_ids)
    if not other_suite_ids:
        return []

    all_var_names = list(proposed_variables.keys())
    proposed_types = _build_proposed_type_map(all_var_names, proposed_variables)
    return _find_collisions(other_suite_ids, proposed_types)


def _collect_other_suite_ids(suite_id: str, test_ids: list[str]) -> set[str]:
    """Gather IDs of other suites that share at least one test with this suite."""
    from wavecore.api.services.relations import service as relation_service

    other_ids: set[str] = set()
    for test_id in test_ids:
        for entry in relation_service.get_suites_for_test(test_id):
            if entry["id"] != suite_id:
                other_ids.add(entry["id"])
    return other_ids


def _build_proposed_type_map(
    variable_names: list[str],
    proposed_variables: dict[str, Any],
) -> dict[str, str]:
    """Build a mapping of variable name to proposed type for the names to check."""
    proposed_types: dict[str, str] = {}
    for name in variable_names:
        var_info = proposed_variables.get(name)
        if var_info is not None:
            proposed_types[name] = _extract_type(var_info)
    return proposed_types


def _find_collisions(
    other_suite_ids: set[str],
    proposed_types: dict[str, str],
) -> list[dict[str, str]]:
    """Compare proposed types against variables in other suites."""
    from wavecore.api.services.suites._storage import _load_suite

    collisions: list[dict[str, str]] = []
    for other_id in sorted(other_suite_ids):
        other_suite = _load_suite(other_id)
        if other_suite is None:
            continue
        _check_suite_collisions(other_suite, other_id, proposed_types, collisions)
    return collisions


def _check_suite_collisions(
    other_suite: dict[str, Any],
    other_id: str,
    proposed_types: dict[str, str],
    collisions: list[dict[str, str]],
) -> None:
    """Append any type mismatches between proposed and other suite variables."""
    other_vars = other_suite.get("variables", {})
    other_name = other_suite.get("name", "")
    for var_name, proposed_type in proposed_types.items():
        other_var = other_vars.get(var_name)
        if other_var is None:
            continue
        other_type = _extract_type(other_var)
        if proposed_type != other_type:
            collisions.append(
                {
                    "variable": var_name,
                    "this_type": proposed_type,
                    "other_suite": other_name,
                    "other_suite_id": other_id,
                    "other_type": other_type,
                }
            )


def _extract_type(var_info: Any) -> str:
    """Extract the type string from a variable declaration.

    Handles both dict-style ``{"type": "string", ...}`` and plain values.
    """
    if isinstance(var_info, dict):
        return str(var_info.get("type", "string"))
    return "string"
