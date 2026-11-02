"""Test Data write tools on the MCP surface (REQ-5.2.7.9).

The four tools sit on testdata_service with the same messages and the same
running-test refusal. Three outcomes are kept apart: an unknown test reference
raises through resolve_test exactly as get_test does, an argument error raises
ValidationException, and a service refusal comes back as a finding in the
result.
"""

import base64
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest

from tests.mcp.conftest import create_test_entity
from wavecore.api.exceptions import ConflictException, NotFoundException, ValidationException

EXACTLY_ONE_CONTENT = "Provide exactly one of content or content_base64"
RUNNING = "Test '{name}' is running; test data cannot be changed until it finishes"

CSV_TEXT = "id,name\n1,ada\n"


@pytest.fixture(autouse=True)
def _registries(seed_registries: None) -> None:
    """Seeded tests carry a Log node; the registry must resolve it on create."""


def testdata() -> Any:
    from wavecore.mcp.tools import testdata as testdata_tools

    return testdata_tools


def service() -> Any:
    from wavecore.api.services.tests import testdata_service

    return testdata_service


def folder_of(test_id: str) -> Path:
    from wavecore.api.services.storage_paths import get_test_testdata_path

    return get_test_testdata_path(test_id)


def seed(test_id: str, *entries: tuple[str, bytes]) -> None:
    service().write_files(test_id, list(entries))


def make_test(name: str) -> dict[str, Any]:
    return create_test_entity(name)


def only_finding(result: dict[str, Any]) -> dict[str, Any]:
    assert list(result["findings"]) != []
    assert len(result["findings"]) == 1
    return dict(result["findings"][0])


def running_guard(name: str) -> Any:
    """Force the service's running-test refusal without staging a real run."""
    return patch.object(
        service(),
        "assert_not_running",
        side_effect=ConflictException(
            RUNNING.format(name=name), details={"execution_ids": ["exec-1"]}
        ),
    )


class TestWriteTestdataArguments:
    """Argument errors raise ValidationException and touch no file."""

    def test_neither_content_nor_base64_is_refused(self) -> None:
        test = make_test("Write Args None")

        with pytest.raises(ValidationException, match=rf"^{EXACTLY_ONE_CONTENT}$"):
            testdata().write_testdata(test["id"], "customers.csv")

    def test_both_content_and_base64_are_refused(self) -> None:
        test = make_test("Write Args Both")

        with pytest.raises(ValidationException, match=rf"^{EXACTLY_ONE_CONTENT}$"):
            testdata().write_testdata(
                test["id"],
                "customers.csv",
                content=CSV_TEXT,
                content_base64=base64.b64encode(CSV_TEXT.encode()).decode(),
            )

    def test_content_that_is_not_base64_is_refused(self) -> None:
        test = make_test("Write Args Bad Base64")

        with pytest.raises(ValidationException):
            testdata().write_testdata(test["id"], "customers.csv", content_base64="not base64!!")

    def test_an_argument_error_never_reaches_the_service(self) -> None:
        test = make_test("Write Args Short Circuit")

        with patch.object(service(), "store_bytes") as upload:
            with pytest.raises(ValidationException):
                testdata().write_testdata(test["id"], "customers.csv")

        upload.assert_not_called()
        assert not folder_of(test["id"]).exists()


class TestWriteTestdataSuccess:
    """A written file lands in the test's own folder and reports its size."""

    def test_text_content_is_written_at_the_root(self) -> None:
        test = make_test("Write Root")

        result = testdata().write_testdata(test["id"], "customers.csv", content=CSV_TEXT)

        assert result == {
            "written": True,
            "path": "customers.csv",
            "size_bytes": len(CSV_TEXT.encode()),
        }
        assert (folder_of(test["id"]) / "customers.csv").read_text(encoding="utf-8") == CSV_TEXT

    def test_base64_content_is_decoded_before_it_is_written(self) -> None:
        test = make_test("Write Base64")
        payload = b"\x00\x01\x02binary"

        result = testdata().write_testdata(
            test["id"],
            "blob.bin",
            content_base64=base64.b64encode(payload).decode("ascii"),
        )

        assert result == {"written": True, "path": "blob.bin", "size_bytes": len(payload)}
        assert (folder_of(test["id"]) / "blob.bin").read_bytes() == payload

    def test_a_nested_path_is_written_into_an_existing_folder(self) -> None:
        test = make_test("Write Nested")
        testdata().create_testdata_folder(test["id"], "examples")

        result = testdata().write_testdata(test["id"], "examples/customers.csv", content=CSV_TEXT)

        assert result["written"] is True
        assert result["path"] == "examples/customers.csv"
        assert (folder_of(test["id"]) / "examples" / "customers.csv").exists()

    def test_replace_overwrites_the_existing_file(self) -> None:
        test = make_test("Write Replace")
        seed(test["id"], ("customers.csv", b"old"))

        result = testdata().write_testdata(
            test["id"], "customers.csv", content=CSV_TEXT, replace=True
        )

        assert result["written"] is True
        assert (folder_of(test["id"]) / "customers.csv").read_text(encoding="utf-8") == CSV_TEXT

    def test_the_test_resolves_by_unique_name(self) -> None:
        test = make_test("Write By Name")

        result = testdata().write_testdata("Write By Name", "customers.csv", content=CSV_TEXT)

        assert result["written"] is True
        assert (folder_of(test["id"]) / "customers.csv").exists()


