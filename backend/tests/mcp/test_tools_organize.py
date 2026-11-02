"""Organize tools contract: suites, regressions, profiles, and shared/system
variables authored through the MCP surface.

In-process direct calls via a lazy ``organize()`` helper. Create/update payload
validation comes back as data findings (mirroring create_test_from_recipe);
reference resolution (id-or-unique-name) raises through _resolve_ref; and
update_variables raises the variable-service validation exceptions directly.
Also covers the folded service validators (name format, attached-test
existence, suite existence on update).
"""

import uuid
from collections.abc import Generator
from pathlib import Path
from typing import Any

import pytest

from tests.mcp.conftest import create_test_entity
from wavecore.api.exceptions import NotFoundException, ValidationException

# --- Exact contract messages (contract section C, maps B/C). Assert verbatim. ---
SUITE_NAME_CONFLICT = "Suite with name '{name}' already exists"
SUITE_NAME_REQUIRED = "Field 'name' is required"
SUITE_NAME_LENGTH = "Suite name must be between 1 and 255 characters"
SUITE_NAME_CONVENTION = (
    "Suite name '{name}' violates naming convention: must contain only "
    "alphanumeric characters, spaces, hyphens, and underscores"
)
# Membership resolves an id or a unique name, so the message names the reference.
ATTACHED_TEST_MISSING = "Test '{test_id}' not found"

REGRESSION_NAME_EMPTY = "Regression name is required and cannot be empty"
REGRESSION_NAME_LENGTH = "Regression name must be between 1 and 255 characters"
REGRESSION_NAME_CONVENTION = (
    "Regression name '{name}' violates naming convention: must contain only "
    "alphanumeric characters, spaces, hyphens, underscores, periods, and parentheses"
)
REGRESSION_NAME_CONFLICT = "Regression with name '{name}' already exists"
SUITE_REF_MISSING = "Suite '{suite_id}' not found"

PROFILE_NAME_REQUIRED = "Field 'name' is required"
PROFILE_TYPE_REQUIRED = "Field 'type' is required"
PROFILE_INVALID_TYPE = (
    "Invalid profile type '{profile_type}': valid types are "
    "database, ssh, http, kubernetes, opensearch, custom"
)
PROFILE_NAME_CONFLICT = "Profile with name '{name}' already exists"
PROFILE_IN_USE_STRUCTURE = (
    "Cannot add, remove, or rename parameters of a profile in use by {usage} test(s)"
)

SCOPE_INVALID = "Scope must be 'system' or 'global'"


@pytest.fixture(autouse=True)
def _registries(seed_registries: None) -> None:
    """Seeded tests carry a Log node; the registry must resolve it on create."""


@pytest.fixture(autouse=True)
def clear_entity_caches(temp_storage_path: Path) -> Generator[None, None, None]:
    from wavecore.api.services import variable_service
    from wavecore.api.services.functions import service as function_service
    from wavecore.api.services.profiles import _common as profile_common
    from wavecore.api.services.suites import _storage as suite_storage

    def _clear() -> None:
        suite_storage._clear_storage()
        profile_common._clear_in_memory_cache()
        function_service._clear_in_memory_cache()
        variable_service._variable_storage.clear()
        variable_service._watch_storage.clear()
        variable_service._system_cache_loaded = False

    _clear()
    yield
    _clear()


def organize() -> Any:
    from wavecore.mcp.tools import organize as organize_tools

    return organize_tools


# ---------------------------------------------------------------------------
# Real-entity seeding (services exist; only the MCP organize module does not)
# ---------------------------------------------------------------------------


