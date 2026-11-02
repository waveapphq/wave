"""Unit tests for the self-contained HTML report renderer (REQ-3.7.2.1,
REQ-3.7.2.6, REQ-3.7.2.8).

Models are fabricated in the canonical report shape; the rendered document
must structurally match the canonical report wireframes.
"""

import re
from typing import Any

import pytest

SUITE_EXEC_ID = "f3b9c1e2-7a41-4c2e-b5d6-0a1f9e238842"
LEVELS = ["DEBUG", "INFO", "WARN", "ERROR", "FATAL"]


def render(report: dict[str, Any]) -> str:
    from wavecore.api.services.reports import html as report_html

    return report_html.render_report_html(report)


def card_value(html: str, label: str) -> int:
    """Number rendered on the summary card carrying the given label."""
    match = re.search(rf'<div class="rpt-num">(\d+)</div><div class="rpt-lbl">{label}</div>', html)
    assert match is not None, f"no summary card labeled '{label}'"
    return int(match.group(1))


def card_labels(html: str) -> list[str]:
    """Summary card labels in render order."""
    return re.findall(r'<div class="rpt-lbl">([^<]+)</div>', html)


def make_run(
    order: int,
    name: str,
    status: str = "passed",
    *,
    suite_id: str = "suite-1",
    suite_name: str = "Nightly API Suite",
    duration: float = 4.2,
) -> dict[str, Any]:
    return {
        "order": order,
        "run_id": f"run-{order}",
        "test_id": f"test-{order}",
        "test_name": name,
        "suite_id": suite_id,
        "suite_name": suite_name,
        "status": status,
        "started_at": f"2026-06-10T11:06:5{order}.610Z",
        "ended_at": f"2026-06-10T11:06:5{order}.910Z",
        "duration": duration,
        "variables": {},
    }


def make_log(
    level: str,
    message: str,
    *,
    source: str = "SYSTEM",
    block_id: str | None = None,
    variant: str | None = None,
    seq: int = 0,
    scope_kind: str = "test",
) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "seq": seq,
        "timestamp": "2026-06-10T11:06:52.610Z",
        "level": level,
        "message": message,
        "source": source,
        "blockId": block_id,
        "scope_kind": scope_kind,
        "run_id": "run-1",
    }
    if variant is not None:
        entry["variant"] = variant
    return entry


def make_error(
    level: str = "ERROR",
    *,
    message: str = "Downstream validation rejected payload",
    test_name: str | None = "Inventory Sync Validation",
    suite_name: str | None = "Nightly API Suite",
    block_path: str | None = "Validate_Stock_Levels",
) -> dict[str, Any]:
    return {
        "run_id": "run-3",
        "test_id": "test-3",
        "test_name": test_name,
        "suite_name": suite_name,
        "block_path": block_path,
        "level": level,
        "message": message,
        "timestamp": "2026-06-10T11:07:07.391Z",
    }


def default_logs() -> list[dict[str, Any]]:
    return [
        make_log(
            "INFO",
            "Suite 'Nightly API Suite' execution started",
            variant="suite-banner",
            scope_kind="suite",
            seq=0,
        ),
        make_log(
            "DEBUG", "Polled 240 messages from orders.events", source="Kafka : Consume", seq=1
        ),
        make_log("WARN", "Retrying request after transient timeout", source="Http : Submit", seq=2),
        make_log("ERROR", "Downstream validation rejected payload", source="Assert : Check", seq=3),
        make_log(
            "FATAL", "Reconciliation aborted: totals mismatch", source="Assert : Totals", seq=4
        ),
    ]


