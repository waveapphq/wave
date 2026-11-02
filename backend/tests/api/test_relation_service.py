"""Tests for the relation index service."""

from unittest.mock import patch

import pytest

from wavecore.api.services.relations import service as relation_service


@pytest.fixture(autouse=True)
def _reset_index():
    """Reset the relation index before each test."""
    relation_service._test_to_suites.clear()
    relation_service._suite_to_regressions.clear()
    relation_service._initialized = False
    yield
    relation_service._test_to_suites.clear()
    relation_service._suite_to_regressions.clear()
    relation_service._initialized = False


# ---------------------------------------------------------------------------
# rebuild()
# ---------------------------------------------------------------------------


class TestRebuild:
    def test_rebuild_empty(self):
        with patch(
            "wavecore.api.services.relations.service._load_all_suites",
            return_value=[],
        ):
            relation_service.rebuild()

        assert relation_service._initialized is True
        assert relation_service._test_to_suites == {}

    def test_rebuild_single_suite_single_test(self):
        suites = [
            {"id": "s1", "name": "Auth Suite", "tests": ["t1"]},
        ]
        with patch(
            "wavecore.api.services.relations.service._load_all_suites",
            return_value=suites,
        ):
            relation_service.rebuild()

        assert relation_service._test_to_suites == {
            "t1": [{"id": "s1", "name": "Auth Suite"}],
        }

    def test_rebuild_multiple_suites_shared_test(self):
        suites = [
            {"id": "s1", "name": "Auth Suite", "tests": ["t1", "t2"]},
            {"id": "s2", "name": "API Suite", "tests": ["t2", "t3"]},
        ]
        with patch(
            "wavecore.api.services.relations.service._load_all_suites",
            return_value=suites,
        ):
            relation_service.rebuild()

        assert relation_service._test_to_suites["t1"] == [
            {"id": "s1", "name": "Auth Suite"},
        ]
        assert relation_service._test_to_suites["t2"] == [
            {"id": "s1", "name": "Auth Suite"},
            {"id": "s2", "name": "API Suite"},
        ]
        assert relation_service._test_to_suites["t3"] == [
            {"id": "s2", "name": "API Suite"},
        ]

    def test_rebuild_suite_with_no_tests(self):
        suites = [
            {"id": "s1", "name": "Empty Suite", "tests": []},
            {"id": "s2", "name": "Another", "tests": ["t1"]},
        ]
        with patch(
            "wavecore.api.services.relations.service._load_all_suites",
            return_value=suites,
        ):
            relation_service.rebuild()

        assert "t1" in relation_service._test_to_suites
        # No phantom entries for the empty suite
        for entries in relation_service._test_to_suites.values():
            for entry in entries:
                assert entry["id"] != "s1"

    def test_rebuild_suite_missing_tests_key(self):
        suites = [{"id": "s1", "name": "No Tests Key"}]
        with patch(
            "wavecore.api.services.relations.service._load_all_suites",
            return_value=suites,
        ):
            relation_service.rebuild()

        assert relation_service._test_to_suites == {}

    def test_rebuild_clears_previous_state(self):
        relation_service._test_to_suites["old"] = [{"id": "x", "name": "Old"}]
        suites = [{"id": "s1", "name": "New", "tests": ["t1"]}]
        with patch(
            "wavecore.api.services.relations.service._load_all_suites",
            return_value=suites,
        ):
            relation_service.rebuild()

        assert "old" not in relation_service._test_to_suites
        assert "t1" in relation_service._test_to_suites

    def test_rebuild_with_real_storage(self, tmp_path, monkeypatch):
        """Covers the real _load_all_suites import path."""
        monkeypatch.setattr(
            "wavecore.api.services.suites._storage.get_suites_storage_path",
            lambda: tmp_path,
        )
        relation_service.rebuild()
        assert relation_service._initialized is True
        assert relation_service._test_to_suites == {}


# ---------------------------------------------------------------------------
# Query functions
# ---------------------------------------------------------------------------


class TestGetSuitesForTest:
    def test_returns_suites(self):
        relation_service._test_to_suites["t1"] = [
            {"id": "s1", "name": "Suite A"},
            {"id": "s2", "name": "Suite B"},
        ]
        relation_service._initialized = True

        result = relation_service.get_suites_for_test("t1")
        assert result == [
            {"id": "s1", "name": "Suite A"},
            {"id": "s2", "name": "Suite B"},
        ]

    def test_returns_empty_for_unknown_test(self):
        relation_service._initialized = True
        assert relation_service.get_suites_for_test("unknown") == []

    def test_lazy_initializes(self):
        with patch(
            "wavecore.api.services.relations.service._load_all_suites",
            return_value=[{"id": "s1", "name": "S", "tests": ["t1"]}],
        ):
            result = relation_service.get_suites_for_test("t1")

        assert result == [{"id": "s1", "name": "S"}]
        assert relation_service._initialized is True


