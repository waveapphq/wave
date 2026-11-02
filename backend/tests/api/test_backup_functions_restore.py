"""The Functions part of a backup, in the archive and in the restore."""

import copy
import io
import json
import os
import re
import zipfile
from collections.abc import Callable, Mapping, Sequence
from typing import Any

import pytest
import yaml

from tests.api.backup_support import (
    UNPARSABLE_MEMBER,
    apply_plan,
    archive,
    backup,
    build_plan,
    draft_block,
    empty_store_fixture,  # noqa: F401
    flow,
    function_block,
    function_version,
    function_versions,
    history_row,
    local_function_block,
    log_block,
    make_environment,
    make_function,
    make_profile,
    make_test,
    preview_of,
    profile_binding,
    seed,
    setter_block,
    stored,
    with_history,
)
from wavecore.api.services.backup import _helpers as backup_helpers
from wavecore.api.services.backup.service import restore_backup, validate_backup
from wavecore.api.services.environments import service as environment_service
from wavecore.api.services.functions import _storage as function_storage
from wavecore.api.services.shared import is_foreign_envelope
from wavecore.api.services.storage_paths import get_functions_storage_path
from wavecore.core.secrets.cipher import SecretCipher, is_secret_envelope
from wavecore.core.secrets.masking import MASK_PLACEHOLDER
from wavecore.core.secrets.sealing import unseal_all

pytestmark = pytest.mark.usefixtures("empty_store")

Document = dict[str, Any]
Item = tuple[str, str, str]

ALREADY_HERE = r"^Already in this WAVE$"
NAME_IN_USE = r"^Name already in use$"
NAME_TAKEN = r"^Another Function here has this name$"
NO_NAME = r"^Has no name$"
CANNOT_BE_READ = r"^Cannot be read$"
MISSING_ANYWHERE = r'^Uses Function "{block}", which is not in the backup or in this WAVE$'
MISSING_HERE = r'^Uses Function "{block}", which is not in this WAVE$'
UNNAMED_ANYWHERE = r"^Uses a Function that is not in the backup or in this WAVE$"
UNNAMED_HERE = r"^Uses a Function that is not in this WAVE$"
CIRCULAR = r"^Circular Function reference: {path}$"
WRITE_FAILED = r"^Could not be written: {error}$"

WRITE_ERROR = "No space left on device"
LONG_NAME = "Collect the nightly build report"
RENAMED_LONG_NAME = "Collect the nightly build re (2)"


def _day(month: int) -> str:
    """The first day of a month of 2025, as a Function stamps a publish time."""
    return f"2025-{month:02d}-01T00:00:00Z"


def _members(content: bytes, part: str = "functions") -> dict[str, Document]:
    """The parsed members of one part of an archive, by member name."""
    members: dict[str, Document] = {}
    with zipfile.ZipFile(io.BytesIO(content)) as zf:
        for name in zf.namelist():
            if name.startswith(f"{part}/"):
                parse = json.loads if name.endswith(".json") else yaml.safe_load
                members[name] = parse(zf.read(name))
    return members


def _file_names(members: Mapping[str, Document]) -> list[str]:
    """The member names without their folder, sorted."""
    return sorted(name.split("/", 1)[1] for name in members)


def _manifest(content: bytes) -> Document:
    with zipfile.ZipFile(io.BytesIO(content)) as zf:
        manifest: Document = json.loads(zf.read("manifest.json"))
    return manifest


def _plan(parts: Mapping[str, Sequence[Document]], **options: Any) -> Any:
    """The restore plan of a copy of the parts, so the documents given stay as built."""
    return build_plan(
        copy.deepcopy({part: list(items) for part, items in parts.items()}), **options
    )


def _item(plan: Any, name: str) -> Any:
    """The one Functions item of a plan that has the name."""
    items = [item for item in plan.parts["functions"] if item.name == name]
    assert len(items) == 1, [item.name for item in plan.parts["functions"]]
    return items[0]


def _preview_part(ok: int = 0, conflicts: int = 0, fatal: int = 0) -> Document:
    """The counts of a preview part that holds no fixable item."""
    return {
        "total": ok + conflicts + fatal,
        "ok": ok,
        "conflicts": conflicts,
        "fixable": 0,
        "fatal": fatal,
    }


def _result_part(imported: int = 0, skipped: int = 0, fatal: int = 0) -> Document:
    return {"imported": imported, "skipped": skipped, "fatal": fatal}


