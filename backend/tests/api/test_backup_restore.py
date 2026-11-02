"""The restore of a backup through its plan: identity, choices, links, isolation, results."""

import logging
import os
import re
import zipfile
from collections.abc import Sequence
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Any

import pytest
import yaml

from tests.api.backup_support import (  # noqa: F401
    MAKERS,
    PARTS,
    ROUND_TRIP_FNA_BLOCK,
    ROUND_TRIP_FNB_BLOCK,
    ROUND_TRIP_NESTED_BLOCK,
    SAMPLE_CSV,
    UNKNOWN_TYPE_SSH_KEY,
    UNREADABLE_SSH_KEY,
    Document,
    RoundTrip,
    apply_plan,
    backup,
    build_plan,
    certificate_entry,
    data_files,
    disk_state,
    empty_store_fixture,
    function_block,
    function_version,
    function_versions,
    history_row,
    local_function_block,
    log_block,
    make_environment,
    make_function,
    make_profile,
    make_regression,
    make_suite,
    make_test,
    preview_of,
    profile_binding,
    regression_snapshot,
    round_trip_fixture,
    seed,
    setter_block,
    ssh_entry,
    stored,
    stored_history,
    system_variables,
    typed,
    unreadable_certificate_entry,
    wipe_store,
    with_history,
)
from wavecore.api.exceptions import ConflictException
from wavecore.api.services import storage_paths, variable_service
from wavecore.api.services.backup.service import restore_backup, validate_backup
from wavecore.api.services.environments import service as environment_service
from wavecore.api.services.functions import import_export as function_import_export
from wavecore.api.services.functions import service as function_service
from wavecore.api.services.network import certificates, ssh_hosts
from wavecore.api.services.profiles import service as profile_service
from wavecore.api.services.regressions import service as regression_service
from wavecore.api.services.relations import service as relation_service
from wavecore.api.services.shared import is_foreign_envelope
from wavecore.api.services.suites import service as suite_service
from wavecore.api.services.tests import service as test_service
from wavecore.api.services.tests import testdata_service
from wavecore.core.secrets.cipher import SecretCipher
from wavecore.core.secrets.masking import MASK_PLACEHOLDER
from wavecore.core.secrets.sealing import unseal_all

pytestmark = pytest.mark.usefixtures("empty_store")

FIVE = ("tests", "suites", "regressions", "environments", "profiles")
WITH_HISTORY = ("tests", "suites", "regressions")
ID_PARTS = ("tests", "environments", "profiles", "suites", "regressions", "functions")
RESTORE_ORDER = [
    "system_variables",
    "environments",
    "profiles",
    "functions",
    "tests",
    "suites",
    "regressions",
    "ssh_hosts",
    "certificates",
]
IDENTITY_FIELDS = {
    "tests": ("name", "description", "metadata", "version"),
    "suites": ("name", "description", "tags", "version"),
    "regressions": ("name", "description", "tags", "version"),
    "environments": ("name", "description", "tags"),
    "profiles": ("name", "description", "tags"),
}
WRITERS: dict[str, tuple[Any, str, str]] = {
    "tests": (test_service, "persist_test_document", "test_data"),
    "suites": (suite_service, "persist_suite_document", "suite_data"),
    "regressions": (regression_service, "persist_regression_document", "regression_data"),
    "environments": (environment_service, "persist_environment_document", "env_data"),
    "profiles": (profile_service, "persist_profile_document", "profile_data"),
}
OTHER_WRITE_POINTS: dict[str, tuple[Any, str]] = {
    "system_variables": (variable_service, "set_system_variables"),
    "functions": (function_import_export, "commit_decisions"),
    "ssh_hosts": (ssh_hosts, "restore_entries"),
    "certificates": (certificates, "restore_certificates"),
}

ALREADY_HERE = r"^Already in this WAVE$"
NAME_IN_USE = r"^Name already in use$"
HAS_NO_TYPE = r"^Has no type$"
CANNOT_BE_READ = r"^Cannot be read$"
UNREADABLE_KEY = r"^Unreadable key$"
NOT_A_VALID_CERTIFICATE = r"^Not a valid certificate$"
MISSING_SUITE = r"^Uses a Suite that is not in this WAVE$"
UNNAMED_FUNCTION = r"^Uses a Function that is not in this WAVE$"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _missing_function(block: str) -> str:
    return rf'^Uses Function "{re.escape(block)}", which is not in this WAVE$'


def _could_not_be_written(error: str) -> str:
    return rf"^Could not be written: {re.escape(error)}$"


def _restore(
    entities: dict[str, list[Document]],
    files: dict[str, list[tuple[str, bytes]]] | None = None,
    **options: Any,
) -> Document:
    """Plan the parsed parts and run the plan."""
    return apply_plan(build_plan(entities, **options), files)


def _assert_part(
    part: Document,
    *,
    imported: int = 0,
    skipped: int = 0,
    fatal: int = 0,
    items: Sequence[tuple[str, str, str]] = (),
) -> None:
    """A result part has these counts and, fatal first, these entries: name, status, pattern."""
    assert set(part) == {"imported", "skipped", "fatal", "items"}
    assert (part["imported"], part["skipped"], part["fatal"]) == (imported, skipped, fatal)
    entries = part["items"]
    assert all(set(entry) == {"name", "status", "reason"} for entry in entries), entries
    expected = {name: (status, pattern) for name, status, pattern in items}
    assert sorted(entry["name"] for entry in entries) == sorted(expected), entries
    statuses = [entry["status"] for entry in entries]
    assert statuses == sorted(statuses, key=("fatal", "skipped").index), statuses
    for entry in entries:
        status, pattern = expected[entry["name"]]
        assert entry["status"] == status, entry
        assert re.fullmatch(pattern, entry["reason"]), entry


def _rich(
    part: str,
    name: str = "From the backup",
    item_id: str = "item-1",
    note: str = "Written by the backup",
    version: str = "2.3.0",
) -> Document:
    """An item with a description, a tag and, where its type has one, a version."""
    if part == "tests":
        return make_test(
            name,
            item_id,
            [log_block()],
            description=note,
            metadata={"tags": ["nightly"], "owner": "ashley"},
            version=version,
        )
    if part in WITH_HISTORY:
        return MAKERS[part](name, item_id, description=note, tags=["nightly"], version=version)
    return MAKERS[part](name, item_id, description=note, tags=["nightly"])


def _rows(part: str) -> list[Document]:
    """Three history rows; the first and the last of a Regression carry a snapshot."""
    snapshots = part == "regressions"
    return [
        history_row(
            "1.0.0",
            snapshot=(
                regression_snapshot([], "First cut", {"region": typed("eu")}) if snapshots else None
            ),
        ),
        history_row("1.1.0", "Second cut", created_at="2026-03-03T10:00:00.000001+00:00"),
        history_row(
            "2.3.0",
            "Third cut",
            created_at="2026-03-04T11:00:00.000002+00:00",
            snapshot=regression_snapshot([], "Third cut") if snapshots else None,
        ),
    ]


def _member(part: str, document: Document) -> Document:
    """The document as an archive member: a Test, Suite or Regression carries its history rows."""
    return with_history(document, _rows(part)) if part in WITH_HISTORY else document


def _here(part: str, document: Document) -> None:
    """Store an item with what its type keeps beside it: one history row, one data file."""
    rows = [history_row(document["version"], "Made here")] if part in WITH_HISTORY else []
    files = [("here.csv", b"here")] if part == "tests" else []
    seed(part, document, rows, files)


def _fields(document: Document, names: Sequence[str]) -> Document:
    return {name: document[name] for name in names}


def _every_part() -> dict[str, list[Document]]:
    """One item per part that restores on an empty store, linked to each other."""
    return {
        "tests": [make_test("A test", "t-1", [log_block()])],
        "environments": [make_environment("An environment", "env-1")],
        "profiles": [make_profile("A profile", "p-1", {"env-1": {"host": typed("db1")}})],
        "suites": [make_suite("A suite", "s-1", ["t-1"])],
        "regressions": [make_regression("A regression", "r-1", ["s-1"])],
        "functions": [make_function("Fn", "fn-1", [function_version("1.0.0", [log_block()])])],
        "system_variables": [system_variables()],
        "ssh_hosts": [ssh_entry()],
        "certificates": [certificate_entry()],
    }