class TestGetSuiteCountForTest:
    def test_returns_count(self):
        relation_service._test_to_suites["t1"] = [
            {"id": "s1", "name": "A"},
            {"id": "s2", "name": "B"},
            {"id": "s3", "name": "C"},
        ]
        relation_service._initialized = True

        assert relation_service.get_suite_count_for_test("t1") == 3

    def test_returns_zero_for_unknown(self):
        relation_service._initialized = True
        assert relation_service.get_suite_count_for_test("unknown") == 0


class TestGetSuiteNamesForTest:
    def test_returns_names(self):
        relation_service._test_to_suites["t1"] = [
            {"id": "s1", "name": "Auth"},
            {"id": "s2", "name": "API"},
        ]
        relation_service._initialized = True

        assert relation_service.get_suite_names_for_test("t1") == ["Auth", "API"]

    def test_returns_empty_for_unknown(self):
        relation_service._initialized = True
        assert relation_service.get_suite_names_for_test("unknown") == []


class TestGetSuiteMembershipBulk:
    def test_returns_membership_for_multiple_tests(self):
        relation_service._test_to_suites["t1"] = [{"id": "s1", "name": "A"}]
        relation_service._test_to_suites["t2"] = [
            {"id": "s1", "name": "A"},
            {"id": "s2", "name": "B"},
        ]
        relation_service._initialized = True

        result = relation_service.get_suite_membership_bulk(["t1", "t2", "t3"])
        assert result == {
            "t1": [{"id": "s1", "name": "A"}],
            "t2": [{"id": "s1", "name": "A"}, {"id": "s2", "name": "B"}],
            "t3": [],
        }


# ---------------------------------------------------------------------------
# Mutation hooks
# ---------------------------------------------------------------------------


class TestOnTestAddedToSuite:
    def test_adds_new_entry(self):
        relation_service._initialized = True
        relation_service.on_test_added_to_suite("s1", "Auth Suite", "t1")

        assert relation_service._test_to_suites["t1"] == [
            {"id": "s1", "name": "Auth Suite"},
        ]

    def test_appends_to_existing(self):
        relation_service._test_to_suites["t1"] = [{"id": "s1", "name": "A"}]
        relation_service._initialized = True

        relation_service.on_test_added_to_suite("s2", "B", "t1")

        assert relation_service._test_to_suites["t1"] == [
            {"id": "s1", "name": "A"},
            {"id": "s2", "name": "B"},
        ]

    def test_no_duplicate(self):
        relation_service._test_to_suites["t1"] = [{"id": "s1", "name": "A"}]
        relation_service._initialized = True

        relation_service.on_test_added_to_suite("s1", "A", "t1")

        assert len(relation_service._test_to_suites["t1"]) == 1


class TestOnTestRemovedFromSuite:
    def test_removes_entry(self):
        relation_service._test_to_suites["t1"] = [
            {"id": "s1", "name": "A"},
            {"id": "s2", "name": "B"},
        ]
        relation_service._initialized = True

        relation_service.on_test_removed_from_suite("s1", "t1")

        assert relation_service._test_to_suites["t1"] == [
            {"id": "s2", "name": "B"},
        ]

    def test_removes_last_entry_cleans_key(self):
        relation_service._test_to_suites["t1"] = [{"id": "s1", "name": "A"}]
        relation_service._initialized = True

        relation_service.on_test_removed_from_suite("s1", "t1")

        assert "t1" not in relation_service._test_to_suites

    def test_noop_for_unknown_test(self):
        relation_service._initialized = True
        relation_service.on_test_removed_from_suite("s1", "unknown")
        # No error


class TestOnSuiteDeleted:
    def test_removes_suite_from_all_tests(self):
        relation_service._test_to_suites["t1"] = [
            {"id": "s1", "name": "A"},
            {"id": "s2", "name": "B"},
        ]
        relation_service._test_to_suites["t2"] = [{"id": "s1", "name": "A"}]
        relation_service._initialized = True

        relation_service.on_suite_deleted("s1")

        assert relation_service._test_to_suites["t1"] == [
            {"id": "s2", "name": "B"},
        ]
        assert "t2" not in relation_service._test_to_suites

    def test_noop_for_unknown_suite(self):
        relation_service._initialized = True
        relation_service.on_suite_deleted("unknown")


