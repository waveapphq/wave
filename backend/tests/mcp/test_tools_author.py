"""Author tools: get_recipe_guide, validate_recipe, create_test_from_recipe.

REQ-5.2.7.9. Recipe problems come back as data findings, creation persists
ONLY through the strict save pipeline, and every packaged worked example must
compile clean (drift guard).
"""

import re
from collections.abc import Callable, Generator
from pathlib import Path
from typing import Any

import pytest
import yaml

from tests.core.recipes.block_creation_values import (
    HTTP_CREATION_VALUES,
    OPENSEARCH_CREATION_VALUES,
    SQL_CREATION_VALUES,
    SSH_OPEN_CREATION_VALUES,
)
from tests.core.recipes.conftest import (
    LOG_STEP,
    create_library_function,
    create_profile,
    find_finding,
    make_recipe,
)
from tests.core.recipes.test_decompiler import DECLARED_INPUTS, assert_round_trip
from tests.mcp.conftest import create_test_entity
from tests.plugins._stub_plugin import let_saved_tests_use_the_stub, register_stub_plugin
from wavecore.core.secrets.cipher import ENVELOPE_PREFIX

EXAMPLE_NAMES = [
    "01-http-smoke",
    "02-branching-loops",
    "03-try-parallel-assert",
    "04-functions",
    "05-secrets-profiles",
    "06-k8s-smoke",
    "07-helm-lifecycle",
    "08-files-testdata",
    "09-shell-blocks",
    "10-python",
    "11-sql",
    "12-opensearch",
]

NAME_CONFLICT_FIX = (
    "Choose a different test name, or amend the existing test with amend_test_from_recipe."
)


@pytest.fixture(autouse=True)
def _registries(seed_registries: None) -> None:
    """Recipe compilation resolves blocks against the live registries."""


@pytest.fixture
def isolated_config() -> Generator[Any, None, None]:
    """The config singleton is process-wide; a test that writes to it must drop it
    afterwards or the next test inherits the mutation."""
    from wavecore.api.config import loader

    yield loader.get_config()
    loader._config_instance = None


@pytest.fixture(autouse=True)
def clear_entity_caches(temp_storage_path: Path) -> Generator[None, None, None]:
    from wavecore.api.services.functions import service as function_service
    from wavecore.api.services.profiles import _common as profile_common

    def _clear() -> None:
        profile_common._clear_in_memory_cache()
        function_service._clear_in_memory_cache()

    _clear()
    yield
    _clear()


def author() -> Any:
    from wavecore.mcp.tools import author as author_tools

    return author_tools


def example_recipe(name: str) -> str:
    """The packaged worked example's recipe text, by file stem."""
    examples = {ex["name"]: ex["recipe"] for ex in author().get_recipe_guide()["examples"]}
    return str(examples[name])


def guide_section(heading: str) -> str:
    """The guide body under ``heading``, up to the next heading of the same level or higher."""
    lines = str(author().get_recipe_guide()["guide"]).splitlines()
    level = len(heading) - len(heading.lstrip("#"))
    start = lines.index(heading)
    for offset in range(start + 1, len(lines)):
        line = lines[offset]
        if line.startswith("#") and len(line) - len(line.lstrip("#")) <= level:
            return "\n".join(lines[start + 1 : offset])
    return "\n".join(lines[start + 1 :])


def guide_paragraphs(heading: str, needle: str) -> str:
    """Every paragraph of a guide section carrying ``needle``, whitespace normalized.

    The guide is hard-wrapped, so a needle is matched against the normalized text.
    """
    parts = [" ".join(part.split()) for part in guide_section(heading).split("\n\n")]
    found = [part for part in parts if needle in part]
    assert found, f"no paragraph under {heading!r} carries {needle!r}"
    return " ".join(found)


def guide_text(heading: str) -> str:
    """A guide section as one whitespace-normalized line."""
    return " ".join(guide_section(heading).split())


def guide_bullets(heading: str) -> list[str]:
    """The top-level bullets of a guide section, each whitespace-normalized."""
    bullets: list[str] = []
    for line in guide_section(heading).splitlines():
        if line.startswith("- "):
            bullets.append(line[2:].strip())
        elif bullets and line.strip():
            bullets[-1] = f"{bullets[-1]} {line.strip()}"
    return bullets


CONDITION_VALUE_TYPES = {"integer", "float", "string", "boolean", "array", "map", "table"}
NULL_CHECKS = {"is_null", "is_not_null"}
TABLE_CHECKS = {"is_null", "is_not_null", "is_empty", "is_not_empty"}


def operator_rows() -> dict[str, set[str]]:
    """The Conditions operator table: each value_type cell -> its row's operator names."""
    rows: dict[str, set[str]] = {}
    for line in guide_section("### Conditions").splitlines():
        if not line.lstrip().startswith("|"):
            continue
        cells = [cell.strip().replace("`", "") for cell in line.strip().strip("|").split("|")]
        if len(cells) != 2 or set(cells[0]) <= set("-: ") or cells[0] == "value_type":
            continue
        operators = re.sub(r"\([^)]*\)", "", cells[1])
        rows[cells[0]] = set(re.findall(r"[a-z]+(?:_[a-z]+)*", operators))
    return rows


SQL_PARAGRAPH_START = "The SQL block (`sql-client`)"
SQL_PARAGRAPH_END = "See `11-sql`."
OPENSEARCH_PARAGRAPH_START = "`opensearch`"
SQL_EXPRESSION_SENTENCE = (
    "`sql` may also be `{expr: ...}`: the expression gives the script text, "
    "and `:name` parameters still bind from `parameters`."
)
FREE_ENTRY_DEFAULT_SENTENCE = (
    "A free-entry setting left out takes its default when the Block runs; "
    "a readback lists only the settings the Block holds."
)
CHOICE_CREATION_SENTENCE = (
    "A choice-list or true / false setting left out is written with its default when the "
    "Block is made, and a readback lists it."
)
NULL_ENTRY_SENTENCE = (
    "A null map value or list row reaches the Block as null; each Block's setting description "
    "says what it does with one (use it, skip it, or fail naming the setting and the entry)."
)
# The word boundary leaves out `call_procedure`, the SQL block's own operation.
CALL_WORD = re.compile(r"\bcall(?:s|ed|er|ers|ing)?\b", re.IGNORECASE)
TOOL_CALL = re.compile(r"\bcall `[a-z_]+`", re.IGNORECASE)
OPENSEARCH_GUIDE_SPANS = [
    "opensearch",
    "mode",
    "search",
    "aggregate",
    "url",
    "username",
    "password",
    "api_key",
    "bearer_token",
    "client_key",
    "verify_ssl",
    "ca_cert",
    "client_cert",
    "index",
    "from",
    "to",
    "now-15m",
    "now/d",
    "now",
    "time_field",
    "@timestamp",
    "query_language",
    "dql",
    "query_dsl",
    "query",
    "{{ }}",
    "{expr: ...}",
    "fields",
    '[{value: "@timestamp"}, {value: log.level}]',
    "{value: {expr: ...}}",
    "max_results",
    "sort_by",
    "order",
    "desc",
    "asc",
    "results",
    "total_results",
    "group_by_time",
    "none",
    "10s",
    "30s",
    "1m",
    "5m",
    "15m",
    "1h",
    "group_by_field",
    "top_values",
    "stats",
    "[{value: {stat: count}}, {value: {stat: percentile, field: latency_ms, percent: 95}}]",
    "stat",
    "count",
    "sum",
    "average",
    "min",
    "max",
    "percentile",
    "unique_count",
    "increase",
    "custom",
    "json",
    "name",
    "timeout",
    "connect_timeout",
    "on_error",
    'url: {expr: "os.url"}',
    "12-opensearch",
]


def blocks_section_text() -> str:
    """The guide's Blocks section as one whitespace-normalized line."""
    return " ".join(guide_section("### Blocks (plugins and controls)").split())


def sql_guide_text() -> str:
    """The SQL block's text: from its opening sentence up to the OpenSearch block's, if any."""
    blocks = blocks_section_text()
    start = blocks.index(SQL_PARAGRAPH_START)
    end = blocks.find(OPENSEARCH_PARAGRAPH_START, start)
    return blocks[start : end if end >= 0 else len(blocks)]


def opensearch_guide_text() -> str:
    """The OpenSearch block's text: from its first mention after the SQL block to the end."""
    blocks = blocks_section_text()
    start = blocks.find(OPENSEARCH_PARAGRAPH_START, blocks.index(SQL_PARAGRAPH_END))
    return blocks[start:] if start >= 0 else ""


def stored_test_ids() -> set[str]:
    from wavecore.api.services.storage_paths import get_tests_storage_path

    root = get_tests_storage_path()
    if not root.exists():
        return set()
    return {path.name for path in root.iterdir() if path.is_dir()}


def simple_recipe(name: str = "Recipe Smoke") -> str:
    return make_recipe(
        [{"block": "log", "settings": {"message": "hello from recipe"}}],
        name=name,
        description="Created through the MCP author tools",
        tags=["mcp", "recipe"],
    )


def undeclared_variable_recipe(name: str = "Recipe Stage2") -> str:
    step = {
        "block": "http-client",
        "settings": {
            "url": "http://shop.local",
            "method": "GET",
            "timeout": {"expr": "missing_var * 10"},
        },
    }
    return make_recipe([step], name=name)


def _seed_example_prerequisites(recipe_text: str) -> None:
    """Create the profiles and library functions a worked example references."""
    doc = yaml.safe_load(recipe_text)
    local_names = {fn.get("name") for fn in doc.get("functions") or []}
    profile_fields: dict[str, set[str]] = {}
    function_steps: list[dict[str, Any]] = []

    def walk(obj: Any) -> None:
        if isinstance(obj, dict):
            if isinstance(obj.get("function"), str):
                function_steps.append(obj)
            bindings = obj.get("profiles")
            if isinstance(bindings, list):
                for binding in bindings:
                    if isinstance(binding, dict) and binding.get("profile"):
                        fields = profile_fields.setdefault(str(binding["profile"]), set())
                        fields.update(map(str, binding.get("fields") or []))
            for value in obj.values():
                walk(value)
        elif isinstance(obj, list):
            for value in obj:
                walk(value)

    walk(doc)

    for profile_name, fields in sorted(profile_fields.items()):
        # A seeded profile holds every field its bindings name.
        config: dict[str, Any] = {"username": "user", "password": "secret"}
        config.update({field: "value" for field in sorted(fields) if field not in config})
        create_profile(profile_name, config=config)

    seeded_functions: set[str] = set()
    for step in function_steps:
        function_name = str(step["function"])
        if not function_name or function_name in local_names:
            continue
        if function_name in seeded_functions:
            continue
        seeded_functions.add(function_name)
        inputs = [
            {
                "name": input_name,
                "type": "string",
                "required": False,
                "default": None,
                "description": "",
            }
            for input_name in (step.get("settings") or {})
        ]
        outputs = [
            {"name": output_name, "type": "string", "description": ""}
            for output_name in (step.get("capture") or {})
        ]
        create_library_function(
            function_name,
            version=str(step.get("version") or "1.0.0"),
            inputs=inputs,
            outputs=outputs,
        )


def _remote_body_block_ids(node: Any) -> list[str]:
    """Every `- block:` id inside any `remote.body` of a recipe document."""
    ids: list[str] = []
    if isinstance(node, dict):
        remote = node.get("remote")
        body = remote.get("body") if isinstance(remote, dict) else None
        if isinstance(body, list):
            ids.extend(
                str(step["block"]) for step in body if isinstance(step, dict) and step.get("block")
            )
        for value in node.values():
            ids.extend(_remote_body_block_ids(value))
    elif isinstance(node, list):
        for value in node:
            ids.extend(_remote_body_block_ids(value))
    return ids


