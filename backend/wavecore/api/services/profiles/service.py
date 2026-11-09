"""Profile service layer for connection profile business logic (REQ-5.2.4.8).

This module provides the service layer for connection profile operations.
It acts as an intermediary between API routes and the storage layer,
providing profile CRUD operations, type discovery, and schema retrieval.
"""

import copy
import uuid
from collections.abc import Mapping
from typing import Any

from wavecore.api.exceptions import ConflictException, ValidationException
from wavecore.api.services.profiles import _common as _profile_common
from wavecore.api.services.profiles._common import (
    PROFILE_TYPE_DESCRIPTIONS,
    TYPE_SCHEMAS,
    VALID_PROFILE_TYPES,
    _cached_profile,
    _delete_profile_files,
    _filter_profiles,
    _generate_etag,
    _get_profile_references,
    _get_total_environments_count,
    _is_typed_value,
    _map_json_schema_type,
    _now_iso,
    _paginate,
    _prepare_profile_response,
    _reconcile_cache,
    _save_profile,
    _sort_profiles,
    _validate_config,
    compute_all_profile_usage,
    get_profile_usage,
    stored_config,
)
from wavecore.api.services.shared import restore_masked_secrets
from wavecore.core.secrets.cipher import is_secret_envelope
from wavecore.core.secrets.sealing import unseal_all
from wavecore.core.variables.element_types import realize_declared_value


def profile_field_names(profile_like: Mapping[str, Any]) -> set[str]:
    """Every field a bound profile can give a run: its config and each environment's values."""
    keys: set[str] = set(profile_like.get("config", {}).keys())
    for env_cfg in profile_like.get("environment_values", {}).values():
        if isinstance(env_cfg, dict):
            keys.update(env_cfg.keys())
    return keys


def _stored_value_keys(profile_like: dict[str, Any]) -> dict[str, set[str]]:
    """Parameter names held by each storage location: the base config and every environment."""
    keys: dict[str, set[str]] = {"config": set(profile_like.get("config", {}))}
    for env_id, env_cfg in profile_like.get("environment_values", {}).items():
        if isinstance(env_cfg, dict):
            keys[f"env:{env_id}"] = set(env_cfg)
    return keys


def _wave_type_of(value: Any) -> str | None:
    """Return the declared WAVE type of a typed-value wrapper, or None."""
    if _is_typed_value(value):
        declared = value.get("type")
        return declared if isinstance(declared, str) else None
    return None


def _param_types(profile_like: dict[str, Any]) -> dict[str, str]:
    """Map parameter name to its declared WAVE type, where present.

    Looks at config first, then fills in any missing keys from environment
    values. Untyped raw values are skipped (not all profiles use the typed
    wrapper).
    """
    types: dict[str, str] = {}
    for k, v in profile_like.get("config", {}).items():
        t = _wave_type_of(v)
        if t is not None:
            types[k] = t
    for env_cfg in profile_like.get("environment_values", {}).values():
        if not isinstance(env_cfg, dict):
            continue
        for k, v in env_cfg.items():
            if k in types:
                continue
            t = _wave_type_of(v)
            if t is not None:
                types[k] = t
    return types


def _ensure_no_structural_change(
    stored: dict[str, Any],
    new_config: dict[str, Any] | None,
    new_env_values: dict[str, dict[str, Any]] | None,
    usage: int,
) -> None:
    """Reject param add/remove/rename/retype, or the loss of stored values, while in use."""
    if usage <= 0:
        return
    if new_config is None and new_env_values is None:
        return

    proposed = {
        "config": new_config if new_config is not None else stored.get("config", {}),
        "environment_values": (
            new_env_values if new_env_values is not None else stored.get("environment_values", {})
        ),
    }

    stored_keys = profile_field_names(stored)
    proposed_keys = profile_field_names(proposed)
    if stored_keys != proposed_keys:
        raise ConflictException(
            f"Cannot add, remove, or rename parameters of a profile in use by {usage} test(s)"
        )

    # The flattened set above hides a removal that another storage location still covers.
    proposed_locations = _stored_value_keys(proposed)
    for location, location_keys in _stored_value_keys(stored).items():
        if not location_keys.issubset(proposed_locations.get(location, set())):
            raise ConflictException(
                f"Cannot remove stored parameter values of a profile in use by {usage} test(s)"
            )

    stored_types = _param_types(stored)
    proposed_types = _param_types(proposed)
    for key in stored_keys:
        st = stored_types.get(key)
        pt = proposed_types.get(key)
        if st is not None and pt is not None and st != pt:
            raise ConflictException(
                f"Cannot change parameter type of a profile in use by {usage} test(s)"
            )


# ===========================================================================
# CRUD operations
# ===========================================================================


