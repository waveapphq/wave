"""Unit tests for unversioned report artifacts (REQ-3.7.2.1).

Reports are single-instance and immutable per execution: they are written as
plain ``report.json`` / ``report.html`` (never ``report.vN.*``). Regeneration is
the explicit delete-then-write flow the Report Viewer owns, so re-writing the
same format overwrites in place. ``_find_latest_report`` is a plain existence
check for the unversioned name.
"""

import json
from pathlib import Path
from unittest.mock import patch

from wavecore.api.services.reports import service as reports_service

_REPORT = {"summary": {"total": 1, "passed": 1}}


class TestUnversionedReportWrite:
    """_write_report produces plain report.json / report.html."""

    def test_json_report_is_unversioned(self, tmp_path: Path) -> None:
        path = reports_service._write_report(tmp_path, "json", _REPORT)

        assert path == tmp_path / "report.json"
        assert json.loads(path.read_text()) == _REPORT
        assert not list(tmp_path.glob("report.v*.json"))

    def test_html_report_is_unversioned(self, tmp_path: Path) -> None:
        with patch.object(
            reports_service.report_html, "render_report_html", return_value="<html>ok</html>"
        ):
            path = reports_service._write_report(tmp_path, "html", _REPORT)

        assert path == tmp_path / "report.html"
        assert path.read_text() == "<html>ok</html>"
        assert not list(tmp_path.glob("report.v*.html"))

    def test_rewrite_overwrites_in_place(self, tmp_path: Path) -> None:
        reports_service._write_report(tmp_path, "json", {"summary": {"total": 1}})
        path = reports_service._write_report(tmp_path, "json", {"summary": {"total": 2}})

        assert path == tmp_path / "report.json"
        assert json.loads(path.read_text()) == {"summary": {"total": 2}}
        assert list(tmp_path.glob("report*.json")) == [tmp_path / "report.json"]


class TestFindLatestReportUnversioned:
    """_find_latest_report resolves the plain unversioned name."""

    def test_resolves_unversioned_json(self, tmp_path: Path) -> None:
        (tmp_path / "report.json").write_text("{}")

        assert reports_service._find_latest_report(tmp_path, "json") == tmp_path / "report.json"

    def test_resolves_unversioned_html(self, tmp_path: Path) -> None:
        (tmp_path / "report.html").write_text("<html></html>")

        assert reports_service._find_latest_report(tmp_path, "html") == tmp_path / "report.html"

    def test_returns_none_when_absent(self, tmp_path: Path) -> None:
        assert reports_service._find_latest_report(tmp_path, "json") is None

    def test_ignores_other_formats(self, tmp_path: Path) -> None:
        (tmp_path / "report.json").write_text("{}")

        assert reports_service._find_latest_report(tmp_path, "html") is None
