"""Stage-1 warning for a testdata:// literal that names no file (REQ-5.2.7.3).

The validator carries the run's test data roots and resolves every literal
testdata:// setting through the plugin path resolver; anything that does not
resolve is a warning, never an error.
"""

from pathlib import Path
from typing import Any

import pytest

from tests.core.recipes.conftest import find_finding, make_recipe

CODE = "TESTDATA_NOT_FOUND"
PROBLEM = "testdata file not found: {value}"
FIX = "Upload the file to the test's Test Data or correct the reference"

REFERENCE = "testdata://examples/customers.csv"


def validate(text: str, testdata_dirs: list[str] | None) -> list[dict[str, Any]]:
    from wavecore.core.recipes.parser import parse_recipe
    from wavecore.core.recipes.validator import validate_recipe_doc

    doc, parse_findings = parse_recipe(text)
    assert parse_findings == [], f"recipe must parse cleanly first: {parse_findings!r}"
    assert doc is not None
    return validate_recipe_doc(doc, testdata_dirs)


def workbook_step(reference: Any) -> dict[str, Any]:
    return {"block": "excel-parser", "settings": {"operation": "read", "workbook": reference}}


def workbook_recipe(reference: Any = REFERENCE) -> str:
    return make_recipe([workbook_step(reference)])


@pytest.fixture
def testdata_root(tmp_path: Path) -> Path:
    root = tmp_path / "testdata-root"
    (root / "examples").mkdir(parents=True)
    return root


class TestValidatorTakesTheTestDataRoots:
    """validate_recipe_doc hands its roots to the validator."""

    def test_the_roots_reach_the_validator_instance(self, testdata_root: Path) -> None:
        from wavecore.core.recipes.parser import parse_recipe
        from wavecore.core.recipes.validator import _Validator

        doc, _ = parse_recipe(workbook_recipe())
        assert doc is not None
        validator = _Validator(doc, [str(testdata_root)])

        assert validator.testdata_dirs == [str(testdata_root)]


class TestMissingTestdataLiteral:
    """A literal that names no file is one warning finding."""

    def test_the_finding_carries_the_exact_envelope(self, testdata_root: Path) -> None:
        findings = validate(workbook_recipe(), [str(testdata_root)])

        assert find_finding(findings, CODE) == {
            "step": "flow[0].settings.workbook",
            "code": CODE,
            "severity": "warning",
            "problem": PROBLEM.format(value=REFERENCE),
            "fix": FIX,
        }

    def test_the_warning_never_makes_the_recipe_invalid(self, testdata_root: Path) -> None:
        findings = validate(workbook_recipe(), [str(testdata_root)])

        assert [item for item in findings if item["severity"] == "error"] == []

    def test_the_step_path_follows_a_nested_construct(self, testdata_root: Path) -> None:
        recipe = make_recipe([{"for": {"count": 1, "body": [workbook_step(REFERENCE)]}}])

        findings = validate(recipe, [str(testdata_root)])

        assert find_finding(findings, CODE)["step"] == "flow[0].for.body[0].settings.workbook"


class TestResolvableTestdataLiteral:
    """A literal that names a real file is silent."""

    def test_an_existing_file_yields_nothing(self, testdata_root: Path) -> None:
        (testdata_root / "examples" / "customers.csv").write_text("id,name\n", encoding="utf-8")

        findings = validate(workbook_recipe(), [str(testdata_root)])

        assert [item for item in findings if item["code"] == CODE] == []

    def test_a_plain_path_is_never_checked(self, testdata_root: Path) -> None:
        findings = validate(workbook_recipe("/srv/fixtures/customers.csv"), [str(testdata_root)])

        assert [item for item in findings if item["code"] == CODE] == []

    def test_an_artifact_reference_is_never_checked(self, testdata_root: Path) -> None:
        findings = validate(
            workbook_recipe("artifact://reports/customers.csv"), [str(testdata_root)]
        )

        assert [item for item in findings if item["code"] == CODE] == []


class TestTemplatedTestdataValue:
    """A value the run fills in cannot be checked at authoring time."""

    def test_a_templated_reference_is_skipped(self, testdata_root: Path) -> None:
        recipe = make_recipe(
            [workbook_step("testdata://examples/{{ fixture }}.csv")],
            variables={"fixture": {"type": "string", "value": "customers"}},
        )

        findings = validate(recipe, [str(testdata_root)])

        assert [item for item in findings if item["code"] == CODE] == []

    def test_an_expression_reference_is_skipped(self, testdata_root: Path) -> None:
        recipe = make_recipe(
            [workbook_step({"expr": "'testdata://' + fixture"})],
            variables={"fixture": {"type": "string", "value": "examples/customers.csv"}},
        )

        findings = validate(recipe, [str(testdata_root)])

        assert [item for item in findings if item["code"] == CODE] == []