def list_profiles(
    tags: list[str] | None = None,
    search: str | None = None,
    profile_type: str | None = None,
    page: int | None = None,
    per_page: int | None = None,
    sort_by: str | None = None,
    sort_order: str | None = None,
) -> dict[str, Any]:
    """List all profiles with secrets masked, optional filtering and pagination."""
    _reconcile_cache()

    total_envs = _get_total_environments_count()
    usage_map = compute_all_profile_usage()

    filtered = _filter_profiles(search, profile_type, tags)

    result = [
        _prepare_profile_response(
            profile, total_envs=total_envs, usage=usage_map.get(profile["id"], 0)
        )
        for profile in filtered
    ]

    _sort_profiles(result, sort_by, sort_order)

    return _paginate(result, page, per_page)


def list_profile_documents() -> list[dict[str, Any]]:
    """A deep copy of every stored profile, secrets still sealed."""
    _reconcile_cache()
    return [copy.deepcopy(profile) for profile in _profile_common._profile_storage.values()]


def persist_profile_document(profile_data: dict[str, Any]) -> None:
    """Write a whole profile document as given and show it at once."""
    _save_profile(profile_data)
    _profile_common._profile_storage[profile_data["id"]] = profile_data


def _refuse_taken_name(name: str) -> None:
    """Raise when a cached profile holds this name; the caller reconciles the cache first."""
    if any(existing["name"] == name for existing in _profile_common._profile_storage.values()):
        raise ConflictException(f"Profile with name '{name}' already exists")


