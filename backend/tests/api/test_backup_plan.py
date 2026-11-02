"""The restore plan of a backup: matches, choices, checks, reasons, preview (REQ-5.2.4.9.6)."""

import copy
import re
import uuid
from typing import Any

import pytest

from tests.api.backup_support import (  # noqa: F401
    MAKERS,
    PARTS,
    UNKNOWN_TYPE_SSH_KEY,
    UNREADABLE_SSH_KEY,
    Document,
    apply_plan,
    build_plan,
    certificate_entry,
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
    seed,
    ssh_entry,
    ssh_key,
    system_variables,
    typed,
    unreadable_certificate_entry,
    with_history,
)
from wavecore.api.services.backup.plan import reason_from_findings, reason_text
from wavecore.api.services.functions import _storage as function_storage
from wavecore.api.services.functions import service as function_service
from wavecore.api.services.tests import service as test_service
from wavecore.api.services.workbench import _common as workbench_common

pytestmark = pytest.mark.usefixtures("empty_store")

ID_PARTS = tuple(MAKERS)
CHOICES = ("skip", "overwrite", "rename")
COUNTS = ("total", "ok", "conflicts", "fixable", "fatal")
TYPE = {
    "tests": "Test",
    "environments": "Environment",
    "profiles": "Profile",
    "suites": "Suite",
    "regressions": "Regression",
    "functions": "Function",
}

ALREADY_HERE = r"^Already in this WAVE$"
NAME_IN_USE = r"^Name already in use$"
NO_NAME = r"^Has no name$"
NO_TYPE = r"^Has no type$"
NO_VARIABLES = r"^Holds no variables$"
RUNNING = r"^The Test here is running$"
UNNAMED_NOWHERE = r"^Uses a Function that is not in the backup or in this WAVE$"
UNNAMED_NOT_HERE = r"^Uses a Function that is not in this WAVE$"
SUITE_NOWHERE = r"^Uses a Suite that is not in the backup or in this WAVE$"
SUITE_NOT_HERE = r"^Uses a Suite that is not in this WAVE$"
CIRCLE = r"^Circular Function reference: A -> B -> A$"
UNREADABLE_KEY = r"^Unreadable key$"
INVALID_CERTIFICATE = r"^Not a valid certificate$"
UNREADABLE_MEMBER = r"^Cannot be read$"

BLOCK = "Run login"
PARAM_MISSING = "Required parameter 'user' is missing"
PARAM_EMPTY = "Required parameter 'message' is empty"


def _function_nowhere(block: str) -> str:
    return rf'^Uses Function "{re.escape(block)}", which is not in the backup or in this WAVE$'


def _function_not_here(block: str) -> str:
    return rf'^Uses Function "{re.escape(block)}", which is not in this WAVE$'


def _version_nowhere(name: str, version: str) -> str:
    used = rf'"{re.escape(name)}" {re.escape(version)}'
    return rf"^Uses Function {used}, which is not in the backup or in this WAVE$"


def _version_not_here(name: str, version: str) -> str:
    used = rf'"{re.escape(name)}" {re.escape(version)}'
    return rf"^Uses Function {used}, which is not in this WAVE$"


def _block_finding(block: str, message: str) -> str:
    return rf'^Block "{re.escape(block)}": {re.escape(message)}$'


def _same_run(type_name: str, match: str) -> str:
    return rf"^The backup holds another {type_name} with this {match}$"


def _name_taken(type_name: str) -> str:
    return rf"^Another {type_name} here has this name$"


def _several(type_name: str) -> str:
    return rf"^Several {type_name}s here have this name$"


def _item(part: str, name: str, item_id: str | None = None, **fields: Any) -> Document:
    """One item of an id-carrying part that passes every check of its type."""
    if part == "tests":
        return make_test(name, item_id, [log_block()], **fields)
    if part == "functions":
        return make_function(name, item_id, [function_version("1.0.0", [log_block()])], **fields)
    return MAKERS[part](name, item_id, **fields)


def _nameless(part: str, item_id: str | None = None) -> Document:
    """An item without a name, and without an id when none is given."""
    document = _item(part, "", item_id)
    del document["name"]
    if item_id is None:
        del document["id"]
    return document


def _typeless(name: str, item_id: str) -> Document:
    return make_profile(name, item_id, profile_type=None)


def _calling(name: str, item_id: str, callee_id: str, version: str = "1.0.0") -> Document:
    """A Function whose one version calls another Function."""
    call = function_block("call", f"Call from {name}", callee_id, version)
    return make_function(name, item_id, [function_version("1.0.0", [call])])


def _using(name: str, item_id: str, function_id: str, version: str = "1.0.0") -> Document:
    """A Test whose one block calls a library Function."""
    return make_test(name, item_id, [function_block("run", BLOCK, function_id, version)])


def _one_of_each() -> dict[str, list[Document]]:
    """One new item of every part, keyed alphabetically, which is not the display order."""
    entities = {part: [_item(part, f"Fresh {TYPE[part]}", f"id-{part}")] for part in ID_PARTS}
    entities["system_variables"] = [system_variables()]
    entities["ssh_hosts"] = [ssh_entry()]
    entities["certificates"] = [certificate_entry()]
    return dict(sorted(entities.items()))


def _planned(part: str, document: Document, **options: Any) -> Any:
    """The plan item of a document that is alone in its part."""
    (item,) = build_plan({part: [document]}, **options).parts[part]
    return item


def _is_new_id(value: Any, *known: str) -> bool:
    return isinstance(value, str) and bool(value) and value not in known


def _open_running_session(monkeypatch: pytest.MonkeyPatch, test_id: str) -> None:
    """Put a workbench session that is running the Test into the session map."""
    session_id = str(uuid.uuid4())
    monkeypatch.setitem(
        workbench_common._workbench_sessions,
        session_id,
        {"session_id": session_id, "test_id": test_id, "status": "running"},
    )


class TestPlanMatch:
    """An item of the backup conflicts on its id, else on its name, and is new otherwise."""

    @pytest.mark.parametrize("part", ID_PARTS)
    def test_an_item_with_no_match_is_ok_and_comes_back_as_itself(self, part: str) -> None:
        seed(part, _item(part, "Here", "id-here"))

        item = _planned(part, _item(part, "Fresh", "id-fresh"))

        assert (item.status, item.action) == ("ok", "create")
        assert (item.target_id, item.target_name) == ("id-fresh", "Fresh")

    @pytest.mark.parametrize("part", ID_PARTS)
    def test_the_same_id_here_is_a_conflict(self, part: str) -> None:
        seed(part, _item(part, "Here", "id-shared"))

        plan = build_plan({part: [_item(part, "From the backup", "id-shared")]})

        (item,) = plan.parts[part]
        assert item.status == "conflict"
        assert re.fullmatch(ALREADY_HERE, item.reason)
        assert preview_of(plan)[part]["conflicts"] == 1

    @pytest.mark.parametrize("part", ID_PARTS)
    def test_the_same_name_on_another_item_is_a_conflict(self, part: str) -> None:
        seed(part, _item(part, "Shared name", "id-here"))

        plan = build_plan({part: [_item(part, "Shared name", "id-backup")]})

        (item,) = plan.parts[part]
        assert item.status == "conflict"
        assert re.fullmatch(NAME_IN_USE, item.reason)
        assert preview_of(plan)[part]["conflicts"] == 1

    @pytest.mark.parametrize(
        "here",
        [
            [("Shared name", "id-shared")],
            [("Another name", "id-shared"), ("Shared name", "id-other")],
        ],
        ids=["on one item", "on two items"],
    )
    def test_an_id_match_together_with_a_name_match_reads_already_in_this_wave(
        self, here: list[tuple[str, str]]
    ) -> None:
        for name, item_id in here:
            seed("tests", _item("tests", name, item_id))

        item = _planned("tests", _item("tests", "Shared name", "id-shared"))

        assert item.status == "conflict"
        assert re.fullmatch(ALREADY_HERE, item.reason)

    @pytest.mark.parametrize(
        ("part", "here", "backup", "status"),
        [
            ("tests", "Nightly", "nightly", "ok"),
            ("tests", "Nightly", " Nightly ", "ok"),
            ("suites", "Nightly", "nightly", "ok"),
            ("suites", "Nightly", " Nightly ", "ok"),
            ("regressions", "Nightly", "nightly", "ok"),
            ("regressions", "Nightly", " Nightly ", "ok"),
            ("profiles", "Nightly", "nightly", "ok"),
            ("profiles", "Nightly", " Nightly ", "ok"),
            ("environments", "Staging", "staging", "ok"),
            ("environments", "Staging", " Staging ", "conflict"),
            ("functions", "Login", "LOGIN", "conflict"),
        ],
    )
    def test_names_compare_by_each_types_rule(
        self, part: str, here: str, backup: str, status: str
    ) -> None:
        seed(part, _item(part, here, "id-here"))

        item = _planned(part, _item(part, backup, "id-backup"))

        assert item.status == status
        assert status == "ok" or re.fullmatch(NAME_IN_USE, item.reason)

    def test_an_item_written_earlier_in_the_run_counts_as_here(self) -> None:
        twins = [_item("tests", "Twin", "id-first"), _item("tests", "Twin", "id-second")]

        first, second = build_plan({"tests": twins}).parts["tests"]

        assert (first.status, first.action) == ("ok", "create")
        assert (second.status, second.action) == ("conflict", "skip")
        assert re.fullmatch(NAME_IN_USE, second.reason)

    def test_an_item_without_an_id_matches_by_name_only(self) -> None:
        seed("tests", _item("tests", "Taken", "id-here"))
        taken, free = _item("tests", "Taken"), _item("tests", "Free")
        del taken["id"], free["id"]

        plan = build_plan({"tests": [taken, free, _item("tests", "Other", "id-other")]})

        conflicting, written, _other = plan.parts["tests"]
        assert conflicting.status == "conflict"
        assert re.fullmatch(NAME_IN_USE, conflicting.reason)
        assert (written.status, written.action) == ("ok", "create")
        assert _is_new_id(written.target_id, "id-here", "id-other")
        assert plan.id_maps["tests"] == {"id-other": "id-other"}