def _fail_writer(
    monkeypatch: pytest.MonkeyPatch, part: str, item_id: str, error: Exception
) -> None:
    """Make the part's writer raise for one item and write every other item as usual."""
    module, name, first = WRITERS[part]
    real = getattr(module, name)

    def writer(*args: Any, **kwargs: Any) -> Any:
        document = args[0] if args else kwargs[first]
        if document["id"] == item_id:
            raise error
        return real(*args, **kwargs)

    monkeypatch.setattr(module, name, writer)


def _spy(
    monkeypatch: pytest.MonkeyPatch, module: Any, name: str, calls: list[str], mark: str
) -> None:
    """Make a public function add ``mark`` to ``calls`` on each call and still do its work."""
    real = getattr(module, name)

    def spy(*args: Any, **kwargs: Any) -> Any:
        calls.append(mark)
        return real(*args, **kwargs)

    monkeypatch.setattr(module, name, spy)


def _sealed_elsewhere() -> str:
    """A secret envelope sealed by another WAVE."""
    return SecretCipher(os.urandom(32)).seal("sealed by another WAVE")


def _masked(part: str = "tests") -> Document:
    """A masked secret as an archive holds it; outside a Profile it carries the ``masked`` flag."""
    declared = typed(MASK_PLACEHOLDER, secret=True)
    return declared if part == "profiles" else declared | {"masked": True}


def _holds(part: str, declared: Document) -> Document:
    """An item whose secret is ``declared``: a variable, or both secret fields of a Profile."""
    if part == "profiles":
        return make_profile(
            "Holds a secret",
            "item-1",
            {"env-1": {"password": declared}},
            config={"token": declared},
        )
    if part == "tests":
        return make_test("Holds a secret", "item-1", [log_block()], variables={"token": declared})
    return MAKERS[part]("Holds a secret", "item-1", variables={"token": declared})


def _opened_secrets(part: str) -> list[Any]:
    """The secret values the item of ``_holds`` stores, opened where this WAVE sealed them."""
    document = stored(part)["item-1"]
    if part == "profiles":
        values = [
            document["config"]["token"]["value"],
            document["environment_values"]["env-1"]["password"]["value"],
        ]
    else:
        values = [document["variables"]["token"]["value"]]
    return [unseal_all(value) for value in values]


def _sets_token(value: Any) -> Document:
    """A Test whose Variable Setter block writes ``value`` as a secret literal."""
    return make_test(
        "Sets a secret",
        "item-1",
        [setter_block("set", "Set token", {"token": value}, ["token"])],
        variables={"token": typed("", secret=True)},
    )


def _opened_setter_literal() -> Any:
    """The secret literal the Test of ``_sets_token`` stores, opened where this WAVE sealed it."""
    block = stored("tests")["item-1"]["workflow"]["nodes"][0]
    return unseal_all(block["data"]["config"]["values"]["variables"]["token"])


_PLACE_PART = {
    "test workflow": "tests",
    "regression history snapshot": "regressions",
    "profile config and environment": "profiles",
    "system variable": "system_variables",
}


def _entities_holding(place: str, declared: Document) -> dict[str, list[Document]]:
    """The parts of a backup whose one secret, ``declared``, sits at ``place`` of a new item."""
    if place == "regression history snapshot":
        snapshot = regression_snapshot([], variables={"token": declared})
        regression = make_regression("A regression", "item-1")
        return {"regressions": [with_history(regression, [history_row(snapshot=snapshot)])]}
    if place == "profile config and environment":
        return {
            "environments": [make_environment("An environment", "env-1")],
            "profiles": [_holds("profiles", declared)],
        }
    return {"system_variables": [system_variables({"token": declared})]}


def _opened(value: Any) -> Any:
    """A stored secret opened where this WAVE sealed it; one sealed elsewhere comes back as is."""
    return value if is_foreign_envelope(value) else unseal_all(value)


def _opened_place_values(place: str) -> list[Any]:
    """The secret values ``place`` stores, opened where this WAVE sealed them."""
    if place == "test workflow":
        block = stored("tests")["item-1"]["workflow"]["nodes"][0]
        return [_opened(block["data"]["config"]["values"]["variables"]["token"])]
    if place == "regression history snapshot":
        (row,) = stored_history("regressions")["item-1"]
        return [_opened(row["snapshot"]["variables"]["token"]["value"])]
    if place == "profile config and environment":
        profile = stored("profiles")["item-1"]
        return [
            _opened(profile["config"]["token"]["value"]),
            _opened(profile["environment_values"]["env-1"]["password"]["value"]),
        ]
    here = variable_service.get_system_variables_raw()["variables"]
    return [_opened(here["token"]["value"])]


def _opened_place_value(place: str) -> Any:
    (value,) = _opened_place_values(place)
    return value


def _members(content: bytes) -> dict[str, Any]:
    """Every member of an archive but the manifest: documents parsed, data files as bytes."""
    with zipfile.ZipFile(BytesIO(content)) as zf:
        return {
            name: (
                zf.read(name)
                if name.startswith("tests/testdata/")
                else yaml.safe_load(zf.read(name))
            )
            for name in zf.namelist()
            if name != "manifest.json"
        }


# ---------------------------------------------------------------------------
# Identity
# ---------------------------------------------------------------------------


class TestRestoreKeepsIdentity:
    """A restored item comes back as itself (REQ-5.2.4.9.5)."""

    @pytest.mark.parametrize("part", FIVE)
    def test_an_item_comes_back_with_its_id_name_description_tags_and_version(
        self, part: str
    ) -> None:
        document = _rich(part)

        result = _restore({part: [document]})

        _assert_part(result[part], imported=1)
        assert list(stored(part)) == ["item-1"]
        fields = IDENTITY_FIELDS[part]
        assert _fields(stored(part)["item-1"], fields) == _fields(document, fields)

    @pytest.mark.parametrize("part", WITH_HISTORY)
    def test_the_version_history_comes_back_row_for_row(self, part: str) -> None:
        rows = _rows(part)

        _restore({part: [_member(part, _rich(part))]})

        assert stored_history(part) == {"item-1": rows}

    @pytest.mark.parametrize("part", WITH_HISTORY)
    def test_a_member_without_version_history_is_written_with_no_history_rows(
        self, part: str
    ) -> None:
        result = _restore({part: [_rich(part)]})

        _assert_part(result[part], imported=1)
        assert stored_history(part) == {"item-1": []}

    @pytest.mark.parametrize("part", FIVE)
    def test_the_timestamps_come_back_as_the_text_in_the_archive(self, part: str) -> None:
        offset = "+00:00" if part in WITH_HISTORY else "Z"
        created = f"2021-05-06T07:08:09.101112{offset}"
        updated = f"2022-06-07T08:09:10.111213{offset}"

        _restore({part: [_rich(part) | {"created_at": created, "updated_at": updated}]})

        written = stored(part)["item-1"]
        assert (written["created_at"], written["updated_at"]) == (created, updated)

    def test_a_tests_data_files_land_under_the_id_the_test_got(self) -> None:
        seed("tests", make_test("Here", "t-taken", [log_block()]), files=[("here.csv", b"here")])
        entities = {
            "tests": [
                make_test("Free id", "t-free", [log_block()]),
                make_test("Taken id", "t-taken", [log_block()]),
            ]
        }
        files = {"t-free": [("sample.csv", b"free")], "t-taken": [("dir/nested.csv", b"taken")]}

        result = _restore(entities, files, conflict_resolution="rename")

        _assert_part(result["tests"], imported=2)
        (new_id,) = set(stored("tests")) - {"t-free", "t-taken"}
        assert data_files("t-free") == {"sample.csv": b"free"}
        assert data_files(new_id) == {"dir/nested.csv": b"taken"}
        assert data_files("t-taken") == {"here.csv": b"here"}

    def test_an_item_without_an_id_is_written_under_a_new_id(self) -> None:
        entities = {
            part: [{key: value for key, value in _rich(part).items() if key != "id"}]
            for part in FIVE
        }

        result = _restore(entities)

        for part in FIVE:
            _assert_part(result[part], imported=1)
            ((new_id, written),) = stored(part).items()
            assert isinstance(new_id, str) and new_id, part
            assert written["name"] == "From the backup", part

    def test_a_suite_whose_variable_type_clashes_with_another_suite_is_restored(self) -> None:
        seed("tests", make_test("Shared test", "t-1", [log_block()]))
        seed("suites", make_suite("Here", "s-here", ["t-1"], variables={"region": typed("eu")}))
        clashing = make_suite(
            "From the backup", "s-backup", ["t-1"], variables={"region": typed(3, "integer")}
        )
        plan = build_plan({"suites": [clashing]})

        result = apply_plan(plan)

        row = preview_of(plan)["suites"]
        assert (row["ok"], row["conflicts"], row["fixable"], row["fatal"]) == (1, 0, 0, 0)
        _assert_part(result["suites"], imported=1)
        assert stored("suites")["s-backup"] == clashing