def _make_suite(
    name: str,
    *,
    tests: list[str] | None = None,
    variables: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from wavecore.api.services.suites import service as suite_service

    payload: dict[str, Any] = {"name": name}
    if tests is not None:
        payload["tests"] = tests
    if variables is not None:
        payload["variables"] = variables
    return suite_service.create_suite(payload)


def _get_suite(suite_id: str) -> dict[str, Any]:
    from wavecore.api.services.suites import service as suite_service

    suite = suite_service.get_suite(suite_id)
    assert suite is not None
    return suite


def _write_raw_suite(name: str) -> str:
    """Persist a suite straight to disk, bypassing the create-time name gate."""
    from wavecore.api.services.suites import _storage as suite_storage

    suite_id = str(uuid.uuid4())
    suite_storage._save_suite(
        {
            "id": suite_id,
            "name": name,
            "version": "1.0.0",
            "description": "",
            "tests": [],
            "tags": [],
            "variables": {},
            "metadata": {},
            "created_at": "2026-01-01T00:00:00+00:00",
            "updated_at": "2026-01-01T00:00:00+00:00",
        }
    )
    return suite_id


def _make_regression(
    name: str,
    *,
    suites: list[str] | None = None,
    variables: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from wavecore.api.services.regressions import service as regression_service

    payload: dict[str, Any] = {"name": name}
    if suites is not None:
        payload["suites"] = suites
    if variables is not None:
        payload["variables"] = variables
    return regression_service.create_regression(payload)


def _get_regression(regression_id: str) -> dict[str, Any]:
    from wavecore.api.services.regressions import service as regression_service

    regression = regression_service.get_regression(regression_id)
    assert regression is not None
    return regression


def _make_environment(name: str) -> str:
    """Credentials are keyed by environment id, so the environment must be real."""
    from wavecore.api.services.environments import service as environment_service

    return str(environment_service.create_environment(name)["id"])


def _make_profile(
    name: str,
    *,
    profile_type: str = "custom",
    config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from wavecore.api.services.profiles import service as profile_service

    return profile_service.create_profile(name=name, profile_type=profile_type, config=config or {})


def _write_test_using_profile(profile_id: str) -> str:
    """Raw on-disk test whose metadata binds the profile, forcing usage > 0."""
    import yaml

    from wavecore.api.services.storage_paths import get_tests_storage_path
    from wavecore.api.services.tests.service import _clear_in_memory_cache

    test_id = str(uuid.uuid4())
    test_dir = get_tests_storage_path() / test_id
    test_dir.mkdir(parents=True, exist_ok=True)
    (test_dir / "test.yaml").write_text(
        yaml.dump(
            {
                "id": test_id,
                "name": f"Binds Profile {test_id[:8]}",
                "version": "1.0.0",
                "description": "",
                "workflow": {"nodes": [], "edges": []},
                "variables": {},
                "metadata": {"profile_id": profile_id},
                "created_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-01T00:00:00+00:00",
            }
        )
    )
    _clear_in_memory_cache()
    return test_id


def _seed_system_variables(variables: dict[str, Any]) -> None:
    from wavecore.api.services import variable_service

    variable_service.set_system_variables(variables)


def _system_variables() -> dict[str, Any]:
    from wavecore.api.services import variable_service

    return variable_service.get_system_variables()["variables"]


def _has_problem(findings: list[dict[str, Any]], problem: str) -> bool:
    return any(item.get("problem") == problem for item in findings)


def _var(value: str) -> dict[str, Any]:
    return {"type": "string", "value": value}


# ---------------------------------------------------------------------------
# Suites
# ---------------------------------------------------------------------------


class TestCreateSuite:
    def test_success_returns_the_handle_envelope(self) -> None:
        member = create_test_entity("Suite Member One")
        result = organize().create_suite(
            "Suite Alpha", description="d", tests=[member["id"]], tags=["mcp"]
        )
        assert set(result.keys()) == {"created", "suite_id", "name", "version", "action_items"}
        assert result["created"] is True
        assert result["name"] == "Suite Alpha"
        assert result["version"] == "1.0.0"

    def test_name_conflict_creates_nothing(self) -> None:
        _make_suite("Taken Suite")
        result = organize().create_suite("Taken Suite")
        assert result["created"] is False
        assert _has_problem(result["findings"], SUITE_NAME_CONFLICT.format(name="Taken Suite"))

    def test_missing_name_is_reported(self) -> None:
        result = organize().create_suite(name=None)
        assert result["created"] is False
        assert _has_problem(result["findings"], SUITE_NAME_REQUIRED)

    def test_name_length_is_enforced(self) -> None:
        result = organize().create_suite("x" * 256)
        assert result["created"] is False
        assert _has_problem(result["findings"], SUITE_NAME_LENGTH)

    def test_name_convention_is_enforced(self) -> None:
        result = organize().create_suite("Bad@Suite")
        assert result["created"] is False
        assert _has_problem(result["findings"], SUITE_NAME_CONVENTION.format(name="Bad@Suite"))

    def test_attached_test_must_exist(self) -> None:
        ghost_id = str(uuid.uuid4())
        result = organize().create_suite("Suite With Ghost", tests=[ghost_id])
        assert result["created"] is False
        assert _has_problem(result["findings"], ATTACHED_TEST_MISSING.format(test_id=ghost_id))

    def test_create_with_variables_persists_them(self) -> None:
        result = organize().create_suite("Suite With Vars", variables={"env": _var("prod")})
        assert result["created"] is True
        assert "env" in _get_suite(result["suite_id"])["variables"]


class TestUpdateSuite:
    def test_add_tests_leaves_existing_members(self) -> None:
        t1 = create_test_entity("Suite Keep One")
        t2 = create_test_entity("Suite Keep Two")
        t3 = create_test_entity("Suite Add Three")
        suite = _make_suite("Growing Suite", tests=[t1["id"], t2["id"]])

        result = organize().update_suite(suite["id"], add_tests=[t3["id"]])

        assert result["updated"] is True
        members = set(_get_suite(suite["id"])["tests"])
        assert {t1["id"], t2["id"], t3["id"]}.issubset(members)

    def test_remove_tests_removes_only_named(self) -> None:
        t1 = create_test_entity("Suite Drop One")
        t2 = create_test_entity("Suite Drop Two")
        suite = _make_suite("Shrinking Suite", tests=[t1["id"], t2["id"]])

        organize().update_suite(suite["id"], remove_tests=[t1["id"]])

        members = set(_get_suite(suite["id"])["tests"])
        assert t1["id"] not in members
        assert t2["id"] in members

    def test_set_variables_merges_without_dropping_others(self) -> None:
        suite = _make_suite("Var Suite", variables={"a": _var("1"), "b": _var("2")})

        organize().update_suite(suite["id"], set_variables={"a": _var("updated")})

        variables = _get_suite(suite["id"])["variables"]
        assert "a" in variables
        assert "b" in variables

    def test_unknown_suite_ref_raises(self) -> None:
        with pytest.raises(NotFoundException, match=r"^Suite 'ghost' not found$"):
            organize().update_suite("ghost", name="Renamed")

    def test_ambiguous_suite_name_raises(self) -> None:
        _write_raw_suite("Dup Suite")
        _write_raw_suite("Dup Suite")

        with pytest.raises(
            ValidationException, match=r"^Multiple suites named 'Dup Suite'; use the id$"
        ):
            organize().update_suite("Dup Suite", name="Renamed")

    def test_rename_and_retag_updates_both(self) -> None:
        suite = _make_suite("Rename Me Suite")
        result = organize().update_suite(suite["id"], name="Renamed Suite", tags=["nightly"])
        assert result["updated"] is True
        updated = _get_suite(suite["id"])
        assert updated["name"] == "Renamed Suite"
        assert "nightly" in updated["tags"]

    def test_add_missing_test_is_reported(self) -> None:
        suite = _make_suite("Guard Suite")
        ghost = str(uuid.uuid4())
        result = organize().update_suite(suite["id"], add_tests=[ghost])
        assert result["updated"] is False
        assert _has_problem(result["findings"], ATTACHED_TEST_MISSING.format(test_id=ghost))

    def test_rename_to_a_taken_name_is_reported(self) -> None:
        _make_suite("Existing Suite")
        suite = _make_suite("Movable Suite")
        result = organize().update_suite(suite["id"], name="Existing Suite")
        assert result["updated"] is False
        assert _has_problem(result["findings"], SUITE_NAME_CONFLICT.format(name="Existing Suite"))


# ---------------------------------------------------------------------------
# Regressions
# ---------------------------------------------------------------------------


class TestCreateRegression:
    def test_success_returns_the_handle_envelope(self) -> None:
        suite = _make_suite("Reg Member Suite")
        result = organize().create_regression("Nightly Regression", suites=[suite["id"]])
        assert set(result.keys()) == {"created", "regression_id", "name", "version", "action_items"}
        assert result["created"] is True
        assert result["name"] == "Nightly Regression"
        assert result["version"] == "1.0.0"

    def test_empty_name_is_reported(self) -> None:
        result = organize().create_regression("")
        assert result["created"] is False
        assert _has_problem(result["findings"], REGRESSION_NAME_EMPTY)

    def test_name_length_is_enforced(self) -> None:
        result = organize().create_regression("x" * 256)
        assert result["created"] is False
        assert _has_problem(result["findings"], REGRESSION_NAME_LENGTH)

    def test_name_convention_is_enforced(self) -> None:
        result = organize().create_regression("Bad@Reg")
        assert result["created"] is False
        assert _has_problem(result["findings"], REGRESSION_NAME_CONVENTION.format(name="Bad@Reg"))

    def test_name_conflict_creates_nothing(self) -> None:
        _make_regression("Taken Regression")
        result = organize().create_regression("Taken Regression")
        assert result["created"] is False
        assert _has_problem(
            result["findings"], REGRESSION_NAME_CONFLICT.format(name="Taken Regression")
        )

    def test_suite_reference_must_exist_on_create(self) -> None:
        ghost_suite = str(uuid.uuid4())
        result = organize().create_regression("Reg With Ghost", suites=[ghost_suite])
        assert result["created"] is False
        assert _has_problem(result["findings"], SUITE_REF_MISSING.format(suite_id=ghost_suite))

    def test_create_with_optional_fields_persists_them(self) -> None:
        result = organize().create_regression(
            "Full Regression", description="desc", tags=["nightly"], variables={"env": _var("prod")}
        )
        assert result["created"] is True
        regression = _get_regression(result["regression_id"])
        assert regression["description"] == "desc"
        assert "nightly" in regression["tags"]
        assert "env" in regression["variables"]


class TestUpdateRegression:
    def test_add_suites_leaves_existing_members(self) -> None:
        s1 = _make_suite("Reg Keep One")
        s2 = _make_suite("Reg Keep Two")
        s3 = _make_suite("Reg Add Three")
        regression = _make_regression("Growing Reg", suites=[s1["id"], s2["id"]])

        result = organize().update_regression(regression["id"], add_suites=[s3["id"]])

        assert result["updated"] is True
        members = set(_get_regression(regression["id"])["suites"])
        assert {s1["id"], s2["id"], s3["id"]}.issubset(members)

    def test_remove_suites_removes_only_named(self) -> None:
        s1 = _make_suite("Reg Drop One")
        s2 = _make_suite("Reg Drop Two")
        regression = _make_regression("Shrinking Reg", suites=[s1["id"], s2["id"]])

        organize().update_regression(regression["id"], remove_suites=[s1["id"]])

        members = set(_get_regression(regression["id"])["suites"])
        assert s1["id"] not in members
        assert s2["id"] in members

    def test_set_variables_merges_without_dropping_others(self) -> None:
        regression = _make_regression("Reg Vars", variables={"a": _var("1"), "b": _var("2")})

        organize().update_regression(regression["id"], set_variables={"a": _var("new")})

        variables = _get_regression(regression["id"])["variables"]
        assert "a" in variables
        assert "b" in variables

    def test_remove_variables_removes_only_named(self) -> None:
        regression = _make_regression("Reg Drop Vars", variables={"a": _var("1"), "b": _var("2")})

        organize().update_regression(regression["id"], remove_variables=["a"])

        variables = _get_regression(regression["id"])["variables"]
        assert "a" not in variables
        assert "b" in variables

    def test_suite_reference_must_exist_on_update(self) -> None:
        regression = _make_regression("Reg Update Existence")
        ghost_suite = str(uuid.uuid4())

        result = organize().update_regression(regression["id"], add_suites=[ghost_suite])

        assert result["updated"] is False
        assert _has_problem(result["findings"], SUITE_REF_MISSING.format(suite_id=ghost_suite))

    def test_unknown_regression_ref_raises(self) -> None:
        with pytest.raises(NotFoundException, match=r"^Regression 'ghost' not found$"):
            organize().update_regression("ghost", name="Renamed")

    def test_rename_and_retag_updates_both(self) -> None:
        regression = _make_regression("Reg Rename")
        result = organize().update_regression(regression["id"], name="Reg Renamed", tags=["tag"])
        assert result["updated"] is True
        updated = _get_regression(regression["id"])
        assert updated["name"] == "Reg Renamed"
        assert "tag" in updated["tags"]

    def test_rename_to_a_taken_name_is_reported(self) -> None:
        _make_regression("Existing Reg")
        regression = _make_regression("Movable Reg")
        result = organize().update_regression(regression["id"], name="Existing Reg")
        assert result["updated"] is False
        assert _has_problem(
            result["findings"], REGRESSION_NAME_CONFLICT.format(name="Existing Reg")
        )


# ---------------------------------------------------------------------------
# Profiles (positional name + profile_type, per the service signature)
# ---------------------------------------------------------------------------


class TestCreateProfile:
    def test_success_returns_the_handle_envelope(self) -> None:
        result = organize().create_profile("Profile Alpha", "custom", config={})
        assert set(result.keys()) == {"created", "profile_id", "name", "action_items"}
        assert result["created"] is True
        assert result["name"] == "Profile Alpha"

    def test_missing_name_is_reported(self) -> None:
        result = organize().create_profile(None, "custom")
        assert result["created"] is False
        assert _has_problem(result["findings"], PROFILE_NAME_REQUIRED)

    def test_missing_type_is_reported(self) -> None:
        result = organize().create_profile("Profile No Type", None)
        assert result["created"] is False
        assert _has_problem(result["findings"], PROFILE_TYPE_REQUIRED)

    def test_invalid_type_is_reported(self) -> None:
        result = organize().create_profile("Profile Bad Type", "bogus")
        assert result["created"] is False
        assert _has_problem(result["findings"], PROFILE_INVALID_TYPE.format(profile_type="bogus"))

    def test_sftp_is_not_a_profile_type(self) -> None:
        # SFTP-1: the SSH profile bound on SSH Session Open carries the connection.
        result = organize().create_profile("Profile Sftp", "sftp", config={})
        assert result == {
            "created": False,
            "findings": [
                {
                    "step": "input",
                    "code": "VALIDATION",
                    "severity": "error",
                    "problem": PROFILE_INVALID_TYPE.format(profile_type="sftp"),
                    "fix": None,
                }
            ],
        }

    def test_name_conflict_creates_nothing(self) -> None:
        _make_profile("Dup Profile")
        result = organize().create_profile("Dup Profile", "custom", config={})
        assert result["created"] is False
        assert _has_problem(result["findings"], PROFILE_NAME_CONFLICT.format(name="Dup Profile"))

    def test_declare_empty_secret_returns_an_action_item(self) -> None:
        env_id = _make_environment("Deferred Secret Env")
        result = organize().create_profile(
            "Profile Deferred Secret",
            "custom",
            environment_values={
                env_id: {
                    "username": {"type": "string", "secret": False, "value": "svc"},
                    "password": {"type": "string", "secret": True},
                }
            },
        )
        assert result["created"] is True
        assert result["action_items"] == [
            {
                "step": f"environment_values.{env_id}.password",
                "code": "NO_VALUE_SECRET",
                "severity": "warning",
                "problem": f"Secret field 'password' holds no value for environment '{env_id}'",
                "fix": "A person must fill it in before dependent definitions can run",
            }
        ]

    def test_filled_secret_returns_no_action_items(self) -> None:
        env_id = _make_environment("Filled Secret Env")
        result = organize().create_profile(
            "Profile Filled Secret",
            "custom",
            environment_values={
                env_id: {"password": {"type": "string", "secret": True, "value": "hunter2"}}
            },
        )
        assert result["created"] is True
        assert result["action_items"] == []

    def test_declare_empty_secret_in_config_returns_an_action_item(self) -> None:
        result = organize().create_profile(
            "Profile Deferred Config Secret",
            "custom",
            config={"token": {"type": "string", "secret": True}},
        )
        assert result["created"] is True
        assert result["action_items"] == [
            {
                "step": "config.token",
                "code": "NO_VALUE_SECRET",
                "severity": "warning",
                "problem": "Secret field 'token' holds no value",
                "fix": "A person must fill it in before dependent definitions can run",
            }
        ]


class TestUpdateProfile:
    def test_structural_change_while_in_use_is_reported(self, monkeypatch: Any) -> None:
        from wavecore.api.services.profiles import service as profile_service

        profile = _make_profile("In Use Profile", config={"host": {"type": "string", "value": "a"}})
        _write_test_using_profile(profile["id"])
        monkeypatch.setattr(profile_service, "get_profile_usage", lambda _pid: 1)

        result = organize().update_profile(
            profile["id"], config={"port": {"type": "string", "value": "b"}}
        )

        assert result["updated"] is False
        assert _has_problem(result["findings"], PROFILE_IN_USE_STRUCTURE.format(usage=1))

    def test_unknown_profile_ref_raises(self) -> None:
        with pytest.raises(NotFoundException, match=r"^Profile 'ghost' not found$"):
            organize().update_profile("ghost", name="Renamed")

    def test_rename_updates_the_profile(self) -> None:
        profile = _make_profile("Profile To Rename")
        result = organize().update_profile(profile["id"], name="Profile Renamed")
        assert set(result.keys()) == {"updated", "profile_id", "name", "action_items"}
        assert result["updated"] is True
        assert result["name"] == "Profile Renamed"

    @pytest.mark.parametrize("value", ["", None])
    def test_an_empty_secret_value_in_config_returns_an_action_item(self, value: Any) -> None:
        """An empty secret holds nothing, so a person still owes its value (REQ-4.5.1)."""
        result = organize().create_profile(
            f"Profile Empty Config Secret {value!r}",
            "custom",
            config={"token": {"type": "string", "secret": True, "value": value}},
        )
        assert result["created"] is True
        assert result["action_items"] == [
            {
                "step": "config.token",
                "code": "NO_VALUE_SECRET",
                "severity": "warning",
                "problem": "Secret field 'token' holds no value",
                "fix": "A person must fill it in before dependent definitions can run",
            }
        ]

    def test_a_whitespace_secret_value_is_a_value(self) -> None:
        result = organize().create_profile(
            "Profile Whitespace Secret",
            "custom",
            config={"token": {"type": "string", "secret": True, "value": " "}},
        )
        assert result["created"] is True
        assert result["action_items"] == []

    def test_declare_empty_secret_on_update_returns_an_action_item(self) -> None:
        profile = _make_profile("Profile Update Deferred")
        env_id = _make_environment("Update Deferred Env")
        result = organize().update_profile(
            profile["id"],
            environment_values={env_id: {"password": {"type": "string", "secret": True}}},
        )
        assert result["updated"] is True
        assert result["action_items"] == [
            {
                "step": f"environment_values.{env_id}.password",
                "code": "NO_VALUE_SECRET",
                "severity": "warning",
                "problem": f"Secret field 'password' holds no value for environment '{env_id}'",
                "fix": "A person must fill it in before dependent definitions can run",
            }
        ]

    def test_environment_values_merge_instead_of_replacing(self) -> None:
        """Non-destructive contract: an environment omitted from the update keeps
        its stored credentials instead of being deleted."""
        from wavecore.api.services.profiles import service as profile_service

        profile = _make_profile("Profile Two Envs")
        env_a = _make_environment("Merge Env A")
        env_b = _make_environment("Merge Env B")
        organize().update_profile(
            profile["id"],
            environment_values={
                env_a: {"password": {"type": "string", "secret": True, "value": "aaa"}},
                env_b: {"password": {"type": "string", "secret": True, "value": "bbb"}},
            },
        )

        organize().update_profile(
            profile["id"],
            environment_values={
                env_a: {"password": {"type": "string", "secret": True, "value": "ccc"}}
            },
        )

        stored = profile_service.get_profile(profile["id"])
        assert set(stored["environment_values"].keys()) == {env_a, env_b}

    def test_masked_resubmit_is_not_flagged(self) -> None:
        from wavecore.core.secrets.masking import MASK_PLACEHOLDER

        profile = _make_profile(
            "Profile Masked Resubmit",
            config={"password": {"type": "string", "secret": True, "value": "hunter2"}},
        )
        result = organize().update_profile(
            profile["id"],
            config={"password": {"type": "string", "secret": True, "value": MASK_PLACEHOLDER}},
        )
        assert result["updated"] is True
        assert result["action_items"] == []


# ---------------------------------------------------------------------------
# Shared / system variables (scope in {system, global}, both the system store)
# ---------------------------------------------------------------------------


class TestUpdateVariables:
    def test_set_reports_the_written_names(self) -> None:
        _seed_system_variables({"seed": _var("s")})

        result = organize().update_variables("system", set={"region": _var("emea")})

        assert set(result.keys()) == {"updated", "scope", "names", "action_items"}
        assert result["updated"] is True
        assert result["scope"] == "system"
        assert "region" in result["names"]
        assert "region" in _system_variables()

    def test_global_alias_writes_the_system_store(self) -> None:
        _seed_system_variables({"seed": _var("s")})

        result = organize().update_variables("global", set={"shared": _var("value")})

        assert result["updated"] is True
        assert "shared" in _system_variables()

    def test_invalid_scope_raises(self) -> None:
        with pytest.raises(ValidationException, match=r"^Scope must be 'system' or 'global'$"):
            organize().update_variables("suite", set={"x": _var("y")})

    def test_invalid_variable_name_raises(self) -> None:
        _seed_system_variables({"seed": _var("s")})

        with pytest.raises(
            ValidationException,
            match=r"^Invalid variable name: '123bad' \(must match \[a-zA-Z_\]\[a-zA-Z0-9_\]\*\)$",
        ):
            organize().update_variables("system", set={"123bad": _var("x")})

    def test_invalid_variable_type_raises(self) -> None:
        _seed_system_variables({"seed": _var("s")})

        with pytest.raises(
            ValidationException,
            match=(
                r"^Invalid variable type: 'geo' \(must be one of: "
                r"array, boolean, float, integer, map, string, table\)$"
            ),
        ):
            organize().update_variables("system", set={"where": {"type": "geo", "value": "y"}})

    def test_circular_reference_raises(self) -> None:
        _seed_system_variables({"seed": _var("s")})

        with pytest.raises(
            ValidationException,
            match=r"^Circular reference detected for variable 'a': a -> a$",
        ):
            organize().update_variables(
                "system",
                set={"a": {"type": "integer", "computed": True, "expression": "a + 1"}},
            )

    def test_set_merges_without_dropping_others(self) -> None:
        _seed_system_variables({"keep": _var("1"), "target": _var("2")})

        organize().update_variables("system", set={"target": _var("updated")})

        variables = _system_variables()
        assert "keep" in variables
        assert "target" in variables

    def test_remove_deletes_only_named(self) -> None:
        _seed_system_variables({"a": _var("1"), "b": _var("2")})

        organize().update_variables("system", remove=["a"])

        variables = _system_variables()
        assert "a" not in variables
        assert "b" in variables

    def test_set_creates_the_system_entity_when_absent(self, monkeypatch: Any) -> None:
        # A cold system store (no entity yet) makes update return None; the tool
        # falls back to creating the entity via set_entity_variables.
        from wavecore.api.services import variable_service

        monkeypatch.setattr(variable_service, "update_entity_variables", lambda *_a, **_k: None)
        result = organize().update_variables("system", set={"fresh": _var("v")})

        assert result["updated"] is True
        assert "fresh" in _system_variables()


class TestMembershipAcceptsNames:
    """Every other reference resolves an id or a unique name; membership lists
    silently deviated, and the error called the submitted name an ID."""

    def test_create_suite_accepts_a_test_name(self) -> None:
        member = create_test_entity("Named Member One")
        result = organize().create_suite("Suite By Name", tests=["Named Member One"])
        assert result["created"] is True
        assert _get_suite(result["suite_id"])["tests"] == [member["id"]]

    def test_update_suite_add_tests_accepts_a_test_name(self) -> None:
        member = create_test_entity("Named Member Two")
        suite = _make_suite("Suite Add By Name")
        result = organize().update_suite(suite["id"], add_tests=["Named Member Two"])
        assert result["updated"] is True
        assert _get_suite(suite["id"])["tests"] == [member["id"]]

    def test_create_regression_accepts_a_suite_name(self) -> None:
        member = _make_suite("Named Suite Member")
        result = organize().create_regression("Regression By Name", suites=["Named Suite Member"])
        assert result["created"] is True
        assert _get_regression(result["regression_id"])["suites"] == [member["id"]]

    def test_unresolvable_member_names_the_reference_not_an_id(self) -> None:
        result = organize().create_suite("Suite Ghost Name", tests=["No Such Test"])
        assert result["created"] is False
        finding = result["findings"][0]
        assert finding["code"] == "ATTACHED_TEST_NOT_FOUND"
        assert finding["problem"] == "Test 'No Such Test' not found"
        assert finding["fix"] == "Pass an existing test id or unique name"

    def test_regression_membership_uses_the_same_finding_code(self) -> None:
        result = organize().create_regression("Regression Ghost", suites=["No Such Suite"])
        assert result["created"] is False
        finding = result["findings"][0]
        assert finding["code"] == "ATTACHED_SUITE_NOT_FOUND"
        assert finding["problem"] == "Suite 'No Such Suite' not found"


class TestNoOpWrites:
    """A removal that matches nothing reports it and mints no version."""

    def test_removing_a_non_member_test_is_reported(self) -> None:
        stranger = create_test_entity("Not A Member")
        suite = _make_suite("Suite No Op")
        result = organize().update_suite(suite["id"], remove_tests=[stranger["id"]])
        assert result["updated"] is False
        finding = result["findings"][0]
        assert finding["code"] == "NOT_A_MEMBER"
        assert finding["problem"] == f"Test '{stranger['id']}' is not in this suite"
        assert _get_suite(suite["id"])["version"] == "1.0.0"

    def test_removing_an_absent_variable_is_reported(self) -> None:
        suite = _make_suite("Suite No Op Var", variables={"real": _var("v")})
        result = organize().update_suite(suite["id"], remove_variables=["ghost_var"])
        assert result["updated"] is False
        assert result["findings"][0]["code"] == "VARIABLE_NOT_FOUND"
        assert _get_suite(suite["id"])["version"] == "1.0.0"

    def test_adding_and_removing_the_same_member_is_refused(self) -> None:
        member = create_test_entity("Contradiction Member")
        suite = _make_suite("Suite Contradiction", tests=[member["id"]])
        result = organize().update_suite(
            suite["id"], add_tests=[member["id"]], remove_tests=[member["id"]]
        )
        assert result["updated"] is False
        assert result["findings"][0]["code"] == "CONTRADICTORY_MEMBERSHIP"
        assert _get_suite(suite["id"])["version"] == "1.0.0"

    def test_a_write_that_changes_nothing_does_not_mint_a_version(self) -> None:
        suite = _make_suite("Suite Unchanged", variables={"env": _var("prod")})
        result = organize().update_suite(suite["id"], set_variables={"env": _var("prod")})
        assert result["updated"] is True
        assert result["version"] == "1.0.0"
        assert _get_suite(suite["id"])["version"] == "1.0.0"

    def test_removing_a_non_member_suite_is_reported_on_regressions(self) -> None:
        stranger = _make_suite("Unattached Suite")
        regression = _make_regression("Regression No Op")
        result = organize().update_regression(regression["id"], remove_suites=[stranger["id"]])
        assert result["updated"] is False
        assert result["findings"][0]["code"] == "NOT_A_MEMBER"
        assert _get_regression(regression["id"])["version"] == "1.0.0"


class TestDescriptionIsEditable:
    """A description set at creation could never be corrected through this surface."""

    def test_update_suite_sets_the_description(self) -> None:
        suite = _make_suite("Suite Describe")
        result = organize().update_suite(suite["id"], description="corrected")
        assert result["updated"] is True
        assert _get_suite(suite["id"])["description"] == "corrected"

    def test_update_regression_sets_the_description(self) -> None:
        regression = _make_regression("Regression Describe")
        result = organize().update_regression(regression["id"], description="corrected")
        assert result["updated"] is True
        assert _get_regression(regression["id"])["description"] == "corrected"


class TestProfileEnvironmentIntegrity:
    """Credentials sealed against an environment that does not exist are orphaned,
    and the completeness counters then claim full coverage."""

    def test_create_profile_rejects_an_unknown_environment(self) -> None:
        ghost_env = str(uuid.uuid4())
        result = organize().create_profile(
            name="Ghost Env Profile",
            profile_type="custom",
            environment_values={ghost_env: {"username": {"type": "string", "value": "u"}}},
        )
        assert result["created"] is False
        finding = result["findings"][0]
        assert finding["code"] == "UNKNOWN_ENVIRONMENT"
        assert finding["problem"] == f"Environment '{ghost_env}' not found"

    def test_update_profile_rejects_an_unknown_environment(self) -> None:
        profile = _make_profile("Real Env Profile")
        ghost_env = str(uuid.uuid4())
        result = organize().update_profile(
            profile["id"],
            environment_values={ghost_env: {"username": {"type": "string", "value": "u"}}},
        )
        assert result["updated"] is False
        assert result["findings"][0]["code"] == "UNKNOWN_ENVIRONMENT"


class TestSuiteDeclareEmptySecrets:
    """Declare-empty announces what a person still owes on every authoring
    surface; suites and regressions were the silent exception."""

    def test_create_suite_returns_the_action_item(self) -> None:
        result = organize().create_suite(
            "Suite Deferred Secret",
            variables={"token": {"type": "string", "secret": True}},
        )
        assert result["created"] is True
        assert result["action_items"] == [
            {
                "step": "variables.token",
                "code": "NO_VALUE_VARIABLE",
                "severity": "warning",
                "problem": "Secret variable 'token' holds no value",
                "fix": "A person must fill it in before dependent definitions can run",
            }
        ]

    def test_update_suite_returns_the_action_item(self) -> None:
        suite = _make_suite("Suite Deferred On Update")
        result = organize().update_suite(
            suite["id"], set_variables={"token": {"type": "string", "secret": True}}
        )
        assert result["updated"] is True
        assert result["action_items"][0]["code"] == "NO_VALUE_VARIABLE"

    def test_an_empty_secret_value_returns_the_action_item(self) -> None:
        """An empty secret holds nothing, so a person still owes its value (REQ-4.5.1)."""
        result = organize().create_suite(
            "Suite Empty Secret",
            variables={"token": {"type": "string", "secret": True, "value": ""}},
        )
        assert result["created"] is True
        assert result["action_items"] == [
            {
                "step": "variables.token",
                "code": "NO_VALUE_VARIABLE",
                "severity": "warning",
                "problem": "Secret variable 'token' holds no value",
                "fix": "A person must fill it in before dependent definitions can run",
            }
        ]

    def test_a_filled_secret_returns_no_action_item(self) -> None:
        result = organize().create_suite(
            "Suite Filled Secret",
            variables={"token": {"type": "string", "secret": True, "value": "hunter2"}},
        )
        assert result["created"] is True
        assert result["action_items"] == []

    def test_create_regression_returns_the_action_item(self) -> None:
        result = organize().create_regression(
            "Regression Deferred Secret",
            variables={"token": {"type": "string", "secret": True}},
        )
        assert result["created"] is True
        assert result["action_items"][0]["code"] == "NO_VALUE_VARIABLE"

    def test_update_regression_returns_the_action_item(self) -> None:
        regression = _make_regression("Regression Deferred On Update")
        result = organize().update_regression(
            regression["id"], set_variables={"token": {"type": "string", "secret": True}}
        )
        assert result["updated"] is True
        assert result["action_items"][0]["code"] == "NO_VALUE_VARIABLE"

    def test_update_variables_returns_the_action_item(self) -> None:
        result = organize().update_variables(
            scope="global", set={"token": {"type": "string", "secret": True}}
        )
        assert result["updated"] is True
        assert result["action_items"][0]["code"] == "NO_VALUE_VARIABLE"


class TestDeclareEmptyProfileSecretReadback:
    """list_profiles is the only oracle for a profile write, so an unfilled
    secret must still read back as a secret of its declared type."""

    def test_unfilled_secret_keeps_its_type_and_flag(self) -> None:
        from wavecore.api.services.profiles import service as profile_service

        env_id = _make_environment("Readback Shape Env")
        organize().create_profile(
            "Profile Unfilled Readback",
            "custom",
            environment_values={
                env_id: {
                    "username": {"type": "string", "secret": False, "value": "svc"},
                    "token": {"type": "string", "secret": True},
                }
            },
        )

        rows = profile_service.list_profiles(per_page=1000)["profiles"]
        row = next(r for r in rows if r["name"] == "Profile Unfilled Readback")
        assert row["environment_values"][env_id]["token"] == {"type": "string", "secret": True}

    def test_a_filled_secret_still_reads_back_masked(self) -> None:
        from wavecore.api.services.profiles import service as profile_service

        env_id = _make_environment("Readback Filled Env")
        organize().create_profile(
            "Profile Filled Readback",
            "custom",
            environment_values={
                env_id: {"token": {"type": "string", "secret": True, "value": "hunter2"}}
            },
        )

        rows = profile_service.list_profiles(per_page=1000)["profiles"]
        row = next(r for r in rows if r["name"] == "Profile Filled Readback")
        assert row["environment_values"][env_id]["token"] == {
            "type": "string",
            "secret": True,
            "value": "********",
        }


class TestNoOpWritesRemainingSurfaces:
    def test_a_regression_write_that_changes_nothing_does_not_mint_a_version(self) -> None:
        regression = _make_regression("Regression Unchanged", variables={"env": _var("prod")})
        result = organize().update_regression(regression["id"], set_variables={"env": _var("prod")})
        assert result["updated"] is True
        assert result["version"] == "1.0.0"
        assert _get_regression(regression["id"])["version"] == "1.0.0"

    def test_removing_an_undeclared_shared_variable_is_reported(self) -> None:
        _seed_system_variables({"real": _var("v")})
        result = organize().update_variables(scope="global", remove=["never_existed"])
        assert result["updated"] is False
        finding = result["findings"][0]
        assert finding["code"] == "VARIABLE_NOT_FOUND"
        assert finding["problem"] == "Variable 'never_existed' is not declared in the global scope"
        assert "real" in _system_variables()


class TestTypedVariableWrites:
    """Suite, regression and shared variables are documented as typed objects;
    a bare value is refused."""

    def test_update_variables_rejects_a_bare_value(self) -> None:
        result = organize().update_variables(scope="global", set={"plain": "just a string"})
        assert result["updated"] is False
        finding = result["findings"][0]
        assert finding["code"] == "UNTYPED_VARIABLE"
        assert finding["problem"] == "Variable 'plain' must be an object with a type"
        assert finding["fix"] == 'Use {"type": "string"}; add "value" to give it one'

    def test_update_variables_rejects_a_declaration_without_a_type(self) -> None:
        result = organize().update_variables(scope="global", set={"plain": {"value": "x"}})
        assert result["updated"] is False
        assert result["findings"][0]["code"] == "UNTYPED_VARIABLE"

    def test_create_suite_rejects_a_bare_value(self) -> None:
        result = organize().create_suite("Suite Bare Var", variables={"plain": "raw"})
        assert result["created"] is False
        assert result["findings"][0]["code"] == "UNTYPED_VARIABLE"

    def test_update_suite_rejects_a_bare_value(self) -> None:
        suite = _make_suite("Suite Bare Update")
        result = organize().update_suite(suite["id"], set_variables={"plain": "raw"})
        assert result["updated"] is False
        assert result["findings"][0]["code"] == "UNTYPED_VARIABLE"

    def test_update_regression_rejects_a_bare_value(self) -> None:
        regression = _make_regression("Regression Bare Update")
        result = organize().update_regression(regression["id"], set_variables={"plain": "raw"})
        assert result["updated"] is False
        assert result["findings"][0]["code"] == "UNTYPED_VARIABLE"

    def test_a_declare_empty_secret_is_still_accepted(self) -> None:
        """It carries a type; only its value is deferred."""
        result = organize().create_suite(
            "Suite Deferred Typed", variables={"token": {"type": "string", "secret": True}}
        )
        assert result["created"] is True

    def test_a_declaration_without_a_type_asks_for_a_type_only(self) -> None:
        result = organize().update_variables(scope="global", set={"plain": {"value": "x"}})
        assert result["findings"] == [
            {
                "step": "input",
                "code": "UNTYPED_VARIABLE",
                "severity": "error",
                "problem": "Variable 'plain' must be an object with a type",
                "fix": 'Use {"type": "string"}; add "value" to give it one',
            }
        ]


class TestTypeAloneDeclarations:
    """A type alone is a complete declaration: the variable holds null (REQ-3.1.3.20)."""

    @pytest.mark.parametrize(
        "var_type", ["string", "integer", "float", "boolean", "array", "map", "table"]
    )
    def test_update_variables_accepts_a_type_alone(self, var_type: str) -> None:
        result = organize().update_variables(scope="global", set={"later": {"type": var_type}})
        assert result["updated"] is True
        assert "findings" not in result
        assert result["action_items"] == []
        assert _system_variables()["later"]["type"] == var_type
        assert _system_variables()["later"].get("value") is None

    def test_create_suite_accepts_a_type_alone(self) -> None:
        result = organize().create_suite("Suite Type Alone", variables={"later": {"type": "map"}})
        assert result["created"] is True
        assert result["action_items"] == []

    def test_update_suite_accepts_a_type_alone(self) -> None:
        suite = _make_suite("Suite Type Alone Update")
        result = organize().update_suite(suite["id"], set_variables={"later": {"type": "integer"}})
        assert result["updated"] is True
        assert result["action_items"] == []

    def test_create_regression_accepts_a_type_alone(self) -> None:
        result = organize().create_regression(
            "Regression Type Alone", variables={"later": {"type": "boolean"}}
        )
        assert result["created"] is True
        assert result["action_items"] == []

    def test_update_regression_accepts_a_type_alone(self) -> None:
        regression = _make_regression("Regression Type Alone Update")
        result = organize().update_regression(
            regression["id"], set_variables={"later": {"type": "float"}}
        )
        assert result["updated"] is True
        assert result["action_items"] == []
