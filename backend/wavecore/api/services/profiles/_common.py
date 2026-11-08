"""Shared state, constants, and helpers for the profile service."""

import copy
import logging
import shutil
from collections.abc import Mapping
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, TypeGuard

import yaml

from wavecore.api.exceptions import (
    ValidationException,
)
from wavecore.api.services.entity_cache import DirectoryCache
from wavecore.api.services.shared import export_file_stem, first_free_name
from wavecore.api.services.storage_paths import entity_dir, get_profiles_storage_path
from wavecore.core.execution.field_checks import type_name
from wavecore.core.number_rule import (
    MAX_FLOAT_SIG_DIGITS,
    MAX_INTEGER_DIGITS,
    NumberType,
    float_significant_digits,
    integer_digit_count,
    is_integer_value,
    number_problem,
    parse_number,
    wire_number,
)
from wavecore.core.secrets import masking_settings
from wavecore.core.secrets.cipher import is_secret_envelope
from wavecore.core.secrets.masking import MASK_PLACEHOLDER, masked_declaration, structural_mask
from wavecore.core.secrets.sealing import seal_profile, unseal_all
from wavecore.core.variables.element_types import element_types_problem

logger = logging.getLogger(__name__)

_PROFILE_FILENAME = "profile.yaml"


# Valid profile types as defined in OpenAPI spec
VALID_PROFILE_TYPES = [
    "database",
    "ssh",
    "http",
    "kubernetes",
    "opensearch",
    "custom",
]

# Profile type descriptions
PROFILE_TYPE_DESCRIPTIONS = {
    "database": (
        "Relational database connections with host, port, database name, and authentication"
    ),
    "ssh": "Remote shell access with host, port, username, and key or password authentication",
    "http": (
        "Base URLs with default headers, credentials, TLS trust and client identity, "
        "and timeout configuration"
    ),
    "kubernetes": "Cluster access with a service account token or client certificate",
    "opensearch": (
        "Search cluster connections with a cluster URL, credentials and TLS trust material"
    ),
    "custom": "Extensible type for systems not covered by predefined types",
}

# Secret field names that should be masked in responses
SECRET_FIELDS = {"password", "api_key", "bearer_token", "private_key", "token", "client_key"}

# Type schemas for validation
TYPE_SCHEMAS: dict[str, dict[str, Any]] = {
    "database": {
        "type": "object",
        "properties": {
            "host": {"type": "string", "plain": True},
            "port": {"type": "integer", "minimum": 1, "maximum": 65535},
            "database": {"type": "string"},
            "username": {"type": "string"},
            "password": {"type": "string", "secret": True},
            "verify_ssl": {"type": "boolean", "default": True},
            "ca_cert": {"type": "string", "plain": True},
            "client_cert": {"type": "string", "plain": True},
            "client_key": {"type": "string", "secret": True},
            "driver_options": {"type": "object", "default": {}},
        },
    },
    "ssh": {
        "type": "object",
        "properties": {
            "host": {"type": "string", "plain": True},
            "port": {"type": "integer", "default": 22},
            "username": {"type": "string"},
            "password": {"type": "string", "secret": True},
            "private_key": {"type": "string", "secret": True},
            "passphrase": {"type": "string", "secret": True},
            "connect_timeout": {"type": "integer", "default": 30},
        },
    },
    "http": {
        "type": "object",
        "properties": {
            "base_url": {"type": "string", "plain": True},
            "headers": {"type": "object"},
            "auth_username": {"type": "string"},
            "auth_password": {"type": "string", "secret": True},
            "auth_token": {"type": "string", "secret": True},
            "auth_key": {"type": "string", "secret": True},
            "auth_header_name": {"type": "string", "default": "X-API-Key"},
            "verify_ssl": {"type": "boolean", "default": True},
            "ca_cert": {"type": "string", "plain": True},
            "client_cert": {"type": "string", "plain": True},
            "client_key": {"type": "string", "secret": True},
            "timeout": {"type": "integer", "default": 30},
        },
    },
    "kubernetes": {
        "type": "object",
        "properties": {
            "api_url": {"type": "string", "plain": True},
            "token": {"type": "string", "secret": True},
            "client_cert": {"type": "string", "plain": True},
            "client_key": {"type": "string", "secret": True},
            "ca_cert": {"type": "string", "plain": True},
            "verify_ssl": {"type": "boolean", "default": True},
            "tls_server_name": {"type": "string", "plain": True},
            "namespace": {"type": "string", "default": "default"},
        },
    },
    "opensearch": {
        "type": "object",
        "properties": {
            "url": {"type": "string", "plain": True},
            "username": {"type": "string"},
            "password": {"type": "string", "secret": True},
            "api_key": {"type": "string", "secret": True},
            "bearer_token": {"type": "string", "secret": True},
            "verify_ssl": {"type": "boolean", "default": True},
            "ca_cert": {"type": "string", "plain": True},
            "client_cert": {"type": "string", "plain": True},
            "client_key": {"type": "string", "secret": True},
        },
    },
    "custom": {
        "type": "object",
        "properties": {},
        "additionalProperties": True,
    },
}