class TestOnSuiteRenamed:
    def test_updates_name_in_all_entries(self):
        relation_service._test_to_suites["t1"] = [
            {"id": "s1", "name": "Old Name"},
            {"id": "s2", "name": "Other"},
        ]
        relation_service._test_to_suites["t2"] = [{"id": "s1", "name": "Old Name"}]
        relation_service._initialized = True

        relation_service.on_suite_renamed("s1", "New Name")

        assert relation_service._test_to_suites["t1"][0]["name"] == "New Name"
        assert relation_service._test_to_suites["t1"][1]["name"] == "Other"
        assert relation_service._test_to_suites["t2"][0]["name"] == "New Name"

    def test_noop_for_unknown_suite(self):
        relation_service._initialized = True
        relation_service.on_suite_renamed("unknown", "New")


class TestOnTestDeleted:
    def test_returns_affected_suite_ids(self):
        relation_service._test_to_suites["t1"] = [
            {"id": "s1", "name": "A"},
            {"id": "s2", "name": "B"},
        ]
        relation_service._initialized = True

        affected = relation_service.on_test_deleted("t1")

        assert set(affected) == {"s1", "s2"}
        assert "t1" not in relation_service._test_to_suites

    def test_returns_empty_for_unknown(self):
        relation_service._initialized = True
        assert relation_service.on_test_deleted("unknown") == []


# ---------------------------------------------------------------------------
# Suite -> regression index
# ---------------------------------------------------------------------------


class TestRebuildIncludesSuiteToRegressions:
    def test_rebuild_single_regression_single_suite(self):
        regressions = [
            {"id": "r1", "name": "Nightly", "suites": ["s1"]},
        ]
        with (
            patch(
                "wavecore.api.services.relations.service._load_all_suites",
                return_value=[],
            ),
            patch(
                "wavecore.api.services.relations.service._load_all_regressions",
                return_value=regressions,
            ),
        ):
            relation_service.rebuild()

        assert relation_service._suite_to_regressions == {
            "s1": [{"id": "r1", "name": "Nightly"}],
        }

    def test_rebuild_multiple_regressions_shared_suite(self):
        regressions = [
            {"id": "r1", "name": "Nightly", "suites": ["s1", "s2"]},
            {"id": "r2", "name": "Smoke", "suites": ["s2", "s3"]},
        ]
        with (
            patch(
                "wavecore.api.services.relations.service._load_all_suites",
                return_value=[],
            ),
            patch(
                "wavecore.api.services.relations.service._load_all_regressions",
                return_value=regressions,
            ),
        ):
            relation_service.rebuild()

        assert relation_service._suite_to_regressions["s1"] == [
            {"id": "r1", "name": "Nightly"},
        ]
        assert relation_service._suite_to_regressions["s2"] == [
            {"id": "r1", "name": "Nightly"},
            {"id": "r2", "name": "Smoke"},
        ]
        assert relation_service._suite_to_regressions["s3"] == [
            {"id": "r2", "name": "Smoke"},
        ]

    def test_rebuild_regression_with_no_suites(self):
        regressions = [
            {"id": "r1", "name": "Empty", "suites": []},
            {"id": "r2", "name": "Has-One", "suites": ["s1"]},
        ]
        with (
            patch(
                "wavecore.api.services.relations.service._load_all_suites",
                return_value=[],
            ),
            patch(
                "wavecore.api.services.relations.service._load_all_regressions",
                return_value=regressions,
            ),
        ):
            relation_service.rebuild()

        assert "s1" in relation_service._suite_to_regressions
        for entries in relation_service._suite_to_regressions.values():
            for entry in entries:
                assert entry["id"] != "r1"

    def test_rebuild_regression_missing_suites_key(self):
        regressions = [{"id": "r1", "name": "No Suites Key"}]
        with (
            patch(
                "wavecore.api.services.relations.service._load_all_suites",
                return_value=[],
            ),
            patch(
                "wavecore.api.services.relations.service._load_all_regressions",
                return_value=regressions,
            ),
        ):
            relation_service.rebuild()

        assert relation_service._suite_to_regressions == {}

    def test_rebuild_clears_previous_suite_to_regressions_state(self):
        relation_service._suite_to_regressions["old"] = [{"id": "x", "name": "Old"}]
        regressions = [{"id": "r1", "name": "New", "suites": ["s1"]}]
        with (
            patch(
                "wavecore.api.services.relations.service._load_all_suites",
                return_value=[],
            ),
            patch(
                "wavecore.api.services.relations.service._load_all_regressions",
                return_value=regressions,
            ),
        ):
            relation_service.rebuild()

        assert "old" not in relation_service._suite_to_regressions
        assert "s1" in relation_service._suite_to_regressions