class TestWriteTestdataRefusals:
    """A refusal from the service is a finding; the test reference still raises."""

    def test_an_existing_file_without_replace_comes_back_as_a_finding(self) -> None:
        test = make_test("Write Conflict")
        seed(test["id"], ("customers.csv", b"old"))

        result = testdata().write_testdata(test["id"], "customers.csv", content=CSV_TEXT)

        assert result["written"] is False
        assert only_finding(result) == {
            "step": "input",
            "code": "VALIDATION",
            "severity": "error",
            "problem": "File already exists: customers.csv",
            "fix": None,
        }
        assert (folder_of(test["id"]) / "customers.csv").read_bytes() == b"old"

    def test_a_missing_folder_comes_back_as_a_finding(self) -> None:
        test = make_test("Write Missing Folder")

        result = testdata().write_testdata(test["id"], "missing/customers.csv", content=CSV_TEXT)

        assert result["written"] is False
        assert only_finding(result)["problem"] == "Folder not found: missing"

    def test_a_running_test_comes_back_as_a_finding(self) -> None:
        test = make_test("Write While Running")

        with running_guard("Write While Running"):
            result = testdata().write_testdata(test["id"], "customers.csv", content=CSV_TEXT)

        assert result["written"] is False
        assert only_finding(result)["problem"] == RUNNING.format(name="Write While Running")
        assert not (folder_of(test["id"]) / "customers.csv").exists()

    def test_an_unknown_test_raises_instead_of_reporting_a_finding(self) -> None:
        with pytest.raises(NotFoundException, match=r"^Test 'ghost' not found$"):
            testdata().write_testdata("ghost", "customers.csv", content=CSV_TEXT)


class TestCreateTestdataFolder:
    """create_testdata_folder answers created and nothing else."""

    def test_a_folder_is_created_at_the_root(self) -> None:
        test = make_test("Folder Root")

        result = testdata().create_testdata_folder(test["id"], "examples")

        assert result == {"created": True}
        assert (folder_of(test["id"]) / "examples").is_dir()

    def test_a_nested_folder_is_created_under_an_existing_parent(self) -> None:
        test = make_test("Folder Nested")
        testdata().create_testdata_folder(test["id"], "examples")

        result = testdata().create_testdata_folder(test["id"], "examples/inputs")

        assert result == {"created": True}
        assert (folder_of(test["id"]) / "examples" / "inputs").is_dir()

    def test_a_missing_parent_comes_back_as_a_finding(self) -> None:
        test = make_test("Folder Missing Parent")

        result = testdata().create_testdata_folder(test["id"], "examples/inputs")

        assert result["created"] is False
        assert only_finding(result)["problem"] == "Folder not found: examples"

    def test_an_existing_folder_comes_back_as_a_finding(self) -> None:
        test = make_test("Folder Conflict")
        testdata().create_testdata_folder(test["id"], "examples")

        result = testdata().create_testdata_folder(test["id"], "examples")

        assert result["created"] is False
        assert only_finding(result) == {
            "step": "input",
            "code": "VALIDATION",
            "severity": "error",
            "problem": "Folder already exists: examples",
            "fix": None,
        }

    def test_a_file_of_that_name_comes_back_as_a_finding(self) -> None:
        test = make_test("Folder Over File")
        seed(test["id"], ("customers.csv", b"old"))

        result = testdata().create_testdata_folder(test["id"], "customers.csv")

        assert result["created"] is False
        assert only_finding(result)["problem"] == "File already exists: customers.csv"

    def test_a_running_test_comes_back_as_a_finding(self) -> None:
        test = make_test("Folder While Running")

        with running_guard("Folder While Running"):
            result = testdata().create_testdata_folder(test["id"], "examples")

        assert result["created"] is False
        assert only_finding(result)["problem"] == RUNNING.format(name="Folder While Running")

    def test_an_unknown_test_raises_instead_of_reporting_a_finding(self) -> None:
        with pytest.raises(NotFoundException, match=r"^Test 'ghost' not found$"):
            testdata().create_testdata_folder("ghost", "examples")