def make_suite_report(**overrides: Any) -> dict[str, Any]:
    report: dict[str, Any] = {
        "schema_version": 1,
        "generated_at": "2026-06-10T18:07:14+00:00",
        "execution": {
            "id": SUITE_EXEC_ID,
            "name": "Nightly API Suite",
            "entity_type": "suite",
            "entity_id": "suite-1",
            "environment": "Local",
            "triggered_by": "wparker",
            "status": "failed",
            "started_at": "2026-06-10T11:06:52.604Z",
            "ended_at": "2026-06-10T11:07:13.401Z",
            "duration": 20.8,
        },
        "summary": {
            "status": "failed",
            "duration": 20.8,
            "counts": {
                "total": 4,
                "passed": 2,
                "failed": 2,
                "skipped": 0,
                "stopped": 0,
                "excluded": 0,
                "pending": 0,
            },
        },
        "timeline": {
            "runs": [
                make_run(1, "Auth Token Refresh"),
                make_run(2, "Order Pipeline Smoke"),
                make_run(3, "Inventory Sync Validation", "failed"),
                make_run(4, "Payment Reconciliation", "failed"),
            ],
            "blocks": [],
        },
        "errors": [
            make_error("ERROR"),
            make_error(
                "FATAL",
                message="Reconciliation aborted: totals mismatch",
                test_name="Payment Reconciliation",
                block_path="Reconcile_Totals",
            ),
        ],
        "logs": default_logs(),
    }
    report.update(overrides)
    return report


def make_block(
    order: int,
    block_id: str,
    block_path: str,
    status: str = "passed",
    *,
    duration: float | None = 0.4,
) -> dict[str, Any]:
    timing = duration is not None
    return {
        "order": order,
        "block_id": block_id,
        "block_path": block_path,
        "status": status,
        "started_at": f"2026-06-10T11:06:5{order}.000Z" if timing else None,
        "ended_at": f"2026-06-10T11:06:5{order}.400Z" if timing else None,
        "duration": duration,
    }


def make_test_report(**overrides: Any) -> dict[str, Any]:
    report = make_suite_report()
    report["execution"] = {
        **report["execution"],
        "name": "Inventory Sync Validation",
        "entity_type": "test",
        "entity_id": "test-1",
    }
    report["summary"]["counts"] = {
        "total": 1,
        "passed": 1,
        "failed": 0,
        "skipped": 0,
        "stopped": 0,
        "excluded": 0,
        "pending": 0,
    }
    report["timeline"] = {
        "runs": [make_run(1, "Inventory Sync Validation", suite_id="", suite_name="")],
        "blocks": [
            make_block(1, "node-init", "Init_Session"),
            make_block(2, "node-loop", "Poll_Sync_Status"),
            make_block(3, "node-fetch", "Poll_Sync_Status / Fetch_Status"),
            make_block(4, "node-unrun", "Cleanup_Tmp", "pending", duration=None),
            make_block(5, "node-final", "Log_Summary"),
            make_block(6, "node-bare", "Archive_Tmp", "skipped", duration=None),
        ],
    }
    report["errors"] = []
    report.update(overrides)
    return report


def make_regression_report(**overrides: Any) -> dict[str, Any]:
    report = make_suite_report()
    report["execution"] = {
        **report["execution"],
        "name": "Quarterly Regression",
        "entity_type": "regression",
        "entity_id": "regression-1",
    }
    report["timeline"] = {
        "runs": [
            make_run(1, "Auth Token Refresh"),
            make_run(2, "Order Pipeline Smoke"),
            make_run(
                3,
                "Cluster Failover Recovery",
                suite_id="suite-2",
                suite_name="Platform Health Suite",
            ),
        ],
        "blocks": [],
    }
    report["errors"] = [make_error("ERROR")]
    report.update(overrides)
    return report


def make_session_report(**overrides: Any) -> dict[str, Any]:
    report = make_test_report()
    del report["execution"]
    report["session"] = {
        "session_id": "11111111-2222-3333-4444-555555555555",
        "test_id": "test-1",
        "test_name": "Scratch Inventory Test",
        "environment_id": "env-1",
        "status": "passed",
        "started_at": "2026-06-10T11:06:52+00:00",
    }
    session_logs: list[dict[str, Any]] = []
    for entry in default_logs():
        entry["sequence"] = entry.pop("seq")
        session_logs.append(entry)
    report["logs"] = session_logs
    report.update(overrides)
    return report


