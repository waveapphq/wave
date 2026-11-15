"""Organize tool handlers: author suites, regressions, profiles, and variables.

Structured params (not a recipe DSL) call the in-process entity services the UI
uses. Payload problems come back as data findings; reference resolution
(id-or-unique-name) raises through the shared resolver. Edits are non-destructive:
membership and variables change only through explicit add/remove/set, and a
referenced test or suite is confirmed to exist before the write is accepted.
"""

from collections.abc import Callable
from typing import Any

from wavecore.api.exceptions import ConflictException, ValidationException
from wavecore.api.services import variable_service
from wavecore.api.services.profiles import service as profile_service
from wavecore.api.services.profiles._common import secret_field_names
from wavecore.api.services.regressions import service as regression_service
from wavecore.api.services.suites import service as suite_service
from wavecore.core.secrets.owed import owed_fields, owed_variables
from wavecore.mcp.tools._findings import _finding, _service_finding, owed_action_items
from wavecore.mcp.tools.discover import (
    _resolve_ref,
    resolve_regression,
    resolve_suite,
    resolve_test,
)

_LIST_ALL = 10_000


_MEMBER_FIX = "Pass an existing {label} id or unique name"


def _no_value_variable_items(variables: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Declare-empty announces what a person still owes, on every surface that
    authors a secret variable."""
    return owed_action_items(owed_variables(variables))


_Resolver = Callable[[str], dict[str, Any]]


def _member_id(ref: str, resolver: _Resolver) -> str | None:
    """Members accept an id or a unique name, like every other reference."""
    try:
        return str(resolver(ref)["id"])
    except Exception:
        return None


def _resolve_members(
    refs: list[str] | None,
    *,
    label: str,
    code: str,
    resolver: _Resolver,
) -> tuple[list[str], list[dict[str, Any]]]:
    resolved: list[str] = []
    findings: list[dict[str, Any]] = []
    for ref in refs or []:
        member_id = _member_id(ref, resolver)
        if member_id is None:
            findings.append(
                _finding(
                    code,
                    f"{label.capitalize()} '{ref}' not found",
                    _MEMBER_FIX.format(label=label),
                )
            )
        else:
            resolved.append(member_id)
    return resolved, findings


def _removal_ids(current: list[Any], refs: list[str] | None, resolver: _Resolver) -> list[str]:
    """A removal names a stored member id, or a member by id or unique name like an addition."""
    return [ref if ref in current else (_member_id(ref, resolver) or ref) for ref in refs or []]


def _resolve_tests(refs: list[str] | None) -> tuple[list[str], list[dict[str, Any]]]:
    return _resolve_members(
        refs, label="test", code="ATTACHED_TEST_NOT_FOUND", resolver=resolve_test
    )


def _resolve_suites(refs: list[str] | None) -> tuple[list[str], list[dict[str, Any]]]:
    return _resolve_members(
        refs, label="suite", code="ATTACHED_SUITE_NOT_FOUND", resolver=resolve_suite
    )


def _removal_findings(
    current: list[Any], removals: list[tuple[str, str]], label: str
) -> list[dict[str, Any]]:
    """A removal that matches nothing is a typo, not a silent success."""
    return [
        _finding("NOT_A_MEMBER", f"{label.capitalize()} '{ref}' is not in this {_OWNER[label]}")
        for ref, member_id in removals
        if member_id not in current
    ]


_OWNER = {"test": "suite", "suite": "regression"}


def _contradiction_findings(
    add_ids: list[str], removals: list[tuple[str, str]], label: str
) -> list[dict[str, Any]]:
    return [
        _finding(
            "CONTRADICTORY_MEMBERSHIP",
            f"{label.capitalize()} '{ref}' is both added and removed in one call",
            "Add or remove it, not both",
        )
        for ref, member_id in removals
        if member_id in add_ids
    ]


def _untyped_variable_findings(variables: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Shared and entity variables are typed objects; a type alone is complete and holds
    null, while a bare value would persist a row shape no read contract describes."""
    return [
        _finding(
            "UNTYPED_VARIABLE",
            f"Variable '{name}' must be an object with a type",
            'Use {"type": "string"}; add "value" to give it one',
        )
        for name, declaration in (variables or {}).items()
        if not isinstance(declaration, dict) or not isinstance(declaration.get("type"), str)
    ]


def _variable_removal_findings(
    current: dict[str, Any], remove: list[str] | None
) -> list[dict[str, Any]]:
    return [
        _finding("VARIABLE_NOT_FOUND", f"Variable '{name}' is not declared here")
        for name in remove or []
        if name not in current
    ]


def _resolve_profile(ref: str) -> dict[str, Any]:
    return _resolve_ref(
        ref,
        type_label="profile",
        get_by_id=profile_service.get_profile,
        list_all=lambda: profile_service.list_profiles(per_page=_LIST_ALL)["profiles"],
    )


# ---------------------------------------------------------------------------
# Suites
# ---------------------------------------------------------------------------


def _validate_suite_name(name: str | None) -> list[dict[str, Any]]:
    if not name:
        return [_finding("NAME_REQUIRED", "Field 'name' is required")]
    findings: list[dict[str, Any]] = []
    if len(name) > 255:
        findings.append(_finding("NAME_LENGTH", "Suite name must be between 1 and 255 characters"))
    problem = suite_service.name_convention_problem(name)
    if problem:
        findings.append(_finding("NAME_CONVENTION", problem))
    return findings


def _merge_members(
    current: list[Any], add: list[Any] | None, remove: list[Any] | None
) -> list[Any]:
    result = [item for item in current if item not in (remove or [])]
    for item in add or []:
        if item not in result:
            result.append(item)
    return result


def _merge_variables(
    current: dict[str, Any], set_vars: dict[str, Any] | None, remove: list[str] | None
) -> dict[str, Any]:
    merged = dict(current)
    merged.update(set_vars or {})
    for name in remove or []:
        merged.pop(name, None)
    return merged


def create_suite(
    name: str | None = None,
    description: str | None = None,
    tests: list[str] | None = None,
    tags: list[str] | None = None,
    variables: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create a suite; validation problems come back as findings."""
    findings = _validate_suite_name(name)
    member_ids, member_findings = _resolve_tests(tests)
    findings.extend(member_findings)
    findings.extend(_untyped_variable_findings(variables))
    if findings:
        return {"created": False, "findings": findings}

    payload: dict[str, Any] = {"name": name}
    if description is not None:
        payload["description"] = description
    if tests is not None:
        payload["tests"] = member_ids
    if tags is not None:
        payload["tags"] = tags
    if variables is not None:
        payload["variables"] = variables
    try:
        suite = suite_service.create_suite(payload)
    except (ValidationException, ConflictException) as exc:
        return {"created": False, "findings": [_suite_refusal_finding(exc)]}
    return {
        "created": True,
        "suite_id": suite["id"],
        "name": suite["name"],
        "version": suite["version"],
        "action_items": _no_value_variable_items(variables),
    }


def _suite_refusal_finding(exc: ValidationException | ConflictException) -> dict[str, Any]:
    """A taken name keeps its own code; any other refusal is a validation finding."""
    if isinstance(exc, ConflictException) and not (exc.details and "collisions" in exc.details):
        return _finding("NAME_CONFLICT", exc.message)
    return _service_finding(exc)


def _member_change_findings(
    current: list[Any],
    add_ids: list[str],
    remove: list[str] | None,
    remove_ids: list[str],
    label: str,
) -> list[dict[str, Any]]:
    removals = list(zip(remove or [], remove_ids, strict=True))
    return [
        *_contradiction_findings(add_ids, removals, label),
        *_removal_findings(current, removals, label),
    ]


def _scalar_payload(
    name: str | None, description: str | None, tags: list[str] | None
) -> dict[str, Any]:
    """The metadata fields an update actually submitted; omitted stays untouched."""
    fields = (("name", name), ("description", description), ("tags", tags))
    return {key: value for key, value in fields if value is not None}


def _unchanged(entity: dict[str, Any], payload: dict[str, Any]) -> bool:
    """A call that changes nothing must not mint a new version."""
    return all(entity.get(key) == value for key, value in payload.items())


def update_suite(
    suite_ref: str,
    name: str | None = None,
    description: str | None = None,
    add_tests: list[str] | None = None,
    remove_tests: list[str] | None = None,
    set_variables: dict[str, Any] | None = None,
    remove_variables: list[str] | None = None,
    tags: list[str] | None = None,
) -> dict[str, Any]:
    """Non-destructively update a suite; omitted fields stay as they are."""
    suite = resolve_suite(suite_ref)
    suite_id = str(suite["id"])

    findings: list[dict[str, Any]] = []
    if name is not None:
        findings.extend(_validate_suite_name(name))
    add_ids, member_findings = _resolve_tests(add_tests)
    findings.extend(member_findings)
    current_tests = suite.get("tests") or []
    remove_ids = _removal_ids(current_tests, remove_tests, resolve_test)
    findings.extend(
        _member_change_findings(current_tests, add_ids, remove_tests, remove_ids, "test")
    )
    findings.extend(_variable_removal_findings(suite.get("variables") or {}, remove_variables))
    findings.extend(_untyped_variable_findings(set_variables))
    if findings:
        return {"updated": False, "findings": findings}

    payload: dict[str, Any] = _scalar_payload(name, description, tags)
    if add_tests is not None or remove_tests is not None:
        payload["tests"] = _merge_members(current_tests, add_ids, remove_ids)
    if set_variables is not None or remove_variables is not None:
        payload["variables"] = _merge_variables(
            suite.get("variables") or {}, set_variables, remove_variables
        )
    if _unchanged(suite, payload):
        return {
            "updated": True,
            "suite_id": suite_id,
            "name": suite.get("name"),
            "version": suite.get("version"),
            "action_items": _no_value_variable_items(set_variables),
        }
    try:
        updated = suite_service.update_suite(suite_id, payload)
    except (ValidationException, ConflictException) as exc:
        return {"updated": False, "findings": [_suite_refusal_finding(exc)]}
    result = updated or suite
    return {
        "updated": True,
        "suite_id": suite_id,
        "name": result.get("name"),
        "version": result.get("version"),
        "action_items": _no_value_variable_items(set_variables),
    }


# ---------------------------------------------------------------------------
# Regressions
# ---------------------------------------------------------------------------


def create_regression(
    name: str = "",
    description: str | None = None,
    suites: list[str] | None = None,
    tags: list[str] | None = None,
    variables: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create a regression; the service validates name, suites, and uniqueness."""
    member_ids, findings = _resolve_suites(suites)
    findings.extend(_untyped_variable_findings(variables))
    if findings:
        return {"created": False, "findings": findings}
    payload: dict[str, Any] = {"name": name}
    if description is not None:
        payload["description"] = description
    if suites is not None:
        payload["suites"] = member_ids
    if tags is not None:
        payload["tags"] = tags
    if variables is not None:
        payload["variables"] = variables
    try:
        regression = regression_service.create_regression(payload)
    except (ValidationException, ConflictException) as exc:
        return {"created": False, "findings": [_service_finding(exc)]}
    return {
        "created": True,
        "regression_id": regression["id"],
        "name": regression["name"],
        "version": regression["version"],
        "action_items": _no_value_variable_items(variables),
    }


def update_regression(
    regression_ref: str,
    name: str | None = None,
    description: str | None = None,
    add_suites: list[str] | None = None,
    remove_suites: list[str] | None = None,
    set_variables: dict[str, Any] | None = None,
    remove_variables: list[str] | None = None,
    tags: list[str] | None = None,
) -> dict[str, Any]:
    """Non-destructively update a regression; attached suites are existence-checked."""
    regression = resolve_regression(regression_ref)
    regression_id = str(regression["id"])

    add_ids, findings = _resolve_suites(add_suites)
    current_suites = regression.get("suites") or []
    remove_ids = _removal_ids(current_suites, remove_suites, resolve_suite)
    findings.extend(
        _member_change_findings(current_suites, add_ids, remove_suites, remove_ids, "suite")
    )
    findings.extend(_variable_removal_findings(regression.get("variables") or {}, remove_variables))
    findings.extend(_untyped_variable_findings(set_variables))
    if findings:
        return {"updated": False, "findings": findings}

    payload: dict[str, Any] = _scalar_payload(name, description, tags)
    if add_suites is not None or remove_suites is not None:
        payload["suites"] = _merge_members(current_suites, add_ids, remove_ids)
    if set_variables is not None or remove_variables is not None:
        payload["variables"] = _merge_variables(
            regression.get("variables") or {}, set_variables, remove_variables
        )
    if _unchanged(regression, payload):
        return {
            "updated": True,
            "regression_id": regression_id,
            "name": regression.get("name"),
            "version": regression.get("version"),
            "action_items": _no_value_variable_items(set_variables),
        }
    try:
        updated = regression_service.update_regression(regression_id, payload)
    except (ValidationException, ConflictException) as exc:
        return {"updated": False, "findings": [_service_finding(exc)]}
    result = updated or regression
    return {
        "updated": True,
        "regression_id": regression_id,
        "name": result.get("name"),
        "version": result.get("version"),
        "action_items": _no_value_variable_items(set_variables),
    }


# ---------------------------------------------------------------------------
# Profiles
# ---------------------------------------------------------------------------


def _no_value_secret_items(
    profile_type: str,
    config: dict[str, Any] | None,
    environment_values: dict[str, dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """Manual action items for secrets holding no value (from raw input)."""
    fields = secret_field_names(profile_type)
    owed = owed_fields(config, fields, prefix="config")
    for env, env_config in (environment_values or {}).items():
        prefix = f"environment_values.{env}"
        owed.extend(owed_fields(env_config, fields, prefix=prefix, environment=env))
    return owed_action_items(owed)


def _unknown_environment_findings(
    environment_values: dict[str, dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """Credentials keyed to an environment that does not exist are unreachable,
    and would still count toward the profile's coverage."""
    if not environment_values:
        return []
    from wavecore.api.services.environments import service as environment_service

    rows = environment_service.list_environments(per_page=_LIST_ALL)["environments"]
    known = {str(env["id"]) for env in rows}
    return [
        _finding(
            "UNKNOWN_ENVIRONMENT",
            f"Environment '{env_id}' not found",
            "Use the list_environments tool for available environments",
        )
        for env_id in environment_values
        if str(env_id) not in known
    ]


def create_profile(
    name: str | None = None,
    profile_type: str | None = None,
    config: dict[str, Any] | None = None,
    description: str | None = None,
    tags: list[str] | None = None,
    environment_values: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Create a profile; missing name/type and invalid type come back as findings."""
    if not name:
        return {
            "created": False,
            "findings": [_finding("NAME_REQUIRED", "Field 'name' is required")],
        }
    if not profile_type:
        return {
            "created": False,
            "findings": [_finding("TYPE_REQUIRED", "Field 'profile_type' is required")],
        }
    env_findings = _unknown_environment_findings(environment_values)
    if env_findings:
        return {"created": False, "findings": env_findings}
    try:
        profile = profile_service.create_profile(
            name=name,
            profile_type=profile_type,
            config=config or {},
            description=description,
            tags=tags,
            environment_values=environment_values,
        )
    except (ValidationException, ConflictException) as exc:
        return {"created": False, "findings": [_service_finding(exc)]}
    return {
        "created": True,
        "profile_id": profile["id"],
        "name": profile["name"],
        "action_items": _no_value_secret_items(profile_type, config, environment_values),
    }


def update_profile(
    profile_ref: str,
    name: str | None = None,
    config: dict[str, Any] | None = None,
    description: str | None = None,
    tags: list[str] | None = None,
    environment_values: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Update a profile; an in-use structural change comes back as a finding."""
    profile = _resolve_profile(profile_ref)
    profile_id = str(profile["id"])
    env_findings = _unknown_environment_findings(environment_values)
    if env_findings:
        return {"updated": False, "findings": env_findings}
    # This surface promises non-destructive updates; the service replaces the whole
    # map, so an omitted environment would lose its stored credentials.
    merged_environment_values = (
        {**(profile.get("environment_values") or {}), **environment_values}
        if environment_values is not None
        else None
    )
    try:
        updated = profile_service.update_profile(
            profile_id,
            name=name,
            config=config,
            description=description,
            tags=tags,
            environment_values=merged_environment_values,
        )
    except (ValidationException, ConflictException) as exc:
        return {"updated": False, "findings": [_service_finding(exc)]}
    result = updated or profile
    return {
        "updated": True,
        "profile_id": profile_id,
        "name": result.get("name"),
        "action_items": _no_value_secret_items(
            str(result.get("type") or ""), config, environment_values
        ),
    }


# ---------------------------------------------------------------------------
# System / global variables
# ---------------------------------------------------------------------------


def update_variables(
    scope: str,
    set: dict[str, Any] | None = None,  # noqa: A002 - the tool's public parameter name
    remove: list[str] | None = None,
) -> dict[str, Any]:
    """Non-destructively merge/remove system (or global-aliased) variables."""
    if scope not in ("system", "global"):
        raise ValidationException("Scope must be 'system' or 'global'")

    missing = [
        _finding("VARIABLE_NOT_FOUND", f"Variable '{name}' is not declared in the {scope} scope")
        for name in remove or []
        if name not in variable_service.get_system_variables()["variables"]
    ]
    missing.extend(_untyped_variable_findings(set))
    if missing:
        return {"updated": False, "findings": missing}

    names: list[str] = []
    if set:
        result = variable_service.update_entity_variables(
            "system", variable_service.SYSTEM_ENTITY_ID, set
        )
        if result is None:
            variable_service.set_entity_variables("system", variable_service.SYSTEM_ENTITY_ID, set)
        names.extend(set.keys())
    for name in remove or []:
        # names records what actually changed, never a removal that did not happen.
        if variable_service.delete_system_variable(name):
            names.append(name)
    return {
        "updated": True,
        "scope": scope,
        "names": names,
        "action_items": _no_value_variable_items(set),
    }
