"""One-time startup seal sweep contract (REQ-4.5.1).

`run_seal_sweep` converges a pre-existing plaintext store to the sealed
invariant: every plaintext secret leaf across system variables, entity
files (including regression version snapshots), and profiles is sealed
in place; non-secret bytes stay byte-identical; a second run is a
no-op; unreadable files are logged, skipped, and never abort startup.
"""

import logging
from pathlib import Path
from typing import Any

import pytest
import yaml

from wavecore.api.services.secret_seal_sweep import run_seal_sweep
from wavecore.core.secrets.cipher import is_secret_envelope
from wavecore.core.secrets.sealing import unseal_all

SYSTEM_CANARY = "sweep-system-canary-000"
TEST_CANARY = "sweep-test-canary-111"
SUITE_CANARY = "sweep-suite-canary-222"
REGRESSION_CANARY = "sweep-regression-canary-333"
SNAPSHOT_CANARY = "sweep-snapshot-canary-444"
PROFILE_CANARY = "sweep-profile-canary-555"
PROFILE_ENV_CANARY = "sweep-profile-env-canary-666"

ALL_CANARIES = [
    SYSTEM_CANARY,
    TEST_CANARY,
    SUITE_CANARY,
    REGRESSION_CANARY,
    SNAPSHOT_CANARY,
    PROFILE_CANARY,
    PROFILE_ENV_CANARY,
]

SECRET_TEST_ID = "11111111-1111-1111-1111-111111111111"
PLAIN_TEST_ID = "22222222-2222-2222-2222-222222222222"
CORRUPT_TEST_ID = "33333333-3333-3333-3333-333333333333"
SUITE_ID = "44444444-4444-4444-4444-444444444444"
REGRESSION_ID = "55555555-5555-5555-5555-555555555555"
PROFILE_ID = "66666666-6666-6666-6666-666666666666"