class TestSelfContainment:
    """Inline CSS/JS only, zero external references."""

    def test_document_has_no_external_references(self) -> None:
        html = render(make_suite_report())

        assert "<link" not in html
        assert "<script src" not in html
        assert 'src="http' not in html
        assert 'href="http' not in html
        assert "@import" not in html

    def test_document_inlines_styles_and_behavior(self) -> None:
        html = render(make_suite_report())

        assert html.lstrip().lower().startswith("<!doctype html")
        assert "<style" in html
        assert "<script>" in html


class TestHeader:
    """Brand row, title row, theme switch, meta grid."""

    def test_brand_row_with_status_and_doctype(self) -> None:
        html = render(make_suite_report())

        assert "WAVE" in html
        assert "Execution Report" in html
        assert "rpt-status-failed" in html
        assert ">Failed<" in html

    def test_theme_switch_defaults_to_system_preference(self) -> None:
        html = render(make_suite_report())

        assert 'id="rpt-theme"' in html
        assert "prefers-color-scheme" in html
        assert "matchMedia" in html

    def test_title_row_carries_entity_icon_name_and_chip(self) -> None:
        html = render(make_suite_report())

        assert re.search(r"<svg[\s\S]*?<h1", html)
        assert "Nightly API Suite" in html
        assert re.search(r"rpt-entitychip[^>]*>Suite<", html)

    def test_entity_chip_variants(self) -> None:
        assert re.search(r"rpt-entitychip[^>]*>Test<", render(make_test_report()))
        assert re.search(r"rpt-entitychip[^>]*>Regression<", render(make_regression_report()))

    def test_meta_grid_fields(self) -> None:
        html = render(make_suite_report())

        for label in (
            "Environment",
            "Triggered by",
            "Started",
            "Duration",
            "Execution ID",
            "Ended",
        ):
            assert label in html
        assert SUITE_EXEC_ID in html
        assert "Local" in html
        assert "wparker" in html

    def test_meta_grid_omits_generated_at_and_report_version(self) -> None:
        html = render(make_suite_report())

        assert "Generated" not in html
        assert "Report v" not in html