class TestParentSegmentReferences:
    """A `..` reference is resolved like any other: found beside the folder, or warned."""

    def test_a_parent_segment_to_a_file_beside_the_folder_has_no_finding(
        self, testdata_root: Path
    ) -> None:
        (testdata_root.parent / "shared.csv").write_text("id\n1\n", encoding="utf-8")

        findings = validate(workbook_recipe("testdata://../shared.csv"), [str(testdata_root)])

        assert [item for item in findings if item["code"] == CODE] == []

    def test_a_parent_segment_to_nothing_yields_the_finding(self, testdata_root: Path) -> None:
        reference = "testdata://../escape.csv"

        findings = validate(workbook_recipe(reference), [str(testdata_root)])

        assert find_finding(findings, CODE) == {
            "step": "flow[0].settings.workbook",
            "code": CODE,
            "severity": "warning",
            "problem": PROBLEM.format(value=reference),
            "fix": FIX,
        }


class TestNoTestDataRoots:
    """Authoring without a target test cannot resolve anything."""

    def test_every_literal_warns_when_the_roots_are_empty(self) -> None:
        second = "testdata://examples/orders.csv"
        recipe = make_recipe([workbook_step(REFERENCE), workbook_step(second)])

        findings = validate(recipe, [])

        warnings = [item for item in findings if item["code"] == CODE]
        assert [item["step"] for item in warnings] == [
            "flow[0].settings.workbook",
            "flow[1].settings.workbook",
        ]
        assert [item["problem"] for item in warnings] == [
            PROBLEM.format(value=REFERENCE),
            PROBLEM.format(value=second),
        ]

    def test_none_behaves_like_no_roots(self) -> None:
        findings = validate(workbook_recipe(), None)

        assert find_finding(findings, CODE)["problem"] == PROBLEM.format(value=REFERENCE)


def upload_recipe(source: str) -> str:
    step = {
        "block": "sftp",
        "settings": {
            "session_id": "main",
            "operation": "upload",
            "source": source,
            "destination": "/inbound/",
        },
    }
    return make_recipe([step])


def envelope(reference: str) -> dict[str, Any]:
    return {
        "step": "flow[0].settings.source",
        "code": CODE,
        "severity": "warning",
        "problem": PROBLEM.format(value=reference),
        "fix": FIX,
    }


class TestWildcardTestdataReference:
    """SFTP-3: a wildcard reference warns only when it matches no Test Data file."""

    def test_a_wildcard_that_matches_validates_clean(self, testdata_root: Path) -> None:
        for name in ("orders-01.csv", "orders-02.csv"):
            (testdata_root / "examples" / name).write_text("id\n1\n", encoding="utf-8")

        findings = validate(upload_recipe("testdata://examples/orders-*.csv"), [str(testdata_root)])

        assert findings == []

    def test_a_wildcard_that_matches_nothing_warns(self, testdata_root: Path) -> None:
        (testdata_root / "examples" / "orders-01.csv").write_text("id\n1\n", encoding="utf-8")
        reference = "testdata://examples/*.xml"

        findings = validate(upload_recipe(reference), [str(testdata_root)])

        assert find_finding(findings, CODE) == envelope(reference)

    def test_a_wildcard_under_a_missing_folder_warns(self, testdata_root: Path) -> None:
        reference = "testdata://inbound/*.csv"

        findings = validate(upload_recipe(reference), [str(testdata_root)])

        assert find_finding(findings, CODE) == envelope(reference)

    def test_a_wildcard_without_test_data_folders_warns_once(self) -> None:
        reference = "testdata://examples/*.csv"

        findings = validate(upload_recipe(reference), [])

        assert [item for item in findings if item["code"] == CODE] == [envelope(reference)]

    def test_none_behaves_like_no_folders_for_a_wildcard(self) -> None:
        reference = "testdata://examples/*.csv"

        findings = validate(upload_recipe(reference), None)

        assert [item for item in findings if item["code"] == CODE] == [envelope(reference)]