def create_profile(
    name: str,
    profile_type: str,
    config: dict[str, Any] | None = None,
    description: str | None = None,
    tags: list[str] | None = None,
    environment_values: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Create a new profile."""
    _reconcile_cache()

    if profile_type not in VALID_PROFILE_TYPES:
        raise ValidationException(
            f"Invalid profile type '{profile_type}': valid types are "
            f"{', '.join(VALID_PROFILE_TYPES)}"
        )

    _refuse_taken_name(name)

    env_values = environment_values if environment_values is not None else {}

    for env_config in env_values.values():
        _validate_config(env_config, profile_type)

    if config is not None and not env_values:
        _validate_config(config, profile_type)

    env_values = {
        env_id: stored_config(env_config, profile_type) for env_id, env_config in env_values.items()
    }

    profile_id = str(uuid.uuid4())
    now = _now_iso()

    profile: dict[str, Any] = {
        "id": profile_id,
        "name": name,
        "type": profile_type,
        "environment_values": copy.deepcopy(env_values),
        "tags": tags if tags is not None else [],
        "created_at": now,
        "updated_at": now,
    }

    if config is not None:
        profile["config"] = stored_config(copy.deepcopy(config), profile_type)
    else:
        profile["config"] = {}

    if description is not None:
        profile["description"] = description

    persist_profile_document(profile)

    return _prepare_profile_response(profile, usage=0, raw_environment_values=env_values)


def get_profile(profile_id: str) -> dict[str, Any] | None:
    """Get a profile by ID with secrets masked."""
    profile = _cached_profile(profile_id)
    if profile is None:
        return None

    return _prepare_profile_response(profile)


def _merged_raw_config(profile: dict[str, Any], environment_id: str) -> dict[str, Any]:
    """Profile config with environment overrides applied, secrets still sealed."""
    config: dict[str, Any] = copy.deepcopy(profile.get("config", {}))

    if environment_id:
        env_values = profile.get("environment_values", {})
        env_config = env_values.get(environment_id, {})
        if env_config:
            config.update(copy.deepcopy(env_config))

    return config


def get_profile_secret_field_names(profile_id: str, environment_id: str = "") -> set[str]:
    """Names of profile fields stored sealed - the fields a run must mask."""
    profile = _cached_profile(profile_id)
    if profile is None:
        return set()

    names: set[str] = set()
    for field, value in _merged_raw_config(profile, environment_id).items():
        inner = value.get("value") if _is_typed_value(value) else value
        if is_secret_envelope(inner):
            names.add(field)
    return names


def get_profile_config_for_execution(
    profile_id: str, environment_id: str = ""
) -> dict[str, Any] | None:
    """Get raw (unmasked) profile config for expression evaluation during execution."""
    profile = _cached_profile(profile_id)
    if profile is None:
        return None

    # Materialization is the unseal boundary: the connection needs real credentials
    config: dict[str, Any] = unseal_all(_merged_raw_config(profile, environment_id))

    # Unwrap typed values into their run-time types, element types included (REQ-3.1.3.19).
    properties = TYPE_SCHEMAS.get(profile.get("type", ""), {}).get("properties", {})
    for field, value in config.items():
        if _is_typed_value(value):
            config[field] = realize_declared_value(
                value["value"], value["type"], value.get("elementTypes")
            )
        elif properties.get(field, {}).get("type") in ("integer", "float"):
            config[field] = realize_declared_value(value, properties[field]["type"])

    return config


def update_profile(
    profile_id: str,
    name: str | None = None,
    config: dict[str, Any] | None = None,
    description: str | None = None,
    tags: list[str] | None = None,
    environment_values: dict[str, dict[str, Any]] | None = None,
    etag: str | None = None,
) -> dict[str, Any] | None:
    """Update an existing profile."""
    cached = _cached_profile(profile_id)
    if cached is None:
        return None
    # A refused update must leave the cached profile as stored.
    profile = copy.deepcopy(cached)

    if etag:
        current_etag = _generate_etag(profile)
        if etag != current_etag:
            exc = ConflictException("Precondition failed: resource has been modified")
            exc.status_code = 412
            exc.error_code = "PRECONDITION_FAILED"
            raise exc

    if name is not None and name != profile["name"]:
        _reconcile_cache()
        _refuse_taken_name(name)

    usage = get_profile_usage(profile_id)
    _ensure_no_structural_change(profile, config, environment_values, usage)

    if name is not None:
        profile["name"] = name

    # A masked credential must resolve to the stored (sealed) value, never seal the mask.
    if config is not None:
        config = restore_masked_secrets(config, profile.get("config", {}))
        _validate_config(config, profile["type"])
        profile["config"] = stored_config(copy.deepcopy(config), profile["type"])

    if description is not None:
        profile["description"] = description

    if tags is not None:
        profile["tags"] = tags

    if environment_values is not None:
        stored_envs = profile.get("environment_values", {})
        environment_values = {
            env_id: restore_masked_secrets(env_config, stored_envs.get(env_id, {}))
            for env_id, env_config in environment_values.items()
        }
        for env_config in environment_values.values():
            _validate_config(env_config, profile["type"])
        profile["environment_values"] = {
            env_id: stored_config(copy.deepcopy(env_config), profile["type"])
            for env_id, env_config in environment_values.items()
        }

    if "environment_values" not in profile:
        profile["environment_values"] = {}

    profile["updated_at"] = _now_iso()

    persist_profile_document(profile)

    return _prepare_profile_response(profile)


def delete_profile(profile_id: str) -> bool:
    """Delete a profile."""
    if _cached_profile(profile_id) is None:
        return False

    references = _get_profile_references(profile_id)
    if references:
        raise ConflictException(f"Profile '{profile_id}' is in use by: {', '.join(references)}")

    _delete_profile_files(profile_id)
    del _profile_common._profile_storage[profile_id]
    return True


def list_profile_types() -> list[str]:
    """List available profile types."""
    return VALID_PROFILE_TYPES.copy()


def list_profile_types_with_descriptions() -> list[dict[str, str]]:
    """List profile types with descriptions."""
    return [
        {"type": ptype, "description": PROFILE_TYPE_DESCRIPTIONS[ptype]}
        for ptype in VALID_PROFILE_TYPES
    ]


def _flatten_schema_property(
    name: str, prop_schema: dict[str, Any], required_fields: set[str]
) -> dict[str, Any]:
    """Flatten one schema property; an undeclared default, bound or plain mark is omitted."""
    field: dict[str, Any] = {
        "name": name,
        "type": _map_json_schema_type(prop_schema.get("type"), prop_schema),
        "required": name in required_fields,
        "secret": prop_schema.get("secret", False),
    }
    for key in ("default", "minimum", "maximum", "plain"):
        if key in prop_schema:
            field[key] = prop_schema[key]
    return field


def get_type_schema(profile_type: str) -> dict[str, Any] | None:
    """Get simplified schema for a profile type."""
    schema = TYPE_SCHEMAS.get(profile_type)
    if schema is None:
        return None

    required_fields = set(schema.get("required", []))
    properties = schema.get("properties", {})

    fields: list[dict[str, Any]] = [
        _flatten_schema_property(name, prop_schema, required_fields)
        for name, prop_schema in properties.items()
        if prop_schema.get("type") != "null"
    ]

    return {
        "type": profile_type,
        "fields": fields,
    }


def duplicate_profile(profile_id: str, new_name: str) -> dict[str, Any] | None:
    """Duplicate a profile with a new name."""
    _reconcile_cache()

    source_profile = _profile_common._profile_storage.get(profile_id)
    if source_profile is None:
        return None

    _refuse_taken_name(new_name)

    new_profile_id = str(uuid.uuid4())
    now = _now_iso()

    new_profile: dict[str, Any] = {
        "id": new_profile_id,
        "name": new_name,
        "type": source_profile["type"],
        "config": copy.deepcopy(source_profile.get("config", {})),
        "environment_values": copy.deepcopy(source_profile.get("environment_values", {})),
        "tags": copy.deepcopy(source_profile.get("tags", [])),
        "created_at": now,
        "updated_at": now,
    }

    if "description" in source_profile:
        new_profile["description"] = source_profile["description"]

    persist_profile_document(new_profile)

    return _prepare_profile_response(new_profile, usage=0)


def list_all_tags() -> list[str]:
    """Get all unique tags from all profiles."""
    _reconcile_cache()

    tags_set: set[str] = set()
    for profile in _profile_common._profile_storage.values():
        tags_set.update(profile.get("tags", []))
    return sorted(tags_set)


# Alias for backwards compatibility
get_all_tags = list_all_tags