def _assert_part(part: Document, counts: Document, *items: Item) -> None:
    """A preview or result part holds these counts and these items, compared by name."""
    assert {key: value for key, value in part.items() if key != "items"} == counts
    found = sorted(part["items"], key=lambda item: item["name"])
    expected = sorted(items)
    assert [(item["name"], item["status"]) for item in found] == [
        (name, status) for name, status, _reason in expected
    ]
    for item, (_name, _status, reason) in zip(found, expected, strict=True):
        assert set(item) == {"name", "status", "reason"}
        assert re.fullmatch(reason, item["reason"])


def _library() -> dict[str, str]:
    """The name of every library Function, by id."""
    return {function_id: row["name"] for function_id, row in stored("functions").items()}


def _new_id(*known: str) -> str:
    """The one library id that is none of the known ones."""
    new_ids = set(stored("functions")) - set(known)
    assert len(new_ids) == 1, new_ids
    (new_id,) = new_ids
    assert isinstance(new_id, str)
    assert new_id
    return new_id


def _version_numbers(function_id: str) -> list[str]:
    return [record["version"] for record in function_versions(function_id)]


def _index_times(function_id: str) -> tuple[str, str]:
    """The created and the updated time of a library entry."""
    row = stored("functions")[function_id]
    return row["created_at"], row["updated_at"]


def _secret_setter(token: Any) -> Document:
    """A Variable Setter block whose one literal, ``token``, is flagged secret."""
    return setter_block("set-token", "Set token", {"token": token}, ["token"])


def _token(workflow: Document) -> Any:
    """The secret literal of a body made of one ``_secret_setter``."""
    return workflow["nodes"][0]["data"]["config"]["values"]["variables"]["token"]


def _tokens(records: Sequence[Document]) -> list[Any]:
    return [_token(record["definition"]["workflow"]) for record in records]


_BODY_SECRET_PLACES = ("plugin credential", "Function-local secret", "secret output default")


@pytest.fixture
def http_client_plugin(empty_store: object, monkeypatch: pytest.MonkeyPatch) -> None:
    """The HTTP block, registered for one test, so its declared credential fields are known."""
    from wavecore.core import plugin_registry
    from wavecore.plugins.http_client import HTTPClientPlugin

    plugin = HTTPClientPlugin()
    monkeypatch.setitem(
        plugin_registry._registry._plugins, "http-client", {plugin.metadata["version"]: plugin}
    )


def _http_block(token: Any) -> Document:
    """An HTTP block whose declared credential field ``auth_token`` holds ``token``."""
    return {
        "id": "call-api",
        "type": "workflowNode",
        "position": {"x": 0, "y": 0},
        "data": {
            "label": "Call API",
            "elementType": "http-client",
            "nodeType": "plugin",
            "version": "1.0.0",
            "config": {
                "values": {"url": "http://api.test", "method": "GET", "auth_token": token},
                "outputBindings": {},
                "profileBindings": [],
            },
        },
    }


def _secret_version(place: str, value: Any, version: str = "1.0.0") -> Document:
    """One version record whose body holds ``value`` at ``place``."""
    if place == "Setter literal":
        return function_version(version, [_secret_setter(value)])
    if place == "plugin credential":
        return function_version(version, [_http_block(value)])
    if place == "secret output default":
        output = {"name": "out_tok", "type": "string", "secret": True, "default": value}
        return function_version(version, outputs=[output])
    record = function_version(version)
    record["definition"]["variables"] = [
        {"name": "local_tok", "type": "string", "secret": True, "value": value}
    ]
    return record


def _body_secret(place: str, definition: Document) -> tuple[Any, bool]:
    """The value a stored version body holds at ``place`` and whether it is still secret."""
    if place == "Setter literal":
        return _token(definition["workflow"]), True
    if place == "plugin credential":
        # The HTTP block declares this field a credential, so it is secret by declaration.
        return definition["workflow"]["nodes"][0]["data"]["config"]["values"]["auth_token"], True
    if place == "Function-local secret":
        declared = (definition.get("variables") or [{}])[0]
        return declared.get("value"), declared.get("secret") is True
    declared = definition["outputs"][0]
    return declared.get("default"), declared.get("secret") is True


def _deep_calls(function_id: str) -> list[Document]:
    """Blocks that name one library Function at the top level, in a Local body and in a draft."""
    in_local = function_block("in-local", "Call in a Local body", function_id)
    local = local_function_block("local", "Local step", [in_local])
    local["data"]["localDefinition"]["dependencies"]["functions"] = [function_id]
    in_draft = function_block("in-draft", "Call in a draft", function_id)
    return [
        function_block("top", "Call at the top", function_id),
        local,
        draft_block("editing", "Call being edited", function_id, blocks=[in_draft]),
    ]