class TestResultsCards:
    """Test counts for suite/regression, block counts for test reports."""

    def test_suite_renders_seven_test_cards(self) -> None:
        html = render(make_suite_report())

        assert "Test Results" in html
        for label in ("Tests", "Passed", "Failed", "Skipped", "Stopped", "Excluded", "Pending"):
            assert label in html
        assert "Block Results" not in html
        assert "Not Run" not in html

    def test_regression_renders_test_cards(self) -> None:
        html = render(make_regression_report())

        assert "Test Results" in html
        assert "Block Results" not in html

    def test_test_report_renders_six_block_cards(self) -> None:
        html = render(make_test_report())

        assert "Block Results" in html
        assert "Test Results" not in html

    def test_test_report_has_no_not_run_card(self) -> None:
        html = render(make_test_report())

        assert "Not Run" not in html

    def test_block_cards_run_in_severity_order(self) -> None:
        html = render(make_test_report())

        assert card_labels(html) == [
            "Total",
            "Passed",
            "Failed",
            "Warning",
            "Skipped",
            "Stopped",
        ]

    def test_card_counts_come_from_summary(self) -> None:
        html = render(make_suite_report())

        assert ">4<" in html

    def test_block_total_counts_only_the_steps_that_ran(self) -> None:
        html = render(make_test_report())

        assert card_value(html, "Total") == 5
        assert card_value(html, "Passed") == 4
        assert card_value(html, "Skipped") == 1

    def test_never_reached_steps_are_left_out_of_the_total(self) -> None:
        report = make_test_report()
        report["timeline"]["blocks"] = [
            make_block(1, "node-warn", "Assert_Totals", "warning"),
            make_block(2, "node-live", "Http_Submit", "running"),
            make_block(3, "node-unrun", "Cleanup_Tmp", "pending", duration=None),
        ]

        html = render(report)

        assert card_value(html, "Total") == 2

    def test_a_failing_bare_assert_is_counted_as_a_warning(self) -> None:
        report = make_test_report()
        report["timeline"]["blocks"] = [
            make_block(1, "node-init", "Init_Session"),
            make_block(2, "node-assert", "Assert_Totals", "warning"),
            make_block(3, "node-final", "Log_Summary"),
        ]

        html = render(report)

        assert card_value(html, "Total") == 3
        assert card_value(html, "Passed") == 2
        assert card_value(html, "Warning") == 1

    def test_the_warning_card_is_amber_like_the_viewer(self) -> None:
        """The exported document and the in-app report show the same color."""
        report = make_test_report()
        report["timeline"]["blocks"] = [make_block(1, "node-warn", "Assert_Totals", "warning")]

        html = render(report)

        assert (
            '<div class="rpt-card rpt-card-warn"><div class="rpt-num">1</div>'
            '<div class="rpt-lbl">Warning</div></div>' in html
        )
        assert ".rpt-card-warn .rpt-num { color: var(--rpt-warn); }" in html

    def test_an_empty_warning_card_is_gray_like_the_viewer(self) -> None:
        """Nothing to warn about reads gray, the way the other outcome cards do."""
        report = make_test_report()
        report["timeline"]["blocks"] = [make_block(1, "node-init", "Init_Session")]

        html = render(report)

        assert (
            '<div class="rpt-card rpt-card-muted"><div class="rpt-num">0</div>'
            '<div class="rpt-lbl">Warning</div></div>' in html
        )

    def test_a_step_left_running_is_counted_as_stopped(self) -> None:
        report = make_test_report()
        report["timeline"]["blocks"] = [make_block(1, "node-live", "Http_Submit", "running")]

        html = render(report)

        assert card_value(html, "Stopped") == 1


BLOCK_MIXES: list[list[str]] = [
    [],
    ["passed"],
    ["pending"],
    ["passed", "failed", "warning", "skipped", "stopped", "running", "pending"],
    ["warning", "warning", "running"],
    ["running", "pending", "pending"],
    ["passed", "some-token-nobody-has-invented-yet"],
]

OUTCOME_LABELS = ("Passed", "Failed", "Warning", "Skipped", "Stopped")

RECORDED_STATUSES = ("passed", "failed", "warning", "skipped", "stopped", "running")


def _report_with(statuses: list[str]) -> dict[str, Any]:
    report = make_test_report()
    report["timeline"]["blocks"] = [
        make_block(order, f"node-{order}", f"Step_{order}", status)
        for order, status in enumerate(statuses, start=1)
    ]
    return report


class TestBlockCardInvariant:
    """Total, the sum of the outcome cards, and the number of rows in the step
    list are three names for one number. Any pair drifting is a defect."""

    @pytest.mark.parametrize("statuses", BLOCK_MIXES)
    def test_cards_account_for_every_listed_step(self, statuses: list[str]) -> None:
        html = render(_report_with(statuses))

        listed = html.count('<td class="rpt-ordercol rpt-mono">')
        assert sum(card_value(html, label) for label in OUTCOME_LABELS) == listed

    @pytest.mark.parametrize("statuses", BLOCK_MIXES)
    def test_total_equals_the_sum_of_the_outcome_cards(self, statuses: list[str]) -> None:
        html = render(_report_with(statuses))

        assert card_value(html, "Total") == sum(card_value(html, label) for label in OUTCOME_LABELS)

    @pytest.mark.parametrize("statuses", BLOCK_MIXES)
    def test_total_equals_the_listed_row_count(self, statuses: list[str]) -> None:
        html = render(_report_with(statuses))

        assert card_value(html, "Total") == html.count('<td class="rpt-ordercol rpt-mono">')

    @pytest.mark.parametrize("status", RECORDED_STATUSES)
    def test_each_recorded_outcome_lands_in_exactly_one_card(self, status: str) -> None:
        html = render(_report_with([status]))

        assert sum(card_value(html, label) for label in OUTCOME_LABELS) == 1

    def test_unreached_steps_are_absent_from_the_total_and_every_outcome_card(self) -> None:
        html = render(_report_with(["passed", "pending", "pending"]))

        assert card_value(html, "Total") == 1
        assert sum(card_value(html, label) for label in OUTCOME_LABELS) == 1