class TestGetRecipeGuide:
    def test_envelope_carries_the_guide_and_all_examples(self) -> None:
        result = author().get_recipe_guide()
        assert set(result.keys()) == {"guide", "examples"}
        assert isinstance(result["guide"], str)
        assert result["guide"].strip() != ""
        assert [example["name"] for example in result["examples"]] == EXAMPLE_NAMES

    def test_each_example_is_self_describing(self) -> None:
        result = author().get_recipe_guide()
        for example in result["examples"]:
            assert set(example.keys()) == {"name", "description", "recipe"}
            assert isinstance(example["description"], str) and example["description"].strip()
            assert isinstance(example["recipe"], str) and example["recipe"].strip()

    def test_the_guide_documents_the_wait_until_container(self) -> None:
        # A guide that advertises the leaf shorthand teaches authors to write definitions
        # the platform rejects.
        guide = author().get_recipe_guide()["guide"]
        assert "- wait_until:" in guide
        assert "wait_until: {condition:" not in guide

    def test_the_files_section_ships_a_wave_side_file_to_the_remote_host(self) -> None:
        # PYRUN-2, NETCAT-10: Python and Netcat ship a WAVE-side file to the remote host.
        paragraph = guide_paragraphs("## Files", "not available on the remote host")

        assert "Python" in paragraph
        assert "read on WAVE" in paragraph
        assert "every other remotable block" in paragraph
        assert "testdata:// paths are not available on the remote host" in paragraph
        assert "Netcat" in paragraph

    def test_the_files_section_lists_sftp_among_the_blocks_that_run_on_wave(self) -> None:
        # REQ-5.2.7.7: SFTP is not remotable, so both schemes work for it inside a body.
        paragraph = guide_paragraphs("## Files", "A block that is not remotable")

        assert (
            "A block that is not remotable (Shell Script, Shell Exec, Excel, SFTP) runs on "
            "WAVE even inside a body" in paragraph
        )

    def test_the_guide_names_the_sql_block(self) -> None:
        # REQ-3.4.1.6: the SQL block is reachable from a recipe by its id.
        assert "sql-client" in author().get_recipe_guide()["guide"]

    def test_the_opensearch_paragraph_follows_the_sql_paragraph(self) -> None:
        blocks = blocks_section_text()

        assert OPENSEARCH_PARAGRAPH_START in blocks, "the Blocks section never names opensearch"
        assert blocks.index(SQL_PARAGRAPH_START) < blocks.index(SQL_PARAGRAPH_END)
        assert blocks.index(SQL_PARAGRAPH_END) < blocks.index(OPENSEARCH_PARAGRAPH_START)

    def test_the_opensearch_paragraph_names_every_setting_value_and_form(self) -> None:
        # REQ-3.4.1.15, REQ-5.1.2: every wire name, choice and row shape a recipe writes.
        text = opensearch_guide_text()

        assert [span for span in OPENSEARCH_GUIDE_SPANS if f"`{span}`" not in text] == []

    def test_the_sql_paragraph_gives_the_script_from_an_expression(self) -> None:
        # SQL-10: an expression gives the script text; :name still binds.
        assert SQL_EXPRESSION_SENTENCE in sql_guide_text()

    def test_the_blocks_section_names_python_for_declared_outputs(self) -> None:
        # PYRUN-6: Python's exports declare outputs the way Shell Script's do.
        paragraph = guide_paragraphs("### Blocks (plugins and controls)", "declares_outputs")

        assert "Shell Script" in paragraph
        assert "Python" in paragraph
        assert "script_variables" in paragraph
        assert "variable's type" in paragraph

    @pytest.mark.parametrize("example_name", EXAMPLE_NAMES)
    def test_every_packaged_example_compiles_clean(self, example_name: str) -> None:
        # Drift guard: the guide is versioned with the server; an example
        # that stops compiling is a contract break, not a docs nit.
        from wavecore.core.recipes.compiler import compile_recipe

        examples = {ex["name"]: ex["recipe"] for ex in author().get_recipe_guide()["examples"]}
        recipe_text = examples[example_name]
        _seed_example_prerequisites(recipe_text)
        result = compile_recipe(recipe_text)
        errors = [f for f in result["findings"] if f["severity"] == "error"]
        assert errors == []
        assert result["test_data"] is not None

    def test_remote_example_body_blocks_are_remotable(self) -> None:
        # REQ-3.4.1.3: a body block that is not remotable runs on WAVE, so an
        # example that puts one there teaches the wrong locus.
        from wavecore.mcp.tools import discover

        body_ids = [
            block_id
            for example in author().get_recipe_guide()["examples"]
            for block_id in _remote_body_block_ids(yaml.safe_load(example["recipe"]))
        ]

        assert body_ids
        for block_id in body_ids:
            assert discover.get_block(block_id)["remotable"] is True, block_id

    def test_every_operator_row_offers_the_null_checks(self) -> None:
        # REQ-3.1.3.25: is_null / is_not_null on every type; a table checks null and emptiness only.
        rows = operator_rows()

        listed = {name.strip() for cell in rows for name in cell.split(",")}
        assert listed == CONDITION_VALUE_TYPES
        assert [cell for cell, operators in rows.items() if not NULL_CHECKS <= operators] == []
        assert rows["table"] == TABLE_CHECKS

    def test_the_conditions_section_reads_null_as_holding_nothing(self) -> None:
        # REQ-3.1.3.25: the holds-nothing answers, and a valueless check's type.
        paragraph = guide_paragraphs("### Conditions", "holding nothing")

        true_on_null = ["not_equals", "does_not_contain", "does_not_have_key", "is_empty"]
        assert [operator for operator in true_on_null if operator not in paragraph] == []
        assert (
            "a comparison with no `value_type` takes the variable's declared type"
            in guide_text("### Conditions").lower()
        )

    def test_the_guide_documents_loops_and_waits_on_null(self) -> None:
        # REQ-3.5.1.15, REQ-3.5.1.16, REQ-3.5.4.3: a null count or collection runs zero times.
        constructs = guide_text("### Constructs")
        assert "zero times" in constructs
        assert "keeps waiting" in constructs

        rules = [rule for rule in guide_bullets("## Rules worth knowing") if "zero times" in rule]
        assert rules, "no rule names the settings that run zero times on null"
        assert "`count`" in rules[0]
        assert "`collection`" in rules[0]

    def test_the_guide_documents_parameter_defaults(self) -> None:
        # REQ-3.1.2.10, REQ-3.1.2.11: `default: null` is no default; a secret input takes none.
        functions = guide_text("## Functions")

        spans = ["`default:`", "`default: null`", "`enumValues`"]
        assert [span for span in spans if span not in functions] == []
        assert "secret input" in functions
        assert "refused" in functions

    def test_the_guide_declares_an_enum_input_by_its_value_type(self) -> None:
        # REQ-3.1.2.11: the value type is the input's type; no array enum, no value type key.
        functions = guide_text("## Functions")

        assert (
            "{name: level, type: string, required: true, enumValues: [low, high], default: low}"
            in functions
        )
        assert "The Function Block binds one of the values" in functions
        assert "declared `type: array` with `required: true`" not in functions
        assert "{name: level, type: array" not in functions
        assert "enumValueType" not in author().get_recipe_guide()["guide"]

    def test_the_guide_says_a_required_input_default_serves_a_run_on_its_own(self) -> None:
        # REQ-3.1.2.10: a Function Block always gives a Required input's value.
        functions = guide_text("## Functions")

        assert "runs on its own" in functions
        assert "`description`" in functions
        guide = author().get_recipe_guide()["guide"]
        assert [
            code for code in ("ENUM_INPUT_DEFAULT", "REQUIRED_INPUT_DEFAULT") if code in guide
        ] == []

    def test_the_guide_never_says_a_function_block_shows_a_required_default(self) -> None:
        # REQ-3.1.2.10: showing or hiding it in a Function Block is Block field work.
        paragraph = guide_paragraphs("## Functions", "runs on its own").lower()

        assert "function block never uses" in paragraph
        assert "only when the function runs on its own" in paragraph
        assert re.search(r"\bshow", paragraph) is None
        assert "never shows" not in author().get_recipe_guide()["guide"].lower()

    def test_the_guide_names_the_input_declaration_findings(self) -> None:
        # REQ-3.1.2.4, REQ-3.1.2.11: every recipe finding a declaration can raise.
        functions = guide_text("## Functions")

        declaration_codes = [
            "ENUM_INPUT_TYPE",
            "ENUM_INPUT_NOT_REQUIRED",
            "ENUM_INPUT_EMPTY",
            "ENUM_VALUE_TYPE",
            "ENUM_VALUE_EMPTY",
            "ENUM_VALUE_REPEATED",
            "ENUM_INPUT_NO_DEFAULT",
            "ENUM_DEFAULT_NOT_ALLOWED",
            "BOOLEAN_INPUT_NO_DEFAULT",
            "SECRET_ENUM_INPUT",
            "SECRET_INPUT_DEFAULT",
            "DUPLICATE_PARAMETER_NAME",
        ]
        assert [code for code in declaration_codes if f"`{code}`" not in functions] == []
        assert "REQUIRED_BOOLEAN_NO_DEFAULT" not in author().get_recipe_guide()["guide"]

    def test_the_guide_promises_no_function_block_default_display(self) -> None:
        # A gray default or a select that starts on the default is Block field work, not shipped.
        functions = guide_text("## Functions").lower()

        words = ["gray", "dropdown", "starts on the default", "starting on the default"]
        assert [word for word in words if word in functions] == []

    def test_the_guide_never_says_caller(self) -> None:
        assert "caller" not in author().get_recipe_guide()["guide"].lower()

    def test_the_guide_keeps_the_unknown_key_rule(self) -> None:
        # REQ-5.2.7.3: the rule holds for every declaration, not only steps.
        rules = [rule for rule in guide_bullets("## Rules worth knowing") if "typo" in rule]

        assert [
            rule
            for rule in rules
            if rule.startswith("A key the format does not define is rejected rather than ignored")
        ] == rules
        assert len(rules) == 1

    def test_the_guide_says_a_made_secret_variable_can_be_made_plain_again(self) -> None:
        # SECUI-12, REQ-3.1.2.9: turning secret off clears the value.
        paragraph = guide_paragraphs("### Blocks (plugins and controls)", "VARIABLE_MADE_SECRET")

        assert "Its value is masked from then on. Making it plain again clears its value." in (
            paragraph
        )
        assert "This holds for a Function Block's marked outputs too." in paragraph
        guide = " ".join(author().get_recipe_guide()["guide"].split())
        assert "can't be made plain again" not in guide
        assert "a call's marked outputs" not in guide

    def test_the_guide_documents_the_output_kind_forms(self) -> None:
        # REQ-3.1.2.8, REQ-3.1.3.15: variables and outputs take expr: and template:.
        assert "template:" in guide_section("## Variables")

        functions = guide_text("## Functions")
        assert "`expr:`" in functions
        assert "`template:`" in functions
        assert "counts as written" in functions

    def test_the_guide_documents_the_unused_parameter_warning(self) -> None:
        # REQ-3.1.2.7: a WARN in the run log on every run, never a blocker.
        functions = guide_text("## Functions")

        assert "WARN" in functions
        assert "run log" in functions

    def test_the_functions_section_never_says_call(self) -> None:
        # Product words are Function Block, root flow and Function flow.
        assert CALL_WORD.findall(guide_text("## Functions")) == []

    def test_the_guide_says_call_only_for_a_tool_or_the_sql_procedure_operation(self) -> None:
        # Calling an MCP tool (Call `get_recipe_guide`) and SQL `call_procedure` keep the word.
        paragraphs = [
            TOOL_CALL.sub("", " ".join(part.split()))
            for part in author().get_recipe_guide()["guide"].split("\n\n")
        ]

        assert [p for p in paragraphs if CALL_WORD.search(p) and "call_procedure" not in p] == []

    def test_the_guide_shows_no_call_step(self) -> None:
        guide = author().get_recipe_guide()["guide"]

        assert "call:" not in guide
        assert [
            code
            for code in ("UNKNOWN_FUNCTION_INPUT", "MISSING_REQUIRED_FUNCTION_INPUT")
            if code in guide
        ] == []

    def test_the_functions_section_shows_function_steps_with_settings(self) -> None:
        # The Function Block step takes the shape of any Block step (REQ-5.2.7.3).
        blocks = re.findall(r"```yaml\n(.*?)```", guide_section("## Functions"), re.DOTALL)
        flows = [doc["flow"] for doc in map(yaml.safe_load, blocks) if "flow" in (doc or {})]

        steps = [step for flow in flows for step in flow]
        assert steps and all(isinstance(step.get("function"), str) for step in steps)
        assert [step for step in steps if {"call", "inputs"} & set(step)] == []
        assert any(isinstance(step.get("settings"), dict) for step in steps)

    def test_the_blocks_section_says_a_free_entry_setting_left_out_takes_its_default(
        self,
    ) -> None:
        assert FREE_ENTRY_DEFAULT_SENTENCE in blocks_section_text()

    def test_the_blocks_section_says_a_choice_setting_left_out_is_written_when_made(
        self,
    ) -> None:
        # FIELD-8: a choice list or true / false always holds a value.
        assert CHOICE_CREATION_SENTENCE in blocks_section_text()

    def test_the_guide_says_a_null_entry_reaches_the_block(self) -> None:
        # FIELD-13: each Block decides what a null map value or list row means.
        guide = " ".join(author().get_recipe_guide()["guide"].split())

        assert NULL_ENTRY_SENTENCE in guide

    def test_the_guide_lists_an_unopened_or_masked_import_as_owed(self) -> None:
        # REQ-4.5.19, REQ-5.2.7.12: such a secret holds null and is owed like a declare-empty one.
        paragraph = guide_paragraphs("### Secret write modes", "NO_VALUE_VARIABLE")

        assert [word for word in ("import", "restore", "masked") if word not in paragraph] == []

    def test_the_guide_documents_csv_and_excel_filters(self) -> None:
        # CSV-12: the one stored filter / sort item shape, typed for recipes too.
        paragraph = guide_paragraphs("### Blocks (plugins and controls)", "filters")

        names = [
            "csv-parser",
            "excel-parser",
            "filters",
            "sorts",
            "column",
            "mode",
            "asType",
            "conditions",
            "_cell",
            "direction",
        ]
        missing = [
            name for name in names if re.search(rf"\b{re.escape(name)}\b", paragraph) is None
        ]
        assert missing == []


def _branching_example_switch() -> dict[str, Any]:
    """The single switch construct in the packaged 02-branching-loops example."""
    examples = {ex["name"]: ex["recipe"] for ex in author().get_recipe_guide()["examples"]}
    document = yaml.safe_load(examples["02-branching-loops"])
    switches = [
        step["switch"]
        for step in document["flow"]
        if isinstance(step, dict) and isinstance(step.get("switch"), dict)
    ]
    assert len(switches) == 1, f"expected exactly one switch step, got {switches!r}"
    return switches[0]


class TestPackagedSwitchExample:
    """The worked example teaches the shape the runtime executes."""

    def test_cases_are_condition_guarded_with_their_own_steps(self) -> None:
        cases = _branching_example_switch()["cases"]
        assert isinstance(cases, list) and cases
        for case in cases:
            assert "when" in case, f"case is not condition-guarded: {case!r}"
            assert isinstance(case["steps"], list) and case["steps"]

    def test_the_removed_keys_are_gone(self) -> None:
        # YAML 1.1 reads a bare 'on:' as boolean True, so both forms are checked.
        switch = _branching_example_switch()
        assert "on" not in switch
        assert True not in switch
        assert "capture" not in switch
        assert all("equals" not in case for case in switch["cases"])

    def test_a_case_demonstrates_fall_through(self) -> None:
        breaks = [case["break"] for case in _branching_example_switch()["cases"] if "break" in case]
        assert False in breaks, "the example never shows Break off"
        assert all(value is False for value in breaks)