class TestRenameTestdata:
    """rename_testdata answers renamed plus the new path."""

    def test_a_file_is_renamed_in_place(self) -> None:
        test = make_test("Rename File")
        seed(test["id"], ("customers.csv", b"rows"))

        result = testdata().rename_testdata(test["id"], "customers.csv", "clients.csv")

        assert result == {"renamed": True, "path": "clients.csv"}
        assert not (folder_of(test["id"]) / "customers.csv").exists()
        assert (folder_of(test["id"]) / "clients.csv").read_bytes() == b"rows"

    def test_a_file_moves_within_the_test(self) -> None:
        test = make_test("Rename Move")
        seed(test["id"], ("examples/customers.csv", b"rows"))

        result = testdata().rename_testdata(test["id"], "examples/customers.csv", "customers.csv")

        assert result == {"renamed": True, "path": "customers.csv"}
        assert (folder_of(test["id"]) / "customers.csv").read_bytes() == b"rows"

    def test_a_missing_entry_comes_back_as_a_finding(self) -> None:
        test = make_test("Rename Missing")

        result = testdata().rename_testdata(test["id"], "ghost.csv", "clients.csv")

        assert result["renamed"] is False
        assert only_finding(result) == {
            "step": "input",
            "code": "VALIDATION",
            "severity": "error",
            "problem": "Test data entry not found: ghost.csv",
            "fix": None,
        }

    def test_an_occupied_target_comes_back_as_a_finding(self) -> None:
        test = make_test("Rename Conflict")
        seed(test["id"], ("customers.csv", b"rows"), ("clients.csv", b"other"))

        result = testdata().rename_testdata(test["id"], "customers.csv", "clients.csv")

        assert result["renamed"] is False
        assert only_finding(result)["problem"] == "File already exists: clients.csv"

    def test_a_running_test_comes_back_as_a_finding(self) -> None:
        test = make_test("Rename While Running")
        seed(test["id"], ("customers.csv", b"rows"))

        with running_guard("Rename While Running"):
            result = testdata().rename_testdata(test["id"], "customers.csv", "clients.csv")

        assert result["renamed"] is False
        assert only_finding(result)["problem"] == RUNNING.format(name="Rename While Running")
        assert (folder_of(test["id"]) / "customers.csv").exists()

    def test_an_unknown_test_raises_instead_of_reporting_a_finding(self) -> None:
        with pytest.raises(NotFoundException, match=r"^Test 'ghost' not found$"):
            testdata().rename_testdata("ghost", "customers.csv", "clients.csv")


class TestDeleteTestdata:
    """delete_testdata answers deleted and nothing else."""

    def test_a_file_is_removed(self) -> None:
        test = make_test("Delete File")
        seed(test["id"], ("customers.csv", b"rows"))

        result = testdata().delete_testdata(test["id"], "customers.csv")

        assert result == {"deleted": True}
        assert not (folder_of(test["id"]) / "customers.csv").exists()

    def test_a_folder_is_removed_with_everything_inside_it(self) -> None:
        test = make_test("Delete Folder")
        seed(test["id"], ("examples/customers.csv", b"rows"), ("examples/inputs/a.txt", b"a"))

        result = testdata().delete_testdata(test["id"], "examples")

        assert result == {"deleted": True}
        assert not (folder_of(test["id"]) / "examples").exists()

    def test_a_missing_entry_comes_back_as_a_finding(self) -> None:
        test = make_test("Delete Missing")

        result = testdata().delete_testdata(test["id"], "ghost.csv")

        assert result["deleted"] is False
        assert only_finding(result)["problem"] == "Test data entry not found: ghost.csv"

    def test_a_running_test_comes_back_as_a_finding(self) -> None:
        test = make_test("Delete While Running")
        seed(test["id"], ("customers.csv", b"rows"))

        with running_guard("Delete While Running"):
            result = testdata().delete_testdata(test["id"], "customers.csv")

        assert result["deleted"] is False
        assert only_finding(result)["problem"] == RUNNING.format(name="Delete While Running")
        assert (folder_of(test["id"]) / "customers.csv").exists()

    def test_an_unknown_test_raises_instead_of_reporting_a_finding(self) -> None:
        with pytest.raises(NotFoundException, match=r"^Test 'ghost' not found$"):
            testdata().delete_testdata("ghost", "customers.csv")