def _write_yaml(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        yaml.dump(data, f, default_flow_style=False, sort_keys=False)


def _entity_doc(entity_id: str, name: str, variables: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": entity_id,
        "name": name,
        "version": "1.0.0",
        "description": "",
        "workflow": {"nodes": [], "edges": []},
        "variables": variables,
        "metadata": {},
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
    }


def _seed_plaintext_store(base: Path) -> dict[str, Path]:
    """Write an unsealed store: plaintext secret leaves on every surface."""
    paths = {
        "system": base / "system_variables.yaml",
        "secret_test": base / "api_tests" / SECRET_TEST_ID / "test.yaml",
        "test_versions": base / "api_tests" / SECRET_TEST_ID / "versions.yaml",
        "plain_test": base / "api_tests" / PLAIN_TEST_ID / "test.yaml",
        "corrupt_test": base / "api_tests" / CORRUPT_TEST_ID / "test.yaml",
        "suite": base / "api_suites" / SUITE_ID / "suite.yaml",
        "regression": base / "api_regressions" / REGRESSION_ID / "regression.yaml",
        "regression_versions": base / "api_regressions" / REGRESSION_ID / "versions.yaml",
        "profile": base / "api_profiles" / PROFILE_ID / "profile.yaml",
    }

    _write_yaml(
        paths["system"],
        {
            "variables": {
                "api_token": {"type": "string", "value": SYSTEM_CANARY, "secret": True},
                "region": {"type": "string", "value": "eu-west-1"},
            }
        },
    )
    _write_yaml(
        paths["secret_test"],
        _entity_doc(
            SECRET_TEST_ID,
            "sweep secret test",
            {
                "db_password": {"type": "string", "value": TEST_CANARY, "secret": True},
                "host": {"type": "string", "value": "db.example.com"},
            },
        ),
    )
    _write_yaml(
        paths["test_versions"],
        [
            {
                "version": "1.0.0",
                "created_at": "2026-01-01T00:00:00Z",
                "created_by": "system",
                "changes": "Initial version",
            }
        ],
    )
    _write_yaml(
        paths["plain_test"],
        _entity_doc(
            PLAIN_TEST_ID,
            "sweep plain test",
            {"host": {"type": "string", "value": "plain.example.com"}},
        ),
    )
    paths["corrupt_test"].parent.mkdir(parents=True, exist_ok=True)
    paths["corrupt_test"].write_text("key: [unclosed\n")
    _write_yaml(
        paths["suite"],
        {
            "id": SUITE_ID,
            "name": "sweep suite",
            "version": "1.0.0",
            "description": "",
            "tests": [],
            "tags": [],
            "variables": {"suite_token": {"type": "string", "value": SUITE_CANARY, "secret": True}},
            "metadata": {},
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
        },
    )
    _write_yaml(
        paths["regression"],
        {
            "id": REGRESSION_ID,
            "name": "sweep regression",
            "version": "1.0.0",
            "description": "",
            "suites": [],
            "tags": [],
            "variables": {
                "reg_token": {"type": "string", "value": REGRESSION_CANARY, "secret": True}
            },
            "metadata": {},
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
        },
    )
    _write_yaml(
        paths["regression_versions"],
        [
            {
                "version": "1.0.0",
                "created_at": "2026-01-01T00:00:00Z",
                "created_by": "system",
                "changes": "Initial version",
                "snapshot": {
                    "description": "",
                    "suites": [],
                    "variables": {
                        "reg_token": {
                            "type": "string",
                            "value": SNAPSHOT_CANARY,
                            "secret": True,
                        }
                    },
                },
            },
            {
                "version": "1.1.0",
                "created_at": "2026-01-02T00:00:00Z",
                "created_by": "system",
                "changes": "Updated",
                "snapshot": {
                    "description": "",
                    "suites": [],
                    "variables": {
                        "reg_token": {
                            "type": "string",
                            "value": SNAPSHOT_CANARY,
                            "secret": True,
                        }
                    },
                },
            },
        ],
    )
    _write_yaml(
        paths["profile"],
        {
            "id": PROFILE_ID,
            "name": "sweep profile",
            "type": "database",
            "config": {
                "host": "db.example.com",
                "port": 5432,
                "password": PROFILE_CANARY,
            },
            "environment_values": {"env-1": {"password": PROFILE_ENV_CANARY}},
            "tags": [],
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
        },
    )
    return paths


def _all_store_text(base: Path) -> str:
    return "\n".join(p.read_text() for p in sorted(base.rglob("*")) if p.is_file())


FUNCTION_TEST_ID = "77777777-7777-7777-7777-777777777777"
LIBRARY_FUNCTION_ID = "88888888-8888-8888-8888-888888888888"
FN_LOCAL_CANARY = "sweep-fn-local-canary-777"
FN_OUTPUT_CANARY = "sweep-fn-output-default-canary-778"
FN_INPUT_CANARY = "sweep-fn-input-literal-canary-779"
SHARED_INPUT_CANARY = "sweep-shared-fn-input-literal-canary-783"
DRAFT_LOCAL_CANARY = "sweep-draft-local-canary-780"
LIBRARY_LOCAL_CANARY = "sweep-library-local-canary-781"
LIBRARY_OUTPUT_CANARY = "sweep-library-output-default-canary-782"


def _secret_parameters_definition(local: str, output: str) -> dict[str, Any]:
    return {
        "inputs": [{"name": "tok", "type": "string", "secret": True}],
        "outputs": [{"name": "out_tok", "type": "string", "secret": True, "default": output}],
        "variables": [
            {"name": "local_tok", "type": "string", "value": local, "secret": True},
            {"name": "region", "type": "string", "value": "eu-west-1"},
        ],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": {"nodes": [], "edges": []},
    }


def _seed_function_secret_store(base: Path) -> dict[str, Path]:
    """Write a Test holding a Local, an edit-mode and a pinned Shared Function Block, and a
    library Function version, each with plaintext secret inputs and locals."""
    paths = {
        "test": base / "api_tests" / FUNCTION_TEST_ID / "test.yaml",
        "library_version": base / "functions" / LIBRARY_FUNCTION_ID / "versions" / "1.0.0.yaml",
    }
    local_block = {
        "id": "fn-local",
        "type": "workflowNode",
        "data": {
            "label": "Local Fn",
            "nodeType": "function",
            "functionLifecycle": "local",
            "config": {"values": {"tok": FN_INPUT_CANARY}},
            "localDefinition": _secret_parameters_definition(FN_LOCAL_CANARY, FN_OUTPUT_CANARY),
        },
    }
    shared_block = {
        "id": "fn-shared",
        "type": "workflowNode",
        "data": {
            "label": "Shared Fn",
            "nodeType": "function",
            "functionLifecycle": "shared",
            "functionId": LIBRARY_FUNCTION_ID,
            "functionVersion": "1.0.0",
            "config": {"values": {"tok": SHARED_INPUT_CANARY}},
        },
    }
    draft_block = {
        "id": "fn-draft",
        "type": "workflowNode",
        "data": {
            "label": "Draft Fn",
            "nodeType": "function",
            "functionLifecycle": "shared",
            "functionId": LIBRARY_FUNCTION_ID,
            "functionVersion": "1.0.0",
            "editMode": True,
            "draft": _secret_parameters_definition(DRAFT_LOCAL_CANARY, FN_OUTPUT_CANARY),
        },
    }
    test_doc = _entity_doc(FUNCTION_TEST_ID, "sweep function test", {})
    test_doc["workflow"] = {"nodes": [local_block, draft_block, shared_block], "edges": []}
    _write_yaml(paths["test"], test_doc)
    _write_yaml(
        base / "functions" / LIBRARY_FUNCTION_ID / "index.yaml",
        {
            "id": LIBRARY_FUNCTION_ID,
            "name": "sweep fn",
            "latest_version": "1.0.0",
            "available_versions": ["1.0.0"],
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
        },
    )
    _write_yaml(
        paths["library_version"],
        {
            "version": "1.0.0",
            "definition": _secret_parameters_definition(
                LIBRARY_LOCAL_CANARY, LIBRARY_OUTPUT_CANARY
            ),
            "metadata": {"description": "", "tags": [], "published_at": "2026-01-01T00:00:00Z"},
        },
    )
    return paths


def _read(path: Path) -> Any:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


class TestSealSweepSealsPlaintext:
    def test_every_plaintext_secret_leaf_is_sealed_in_place(self, temp_storage_path: Path) -> None:
        paths = _seed_plaintext_store(temp_storage_path)

        run_seal_sweep()

        store_text = _all_store_text(temp_storage_path)
        for canary in ALL_CANARIES:
            assert canary not in store_text

        with open(paths["system"], encoding="utf-8") as f:
            system = yaml.safe_load(f)
        assert is_secret_envelope(system["variables"]["api_token"]["value"])
        assert unseal_all(system["variables"]["api_token"]["value"]) == SYSTEM_CANARY
        assert system["variables"]["region"]["value"] == "eu-west-1"

        with open(paths["secret_test"], encoding="utf-8") as f:
            test_doc = yaml.safe_load(f)
        assert is_secret_envelope(test_doc["variables"]["db_password"]["value"])
        assert unseal_all(test_doc["variables"]["db_password"]["value"]) == TEST_CANARY
        assert test_doc["variables"]["host"]["value"] == "db.example.com"
        assert test_doc["name"] == "sweep secret test"
        assert test_doc["workflow"] == {"nodes": [], "edges": []}

        with open(paths["suite"], encoding="utf-8") as f:
            suite_doc = yaml.safe_load(f)
        assert unseal_all(suite_doc["variables"]["suite_token"]["value"]) == SUITE_CANARY

        with open(paths["regression"], encoding="utf-8") as f:
            regression_doc = yaml.safe_load(f)
        assert unseal_all(regression_doc["variables"]["reg_token"]["value"]) == REGRESSION_CANARY

        with open(paths["regression_versions"], encoding="utf-8") as f:
            versions_doc = yaml.safe_load(f)
        for entry in versions_doc:
            snapshot_value = entry["snapshot"]["variables"]["reg_token"]["value"]
            assert is_secret_envelope(snapshot_value)
            assert unseal_all(snapshot_value) == SNAPSHOT_CANARY

        with open(paths["profile"], encoding="utf-8") as f:
            profile_doc = yaml.safe_load(f)
        assert unseal_all(profile_doc["config"]["password"]) == PROFILE_CANARY
        assert (
            unseal_all(profile_doc["environment_values"]["env-1"]["password"]) == PROFILE_ENV_CANARY
        )
        assert profile_doc["config"]["host"] == "db.example.com"
        assert profile_doc["config"]["port"] == 5432

    def test_counts_reflect_sealed_and_skipped_files(self, temp_storage_path: Path) -> None:
        _seed_plaintext_store(temp_storage_path)

        result = run_seal_sweep()

        assert result["sealed"] == 6
        assert result["skipped"] == 1
        assert result["scanned"] >= result["sealed"] + result["skipped"]

    def test_function_local_secrets_are_sealed(self, temp_storage_path: Path) -> None:
        paths = _seed_function_secret_store(temp_storage_path)

        run_seal_sweep()

        text = paths["test"].read_text()
        for canary in (
            FN_LOCAL_CANARY,
            FN_OUTPUT_CANARY,
            FN_INPUT_CANARY,
            DRAFT_LOCAL_CANARY,
            SHARED_INPUT_CANARY,
        ):
            assert canary not in text
        local_data, draft_data, shared_data = (
            node["data"] for node in _read(paths["test"])["workflow"]["nodes"]
        )
        sealed = {
            FN_LOCAL_CANARY: local_data["localDefinition"]["variables"][0]["value"],
            FN_OUTPUT_CANARY: local_data["localDefinition"]["outputs"][0]["default"],
            FN_INPUT_CANARY: local_data["config"]["values"]["tok"],
            DRAFT_LOCAL_CANARY: draft_data["draft"]["variables"][0]["value"],
            SHARED_INPUT_CANARY: shared_data["config"]["values"]["tok"],
        }
        for plaintext, value in sealed.items():
            assert is_secret_envelope(value)
            assert unseal_all(value) == plaintext
        assert local_data["localDefinition"]["variables"][1]["value"] == "eu-west-1"

    def test_library_function_version_secrets_are_sealed(self, temp_storage_path: Path) -> None:
        paths = _seed_function_secret_store(temp_storage_path)

        run_seal_sweep()

        assert LIBRARY_LOCAL_CANARY not in paths["library_version"].read_text()
        assert LIBRARY_OUTPUT_CANARY not in paths["library_version"].read_text()
        definition = _read(paths["library_version"])["definition"]
        local_value = definition["variables"][0]["value"]
        output_default = definition["outputs"][0]["default"]
        assert is_secret_envelope(local_value)
        assert unseal_all(local_value) == LIBRARY_LOCAL_CANARY
        assert is_secret_envelope(output_default)
        assert unseal_all(output_default) == LIBRARY_OUTPUT_CANARY
        assert definition["variables"][1]["value"] == "eu-west-1"


class TestSealSweepIdempotence:
    def test_second_run_seals_nothing_and_changes_no_bytes(self, temp_storage_path: Path) -> None:
        _seed_plaintext_store(temp_storage_path)
        run_seal_sweep()
        first_pass = {
            p: p.read_bytes() for p in sorted(temp_storage_path.rglob("*")) if p.is_file()
        }

        second = run_seal_sweep()

        assert second["sealed"] == 0
        for path, content in first_pass.items():
            assert path.read_bytes() == content

    def test_sealed_function_secrets_stay_byte_identical_on_a_second_run(
        self, temp_storage_path: Path
    ) -> None:
        paths = _seed_function_secret_store(temp_storage_path)
        first = run_seal_sweep()
        first_pass = {name: path.read_bytes() for name, path in paths.items()}

        second = run_seal_sweep()

        assert first["sealed"] == 2
        assert second["sealed"] == 0
        assert {name: path.read_bytes() for name, path in paths.items()} == first_pass


class TestSealSweepResilience:
    def test_unparsable_file_is_skipped_logged_and_left_untouched(
        self, temp_storage_path: Path, caplog: pytest.LogCaptureFixture
    ) -> None:
        paths = _seed_plaintext_store(temp_storage_path)
        corrupt_bytes = paths["corrupt_test"].read_bytes()

        with caplog.at_level(logging.WARNING):
            result = run_seal_sweep()

        assert result["skipped"] == 1
        assert paths["corrupt_test"].read_bytes() == corrupt_bytes
        assert str(paths["corrupt_test"]) in caplog.text
        # The rest of the store still converged
        assert TEST_CANARY not in _all_store_text(temp_storage_path)

    def test_files_without_secrets_stay_byte_identical(self, temp_storage_path: Path) -> None:
        paths = _seed_plaintext_store(temp_storage_path)
        plain_before = paths["plain_test"].read_bytes()
        versions_before = paths["test_versions"].read_bytes()

        run_seal_sweep()

        assert paths["plain_test"].read_bytes() == plain_before
        assert paths["test_versions"].read_bytes() == versions_before