def _wait_until_example() -> dict[str, Any]:
    """The single `wait_until` construct in the packaged 02-branching-loops example."""
    examples = {ex["name"]: ex["recipe"] for ex in author().get_recipe_guide()["examples"]}
    document = yaml.safe_load(examples["02-branching-loops"])
    waits = [
        step["wait_until"]
        for step in document["flow"]
        if isinstance(step, dict) and isinstance(step.get("wait_until"), dict)
    ]
    assert len(waits) == 1, f"expected exactly one wait_until step, got {waits!r}"
    return waits[0]


class TestPackagedWaitUntilExample:
    """The worked example teaches the container form the runtime executes."""

    def test_the_example_waits_on_an_assertion_set_with_a_deadline(self) -> None:
        wait = _wait_until_example()
        assert isinstance(wait["that"], list) and wait["that"]
        assert isinstance(wait["timeout"], int)

    def test_the_example_demonstrates_a_retry_lane(self) -> None:
        wait = _wait_until_example()
        assert isinstance(wait["retry"], list) and wait["retry"]

    def test_the_removed_leaf_keys_are_gone(self) -> None:
        wait = _wait_until_example()
        assert "condition" not in wait
        assert "poll_interval" not in wait


def _keys_anywhere(item: Any) -> set[str]:
    """Every mapping key anywhere in a recipe document."""
    if isinstance(item, dict):
        return {str(key) for key in item} | {k for v in item.values() for k in _keys_anywhere(v)}
    if isinstance(item, list):
        return {key for value in item for key in _keys_anywhere(value)}
    return set()


class TestPackagedFunctionsExample:
    """Example 04 writes its Function Blocks as `- function:` steps with `settings`
    (REQ-5.2.7.3, REQ-3.1.2.10)."""

    def _document(self) -> dict[str, Any]:
        return dict(yaml.safe_load(example_recipe("04-functions")))

    def _function_steps(self) -> list[dict[str, Any]]:
        return [step for step in self._document()["flow"] if "function" in step]

    def test_the_flow_runs_the_local_and_the_library_function_blocks(self) -> None:
        steps = self._function_steps()

        assert [step["function"] for step in steps] == ["check_endpoint", "format_report"]
        assert [sorted(step["settings"]) for step in steps] == [["url"], ["summary"]]

    def test_the_library_function_block_pins_its_version(self) -> None:
        assert [step.get("version") for step in self._function_steps()] == [None, "1.0.0"]

    def test_the_example_writes_no_call_step(self) -> None:
        assert {"call", "inputs"} & _keys_anywhere(self._document()["flow"]) == set()

    def test_the_description_never_says_call(self) -> None:
        description = str(self._document()["test"]["description"])

        assert CALL_WORD.findall(description) == []


class TestWaitUntilAuthoring:
    """A recipe carrying a Retry-mode wait validates and creates."""

    RECIPE_VARIABLES: dict[str, Any] = {"pod_phase": {"type": "string", "value": ""}}

    def _recipe(self, name: str) -> str:
        return make_recipe(
            [
                {
                    "wait_until": {
                        "that": ["pod_phase == 'Running'"],
                        "timeout": 30000,
                        "interval": 500,
                        "message": "pod never reached Running",
                        "fail_current_scope": True,
                        "retry": [{"block": "log", "settings": {"message": "still waiting"}}],
                        "capture": {"passed": "pod_ready", "elapsed": "waited_ms"},
                    }
                },
                {"block": "log", "settings": {"message": "carrying on"}},
            ],
            name=name,
            variables=self.RECIPE_VARIABLES,
        )

    def test_a_retry_mode_wait_validates_clean(self) -> None:
        result = author().validate_recipe(self._recipe("Wait Until Validate"))
        assert result["valid"] is True
        assert result["findings"] == []

    def test_a_retry_mode_wait_creates_a_test(self) -> None:
        result = author().create_test_from_recipe(self._recipe("Wait Until Create"))
        assert result["created"] is True
        assert result["action_items"] == []

    def test_the_created_test_carries_the_wait_container(self) -> None:
        from wavecore.api.services.tests import service as test_service

        result = author().create_test_from_recipe(self._recipe("Wait Until Stored"))
        stored = test_service.get_test(result["test_id"])
        assert stored is not None
        waits = [
            node
            for node in stored["workflow"]["nodes"]
            if node["data"]["elementType"] == "wait-until"
        ]
        assert len(waits) == 1
        handles = {
            edge.get("sourceHandle")
            for edge in stored["workflow"]["edges"]
            if edge["source"] == waits[0]["id"]
        }
        assert handles == {"retry", "then"}

    def test_the_removed_leaf_form_is_refused(self) -> None:
        result = author().validate_recipe(
            make_recipe(
                [{"wait_until": {"condition": "pod_phase == 'Running'", "timeout": 30000}}],
                name="Wait Until Leaf",
                variables=self.RECIPE_VARIABLES,
            )
        )
        assert result["valid"] is False
        assert "UNKNOWN_STEP_KEY" in [f["code"] for f in result["findings"]]


class TestValidateRecipe:
    def test_valid_recipe_returns_a_clean_verdict(self) -> None:
        result = author().validate_recipe(simple_recipe("Validate Clean"))
        assert result == {"valid": True, "test_name": "Validate Clean", "findings": []}

    def test_validation_persists_nothing(self) -> None:
        before = stored_test_ids()
        author().validate_recipe(simple_recipe("Validate Dry Run"))
        assert stored_test_ids() == before

    def test_warnings_survive_a_valid_verdict(self, monkeypatch: pytest.MonkeyPatch) -> None:
        let_saved_tests_use_the_stub(monkeypatch)
        recipe = make_recipe([{"block": register_stub_plugin()}], name="Validate Stubbed")
        result = author().validate_recipe(recipe)
        assert result["valid"] is True
        assert result["test_name"] == "Validate Stubbed"
        finding = find_finding(result["findings"], "STUB_BLOCK")
        assert finding["severity"] == "warning"

    def test_stage1_problems_come_back_as_findings(self) -> None:
        recipe = make_recipe([{"block": "no-such-block"}], name="Validate Broken")
        result = author().validate_recipe(recipe)
        assert result["valid"] is False
        assert result["test_name"] == "Validate Broken"
        find_finding(result["findings"], "UNKNOWN_BLOCK")

    def test_parse_failures_are_findings_not_exceptions(self) -> None:
        result = author().validate_recipe("test: [unclosed\n")
        assert result["valid"] is False
        assert result["test_name"] is None
        find_finding(result["findings"], "RECIPE_PARSE_ERROR")

    def test_stage2_platform_errors_relay_in_recipe_coordinates(self) -> None:
        result = author().validate_recipe(undeclared_variable_recipe("Validate Stage2"))
        assert result["valid"] is False
        finding = find_finding(result["findings"], "UNDECLARED_VARIABLE")
        assert finding["step"] == "flow[0]"
        assert finding["severity"] == "error"

    def test_undeclared_variable_in_a_template_is_reported(self) -> None:
        """A '{{ }}' typo fails validation, not only the run."""
        recipe = make_recipe(
            [{"block": "log", "settings": {"message": "value is {{ ghost_var }} end"}}],
            name="Validate Template Ref",
        )
        result = author().validate_recipe(recipe)
        assert result["valid"] is False
        finding = find_finding(result["findings"], "UNDECLARED_VARIABLE")
        assert finding["severity"] == "error"
        assert "ghost_var" in finding["problem"]

    def test_name_conflict_is_reported_with_the_create_path_message(self) -> None:
        create_test_entity("Already Here")
        result = author().validate_recipe(simple_recipe("Already Here"))
        assert result["valid"] is False
        finding = find_finding(result["findings"], "NAME_CONFLICT")
        assert finding["step"] == "test"
        assert finding["problem"] == "Test with name 'Already Here' already exists"
        assert finding["fix"] == NAME_CONFLICT_FIX

    def test_a_remote_host_file_io_in_a_body_takes_a_testdata_path(self) -> None:
        recipe = make_recipe(
            [
                {
                    "remote": {
                        "settings": {"session_id": {"expr": "ssh_session"}},
                        "body": [
                            {
                                "block": "file-io",
                                "settings": {"operation": "read", "path": "testdata://orders.csv"},
                            }
                        ],
                    }
                }
            ],
            name="File IO In A Remote Body",
            variables={"ssh_session": {"type": "string", "value": "main"}},
        )
        created = author().create_test_from_recipe(recipe)
        errors = [item for item in created.get("findings", []) if item["severity"] == "error"]
        assert errors == []
        folder = Path(testdata_folder(created["test_id"]))
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "orders.csv").write_text("id\n1\n", encoding="utf-8")

        result = author().validate_recipe(recipe, test_ref="File IO In A Remote Body")

        assert result["findings"] == []
        assert result["valid"] is True


class TestShellBlockRecipes:
    """A Shell Script recipe reaches the verdict the run would (REQ-3.4.1.1)."""

    def _recipe(self, settings: dict[str, Any], name: str) -> str:
        return make_recipe([{"block": "shell-script", "settings": settings}], name=name)

    def test_source_without_a_script_reports_the_missing_parameter(self) -> None:
        result = author().validate_recipe(
            self._recipe({"script_type": "source"}, "Shell Script Source Empty")
        )

        assert result["valid"] is False
        finding = find_finding(result["findings"], "MISSING_REQUIRED_SETTING")
        assert finding["step"] == "flow[0].settings.script"
        assert finding["severity"] == "error"
        assert finding["problem"] == "Required setting 'script' is missing for block 'shell-script'"

    def test_file_without_a_script_file_reports_the_missing_parameter(self) -> None:
        result = author().validate_recipe(
            self._recipe({"script_type": "file"}, "Shell Script File Empty")
        )

        assert result["valid"] is False
        finding = find_finding(result["findings"], "MISSING_REQUIRED_SETTING")
        assert finding["step"] == "flow[0].settings.script_file"
        assert finding["problem"] == (
            "Required setting 'script_file' is missing for block 'shell-script'"
        )

    def test_a_shell_script_in_a_remote_body_keeps_the_wave_side_schemes(self) -> None:
        # SHRUN-1: it runs on WAVE even inside a body, so its paths are WAVE paths.
        recipe = make_recipe(
            [
                {
                    "remote": {
                        "settings": {"session_id": {"expr": "ssh_session"}},
                        "body": [
                            {
                                "block": "shell-script",
                                "settings": {"script": "echo hi", "working_dir": "testdata://x"},
                            }
                        ],
                    }
                }
            ],
            name="Shell Script In A Remote Body",
            variables={"ssh_session": {"type": "string", "value": "main"}},
        )

        result = author().validate_recipe(recipe)

        assert "REMOTE_HOST_PATH_SCHEME" not in [item["code"] for item in result["findings"]]
        assert result["valid"] is True

    def test_stop_on_pattern_with_two_empty_patterns_is_left_to_the_run(self) -> None:
        # SHRUN-13: the at-least-one rule is the plugin's, raised at run start.
        result = author().validate_recipe(
            self._recipe(
                {
                    "script": "echo hi",
                    "stop_on_pattern": True,
                    "pass_pattern": "",
                    "fail_pattern": "",
                },
                "Shell Script Empty Patterns",
            )
        )

        assert result == {
            "valid": True,
            "test_name": "Shell Script Empty Patterns",
            "findings": [],
        }