# In-memory cache for profiles. The storage directory is the record; this cache
# is reconciled against it on every listing.
_profile_storage: dict[str, dict[str, Any]] = {}
_cache_loaded: bool = False

_profile_directory = DirectoryCache(
    label="profile",
    filename=_PROFILE_FILENAME,
    storage_dir=get_profiles_storage_path,
    cache=lambda: _profile_storage,
    logger=logger,
)


def secret_field_names(profile_type: str) -> set[str]:
    """The flat fields a profile of this type holds as credentials."""
    properties = TYPE_SCHEMAS.get(profile_type, {}).get("properties", {})
    return SECRET_FIELDS | {field for field, schema in properties.items() if schema.get("secret")}


# ---------------------------------------------------------------------------
# File I/O
# ---------------------------------------------------------------------------


def _ensure_storage_dir() -> None:
    """Ensure storage directory exists."""
    get_profiles_storage_path().mkdir(parents=True, exist_ok=True)


def _get_profile_dir(profile_id: str) -> Path:
    """Get directory path for a profile."""
    return entity_dir(get_profiles_storage_path(), profile_id)


def _save_profile(profile: dict[str, Any]) -> None:
    """Save profile to file storage; credential fields seal at this boundary."""
    _ensure_storage_dir()
    profile_type = profile.get("type", "")
    if "config" in profile:
        profile["config"] = seal_profile(profile["config"], profile_type)
    if "environment_values" in profile:
        profile["environment_values"] = {
            env_id: seal_profile(env_config, profile_type)
            for env_id, env_config in profile["environment_values"].items()
        }
    profile_dir = _get_profile_dir(profile["id"])
    profile_dir.mkdir(parents=True, exist_ok=True)
    profile_file = profile_dir / _PROFILE_FILENAME
    with open(profile_file, "w", encoding="utf-8") as f:
        yaml.dump(profile, f, default_flow_style=False, sort_keys=False)


def _delete_profile_files(profile_id: str) -> None:
    """Delete all files for a profile."""
    profile_dir = _get_profile_dir(profile_id)
    if profile_dir.exists():
        shutil.rmtree(profile_dir)


def _reconcile_cache() -> None:
    """Sync the in-memory cache with the storage directory, which is the record."""
    global _cache_loaded
    _profile_directory.reconcile()
    _cache_loaded = True


def _ensure_cache_loaded() -> None:
    """Ensure in-memory cache is loaded from disk.

    Every read goes through here, including one per block during a live run, so
    it must not scan the directory once the cache is warm.
    """
    if not _cache_loaded:
        _reconcile_cache()


def _cached_profile(profile_id: str) -> dict[str, Any] | None:
    """The cached profile, or None once its file is gone (dropping the entry)."""
    _ensure_cache_loaded()
    profile = _profile_storage.get(profile_id)
    if profile is None:
        return None
    if not _profile_directory.exists(profile_id):
        _profile_directory.forget(profile_id)
        return None
    return profile


def _clear_in_memory_cache() -> None:
    """Clear in-memory cache without touching disk storage."""
    global _cache_loaded
    _profile_directory.clear()
    _cache_loaded = False


def _clear_storage() -> None:
    """Clear all profiles from storage. Test utility."""
    global _cache_loaded
    _profile_directory.clear()
    _cache_loaded = True
    storage_dir = get_profiles_storage_path()
    if storage_dir.exists():
        shutil.rmtree(storage_dir)
    storage_dir.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# Validation / masking / type helpers
# ---------------------------------------------------------------------------


def _is_typed_value(value: Any) -> bool:
    """Check if a value is a typed parameter value object."""
    return (
        isinstance(value, dict)
        and "type" in value
        and "value" in value
        and isinstance(value.get("type"), str)
    )


