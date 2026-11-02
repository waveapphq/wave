"""Tests for regression duplicate-test detection helper.

The helper answers: within a given regression, which tests appear in more
than one member suite? Consumed by the Run dialog and Execution Detail
views to render a duplicate badge with the list of containing suites.
"""

from typing import Any

from tests.api.regression_test_helpers import clear_regression_storage


def _create_test(name: str) -> str:
    from wavecore.api.services.tests import service as test_service

    test = test_service.create_test(
        {
            "name": name,
            "workflow": {
                "nodes": [{"id": "n1", "type": "workflowNode", "data": {}}],
                "edges": [],
            },
        }
    )
    return test["id"]


def _create_suite(name: str, test_ids: list[str]) -> str:
    from wavecore.api.services.suites import service as suite_service

    suite = suite_service.create_suite({"name": name, "tests": test_ids})
    return suite["id"]


def _create_regression(name: str, suite_ids: list[str]) -> str:
    from wavecore.api.services.regressions import service as regression_service

    regression = regression_service.create_regression({"name": name, "suites": suite_ids})
    return regression["id"]


class TestRegressionDuplicateTests:
    """get_regression_duplicate_tests(regression_id) returns a mapping of
    test_id to list-of-suite-ids (in regression order) for tests that
    appear in two or more suites of that regression."""

    def test_returns_empty_when_regression_has_no_suites(self) -> None:
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import _storage as _suite_storage

        _suite_storage._clear_storage()
        clear_regression_storage()
        reg_id = _create_regression("empty-reg", [])

        assert regression_service.get_regression_duplicate_tests(reg_id) == {}

    def test_returns_empty_when_all_tests_are_unique(self) -> None:
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import _storage as _suite_storage

        _suite_storage._clear_storage()
        clear_regression_storage()

        t1 = _create_test("u-t1")
        t2 = _create_test("u-t2")
        t3 = _create_test("u-t3")
        s_a = _create_suite("u-a", [t1, t2])
        s_b = _create_suite("u-b", [t3])
        reg_id = _create_regression("unique-reg", [s_a, s_b])

        assert regression_service.get_regression_duplicate_tests(reg_id) == {}

    def test_returns_shared_test_across_two_suites(self) -> None:
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import _storage as _suite_storage

        _suite_storage._clear_storage()
        clear_regression_storage()

        t_shared = _create_test("shared-1")
        t_only_b = _create_test("only-b")
        s_a = _create_suite("a", [t_shared])
        s_b = _create_suite("b", [t_shared, t_only_b])
        reg_id = _create_regression("dup-reg", [s_a, s_b])

        result = regression_service.get_regression_duplicate_tests(reg_id)

        assert result == {t_shared: [s_a, s_b]}

    def test_preserves_regression_suite_order_in_result(self) -> None:
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import _storage as _suite_storage

        _suite_storage._clear_storage()
        clear_regression_storage()

        t_shared = _create_test("ordered-1")
        s_x = _create_suite("x", [t_shared])
        s_y = _create_suite("y", [t_shared])
        s_z = _create_suite("z", [t_shared])

        # Regression references suites in a non-alphabetical order.
        reg_id = _create_regression("ordered-reg", [s_z, s_x, s_y])

        result = regression_service.get_regression_duplicate_tests(reg_id)

        # List must reflect the regression's declared suite order, not id sort.
        assert result == {t_shared: [s_z, s_x, s_y]}

    def test_returns_multiple_shared_tests(self) -> None:
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import _storage as _suite_storage

        _suite_storage._clear_storage()
        clear_regression_storage()

        t_a = _create_test("multi-a")
        t_b = _create_test("multi-b")
        t_unique = _create_test("multi-unique")
        s_1 = _create_suite("m1", [t_a, t_b])
        s_2 = _create_suite("m2", [t_a, t_b, t_unique])
        reg_id = _create_regression("multi-reg", [s_1, s_2])

        result = regression_service.get_regression_duplicate_tests(reg_id)

        assert result == {t_a: [s_1, s_2], t_b: [s_1, s_2]}

    def test_skips_member_suite_that_no_longer_exists(self) -> None:
        """The helper must tolerate a regression that references a suite id
        which has been deleted - the missing suite contributes nothing to
        the duplicate map and is simply skipped."""
        from unittest.mock import patch

        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import _storage as _suite_storage
        from wavecore.api.services.suites import service as suite_service

        _suite_storage._clear_storage()
        clear_regression_storage()

        t_shared = _create_test("miss-shared")
        s_a = _create_suite("miss-a", [t_shared])
        s_b = _create_suite("miss-b", [t_shared])
        reg_id = _create_regression("miss-reg", [s_a, s_b])

        real_get_suite = suite_service.get_suite

        def _drop_s_a(sid: str) -> Any:
            if sid == s_a:
                return None
            return real_get_suite(sid)

        with patch.object(suite_service, "get_suite", side_effect=_drop_s_a):
            result = regression_service.get_regression_duplicate_tests(reg_id)

        # The shared test is only resolvable in s_b now, so no duplicate.
        assert result == {}

    def test_returns_empty_for_missing_regression(self) -> None:
        import uuid

        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import _storage as _suite_storage

        _suite_storage._clear_storage()
        clear_regression_storage()

        result = regression_service.get_regression_duplicate_tests(str(uuid.uuid4()))
        assert result == {}

    def test_duplicate_map_included_in_get_regression_response(self) -> None:
        """The duplicate map is exposed on the regression detail response so
        the frontend can render badges without a second round-trip."""
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import _storage as _suite_storage

        _suite_storage._clear_storage()
        clear_regression_storage()

        t_shared = _create_test("api-shared")
        s_a = _create_suite("api-a", [t_shared])
        s_b = _create_suite("api-b", [t_shared])
        reg_id = _create_regression("api-reg", [s_a, s_b])

        detail: Any = regression_service.get_regression(reg_id)
        assert detail is not None
        assert detail.get("duplicate_tests") == {t_shared: [s_a, s_b]}