class TestCreateTestFromRecipe:
    def test_successful_create_returns_the_handle_envelope(self) -> None:
        result = author().create_test_from_recipe(simple_recipe("Created Via Recipe"))
        assert set(result.keys()) == {
            "created",
            "test_id",
            "name",
            "version",
            "warnings",
            "repairs",
            "action_items",
        }
        assert result["created"] is True
        assert result["name"] == "Created Via Recipe"
        assert result["version"] == "1.0.0"
        assert result["warnings"] == []
        assert result["action_items"] == []

    def test_created_test_persists_through_the_strict_pipeline(self) -> None:
        from wavecore.api.services.storage_paths import get_tests_storage_path
        from wavecore.api.services.tests import service as test_service

        result = author().create_test_from_recipe(simple_recipe("Persisted Via Recipe"))
        test_dir = get_tests_storage_path() / result["test_id"]
        assert (test_dir / "test.yaml").exists()

        stored = test_service.get_test(result["test_id"])
        assert stored is not None
        assert stored["name"] == "Persisted Via Recipe"
        assert stored["version"] == "1.0.0"
        assert stored["description"] == "Created through the MCP author tools"
        assert stored["metadata"]["tags"] == ["mcp", "recipe"]
        nodes = stored["workflow"]["nodes"]
        assert len(nodes) == 1
        assert stored["workflow"]["edges"][0]["source"] == "start-node"

    def test_version_history_attributes_creation_to_system(self) -> None:
        from wavecore.api.services.storage_paths import get_tests_storage_path

        result = author().create_test_from_recipe(simple_recipe("Attributed Via Recipe"))
        versions_file = get_tests_storage_path() / result["test_id"] / "versions.yaml"
        versions = yaml.safe_load(versions_file.read_text())
        assert versions[0]["version"] == "1.0.0"
        assert versions[0]["created_by"] == "system"

    def test_secret_variables_are_sealed_at_rest(self) -> None:
        from wavecore.api.services.storage_paths import get_tests_storage_path

        recipe = make_recipe(
            [{"block": "log", "settings": {"message": "shh"}}],
            name="Sealed Via Recipe",
            variables={"password": {"type": "string", "secret": True, "value": "hunter2secret"}},
        )
        result = author().create_test_from_recipe(recipe)
        raw = (get_tests_storage_path() / result["test_id"] / "test.yaml").read_text()
        assert ENVELOPE_PREFIX in raw
        assert "hunter2secret" not in raw

    def test_stub_warnings_ride_along_on_success(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from wavecore.api.services.tests import service as test_service

        let_saved_tests_use_the_stub(monkeypatch)
        stub_id = register_stub_plugin()
        recipe = make_recipe([{"block": stub_id}], name="Stub Via Recipe")
        result = author().create_test_from_recipe(recipe)
        assert result["created"] is True
        finding = find_finding(result["warnings"], "STUB_BLOCK")
        assert finding["severity"] == "warning"
        stored = test_service.get_test(result["test_id"])
        assert stored is not None
        assert [node["data"]["elementType"] for node in stored["workflow"]["nodes"]] == [stub_id]

    def test_stage1_failure_creates_nothing(self) -> None:
        before = stored_test_ids()
        result = author().create_test_from_recipe(
            make_recipe([{"block": "no-such-block"}], name="Never Created")
        )
        assert set(result.keys()) == {"created", "findings"}
        assert result["created"] is False
        find_finding(result["findings"], "UNKNOWN_BLOCK")
        assert stored_test_ids() == before

    def test_stage2_failure_creates_nothing(self) -> None:
        before = stored_test_ids()
        result = author().create_test_from_recipe(undeclared_variable_recipe("Never Created 2"))
        assert result["created"] is False
        finding = find_finding(result["findings"], "UNDECLARED_VARIABLE")
        assert finding["step"] == "flow[0]"
        assert stored_test_ids() == before

    def test_name_conflict_creates_nothing(self) -> None:
        create_test_entity("Taken By Hand")
        before = stored_test_ids()
        result = author().create_test_from_recipe(simple_recipe("Taken By Hand"))
        assert result["created"] is False
        finding = find_finding(result["findings"], "NAME_CONFLICT")
        assert finding["problem"] == "Test with name 'Taken By Hand' already exists"
        assert finding["fix"] == NAME_CONFLICT_FIX
        assert stored_test_ids() == before

    def test_parse_failure_creates_nothing(self) -> None:
        before = stored_test_ids()
        result = author().create_test_from_recipe("test: [unclosed\n")
        assert result["created"] is False
        find_finding(result["findings"], "RECIPE_PARSE_ERROR")
        assert stored_test_ids() == before

    def test_non_mapping_recipe_document_creates_nothing(self) -> None:
        # A recipe that parses to a non-dict has no variables to resolve; the
        # secret-file pre-pass returns it unchanged and compilation rejects it.
        before = stored_test_ids()
        result = author().create_test_from_recipe("- just a list item\n")
        assert result["created"] is False
        assert stored_test_ids() == before

    def test_branch_rejoin_edges_survive_persistence(self) -> None:
        # Guard: the save pipeline's multi-edge autofix must not strip the
        # converging edges a construct's continuation step rides on.
        from wavecore.api.services.tests import service as test_service

        recipe = make_recipe(
            [
                {
                    "if": {
                        "when": "1 == 1",
                        "then": [{"delay": 100}],
                        "else": [{"delay": 250}],
                    }
                },
                {"block": "log", "settings": {"message": "after the join"}},
            ],
            name="Rejoin Via Recipe",
        )
        result = author().create_test_from_recipe(recipe)
        assert result["created"] is True
        stored = test_service.get_test(result["test_id"])
        assert stored is not None
        log_node = next(n for n in stored["workflow"]["nodes"] if n["data"]["elementType"] == "log")
        incoming = [e for e in stored["workflow"]["edges"] if e["target"] == log_node["id"]]
        assert len(incoming) == 2
        assert sorted(e.get("targetHandle") or "" for e in incoming) == ["", "ingress_1"]


TARGET_NOT_EXPRESSIBLE_PROBLEM = (
    "The target test uses connectivity the recipe format cannot express; "
    "amending it through a recipe would drop that wiring."
)
TARGET_NOT_EXPRESSIBLE_FIX = (
    "Edit this test directly in the workbench. Recipe amendment is available "
    "only for tests that round-trip fully."
)


def _inexpressible_workflow() -> dict[str, Any]:
    """Canvas with an orphan node unreachable from start-node (inexpressible)."""
    return {
        "nodes": [
            {
                "id": "node-1",
                "type": "workflowNode",
                "position": {"x": 100, "y": 100},
                "data": {
                    "label": "Reachable",
                    "elementType": "log",
                    "nodeType": "plugin",
                    "version": "1.0.0",
                    "config": {"values": {"message": "reachable"}},
                },
            },
            {
                "id": "node-orphan",
                "type": "workflowNode",
                "position": {"x": 100, "y": 300},
                "data": {
                    "label": "Orphan",
                    "elementType": "log",
                    "nodeType": "plugin",
                    "version": "1.0.0",
                    "config": {"values": {"message": "orphan"}},
                },
            },
        ],
        "edges": [{"id": "edge-start-node-1", "source": "start-node", "target": "node-1"}],
    }


def _expressible_workflow() -> dict[str, Any]:
    """Near-tree single reachable node with NO recipeKey (nothing to pin on amend)."""
    return {
        "nodes": [
            {
                "id": "node-1",
                "type": "workflowNode",
                "position": {"x": 100, "y": 100},
                "data": {
                    "label": "Reachable",
                    "elementType": "log",
                    "nodeType": "plugin",
                    "version": "1.0.0",
                    "config": {"values": {"message": "reachable"}},
                },
            }
        ],
        "edges": [{"id": "edge-start-node-1", "source": "start-node", "target": "node-1"}],
    }


def _keyed_workflow(**geometry: Any) -> dict[str, Any]:
    """Single recipe-built node (recipeKey flow[0]) with optional stored width/height."""
    return {
        "nodes": [
            {
                "id": "node-1",
                "type": "workflowNode",
                "position": {"x": 100, "y": 100},
                **geometry,
                "data": {
                    "label": "Reachable",
                    "recipeKey": "flow[0]",
                    "elementType": "log",
                    "nodeType": "plugin",
                    "version": "1.0.0",
                    "config": {"values": {"message": "reachable"}},
                },
            }
        ],
        "edges": [{"id": "edge-start-node-1", "source": "start-node", "target": "node-1"}],
    }


def _write_test_with_workflow(name: str, workflow: dict[str, Any]) -> str:
    """Persist a test.yaml directly so a bespoke workflow bypasses save validation."""
    import uuid

    from wavecore.api.services.storage_paths import get_tests_storage_path
    from wavecore.api.services.tests.service import _clear_in_memory_cache

    test_id = str(uuid.uuid4())
    test_dir = get_tests_storage_path() / test_id
    test_dir.mkdir(parents=True, exist_ok=True)
    (test_dir / "test.yaml").write_text(
        yaml.dump(
            {
                "id": test_id,
                "name": name,
                "version": "1.0.0",
                "description": "",
                "workflow": workflow,
                "variables": {},
                "metadata": {},
                "created_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-01T00:00:00+00:00",
            }
        )
    )
    _clear_in_memory_cache()
    return test_id


class TestGetTestRecipe:
    def test_returns_the_readback_envelope(self) -> None:
        created = author().create_test_from_recipe(simple_recipe("Readback Target"))
        result = author().get_test_recipe("Readback Target")
        assert set(result.keys()) == {
            "test_id",
            "name",
            "version",
            "recipe",
            "expressible",
            "inexpressible",
        }
        assert result["test_id"] == created["test_id"]
        assert result["name"] == "Readback Target"
        assert result["version"] == "1.0.0"
        assert result["expressible"] is True
        assert result["inexpressible"] == []
        assert isinstance(result["recipe"], str) and result["recipe"].strip()

    def test_readback_recipe_recompiles_clean(self) -> None:
        from wavecore.core.recipes.compiler import compile_recipe

        author().create_test_from_recipe(simple_recipe("Recompile Target"))
        result = author().get_test_recipe("Recompile Target")
        recompiled = compile_recipe(result["recipe"])
        errors = [f for f in recompiled["findings"] if f["severity"] == "error"]
        assert errors == []
        assert recompiled["test_data"] is not None

    def test_a_stored_secret_setting_reads_back_only_when_written_as_an_expression(self) -> None:
        k8s_step = {
            "block": "k8s-get",
            "settings": {"session": {"expr": "kube"}, "kind": "Pod", "name": "web-0"},
        }
        sql_step = {
            "block": "sql-client",
            "settings": {
                "host": "db",
                "database": "wave",
                "username": "wave",
                "password": "pw-classified",
                "sql": "SELECT 1",
            },
        }
        recipe = make_recipe(
            [k8s_step, sql_step],
            name="Secret Expression Readback",
            variables={"kube": {"type": "string", "secret": True}},
        )
        created = author().create_test_from_recipe(recipe)
        assert created["created"] is True, created["findings"]

        readback = author().get_test_recipe(created["test_id"])["recipe"]

        k8s, sql = yaml.safe_load(readback)["flow"]
        assert k8s["settings"]["session"] == {"expr": "kube"}
        assert "password" not in sql["settings"]
        assert "pw-classified" not in readback

    def test_resolves_the_target_by_id(self) -> None:
        created = author().create_test_from_recipe(simple_recipe("Readback By Id"))
        result = author().get_test_recipe(created["test_id"])
        assert result["name"] == "Readback By Id"

    def test_inexpressible_target_reports_expressible_false(self) -> None:
        _write_test_with_workflow("Readback Inexpressible", _inexpressible_workflow())
        result = author().get_test_recipe("Readback Inexpressible")
        assert result["expressible"] is False
        assert result["inexpressible"] != []
        for item in result["inexpressible"]:
            assert set(item.keys()) == {"what", "where"}

    def test_absent_target_raises_not_found(self) -> None:
        from wavecore.api.exceptions import NotFoundException

        with pytest.raises(NotFoundException, match=r"^Test 'ghost' not found$"):
            author().get_test_recipe("ghost")


def declared_inputs_recipe(name: str, inputs: list[dict[str, Any]]) -> str:
    functions = [
        {
            "name": "probe",
            "inputs": inputs,
            "outputs": [],
            "flow": [{"block": "log", "settings": {"message": "{{ level }} {{ port }}"}}],
        }
    ]
    settings = {item["name"]: "high" if item["name"] == "level" else 8080 for item in inputs}
    step = {"function": "probe", "settings": settings}
    return make_recipe([step], name=name, functions=functions)


def boolean_input_recipe(name: str, flag: dict[str, Any]) -> str:
    functions = [{"name": "probe", "inputs": [flag], "outputs": [], "flow": [LOG_STEP]}]
    return make_recipe([{"function": "probe"}], name=name, functions=functions)


BOOLEAN_INPUT_NO_DEFAULT_FINDING = {
    "step": "functions[probe].inputs.flag",
    "code": "BOOLEAN_INPUT_NO_DEFAULT",
    "severity": "error",
    "problem": "Boolean input 'flag' needs a default",
    "fix": "Add default: true or default: false",
}


class TestFunctionInputDeclarations:
    """An enum input and a Required input's default pass the recipe and Test save checks and
    read back as written (REQ-3.1.2.10, REQ-3.1.2.11)."""

    def test_the_created_test_reads_the_inputs_back_as_written(self) -> None:
        created = author().create_test_from_recipe(
            declared_inputs_recipe("Declared Inputs Readback", DECLARED_INPUTS)
        )

        assert created["created"] is True, created["findings"]
        readback = yaml.safe_load(author().get_test_recipe(created["test_id"])["recipe"])
        (function,) = readback["functions"]
        assert function["inputs"] == DECLARED_INPUTS

    def test_the_old_array_enum_form_is_refused(self) -> None:
        old = {
            "name": "level",
            "type": "array",
            "required": True,
            "enumValueType": "string",
            "enumValues": ["low", "high"],
        }

        result = author().validate_recipe(declared_inputs_recipe("Old Enum Form", [old]))

        assert result["valid"] is False
        assert find_finding(result["findings"], "UNKNOWN_KEY") == {
            "step": "functions[probe].inputs.level",
            "code": "UNKNOWN_KEY",
            "severity": "error",
            "problem": "Unknown key 'enumValueType' on input 'level'",
            "fix": (
                "Valid keys: default, description, element_types, enumValues, name, required, "
                "secret, type"
            ),
        }

    def test_an_enum_input_without_a_default_is_refused(self) -> None:
        level = {"name": "level", "type": "string", "required": True, "enumValues": ["low", "high"]}

        result = author().validate_recipe(declared_inputs_recipe("Enum Without Default", [level]))

        assert result["valid"] is False
        assert find_finding(result["findings"], "ENUM_INPUT_NO_DEFAULT") == {
            "step": "functions[probe].inputs.level",
            "code": "ENUM_INPUT_NO_DEFAULT",
            "severity": "error",
            "problem": "Enum input 'level' needs a default from its allowed values",
            "fix": "Add a default that is one of enumValues",
        }

    @pytest.mark.parametrize("required", [True, False], ids=["required", "optional"])
    def test_a_boolean_input_without_a_default_is_refused(self, required: bool) -> None:
        flag = {"name": "flag", "type": "boolean", "required": required}

        result = author().validate_recipe(boolean_input_recipe("Boolean Without Default", flag))

        assert result["valid"] is False
        assert (
            find_finding(result["findings"], "BOOLEAN_INPUT_NO_DEFAULT")
            == BOOLEAN_INPUT_NO_DEFAULT_FINDING
        )

    def test_a_secret_boolean_input_needs_no_default(self) -> None:
        flag = {"name": "flag", "type": "boolean", "secret": True}

        result = author().validate_recipe(boolean_input_recipe("Secret Boolean", flag))

        assert result["valid"] is True, result["findings"]


class TestAmendTestFromRecipe:
    def test_successful_amend_returns_the_handle_envelope(self) -> None:
        created = author().create_test_from_recipe(simple_recipe("Amend Target"))
        revised = make_recipe(
            [
                {"block": "log", "settings": {"message": "first"}},
                {"block": "log", "settings": {"message": "second"}},
            ],
            name="Amend Target",
        )
        result = author().amend_test_from_recipe("Amend Target", revised)
        assert set(result.keys()) == {
            "amended",
            "test_id",
            "name",
            "version",
            "warnings",
            "repairs",
            "action_items",
        }
        assert result["amended"] is True
        assert result["test_id"] == created["test_id"]
        assert result["name"] == "Amend Target"
        assert result["version"] == "1.1.0"
        assert result["warnings"] == []

    def test_amend_persists_the_revised_workflow(self) -> None:
        from wavecore.api.services.tests import service as test_service

        created = author().create_test_from_recipe(simple_recipe("Amend Persist"))
        revised = make_recipe(
            [
                {"block": "log", "settings": {"message": "one"}},
                {"block": "log", "settings": {"message": "two"}},
            ],
            name="Amend Persist",
        )
        author().amend_test_from_recipe("Amend Persist", revised)
        stored = test_service.get_test(created["test_id"])
        assert stored is not None
        assert stored["version"] == "1.1.0"
        log_nodes = [n for n in stored["workflow"]["nodes"] if n["data"]["elementType"] == "log"]
        assert len(log_nodes) == 2

    def test_invalid_recipe_amends_nothing(self) -> None:
        from wavecore.api.services.tests import service as test_service

        created = author().create_test_from_recipe(simple_recipe("Amend Invalid"))
        result = author().amend_test_from_recipe(
            "Amend Invalid", make_recipe([{"block": "no-such-block"}], name="Amend Invalid")
        )
        assert set(result.keys()) == {"amended", "findings"}
        assert result["amended"] is False
        find_finding(result["findings"], "UNKNOWN_BLOCK")
        stored = test_service.get_test(created["test_id"])
        assert stored is not None
        assert stored["version"] == "1.0.0"

    def test_absent_target_raises_not_found(self) -> None:
        from wavecore.api.exceptions import NotFoundException

        with pytest.raises(NotFoundException, match=r"^Test 'ghost' not found$"):
            author().amend_test_from_recipe("ghost", simple_recipe("ghost"))

    def test_amend_with_no_pinnable_nodes_still_succeeds(self) -> None:
        # An expressible target whose nodes carry no recipeKey pins nothing;
        # the pinned-layout pass is a no-op and the amend goes through.
        _write_test_with_workflow("Amend No Pins", _expressible_workflow())
        result = author().amend_test_from_recipe("Amend No Pins", simple_recipe("Amend No Pins"))
        assert result["amended"] is True

    def test_amend_with_missing_secret_file_amends_nothing(
        self, monkeypatch: Any, tmp_path: Path
    ) -> None:
        secrets_dir = tmp_path / "mcp-secrets"
        secrets_dir.mkdir()
        monkeypatch.setenv("WAVE_MCP_SECRETS_DIR", str(secrets_dir))
        author().create_test_from_recipe(simple_recipe("Amend Secret File"))
        recipe = make_recipe(
            [{"block": "log", "settings": {"message": "shh"}}],
            name="Amend Secret File",
            variables={"token": {"type": "string", "secret": True, "value_from_file": "absent"}},
        )
        result = author().amend_test_from_recipe("Amend Secret File", recipe)
        assert result["amended"] is False
        find_finding(result["findings"], "SECRET_FILE_NOT_FOUND")

    def test_amend_reusing_another_tests_name_amends_nothing(self) -> None:
        author().create_test_from_recipe(simple_recipe("Amend Rename Target"))
        create_test_entity("Amend Occupied")
        result = author().amend_test_from_recipe(
            "Amend Rename Target", simple_recipe("Amend Occupied")
        )
        assert result["amended"] is False
        finding = find_finding(result["findings"], "NAME_CONFLICT")
        assert finding["problem"] == "Test with name 'Amend Occupied' already exists"

    def test_amend_with_stage2_platform_error_amends_nothing(self) -> None:
        from wavecore.api.services.tests import service as test_service

        created = author().create_test_from_recipe(simple_recipe("Amend Stage2"))
        result = author().amend_test_from_recipe(
            "Amend Stage2", undeclared_variable_recipe("Amend Stage2")
        )
        assert result["amended"] is False
        finding = find_finding(result["findings"], "UNDECLARED_VARIABLE")
        assert finding["step"] == "flow[0]"
        stored = test_service.get_test(created["test_id"])
        assert stored is not None
        assert stored["version"] == "1.0.0"

    def test_amend_relays_conflict_exception_as_a_finding(self, monkeypatch: Any) -> None:
        from wavecore.api.exceptions import ConflictException
        from wavecore.api.services.tests import service as test_service

        author().create_test_from_recipe(simple_recipe("Amend Conflict Exc"))

        def raise_conflict(*_args: Any, **_kwargs: Any) -> Any:
            raise ConflictException("Test with name 'Amend Conflict Exc' already exists")

        monkeypatch.setattr(test_service, "update_test", raise_conflict)
        result = author().amend_test_from_recipe(
            "Amend Conflict Exc", simple_recipe("Amend Conflict Exc")
        )
        assert result["amended"] is False
        finding = find_finding(result["findings"], "NAME_CONFLICT")
        assert finding["fix"] == NAME_CONFLICT_FIX

    def test_amend_reports_nothing_when_update_returns_none(self, monkeypatch: Any) -> None:
        from wavecore.api.services.tests import service as test_service

        author().create_test_from_recipe(simple_recipe("Amend Update None"))
        monkeypatch.setattr(test_service, "update_test", lambda *_a, **_k: None)
        result = author().amend_test_from_recipe(
            "Amend Update None", simple_recipe("Amend Update None")
        )
        assert result["amended"] is False
        assert result["findings"] == []

    def test_amend_keeps_a_hand_resized_block_size(self) -> None:
        from wavecore.api.services.tests import service as test_service

        test_id = _write_test_with_workflow("Amend Resized", _keyed_workflow(width=230, height=73))
        revised = make_recipe(
            [
                {"block": "log", "settings": {"message": "reachable"}},
                {"block": "log", "settings": {"message": "second"}},
            ],
            name="Amend Resized",
        )
        assert author().amend_test_from_recipe("Amend Resized", revised)["amended"] is True
        stored = test_service.get_test(test_id)
        assert stored is not None
        by_key = {node["data"]["recipeKey"]: node for node in stored["workflow"]["nodes"]}
        assert by_key["flow[0]"]["width"] == 230
        assert by_key["flow[0]"]["height"] == 73
        assert by_key["flow[0]"]["position"] == {"x": 100, "y": 100}
        assert by_key["flow[1]"]["width"] == 160
        assert "height" not in by_key["flow[1]"]

    def test_amend_resizes_a_renamed_block_that_sits_at_its_generated_width(self) -> None:
        """A generated width is the compiler's, so a rename regenerates it."""
        from wavecore.api.services.tests import service as test_service

        test_id = _write_test_with_workflow("Amend Renamed", _keyed_workflow(width=160))
        step = {
            "block": "log",
            "label": "A much longer block name here",
            "settings": {"message": "reachable"},
        }
        result = author().amend_test_from_recipe(
            "Amend Renamed", make_recipe([step], name="Amend Renamed")
        )
        assert result["amended"] is True
        stored = test_service.get_test(test_id)
        assert stored is not None
        (node,) = [n for n in stored["workflow"]["nodes"] if n["data"]["recipeKey"] == "flow[0]"]
        assert node["width"] == 348

    def test_amend_keeps_a_hand_resized_width_when_the_block_is_renamed(self) -> None:
        """A width nobody generated is the person's, whatever the new name needs."""
        from wavecore.api.services.tests import service as test_service

        test_id = _write_test_with_workflow("Amend Renamed Wide", _keyed_workflow(width=230))
        step = {
            "block": "log",
            "label": "A much longer block name here",
            "settings": {"message": "reachable"},
        }
        result = author().amend_test_from_recipe(
            "Amend Renamed Wide", make_recipe([step], name="Amend Renamed Wide")
        )
        assert result["amended"] is True
        stored = test_service.get_test(test_id)
        assert stored is not None
        (node,) = [n for n in stored["workflow"]["nodes"] if n["data"]["recipeKey"] == "flow[0]"]
        assert node["width"] == 230

    def test_amend_keeps_a_hand_set_height_on_a_block_at_its_generated_width(self) -> None:
        """The compiler never writes a height, so a stored one is always the person's."""
        from wavecore.api.services.tests import service as test_service

        test_id = _write_test_with_workflow("Amend Tall", _keyed_workflow(width=160, height=73))
        result = author().amend_test_from_recipe(
            "Amend Tall",
            make_recipe(
                [{"block": "log", "settings": {"message": "reachable"}}], name="Amend Tall"
            ),
        )
        assert result["amended"] is True
        stored = test_service.get_test(test_id)
        assert stored is not None
        (node,) = [n for n in stored["workflow"]["nodes"] if n["data"]["recipeKey"] == "flow[0]"]
        assert node["height"] == 73
        assert node["width"] == 160

    def test_amend_sizes_a_block_with_no_stored_width_to_fit_its_name(self) -> None:
        from wavecore.api.services.tests import service as test_service

        test_id = _write_test_with_workflow("Amend Unsized", _keyed_workflow())
        step = {
            "block": "log",
            "label": "A much longer block name here",
            "settings": {"message": "reachable"},
        }
        result = author().amend_test_from_recipe(
            "Amend Unsized", make_recipe([step], name="Amend Unsized")
        )
        assert result["amended"] is True
        stored = test_service.get_test(test_id)
        assert stored is not None
        (node,) = [n for n in stored["workflow"]["nodes"] if n["data"]["recipeKey"] == "flow[0]"]
        assert node["width"] == 348
        assert "height" not in node
        assert node["position"] == {"x": 100, "y": 100}


class TestAmendRefusesInexpressibleTarget:
    def test_inexpressible_target_refuses_with_the_guard_finding(self) -> None:
        _write_test_with_workflow("Amend Inexpressible", _inexpressible_workflow())
        result = author().amend_test_from_recipe(
            "Amend Inexpressible", simple_recipe("Amend Inexpressible")
        )
        assert set(result.keys()) == {"amended", "findings"}
        assert result["amended"] is False
        finding = find_finding(result["findings"], "TARGET_NOT_RECIPE_EXPRESSIBLE")
        assert finding["step"] == "test"
        assert finding["severity"] == "error"
        assert finding["problem"] == TARGET_NOT_EXPRESSIBLE_PROBLEM
        assert finding["fix"] == TARGET_NOT_EXPRESSIBLE_FIX


class TestValidateRecipeAmendDryRun:
    def test_reusing_the_target_name_is_valid_under_its_own_test_ref(self) -> None:
        author().create_test_from_recipe(simple_recipe("Amend Dry Target"))
        result = author().validate_recipe(
            simple_recipe("Amend Dry Target"), test_ref="Amend Dry Target"
        )
        assert result["valid"] is True
        assert result["test_name"] == "Amend Dry Target"
        assert all(item["code"] != "NAME_CONFLICT" for item in result["findings"])

    def test_reusing_another_tests_name_still_conflicts(self) -> None:
        author().create_test_from_recipe(simple_recipe("Amend Dry Self"))
        create_test_entity("Occupied By Another")
        result = author().validate_recipe(
            simple_recipe("Occupied By Another"), test_ref="Amend Dry Self"
        )
        assert result["valid"] is False
        finding = find_finding(result["findings"], "NAME_CONFLICT")
        assert finding["problem"] == "Test with name 'Occupied By Another' already exists"

    def test_inexpressible_target_adds_the_guard_finding(self) -> None:
        _write_test_with_workflow("Dry Inexpressible", _inexpressible_workflow())
        result = author().validate_recipe(
            simple_recipe("Dry Inexpressible"), test_ref="Dry Inexpressible"
        )
        assert result["valid"] is False
        finding = find_finding(result["findings"], "TARGET_NOT_RECIPE_EXPRESSIBLE")
        assert finding["step"] == "test"
        assert finding["problem"] == TARGET_NOT_EXPRESSIBLE_PROBLEM
        assert finding["fix"] == TARGET_NOT_EXPRESSIBLE_FIX


class TestSecretFileReferences:
    def test_value_from_file_resolves_within_the_root_and_seals(
        self, monkeypatch: Any, tmp_path: Path
    ) -> None:
        from wavecore.api.services.storage_paths import get_tests_storage_path

        secrets_dir = tmp_path / "mcp-secrets"
        secrets_dir.mkdir()
        (secrets_dir / "prod-token").write_text("file-secret-value")
        monkeypatch.setenv("WAVE_MCP_SECRETS_DIR", str(secrets_dir))

        recipe = make_recipe(
            [{"block": "log", "settings": {"message": "shh"}}],
            name="File Secret Sealed",
            variables={
                "token": {"type": "string", "secret": True, "value_from_file": "prod-token"}
            },
        )
        result = author().create_test_from_recipe(recipe)
        assert result["created"] is True
        raw = (get_tests_storage_path() / result["test_id"] / "test.yaml").read_text()
        assert ENVELOPE_PREFIX in raw
        assert "file-secret-value" not in raw

    def test_a_resolved_recipe_keeps_every_number_as_written(
        self, monkeypatch: Any, tmp_path: Path
    ) -> None:
        from wavecore.api.services.storage_paths import get_tests_storage_path

        secrets_dir = tmp_path / "mcp-secrets"
        secrets_dir.mkdir()
        (secrets_dir / "prod-token").write_text("file-secret-value")
        monkeypatch.setenv("WAVE_MCP_SECRETS_DIR", str(secrets_dir))
        recipe = make_recipe(
            [{"block": "log", "settings": {"message": "shh"}}],
            name="File Secret Numbers",
            variables={
                "token": {"type": "string", "secret": True, "value_from_file": "prod-token"},
                "ratio": {"type": "float", "value": "__ratio__"},
                "code": {"type": "string", "value": "__code__"},
            },
        )
        recipe = recipe.replace("__ratio__", "2.50").replace("__code__", "0x1F")

        result = author().create_test_from_recipe(recipe)

        assert result["created"] is True
        raw = (get_tests_storage_path() / result["test_id"] / "test.yaml").read_text()
        stored = yaml.safe_load(raw)["variables"]
        assert stored["ratio"]["value"] == "2.50"
        assert stored["code"]["value"] == "0x1F"

    def test_missing_secret_file_reports_not_found(self, monkeypatch: Any, tmp_path: Path) -> None:
        secrets_dir = tmp_path / "mcp-secrets"
        secrets_dir.mkdir()
        monkeypatch.setenv("WAVE_MCP_SECRETS_DIR", str(secrets_dir))

        recipe = make_recipe(
            [{"block": "log", "settings": {"message": "shh"}}],
            name="File Secret Missing",
            variables={
                "token": {"type": "string", "secret": True, "value_from_file": "absent-file"}
            },
        )
        result = author().create_test_from_recipe(recipe)
        assert result["created"] is False
        finding = find_finding(result["findings"], "SECRET_FILE_NOT_FOUND")
        assert finding["problem"] == (
            "The secret file 'absent-file' was not found in the configured secrets "
            "input directory."
        )
        assert finding["fix"] == (
            "Place the file in the configured secrets input directory or use a provided value."
        )

    def test_escaping_secret_file_path_is_rejected(self, monkeypatch: Any, tmp_path: Path) -> None:
        secrets_dir = tmp_path / "mcp-secrets"
        secrets_dir.mkdir()
        monkeypatch.setenv("WAVE_MCP_SECRETS_DIR", str(secrets_dir))

        recipe = make_recipe(
            [{"block": "log", "settings": {"message": "shh"}}],
            name="File Secret Escape",
            variables={"token": {"type": "string", "secret": True, "value_from_file": "../escape"}},
        )
        result = author().create_test_from_recipe(recipe)
        assert result["created"] is False
        finding = find_finding(result["findings"], "SECRET_FILE_OUTSIDE_ROOT")
        assert finding["problem"] == (
            "The secret file reference '../escape' resolves outside the configured "
            "secrets input directory and was rejected."
        )
        assert finding["fix"] == "Reference a file inside the configured secrets input directory."

    def test_declare_empty_secret_creates_with_an_action_item(self) -> None:
        recipe = make_recipe(
            [{"block": "log", "settings": {"message": "shh"}}],
            name="Declare Empty Secret",
            variables={"token": {"type": "string", "secret": True}},
        )
        result = author().create_test_from_recipe(recipe)
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

    def test_an_empty_secret_value_creates_with_an_action_item(self) -> None:
        """An empty secret holds nothing, so a person still owes its value (REQ-4.5.1)."""
        recipe = make_recipe(
            [{"block": "log", "settings": {"message": "shh"}}],
            name="Empty Value Secret",
            variables={"token": {"type": "string", "secret": True, "value": ""}},
        )
        result = author().create_test_from_recipe(recipe)
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

    def test_declare_empty_secret_amends_with_an_action_item(self) -> None:
        author().create_test_from_recipe(simple_recipe("Amend Declare Empty"))
        revised = make_recipe(
            [{"block": "log", "settings": {"message": "shh"}}],
            name="Amend Declare Empty",
            variables={"api_key": {"type": "string", "secret": True}},
        )
        result = author().amend_test_from_recipe("Amend Declare Empty", revised)
        assert result["amended"] is True
        assert result["action_items"] == [
            {
                "step": "variables.api_key",
                "code": "NO_VALUE_VARIABLE",
                "severity": "warning",
                "problem": "Secret variable 'api_key' holds no value",
                "fix": "A person must fill it in before dependent definitions can run",
            }
        ]

    def test_unknown_amend_target_comes_back_as_a_finding(self) -> None:
        result = author().validate_recipe(simple_recipe("Ghost Target"), test_ref="ghost")
        assert result["valid"] is False
        finding = find_finding(result["findings"], "TARGET_NOT_FOUND")
        assert finding["problem"] == "Test 'ghost' not found"
        assert finding["fix"] == "Check the reference with the list_tests tool"

    def test_declare_empty_secret_validates_clean_as_an_amendment(self) -> None:
        created = author().create_test_from_recipe(simple_recipe("Validate Declare Empty"))
        revised = make_recipe(
            [{"block": "log", "settings": {"message": "shh"}}],
            name="Validate Declare Empty",
            variables={"token": {"type": "string", "secret": True}},
        )
        result = author().validate_recipe(revised, test_ref=created["test_id"])
        assert result["valid"] is True

    def test_value_from_file_without_a_configured_root_names_the_deployment(
        self, monkeypatch: Any, isolated_config: Any
    ) -> None:
        """An unconfigured deployment is not a missing file: saying 'not found'
        sent authors hunting for a file they could never have placed."""
        monkeypatch.delenv("WAVE_MCP_SECRETS_DIR", raising=False)
        isolated_config.set("security.secrets_input_dir", "", validate=False)
        recipe = make_recipe(
            [{"block": "log", "settings": {"message": "shh"}}],
            name="File Secret No Root",
            variables={"token": {"type": "string", "secret": True, "value_from_file": "any"}},
        )
        result = author().create_test_from_recipe(recipe)
        assert result["created"] is False
        find_finding(result["findings"], "SECRETS_DIR_NOT_CONFIGURED")


def capture_filled_secret_recipe(name: str) -> str:
    """A declare-empty secret a capture fills, beside one that nothing writes."""
    step = {
        "block": "http-client",
        "settings": {"url": "http://shop.local/token", "method": "GET"},
        "capture": {"body": "issued_token"},
    }
    return make_recipe(
        [step, {"block": "log", "settings": {"message": "shh"}}],
        name=name,
        variables={
            "issued_token": {"type": "string", "secret": True},
            "api_key": {"type": "string", "secret": True},
        },
    )


API_KEY_ACTION_ITEM = {
    "step": "variables.api_key",
    "code": "NO_VALUE_VARIABLE",
    "severity": "warning",
    "problem": "Secret variable 'api_key' holds no value",
    "fix": "A person must fill it in before dependent definitions can run",
}


class TestCaptureFilledSecretsOweNothing:
    """A secret a capture fills is written by the run, so no person owes its value;
    a declare-empty secret nothing writes still does (REQ-5.2.7.3)."""

    @pytest.mark.parametrize("example_name", ["06-k8s-smoke", "07-helm-lifecycle"])
    def test_creating_a_served_example_owes_no_session_secret(self, example_name: str) -> None:
        recipe_text = example_recipe(example_name)
        _seed_example_prerequisites(recipe_text)

        result = author().create_test_from_recipe(recipe_text)

        assert result["created"] is True
        assert result["action_items"] == []

    def test_only_the_secret_nothing_writes_gets_the_action_item(self) -> None:
        result = author().create_test_from_recipe(capture_filled_secret_recipe("Capture Filled"))

        assert result["created"] is True
        assert result["action_items"] == [API_KEY_ACTION_ITEM]

    def test_a_function_block_capture_fills_its_secret_too(self) -> None:
        functions = [
            {
                "name": "issue",
                "inputs": [],
                "outputs": [{"name": "token", "type": "string"}],
                "flow": [{"block": "log", "settings": {"message": "issuing"}}],
            }
        ]
        recipe = make_recipe(
            [{"function": "issue", "capture": {"token": "issued_token"}}],
            name="Function Block Capture Filled",
            variables={"issued_token": {"type": "string", "secret": True}},
            functions=functions,
        )

        result = author().create_test_from_recipe(recipe)

        assert result["created"] is True
        assert result["action_items"] == []

    def test_a_secret_block_setting_holding_null_gets_its_field_action_item(self) -> None:
        http = {
            "id": "http",
            "data": {
                "elementType": "http-client",
                "nodeType": "plugin",
                "version": "1.0.0",
                "config": {"values": {"url": "http://shop.local", "auth_password": None}},
            },
        }

        items = author().no_value_action_items({"workflow": {"nodes": [http], "edges": []}})

        assert items == [
            {
                "step": "blocks.http.auth_password",
                "code": "NO_VALUE_SECRET",
                "severity": "warning",
                "problem": "Secret field 'auth_password' holds no value",
                "fix": "A person must fill it in before dependent definitions can run",
            }
        ]

    def test_amending_keeps_the_same_rule(self) -> None:
        author().create_test_from_recipe(simple_recipe("Amend Capture Filled"))

        result = author().amend_test_from_recipe(
            "Amend Capture Filled", capture_filled_secret_recipe("Amend Capture Filled")
        )

        assert result["amended"] is True
        assert result["action_items"] == [API_KEY_ACTION_ITEM]


class TestMarkedCapturePromotesADeclaredVariable:
    """A create through a recipe makes a plain variable a marked output fills secret, warns,
    and owes no value for it (SECUI-12, REQ-3.1.2.9)."""

    def test_the_created_test_stores_it_secret_with_the_warning(self) -> None:
        from wavecore.api.services.tests import service as test_service

        step = {
            "block": "k8s-connect",
            "settings": {"api_url": "https://k8s.local"},
            "capture": {"session": "kube"},
        }
        recipe = make_recipe(
            [step], name="Promoted Via Recipe", variables={"kube": {"type": "string"}}
        )

        result = author().create_test_from_recipe(recipe)

        assert result["created"] is True
        warning = find_finding(result["warnings"], "VARIABLE_MADE_SECRET")
        assert warning["step"] == "flow[0].capture.session"
        assert result["action_items"] == []
        stored = test_service.get_test(result["test_id"])
        assert stored is not None
        assert stored["variables"]["kube"]["secret"] is True


class TestAmendStalenessGuard:
    """A readback carries the version it was taken from; amending from a
    superseded one is refused."""

    def test_readback_carries_the_version(self) -> None:
        author().create_test_from_recipe(simple_recipe("Stale Readback Source"))
        recipe = yaml.safe_load(author().get_test_recipe("Stale Readback Source")["recipe"])
        assert recipe["test"]["version"] == "1.0.0"

    def test_amend_from_a_superseded_readback_is_refused(self) -> None:
        author().create_test_from_recipe(simple_recipe("Stale Amend Target"))
        stale = author().get_test_recipe("Stale Amend Target")["recipe"]

        first = author().amend_test_from_recipe("Stale Amend Target", stale)
        assert first["amended"] is True
        assert first["version"] == "1.1.0"

        second = author().amend_test_from_recipe("Stale Amend Target", stale)
        assert second["amended"] is False
        finding = find_finding(second["findings"], "STALE_RECIPE_VERSION")
        assert finding["problem"] == (
            "This recipe was read back at version 1.0.0 but the test is now at 1.1.0"
        )
        assert finding["fix"] == "Read the test back again and re-apply your changes"

    def test_a_recipe_without_a_version_still_amends(self) -> None:
        """Hand-written recipes carry no version and are not gated."""
        author().create_test_from_recipe(simple_recipe("Unversioned Amend Target"))
        result = author().amend_test_from_recipe(
            "Unversioned Amend Target", simple_recipe("Unversioned Amend Target")
        )
        assert result["amended"] is True


class TestSecretsInputDirectoryConfiguration:
    """The secrets input directory is a deployment setting, so it is configurable
    like every other one, and an unconfigured deployment says so plainly instead
    of blaming the caller's file name."""

    def test_root_comes_from_configuration_not_only_the_environment(
        self, monkeypatch: Any, tmp_path: Path, isolated_config: Any
    ) -> None:
        from wavecore.core.secrets.file_reference import read_secret_file

        secrets_dir = tmp_path / "configured-secrets"
        secrets_dir.mkdir()
        (secrets_dir / "token").write_text("from-config\n", encoding="utf-8")
        monkeypatch.delenv("WAVE_MCP_SECRETS_DIR", raising=False)
        isolated_config.set("security.secrets_input_dir", str(secrets_dir), validate=False)

        assert read_secret_file("token") == "from-config"

    def test_unconfigured_root_is_reported_as_a_deployment_problem(
        self, monkeypatch: Any, isolated_config: Any
    ) -> None:
        from wavecore.core.secrets.file_reference import (
            SecretsDirNotConfiguredError,
            read_secret_file,
        )

        monkeypatch.delenv("WAVE_MCP_SECRETS_DIR", raising=False)
        isolated_config.set("security.secrets_input_dir", "", validate=False)

        with pytest.raises(SecretsDirNotConfiguredError):
            read_secret_file("token")

    def test_recipe_reports_the_unconfigured_root_distinctly(
        self, monkeypatch: Any, isolated_config: Any
    ) -> None:
        monkeypatch.delenv("WAVE_MCP_SECRETS_DIR", raising=False)
        isolated_config.set("security.secrets_input_dir", "", validate=False)

        recipe = make_recipe(
            [{"block": "log", "settings": {"message": "hi"}}],
            name="Unconfigured Secrets Dir",
            variables={"token": {"type": "string", "secret": True, "value_from_file": "token"}},
        )
        result = author().create_test_from_recipe(recipe)
        assert result["created"] is False
        finding = find_finding(result["findings"], "SECRETS_DIR_NOT_CONFIGURED")
        assert finding["problem"] == (
            "This deployment has no secrets input directory configured, so "
            "value_from_file cannot be used."
        )


def spy_compile(monkeypatch: Any) -> list[dict[str, Any]]:
    """Record the keyword arguments of every compile_recipe call the author tools make."""
    from wavecore.core.recipes import compiler

    calls: list[dict[str, Any]] = []
    real = compiler.compile_recipe

    def recorder(text: str, **kwargs: Any) -> Any:
        calls.append(dict(kwargs))
        return real(text, **kwargs)

    monkeypatch.setattr(author(), "compile_recipe", recorder)
    return calls


def testdata_folder(test_id: str) -> str:
    from wavecore.api.services.storage_paths import get_test_testdata_path

    return str(get_test_testdata_path(test_id))


class TestTestdataDirsReachTheCompiler:
    """Every author entry point compiles against the target test's own files."""

    def test_create_compiles_without_any_roots(self, monkeypatch: Any) -> None:
        calls = spy_compile(monkeypatch)

        author().create_test_from_recipe(simple_recipe("Roots On Create"))

        assert calls == [{"testdata_dirs": [], "placement_defaults": DISABLED_DEFAULTS}]

    def test_validate_without_a_target_compiles_without_any_roots(self, monkeypatch: Any) -> None:
        calls = spy_compile(monkeypatch)

        author().validate_recipe(simple_recipe("Roots On Validate"))

        assert calls == [{"testdata_dirs": [], "placement_defaults": DISABLED_DEFAULTS}]

    def test_validate_with_a_target_compiles_against_that_tests_folder(
        self, monkeypatch: Any
    ) -> None:
        created = author().create_test_from_recipe(simple_recipe("Roots On Dry Run"))
        calls = spy_compile(monkeypatch)

        author().validate_recipe(simple_recipe("Roots On Dry Run"), test_ref="Roots On Dry Run")

        assert calls == [
            {
                "testdata_dirs": [testdata_folder(created["test_id"])],
                "placement_defaults": DISABLED_DEFAULTS,
            }
        ]

    def test_amend_compiles_against_the_target_tests_folder(self, monkeypatch: Any) -> None:
        created = author().create_test_from_recipe(simple_recipe("Roots On Amend"))
        revised = make_recipe(
            [
                {"block": "log", "settings": {"message": "first"}},
                {"block": "log", "settings": {"message": "second"}},
            ],
            name="Roots On Amend",
        )
        calls = spy_compile(monkeypatch)

        author().amend_test_from_recipe("Roots On Amend", revised)

        assert calls == [
            {
                "testdata_dirs": [testdata_folder(created["test_id"])],
                "placement_defaults": DISABLED_DEFAULTS,
            }
        ]


DISABLED_DEFAULTS = {"ssh-session-open": {"host_key_verification": "disabled"}}
STRICT_DEFAULTS = {"ssh-session-open": {"host_key_verification": "strict"}}


def set_default_block_action(action: str) -> None:
    """Save the host key action Settings stamps into newly placed SSH Session Open blocks."""
    from wavecore.core.ssh import trusted_hosts

    trusted_hosts.save_policy({"lock_trusted_hosts": False, "default_block_action": action})


def ssh_open(host: str, **settings: Any) -> dict[str, Any]:
    return {"block": "ssh-session-open", "settings": {"host": host, "username": "wave", **settings}}


def stored_host_key_actions(test_id: str) -> dict[str, Any]:
    """Host -> stored host key action of every SSH Session Open in the saved test."""
    from wavecore.api.services.tests import service as test_service

    stored = test_service.get_test(test_id)
    assert stored is not None
    return {
        node["data"]["config"]["values"]["host"]: node["data"]["config"]["values"].get(
            "host_key_verification", "absent"
        )
        for node in stored["workflow"]["nodes"]
        if node["data"].get("elementType") == "ssh-session-open"
    }


class TestPlacementDefaultsReachTheCompiler:
    """Every author entry point compiles with the stored default block action (REQ-4.5.14)."""

    def test_create_compiles_with_the_stored_default(self, monkeypatch: Any) -> None:
        set_default_block_action("strict")
        calls = spy_compile(monkeypatch)

        author().create_test_from_recipe(simple_recipe("Defaults On Create"))

        assert calls == [{"testdata_dirs": [], "placement_defaults": STRICT_DEFAULTS}]

    def test_validate_compiles_with_the_stored_default(self, monkeypatch: Any) -> None:
        set_default_block_action("accept-new")
        calls = spy_compile(monkeypatch)

        author().validate_recipe(simple_recipe("Defaults On Validate"))

        assert calls == [
            {
                "testdata_dirs": [],
                "placement_defaults": {"ssh-session-open": {"host_key_verification": "accept-new"}},
            }
        ]

    def test_amend_compiles_with_the_stored_default(self, monkeypatch: Any) -> None:
        created = author().create_test_from_recipe(simple_recipe("Defaults On Amend"))
        set_default_block_action("strict")
        calls = spy_compile(monkeypatch)

        author().amend_test_from_recipe("Defaults On Amend", simple_recipe("Defaults On Amend"))

        assert calls == [
            {
                "testdata_dirs": [testdata_folder(created["test_id"])],
                "placement_defaults": STRICT_DEFAULTS,
            }
        ]


class TestNewSSHBlocksGetTheDefaultHostKeyAction:
    """A recipe that omits the host key action places the Settings default (REQ-4.5.14)."""

    def test_create_stores_the_strict_default_on_a_new_block(self) -> None:
        set_default_block_action("strict")

        result = author().create_test_from_recipe(
            make_recipe([ssh_open("node-1")], name="Strict By Default")
        )

        assert result["created"] is True
        assert stored_host_key_actions(result["test_id"]) == {"node-1": "strict"}

    def test_create_stores_every_creation_value_with_the_stamp_on_top(self) -> None:
        # FIELD-8: every choice-list and true / false value is written when the Block is made.
        from wavecore.api.services.tests import service as test_service

        set_default_block_action("strict")

        result = author().create_test_from_recipe(
            make_recipe([ssh_open("node-1")], name="Creation Values On Create")
        )

        stored = test_service.get_test(result["test_id"])
        assert stored is not None
        (node,) = [
            node
            for node in stored["workflow"]["nodes"]
            if node["data"].get("elementType") == "ssh-session-open"
        ]
        assert node["data"]["config"]["values"] == {
            "host": "node-1",
            "username": "wave",
            **SSH_OPEN_CREATION_VALUES,
            "host_key_verification": "strict",
        }

    def test_create_stores_disabled_when_settings_were_never_changed(self) -> None:
        result = author().create_test_from_recipe(
            make_recipe([ssh_open("node-1")], name="Disabled By Default")
        )

        assert stored_host_key_actions(result["test_id"]) == {"node-1": "disabled"}

    def test_create_stores_a_default_set_in_the_config_file(
        self, load_config: Callable[..., Any]
    ) -> None:
        policy = {"lock_trusted_hosts": False, "default_block_action": "strict"}
        load_config({"network": {"ssh_hosts": policy}})

        result = author().create_test_from_recipe(
            make_recipe([ssh_open("node-1")], name="Strict From The Config File")
        )

        assert stored_host_key_actions(result["test_id"]) == {"node-1": "strict"}

    def test_a_block_that_names_its_action_keeps_it(self) -> None:
        set_default_block_action("strict")

        result = author().create_test_from_recipe(
            make_recipe([ssh_open("node-1", host_key_verification="disabled")], name="Named Action")
        )

        assert stored_host_key_actions(result["test_id"]) == {"node-1": "disabled"}

    def test_amend_keeps_an_existing_blocks_value_and_stamps_a_new_one(self) -> None:
        created = author().create_test_from_recipe(
            make_recipe([ssh_open("node-1")], name="Amend Keeps Action")
        )
        set_default_block_action("strict")
        readback = yaml.safe_load(author().get_test_recipe("Amend Keeps Action")["recipe"])
        readback["flow"].append(ssh_open("node-2"))

        result = author().amend_test_from_recipe(
            "Amend Keeps Action", yaml.safe_dump(readback, sort_keys=False)
        )

        assert result["amended"] is True
        assert stored_host_key_actions(created["test_id"]) == {
            "node-1": "disabled",
            "node-2": "strict",
        }

    def test_the_readback_carries_the_stored_action(self) -> None:
        set_default_block_action("strict")
        author().create_test_from_recipe(make_recipe([ssh_open("node-1")], name="Readback Action"))

        recipe = yaml.safe_load(author().get_test_recipe("Readback Action")["recipe"])

        assert recipe["flow"][0]["settings"]["host_key_verification"] == "strict"

    def test_the_readback_carries_disabled_when_settings_were_never_changed(self) -> None:
        author().create_test_from_recipe(
            make_recipe([ssh_open("node-1")], name="Readback Default Action")
        )

        recipe = yaml.safe_load(author().get_test_recipe("Readback Default Action")["recipe"])

        assert recipe["flow"][0]["settings"]["host_key_verification"] == "disabled"

    def test_the_readback_keeps_the_stored_action_after_the_default_changes(self) -> None:
        author().create_test_from_recipe(
            make_recipe([ssh_open("node-1")], name="Readback Stored Action")
        )
        set_default_block_action("strict")

        recipe = yaml.safe_load(author().get_test_recipe("Readback Stored Action")["recipe"])

        assert recipe["flow"][0]["settings"]["host_key_verification"] == "disabled"


class TestConstructStepsGetTheirCreationValues:
    """A construct step created through MCP holds its control's choice-list and true / false
    values, like any Block (FIELD-8, REQ-5.2.7.3)."""

    def _stored_values(self, recipe: str) -> dict[str, dict[str, Any]]:
        from wavecore.api.services.tests import service as test_service

        result = author().create_test_from_recipe(recipe)
        stored = test_service.get_test(result["test_id"])
        assert stored is not None
        return {
            str(node["data"]["elementType"]): node["data"]["config"]["values"]
            for node in stored["workflow"]["nodes"]
            if node["data"].get("elementType") in ("for-each", "while", "halt")
        }

    def test_create_writes_the_construct_creation_values(self) -> None:
        flow = [
            {"for_each": {"collection": {"expr": "items"}, "body": [LOG_STEP]}},
            {"while": {"conditions": "i < 3", "body": [LOG_STEP]}},
            {"halt": {"message": "done"}},
        ]
        variables = {
            "items": {"type": "array", "value": [1]},
            "i": {"type": "integer", "value": 0},
        }

        values = self._stored_values(
            make_recipe(flow, name="Construct Creation Values", variables=variables)
        )

        assert values["for-each"] == {"collection": "items"}
        assert {k: v for k, v in values["while"].items() if k != "conditions"} == {
            "mode": "while-do"
        }
        assert values["halt"] == {"scope": "test", "status": "failed", "message": "done"}


class TestFilesExample:
    """Example 08 teaches the whole file story: read test data, write an artifact."""

    def _document(self) -> dict[str, Any]:
        examples = {ex["name"]: ex["recipe"] for ex in author().get_recipe_guide()["examples"]}
        return dict(yaml.safe_load(examples["08-files-testdata"]))

    def test_the_description_names_the_file_to_place_first(self) -> None:
        description = str(self._document()["test"]["description"])

        assert "examples/customers.csv" in description

    def test_the_flow_reads_test_data_parses_asserts_writes_and_logs(self) -> None:
        flow = list(self._document()["flow"])

        blocks = [step.get("block") if isinstance(step, dict) else None for step in flow]
        assert blocks == ["file-io", "csv-parser", None, "file-io", "log"]
        assert "assert" in flow[2]
        assert flow[0]["settings"]["operation"] == "read"
        assert flow[0]["settings"]["path"] == "testdata://examples/customers.csv"
        assert flow[3]["settings"]["operation"] == "write"
        assert flow[3]["settings"]["path"] == "artifact://reports/customers.json"

    def test_the_example_validates_clean_against_the_files_it_names(self, tmp_path: Path) -> None:
        from wavecore.core.recipes.compiler import compile_recipe

        (tmp_path / "examples").mkdir()
        (tmp_path / "examples" / "customers.csv").write_text("id,name\n1,ada\n", encoding="utf-8")
        recipe = {ex["name"]: ex["recipe"] for ex in author().get_recipe_guide()["examples"]}[
            "08-files-testdata"
        ]

        result = compile_recipe(recipe, testdata_dirs=[str(tmp_path)])

        assert [item for item in result["findings"] if item["severity"] == "error"] == []
        assert [item for item in result["findings"] if item["code"] == "TESTDATA_NOT_FOUND"] == []
        assert result["test_data"] is not None


class TestPythonExample:
    """Example 10 is the Python block's worked example."""

    def _recipe(self) -> str:
        recipe = example_recipe("10-python")
        _seed_example_prerequisites(recipe)
        return recipe

    def test_the_example_reads_back_as_the_same_test(self) -> None:
        assert_round_trip(self._recipe())

    def test_the_example_validates_clean(self) -> None:
        result = author().validate_recipe(self._recipe())

        assert result["valid"] is True
        assert [item for item in result["findings"] if item["severity"] == "error"] == []


def _block_ids(node: Any) -> list[str]:
    """Every `- block:` id anywhere in a recipe document."""
    if isinstance(node, dict):
        own = [str(node["block"])] if isinstance(node.get("block"), str) else []
        return own + [block for value in node.values() for block in _block_ids(value)]
    if isinstance(node, list):
        return [block for value in node for block in _block_ids(value)]
    return []


class TestSqlExample:
    """Example 11 is the SQL block's worked example (REQ-3.4.1.6, REQ-3.3.3.3)."""

    def _recipe(self) -> str:
        recipe = example_recipe("11-sql")
        _seed_example_prerequisites(recipe)
        return recipe

    def test_the_example_runs_the_sql_block(self) -> None:
        assert "sql-client" in _block_ids(yaml.safe_load(example_recipe("11-sql")))

    def test_the_example_reads_back_as_the_same_test(self) -> None:
        assert_round_trip(self._recipe())

    def test_the_example_validates_clean(self) -> None:
        result = author().validate_recipe(self._recipe())

        assert result["valid"] is True
        assert [item for item in result["findings"] if item["severity"] == "error"] == []


OPENSEARCH_EXAMPLE_DESCRIPTION = (
    "Wait until the application logs its final line or an error, branch on which it was, "
    "collect every line it logged since the test started, and check that no minute had more "
    "than 5 errors"
)
_LOG_FIELDS = [{"value": "@timestamp"}, {"value": "log.level"}, {"value": "message"}]
_WINDOW = {
    "url": {"expr": "cluster_url"},
    "index": "app-logs-*",
    "from": {"expr": "test_start"},
}
OPENSEARCH_EXAMPLE_STEPS = [
    {
        "block": "opensearch",
        "label": "Look for the final line",
        "settings": {
            **_WINDOW,
            "to": "now",
            "query_language": "dql",
            "query": 'log.level: "ERROR" or message: "Batch complete"',
            "mode": "search",
            "fields": _LOG_FIELDS,
            "order": "asc",
            "max_results": 1,
        },
        "capture": {"results": "final", "total_results": "found"},
    },
    {
        "block": "opensearch",
        "label": "Collect the test's log lines",
        "settings": {
            **_WINDOW,
            "to": {"expr": "final.cell(0, '@timestamp')"},
            "mode": "search",
            "fields": _LOG_FIELDS,
            "order": "asc",
            "max_results": 0,
        },
        "capture": {"results": "logs"},
    },
    {
        "block": "opensearch",
        "label": "Count the errors per minute",
        "settings": {
            **_WINDOW,
            "to": {"expr": "final.cell(0, '@timestamp')"},
            "query": 'log.level: "ERROR"',
            "mode": "aggregate",
            "group_by_time": "1m",
            "stats": [{"value": {"stat": "count"}}],
        },
        "capture": {"results": "errors_per_minute"},
    },
]


def _opensearch_steps(node: Any) -> list[dict[str, Any]]:
    """Every `- block: opensearch` step anywhere in a recipe document, in document order."""
    if isinstance(node, dict):
        own = [node] if node.get("block") == "opensearch" else []
        return own + [step for value in node.values() for step in _opensearch_steps(value)]
    if isinstance(node, list):
        return [step for value in node for step in _opensearch_steps(value)]
    return []


class TestOpensearchExample:
    """Example 12 is the OpenSearch block's worked example (REQ-3.4.1.15, REQ-5.1.2)."""

    def _recipe(self) -> str:
        recipe = example_recipe("12-opensearch")
        _seed_example_prerequisites(recipe)
        return recipe

    def test_the_example_names_itself(self) -> None:
        test = yaml.safe_load(example_recipe("12-opensearch"))["test"]

        assert test == {
            "name": "Recipe Example - OpenSearch",
            "description": OPENSEARCH_EXAMPLE_DESCRIPTION,
            "tags": ["example", "opensearch"],
        }

    def test_the_example_waits_collects_and_counts_with_three_opensearch_steps(self) -> None:
        document = yaml.safe_load(example_recipe("12-opensearch"))

        assert _opensearch_steps(document) == OPENSEARCH_EXAMPLE_STEPS

    def test_the_wait_counter_starts_at_zero(self) -> None:
        # The first Wait Until check reads `found` before any search has written it.
        variables = yaml.safe_load(example_recipe("12-opensearch"))["variables"]

        assert variables["found"] == {"type": "integer", "value": 0}

    def test_the_example_gates_on_the_errors_per_minute(self) -> None:
        flow = yaml.safe_load(example_recipe("12-opensearch"))["flow"]

        assert flow[-1] == {
            "assert": {
                "that": ["max(errors_per_minute.col('count')) <= 5"],
                "fail_current_scope": True,
            }
        }

    def test_the_example_reads_back_as_the_same_test(self) -> None:
        assert_round_trip(self._recipe())

    def test_the_example_validates_clean(self) -> None:
        result = author().validate_recipe(self._recipe())

        assert result["valid"] is True
        assert [item for item in result["findings"] if item["severity"] == "error"] == []


OPENSEARCH_ROUND_TRIP_VARIABLES: dict[str, Any] = {
    "cluster_url": {"type": "string", "value": "https://opensearch.internal:9200"},
    "test_start": {"type": "string", "value": "2026-09-26T10:00:00Z"},
    "service": {"type": "string", "value": "checkout"},
    "level_field": {"type": "string", "value": "log.level"},
    "slow_stat": {"type": "map", "value": {"stat": "max", "field": "latency_ms"}},
    "hits": {"type": "table"},
    "hit_count": {"type": "integer"},
    "per_minute": {"type": "table"},
}
OPENSEARCH_SEARCH_SETTINGS: dict[str, Any] = {
    "url": {"expr": "cluster_url"},
    "index": "app-logs-*,-app-logs-archive",
    "from": {"expr": "test_start"},
    "to": "now/d",
    "query_language": "dql",
    "query": "service: {{ service }} and not log.level: DEBUG",
    "mode": "search",
    "fields": [{"value": "@timestamp"}, {"value": {"expr": "level_field"}}, {"value": "message"}],
    "max_results": 50,
    "sort_by": "latency_ms",
    "order": "asc",
    "time_field": "event.created",
    "timeout": 120,
    "connect_timeout": 10,
    "on_error": "record",
}
OPENSEARCH_AGGREGATE_SETTINGS: dict[str, Any] = {
    "url": {"expr": "cluster_url"},
    "index": "app-logs-*",
    "from": 1758880800000,
    "to": "now",
    "query_language": "query_dsl",
    "query": '{"term": {"service": "checkout"}}',
    "mode": "aggregate",
    "group_by_time": "5m",
    "group_by_field": "host.name",
    "top_values": 3,
    "stats": [
        {"value": {"stat": "count"}},
        {"value": {"stat": "percentile", "field": "latency_ms", "percent": 95}},
        {"value": {"stat": "unique_count", "field": "user.id"}},
        {"value": {"stat": "custom", "json": '{"max": {"field": "bytes"}}', "name": "peak"}},
        {"value": {"expr": "slow_stat"}},
    ],
    "verify_ssl": False,
}


def _opensearch_round_trip_recipe(name: str) -> str:
    return make_recipe(
        [
            {
                "block": "opensearch",
                "label": "Find the slow requests",
                "settings": OPENSEARCH_SEARCH_SETTINGS,
                "capture": {"results": "hits", "total_results": "hit_count"},
            },
            {
                "block": "opensearch",
                "label": "Latency per host",
                "settings": OPENSEARCH_AGGREGATE_SETTINGS,
                "capture": {"results": "per_minute"},
            },
        ],
        name=name,
        variables=OPENSEARCH_ROUND_TRIP_VARIABLES,
    )


class TestOpensearchRecipeRoundTrip:
    """An OpenSearch step saved from a recipe reads back as written (REQ-3.4.1.15)."""

    def test_the_create_carries_no_stub_warning(self) -> None:
        result = author().create_test_from_recipe(_opensearch_round_trip_recipe("OS Created"))

        assert result["created"] is True
        assert result["warnings"] == []

    def test_every_row_reads_back_as_written(self) -> None:
        author().create_test_from_recipe(_opensearch_round_trip_recipe("OS Readback"))

        flow = yaml.safe_load(author().get_test_recipe("OS Readback")["recipe"])["flow"]

        assert [step["settings"] for step in flow] == [
            {**OPENSEARCH_SEARCH_SETTINGS, "group_by_time": "1m", "verify_ssl": True},
            {**OPENSEARCH_AGGREGATE_SETTINGS, "order": "desc", "on_error": "fail"},
        ]
        assert [step["capture"] for step in flow] == [
            {"results": "hits", "total_results": "hit_count"},
            {"results": "per_minute"},
        ]

    def test_the_recipe_compiles_to_the_same_test_after_readback(self) -> None:
        assert_round_trip(_opensearch_round_trip_recipe("OS Recompiled"))

    def test_the_secret_rows_are_left_out_of_the_readback(self) -> None:
        secrets = {
            "password": "os-password-classified",
            "api_key": "os-api-key-classified",
            "bearer_token": "os-bearer-classified",
            "client_key": "os-client-key-classified",
        }
        step = {
            "block": "opensearch",
            "settings": {"url": "https://opensearch.internal:9200", "index": "logs", **secrets},
        }
        author().create_test_from_recipe(make_recipe([step], name="OS Secrets"))

        recipe = author().get_test_recipe("OS Secrets")["recipe"]

        assert [value for value in secrets.values() if value in recipe] == []
        assert yaml.safe_load(recipe)["flow"][0]["settings"] == {
            "url": "https://opensearch.internal:9200",
            "index": "logs",
            **OPENSEARCH_CREATION_VALUES,
        }


SQL_EXPRESSION_STEP: dict[str, Any] = {
    "block": "sql-client",
    "label": "Read the big orders",
    "settings": {
        "host": "db",
        "database": "wave",
        "username": "wave",
        "sql": {"expr": "order_query"},
        "parameters": {"min_qty": {"expr": "threshold"}},
    },
    "capture": {"rows": "orders"},
}
SQL_EXPRESSION_VARIABLES: dict[str, Any] = {
    "order_query": {"type": "string", "value": "SELECT id FROM orders WHERE qty >= :min_qty"},
    "threshold": {"type": "integer", "value": 7},
    "orders": {"type": "table"},
}


class TestSqlExpressionRoundTrip:
    """A SQL script given by an expression reads back as `{expr: ...}` (SQL-10, REQ-3.4.1.6)."""

    def test_the_script_expression_reads_back_as_written(self) -> None:
        recipe = make_recipe(
            [SQL_EXPRESSION_STEP], name="SQL Expression", variables=SQL_EXPRESSION_VARIABLES
        )
        author().create_test_from_recipe(recipe)

        flow = yaml.safe_load(author().get_test_recipe("SQL Expression")["recipe"])["flow"]

        assert flow[0]["settings"] == {**SQL_EXPRESSION_STEP["settings"], **SQL_CREATION_VALUES}

    def test_the_recipe_compiles_to_the_same_test_after_readback(self) -> None:
        assert_round_trip(
            make_recipe(
                [SQL_EXPRESSION_STEP], name="SQL Recompiled", variables=SQL_EXPRESSION_VARIABLES
            )
        )


CHOICE_INPUTS: list[dict[str, Any]] = [
    {
        "name": "level",
        "type": "string",
        "required": True,
        "enumValues": ["low", "high"],
        "default": "low",
    },
    {"name": "strict", "type": "boolean", "default": True},
]


def choice_inputs_recipe(name: str) -> str:
    functions = [{"name": "probe", "inputs": CHOICE_INPUTS, "outputs": [], "flow": [LOG_STEP]}]
    return make_recipe([{"function": "probe"}], name=name, functions=functions)


class TestChoiceValuesReadBack:
    """A readback lists every stored choice value, so a choice the recipe left out reads
    back written (FIELD-8, REQ-5.2.7.6)."""

    def test_a_choice_left_out_of_the_recipe_reads_back_written(self) -> None:
        step = {"block": "http-client", "settings": {"url": "http://shop.local"}}
        created = author().create_test_from_recipe(make_recipe([step], name="Choices Read Back"))

        assert created["created"] is True, created["findings"]
        flow = yaml.safe_load(author().get_test_recipe(created["test_id"])["recipe"])["flow"]
        assert flow[0]["settings"] == {**HTTP_CREATION_VALUES, "url": "http://shop.local"}

    def test_a_function_block_reads_back_its_written_inputs(self) -> None:
        created = author().create_test_from_recipe(choice_inputs_recipe("Inputs Read Back"))

        assert created["created"] is True, created["findings"]
        (step,) = yaml.safe_load(author().get_test_recipe(created["test_id"])["recipe"])["flow"]
        assert (step["function"], step["settings"]) == ("probe", {"level": "low", "strict": True})

    def test_the_function_block_readback_recompiles_to_the_same_test(self) -> None:
        assert_round_trip(choice_inputs_recipe("Inputs Recompiled"))


RECIPE_WITH_A_PAIR = (
    'test:\n  name: "Ok \\uD83D\\uDE00"\nflow:\n- block: log\n  settings:\n    message: hello\n'
)
UNENCODABLE_NAME = (
    "Recipe has a character at test.name that cannot be encoded as UTF-8: remove or replace it"
)


class TestRecipeHoldingTextUtf8CannotWrite:
    """Every author tool answers the parse error finding and stores nothing (REQ-4.6.9)."""

    def test_validate_answers_the_finding(self) -> None:
        result = author().validate_recipe(simple_recipe("Cafe\udce9"))

        assert (result["valid"], result["test_name"]) == (False, None)
        finding = find_finding(result["findings"], "RECIPE_PARSE_ERROR")
        assert (finding["step"], finding["problem"], finding["fix"]) == (
            "recipe",
            UNENCODABLE_NAME,
            None,
        )

    def test_create_stores_nothing(self) -> None:
        before = stored_test_ids()

        result = author().create_test_from_recipe(simple_recipe("Cafe\udce9"))

        assert result["created"] is False
        assert find_finding(result["findings"], "RECIPE_PARSE_ERROR")["problem"] == UNENCODABLE_NAME
        assert stored_test_ids() == before

    def test_amend_changes_nothing(self) -> None:
        created = author().create_test_from_recipe(simple_recipe("Amend Target"))
        before = author().get_test_recipe(created["test_id"])

        result = author().amend_test_from_recipe(created["test_id"], simple_recipe("Cafe\udce9"))

        assert result["amended"] is False
        assert find_finding(result["findings"], "RECIPE_PARSE_ERROR")["problem"] == UNENCODABLE_NAME
        assert author().get_test_recipe(created["test_id"]) == before

    def test_no_secret_file_is_looked_up(self, monkeypatch: Any, tmp_path: Path) -> None:
        monkeypatch.setenv("WAVE_MCP_SECRETS_DIR", str(tmp_path))
        recipe = make_recipe(
            [{"block": "log", "settings": {"message": "shh"}}],
            name="File Secret Unencodable",
            variables={
                "token": {"type": "string", "secret": True, "value_from_file": "cafe\udce9"}
            },
        )

        result = author().create_test_from_recipe(recipe)

        assert result["created"] is False
        assert [finding["code"] for finding in result["findings"]] == ["RECIPE_PARSE_ERROR"]
        assert result["findings"][0]["problem"] == (
            "Recipe has a character at variables.token.value_from_file that cannot be encoded "
            "as UTF-8: remove or replace it"
        )

    def test_a_character_written_as_two_escapes_is_stored_as_that_character(self) -> None:
        from wavecore.api.services.tests import service as test_service

        result = author().create_test_from_recipe(RECIPE_WITH_A_PAIR)

        assert result["created"] is True, result["findings"]
        assert test_service.get_test(result["test_id"])["name"] == "Ok 😀"