def _is_typed_secret(value: Any) -> TypeGuard[dict[str, Any]]:
    """A typed declaration flagged secret; its `value` key is absent until it is filled."""
    return (
        isinstance(value, dict) and isinstance(value.get("type"), str) and bool(value.get("secret"))
    )


def _is_typed_entry(value: Any) -> bool:
    """A typed value, or a typed secret declared without a value yet."""
    return _is_typed_value(value) or _is_typed_secret(value)


def _masked_field(field: str, value: Any) -> Any:
    """The masked form of one config field, or the value unchanged."""
    if _is_typed_secret(value):
        return masked_declaration(value)
    if _is_typed_entry(value):
        return value
    if field in SECRET_FIELDS:
        return structural_mask(value)
    return value


def _mask_secrets(config: dict[str, Any], profile_type: str) -> dict[str, Any]:
    """Mask secret fields in configuration."""
    result = copy.deepcopy(config)
    for field, value in result.items():
        result[field] = _masked_field(field, value)

    properties = TYPE_SCHEMAS.get(profile_type, {}).get("properties", {})
    for field, field_schema in properties.items():
        if not field_schema.get("secret") or field not in result:
            continue
        if not _is_typed_entry(result[field]):
            result[field] = structural_mask(result[field])

    return result


_NUMBER_TYPES: dict[Any, NumberType] = {"integer": "integer", "float": "float"}


def _refused(field: str, problem: str) -> ValidationException:
    return ValidationException(f"Configuration validation failed at 'config.{field}': {problem}")


def _not_checked(value: Any) -> bool:
    """Null, a sealed credential and the mask are not written numbers."""
    return value is None or is_secret_envelope(value) or value == MASK_PLACEHOLDER


def _bound_problem(number: int | Decimal, schema: Mapping[str, Any]) -> str | None:
    """The declared bound a number breaks, compared exactly."""
    low, high = schema.get("minimum"), schema.get("maximum")
    if (low is None or number >= low) and (high is None or number <= high):
        return None
    if low is not None and high is not None:
        return f"must be between {low} and {high}"
    return f"must be at least {low}" if low is not None else f"must be at most {high}"


def _number_problem(value: Any, declared: NumberType, schema: Mapping[str, Any]) -> str | None:
    """Why a written number breaks the one number rule or its declared bounds."""
    problem = number_problem(value, declared)
    if problem == "type":
        return f"expected {declared}, got {type_name(value)}"
    if problem == "integer-cap":
        return f"expected at most {MAX_INTEGER_DIGITS} digits, got {integer_digit_count(value)}"
    if problem == "float-cap":
        return (
            f"expected at most {MAX_FLOAT_SIG_DIGITS} significant digits, "
            f"got {float_significant_digits(value)}"
        )
    return _bound_problem(parse_number(value, declared), schema)


def _validate_field_type(field: str, value: Any, schema: Mapping[str, Any]) -> None:
    """Validate a single config field value against its schema type and bounds."""
    expected_type = schema.get("type")
    actual_value = value.get("value") if _is_typed_value(value) else value
    number_type = _NUMBER_TYPES.get(expected_type)

    if number_type is not None:
        if _not_checked(actual_value):
            return
        problem = _number_problem(actual_value, number_type, schema)
        if problem is not None:
            raise _refused(field, problem)
    elif expected_type == "string" and not isinstance(actual_value, str):
        if _is_typed_value(value):
            return
        raise _refused(field, f"expected string, got {type(actual_value).__name__}")


def _element_entries(value: Any, element_types: Any) -> list[tuple[str, Any, Any]]:
    """Each element of a typed map / array with where it sits and its declared type."""
    if isinstance(value, dict) and isinstance(element_types, dict):
        return [(f"key '{key}'", item, element_types.get(key)) for key, item in value.items()]
    if isinstance(value, list) and isinstance(element_types, list):
        return [
            (f"item {index}", item, element_types[index] if index < len(element_types) else None)
            for index, item in enumerate(value)
        ]
    return []


def _typed_value_problem(value: dict[str, Any]) -> str | None:
    """Why a typed value's number, or a number element, breaks the one number rule."""
    declared, written = _NUMBER_TYPES.get(value["type"]), value.get("value")
    if _not_checked(written):
        return None
    if declared is not None:
        # An empty number in an environment is not provided.
        return None if written == "" else _number_problem(written, declared, {})
    for where, item, item_type in _element_entries(written, value.get("elementTypes")):
        element_type = _NUMBER_TYPES.get(item_type)
        if element_type is not None and not _not_checked(item):
            problem = _number_problem(item, element_type, {})
            if problem is not None:
                return f"{where} {problem}"
    return None