# ---------------------------------------------------------------------------
# The three choices
# ---------------------------------------------------------------------------


class TestRestoreChoices:
    """One choice decides every conflict: skip, overwrite or rename (REQ-5.2.4.9.5)."""

    @pytest.mark.parametrize("part", FIVE)
    def test_skip_leaves_the_item_here_untouched(self, part: str) -> None:
        _here(part, _rich(part, "Here", note="Made here", version="1.0.0"))
        before = disk_state()
        files = {"item-1": [("new.csv", b"new")]} if part == "tests" else None

        result = _restore({part: [_member(part, _rich(part))]}, files)

        _assert_part(result[part], skipped=1, items=[("From the backup", "skipped", ALREADY_HERE)])
        assert disk_state() == before

    @pytest.mark.parametrize("part", FIVE)
    def test_overwrite_keeps_the_id_here_and_takes_the_whole_backup_content(
        self, part: str
    ) -> None:
        _here(part, _rich(part, "Here", note="Made here", version="1.0.0"))
        incoming = _rich(part)
        files = {"item-1": [("new.csv", b"new")]} if part == "tests" else None

        result = _restore({part: [_member(part, incoming)]}, files, conflict_resolution="overwrite")

        _assert_part(result[part], imported=1)
        assert stored(part) == {"item-1": incoming}
        if part in WITH_HISTORY:
            assert stored_history(part) == {"item-1": _rows(part)}
        if part == "tests":
            assert data_files("item-1") == {"new.csv": b"new"}

    def test_overwrite_matches_by_name_when_no_id_matches(self) -> None:
        incoming = {part: _rich(part, "Same name", "backup-1") for part in FIVE}
        for part in FIVE:
            seed(part, _rich(part, "Same name", "here-1", "Made here"))

        result = _restore(
            {part: [incoming[part]] for part in FIVE}, conflict_resolution="overwrite"
        )

        for part in FIVE:
            _assert_part(result[part], imported=1)
            assert stored(part) == {"here-1": incoming[part] | {"id": "here-1"}}, part

    @pytest.mark.parametrize("part", FIVE)
    @pytest.mark.parametrize("incoming_id", ["backup-1", "here-1"], ids=["id free", "id taken"])
    def test_rename_writes_the_item_beside_the_one_here(self, part: str, incoming_id: str) -> None:
        here = _rich(part, "Same name", "here-1", "Made here")
        seed(part, here)
        incoming = _rich(part, "Same name", incoming_id)

        result = _restore({part: [incoming]}, conflict_resolution="rename")

        _assert_part(result[part], imported=1)
        after = stored(part)
        assert after["here-1"] == here
        (new_id,) = set(after) - {"here-1"}
        assert after[new_id] == incoming | {"id": new_id, "name": "Same name (2)"}
        if incoming_id == "backup-1":
            assert new_id == "backup-1"
        else:
            assert isinstance(new_id, str) and new_id

    def test_a_second_rename_takes_3(self) -> None:
        for part in FIVE:
            seed(part, _rich(part, "Same name", "here-1"))
            seed(part, _rich(part, "Same name (2)", "here-2"))

        result = _restore(
            {part: [_rich(part, "Same name", "backup-1")] for part in FIVE},
            conflict_resolution="rename",
        )

        for part in FIVE:
            _assert_part(result[part], imported=1)
            assert stored(part)["backup-1"]["name"] == "Same name (3)", part

    def test_overwrite_of_a_profile_bound_by_tests_replaces_it(self) -> None:
        seed("profiles", make_profile("Bound", "p-1", config={"host": typed("db-old")}))
        bound = log_block(bindings=[profile_binding("p-1", "Bound")])
        seed("tests", make_test("Binds it", "t-1", [bound]))
        incoming = make_profile("Bound", "p-1", config={"port": typed(5432, "integer")})
        with pytest.raises(
            ConflictException,
            match=r"^Cannot add, remove, or rename parameters of a profile in use by 1 test\(s\)$",
        ):
            profile_service.update_profile("p-1", config=incoming["config"])

        result = _restore({"profiles": [incoming]}, conflict_resolution="overwrite")

        _assert_part(result["profiles"], imported=1)
        assert stored("profiles") == {"p-1": incoming}


# ---------------------------------------------------------------------------
# Links
# ---------------------------------------------------------------------------


class TestRestoreLinks:
    """Every restored item points at what its target became (REQ-5.2.4.9.5)."""

    @pytest.mark.parametrize(
        ("choice", "here_id", "became"),
        [
            ("skip", None, "t-backup"),
            ("skip", "t-here", "t-here"),
            ("overwrite", "t-here", "t-here"),
            ("rename", "t-backup", None),
        ],
        ids=["no conflict", "skip", "overwrite", "rename"],
    )
    def test_a_suite_points_at_what_its_tests_became(
        self, choice: str, here_id: str | None, became: str | None
    ) -> None:
        if here_id is not None:
            seed("tests", make_test("Shared name", here_id, [log_block()]))
        entities = {
            "tests": [make_test("Shared name", "t-backup", [log_block()])],
            "suites": [make_suite("A suite", "s-1", ["t-backup"])],
        }

        _restore(entities, conflict_resolution=choice)

        if became is None:
            (became,) = set(stored("tests")) - {"t-backup"}
            assert isinstance(became, str) and became
        assert became in stored("tests")
        assert stored("suites")["s-1"]["tests"] == [became]

    def test_a_regression_and_its_history_point_at_what_its_suites_became(self) -> None:
        seed("suites", make_suite("Shared name", "s-1"))
        rows = [
            history_row("1.0.0", snapshot=regression_snapshot(["s-1"], "First cut")),
            history_row("1.1.0", "No snapshot"),
            history_row("1.2.0", "Third cut", snapshot=regression_snapshot(["s-1"], "Third cut")),
        ]
        entities = {
            "suites": [make_suite("Shared name", "s-1")],
            "regressions": [with_history(make_regression("A regression", "r-1", ["s-1"]), rows)],
        }

        _restore(entities, conflict_resolution="rename")

        (new_suite,) = set(stored("suites")) - {"s-1"}
        assert stored("regressions")["r-1"]["suites"] == [new_suite]
        written = stored_history("regressions")["r-1"]
        assert [row.get("snapshot", {}).get("suites") for row in written] == [
            [new_suite],
            None,
            [new_suite],
        ]

    def test_a_test_points_at_the_function_and_the_profile_it_was_restored_with(self) -> None:
        library = make_function("Lib", "fn-1", [function_version("1.0.0", [log_block()])])
        profile = make_profile("Prof", "p-1")
        seed("functions", library)
        seed("profiles", profile)
        test = make_test(
            "Uses both",
            "t-1",
            [
                function_block("call", "Call Lib", "fn-1"),
                log_block("bound", "Bound log", bindings=[profile_binding("p-1", "Prof")]),
                local_function_block(
                    "local", "Local step", [function_block("inner", "Inner call", "fn-1")]
                ),
            ],
        )

        result = _restore(
            {"functions": [library], "profiles": [profile], "tests": [test]},
            conflict_resolution="rename",
        )

        _assert_part(result["tests"], imported=1)
        (new_function,) = set(stored("functions")) - {"fn-1"}
        (new_profile,) = set(stored("profiles")) - {"p-1"}
        call, bound, local = (node["data"] for node in stored("tests")["t-1"]["workflow"]["nodes"])
        (inner,) = local["localDefinition"]["workflow"]["nodes"]
        assert call["functionId"] == new_function
        assert inner["data"]["functionId"] == new_function
        bindings = bound["config"]["profileBindings"]
        assert [binding["profileId"] for binding in bindings] == [new_profile]

    def test_a_profile_keys_its_values_by_what_its_environments_became(self) -> None:
        seed("environments", make_environment("Staging", "env-1"))
        values = {"host": typed("db1")}
        entities = {
            "environments": [make_environment("Staging", "env-1")],
            "profiles": [make_profile("A profile", "p-1", {"env-1": values})],
        }

        _restore(entities, conflict_resolution="rename")

        (new_environment,) = set(stored("environments")) - {"env-1"}
        assert stored("profiles")["p-1"]["environment_values"] == {new_environment: values}