class TestGetRegressionsForSuite:
    def test_returns_regressions(self):
        relation_service._suite_to_regressions["s1"] = [
            {"id": "r1", "name": "Nightly"},
            {"id": "r2", "name": "Smoke"},
        ]
        relation_service._initialized = True

        result = relation_service.get_regressions_for_suite("s1")
        assert result == [
            {"id": "r1", "name": "Nightly"},
            {"id": "r2", "name": "Smoke"},
        ]

    def test_returns_empty_for_unknown_suite(self):
        relation_service._initialized = True
        assert relation_service.get_regressions_for_suite("unknown") == []


class TestGetRegressionCountForSuite:
    def test_returns_count(self):
        relation_service._suite_to_regressions["s1"] = [
            {"id": "r1", "name": "A"},
            {"id": "r2", "name": "B"},
        ]
        relation_service._initialized = True

        assert relation_service.get_regression_count_for_suite("s1") == 2

    def test_returns_zero_for_unknown(self):
        relation_service._initialized = True
        assert relation_service.get_regression_count_for_suite("unknown") == 0


class TestOnSuiteAddedToRegression:
    def test_adds_new_entry(self):
        relation_service._initialized = True
        relation_service.on_suite_added_to_regression("r1", "Nightly", "s1")

        assert relation_service._suite_to_regressions["s1"] == [
            {"id": "r1", "name": "Nightly"},
        ]

    def test_appends_to_existing(self):
        relation_service._suite_to_regressions["s1"] = [{"id": "r1", "name": "Nightly"}]
        relation_service._initialized = True

        relation_service.on_suite_added_to_regression("r2", "Smoke", "s1")

        assert relation_service._suite_to_regressions["s1"] == [
            {"id": "r1", "name": "Nightly"},
            {"id": "r2", "name": "Smoke"},
        ]

    def test_no_duplicate(self):
        relation_service._suite_to_regressions["s1"] = [{"id": "r1", "name": "Nightly"}]
        relation_service._initialized = True

        relation_service.on_suite_added_to_regression("r1", "Nightly", "s1")

        assert len(relation_service._suite_to_regressions["s1"]) == 1


class TestOnSuiteRemovedFromRegression:
    def test_removes_entry(self):
        relation_service._suite_to_regressions["s1"] = [
            {"id": "r1", "name": "A"},
            {"id": "r2", "name": "B"},
        ]
        relation_service._initialized = True

        relation_service.on_suite_removed_from_regression("r1", "s1")

        assert relation_service._suite_to_regressions["s1"] == [
            {"id": "r2", "name": "B"},
        ]

    def test_removes_last_entry_cleans_key(self):
        relation_service._suite_to_regressions["s1"] = [{"id": "r1", "name": "A"}]
        relation_service._initialized = True

        relation_service.on_suite_removed_from_regression("r1", "s1")

        assert "s1" not in relation_service._suite_to_regressions

    def test_noop_for_unknown_suite(self):
        relation_service._initialized = True
        relation_service.on_suite_removed_from_regression("r1", "unknown")


class TestOnRegressionDeleted:
    def test_removes_regression_from_all_suites(self):
        relation_service._suite_to_regressions["s1"] = [
            {"id": "r1", "name": "A"},
            {"id": "r2", "name": "B"},
        ]
        relation_service._suite_to_regressions["s2"] = [{"id": "r1", "name": "A"}]
        relation_service._initialized = True

        affected = relation_service.on_regression_deleted("r1")

        assert set(affected) == {"s1", "s2"}
        assert relation_service._suite_to_regressions["s1"] == [
            {"id": "r2", "name": "B"},
        ]
        assert "s2" not in relation_service._suite_to_regressions

    def test_returns_empty_for_unknown_regression(self):
        relation_service._initialized = True
        assert relation_service.on_regression_deleted("unknown") == []


class TestOnRegressionRenamed:
    def test_updates_name_in_all_entries(self):
        relation_service._suite_to_regressions["s1"] = [
            {"id": "r1", "name": "Old"},
            {"id": "r2", "name": "Other"},
        ]
        relation_service._suite_to_regressions["s2"] = [{"id": "r1", "name": "Old"}]
        relation_service._initialized = True

        relation_service.on_regression_renamed("r1", "New")

        assert relation_service._suite_to_regressions["s1"][0]["name"] == "New"
        assert relation_service._suite_to_regressions["s1"][1]["name"] == "Other"
        assert relation_service._suite_to_regressions["s2"][0]["name"] == "New"

    def test_noop_for_unknown_regression(self):
        relation_service._initialized = True
        relation_service.on_regression_renamed("unknown", "New")