class TestTimelineTable:
    """Order column, status, suite grouping for regressions."""

    def test_suite_table_has_single_header_and_ordered_rows(self) -> None:
        html = render(make_suite_report())

        assert html.count("#</th>") == 1
        assert "rpt-suite-row" not in html
        assert "Auth Token Refresh" in html
        assert "Payment Reconciliation" in html

    def test_regression_table_groups_rows_per_suite(self) -> None:
        html = render(make_regression_report())

        assert html.count('class="rpt-suite-row"') == 2
        assert html.count("#</th>") == 2
        assert "Platform Health Suite" in html

    def test_test_table_shows_nested_block_paths(self) -> None:
        html = render(make_test_report())

        assert "Poll_Sync_Status / Fetch_Status" in html
        assert html.count("#</th>") == 1

    def test_suite_run_row_still_renders_pending(self) -> None:
        report = make_suite_report()
        report["timeline"]["runs"] = [make_run(1, "Quota Enforcement Sweep", "pending")]

        html = render(report)

        assert "rpt-status-pending" in html
        assert ">Pending<" in html


class TestNeverReachedSteps:
    """A test report's step list carries only steps with a recorded outcome;
    never-reached steps stay in the counts and out of the list."""

    def test_step_list_never_says_pending(self) -> None:
        html = render(make_test_report())

        assert "Pending" not in html

    def test_never_reached_step_is_not_listed(self) -> None:
        html = render(make_test_report())

        assert "Cleanup_Tmp" not in html

    def test_deliberately_skipped_step_stays_listed(self) -> None:
        html = render(make_test_report())

        assert "Archive_Tmp" in html
        assert '<span class="rpt-status rpt-status-skipped">' in html

    def test_warning_step_carries_the_warn_status_color(self) -> None:
        report = make_test_report()
        report["timeline"]["blocks"] = [make_block(1, "node-warn", "Assert_Totals", "warning")]

        html = render(report)

        assert '<span class="rpt-status rpt-status-warning">' in html
        assert ".rpt-status-warning { color: var(--rpt-warn); }" in html
        assert ".rpt-status-warning .rpt-dot { background: var(--rpt-warn); }" in html

    def test_warning_step_bar_is_filled(self) -> None:
        report = make_test_report()
        report["timeline"]["blocks"] = [make_block(1, "node-warn", "Assert_Totals", "warning")]

        html = render(report)

        assert "rpt-gantt-fill rpt-gantt-fill-warning" in html
        assert ".rpt-gantt-fill-warning { background: var(--rpt-warn);" in html

    def test_warning_and_running_steps_stay_listed(self) -> None:
        report = make_test_report()
        report["timeline"]["blocks"] = [
            make_block(1, "node-warn", "Assert_Totals", "warning"),
            make_block(2, "node-live", "Http_Submit", "running"),
            make_block(3, "node-unrun", "Cleanup_Tmp", "pending", duration=None),
        ]

        html = render(report)

        assert "Assert_Totals" in html
        assert "Http_Submit" in html
        assert "Cleanup_Tmp" not in html

    def test_row_numbering_is_contiguous_over_the_listed_rows(self) -> None:
        html = render(make_test_report())

        assert re.findall(r'<td class="rpt-ordercol rpt-mono">(\d+)</td>', html) == [
            "1",
            "2",
            "3",
            "4",
            "5",
        ]

    def test_chart_shows_exactly_the_rows_the_table_shows(self) -> None:
        html = render(make_test_report())

        assert html.count('<td class="rpt-ordercol rpt-mono">') == 5
        assert html.count('rpt-gantt-label">') == 5

    def test_a_run_with_no_recorded_step_lists_nothing(self) -> None:
        report = make_test_report()
        report["timeline"]["blocks"] = [
            make_block(1, "node-unrun", "Cleanup_Tmp", "pending", duration=None)
        ]

        html = render(report)

        assert "Cleanup_Tmp" not in html
        assert card_value(html, "Total") == 0