class TestPlanSkip:
    """A skipped item is not written and later parts point at the item here."""

    def test_skip_writes_nothing_and_points_later_parts_at_the_item_here(self) -> None:
        seed("tests", _item("tests", "Smoke", "id-here"))

        plan = build_plan(
            {
                "tests": [_item("tests", "Smoke", "id-backup")],
                "suites": [make_suite("Nightly", "id-suite", ["id-backup"])],
            }
        )

        (test,) = plan.parts["tests"]
        (suite,) = plan.parts["suites"]
        assert test.action == "skip"
        assert plan.id_maps["tests"] == {"id-backup": "id-here"}
        assert suite.document["tests"] == ["id-here"]

    def test_skip_with_several_same_name_items_points_at_the_one_with_the_lowest_id(
        self,
    ) -> None:
        for item_id in ("id-b", "id-a", "id-c"):
            seed("tests", _item("tests", "Twin", item_id))

        plan = build_plan({"tests": [_item("tests", "Twin", "id-backup")]})

        (item,) = plan.parts["tests"]
        assert item.status == "conflict"
        assert re.fullmatch(NAME_IN_USE, item.reason)
        assert plan.id_maps["tests"] == {"id-backup": "id-a"}

    def test_a_skipped_conflict_is_never_fatal_whatever_its_links(self) -> None:
        seed("tests", _item("tests", "Checkout", "id-shared"))

        plan = build_plan({"tests": [_using("Checkout", "id-shared", "id-nowhere")]})

        (item,) = plan.parts["tests"]
        assert (item.status, item.action) == ("conflict", "skip")
        assert re.fullmatch(ALREADY_HERE, item.reason)
        assert preview_of(plan)["tests"]["fatal"] == 0


class TestPlanConflictStatus:
    """A conflict keeps its status and its entry under every choice."""

    @pytest.mark.parametrize("part", ID_PARTS)
    @pytest.mark.parametrize(
        ("backup_name", "backup_id", "text"),
        [("From the backup", "id-here", ALREADY_HERE), ("Here", "id-backup", NAME_IN_USE)],
        ids=["same id", "same name"],
    )
    def test_a_conflict_stays_a_conflict_under_overwrite_and_rename(
        self, part: str, backup_name: str, backup_id: str, text: str
    ) -> None:
        seed(part, _item(part, "Here", "id-here"))

        for choice in CHOICES:
            plan = build_plan(
                {part: [_item(part, backup_name, backup_id)]}, conflict_resolution=choice
            )

            (item,) = plan.parts[part]
            assert (item.status, item.action) == ("conflict", choice)
            assert re.fullmatch(text, item.reason)
            assert preview_of(plan)[part]["items"] == [
                {"name": backup_name, "status": "conflict", "reason": item.reason}
            ]

    def test_the_conflicts_count_does_not_move_with_the_choice(self) -> None:
        seed("system_variables", system_variables())
        seed("environments", make_environment("Staging", "id-staging"))
        seed("functions", _item("functions", "Login", "id-login"))
        seed("tests", _item("tests", "Smoke", "id-here"))
        entities = {
            "system_variables": [system_variables()],
            "environments": [
                make_environment("Staging renamed", "id-staging"),
                make_environment("Production", "id-production"),
            ],
            "functions": [_item("functions", "Login", "id-login")],
            "tests": [_item("tests", "Smoke", "id-backup"), _item("tests", "Fresh", "id-fresh")],
        }

        counts = [
            {
                part: summary["conflicts"]
                for part, summary in preview_of(
                    build_plan(copy.deepcopy(entities), conflict_resolution=choice)
                ).items()
            }
            for choice in CHOICES
        ]

        expected = {"system_variables": 1, "environments": 1, "functions": 1, "tests": 1}
        assert counts == [expected, expected, expected]