def _validate_typed_values(config: dict[str, Any]) -> None:
    """Reject a typed value whose number, or number element, is not one (REQ-3.1.3.14)."""
    for field, value in config.items():
        if not _is_typed_value(value):
            continue
        problem = _typed_value_problem(value)
        if problem is not None:
            raise _refused(field, problem)


def _stored_number(value: Any) -> Any:
    """A number as a profile stores it: its wire form; text stays as written."""
    if isinstance(value, float | Decimal) or is_integer_value(value):
        return wire_number(value)
    return value


def _stored_typed_value(value: dict[str, Any]) -> dict[str, Any]:
    declared, written = value["type"], value.get("value")
    if declared in _NUMBER_TYPES:
        return {**value, "value": _stored_number(written)}
    if isinstance(written, dict):
        return {**value, "value": {key: _stored_number(item) for key, item in written.items()}}
    if isinstance(written, list):
        return {**value, "value": [_stored_number(item) for item in written]}
    return value


def stored_config(config: dict[str, Any], profile_type: str) -> dict[str, Any]:
    """A checked config as stored: every number in its wire form (REQ-3.1.3.14)."""
    properties = TYPE_SCHEMAS.get(profile_type, {}).get("properties", {})
    stored: dict[str, Any] = {}
    for field, value in config.items():
        if _is_typed_value(value):
            stored[field] = _stored_typed_value(value)
        elif properties.get(field, {}).get("type") in _NUMBER_TYPES:
            stored[field] = _stored_number(value)
        else:
            stored[field] = value
    return stored


# WAVE parameter types valid in a custom profile's typed-value wrappers.
_VALID_WAVE_PARAM_TYPES: frozenset[str] = frozenset(
    {"string", "integer", "float", "boolean", "array", "map", "table"}
)


def _validate_custom_param_types(config: dict[str, Any]) -> None:
    """Reject custom-profile typed values whose declared type is not a WAVE type."""
    for field, value in config.items():
        if not _is_typed_value(value):
            continue
        declared = value.get("type")
        if declared not in _VALID_WAVE_PARAM_TYPES:
            raise ValidationException(
                f"Configuration validation failed at 'config.{field}': "
                f"unknown type '{declared}'"
            )


def _validate_element_types(config: dict[str, Any]) -> None:
    """Reject a typed value whose element-type sidecar does not fit it (REQ-3.1.3.19)."""
    for field, value in config.items():
        if not _is_typed_value(value):
            continue
        problem = element_types_problem(value["type"], value.get("elementTypes"))
        if problem is not None:
            raise ValidationException(
                f"Configuration validation failed at 'config.{field}': {problem}"
            )


def _validate_config(config: dict[str, Any], profile_type: str) -> None:
    """Validate configuration against type schema."""
    _validate_element_types(config)
    _validate_typed_values(config)
    if profile_type == "custom":
        _validate_custom_param_types(config)
        return

    schema = _get_type_schema_internal(profile_type)
    if not schema:
        return

    for field in schema.get("required", []):
        if field not in config:
            raise ValidationException(
                f"Configuration validation failed: '{field}' is a required field"
            )

    properties = schema.get("properties", {})
    for field, value in config.items():
        if field not in properties:
            continue
        _validate_field_type(field, value, properties[field])


def document_problem(document: Mapping[str, Any], profile_type: str) -> str | None:
    """Why a save refuses a whole profile document's values, or None when it takes them."""
    environments = document.get("environment_values")
    held = environments.values() if isinstance(environments, dict) else ()
    for config in (document.get("config"), *held):
        if not isinstance(config, dict):
            continue
        try:
            _validate_config(config, profile_type)
        except ValidationException as error:
            return error.message
    return None


def stored_document(document: dict[str, Any], profile_type: str) -> dict[str, Any]:
    """A checked profile document with every number of every config in its wire form."""
    stored = dict(document)
    if isinstance(document.get("config"), dict):
        stored["config"] = stored_config(document["config"], profile_type)
    environments = document.get("environment_values")
    if isinstance(environments, dict):
        stored["environment_values"] = {
            env_id: stored_config(values, profile_type) if isinstance(values, dict) else values
            for env_id, values in environments.items()
        }
    return stored


def _get_type_schema_internal(profile_type: str) -> dict[str, Any] | None:
    """Get internal schema for a profile type."""
    return TYPE_SCHEMAS.get(profile_type)