def _callee_places(workflow: Document) -> Document:
    """Every place of a ``_deep_calls`` body that names the callee."""
    data = {node["id"]: node["data"] for node in workflow["nodes"]}
    local = data["local"]["localDefinition"]
    editing = data["editing"]
    return {
        "top level": data["top"]["functionId"],
        "local body": local["workflow"]["nodes"][0]["data"]["functionId"],
        "local dependency list": local["dependencies"]["functions"],
        "edit-mode block": editing["functionId"],
        "upstream link": editing["upstreamLink"]["functionId"],
        "draft": editing["draft"]["workflow"]["nodes"][0]["data"]["functionId"],
    }


def _bound_blocks(profile_id: str) -> list[Document]:
    """A Log block bound to the profile at the top level, and one inside a Local body."""
    inner = log_block("inner", "Inner log", bindings=[profile_binding(profile_id)])
    return [
        log_block("bound", "Bound log", bindings=[profile_binding(profile_id)]),
        local_function_block("local", "Local step", [inner]),
    ]


def _bound_profiles(records: Sequence[Document]) -> list[list[str]]:
    """Per version record of ``_bound_blocks`` bodies, the profile id of each binding."""
    found = []
    for record in records:
        top, local = record["definition"]["workflow"]["nodes"]
        inner = local["data"]["localDefinition"]["workflow"]["nodes"][0]
        found.append(
            [
                binding["profileId"]
                for block in (top, inner)
                for binding in block["data"]["config"]["profileBindings"]
            ]
        )
    return found


def _fail_writes_of(failing_id: str, monkeypatch: pytest.MonkeyPatch) -> None:
    """Make each version write of one Function fail once the version is on disk."""
    for saver_name in ("save_new_version", "save_or_replace_version"):
        real = getattr(function_storage, saver_name)

        def saver(
            function_id: str,
            version: str,
            definition: Any,
            metadata: Any,
            *,
            name: str,
            _real: Callable[..., str] = real,
        ) -> str:
            etag = _real(function_id, version, definition, metadata, name=name)
            if function_id == failing_id:
                raise OSError(WRITE_ERROR)
            return etag

        monkeypatch.setattr(function_storage, saver_name, saver)


class TestFunctionsInTheArchive:
    """REQ-5.2.4.9.2: a backup holds the Functions library, every version of each Function."""

    @pytest.mark.parametrize("fmt", ["yaml", "json"])
    def test_each_function_is_one_member_under_functions(self, fmt: str) -> None:
        for position, name in enumerate(["Open tunnel", "Open-tunnel", "Sum (v2)"]):
            seed("functions", make_function(name, f"fn-{position}"))
            environment_service.create_environment(name)

        content = backup(["environments", "functions"], fmt=fmt)

        members = _members(content)
        assert sorted(member["id"] for member in members.values()) == ["fn-0", "fn-1", "fn-2"]
        assert all(name.endswith(f".{fmt}") for name in members)
        assert _file_names(members) == _file_names(_members(content, "environments"))

    def test_a_member_holds_every_version(self) -> None:
        versioned = make_function(
            "Versioned",
            "fn-versioned",
            [
                function_version("1.2.0", [log_block(message="third")], published_at=_day(3)),
                function_version("1.1.0", [log_block(message="second")], published_at=_day(2)),
                function_version("1.0.0", [log_block(message="first")], published_at=_day(1)),
            ],
        )
        single = make_function("Single", "fn-single")
        seed("functions", versioned)
        seed("functions", single)

        members = _members(backup(["functions"]))

        assert {member["id"]: member for member in members.values()} == {
            "fn-versioned": versioned,
            "fn-single": single,
        }

    @pytest.mark.parametrize("mode", ["mask", "encrypted", "plaintext"])
    def test_the_secrets_mode_reaches_every_version(self, mode: str) -> None:
        document = make_function(
            "Fn",
            "fn-1",
            [
                function_version("1.1.0", [_secret_setter("sk-newer")]),
                function_version("1.0.0", [_secret_setter("sk-older")]),
            ],
        )
        seed("functions", document)
        sealed = _tokens(function_versions("fn-1"))
        expected = {
            "mask": [MASK_PLACEHOLDER, MASK_PLACEHOLDER],
            "encrypted": sealed,
            "plaintext": ["sk-newer", "sk-older"],
        }[mode]

        (member,) = _members(backup(["functions"], secrets=mode)).values()

        assert all(is_secret_envelope(value) for value in sealed)
        assert _token(member["workflow"]) == expected[0]
        assert _tokens(member["versions"]) == expected
        assert [member] == backup_helpers._list_functions_entities(mode)

    def test_the_manifest_counts_the_functions(self) -> None:
        two_versions = [function_version("1.1.0"), function_version("1.0.0")]
        seed("functions", make_function("Two versions", "fn-1", two_versions))
        seed("functions", make_function("One version", "fn-2"))

        with_functions = _manifest(backup(["environments", "functions"]))
        without_functions = _manifest(backup(["environments"]))

        assert with_functions["entity_counts"] == {"environments": 0, "functions": 2}
        assert without_functions["entity_counts"] == {"environments": 0}

    def test_a_library_folder_without_an_index_is_not_backed_up(self) -> None:
        seed("functions", make_function("Kept", "fn-kept"))
        leftover = get_functions_storage_path() / "fn-leftover"
        (leftover / "versions").mkdir(parents=True)
        (leftover / "versions" / "1.0.0.yaml").write_text(
            yaml.safe_dump(function_version()), encoding="utf-8"
        )
        (leftover / "function.yaml").write_text(
            yaml.safe_dump({"id": "fn-leftover", "name": "Leftover"}), encoding="utf-8"
        )

        content = backup(["functions"])

        listed = backup_helpers._list_functions_entities("mask")
        assert [document["id"] for document in listed] == ["fn-kept"]
        assert [member["id"] for member in _members(content).values()] == ["fn-kept"]
        assert _manifest(content)["entity_counts"] == {"functions": 1}