class TestTimelineChart:
    """Collapsible gantt with order labels and per-suite sections."""

    def test_chart_is_a_collapsible_details_section(self) -> None:
        html = render(make_suite_report())

        assert "Timeline Chart" in html
        assert re.search(r"<details[^>]*rpt-chart", html)

    def test_chart_label_column_uses_order_numbers(self) -> None:
        html = render(make_suite_report())

        assert re.search(r"rpt-gantt-collbl[^>]*>Test<", html)
        assert html.count('rpt-gantt-label">') == 4
        assert re.search(r"rpt-gantt-label[^>]*>1<", html)

    def test_test_report_chart_label_column_is_block(self) -> None:
        html = render(make_test_report())

        assert re.search(r"rpt-gantt-collbl[^>]*>Block<", html)

    def test_bars_are_status_colored_with_hover_tooltips(self) -> None:
        html = render(make_suite_report())

        assert "rpt-gantt-fill-passed" in html
        assert "rpt-gantt-fill-failed" in html
        assert re.search(r"rpt-gantt-tip[^>]*>[^<]*Auth Token Refresh", html)

    def test_regression_chart_has_per_suite_sections_with_own_axes(self) -> None:
        html = render(make_regression_report())

        assert html.count('rpt-gantt-suite">') == 2
        assert html.count('rpt-gantt-axis">') == 2

    def test_suite_chart_has_single_axis(self) -> None:
        html = render(make_suite_report())

        assert html.count('rpt-gantt-axis">') == 1

    def test_small_report_chart_defaults_expanded(self) -> None:
        html = render(make_suite_report())

        assert re.search(r"<details[^>]*rpt-chart[^>]*\bopen\b", html)

    def test_zero_span_window_renders_full_width_bar(self) -> None:
        block = make_block(1, "node-x", "Single_Instant")
        block["ended_at"] = block["started_at"]
        report = make_test_report()
        report["timeline"]["blocks"] = [block]

        html = render(report)

        assert 'style="left:0.0%;width:100.0%"' in html

    def test_large_report_chart_defaults_collapsed(self) -> None:
        runs = [make_run(i, f"Test {i}") for i in range(1, 26)]
        report = make_suite_report()
        report["timeline"]["runs"] = runs

        html = render(report)

        assert not re.search(r"<details[^>]*rpt-chart[^>]*\bopen\b", html)


class TestErrorsSection:
    """Level badge, scope path, timestamp, message, empty state."""

    def test_error_cards_with_badges_and_scope_paths(self) -> None:
        html = render(make_suite_report())

        assert "2 errors" in html
        assert "rpt-lvl-error" in html
        assert "rpt-lvl-fatal" in html
        assert "Inventory Sync Validation / Validate_Stock_Levels" in html
        assert "Downstream validation rejected payload" in html

    def test_regression_error_path_includes_suite_segment(self) -> None:
        html = render(make_regression_report())

        assert "Nightly API Suite / Inventory Sync Validation / Validate_Stock_Levels" in html

    def test_scope_error_without_identity_falls_back_to_document_name(self) -> None:
        report = make_suite_report(errors=[make_error(test_name=None, block_path=None)])

        html = render(report)

        assert '<span class="rpt-errorpath">Nightly API Suite</span>' in html

    def test_no_errors_renders_explicit_empty_state(self) -> None:
        html = render(make_test_report())

        assert "No errors" in html
        assert "rpt-lvl-fatal" not in html

    def test_error_cards_do_not_embed_log_context(self) -> None:
        report = make_suite_report()
        report["logs"] = []

        html = render(report)

        assert "Polled 240 messages" not in html