def _node_binding_pids(node: Any) -> set[str]:
    """Extract profile ids from a workflow node's profileBindings list."""
    pids: set[str] = set()
    if not isinstance(node, dict):
        return pids
    cfg = (node.get("data") or {}).get("config") or {}
    for binding in cfg.get("profileBindings") or []:
        if isinstance(binding, dict):
            pid = binding.get("profileId")
            if pid:
                pids.add(pid)
    return pids


def _profiles_used_by_test(test: dict[str, Any]) -> set[str]:
    """Return the set of profile ids referenced by this test, deduplicated.

    Reads the precomputed `_profile_refs` field that the test service stores
    on every cached test view (covering both `metadata.profile_id` and any
    element-level `profileBindings` inside node configs). Falls back to
    scanning the full workflow for callers that bypass the view extractor.
    """
    refs = test.get("_profile_refs")
    if isinstance(refs, list):
        return set(refs)
    pids: set[str] = set()
    meta_pid = test.get("metadata", {}).get("profile_id")
    if meta_pid:
        pids.add(meta_pid)
    nodes = (test.get("workflow") or {}).get("nodes") or test.get("nodes") or []
    for node in nodes:
        pids.update(_node_binding_pids(node))
    return pids


def _get_profile_references(profile_id: str) -> list[str]:
    """Get list of entities referencing this profile."""
    from wavecore.api.services.tests import service as test_service

    references: list[str] = []
    for test in test_service._cached_tests():
        if profile_id in _profiles_used_by_test(test):
            name = test.get("name") or test.get("id") or "unknown"
            references.append(name)
    return references


def _now_iso() -> str:
    """Get current timestamp in ISO format."""
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _generate_etag(profile: dict[str, Any]) -> str:
    """Generate ETag for a profile."""
    import hashlib

    content = f"{profile.get('id')}{profile.get('updated_at')}"
    return f'"{hashlib.sha256(content.encode()).hexdigest()}"'


_EMPTY_SENTINELS: tuple[None, str, dict[str, list[Any]], list[Any], dict[str, list[Any]]] = (
    None,
    "",
    {},
    [],
    {"headers": [], "rows": []},
)


def _is_empty_value(value: Any) -> bool:
    """Check if a value is considered empty."""
    if value is None:
        return True
    if _is_typed_value(value):
        return value.get("value") in _EMPTY_SENTINELS
    return value in ("", {}, [])


def _mask_environment_values(
    environment_values: dict[str, dict[str, Any]], profile_type: str
) -> dict[str, dict[str, Any]]:
    """Mask secrets in all environment value configs."""
    return {
        env_id: _mask_secrets(env_config, profile_type)
        for env_id, env_config in environment_values.items()
    }


def _get_total_environments_count() -> int:
    """Get the total number of environments configured in the system."""
    from wavecore.api.services.environments import service as environment_service

    return len(environment_service._environments)


def _count_environments_with_values(environment_values: dict[str, dict[str, Any]]) -> int:
    """Count environments that have at least one non-empty value configured."""
    count = 0
    for env_config in environment_values.values():
        has_value = any(not _is_empty_value(value) for value in env_config.values())
        if has_value:
            count += 1
    return count


def _add_computed_environment_fields(
    result: dict[str, Any],
    raw_environment_values: dict[str, dict[str, Any]],
    total_envs: int | None = None,
) -> None:
    """Add computed environment fields to a profile response dict (in-place)."""
    if total_envs is None:
        total_envs = _get_total_environments_count()
    envs_with_values = _count_environments_with_values(raw_environment_values)
    result["environments_count"] = envs_with_values
    result["total_environments"] = total_envs
    result["has_incomplete_environments"] = total_envs > 0 and envs_with_values < total_envs