# ---------------------------------------------------------------------------
# One failing item never stops the restore
# ---------------------------------------------------------------------------


class TestRestoreNeverStops:
    """An item that cannot be restored is left out and named; the rest restores (REQ-5.2.4.9.6)."""

    @pytest.mark.parametrize(
        ("error_class", "extra"),
        [
            (test_service.SaveValidationError, {}),
            (function_service.SaveValidationError, {"severity": "error"}),
        ],
        ids=["tests service", "functions service"],
    )
    def test_a_save_validation_error_at_write_time_gives_the_reason_of_its_first_finding(
        self, monkeypatch: pytest.MonkeyPatch, error_class: type[Exception], extra: Document
    ) -> None:
        finding = {
            "code": "MISSING_FUNCTION_ID",
            "message": "References unknown Function 'fn-gone'",
            "node_id": "call",
            "node_label": "Call it",
            "function_id": "fn-gone",
            "function_version": "1.0.0",
        } | extra
        seed("functions", make_function("Gone", "fn-gone"))
        entities = {
            "tests": [
                make_test("Fails", "t-fails", [function_block("call", "Call it", "fn-gone")]),
                make_test("Fine", "t-fine", [log_block()]),
            ]
        }
        plan = build_plan(entities)
        _fail_writer(monkeypatch, "tests", "t-fails", error_class([finding]))

        result = apply_plan(plan)

        _assert_part(
            result["tests"],
            imported=1,
            fatal=1,
            items=[("Fails", "fatal", _missing_function("Call it"))],
        )
        assert list(stored("tests")) == ["t-fine"]

    def test_a_write_time_finding_of_a_nameless_block_names_no_block(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        finding = {
            "code": "MISSING_FUNCTION_ID",
            "message": "References unknown Function 'fn-gone'",
            "node_id": "call",
            "node_label": "call",
            "function_id": "fn-gone",
            "function_version": "1.0.0",
        }
        seed("functions", make_function("Gone", "fn-gone"))
        nameless = local_function_block("local", "Local", [function_block("call", "", "fn-gone")])
        plan = build_plan({"tests": [make_test("Fails", "t-fails", [nameless])]})
        _fail_writer(monkeypatch, "tests", "t-fails", test_service.SaveValidationError([finding]))

        result = apply_plan(plan)

        _assert_part(result["tests"], fatal=1, items=[("Fails", "fatal", UNNAMED_FUNCTION)])
        assert stored("tests") == {}

    def test_a_wave_exception_makes_one_item_fatal_with_its_message(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        entities = {"profiles": [make_profile("Fails", "p-fails"), make_profile("Fine", "p-fine")]}
        plan = build_plan(entities)
        _fail_writer(monkeypatch, "profiles", "p-fails", ConflictException("Disk says no"))

        result = apply_plan(plan)

        _assert_part(
            result["profiles"],
            imported=1,
            fatal=1,
            items=[("Fails", "fatal", _could_not_be_written("Disk says no"))],
        )
        assert list(stored("profiles")) == ["p-fine"]

    @pytest.mark.parametrize(
        ("error", "text"),
        [(RuntimeError("boom on write"), "boom on write"), (RuntimeError(), "RuntimeError")],
        ids=["its text", "its class name when the text is empty"],
    )
    def test_any_other_exception_makes_one_item_fatal_with_its_text(
        self, monkeypatch: pytest.MonkeyPatch, error: Exception, text: str
    ) -> None:
        entities = {"suites": [make_suite("Fails", "s-fails"), make_suite("Fine", "s-fine")]}
        plan = build_plan(entities)
        _fail_writer(monkeypatch, "suites", "s-fails", error)

        result = apply_plan(plan)

        _assert_part(
            result["suites"],
            imported=1,
            fatal=1,
            items=[("Fails", "fatal", _could_not_be_written(text))],
        )
        assert list(stored("suites")) == ["s-fine"]

    def test_the_failure_is_logged_at_error_with_the_part_the_item_and_the_error(
        self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ) -> None:
        plan = build_plan({"environments": [make_environment("Staging lab", "env-1")]})
        _fail_writer(monkeypatch, "environments", "env-1", RuntimeError("disk full on shelf 7"))
        caplog.set_level(logging.ERROR)

        apply_plan(plan)

        lines = [
            record.getMessage()
            for record in caplog.records
            if record.levelno == logging.ERROR and "Staging lab" in record.getMessage()
        ]
        assert len(lines) == 1, lines
        assert "environments" in lines[0]
        assert "disk full on shelf 7" in lines[0]

    def test_a_new_item_whose_write_failed_leaves_nothing_behind(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        plan = build_plan({"tests": [make_test("Half written", "t-1", [log_block()])]})
        write_files = testdata_service.write_files

        def write_then_fail(test_id: str, entries: Any) -> int:
            write_files(test_id, entries)
            raise OSError("disk full")

        monkeypatch.setattr(testdata_service, "write_files", write_then_fail)

        result = apply_plan(plan, {"t-1": [("sample.csv", b"1")]})

        _assert_part(
            result["tests"],
            fatal=1,
            items=[("Half written", "fatal", _could_not_be_written("disk full"))],
        )
        assert not (storage_paths.get_tests_storage_path() / "t-1").exists()
        assert not storage_paths.get_test_testdata_path("t-1").exists()
        assert stored("tests") == {}
        assert test_service.list_tests()["tests"] == []

    def test_items_that_point_at_a_failed_item_are_written_as_planned(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        entities = {
            "tests": [make_test("Fails", "t-1", [log_block()])],
            "suites": [make_suite("A suite", "s-1", ["t-1"])],
        }
        plan = build_plan(entities)
        _fail_writer(monkeypatch, "tests", "t-1", RuntimeError("boom"))

        result = apply_plan(plan)

        _assert_part(
            result["tests"], fatal=1, items=[("Fails", "fatal", _could_not_be_written("boom"))]
        )
        _assert_part(result["suites"], imported=1)
        assert stored("suites")["s-1"]["tests"] == ["t-1"]

    def test_the_answer_carries_every_ticked_part(self, monkeypatch: pytest.MonkeyPatch) -> None:
        plan = build_plan(_every_part())
        _fail_writer(monkeypatch, "environments", "env-1", RuntimeError("boom"))

        result = apply_plan(plan)

        assert set(result) == set(PARTS)
        assert result["environments"]["fatal"] == 1

    def test_items_restored_before_a_failure_stay(self, monkeypatch: pytest.MonkeyPatch) -> None:
        entities = {
            "environments": [make_environment("An environment", "env-1")],
            "tests": [
                make_test("First", "t-1", [log_block()]),
                make_test("Fails", "t-2", [log_block()]),
                make_test("Third", "t-3", [log_block()]),
            ],
        }
        plan = build_plan(entities)
        _fail_writer(monkeypatch, "tests", "t-2", RuntimeError("boom"))

        result = apply_plan(plan)

        _assert_part(
            result["tests"],
            imported=2,
            fatal=1,
            items=[("Fails", "fatal", _could_not_be_written("boom"))],
        )
        assert set(stored("environments")) == {"env-1"}
        assert set(stored("tests")) == {"t-1", "t-3"}

    def test_an_overwritten_test_whose_data_files_fail_is_fatal(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        seed("tests", make_test("Here", "t-1", [log_block()]), files=[("here.csv", b"here")])
        plan = build_plan(
            {"tests": [make_test("From the backup", "t-1", [log_block()])]},
            conflict_resolution="overwrite",
        )

        def fail(test_id: str, entries: Any) -> int:
            raise OSError("disk full")

        monkeypatch.setattr(testdata_service, "write_files", fail)

        result = apply_plan(plan, {"t-1": [("new.csv", b"new")]})

        _assert_part(
            result["tests"],
            fatal=1,
            items=[("From the backup", "fatal", _could_not_be_written("disk full"))],
        )

    def test_a_member_that_cannot_be_parsed_is_named_and_the_rest_restores(self) -> None:
        plan = build_plan(
            {"tests": [make_test("Readable", "t-1", [log_block()])]},
            unreadable={"tests": ["bad.json"]},
        )

        result = apply_plan(plan)

        _assert_part(
            result["tests"], imported=1, fatal=1, items=[("bad.json", "fatal", CANNOT_BE_READ)]
        )
        assert list(stored("tests")) == ["t-1"]

    def test_a_test_whose_function_is_not_in_the_archive_is_fatal_and_the_rest_restores(
        self, round_trip: RoundTrip, temp_storage_path: Path
    ) -> None:
        content = backup([part for part in PARTS if part != "functions"])
        wipe_store(temp_storage_path)

        result = restore_backup(content, "backup.zip")

        _assert_part(
            result["tests"],
            imported=1,
            fatal=2,
            items=[
                ("T uses FnB", "fatal", _missing_function(ROUND_TRIP_FNB_BLOCK)),
                ("T nested", "fatal", _missing_function(ROUND_TRIP_NESTED_BLOCK)),
            ],
        )
        assert list(stored("tests")) == [round_trip.test_plain]
        for part in ("environments", "profiles", "suites", "regressions"):
            _assert_part(result[part], imported=1)
        assert stored("suites")[round_trip.suite]["tests"] == [
            round_trip.test_fn_b,
            round_trip.test_nested,
            round_trip.test_plain,
        ]
        assert list(stored("regressions")) == [round_trip.regression]


# ---------------------------------------------------------------------------
# The answer
# ---------------------------------------------------------------------------


class TestRestoreResult:
    """The answer names every skipped item and every item it could not restore (REQ-5.2.4.9.6)."""

    def test_a_part_reads_imported_skipped_fatal_and_items(self) -> None:
        result = _restore(_every_part())

        assert set(result) == set(PARTS)
        for part in PARTS:
            _assert_part(result[part], imported=1)

    def test_items_hold_only_skipped_and_fatal_entries_fatal_first(self) -> None:
        seed("tests", make_test("Kept", "t-here", [log_block()]))
        entities = {
            "tests": [
                make_test("Kept", "t-here", [log_block()]),
                make_test("Fine", "t-fine", [log_block()]),
                make_test("Broken", "t-broken", [function_block("call", "Call it", "fn-gone")]),
            ]
        }
        plan = build_plan(entities)

        result = apply_plan(plan)

        _assert_part(
            result["tests"],
            imported=1,
            skipped=1,
            fatal=1,
            items=[
                ("Broken", "fatal", _missing_function("Call it")),
                ("Kept", "skipped", ALREADY_HERE),
            ],
        )
        texts = {item.name: item.result_reason for item in plan.parts["tests"]}
        assert [entry["reason"] for entry in result["tests"]["items"]] == [
            texts["Broken"],
            texts["Kept"],
        ]
        broken = next(item for item in plan.parts["tests"] if item.name == "Broken")
        assert broken.reason != broken.result_reason

    def test_parts_come_in_display_order(self) -> None:
        every = _every_part()

        result = _restore({part: every[part] for part in RESTORE_ORDER})

        assert list(result) == list(PARTS)

    def test_parts_are_written_in_restore_order(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """The parts restore in dependency order (REQ-5.2.4.9.2)."""
        plan = build_plan(_every_part())
        calls: list[str] = []
        for part, (module, name, _first) in WRITERS.items():
            _spy(monkeypatch, module, name, calls, part)
        for part, (module, name) in OTHER_WRITE_POINTS.items():
            _spy(monkeypatch, module, name, calls, part)

        apply_plan(plan)

        assert list(dict.fromkeys(calls)) == RESTORE_ORDER

    @pytest.mark.parametrize(
        ("here", "pattern"),
        [
            (("item-1", "Another name"), ALREADY_HERE),
            (("item-1", "From the backup"), ALREADY_HERE),
            (("here-1", "From the backup"), NAME_IN_USE),
        ],
        ids=["id", "both", "name"],
    )
    def test_a_skipped_conflict_is_named_with_its_reason(
        self, here: tuple[str, str], pattern: str
    ) -> None:
        here_id, here_name = here
        seed("suites", make_suite(here_name, here_id))

        result = _restore({"suites": [make_suite("From the backup", "item-1")]})

        _assert_part(result["suites"], skipped=1, items=[("From the backup", "skipped", pattern)])

    def test_a_missing_function_reads_not_in_this_wave_in_the_result(self) -> None:
        broken = make_test("Broken", "t-1", [function_block("call", "Call it", "fn-gone")])

        result = _restore({"tests": [broken]})

        _assert_part(
            result["tests"], fatal=1, items=[("Broken", "fatal", _missing_function("Call it"))]
        )

    @pytest.mark.parametrize(
        "blocks",
        [
            [function_block("node-1779383867313-vzh88ic", "", "fn-gone")],
            [
                local_function_block(
                    "local", "Local", [function_block("node-1779383867313-vzh88ic", "", "fn-gone")]
                )
            ],
        ],
        ids=["at the top level", "inside a Local Function"],
    )
    def test_a_missing_function_of_a_nameless_block_names_no_block_in_the_result(
        self, blocks: list[Document]
    ) -> None:
        result = _restore({"tests": [make_test("Broken", "t-1", blocks)]})

        _assert_part(result["tests"], fatal=1, items=[("Broken", "fatal", UNNAMED_FUNCTION)])

    def test_a_named_block_inside_a_local_function_is_named_in_the_result(self) -> None:
        call = function_block("node-1779383867313-vzh88ic", "Call it", "fn-gone")
        broken = make_test("Broken", "t-1", [local_function_block("local", "Local", [call])])

        result = _restore({"tests": [broken]})

        _assert_part(
            result["tests"], fatal=1, items=[("Broken", "fatal", _missing_function("Call it"))]
        )

    def test_a_missing_version_reads_not_in_this_wave_in_the_result(self) -> None:
        seed("functions", make_function("Lib", "fn-1", [function_version("1.0.0", [log_block()])]))
        broken = make_test("Broken", "t-1", [function_block("call", "Call it", "fn-1", "2.0.0")])

        result = _restore({"tests": [broken]})

        _assert_part(
            result["tests"],
            fatal=1,
            items=[
                (
                    "Broken",
                    "fatal",
                    r'^Uses Function "Lib" 2\.0\.0, which is not in this WAVE$',
                )
            ],
        )

    def test_a_missing_suite_reads_not_in_this_wave_in_the_result(self) -> None:
        result = _restore({"regressions": [make_regression("Nightly", "r-1", ["s-gone"])]})

        _assert_part(result["regressions"], fatal=1, items=[("Nightly", "fatal", MISSING_SUITE)])

    @pytest.mark.parametrize(
        ("is_here", "choice"),
        [(False, "skip"), (True, "overwrite"), (True, "rename")],
        ids=["new", "overwrite", "rename"],
    )
    def test_a_fixable_profile_is_written_as_custom_and_counts_as_imported_with_auto_repair(
        self, is_here: bool, choice: str
    ) -> None:
        if is_here:
            seed("profiles", make_profile("Same name", "p-1", description="Made here"))
        untyped = make_profile("Same name", "p-1", profile_type=None, description="Untyped")

        result = _restore({"profiles": [untyped]}, conflict_resolution=choice, auto_repair=True)

        _assert_part(result["profiles"], imported=1)
        (written,) = [p for p in stored("profiles").values() if p["description"] == "Untyped"]
        assert written["type"] == "custom"

    @pytest.mark.parametrize(
        ("is_here", "choice"),
        [(False, "skip"), (True, "overwrite"), (True, "rename")],
        ids=["new", "overwrite", "rename"],
    )
    def test_a_fixable_profile_is_not_written_and_is_named_fatal_without_auto_repair(
        self, is_here: bool, choice: str
    ) -> None:
        if is_here:
            seed("profiles", make_profile("Same name", "p-1", description="Made here"))
        before = disk_state()
        untyped = make_profile("Same name", "p-1", profile_type=None, description="Untyped")

        result = _restore({"profiles": [untyped]}, conflict_resolution=choice, auto_repair=False)

        _assert_part(result["profiles"], fatal=1, items=[("Same name", "fatal", HAS_NO_TYPE)])
        assert disk_state() == before

    @pytest.mark.parametrize("auto_repair", [True, False], ids=["auto-repair on", "off"])
    @pytest.mark.parametrize(
        ("here_id", "pattern"),
        [("p-1", ALREADY_HERE), ("p-here", NAME_IN_USE)],
        ids=["same id", "same name"],
    )
    def test_a_profile_without_a_type_that_conflicts_is_skipped_under_skip(
        self, auto_repair: bool, here_id: str, pattern: str
    ) -> None:
        seed("profiles", make_profile("Same name", here_id))
        before = disk_state()
        untyped = make_profile("Same name", "p-1", profile_type=None)

        result = _restore({"profiles": [untyped]}, auto_repair=auto_repair)

        _assert_part(result["profiles"], skipped=1, items=[("Same name", "skipped", pattern)])
        assert disk_state() == before

    def test_only_the_selected_parts_are_written_and_returned(self) -> None:
        """Only the parts the admin selected are restored (REQ-5.2.4.9.2)."""
        entities = {
            "environments": [make_environment("An environment", "env-1")],
            "profiles": [make_profile("A profile", "p-1", {"env-1": {"host": typed("db1")}})],
            "tests": [make_test("A test", "t-1", [log_block()])],
        }
        plan = build_plan(entities, selected=["environments"])

        result = apply_plan(plan)

        assert set(plan.parts) == {"environments", "profiles", "tests"}
        assert list(result) == ["environments"]
        _assert_part(result["environments"], imported=1)
        assert set(stored("environments")) == {"env-1"}
        assert stored("profiles") == {}
        assert stored("tests") == {}

    def test_a_ticked_part_the_archive_does_not_hold_has_no_result(self) -> None:
        entities = {"environments": [make_environment("An environment", "env-1")]}

        result = _restore(entities, selected=["environments", "suites"])

        assert list(result) == ["environments"]


# ---------------------------------------------------------------------------
# SSH hosts and certificates
# ---------------------------------------------------------------------------


class TestRestoreNetworkParts:
    """The restore names the SSH hosts and certificates and writes their reasons (REQ-5.2.4.9.6)."""

    def test_the_outcomes_are_paired_with_the_plans_items_in_order(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        entities = {
            "ssh_hosts": [ssh_entry("db1"), ssh_entry("db2"), ssh_entry("db3")],
            "certificates": [certificate_entry("Root One"), certificate_entry("Root Two")],
        }
        plan = build_plan(entities)
        monkeypatch.setattr(
            ssh_hosts,
            "restore_entries",
            lambda items, conflict_resolution: {
                "imported": 1,
                "skipped": 1,
                "fatal": 1,
                "outcomes": ["skipped", "imported", "fatal"],
            },
        )
        monkeypatch.setattr(
            certificates,
            "restore_certificates",
            lambda items: {
                "imported": 0,
                "skipped": 1,
                "fatal": 1,
                "outcomes": ["fatal", "skipped"],
            },
        )

        result = apply_plan(plan)

        hosts = [item.name for item in plan.parts["ssh_hosts"]]
        authorities = [item.name for item in plan.parts["certificates"]]
        assert sorted(hosts) == [
            "db1 port 22 (ED25519)",
            "db2 port 22 (ED25519)",
            "db3 port 22 (ED25519)",
        ]
        assert sorted(authorities) == ["Root One", "Root Two"]
        _assert_part(
            result["ssh_hosts"],
            imported=1,
            skipped=1,
            fatal=1,
            items=[(hosts[2], "fatal", UNREADABLE_KEY), (hosts[0], "skipped", ALREADY_HERE)],
        )
        _assert_part(
            result["certificates"],
            skipped=1,
            fatal=1,
            items=[
                (authorities[0], "fatal", NOT_A_VALID_CERTIFICATE),
                (authorities[1], "skipped", ALREADY_HERE),
            ],
        )

    @pytest.mark.parametrize("part", ["ssh_hosts", "certificates"])
    def test_a_skipped_ssh_host_or_certificate_reads_already_in_this_wave(self, part: str) -> None:
        if part == "ssh_hosts":
            entry, name = ssh_entry("db1", 22), "db1 port 22 (ED25519)"
        else:
            entry, name = certificate_entry("Backup Lab Root"), "Backup Lab Root"
        seed(part, entry)

        result = _restore({part: [entry]})

        _assert_part(result[part], skipped=1, items=[(name, "skipped", ALREADY_HERE)])

    def test_a_fatal_ssh_entry_reads_unreadable_key(self) -> None:
        entities = {
            "ssh_hosts": [
                ssh_entry("db1", 22, UNREADABLE_SSH_KEY),
                ssh_entry("db2", 2222, UNKNOWN_TYPE_SSH_KEY),
                ssh_entry(None),
            ]
        }

        result = _restore(entities)

        _assert_part(
            result["ssh_hosts"],
            fatal=3,
            items=[
                ("db1 port 22 (ED25519)", "fatal", UNREADABLE_KEY),
                ("db2 port 2222", "fatal", UNREADABLE_KEY),
                ("Entry 3", "fatal", UNREADABLE_KEY),
            ],
        )
        assert ssh_hosts.saved_entries() == []

    def test_a_fatal_certificate_reads_not_a_valid_certificate(self) -> None:
        result = _restore({"certificates": [unreadable_certificate_entry("ab" * 32)]})

        _assert_part(
            result["certificates"],
            fatal=1,
            items=[("ab" * 32, "fatal", NOT_A_VALID_CERTIFICATE)],
        )
        assert certificates.saved_entries() == []

    @pytest.mark.parametrize("part", ["ssh_hosts", "certificates"])
    def test_a_part_whose_call_fails_names_its_entries_and_the_restore_goes_on(
        self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, part: str
    ) -> None:
        if part == "ssh_hosts":
            here, module, call = ssh_entry("db-here"), ssh_hosts, "restore_entries"
            entries = [ssh_entry("db-new"), here, ssh_entry("db-bad", 22, UNREADABLE_SSH_KEY)]
            new, saved, unreadable = (
                f"{host} port 22 (ED25519)" for host in ("db-new", "db-here", "db-bad")
            )
            own_reason, other = UNREADABLE_KEY, "certificates"
        else:
            here, module, call = (
                certificate_entry("Here Root"),
                certificates,
                "restore_certificates",
            )
            entries = [certificate_entry("New Root"), here, unreadable_certificate_entry("ab" * 32)]
            new, saved, unreadable = "New Root", "Here Root", "ab" * 32
            own_reason, other = NOT_A_VALID_CERTIFICATE, "ssh_hosts"
        seed(part, here)
        plan = build_plan(_every_part() | {part: entries})

        def fail(*args: Any, **kwargs: Any) -> Any:
            raise OSError("the file is read-only")

        monkeypatch.setattr(module, call, fail)
        caplog.set_level(logging.ERROR)

        result = apply_plan(plan)

        assert set(result) == set(PARTS)
        not_written = _could_not_be_written("the file is read-only")
        _assert_part(
            result[part],
            fatal=3,
            items=[
                (new, "fatal", not_written),
                (saved, "fatal", not_written),
                (unreadable, "fatal", own_reason),
            ],
        )
        _assert_part(result["environments"], imported=1)
        assert set(stored("environments")) == {"env-1"}
        _assert_part(result[other], imported=1)
        lines = [
            record.getMessage()
            for record in caplog.records
            if record.levelno == logging.ERROR and "the file is read-only" in record.getMessage()
        ]
        assert len(lines) == 1, lines
        assert part in lines[0]


# ---------------------------------------------------------------------------
# Caches
# ---------------------------------------------------------------------------


class TestRestoreCaches:
    """What a restore wrote shows at once, with no restart (REQ-5.2.4.9.5)."""

    def test_an_overwritten_environment_shows_its_new_content_at_once(self) -> None:
        seed("environments", make_environment("Old name", "env-1"))
        listed = environment_service.list_environments()["environments"]
        assert [environment["name"] for environment in listed] == ["Old name"]

        _restore(
            {"environments": [make_environment("New name", "env-1")]},
            conflict_resolution="overwrite",
        )

        assert environment_service.get_environment("env-1")["name"] == "New name"
        listed = environment_service.list_environments()["environments"]
        assert [environment["name"] for environment in listed] == ["New name"]

    def test_an_overwritten_profile_shows_its_new_content_at_once(self) -> None:
        seed("profiles", make_profile("Old name", "p-1"))
        listed = profile_service.list_profiles()["profiles"]
        assert [profile["name"] for profile in listed] == ["Old name"]

        _restore({"profiles": [make_profile("New name", "p-1")]}, conflict_resolution="overwrite")

        assert profile_service.get_profile("p-1")["name"] == "New name"
        listed = profile_service.list_profiles()["profiles"]
        assert [profile["name"] for profile in listed] == ["New name"]

    def test_a_restored_test_shows_in_the_list_at_once(self) -> None:
        seed("tests", make_test("Old name", "t-1", [log_block()]))
        assert [test["name"] for test in test_service.list_tests()["tests"]] == ["Old name"]
        entities = {
            "tests": [
                make_test("New name", "t-1", [log_block()]),
                make_test("Fresh", "t-2", [log_block()]),
            ]
        }

        _restore(entities, conflict_resolution="overwrite")

        listed = test_service.list_tests()["tests"]
        assert sorted(test["name"] for test in listed) == ["Fresh", "New name"]

    @pytest.mark.parametrize(
        "written",
        [("suites",), ("regressions",), ("suites", "regressions")],
        ids=["a suite", "a regression", "both"],
    )
    def test_the_relation_index_is_rebuilt_once_when_a_suite_or_a_regression_was_written(
        self, monkeypatch: pytest.MonkeyPatch, written: tuple[str, ...]
    ) -> None:
        seed("tests", make_test("A test", "t-1", [log_block()]))
        suite = make_suite("A suite", "s-1", ["t-1"])
        entities: dict[str, list[Document]] = {}
        if "suites" in written:
            entities["suites"] = [suite]
        else:
            seed("suites", suite)
        if "regressions" in written:
            entities["regressions"] = [make_regression("A regression", "r-1", ["s-1"])]
        plan = build_plan(entities)
        calls: list[str] = []
        _spy(monkeypatch, relation_service, "rebuild", calls, "rebuild")

        apply_plan(plan)

        assert calls == ["rebuild"]
        assert relation_service.get_suites_for_test("t-1") == [{"id": "s-1", "name": "A suite"}]

    def test_the_relation_index_is_left_alone_when_none_was_written(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        seed("suites", make_suite("Kept here", "s-1"))
        entities = {
            "tests": [make_test("A test", "t-1", [log_block()])],
            "suites": [make_suite("From the backup", "s-1", ["t-1"])],
        }
        plan = build_plan(entities)
        calls: list[str] = []
        _spy(monkeypatch, relation_service, "rebuild", calls, "rebuild")

        result = apply_plan(plan)

        _assert_part(result["tests"], imported=1)
        _assert_part(
            result["suites"], skipped=1, items=[("From the backup", "skipped", ALREADY_HERE)]
        )
        assert calls == []


# ---------------------------------------------------------------------------
# Secrets
# ---------------------------------------------------------------------------


class TestRestoreSecrets:
    """A secret another WAVE sealed, or a masked placeholder, is stored as null; a masked one
    never replaces a secret stored at its place (REQ-4.5.19, EXPORT-5, EXPORT-7)."""

    @pytest.mark.parametrize(
        ("part", "in_workflow"),
        [("tests", False), ("suites", False), ("regressions", False), ("tests", True)],
        ids=["test variables", "suite variables", "regression variables", "test workflow"],
    )
    def test_a_value_sealed_by_another_wave_becomes_null(
        self, part: str, in_workflow: bool
    ) -> None:
        sealed = _sealed_elsewhere()
        document = _sets_token(sealed) if in_workflow else _holds(part, typed(sealed, secret=True))

        result = _restore({part: [document]})

        _assert_part(result[part], imported=1)
        opened = [_opened_setter_literal()] if in_workflow else _opened_secrets(part)
        assert opened == [None]

    @pytest.mark.parametrize("part", ["tests", "suites", "regressions", "profiles"])
    def test_a_masked_placeholder_keeps_the_stored_value_on_overwrite(self, part: str) -> None:
        seed(part, _holds(part, typed("kept-secret", secret=True)))
        entities = {part: [_holds(part, _masked(part))]}
        if part == "profiles":
            environment = make_environment("An environment", "env-1")
            seed("environments", environment)
            entities["environments"] = [environment]

        result = _restore(entities, conflict_resolution="overwrite")

        _assert_part(result[part], imported=1)
        assert set(_opened_secrets(part)) == {"kept-secret"}

    @pytest.mark.parametrize("place", ["test workflow", "regression history snapshot"])
    def test_a_masked_placeholder_becomes_null_on_overwrite_where_nothing_is_stored_at_its_place(
        self, place: str
    ) -> None:
        if place == "test workflow":
            seed("tests", make_test("Sets a secret", "item-1", [log_block()]))
            entities = {"tests": [_sets_token(MASK_PLACEHOLDER)]}
        else:
            regression = make_regression("A regression", "item-1")
            seed("regressions", regression, [history_row(snapshot=regression_snapshot([]))])
            masked = regression_snapshot([], variables={"token": _masked()})
            entities = {"regressions": [with_history(regression, [history_row(snapshot=masked)])]}

        _restore(entities, conflict_resolution="overwrite")

        assert _opened_place_value(place) is None

    @pytest.mark.parametrize("place", ["test workflow", "regression history snapshot"])
    def test_a_masked_placeholder_keeps_the_secret_stored_at_its_place_on_overwrite(
        self, place: str
    ) -> None:
        if place == "test workflow":
            seed("tests", _sets_token("kept-secret"))
            entities = {"tests": [_sets_token(MASK_PLACEHOLDER)]}
        else:
            regression = make_regression("A regression", "item-1")
            kept = regression_snapshot([], variables={"token": typed("kept-secret", secret=True)})
            seed("regressions", regression, [history_row(snapshot=kept)])
            masked = regression_snapshot([], variables={"token": _masked()})
            entities = {"regressions": [with_history(regression, [history_row(snapshot=masked)])]}

        _restore(entities, conflict_resolution="overwrite")

        assert _opened_place_value(place) == "kept-secret"

    def test_a_masked_placeholder_becomes_null_on_a_new_item(self) -> None:
        parts = ("tests", "suites", "regressions", "profiles")
        entities = {"environments": [make_environment("An environment", "env-1")]}
        for part in parts:
            entities[part] = [_holds(part, _masked(part))]

        result = _restore(entities)

        for part in parts:
            _assert_part(result[part], imported=1)
            assert set(_opened_secrets(part)) == {None}, part

    @pytest.mark.parametrize(
        ("place", "expected"),
        [
            ("regression history snapshot", [None]),
            ("profile config and environment", [None, None]),
            ("system variable", [None]),
        ],
    )
    def test_a_value_sealed_by_another_wave_becomes_null_in_every_other_place(
        self, place: str, expected: list[None]
    ) -> None:
        sealed = typed(_sealed_elsewhere(), secret=True)

        result = _restore(_entities_holding(place, sealed))

        _assert_part(result[_PLACE_PART[place]], imported=1)
        assert _opened_place_values(place) == expected

    @pytest.mark.parametrize(
        "place", ["test workflow", "regression history snapshot", "system variable"]
    )
    def test_a_masked_placeholder_becomes_null_on_a_new_item_in_every_other_place(
        self, place: str
    ) -> None:
        entities = (
            {"tests": [_sets_token(MASK_PLACEHOLDER)]}
            if place == "test workflow"
            else _entities_holding(place, _masked())
        )

        result = _restore(entities)

        _assert_part(result[_PLACE_PART[place]], imported=1)
        assert _opened_place_value(place) is None

    def test_a_masked_system_variable_keeps_the_secret_stored_here(self) -> None:
        seed("system_variables", system_variables({"token": typed("kept-secret", secret=True)}))

        result = _restore(
            {"system_variables": [system_variables({"token": _masked()})]},
            conflict_resolution="overwrite",
        )

        _assert_part(result["system_variables"], imported=1)
        assert _opened_place_value("system variable") == "kept-secret"


# ---------------------------------------------------------------------------
# The round trip
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class BackedUp:
    """The round-trip WAVE as it was stored, and its backup."""

    ids: RoundTrip
    documents: dict[str, dict[str, Document]]
    history: dict[str, dict[str, list[Document]]]
    content: bytes


@pytest.fixture
def backed_up(round_trip: RoundTrip, temp_storage_path: Path) -> BackedUp:
    """The round-trip WAVE read, backed up and then wiped: the store is empty again."""
    documents = {part: stored(part) for part in ID_PARTS}
    history = {part: stored_history(part) for part in WITH_HISTORY}
    content = backup()
    wipe_store(temp_storage_path)
    return BackedUp(round_trip, documents, history, content)


@pytest.fixture
def restored(backed_up: BackedUp) -> Document:
    """The answer of restoring that backup on the empty store."""
    return restore_backup(backed_up.content, "backup.zip")


class TestRoundTripOnAnEmptyStore:
    """A backup restored on an empty WAVE gives back the same WAVE (REQ-5.2.4.9.5)."""

    COUNTS = {
        "tests": 3,
        "environments": 1,
        "profiles": 1,
        "suites": 1,
        "regressions": 1,
        "functions": 2,
    }

    def test_the_preview_says_every_item_is_ok(self, backed_up: BackedUp) -> None:
        summary = validate_backup(backed_up.content, "backup.zip")["entity_summary"]

        assert {part: row["ok"] for part, row in summary.items() if row["total"]} == self.COUNTS
        for part, row in summary.items():
            counts = (row["total"] - row["ok"], row["conflicts"], row["fixable"], row["fatal"])
            assert counts == (0, 0, 0, 0), part
            assert row["items"] == [], part

    def test_the_restore_answers_every_part_with_nothing_skipped_or_fatal(
        self, restored: Document
    ) -> None:
        imported = {part: row["imported"] for part, row in restored.items() if row["imported"]}
        assert imported == self.COUNTS
        for row in restored.values():
            _assert_part(row, imported=row["imported"])

    def test_every_item_has_the_id_it_had(self, backed_up: BackedUp, restored: Document) -> None:
        ids = backed_up.ids
        assert {part: set(stored(part)) for part in ID_PARTS} == {
            "tests": {ids.test_fn_b, ids.test_nested, ids.test_plain},
            "environments": {ids.environment},
            "profiles": {ids.profile},
            "suites": {ids.suite},
            "regressions": {ids.regression},
            "functions": {ids.fn_a, ids.fn_b},
        }

    def test_the_test_keeps_description_tags_owner_version_history_and_timestamps(
        self, backed_up: BackedUp, restored: Document
    ) -> None:
        test_id = backed_up.ids.test_fn_b
        written = stored("tests")[test_id]
        rows = stored_history("tests")[test_id]

        assert written == backed_up.documents["tests"][test_id]
        assert rows == backed_up.history["tests"][test_id]
        assert written["description"] == "Calls FnB pinned to 1.0.0"
        assert written["metadata"] == {"tags": ["backup"], "owner": "ashley"}
        assert written["version"] == "1.1.0"
        assert [row["version"] for row in rows] == ["1.0.0", "1.1.0"]

    def test_the_test_still_pins_the_older_function_version(
        self, backed_up: BackedUp, restored: Document
    ) -> None:
        ids = backed_up.ids
        blocks = [node["data"] for node in stored("tests")[ids.test_fn_b]["workflow"]["nodes"]]
        (call,) = [block for block in blocks if block.get("functionLifecycle") == "shared"]

        assert (call["label"], call["functionId"], call["functionVersion"]) == (
            ROUND_TRIP_FNB_BLOCK,
            ids.fn_b,
            "1.0.0",
        )
        assert [record["version"] for record in function_versions(ids.fn_b)] == ["1.0.0"]
        assert [record["version"] for record in function_versions(ids.fn_a)] == ["1.1.0", "1.0.0"]
        assert stored("functions")[ids.fn_a]["latest_version"] == "1.1.0"

    def test_the_nested_function_references_hold(
        self, backed_up: BackedUp, restored: Document
    ) -> None:
        ids = backed_up.ids
        (body,) = function_versions(ids.fn_b)
        (in_fn_b,) = body["definition"]["workflow"]["nodes"]
        (local,) = stored("tests")[ids.test_nested]["workflow"]["nodes"]
        (in_local,) = local["data"]["localDefinition"]["workflow"]["nodes"]

        for block, label in ((in_fn_b, ROUND_TRIP_FNA_BLOCK), (in_local, ROUND_TRIP_NESTED_BLOCK)):
            data = block["data"]
            assert (data["label"], data["functionId"], data["functionVersion"]) == (
                label,
                ids.fn_a,
                "1.0.0",
            )

    def test_the_suite_and_the_regression_list_items_that_exist(
        self, backed_up: BackedUp, restored: Document
    ) -> None:
        ids = backed_up.ids
        suite = stored("suites")[ids.suite]
        regression = stored("regressions")[ids.regression]

        assert suite["tests"] == [ids.test_fn_b, ids.test_nested, ids.test_plain]
        assert set(suite["tests"]) <= set(stored("tests"))
        assert regression["suites"] == [ids.suite]
        assert set(regression["suites"]) <= set(stored("suites"))

    def test_the_profile_binding_points_at_the_restored_profile(
        self, backed_up: BackedUp, restored: Document
    ) -> None:
        ids = backed_up.ids
        blocks = [node["data"] for node in stored("tests")[ids.test_fn_b]["workflow"]["nodes"]]
        bound = [
            binding["profileId"]
            for block in blocks
            for binding in block["config"]["profileBindings"]
        ]

        assert bound == [ids.profile]
        assert ids.profile in stored("profiles")
        assert set(stored("profiles")[ids.profile]["environment_values"]) == {ids.environment}
        assert ids.environment in stored("environments")

    def test_the_data_files_are_back_under_the_same_test_id(
        self, backed_up: BackedUp, restored: Document
    ) -> None:
        assert data_files(backed_up.ids.test_fn_b) == {"sample.csv": SAMPLE_CSV}

    def test_the_restored_test_passes_its_save_validation(
        self, backed_up: BackedUp, restored: Document
    ) -> None:
        ids = backed_up.ids
        for test_id in (ids.test_fn_b, ids.test_nested, ids.test_plain):
            assert test_service.validate_test_data_for_update(test_id, {}) == [], test_id

    def test_a_backup_of_the_restored_store_equals_the_first_backup(
        self, backed_up: BackedUp, restored: Document
    ) -> None:
        first = _members(backed_up.content)

        assert _members(backup()) == first
        assert sum(name.startswith("functions/") for name in first) == 2
        assert any(name.startswith("tests/testdata/") for name in first)