class TestFunctionsRestore:
    """REQ-5.2.4.9.5, REQ-5.2.4.9.6: a Function comes back as itself, or is named with a reason."""

    def test_functions_come_back_with_their_ids_and_every_version(self) -> None:
        versioned = make_function(
            "Versioned",
            "fn-versioned",
            [
                function_version(
                    "1.1.0",
                    [log_block(message="second")],
                    published_at=_day(2),
                    description="Second",
                    tags=["stable"],
                    changelog="Second cut",
                    details="Logs the second line",
                    published_by="ashley",
                ),
                function_version(
                    "1.0.0",
                    [log_block(message="first")],
                    published_at=_day(1),
                    description="First",
                    tags=["draft"],
                    changelog="First cut",
                    published_by="will",
                ),
            ],
        )
        single = make_function("Single", "fn-single")

        result = apply_plan(_plan({"functions": [versioned, single]}))

        assert set(result) == {"functions"}
        _assert_part(result["functions"], _result_part(imported=2))
        assert _library() == {"fn-versioned": "Versioned", "fn-single": "Single"}
        assert function_versions("fn-versioned") == versioned["versions"]
        assert function_versions("fn-single") == single["versions"]

    def test_the_index_times_come_from_the_documents_metadata(self) -> None:
        document = make_function(
            "Timed",
            "fn-1",
            [
                function_version("1.1.0", published_at=_day(6)),
                function_version("1.0.0", published_at=_day(5)),
            ],
        )
        document["metadata"] |= {"created_at": _day(1), "updated_at": _day(9)}

        apply_plan(_plan({"functions": [document]}))

        assert _index_times("fn-1") == (_day(1), _day(9))

    def test_without_them_the_index_times_come_from_the_oldest_and_the_newest_version(
        self,
    ) -> None:
        document = make_function(
            "Timed",
            "fn-1",
            [
                function_version("1.2.0", published_at=_day(7)),
                function_version("1.1.0", published_at=_day(6)),
                function_version("1.0.0", published_at=_day(5)),
            ],
        )
        del document["metadata"]["created_at"]
        del document["metadata"]["updated_at"]

        apply_plan(_plan({"functions": [document]}))

        assert _index_times("fn-1") == (_day(5), _day(7))

    @pytest.mark.parametrize(
        ("here", "in_the_backup"),
        [
            pytest.param((_day(2), _day(5)), (_day(1), _day(8)), id="both come from the backup"),
            pytest.param((_day(1), _day(8)), (_day(2), _day(5)), id="both come from the library"),
        ],
    )
    def test_an_overwrite_keeps_the_earlier_created_and_the_later_updated_time(
        self, here: tuple[str, str], in_the_backup: tuple[str, str]
    ) -> None:
        created_here, updated_here = here
        stored_versions = [
            function_version("1.1.0", published_at=updated_here),
            function_version("1.0.0", published_at=created_here),
        ]
        seed("functions", make_function("Timed", "fn-1", stored_versions))
        incoming = make_function("Timed", "fn-1", [function_version("2.0.0", published_at=_day(4))])
        incoming["metadata"] |= {"created_at": in_the_backup[0], "updated_at": in_the_backup[1]}
        assert _index_times("fn-1") == here

        result = apply_plan(_plan({"functions": [incoming]}, conflict_resolution="overwrite"))

        _assert_part(result["functions"], _result_part(imported=1))
        assert _index_times("fn-1") == (_day(1), _day(8))

    @pytest.mark.parametrize("caller_first", [True, False], ids=["caller first", "callee first"])
    def test_functions_that_call_each_other_restore_in_any_archive_order(
        self, caller_first: bool
    ) -> None:
        callee = make_function("Callee", "fn-callee")
        call = function_block("call", "Call the callee", "fn-callee")
        caller = make_function("Caller", "fn-caller", [function_version("1.0.0", [call])])
        documents = [caller, callee] if caller_first else [callee, caller]

        plan = _plan({"functions": documents})
        preview = preview_of(plan)
        result = apply_plan(plan)

        _assert_part(preview["functions"], _preview_part(ok=2))
        _assert_part(result["functions"], _result_part(imported=2))
        assert _library() == {"fn-callee": "Callee", "fn-caller": "Caller"}
        (stored_caller,) = function_versions("fn-caller")
        (stored_call,) = stored_caller["definition"]["workflow"]["nodes"]
        assert stored_call["data"]["functionId"] == "fn-callee"

    def test_skip_leaves_the_library_entry(self) -> None:
        for function_id, name in (("fn-1", "Fn one"), ("fn-2", "Fn two")):
            here = [function_version("1.0.0", [log_block(message="here")])]
            seed("functions", make_function(name, function_id, here))
        before = (stored("functions"), function_versions("fn-1"), function_versions("fn-2"))
        changed = [
            function_version("2.0.0", [log_block(message="new in the backup")]),
            function_version("1.0.0", [log_block(message="from the backup")]),
        ]
        documents = [
            make_function("Fn one", "fn-1", changed),
            make_function("Fn two", "fn-2", copy.deepcopy(changed)),
            make_function("Fn three", "fn-3"),
        ]

        plan = _plan({"functions": documents}, conflict_resolution="skip")
        preview = preview_of(plan)
        result = apply_plan(plan)

        _assert_part(
            preview["functions"],
            _preview_part(ok=1, conflicts=2),
            ("Fn one", "conflict", ALREADY_HERE),
            ("Fn two", "conflict", ALREADY_HERE),
        )
        _assert_part(
            result["functions"],
            _result_part(imported=1, skipped=2),
            ("Fn one", "skipped", ALREADY_HERE),
            ("Fn two", "skipped", ALREADY_HERE),
        )
        assert _library() == {"fn-1": "Fn one", "fn-2": "Fn two", "fn-3": "Fn three"}
        after = stored("functions")
        del after["fn-3"]
        assert (after, function_versions("fn-1"), function_versions("fn-2")) == before

    def test_overwrite_merges_the_versions(self) -> None:
        only_here = function_version("1.2.0", [log_block(message="only here")])
        replaced = function_version("1.0.0", [log_block(message="here")])
        seed("functions", make_function("Fn", "fn-1", [only_here, replaced]))
        incoming = make_function(
            "Fn",
            "fn-1",
            [
                function_version("1.1.0", [log_block(message="new in the backup")]),
                function_version("1.0.0", [log_block(message="from the backup")]),
            ],
        )

        result = apply_plan(_plan({"functions": [incoming]}, conflict_resolution="overwrite"))

        _assert_part(result["functions"], _result_part(imported=1))
        assert _library() == {"fn-1": "Fn"}
        assert function_versions("fn-1") == [only_here, *incoming["versions"]]

    def test_rename_brings_the_function_in_beside_it(self) -> None:
        here = make_function(
            LONG_NAME, "fn-1", [function_version("1.0.0", [log_block(message="here")])]
        )
        seed("functions", here)
        incoming = make_function(
            LONG_NAME, "fn-1", [function_version("1.0.0", [log_block(message="from the backup")])]
        )

        plan = _plan({"functions": [incoming]}, conflict_resolution="rename")
        result = apply_plan(plan)

        _assert_part(result["functions"], _result_part(imported=1))
        new_id = _new_id("fn-1")
        assert _library() == {"fn-1": LONG_NAME, new_id: RENAMED_LONG_NAME}
        assert function_versions("fn-1") == here["versions"]
        assert function_versions(new_id) == incoming["versions"]
        assert plan.id_maps["functions"]["fn-1"] == new_id

    def test_a_test_follows_a_renamed_function(self) -> None:
        seed("functions", make_function("Fn", "fn-1"))
        test = make_test("T", "t-1", [function_block("run", "Run Fn", "fn-1")])
        parts = {
            "functions": [make_function("Fn", "fn-1")],
            "tests": [with_history(test, [history_row()])],
        }

        plan = _plan(parts, conflict_resolution="rename")
        result = apply_plan(plan)

        _assert_part(result["functions"], _result_part(imported=1))
        _assert_part(result["tests"], _result_part(imported=1))
        new_id = _new_id("fn-1")
        assert _library() == {"fn-1": "Fn", new_id: "Fn (2)"}
        assert plan.id_maps["functions"]["fn-1"] == new_id
        (block,) = stored("tests")["t-1"]["workflow"]["nodes"]
        assert block["data"]["functionId"] == new_id

    def test_a_function_follows_a_renamed_function_at_every_depth(self) -> None:
        seed("functions", make_function("Callee", "fn-callee"))
        caller = make_function(
            "Caller",
            "fn-caller",
            [
                function_version("1.1.0", _deep_calls("fn-callee")),
                function_version("1.0.0", _deep_calls("fn-callee")),
            ],
        )
        parts = {"functions": [caller, make_function("Callee", "fn-callee")]}

        plan = _plan(parts, conflict_resolution="rename")
        decided = _item(plan, "Caller").decision.entry["versions"]
        result = apply_plan(plan)

        _assert_part(result["functions"], _result_part(imported=2))
        new_id = _new_id("fn-callee", "fn-caller")
        assert _library() == {"fn-callee": "Callee", "fn-caller": "Caller", new_id: "Callee (2)"}
        assert plan.id_maps["functions"]["fn-callee"] == new_id
        places = _callee_places(flow(*_deep_calls(new_id)))
        for records in (decided, function_versions("fn-caller")):
            assert [_callee_places(record["definition"]["workflow"]) for record in records] == [
                places,
                places,
            ]

    def test_a_name_that_differs_only_by_case_is_a_conflict(self) -> None:
        seed("functions", make_function("Open Tunnel", "fn-here"))
        incoming = make_function("open tunnel", "fn-backup")

        plan = _plan({"functions": [incoming]})
        preview = preview_of(plan)
        result = apply_plan(plan)

        _assert_part(
            preview["functions"],
            _preview_part(conflicts=1),
            ("open tunnel", "conflict", NAME_IN_USE),
        )
        _assert_part(
            result["functions"],
            _result_part(skipped=1),
            ("open tunnel", "skipped", NAME_IN_USE),
        )
        assert _library() == {"fn-here": "Open Tunnel"}

    def test_overwrite_is_fatal_when_the_id_and_the_name_point_at_two_entries(self) -> None:
        seed("functions", make_function("Alpha", "fn-alpha"))
        seed("functions", make_function("Beta", "fn-beta"))
        incoming = make_function("Beta", "fn-alpha", [function_version("2.0.0")])
        blocked = ("Beta", "fatal", NAME_TAKEN)

        plan = _plan({"functions": [incoming]}, conflict_resolution="overwrite")
        preview = preview_of(plan)
        result = apply_plan(plan)

        _assert_part(preview["functions"], _preview_part(fatal=1), blocked)
        _assert_part(result["functions"], _result_part(fatal=1), blocked)
        assert _library() == {"fn-alpha": "Alpha", "fn-beta": "Beta"}
        assert _version_numbers("fn-alpha") == ["1.0.0"]
        assert _version_numbers("fn-beta") == ["1.0.0"]

    def test_a_function_with_a_missing_reference_is_fatal(self) -> None:
        call = function_block("call", "Call ghost", "fn-ghost")
        caller = make_function("Caller", "fn-caller", [function_version("1.0.0", [call])])
        block = re.escape("Call ghost")

        plan = _plan({"functions": [caller, make_function("Plain", "fn-plain")]})
        preview = preview_of(plan)
        result = apply_plan(plan)

        _assert_part(
            preview["functions"],
            _preview_part(ok=1, fatal=1),
            ("Caller", "fatal", MISSING_ANYWHERE.format(block=block)),
        )
        _assert_part(
            result["functions"],
            _result_part(imported=1, fatal=1),
            ("Caller", "fatal", MISSING_HERE.format(block=block)),
        )
        assert _library() == {"fn-plain": "Plain"}

    def test_a_missing_reference_with_no_name_on_the_canvas_reads_uses_a_function(self) -> None:
        call = function_block("", "", "fn-ghost")
        caller = make_function("Caller", "fn-caller", [function_version("1.0.0", [call])])

        plan = _plan({"functions": [caller]})
        preview = preview_of(plan)
        result = apply_plan(plan)

        _assert_part(
            preview["functions"], _preview_part(fatal=1), ("Caller", "fatal", UNNAMED_ANYWHERE)
        )
        _assert_part(result["functions"], _result_part(fatal=1), ("Caller", "fatal", UNNAMED_HERE))
        assert _library() == {}

    @pytest.mark.parametrize("label", ["", "   "], ids=["empty", "blank"])
    def test_a_block_with_an_id_and_no_name_is_not_named_by_its_id(self, label: str) -> None:
        call = function_block("node-1779383867313-vzh88ic", label, "fn-ghost")
        caller = make_function("Caller", "fn-caller", [function_version("1.0.0", [call])])

        plan = _plan({"functions": [caller]})
        preview = preview_of(plan)
        result = apply_plan(plan)

        _assert_part(
            preview["functions"], _preview_part(fatal=1), ("Caller", "fatal", UNNAMED_ANYWHERE)
        )
        _assert_part(result["functions"], _result_part(fatal=1), ("Caller", "fatal", UNNAMED_HERE))
        assert _library() == {}

    def test_functions_in_a_circle_are_fatal(self) -> None:
        calls_b = [function_version("1.0.0", [function_block("call", "Call B", "fn-b")])]
        calls_a = [function_version("1.0.0", [function_block("call", "Call A", "fn-a")])]
        documents = [make_function("A", "fn-a", calls_b), make_function("B", "fn-b", calls_a)]
        circle = (
            ("A", "fatal", CIRCULAR.format(path="A -> B -> A")),
            ("B", "fatal", CIRCULAR.format(path="(A -> B -> A|B -> A -> B)")),
        )

        plan = _plan({"functions": documents})
        preview = preview_of(plan)
        result = apply_plan(plan)

        _assert_part(preview["functions"], _preview_part(fatal=2), *circle)
        _assert_part(result["functions"], _result_part(fatal=2), *circle)
        assert _library() == {}

    def test_a_profile_binding_in_a_body_follows_the_profile(self) -> None:
        seed("profiles", make_profile("bk-profile", "p-here"))
        document = make_function(
            "Fn",
            "fn-1",
            [
                function_version("1.1.0", _bound_blocks("p-backup")),
                function_version("1.0.0", _bound_blocks("p-backup")),
            ],
        )
        parts = {"profiles": [make_profile("bk-profile", "p-backup")], "functions": [document]}

        plan = _plan(parts, conflict_resolution="skip")
        decided = _item(plan, "Fn").decision.entry["versions"]
        result = apply_plan(plan)

        _assert_part(result["functions"], _result_part(imported=1))
        assert set(stored("profiles")) == {"p-here"}
        for records in (decided, function_versions("fn-1")):
            assert _bound_profiles(records) == [["p-here", "p-here"], ["p-here", "p-here"]]

    def test_a_value_sealed_by_another_wave_becomes_null(self) -> None:
        other_wave = SecretCipher(os.urandom(32))
        document = make_function(
            "Fn",
            "fn-1",
            [
                function_version("1.1.0", [_secret_setter(other_wave.seal("sk-newer"))]),
                function_version("1.0.0", [_secret_setter(other_wave.seal("sk-older"))]),
            ],
        )

        result = apply_plan(_plan({"functions": [document]}))

        _assert_part(result["functions"], _result_part(imported=1))
        tokens = _tokens(function_versions("fn-1"))
        assert not any(is_foreign_envelope(token) for token in tokens)
        assert [unseal_all(token) for token in tokens] == [None, None]

    def test_a_masked_placeholder_becomes_null_on_overwrite_where_nothing_is_stored_at_its_place(
        self,
    ) -> None:
        seed("functions", make_function("Fn", "fn-1", [function_version("1.0.0", [log_block()])]))
        masked = [function_version("1.0.0", [_secret_setter(MASK_PLACEHOLDER)])]
        incoming = make_function("Fn", "fn-1", masked)

        result = apply_plan(_plan({"functions": [incoming]}, conflict_resolution="overwrite"))

        _assert_part(result["functions"], _result_part(imported=1))
        assert _tokens(function_versions("fn-1")) == [None]

    @pytest.mark.usefixtures("http_client_plugin")
    @pytest.mark.parametrize("place", ("Setter literal", *_BODY_SECRET_PLACES))
    def test_a_masked_placeholder_keeps_the_secret_stored_at_its_place_on_overwrite(
        self, place: str
    ) -> None:
        seed("functions", make_function("Fn", "fn-1", [_secret_version(place, "sk-real")]))
        incoming = make_function("Fn", "fn-1", [_secret_version(place, MASK_PLACEHOLDER)])

        result = apply_plan(_plan({"functions": [incoming]}, conflict_resolution="overwrite"))

        _assert_part(result["functions"], _result_part(imported=1))
        (record,) = function_versions("fn-1")
        value, secret = _body_secret(place, record["definition"])
        assert (unseal_all(value), secret) == ("sk-real", True)

    @pytest.mark.usefixtures("http_client_plugin")
    @pytest.mark.parametrize("kind", ["foreign", "masked"])
    @pytest.mark.parametrize("place", _BODY_SECRET_PLACES)
    def test_a_secret_wave_cannot_open_in_a_body_becomes_null_in_every_version(
        self, place: str, kind: str
    ) -> None:
        value = SecretCipher(os.urandom(32)).seal("sk") if kind == "foreign" else MASK_PLACEHOLDER
        versions = [_secret_version(place, value, "1.1.0"), _secret_version(place, value, "1.0.0")]

        result = apply_plan(_plan({"functions": [make_function("Fn", "fn-1", versions)]}))

        _assert_part(result["functions"], _result_part(imported=1))
        records = function_versions("fn-1")
        assert [_body_secret(place, record["definition"]) for record in records] == [
            (None, True),
            (None, True),
        ]

    def test_a_masked_setter_literal_becomes_null_on_a_new_function(self) -> None:
        masked = [function_version("1.0.0", [_secret_setter(MASK_PLACEHOLDER)])]

        result = apply_plan(_plan({"functions": [make_function("Fn", "fn-1", masked)]}))

        _assert_part(result["functions"], _result_part(imported=1))
        assert _tokens(function_versions("fn-1")) == [None]

    def test_one_function_that_cannot_be_written_does_not_stop_the_others(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        documents = [
            make_function("First", "fn-first"),
            make_function("Bad", "fn-bad"),
            make_function("Last", "fn-last"),
        ]
        _fail_writes_of("fn-bad", monkeypatch)

        result = apply_plan(_plan({"functions": documents}))

        _assert_part(
            result["functions"],
            _result_part(imported=2, fatal=1),
            ("Bad", "fatal", WRITE_FAILED.format(error=re.escape(WRITE_ERROR))),
        )
        assert _library() == {"fn-first": "First", "fn-last": "Last"}

    def test_unticked_functions_are_not_written_but_are_shown_in_the_preview(self) -> None:
        here = [function_version("1.0.0", [log_block(message="here")])]
        seed("functions", make_function("Here", "fn-here", here))
        before = function_versions("fn-here")
        changed = [function_version("1.0.0", [log_block(message="from the backup")])]
        parts = {
            "environments": [make_environment("bk-env", "env-1")],
            "functions": [
                make_function("Here", "fn-here", changed),
                make_function("New", "fn-new"),
            ],
        }

        plan = _plan(parts, selected=["environments"], conflict_resolution="overwrite")
        preview = preview_of(plan)
        result = apply_plan(plan)

        assert set(plan.selected) == {"environments"}
        _assert_part(
            preview["functions"],
            _preview_part(ok=1, conflicts=1),
            ("Here", "conflict", ALREADY_HERE),
        )
        assert set(result) == {"environments"}
        assert _library() == {"fn-here": "Here"}
        assert function_versions("fn-here") == before

    def test_a_functions_member_that_cannot_be_parsed_is_a_fatal_item(self) -> None:
        content = archive(
            {"functions": [make_function("Readable", "fn-readable")]},
            raw={"functions/broken.yaml": UNPARSABLE_MEMBER},
        )
        broken = ("broken.yaml", "fatal", CANNOT_BE_READ)

        summary = validate_backup(content, "backup.zip")["entity_summary"]
        result = restore_backup(content, "backup.zip")

        assert set(summary) == {"functions"}
        _assert_part(summary["functions"], _preview_part(ok=1, fatal=1), broken)
        assert set(result) == {"functions"}
        _assert_part(result["functions"], _result_part(imported=1, fatal=1), broken)
        assert _library() == {"fn-readable": "Readable"}

    @pytest.mark.parametrize("has_name_key", [False, True], ids=["no name key", "an empty name"])
    def test_a_function_without_a_name_is_fatal(self, has_name_key: bool) -> None:
        call = function_block("call", "Call ghost", "fn-ghost")
        document = make_function("", "fn-nameless", [function_version("1.0.0", [call])])
        if not has_name_key:
            del document["name"]
        nameless = ("fn-nameless", "fatal", NO_NAME)

        plan = _plan({"functions": [document]})
        preview = preview_of(plan)
        result = apply_plan(plan)

        _assert_part(preview["functions"], _preview_part(fatal=1), nameless)
        _assert_part(result["functions"], _result_part(fatal=1), nameless)
        assert _library() == {}
