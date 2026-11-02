"""Variable type collision detection for cross-regression consistency.

Detects when a variable update in one regression would introduce type conflicts
with the same variable name in other regressions that share suites.

This mirrors the suite pattern exactly:
- Suites: suite -> shared tests -> other suites -> compare vars
- Regressions: regression -> shared suites -> other regressions -> compare vars
"""

from typing import Any


def compute_regression_variable_delta(
    current_variables: dict[str, Any],
    proposed_variables: dict[str, Any],
) -> list[str]:
    """Return names of variables that are new or have changed type."""
    delta: list[str] = []
    for name, var_info in proposed_variables.items():
        proposed_type = _extract_type(var_info)
        current_info = current_variables.get(name)
        if current_info is None or _extract_type(current_info) != proposed_type:
            delta.append(name)
    return delta


def check_variable_collisions_for_regression(
    suite_ids: list[str],
    variable_names_to_check: list[str],
    proposed_variables: dict[str, Any],
) -> list[dict[str, str]]:
    """Check regression variable types against member suite variable types.

    Compares proposed regression variables against variables with the same
    name in each member suite. Returns a collision entry when types differ.
    """
    if not variable_names_to_check or not suite_ids:
        return []

    from wavecore.api.services.suites._storage import _load_suite

    collisions: list[dict[str, str]] = []
    for suite_id in suite_ids:
        suite = _load_suite(suite_id)
        if suite is None:
            continue
        suite_vars = suite.get("variables", {})
        if not isinstance(suite_vars, dict):
            continue
        suite_name = suite.get("name", suite_id)
        for var_name in variable_names_to_check:
            if var_name not in suite_vars:
                continue
            proposed_type = _extract_type(proposed_variables.get(var_name))
            suite_type = _extract_type(suite_vars[var_name])
            if proposed_type != suite_type:
                collisions.append(
                    {
                        "variable": var_name,
                        "this_type": proposed_type,
                        "other_suite": suite_name,
                        "other_suite_id": suite_id,
                        "other_type": suite_type,
                    }
                )
    return collisions


def check_variable_collisions_for_suites(
    exclude_regression_id: str,
    suite_ids: list[str],
    proposed_variables: dict[str, Any],
) -> list[dict[str, str]]:
    """Check for variable type collisions across regressions sharing suites.

    Accepts suite IDs directly (not read from disk) so that callers can
    validate BEFORE persisting suite membership changes (e.g. update_regression
    changing membership, or regression import).
    """
    if not suite_ids or not proposed_variables:
        return []

    other_regression_ids = _collect_other_regression_ids(exclude_regression_id, suite_ids)
    if not other_regression_ids:
        return []

    all_var_names = list(proposed_variables.keys())
    proposed_types = _build_proposed_type_map(all_var_names, proposed_variables)
    return _find_collisions(other_regression_ids, proposed_types)


def _collect_other_regression_ids(regression_id: str, suite_ids: list[str]) -> set[str]:
    """Gather IDs of other regressions that share at least one suite."""
    from wavecore.api.services.regressions._storage import _list_all_regressions

    other_ids: set[str] = set()
    suite_set = set(suite_ids)
    for reg in _list_all_regressions():
        rid = reg.get("id", "")
        if rid == regression_id:
            continue
        reg_suites = set(reg.get("suites", []))
        if reg_suites & suite_set:
            other_ids.add(rid)
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
    other_regression_ids: set[str],
    proposed_types: dict[str, str],
) -> list[dict[str, str]]:
    """Compare proposed types against variables in other regressions."""
    from wavecore.api.services.regressions._storage import _load_regression

    collisions: list[dict[str, str]] = []
    for other_id in sorted(other_regression_ids):
        other_reg = _load_regression(other_id)
        if other_reg is None:
            continue
        _check_regression_collisions(other_reg, other_id, proposed_types, collisions)
    return collisions


def _check_regression_collisions(
    other_reg: dict[str, Any],
    other_id: str,
    proposed_types: dict[str, str],
    collisions: list[dict[str, str]],
) -> None:
    """Append any type mismatches between proposed and other regression variables."""
    other_vars = other_reg.get("variables", {})
    other_name = other_reg.get("name", "")
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
                    "other_regression": other_name,
                    "other_regression_id": other_id,
                    "other_type": other_type,
                }
            )


def check_suite_pair_collisions(suite_ids: list[str]) -> list[dict[str, str]]:
    """Detect variable-type conflicts between suites inside a regression.

    Two suites in the same regression are in conflict when they declare the
    same variable name with different types. Returns a list of collision
    entries describing the first conflict per variable name so the UI can
    surface the offending suite pair.
    """
    if not suite_ids or len(suite_ids) < 2:
        return []

    from wavecore.api.services.suites._storage import _load_suite

    # variable_name -> (suite_id, suite_name, type)
    seen: dict[str, tuple[str, str, str]] = {}
    collisions: list[dict[str, str]] = []

    for suite_id in suite_ids:
        suite = _load_suite(suite_id)
        if suite is None:
            continue
        suite_vars = suite.get("variables", {})
        if not isinstance(suite_vars, dict):
            continue
        suite_name = suite.get("name", suite_id)

        for var_name, var_info in suite_vars.items():
            var_type = _extract_type(var_info)
            prior = seen.get(var_name)
            if prior is None:
                seen[var_name] = (suite_id, suite_name, var_type)
                continue
            prior_id, prior_name, prior_type = prior
            if prior_type != var_type:
                collisions.append(
                    {
                        "variable": var_name,
                        "this_type": var_type,
                        "this_suite": suite_name,
                        "this_suite_id": suite_id,
                        "other_type": prior_type,
                        "other_suite": prior_name,
                        "other_suite_id": prior_id,
                    }
                )

    return collisions


def _extract_type(var_info: Any) -> str:
    """Extract the type string from a variable declaration."""
    if isinstance(var_info, dict):
        return str(var_info.get("type", "string"))
    return "string"