class TestPlanOverwrite:
    """Overwrite lands on the same-id item, else on the same-name item, or is refused."""

    def test_overwrite_targets_the_same_id_then_the_same_name(self) -> None:
        seed("tests", _item("tests", "Alpha", "id-alpha"))
        seed("tests", _item("tests", "Beta", "id-beta"))
        entities = {
            "tests": [
                _item("tests", "Alpha renamed", "id-alpha"),
                _item("tests", "Beta", "id-backup"),
            ]
        }

        plan = build_plan(entities, conflict_resolution="overwrite")

        by_id, by_name = plan.parts["tests"]
        assert (by_id.action, by_id.target_id, by_id.target_name) == (
            "overwrite",
            "id-alpha",
            "Alpha renamed",
        )
        assert (by_name.action, by_name.target_id, by_name.target_name) == (
            "overwrite",
            "id-beta",
            "Beta",
        )
        assert plan.id_maps["tests"] == {"id-alpha": "id-alpha", "id-backup": "id-beta"}

    @pytest.mark.parametrize("part", ID_PARTS)
    def test_overwrite_never_lands_on_an_item_of_the_same_archive_with_the_same_name(
        self, part: str
    ) -> None:
        twins = [_item(part, "Twin", "id-first"), _item(part, "Twin", "id-second")]

        first, second = build_plan({part: twins}, conflict_resolution="overwrite").parts[part]

        assert (first.status, first.action) == ("ok", "create")
        assert (second.status, second.action) == ("fatal", "none")
        assert re.fullmatch(_same_run(TYPE[part], "name"), second.reason)

    @pytest.mark.parametrize("part", ID_PARTS)
    @pytest.mark.parametrize("second_name", ["Second", "First"], ids=["id alone", "id and name"])
    def test_overwrite_never_lands_on_an_item_of_the_same_archive_with_the_same_id(
        self, part: str, second_name: str
    ) -> None:
        pair = [_item(part, "First", "id-shared"), _item(part, second_name, "id-shared")]

        first, second = build_plan({part: pair}, conflict_resolution="overwrite").parts[part]

        assert (first.status, first.action) == ("ok", "create")
        assert (second.status, second.action) == ("fatal", "none")
        assert re.fullmatch(_same_run(TYPE[part], "ID"), second.reason)

    @pytest.mark.parametrize("part", ID_PARTS)
    def test_overwrite_is_fatal_when_the_name_belongs_to_another_item(self, part: str) -> None:
        seed(part, _item(part, "Mine", "id-mine"))
        seed(part, _item(part, "Wanted", "id-other"))

        item = _planned(part, _item(part, "Wanted", "id-mine"), conflict_resolution="overwrite")

        assert (item.status, item.action) == ("fatal", "none")
        assert re.fullmatch(_name_taken(TYPE[part]), item.reason)

    @pytest.mark.parametrize("part", ID_PARTS)
    def test_overwrite_is_fatal_when_several_items_here_share_the_name(self, part: str) -> None:
        seed(part, _item(part, "Twin", "id-a"))
        seed(part, _item(part, "Twin", "id-b"))

        item = _planned(part, _item(part, "Twin", "id-backup"), conflict_resolution="overwrite")

        assert (item.status, item.action) == ("fatal", "none")
        assert re.fullmatch(_several(TYPE[part]), item.reason)

    def test_overwrite_of_a_running_test_is_fatal(self, monkeypatch: pytest.MonkeyPatch) -> None:
        seed("tests", _item("tests", "Checkout", "id-here"))
        _open_running_session(monkeypatch, "id-here")

        item = _planned(
            "tests", _item("tests", "Checkout", "id-backup"), conflict_resolution="overwrite"
        )

        assert (item.status, item.action) == ("fatal", "none")
        assert re.fullmatch(RUNNING, item.reason)

    def test_a_running_test_is_only_a_conflict_under_skip(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        seed("tests", _item("tests", "Checkout", "id-here"))
        _open_running_session(monkeypatch, "id-here")

        item = _planned("tests", _item("tests", "Checkout", "id-here"))

        assert (item.status, item.action) == ("conflict", "skip")
        assert re.fullmatch(ALREADY_HERE, item.reason)

    def test_overwrite_of_a_profile_bound_by_tests_is_planned(self) -> None:
        seed("environments", make_environment("Staging", "id-staging"))
        host = {"id-staging": {"host": typed("db.example.test")}}
        seed("profiles", make_profile("Database", "id-profile", host))
        bound = log_block(bindings=[profile_binding("id-profile", "Database")])
        seed("tests", make_test("Uses the profile", "id-test", [bound]))
        port = {"id-staging": {"port": typed(5432, "integer")}}

        item = _planned(
            "profiles",
            make_profile("Database", "id-profile", port),
            conflict_resolution="overwrite",
        )

        assert (item.status, item.action) == ("conflict", "overwrite")


class TestPlanRename:
    """A renamed item comes in beside the one here, under a free name and a free id."""

    def test_rename_keeps_a_free_name_and_numbers_a_taken_one(self) -> None:
        seed("suites", make_suite("Solo", "id-solo"))
        seed("suites", make_suite("Report", "id-report"))
        entities = {
            "suites": [
                make_suite("Solo renamed", "id-solo"),
                make_suite("Report", "id-first"),
                make_suite("Report", "id-second"),
            ]
        }

        items = build_plan(entities, conflict_resolution="rename").parts["suites"]

        assert [(item.action, item.target_name) for item in items] == [
            ("rename", "Solo renamed"),
            ("rename", "Report (2)"),
            ("rename", "Report (3)"),
        ]

        seed("suites", make_suite("Report (2)", "id-report-2"))

        item = _planned("suites", make_suite("Report", "id-third"), conflict_resolution="rename")

        assert item.target_name == "Report (3)"

    def test_rename_keeps_its_id_when_free_and_draws_one_when_taken(self) -> None:
        seed("suites", make_suite("Report", "id-here"))
        entities = {"suites": [make_suite("Report", "id-free"), make_suite("Other", "id-here")]}

        kept, drawn = build_plan(entities, conflict_resolution="rename").parts["suites"]

        assert kept.target_id == "id-free"
        assert _is_new_id(drawn.target_id, "id-here", "id-free")

    def test_a_renamed_function_name_fits_32_characters(self) -> None:
        name = "Provision-the-staging-cluster-01"
        seed("functions", _item("functions", name, "id-here"))

        item = _planned(
            "functions", _item("functions", name, "id-backup"), conflict_resolution="rename"
        )

        assert item.target_name == f"{name[:28]} (2)"
        assert len(item.target_name) == 32

    def test_later_parts_point_at_the_id_the_renamed_item_got(self) -> None:
        seed("tests", _item("tests", "Smoke", "id-test"))

        plan = build_plan(
            {
                "tests": [_item("tests", "Smoke", "id-test")],
                "suites": [make_suite("Nightly", "id-suite", ["id-test"])],
            },
            conflict_resolution="rename",
        )

        (test,) = plan.parts["tests"]
        (suite,) = plan.parts["suites"]
        assert _is_new_id(test.target_id, "id-test")
        assert plan.id_maps["tests"] == {"id-test": test.target_id}
        assert suite.document["tests"] == [test.target_id]


class TestPlanChecks:
    """An item that fails a check is fatal and is not written."""

    @pytest.mark.parametrize("part", ID_PARTS)
    def test_an_item_with_no_name_is_fatal_and_named_by_its_id(self, part: str) -> None:
        seed(part, _item(part, "Here", "id-nameless"))
        blank = _item(part, "")
        del blank["id"]
        documents = [_item(part, "Named", "id-named"), _nameless(part, "id-nameless"), blank]

        named, by_id, by_position = build_plan({part: documents}).parts[part]

        assert named.status == "ok"
        assert (by_id.name, by_id.status, by_id.action) == ("id-nameless", "fatal", "none")
        assert re.fullmatch(NO_NAME, by_id.reason)
        assert (by_position.name, by_position.status, by_position.action) == (
            "Entry 3",
            "fatal",
            "none",
        )
        assert re.fullmatch(NO_NAME, by_position.reason)

    def test_a_test_whose_function_is_nowhere_is_fatal(self) -> None:
        item = _planned("tests", _using("Checkout", "id-test", "id-nowhere"))

        assert (item.status, item.action) == ("fatal", "none")
        assert re.fullmatch(_function_nowhere(BLOCK), item.reason)
        assert re.fullmatch(_function_not_here(BLOCK), item.result_reason)

    @pytest.mark.parametrize(
        "blocks",
        [
            [function_block("node-1779383867313-vzh88ic", "", "id-nowhere")],
            [function_block("node-1779383867313-vzh88ic", "   ", "id-nowhere")],
            [
                local_function_block(
                    "local",
                    "Sign in",
                    [function_block("node-1779383867313-vzh88ic", "", "id-nowhere")],
                )
            ],
        ],
        ids=["an empty name", "a blank name", "inside a Local Function"],
    )
    def test_a_nameless_block_whose_function_is_nowhere_is_not_named(
        self, blocks: list[Document]
    ) -> None:
        item = _planned("tests", make_test("Checkout", "id-test", blocks))

        assert (item.status, item.action) == ("fatal", "none")
        assert re.fullmatch(UNNAMED_NOWHERE, item.reason)
        assert re.fullmatch(UNNAMED_NOT_HERE, item.result_reason)

    def test_a_named_block_inside_a_local_function_is_still_named(self) -> None:
        call = function_block("node-1779383867313-vzh88ic", BLOCK, "id-nowhere")
        document = make_test(
            "Checkout", "id-test", [local_function_block("local", "Local", [call])]
        )

        item = _planned("tests", document)

        assert item.status == "fatal"
        assert re.fullmatch(_function_nowhere(BLOCK), item.reason)
        assert re.fullmatch(_function_not_here(BLOCK), item.result_reason)

    def test_a_test_whose_function_is_in_the_backup_but_will_not_be_here_is_fatal(self) -> None:
        entities = {
            "functions": [_item("functions", "Login", "id-login")],
            "tests": [_using("Checkout", "id-test", "id-login")],
        }

        (item,) = build_plan(entities, selected=["tests"]).parts["tests"]

        assert item.status == "fatal"
        assert re.fullmatch(_function_not_here(BLOCK), item.reason)
        assert re.fullmatch(_function_not_here(BLOCK), item.result_reason)

    @pytest.mark.parametrize("function_is", ["here", "in the backup"])
    def test_a_test_whose_pinned_version_is_nowhere_is_fatal(self, function_is: str) -> None:
        entities = {"tests": [_using("Checkout", "id-test", "id-login", "2.0.0")]}
        if function_is == "here":
            seed("functions", _item("functions", "Login", "id-login"))
        else:
            entities["functions"] = [_item("functions", "Login", "id-login")]

        (item,) = build_plan(entities).parts["tests"]

        assert item.status == "fatal"
        assert re.fullmatch(_version_nowhere("Login", "2.0.0"), item.reason)
        assert re.fullmatch(_version_not_here("Login", "2.0.0"), item.result_reason)

    def test_a_test_whose_pinned_version_is_in_the_backup_but_will_not_be_here_is_fatal(
        self,
    ) -> None:
        seed("functions", _item("functions", "Login", "id-login"))
        versions = [
            function_version("2.0.0", [log_block()]),
            function_version("1.0.0", [log_block()]),
        ]
        entities = {
            "functions": [make_function("Login", "id-login", versions)],
            "tests": [_using("Checkout", "id-test", "id-login", "2.0.0")],
        }

        (item,) = build_plan(entities, selected=["tests"]).parts["tests"]

        assert item.status == "fatal"
        assert re.fullmatch(_version_not_here("Login", "2.0.0"), item.reason)
        assert re.fullmatch(_version_not_here("Login", "2.0.0"), item.result_reason)

    def test_a_test_whose_function_comes_in_the_same_backup_is_ok(self) -> None:
        seed("functions", _item("functions", "Logout", "id-logout"))
        versions = [
            function_version("1.1.0", [log_block()]),
            function_version("1.0.0", [log_block()]),
        ]
        entities = {
            "functions": [make_function("Login", "id-login", versions)],
            "tests": [
                _using("Uses the newest", "id-newest", "id-login", "1.1.0"),
                _using("Uses the older", "id-older", "id-login", "1.0.0"),
                _using("Uses the library", "id-library", "id-logout"),
            ],
        }

        items = build_plan(entities).parts["tests"]

        assert [item.status for item in items] == ["ok", "ok", "ok"]

    def test_the_reference_index_is_read_once_however_many_tests_use_a_function(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        seed("functions", _item("functions", "Login", "id-login"))
        reads: list[str] = []
        read_from_disk = function_storage.load_reference_index

        def _counted() -> dict[str, set[str]]:
            reads.append("read")
            return read_from_disk()

        monkeypatch.setattr(function_storage, "load_reference_index", _counted)

        def _reads_of_a_plan_over(count: int) -> int:
            reads.clear()
            tests = [_using(f"Checkout {n}", f"id-test-{n}", "id-login") for n in range(count)]
            items = build_plan({"tests": tests}).parts["tests"]
            assert [item.status for item in items] == ["ok"] * count
            return len(reads)

        assert (_reads_of_a_plan_over(1), _reads_of_a_plan_over(4)) == (1, 1)

    def test_a_function_member_without_a_versions_list_is_planned_with_its_one_version(
        self,
    ) -> None:
        user = {"name": "user", "type": "string", "required": True}
        single = make_function(
            "Login", "id-login", [function_version("1.2.0", [log_block()], inputs=[user])]
        )
        del single["versions"]
        bound = function_block("run", BLOCK, "id-login", "1.2.0", values={"user": "ashley"})
        entities = {
            "functions": [single],
            "tests": [
                make_test("Bound", "id-bound", [bound]),
                _using("Unbound", "id-unbound", "id-login", "1.2.0"),
                _using("Other version", "id-other", "id-login", "2.0.0"),
            ],
        }
        plan = build_plan(entities)

        with_binding, unbound, other_version = plan.parts["tests"]
        result = apply_plan(plan)

        assert with_binding.status == "ok"
        assert re.fullmatch(_block_finding(BLOCK, PARAM_MISSING), unbound.reason)
        assert re.fullmatch(_version_nowhere("Login", "2.0.0"), other_version.reason)
        assert (result["functions"]["imported"], result["tests"]["imported"]) == (1, 1)
        assert [record["version"] for record in function_versions("id-login")] == ["1.2.0"]

    def test_the_planned_library_carries_the_contract_of_every_planned_version(self) -> None:
        user = {"name": "user", "type": "string", "required": True}
        versions = [
            function_version("1.1.0", [log_block()]),
            function_version("1.0.0", [log_block()], inputs=[user]),
        ]
        bound = function_block("run", BLOCK, "id-login", "1.0.0", values={"user": "ashley"})
        entities = {
            "functions": [make_function("Login", "id-login", versions)],
            "tests": [
                _using("Unbound", "id-unbound", "id-login", "1.0.0"),
                make_test("Bound", "id-bound", [bound]),
                _using("Newest", "id-newest", "id-login", "1.1.0"),
            ],
        }

        unbound, with_binding, newest = build_plan(entities).parts["tests"]

        assert unbound.status == "fatal"
        assert re.fullmatch(_block_finding(BLOCK, PARAM_MISSING), unbound.reason)
        assert (with_binding.status, newest.status) == ("ok", "ok")

    def test_any_other_save_finding_with_a_block_reads_block_and_message(self) -> None:
        silent = make_test("Checkout", "id-test", [log_block("log-1", "Say hello", message="")])

        item = _planned("tests", silent)

        assert (item.status, item.action) == ("fatal", "none")
        assert re.fullmatch(_block_finding("Say hello", PARAM_EMPTY), item.reason)

    def test_a_save_finding_without_a_block_reads_the_message_alone(self) -> None:
        looping = {
            "nodes": [log_block("log-a", "First"), log_block("log-b", "Second")],
            "edges": [
                {"id": "edge-a-b", "source": "log-a", "target": "log-b"},
                {"id": "edge-b-a", "source": "log-b", "target": "log-a"},
            ],
        }

        item = _planned("tests", make_test("Checkout", "id-test", workflow=looping))

        assert (item.status, item.action) == ("fatal", "none")
        assert re.fullmatch(
            r"^Workflow graph contains cycle: log-a -> log-b -> log-a$", item.reason
        )

    def test_the_test_document_is_planned_as_stored_not_as_repaired(self) -> None:
        seed("profiles", make_profile("Database", "id-here"))
        block = log_block("log-1", "Say hello", bindings=[profile_binding("id-backup", "Database")])
        block["data"]["description"] = "d" * 80
        del block["position"]
        test = make_test("Checkout", "id-test", [block])
        test["workflow"]["edges"].append(
            {"id": "edge-dangling", "source": "log-1", "target": "gone"}
        )
        rows = [history_row("1.0.0"), history_row("1.1.0", "Second version")]
        as_stored = copy.deepcopy(test)
        binding = as_stored["workflow"]["nodes"][0]["data"]["config"]["profileBindings"][0]
        binding["profileId"] = "id-here"
        entities = {
            "profiles": [make_profile("Database", "id-backup")],
            "tests": [with_history(test, rows)],
        }

        (item,) = build_plan(entities).parts["tests"]

        assert item.status == "ok"
        assert item.document == as_stored
        assert item.history == rows

    def test_a_function_that_fails_a_structural_check_reads_the_message_alone(self) -> None:
        name = "A Function name of over thirty-two characters"

        item = _planned("functions", _item("functions", name, "id-function"))

        assert (item.status, item.action) == ("fatal", "none")
        assert re.fullmatch(
            rf"^Function name '{re.escape(name)}' exceeds 32 characters$", item.reason
        )

    def test_a_function_with_an_invalid_version_reads_the_message_alone(self) -> None:
        function = make_function("Login", "id-login", [function_version("one", [log_block()])])

        item = _planned("functions", function)

        assert (item.status, item.action) == ("fatal", "none")
        assert re.fullmatch(r"^Invalid version 'one'; expected a valid semver$", item.reason)

    def test_a_function_that_uses_a_function_that_will_not_be_here_is_fatal(self) -> None:
        item = _planned("functions", _calling("Caller", "id-caller", "id-nowhere"))

        assert (item.status, item.action) == ("fatal", "none")
        assert re.fullmatch(_function_nowhere("Call from Caller"), item.reason)

    def test_functions_in_a_circle_are_fatal(self) -> None:
        circle = [_calling("A", "id-a", "id-b"), _calling("B", "id-b", "id-a")]

        first, second = build_plan({"functions": circle}).parts["functions"]

        assert (first.status, second.status) == ("fatal", "fatal")
        assert re.fullmatch(CIRCLE, first.reason)
        assert re.fullmatch(
            r"^Circular Function reference: (A -> B -> A|B -> A -> B)$", second.reason
        )

    @pytest.mark.parametrize("closed_by", ["an older version", "a stored version"])
    def test_a_circle_through_an_older_version_is_found(self, closed_by: str) -> None:
        calls_back = function_block("call", "Call A", "id-a")
        callee = make_function(
            "B",
            "id-b",
            [function_version("2.0.0", [log_block()]), function_version("1.0.0", [calls_back])],
        )
        entities = {"functions": [_calling("A", "id-a", "id-b", "2.0.0")]}
        if closed_by == "a stored version":
            seed("functions", callee)
        else:
            entities["functions"].append(callee)

        caller = build_plan(entities).parts["functions"][0]

        assert caller.status == "fatal"
        assert re.fullmatch(CIRCLE, caller.reason)

    def test_a_regression_whose_suite_is_nowhere_is_fatal(self) -> None:
        item = _planned("regressions", make_regression("Release", "id-regression", ["id-nowhere"]))

        assert (item.status, item.action) == ("fatal", "none")
        assert re.fullmatch(SUITE_NOWHERE, item.reason)
        assert re.fullmatch(SUITE_NOT_HERE, item.result_reason)

    def test_a_regression_whose_suite_is_in_the_backup_but_will_not_be_here_is_fatal(
        self,
    ) -> None:
        entities = {
            "suites": [make_suite("Nightly", "id-suite")],
            "regressions": [make_regression("Release", "id-regression", ["id-suite"])],
        }

        (item,) = build_plan(entities, selected=["regressions"]).parts["regressions"]

        assert item.status == "fatal"
        assert re.fullmatch(SUITE_NOT_HERE, item.reason)
        assert re.fullmatch(SUITE_NOT_HERE, item.result_reason)

    def test_a_regression_whose_suite_comes_in_the_same_backup_is_ok(self) -> None:
        seed("suites", make_suite("Weekly", "id-weekly"))
        entities = {
            "suites": [make_suite("Nightly", "id-nightly")],
            "regressions": [
                make_regression("Release", "id-regression", ["id-nightly", "id-weekly"])
            ],
        }

        (item,) = build_plan(entities).parts["regressions"]

        assert (item.status, item.action) == ("ok", "create")

    def test_a_suite_has_no_link_check(self) -> None:
        entities = {
            "tests": [_using("Checkout", "id-test", "id-nowhere")],
            "suites": [make_suite("Nightly", "id-suite", ["id-test"])],
        }

        plan = build_plan(entities)

        (test,) = plan.parts["tests"]
        (suite,) = plan.parts["suites"]
        assert test.status == "fatal"
        assert (suite.status, suite.document["tests"]) == ("ok", ["id-test"])


class TestPlanTickedParts:
    """Every part of the file is planned; only ticked parts count for the others."""

    def test_an_unticked_part_is_still_planned_and_shown(self) -> None:
        entities = {
            "functions": [
                _item("functions", "Helper", "id-helper"),
                _calling("Caller", "id-caller", "id-helper"),
            ],
            "tests": [_item("tests", "Plain", "id-test")],
        }

        plan = build_plan(entities, selected=["tests"])

        assert [item.status for item in plan.parts["functions"]] == ["ok", "ok"]
        summary = preview_of(plan)["functions"]
        assert (summary["total"], summary["ok"]) == (2, 2)

    def test_ticked_parts_never_count_on_items_of_an_unticked_part(self) -> None:
        entities = {
            "functions": [
                _item("functions", "Login", "id-login"),
                _item("functions", "Logout", "id-logout"),
            ],
            "tests": [
                _using("Signs in", "id-in", "id-login"),
                _using("Signs out", "id-out", "id-logout"),
                _item("tests", "Plain", "id-plain"),
            ],
        }

        ticked = build_plan(copy.deepcopy(entities)).parts["tests"]
        signs_in, signs_out, plain = build_plan(entities, selected=["tests"]).parts["tests"]

        assert [item.status for item in ticked] == ["ok", "ok", "ok"]
        assert (signs_in.status, signs_out.status, plain.status) == ("fatal", "fatal", "ok")
        assert re.fullmatch(_function_not_here(BLOCK), signs_in.reason)
        assert re.fullmatch(_function_not_here(BLOCK), signs_out.reason)

    def test_an_unticked_part_does_not_count_on_another_unticked_part(self) -> None:
        entities = {
            "tests": [_item("tests", "Plain", "id-test")],
            "suites": [make_suite("Nightly", "id-suite", ["id-test"])],
            "regressions": [make_regression("Release", "id-regression", ["id-suite"])],
        }

        (item,) = build_plan(entities, selected=["tests"]).parts["regressions"]

        assert item.status == "fatal"
        assert re.fullmatch(SUITE_NOT_HERE, item.reason)

    def test_selected_holds_the_ticked_parts_the_file_holds(self) -> None:
        entities = {
            "environments": [make_environment("Staging", "id-staging")],
            "tests": [_item("tests", "Plain", "id-test")],
        }

        everything = build_plan(copy.deepcopy(entities))
        some = build_plan(entities, selected=["tests", "suites"])

        assert set(everything.selected) == {"environments", "tests"}
        assert set(some.selected) == {"tests"}
        assert set(preview_of(some)) == {"environments", "tests"}


class TestPlanProfilesWithoutType:
    """A profile without a type is fixable whenever the plan would write it."""

    @pytest.mark.parametrize("auto_repair", [False, True], ids=["off", "on"])
    def test_no_name_is_fatal_first(self, auto_repair: bool) -> None:
        profile = _typeless("", "id-profile")
        del profile["name"]

        item = _planned("profiles", profile, auto_repair=auto_repair)

        assert (item.status, item.action) == ("fatal", "none")
        assert re.fullmatch(NO_NAME, item.reason)

    @pytest.mark.parametrize("auto_repair", [False, True], ids=["off", "on"])
    def test_a_conflict_under_skip_is_a_conflict_with_auto_repair_on_or_off(
        self, auto_repair: bool
    ) -> None:
        seed("profiles", make_profile("Database", "id-database"))
        seed("profiles", make_profile("Cache", "id-cache"))
        entities = {
            "profiles": [_typeless("Renamed", "id-database"), _typeless("Cache", "id-backup")]
        }

        plan = build_plan(entities, auto_repair=auto_repair)

        by_id, by_name = plan.parts["profiles"]
        assert (by_id.status, by_name.status) == ("conflict", "conflict")
        assert re.fullmatch(ALREADY_HERE, by_id.reason)
        assert re.fullmatch(NAME_IN_USE, by_name.reason)
        assert preview_of(plan)["profiles"]["fixable"] == 0

    @pytest.mark.parametrize(
        ("name", "item_id", "choice"),
        [
            ("Fresh", "id-fresh", "skip"),
            ("Database", "id-database", "overwrite"),
            ("Database", "id-database", "rename"),
        ],
        ids=["new", "conflict under overwrite", "conflict under rename"],
    )
    def test_an_item_the_plan_would_write_is_fixable_with_auto_repair_on_or_off(
        self, name: str, item_id: str, choice: str
    ) -> None:
        seed("profiles", make_profile("Database", "id-database"))

        previews = []
        for auto_repair in (False, True):
            plan = build_plan(
                {"profiles": [_typeless(name, item_id)]},
                conflict_resolution=choice,
                auto_repair=auto_repair,
            )
            (item,) = plan.parts["profiles"]
            assert item.status == "fixable"
            previews.append(preview_of(plan)["profiles"])

        counted = {"total": 1, "ok": 0, "conflicts": 0, "fixable": 1, "fatal": 0, "items": []}
        assert previews == [counted, counted]

    @pytest.mark.parametrize(
        ("name", "item_id", "choice", "action"),
        [
            ("Fresh", "id-fresh", "skip", "create"),
            ("Database", "id-database", "overwrite", "overwrite"),
            ("Database", "id-database", "rename", "rename"),
        ],
        ids=["new", "conflict under overwrite", "conflict under rename"],
    )
    def test_auto_repair_decides_what_happens_to_a_fixable_item(
        self, name: str, item_id: str, choice: str, action: str
    ) -> None:
        seed("profiles", make_profile("Database", "id-database"))

        repaired = _planned(
            "profiles", _typeless(name, item_id), conflict_resolution=choice, auto_repair=True
        )
        left = _planned(
            "profiles", _typeless(name, item_id), conflict_resolution=choice, auto_repair=False
        )

        assert (repaired.action, repaired.document["type"]) == (action, "custom")
        assert left.action == "none"
        assert "type" not in left.document
        assert re.fullmatch(NO_TYPE, left.result_reason)


class TestPlanNameLessParts:
    """System Variables, SSH Hosts and Additional Certificates are planned as named items."""

    def test_system_variables_is_one_item_named_system_variables(self) -> None:
        document = system_variables(
            {"api_url": typed("https://wave.example.test"), "region": typed("eu")}
        )

        plan = build_plan({"system_variables": [document]})

        (item,) = plan.parts["system_variables"]
        assert item.name == "System variables"
        assert preview_of(plan)["system_variables"]["total"] == 1

    @pytest.mark.parametrize("choice", CHOICES)
    def test_system_variables_is_a_conflict_under_every_choice_when_any_exists(
        self, choice: str
    ) -> None:
        seed("system_variables", system_variables({"region": typed("eu")}))

        item = _planned("system_variables", system_variables(), conflict_resolution=choice)

        assert item.status == "conflict"
        assert re.fullmatch(ALREADY_HERE, item.reason)

    def test_system_variables_is_ok_when_none_exists_here(self) -> None:
        item = _planned("system_variables", system_variables())

        assert item.status == "ok"

    @pytest.mark.parametrize("document", [{"variables": {}}, {}], ids=["empty", "absent"])
    def test_a_system_variables_document_without_variables_is_fatal(
        self, document: Document
    ) -> None:
        item = _planned("system_variables", document)

        assert (item.status, item.action) == ("fatal", "none")
        assert re.fullmatch(NO_VARIABLES, item.reason)

    def test_an_ssh_host_that_is_here_is_a_conflict_named_by_host_port_and_key_type(
        self,
    ) -> None:
        seed("ssh_hosts", ssh_entry("db1", 2222))
        entries = [ssh_entry("db1", 2222), ssh_entry("db1", 2222, ssh_key("ecdsa-sha2-nistp256"))]

        same_type, other_type = build_plan({"ssh_hosts": entries}).parts["ssh_hosts"]

        assert (same_type.name, same_type.status) == ("db1 port 2222 (ED25519)", "conflict")
        assert re.fullmatch(ALREADY_HERE, same_type.reason)
        assert (other_type.name, other_type.status) == ("db1 port 2222 (ECDSA)", "ok")

    @pytest.mark.parametrize(
        ("public_key", "name"),
        [(UNKNOWN_TYPE_SSH_KEY, "db1 port 22"), (UNREADABLE_SSH_KEY, "db1 port 22 (ED25519)")],
        ids=["key type unknown", "key type known"],
    )
    def test_an_ssh_host_with_an_unreadable_key_is_fatal(self, public_key: str, name: str) -> None:
        item = _planned("ssh_hosts", ssh_entry("db1", 22, public_key))

        assert (item.name, item.status, item.action) == (name, "fatal", "none")
        assert re.fullmatch(UNREADABLE_KEY, item.reason)

    def test_an_ssh_entry_with_no_readable_host_is_named_by_its_position(self) -> None:
        entries = [
            ssh_entry(None),
            ssh_entry(None),
            ssh_entry("db1"),
            ssh_entry("db2", 22, UNREADABLE_SSH_KEY),
            ssh_entry(None),
        ]

        items = build_plan({"ssh_hosts": entries}).parts["ssh_hosts"]

        assert [(item.name, item.status) for item in items] == [
            ("Entry 1", "fatal"),
            ("Entry 2", "fatal"),
            ("db1 port 22 (ED25519)", "ok"),
            ("db2 port 22 (ED25519)", "fatal"),
            ("Entry 5", "fatal"),
        ]
        for item in (items[0], items[1], items[3], items[4]):
            assert re.fullmatch(UNREADABLE_KEY, item.reason)

    def test_a_certificate_that_is_here_is_a_conflict_named_as_the_certificates_page_names_it(
        self,
    ) -> None:
        saved = certificate_entry("Backup Lab Root")
        seed("certificates", saved)
        entries = [copy.deepcopy(saved), certificate_entry("Another Lab Root")]

        here, new = build_plan({"certificates": entries}).parts["certificates"]

        assert (here.name, here.status) == ("Backup Lab Root", "conflict")
        assert re.fullmatch(ALREADY_HERE, here.reason)
        assert (new.name, new.status) == ("Another Lab Root", "ok")

    def test_an_item_that_is_not_a_certificate_is_fatal_and_named_by_its_stored_id(self) -> None:
        item = _planned("certificates", unreadable_certificate_entry("f" * 64))

        assert (item.name, item.status, item.action) == ("f" * 64, "fatal", "none")
        assert re.fullmatch(INVALID_CERTIFICATE, item.reason)

    @pytest.mark.parametrize("part", ["ssh_hosts", "certificates"])
    def test_an_entry_with_the_key_of_an_earlier_entry_of_the_archive_is_a_conflict(
        self, part: str
    ) -> None:
        if part == "ssh_hosts":
            entries = [
                ssh_entry("db1", 22, UNREADABLE_SSH_KEY),
                ssh_entry("db1", 22),
                ssh_entry("db1", 22),
                ssh_entry("db2", 22),
            ]
        else:
            twice = certificate_entry("Backup Lab Root")
            entries = [
                unreadable_certificate_entry(twice["id"]),
                twice,
                copy.deepcopy(twice),
                certificate_entry("Another Lab Root"),
            ]
        plan = build_plan({part: entries})

        unreadable, first, second, other = plan.parts[part]
        result = apply_plan(plan)[part]

        assert [item.status for item in (unreadable, first, other)] == ["fatal", "ok", "ok"]
        assert (second.status, second.action) == ("conflict", "skip")
        assert re.fullmatch(ALREADY_HERE, second.reason)
        assert re.fullmatch(ALREADY_HERE, second.result_reason)
        preview = preview_of(plan)[part]
        assert (preview["ok"], preview["conflicts"], preview["fatal"]) == (2, 1, 1)
        assert (result["imported"], result["skipped"], result["fatal"]) == (2, 1, 1)


class TestPlanUnreadableMembers:
    """An archive member that cannot be parsed is a fatal item of its part."""

    def test_a_member_that_cannot_be_parsed_is_a_fatal_item_named_by_its_member_file_name(
        self,
    ) -> None:
        plan = build_plan({}, unreadable={"tests": ["bad.json"]})

        (item,) = plan.parts["tests"]
        assert (item.name, item.status, item.action) == ("bad.json", "fatal", "none")
        assert re.fullmatch(UNREADABLE_MEMBER, item.reason)

    def test_it_is_counted_and_stands_after_the_parsed_fatal_items(self) -> None:
        seed("tests", _item("tests", "Taken", "id-here"))
        documents = [
            _item("tests", "Taken", "id-backup"),
            _nameless("tests", "id-nameless"),
            _item("tests", "Fresh", "id-fresh"),
        ]

        plan = build_plan({"tests": documents}, unreadable={"tests": ["zeta.yaml", "alpha.yaml"]})

        summary = preview_of(plan)["tests"]
        assert {key: summary[key] for key in COUNTS} == {
            "total": 5,
            "ok": 1,
            "conflicts": 1,
            "fixable": 0,
            "fatal": 3,
        }
        assert [(entry["name"], entry["status"]) for entry in summary["items"]] == [
            ("id-nameless", "fatal"),
            ("alpha.yaml", "fatal"),
            ("zeta.yaml", "fatal"),
            ("Taken", "conflict"),
        ]


class TestPreviewOf:
    """The preview is read off the plan: counts per part and the entries that need a look."""

    def test_a_part_reads_total_ok_conflicts_fixable_fatal_and_items(self) -> None:
        seed("profiles", make_profile("Taken", "id-here"))
        entities = {
            "profiles": [
                make_profile("Fresh", "id-fresh"),
                make_profile("Taken", "id-backup"),
                _typeless("Typeless", "id-typeless"),
                _nameless("profiles", "id-nameless"),
            ],
            "tests": [_item("tests", "Plain", "id-test")],
        }

        preview = preview_of(build_plan(entities))

        for summary in preview.values():
            assert set(summary) == {*COUNTS, "items"}
            assert summary["total"] == sum(summary[key] for key in COUNTS[1:])
        assert {key: preview["profiles"][key] for key in COUNTS} == {
            "total": 4,
            "ok": 1,
            "conflicts": 1,
            "fixable": 1,
            "fatal": 1,
        }

    def test_items_hold_only_conflict_and_fatal_entries_with_the_preview_text(self) -> None:
        seed("tests", _item("tests", "Taken", "id-here"))
        documents = [
            _item("tests", "Fresh", "id-fresh"),
            _item("tests", "Taken", "id-backup"),
            _using("Checkout", "id-checkout", "id-nowhere"),
        ]

        plan = build_plan({"tests": documents})

        _fresh, conflict, fatal = plan.parts["tests"]
        assert re.fullmatch(NAME_IN_USE, conflict.reason)
        assert re.fullmatch(_function_nowhere(BLOCK), fatal.reason)
        assert preview_of(plan)["tests"]["items"] == [
            {"name": "Checkout", "status": "fatal", "reason": fatal.reason},
            {"name": "Taken", "status": "conflict", "reason": conflict.reason},
        ]

    def test_fatal_entries_come_first_then_conflicts_each_in_archive_order(self) -> None:
        seed("environments", make_environment("Staging", "id-staging"))
        seed("environments", make_environment("Production", "id-production"))
        documents = [
            make_environment("Staging", "id-first"),
            _nameless("environments", "id-nameless-1"),
            make_environment("Fresh", "id-fresh"),
            make_environment("Production", "id-second"),
            _nameless("environments", "id-nameless-2"),
        ]

        items = preview_of(build_plan({"environments": documents}))["environments"]["items"]

        assert [(entry["name"], entry["status"]) for entry in items] == [
            ("id-nameless-1", "fatal"),
            ("id-nameless-2", "fatal"),
            ("Staging", "conflict"),
            ("Production", "conflict"),
        ]

    def test_parts_come_in_display_order(self) -> None:
        preview = preview_of(build_plan(_one_of_each()))

        assert list(preview) == list(PARTS)


class TestBuildPlan:
    """The plan decides everything and writes nothing."""

    def test_the_plan_writes_nothing(self) -> None:
        for part in ID_PARTS:
            seed(part, _item(part, "Here", f"here-{part}"))
        seed("system_variables", system_variables())
        entities = _one_of_each()
        for part in ID_PARTS:
            entities[part].append(_item(part, "Here", f"backup-{part}"))
        entities["profiles"].append(_typeless("Typeless", "id-typeless"))
        before = disk_state()

        for choice in CHOICES:
            plan = build_plan(copy.deepcopy(entities), conflict_resolution=choice, auto_repair=True)
            preview_of(plan)

        assert disk_state() == before

    def test_the_plan_holds_an_id_map_per_id_carrying_part(self) -> None:
        for part in ID_PARTS:
            seed(part, _item(part, "Taken", f"here-{part}"))
        entities = {
            part: [_item(part, "Fresh", f"fresh-{part}"), _item(part, "Taken", f"backup-{part}")]
            for part in ID_PARTS
        }

        plan = build_plan(entities)

        assert {part: plan.id_maps[part] for part in ID_PARTS} == {
            part: {f"fresh-{part}": f"fresh-{part}", f"backup-{part}": f"here-{part}"}
            for part in ID_PARTS
        }

    def test_an_item_carries_a_preview_text_and_a_result_text(self) -> None:
        seed("tests", _item("tests", "Taken", "id-here"))
        documents = [
            _item("tests", "Taken", "id-backup"),
            _nameless("tests", "id-nameless"),
            _using("Checkout", "id-checkout", "id-nowhere"),
        ]

        conflict, nameless, missing = build_plan({"tests": documents}).parts["tests"]

        assert re.fullmatch(NAME_IN_USE, conflict.reason)
        assert conflict.result_reason == conflict.reason
        assert re.fullmatch(NO_NAME, nameless.reason)
        assert nameless.result_reason == nameless.reason
        assert re.fullmatch(_function_nowhere(BLOCK), missing.reason)
        assert re.fullmatch(_function_not_here(BLOCK), missing.result_reason)

    def test_only_a_function_item_carries_its_import_decision(self) -> None:
        plan = build_plan(_one_of_each())

        (function,) = plan.parts["functions"]
        others = [
            item for part, items in plan.parts.items() if part != "functions" for item in items
        ]
        assert function.decision.source_id == "id-functions"
        assert [item.decision for item in others] == [None] * 8

    @pytest.mark.parametrize(
        ("kind", "options", "expected"),
        [
            ("fresh", {}, ("ok", "create")),
            ("taken", {"conflict_resolution": "skip"}, ("conflict", "skip")),
            ("taken", {"conflict_resolution": "overwrite"}, ("conflict", "overwrite")),
            ("taken", {"conflict_resolution": "rename"}, ("conflict", "rename")),
            ("nameless", {}, ("fatal", "none")),
            ("typeless", {"auto_repair": False}, ("fixable", "none")),
            ("typeless", {"auto_repair": True}, ("fixable", "create")),
        ],
    )
    def test_the_status_and_the_action_of_an_item_use_the_pinned_values(
        self, kind: str, options: dict[str, Any], expected: tuple[str, str]
    ) -> None:
        seed("profiles", make_profile("Taken", "id-here"))
        documents = {
            "fresh": make_profile("Fresh", "id-fresh"),
            "taken": make_profile("Taken", "id-backup"),
            "nameless": _nameless("profiles", "id-nameless"),
            "typeless": _typeless("Typeless", "id-typeless"),
        }

        item = _planned("profiles", documents[kind], **options)

        assert (item.status, item.action) == expected


MISSING_PARTS = [
    ("MISSING_FUNCTION_ID", {"block": BLOCK}, _function_nowhere(BLOCK), _function_not_here(BLOCK)),
    (
        "MISSING_FUNCTION_VERSION",
        {"block": BLOCK, "function_name": "Login", "version": "2.0.0"},
        _version_nowhere("Login", "2.0.0"),
        _version_not_here("Login", "2.0.0"),
    ),
    ("MISSING_SUITE", {}, SUITE_NOWHERE, SUITE_NOT_HERE),
]

SAME_AT_BOTH_STAGES = [
    ("ALREADY_HERE", {}, ALREADY_HERE),
    ("NAME_IN_USE", {}, NAME_IN_USE),
    ("NO_NAME", {}, NO_NAME),
    ("RUNNING", {"type": "Test"}, RUNNING),
    ("SAME_RUN", {"type": "Suite", "match": "id"}, _same_run("Suite", "ID")),
    ("AMBIGUOUS_NAME", {"type": "Environment"}, _several("Environment")),
    ("CIRCULAR", {"path": ["A", "B", "A"]}, CIRCLE),
    (
        "WRITE_FAILED",
        {"error": "No space left on device"},
        r"^Could not be written: No space left on device$",
    ),
    (
        "FINDING",
        {"message": PARAM_MISSING, "block": BLOCK},
        _block_finding(BLOCK, PARAM_MISSING),
    ),
    ("FINDING", {"message": "Function name is required"}, r"^Function name is required$"),
    ("NO_TYPE", {}, NO_TYPE),
    ("NO_VARIABLES", {}, NO_VARIABLES),
    ("NAME_TAKEN", {"type": "Profile"}, _name_taken("Profile")),
    ("UNREADABLE_KEY", {}, UNREADABLE_KEY),
    ("INVALID_CERTIFICATE", {}, INVALID_CERTIFICATE),
    ("UNREADABLE_MEMBER", {}, UNREADABLE_MEMBER),
]


def _reason_case(code: str, parts: dict[str, Any], stage: str, text: str) -> Any:
    keys = ", ".join(parts) or "no parts"
    return pytest.param(code, parts, stage, text, id=f"{code} with {keys} at {stage}")


REASON_CASES = [
    *(
        _reason_case(code, parts, stage, text)
        for code, parts, text in SAME_AT_BOTH_STAGES
        for stage in ("preview", "result")
    ),
    *(
        _reason_case(code, {**parts, "in_archive": False}, stage, text)
        for code, parts, nowhere, not_here in MISSING_PARTS
        for stage, text in (("preview", nowhere), ("result", not_here))
    ),
]


class TestReasonText:
    """Every reason text is written in one place, from its code, its parts and the stage."""

    @pytest.mark.parametrize(("code", "parts", "stage", "text"), REASON_CASES)
    def test_every_code_gives_its_text_word_for_word(
        self, code: str, parts: dict[str, Any], stage: str, text: str
    ) -> None:
        assert re.fullmatch(text, reason_text(code, parts, stage=stage))

    @pytest.mark.parametrize(
        ("code", "parts", "text"),
        [(code, parts, not_here) for code, parts, _nowhere, not_here in MISSING_PARTS],
        ids=[code for code, *_rest in MISSING_PARTS],
    )
    def test_in_archive_selects_the_not_in_this_wave_text_in_the_preview(
        self, code: str, parts: dict[str, Any], text: str
    ) -> None:
        reason = reason_text(code, {**parts, "in_archive": True}, stage="preview")

        assert re.fullmatch(text, reason)

    @pytest.mark.parametrize(
        "in_archive", [False, True], ids=["not in the backup", "in the backup"]
    )
    @pytest.mark.parametrize(
        ("code", "parts", "text"),
        [(code, parts, not_here) for code, parts, _nowhere, not_here in MISSING_PARTS],
        ids=[code for code, *_rest in MISSING_PARTS],
    )
    def test_the_result_stage_never_says_in_the_backup(
        self, code: str, parts: dict[str, Any], text: str, in_archive: bool
    ) -> None:
        reason = reason_text(code, {**parts, "in_archive": in_archive}, stage="result")

        assert re.fullmatch(text, reason)

    @pytest.mark.parametrize("block", [None, ""], ids=["no name", "an empty name"])
    @pytest.mark.parametrize(
        ("stage", "in_archive", "text"),
        [
            ("preview", False, UNNAMED_NOWHERE),
            ("preview", True, UNNAMED_NOT_HERE),
            ("result", False, UNNAMED_NOT_HERE),
            ("result", True, UNNAMED_NOT_HERE),
        ],
        ids=[
            "preview, not in the backup",
            "preview, in the backup",
            "result, not in the backup",
            "result, in the backup",
        ],
    )
    def test_a_missing_function_with_no_name_on_the_canvas_reads_uses_a_function(
        self, stage: str, in_archive: bool, text: str, block: str | None
    ) -> None:
        parts = {"block": block, "in_archive": in_archive}

        reason = reason_text("MISSING_FUNCTION_ID", parts, stage=stage)

        assert re.fullmatch(text, reason)

    @pytest.mark.parametrize("block", [None, "", BLOCK], ids=["no name", "an empty name", "named"])
    def test_a_missing_version_names_the_function_whatever_its_name_on_the_canvas(
        self, block: str | None
    ) -> None:
        parts = {"block": block, "function_name": "Login", "version": "2.0.0", "in_archive": False}

        preview = reason_text("MISSING_FUNCTION_VERSION", parts, stage="preview")
        result = reason_text("MISSING_FUNCTION_VERSION", parts, stage="result")

        assert re.fullmatch(_version_nowhere("Login", "2.0.0"), preview)
        assert re.fullmatch(_version_not_here("Login", "2.0.0"), result)

    @pytest.mark.parametrize("type_name", TYPE.values())
    @pytest.mark.parametrize(("match", "word"), [("id", "ID"), ("name", "name")])
    def test_same_run_reads_id_or_name_by_its_match(
        self, type_name: str, match: str, word: str
    ) -> None:
        reason = reason_text("SAME_RUN", {"type": type_name, "match": match}, stage="preview")

        assert re.fullmatch(_same_run(type_name, word), reason)

    def test_write_failed_carries_the_error_text(self) -> None:
        error = "[Errno 13] Permission denied: '/data/api_tests/id-test/test.yaml'"

        reason = reason_text("WRITE_FAILED", {"error": error}, stage="result")

        assert re.fullmatch(rf"^Could not be written: {re.escape(error)}$", reason)


class _Backup:
    """Answers and records the two questions a reason asks about a Function."""

    def __init__(self, *, holds: bool = False, name: str | None = "Login") -> None:
        self._holds = holds
        self._name = name
        self.asked_in_archive: list[tuple[str, str | None]] = []
        self.asked_name: list[str] = []

    def in_archive(self, function_id: str, version: str | None = None) -> bool:
        self.asked_in_archive.append((function_id, version))
        return self._holds

    def function_name(self, function_id: str) -> str | None:
        self.asked_name.append(function_id)
        return self._name


def _finding(code: str, message: str, block: str | None = BLOCK, **fields: Any) -> Document:
    """One save-validation finding as a plain dict."""
    return {"code": code, "message": message, "node_id": "run", "node_label": block, **fields}


def _holding(*blocks: Document) -> Document:
    """A Test document whose workflow holds the blocks."""
    return make_test("Checkout", "id-test", blocks)


def _reason_of(
    findings: list[Document],
    backup: _Backup,
    stage: str = "preview",
    document: Document | None = None,
) -> str:
    """The reason of the findings of a document; by default one that holds block `run`."""
    return reason_from_findings(
        findings,
        stage=stage,
        in_archive=backup.in_archive,
        function_name=backup.function_name,
        document=(
            _holding(function_block("run", BLOCK, "id-login")) if document is None else document
        ),
    )


MISSING_FUNCTION = _finding(
    "MISSING_FUNCTION_ID",
    "References unknown Function 'id-login'",
    function_id="id-login",
    function_version="2.0.0",
)
MISSING_VERSION = _finding(
    "MISSING_FUNCTION_VERSION",
    "Pinned version 2.0.0 is no longer available in the library",
    function_id="id-login",
    function_version="2.0.0",
)
EMPTY_PARAM = _finding("REQUIRED_PARAM_EMPTY", PARAM_EMPTY, "Say hello")


class TestReasonFromFindings:
    """The reason of an item that fails its save validation is read off its first finding."""

    def test_only_the_first_finding_is_used(self) -> None:
        empty_first = _reason_of([EMPTY_PARAM, MISSING_FUNCTION], _Backup())
        missing_first = _reason_of([MISSING_FUNCTION, EMPTY_PARAM], _Backup())

        assert re.fullmatch(_block_finding("Say hello", PARAM_EMPTY), empty_first)
        assert re.fullmatch(_function_nowhere(BLOCK), missing_first)

    def test_a_missing_function_that_is_nowhere_reads_not_in_the_backup_or_in_this_wave(
        self,
    ) -> None:
        backup = _Backup(holds=False)

        reason = _reason_of([MISSING_FUNCTION], backup)

        assert re.fullmatch(_function_nowhere(BLOCK), reason)
        assert {function_id for function_id, _version in backup.asked_in_archive} == {"id-login"}

    @pytest.mark.parametrize(
        ("stage", "holds"),
        [("preview", True), ("result", True), ("result", False)],
        ids=["preview, in the backup", "result, in the backup", "result, not in the backup"],
    )
    def test_a_missing_function_that_is_in_the_backup_reads_not_in_this_wave(
        self, stage: str, holds: bool
    ) -> None:
        reason = _reason_of([MISSING_FUNCTION], _Backup(holds=holds), stage)

        assert re.fullmatch(_function_not_here(BLOCK), reason)

    def test_a_missing_version_of_a_known_function_names_the_function_and_the_version(
        self,
    ) -> None:
        nowhere = _Backup(holds=False, name="Login")

        in_neither = _reason_of([MISSING_VERSION], nowhere)
        in_the_backup = _reason_of([MISSING_VERSION], _Backup(holds=True, name="Login"))
        in_the_result = _reason_of([MISSING_VERSION], _Backup(holds=False, name="Login"), "result")

        assert re.fullmatch(_version_nowhere("Login", "2.0.0"), in_neither)
        assert set(nowhere.asked_name) == {"id-login"}
        assert set(nowhere.asked_in_archive) == {("id-login", "2.0.0")}
        assert re.fullmatch(_version_not_here("Login", "2.0.0"), in_the_backup)
        assert re.fullmatch(_version_not_here("Login", "2.0.0"), in_the_result)

    def test_a_missing_version_of_a_function_with_no_known_name_reads_as_a_missing_function(
        self,
    ) -> None:
        reason = _reason_of([MISSING_VERSION], _Backup(holds=False, name=None))

        assert re.fullmatch(_function_nowhere(BLOCK), reason)

    @pytest.mark.parametrize("label", [None, ""], ids=["no name", "an empty name"])
    @pytest.mark.parametrize(
        ("finding", "name"),
        [(MISSING_FUNCTION, "Login"), (MISSING_VERSION, None)],
        ids=["a missing Function", "a missing version of a Function with no known name"],
    )
    def test_a_missing_function_with_no_name_on_the_canvas_reads_uses_a_function(
        self, finding: Document, name: str | None, label: str | None
    ) -> None:
        unnamed = finding | {"node_label": label}

        preview = _reason_of([unnamed], _Backup(holds=False, name=name))
        held = _reason_of([unnamed], _Backup(holds=True, name=name))
        result = _reason_of([unnamed], _Backup(holds=False, name=name), "result")

        assert re.fullmatch(UNNAMED_NOWHERE, preview)
        assert re.fullmatch(UNNAMED_NOT_HERE, held)
        assert re.fullmatch(UNNAMED_NOT_HERE, result)

    @pytest.mark.parametrize(
        ("label", "document"),
        [
            ("run", _holding(function_block("run", "", "id-login"))),
            ("run", _holding(function_block("run", "   ", "id-login"))),
            ("Function", _holding(function_block("run", "", "id-login"))),
            (
                "run",
                _holding(local_function_block("local", "Local", [function_block("run", "", "id")])),
            ),
            (BLOCK, _holding(function_block("other", BLOCK, "id-login"))),
            (BLOCK, _holding()),
            (BLOCK, {"workflow": {"nodes": [{"id": "run"}]}}),
            (BLOCK, {}),
        ],
        ids=[
            "the id of a block with an empty name",
            "the id of a block with a blank name",
            "a name made from the block type",
            "the id of a nameless block inside a Local Function",
            "the name of another block",
            "no such block",
            "a block with no data",
            "a document with no workflow",
        ],
    )
    @pytest.mark.parametrize(
        ("finding", "name"),
        [(MISSING_FUNCTION, "Login"), (MISSING_VERSION, None)],
        ids=["a missing Function", "a missing version of a Function with no known name"],
    )
    def test_a_label_that_is_not_the_name_of_its_block_reads_uses_a_function(
        self, finding: Document, name: str | None, label: str, document: Document
    ) -> None:
        labeled = finding | {"node_label": label}

        preview = _reason_of([labeled], _Backup(holds=False, name=name), document=document)
        result = _reason_of([labeled], _Backup(holds=False, name=name), "result", document)

        assert re.fullmatch(UNNAMED_NOWHERE, preview)
        assert re.fullmatch(UNNAMED_NOT_HERE, result)

    def test_a_named_block_inside_a_local_function_keeps_its_name(self) -> None:
        call = function_block("run", BLOCK, "id-login")
        document = _holding(local_function_block("local", "Local", [call]))

        preview = _reason_of([MISSING_FUNCTION], _Backup(), document=document)
        result = _reason_of([MISSING_FUNCTION], _Backup(), "result", document)

        assert re.fullmatch(_function_nowhere(BLOCK), preview)
        assert re.fullmatch(_function_not_here(BLOCK), result)

    def test_two_blocks_with_one_id_are_told_apart_by_their_names(self) -> None:
        nameless = local_function_block("local", "Local", [function_block("run", "", "id-login")])
        document = _holding(function_block("run", BLOCK, "id-login"), nameless)

        of_the_named = _reason_of([MISSING_FUNCTION], _Backup(), document=document)
        of_the_nameless = _reason_of(
            [MISSING_FUNCTION | {"node_label": "run"}], _Backup(), document=document
        )

        assert re.fullmatch(_function_nowhere(BLOCK), of_the_named)
        assert re.fullmatch(UNNAMED_NOWHERE, of_the_nameless)

    def test_a_missing_version_with_no_name_on_the_canvas_still_names_the_function(self) -> None:
        unnamed = MISSING_VERSION | {"node_label": None}

        preview = _reason_of([unnamed], _Backup(holds=False, name="Login"))
        result = _reason_of([unnamed], _Backup(holds=False, name="Login"), "result")

        assert re.fullmatch(_version_nowhere("Login", "2.0.0"), preview)
        assert re.fullmatch(_version_not_here("Login", "2.0.0"), result)

    def test_a_finding_with_a_block_reads_block_and_message(self) -> None:
        reason = _reason_of([EMPTY_PARAM], _Backup())

        assert re.fullmatch(_block_finding("Say hello", PARAM_EMPTY), reason)

    def test_a_finding_without_a_block_reads_the_message(self) -> None:
        cycle = "Workflow graph contains cycle: log-a -> log-b -> log-a"

        reason = _reason_of([_finding("CYCLE_DETECTED", cycle, None, node_id=None)], _Backup())

        assert re.fullmatch(rf"^{re.escape(cycle)}$", reason)

    @pytest.mark.parametrize(
        "error",
        [
            test_service.SaveValidationError(
                [
                    {
                        "path": "nodes[0].data.config.values.message",
                        "node_id": "log-1",
                        "node_label": "Say hello",
                        "element_type": "log",
                        "code": "REQUIRED_PARAM_EMPTY",
                        "message": PARAM_EMPTY,
                        "severity": "error",
                        "fix_action": None,
                    }
                ]
            ),
            function_service.SaveValidationError(
                [
                    {
                        "code": "REQUIRED_PARAM_EMPTY",
                        "message": PARAM_EMPTY,
                        "severity": "error",
                        "node_id": "log-1",
                        "node_label": "Say hello",
                    }
                ]
            ),
        ],
        ids=["of the Tests service", "of the Functions service"],
    )
    def test_the_findings_of_both_save_validation_error_classes_are_read(self, error: Any) -> None:
        reason = _reason_of(error.errors, _Backup())

        assert re.fullmatch(_block_finding("Say hello", PARAM_EMPTY), reason)


class TestPlanNumberChecks:
    """A restored item's numbers are checked as its save checks them (REQ-3.1.3.14)."""

    PROFILE_REFUSAL = (
        "Configuration validation failed at 'config.port': must be between 1 and 65535"
    )
    VARIABLE_REFUSAL = "Value for variable 'retries' is not a valid integer"

    def test_a_profile_whose_number_a_save_refuses_is_fatal(self) -> None:
        document = make_profile(
            "Orders DB", "id-db", profile_type="database", config={"port": 70000}
        )

        item = _planned("profiles", document)

        assert (item.status, item.action) == ("fatal", "none")
        assert item.reason == item.result_reason == self.PROFILE_REFUSAL

    def test_a_profile_without_a_type_is_checked_as_custom(self) -> None:
        document = _typeless("Loose", "id-loose")
        document["config"] = {"n": typed("abc", "integer")}

        item = _planned("profiles", document, auto_repair=True)

        assert item.status == "fatal"
        assert item.reason == (
            "Configuration validation failed at 'config.n': expected integer, got string"
        )

    @pytest.mark.parametrize("part", ["suites", "regressions"])
    def test_a_variable_value_a_save_refuses_is_fatal(self, part: str) -> None:
        document = _item(
            part, "Nightly", f"id-{part}", variables={"retries": typed("abc", "integer")}
        )

        item = _planned(part, document)

        assert (item.status, item.action) == ("fatal", "none")
        assert item.reason == item.result_reason == self.VARIABLE_REFUSAL

    @pytest.mark.parametrize("part", ["suites", "regressions"])
    def test_a_variable_value_a_save_takes_passes(self, part: str) -> None:
        variables = {"retries": typed("3", "integer"), "note": "not a declaration"}
        document = _item(part, "Nightly", f"id-{part}", variables=variables)

        assert _planned(part, document).status == "ok"

    def test_system_variables_whose_value_a_save_refuses_are_fatal(self) -> None:
        document = system_variables({"retries": typed("abc", "integer")})

        item = _planned("system_variables", document)

        assert (item.status, item.action) == ("fatal", "none")
        assert item.reason == self.VARIABLE_REFUSAL

    def test_a_restored_profile_stores_its_numbers_in_their_wire_form(self) -> None:
        document = make_profile(
            "Rates",
            "id-rates",
            config={"rate": typed(1e-05, "float"), "big": typed(2**60, "integer")},
        )
        plan = build_plan({"profiles": [document]}, conflict_resolution="skip")

        apply_plan(plan, {})

        from wavecore.api.services.profiles import _common as profile_common

        stored = profile_common._profile_storage["id-rates"]["config"]
        assert stored["rate"]["value"] == "0.00001"
        assert stored["big"]["value"] == "1152921504606846976"