class TestLogTable:
    """REQ-3.7.2.6/3.7.2.7: columnar logs, levels, no truncation."""

    def test_log_table_headers(self) -> None:
        html = render(make_suite_report())

        for header in ("Time</th>", "Level</th>", "Source</th>", "Message</th>"):
            assert header in html

    def test_every_row_carries_its_data_level(self) -> None:
        html = render(make_suite_report())

        for level in LEVELS:
            assert f'data-level="{level}"' in html
        assert html.count('data-level="') == 5

    def test_banner_and_fatal_rows_get_distinct_classes(self) -> None:
        html = render(make_suite_report())

        assert "rpt-row-banner" in html
        assert "rpt-row-FATAL" in html

    def test_source_column_wraps_at_30ch(self) -> None:
        html = render(make_suite_report())

        assert "30ch" in html

    def test_messages_are_not_truncated(self) -> None:
        long_message = "x" * 5000
        report = make_suite_report(logs=[make_log("INFO", long_message)])

        html = render(report)

        assert long_message in html

    def test_no_blank_rows_between_entries(self) -> None:
        report = make_suite_report(
            logs=[
                make_log("INFO", "first line"),
                make_log("INFO", "between\n\nblank"),
                make_log("INFO", "last line"),
            ]
        )

        html = render(report)

        assert html.count('data-level="') == 3


class TestLogControls:
    """REQ-3.7.2.8: in-document level filter and column selector."""

    def test_level_filter_lists_levels_in_severity_order(self) -> None:
        html = render(make_suite_report())

        assert re.search(
            r'<select[^>]*id="rpt-level"[\s\S]*?DEBUG[\s\S]*?INFO[\s\S]*?WARN'
            r"[\s\S]*?ERROR[\s\S]*?FATAL[\s\S]*?</select>",
            html,
        )

    def test_live_entry_count(self) -> None:
        html = render(make_suite_report())

        assert 'id="rpt-logcount"' in html
        assert "5 entries" in html

    def test_column_selector_toggles_time_level_source(self) -> None:
        html = render(make_suite_report())

        assert "Columns" in html
        for col in ("ts", "lvl", "src"):
            assert f'data-col="{col}"' in html


class TestEscaping:
    """Security: all dynamic content escaped during rendering."""

    def test_log_message_html_is_escaped(self) -> None:
        report = make_suite_report(logs=[make_log("INFO", '<script>alert("xss")</script>')])

        html = render(report)

        assert "&lt;script&gt;" in html
        assert "<script>alert" not in html

    def test_entity_name_html_is_escaped(self) -> None:
        report = make_suite_report()
        report["execution"]["name"] = "Suite <b>name</b> & co"

        html = render(report)

        assert "<b>name</b>" not in html
        assert "Suite &lt;b&gt;name&lt;/b&gt; &amp; co" in html

    def test_error_message_html_is_escaped(self) -> None:
        report = make_suite_report(errors=[make_error(message="<img src=x onerror=alert(1)>")])

        html = render(report)

        assert "<img" not in html
        assert "&lt;img" in html


class TestEmptyAndSessionVariants:
    """Empty-section rendering and the workbench session document."""

    def test_empty_report_renders_all_sections(self) -> None:
        report = make_suite_report(
            timeline={"runs": [], "blocks": []},
            errors=[],
            logs=[],
        )

        html = render(report)

        for heading in ("Execution Report", "Test Results", "Timeline", "Errors", "Logs"):
            assert heading in html
        assert "No errors" in html
        assert "0 entries" in html

    def test_session_report_renders_as_test_document(self) -> None:
        html = render(make_session_report())

        assert "Scratch Inventory Test" in html
        assert re.search(r"rpt-entitychip[^>]*>Test<", html)
        assert "Block Results" in html
        assert "11111111-2222-3333-4444-555555555555" in html