def _prepare_profile_response(
    profile: dict[str, Any],
    *,
    usage: int | None = None,
    total_envs: int | None = None,
    raw_environment_values: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Prepare a profile dict for API response."""
    result = copy.deepcopy(profile)
    profile_type = result["type"]

    # The global / regression / suite variable unmask reveals profile credentials too
    # (REQ-3.1.3.17): when on, the sealed fields are unsealed to plaintext for display;
    # otherwise masked. Encryption at rest is unaffected either way.
    if masking_settings.is_shared_variables_revealed():
        result["config"] = unseal_all(result.get("config", {}))
        result["environment_values"] = unseal_all(result.get("environment_values", {}))
    else:
        result["config"] = _mask_secrets(result.get("config", {}), profile_type)
        result["environment_values"] = _mask_environment_values(
            result.get("environment_values", {}), profile_type
        )

    if "tags" not in result:
        result["tags"] = []

    if usage is not None:
        result["usage"] = usage
    else:
        result["usage"] = get_profile_usage(result["id"])

    if raw_environment_values is None:
        raw_environment_values = profile.get("environment_values", {})
    _add_computed_environment_fields(result, raw_environment_values, total_envs)

    return result


def get_profile_usage(profile_id: str) -> int:
    """Get usage count for a profile."""
    references = _get_profile_references(profile_id)
    return len(references)


def compute_all_profile_usage() -> dict[str, int]:
    """Count profile references across all tests in a single pass.

    Returns a dict mapping profile_id -> usage count. Used by list_profiles
    to avoid N separate scans of the test cache. Counts both metadata
    profile_id (test-level binding) and element-level profileBindings.
    """
    from wavecore.api.services.tests import service as test_service

    counts: dict[str, int] = {}
    for test in test_service._cached_tests():
        for pid in _profiles_used_by_test(test):
            counts[pid] = counts.get(pid, 0) + 1
    return counts


# ---------------------------------------------------------------------------
# Filtering, sorting, pagination
# ---------------------------------------------------------------------------


def _matches_filters(
    profile: dict[str, Any],
    search: str | None,
    profile_type: str | None,
    tags: list[str] | None,
) -> bool:
    """Check whether a profile matches all specified filters."""
    if search and search.lower() not in profile["name"].lower():
        return False
    if profile_type and profile["type"] != profile_type:
        return False
    if tags:
        profile_tags = profile.get("tags", [])
        if not any(tag in tags for tag in profile_tags):
            return False
    return True


def _filter_profiles(
    search: str | None,
    profile_type: str | None,
    tags: list[str] | None,
) -> list[dict[str, Any]]:
    """Return profiles matching all specified filters."""
    return [p for p in _profile_storage.values() if _matches_filters(p, search, profile_type, tags)]


_SORT_KEY_GETTERS: dict[str, Any] = {
    "name": lambda p: p["name"].lower(),
    "type": lambda p: p["type"].lower(),
    "tags": lambda p: ",".join(sorted(p.get("tags", []))).lower(),
    "environments": lambda p: p.get("environments_count", 0),
    "usage": lambda p: p.get("usage", 0),
}


def _sort_profiles(
    profiles: list[dict[str, Any]],
    sort_by: str | None,
    sort_order: str | None,
) -> None:
    """Sort a list of profiles in-place."""
    key_fn = _SORT_KEY_GETTERS.get(sort_by or "name", _SORT_KEY_GETTERS["name"])
    reverse = sort_order == "desc" if sort_by else False
    profiles.sort(key=key_fn, reverse=reverse)


def _paginate(
    items: list[dict[str, Any]],
    page: int | None,
    per_page: int | None,
) -> dict[str, Any]:
    """Paginate a list of items and return pagination envelope."""
    actual_page = page if page is not None else 1
    actual_per_page = per_page if per_page is not None else 20
    total = len(items)
    total_pages = (total + actual_per_page - 1) // actual_per_page if total > 0 else 1
    start = (actual_page - 1) * actual_per_page
    page_items = items[start : start + actual_per_page]
    return {
        "profiles": page_items,
        "total": total,
        "page": actual_page,
        "per_page": actual_per_page,
        "total_pages": total_pages,
    }


def _sanitize_filename(name: str) -> str:
    """Sanitize a name for use as a filename."""
    return export_file_stem(name, "profile")


def _generate_unique_name(base_name: str) -> str:
    """Generate a unique name by appending (2), (3), etc."""
    _reconcile_cache()
    return first_free_name(base_name, {p["name"] for p in _profile_storage.values()})


# Map JSON Schema type strings to WAVE type strings (design decisions PROFILE-37)
_JSON_SCHEMA_TO_WAVE_TYPE: dict[str, str] = {
    "integer": "integer",
    "number": "float",
    "boolean": "boolean",
    "object": "map",
    "string": "string",
}


def _map_json_schema_type(prop_type: str | None, prop_schema: dict[str, Any]) -> str:
    """Map a JSON Schema type to a WAVE type string."""
    if prop_type == "array":
        items_schema = prop_schema.get("items", {})
        return "table" if items_schema.get("type") == "array" else "array"
    return _JSON_SCHEMA_TO_WAVE_TYPE.get(prop_type or "", "string")
