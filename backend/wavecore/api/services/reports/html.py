"""Self-contained HTML report renderer (REQ-3.7.2.1, REQ-3.7.2.6, REQ-3.7.2.8).

Renders the canonical report model into a single standalone document with
inline CSS and vanilla JS only. Structure mirrors the canonical report
wireframes.
"""

from datetime import datetime
from html import escape
from itertools import groupby
from typing import Any

from wavecore.api.services.log_streaming_service import LOG_LEVEL_HIERARCHY

# Charts with more rows than this default to collapsed.
CHART_COLLAPSE_THRESHOLD = 20

# Block outcome cards in severity order; they cover the blocks that ran, and
# their sum is the Total card. A block still painted "running" when the report
# is written stopped without cleanup, which is where the engine puts it.
_BLOCK_TILES: tuple[tuple[str, str, frozenset[str]], ...] = (
    ("Passed", "passed", frozenset({"passed"})),
    ("Failed", "failed", frozenset({"failed"})),
    ("Warning", "warn", frozenset({"warning"})),
    ("Skipped", "muted", frozenset({"skipped"})),
    ("Stopped", "muted", frozenset({"stopped", "running"})),
)

# A block the run reached carries one of these; anything else never ran.
_RECORDED_BLOCK_STATUSES = frozenset().union(*(statuses for _, _, statuses in _BLOCK_TILES))

_LOG_LEVELS = sorted(LOG_LEVEL_HIERARCHY, key=lambda level: LOG_LEVEL_HIERARCHY[level])

_ICON_SUITE = (
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2'
    'A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>'
    '<path d="M8 10v4"/><path d="M12 10v2"/><path d="M16 10v6"/></svg>'
)

_ICON_TEST = (
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    '<path d="M21 7 6.82 21.18a2.83 2.83 0 0 1-3.99-.01v0a2.83 2.83 0 0 1 0-4L17 3"/>'
    '<path d="m16 2 6 6"/><path d="M12 16H4"/></svg>'
)

_ICON_REGRESSION = (
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/>'
    '<circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>'
)

_ICON_MOON = (
    '<svg class="rpt-ic-moon" width="15" height="15" viewBox="0 0 24 24" fill="none" '
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>'
)

_ICON_SUN = (
    '<svg class="rpt-ic-sun" width="15" height="15" viewBox="0 0 24 24" fill="none" '
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/>'
    '<path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/>'
    '<path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>'
)

_ENTITY_META = {
    "test": {"chip": "Test", "color": "var(--rpt-test)", "icon": _ICON_TEST},
    "suite": {"chip": "Suite", "color": "var(--rpt-suite)", "icon": _ICON_SUITE},
    "regression": {
        "chip": "Regression",
        "color": "var(--rpt-regression)",
        "icon": _ICON_REGRESSION,
    },
}

_REGRESSION_CSS = """
  .rpt-suite-row td {
    background: var(--rpt-bg-subtle); font-weight: 700; font-size: 12px;
    text-transform: uppercase; letter-spacing: 0.04em; color: var(--rpt-text-secondary);
  }
  .rpt-gantt-suite {
    font-size: 12px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.04em; color: var(--rpt-text-secondary); margin: 16px 0 8px;
  }
  .rpt-gantt-suite:first-child { margin-top: 4px; }
"""

_ERROR_BADGE_CSS = """
  .rpt-lvl-error { color: var(--rpt-error); background: var(--rpt-error-bg); }
  .rpt-lvl-fatal {
    color: var(--rpt-fatal); background: var(--rpt-error-bg);
    outline: 1px solid var(--rpt-error);
  }
"""

_BASE_CSS = """
  :root {
    --rpt-bg: #FFFFFF;
    --rpt-bg-subtle: #F4F4F3;
    --rpt-text: #0C0A09;
    --rpt-text-secondary: #44403C;
    --rpt-muted: #78716C;
    --rpt-border: #E7E5E4;
    --rpt-border-strong: #D6D3D1;
    --rpt-accent: #2563EB;
    --rpt-success: #166534;
    --rpt-success-dot: #22C55E;
    --rpt-success-bg: #DCFCE7;
    --rpt-error: #DC2626;
    --rpt-error-bg: #FEE2E2;
    --rpt-warn: #B45309;
    --rpt-info: #155E75;
    --rpt-debug: #78716C;
    --rpt-fatal: #991B1B;
    --rpt-suite: #F59E0B;
    --rpt-test: #16A34A;
    --rpt-regression: #8B5CF6;
    --rpt-tip-bg: #0C0A09;
    --rpt-tip-text: #FAFAF9;
  }
  html.dark {
    --rpt-bg: #0C0A09;
    --rpt-bg-subtle: #1C1917;
    --rpt-text: #FAFAF9;
    --rpt-text-secondary: #D6D3D1;
    --rpt-muted: #A8A29E;
    --rpt-border: #292524;
    --rpt-border-strong: #44403C;
    --rpt-accent: #3B82F6;
    --rpt-success: #4ADE80;
    --rpt-success-dot: #22C55E;
    --rpt-success-bg: #052E16;
    --rpt-error: #F87171;
    --rpt-error-bg: #450A0A;
    --rpt-warn: #FBBF24;
    --rpt-info: #22D3EE;
    --rpt-debug: #A8A29E;
    --rpt-fatal: #F87171;
    --rpt-suite: #F59E0B;
    --rpt-test: #4ADE80;
    --rpt-regression: #A78BFA;
    --rpt-tip-bg: #FAFAF9;
    --rpt-tip-text: #0C0A09;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--rpt-bg);
    color: var(--rpt-text);
    font-family: "Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 14px;
    line-height: 1.5;
  }
  .rpt-page { max-width: 1080px; margin: 0 auto; padding: 32px 40px 64px; }

  .rpt-brandrow {
    display: flex; align-items: center; justify-content: space-between;
    padding-bottom: 16px; border-bottom: 1px solid var(--rpt-border);
  }
  .rpt-brandright { display: flex; align-items: center; gap: 14px; }
  .rpt-themebtn {
    background: none; border: 1px solid var(--rpt-border-strong); border-radius: 8px;
    padding: 4px 6px; color: var(--rpt-muted); cursor: pointer;
    display: inline-flex; align-items: center;
  }
  .rpt-themebtn:hover { color: var(--rpt-text-secondary); background: var(--rpt-bg-subtle); }
  .rpt-themebtn .rpt-ic-sun { display: none; }
  html.dark .rpt-themebtn .rpt-ic-sun { display: block; }
  html.dark .rpt-themebtn .rpt-ic-moon { display: none; }
  .rpt-brand { display: flex; align-items: baseline; gap: 10px; }
  .rpt-wordmark { font-weight: 800; font-size: 18px; letter-spacing: 0.02em; }
  .rpt-doctype { color: var(--rpt-muted); font-size: 13px; }
  .rpt-status { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; }
  .rpt-status .rpt-dot { width: 8px; height: 8px; border-radius: 50%; }
  .rpt-status-passed { color: var(--rpt-success); }
  .rpt-status-passed .rpt-dot { background: var(--rpt-success-dot); }
  .rpt-status-failed { color: var(--rpt-error); }
  .rpt-status-failed .rpt-dot { background: var(--rpt-error); }
  .rpt-status-skipped { color: var(--rpt-muted); }
  .rpt-status-skipped .rpt-dot { background: var(--rpt-muted); }
  .rpt-status-warning { color: var(--rpt-warn); }
  .rpt-status-warning .rpt-dot { background: var(--rpt-warn); }
  .rpt-status-stopped { color: var(--rpt-warn); }
  .rpt-status-stopped .rpt-dot { background: var(--rpt-warn); }
  .rpt-status-excluded { color: var(--rpt-muted); }
  .rpt-status-excluded .rpt-dot { background: var(--rpt-muted); }
  .rpt-status-pending { color: var(--rpt-muted); }
  .rpt-status-pending .rpt-dot { background: var(--rpt-muted); }
  .rpt-titlerow {
    display: flex; align-items: center; justify-content: space-between; margin: 20px 0 4px;
  }
  .rpt-titlegroup { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .rpt-entityicon { flex: 0 0 auto; color: __ENTITY_COLOR__; display: inline-flex; }
  .rpt-title { font-size: 24px; font-weight: 700; margin: 0; }
  .rpt-entitychip {
    font-size: 12px; font-weight: 600; color: var(--rpt-text-secondary);
    background: var(--rpt-bg-subtle); border: 1px solid var(--rpt-border);
    border-radius: 999px; padding: 2px 10px; text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .rpt-meta {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px 24px; margin: 16px 0 0;
    padding: 16px; background: var(--rpt-bg-subtle); border: 1px solid var(--rpt-border);
    border-radius: 10px;
  }
  .rpt-meta div { min-width: 0; }
  .rpt-meta dt {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--rpt-muted); margin: 0 0 2px;
  }
  .rpt-meta dd {
    margin: 0; font-weight: 600; color: var(--rpt-text-secondary); font-size: 13px;
  }

  .rpt-section { margin-top: 36px; }
  .rpt-h2 {
    font-size: 15px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--rpt-text-secondary); margin: 0 0 12px;
    display: flex; align-items: center; justify-content: space-between;
  }

  .rpt-cards { display: grid; grid-template-columns: repeat(__CARD_COLUMNS__, 1fr); gap: 10px; }
  .rpt-card {
    border: 1px solid var(--rpt-border); border-radius: 10px; padding: 12px 14px;
    background: var(--rpt-bg);
  }
  .rpt-card .rpt-num { font-size: 22px; font-weight: 800; line-height: 1.1; }
  .rpt-card .rpt-lbl {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--rpt-muted); margin-top: 2px;
  }
  .rpt-card-passed .rpt-num { color: var(--rpt-success); }
  .rpt-card-failed .rpt-num { color: var(--rpt-error); }
  .rpt-card-total .rpt-num { color: var(--rpt-text); }
  .rpt-card-warn .rpt-num { color: var(--rpt-warn); }
  .rpt-card-muted .rpt-num { color: var(--rpt-muted); }

  .rpt-table {
    width: 100%; border-collapse: collapse; border: 1px solid var(--rpt-border);
    border-radius: 10px; overflow: hidden;
  }
  .rpt-table th {
    text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--rpt-muted); background: var(--rpt-bg-subtle); padding: 8px 12px;
    border-bottom: 1px solid var(--rpt-border);
  }
  .rpt-table td {
    padding: 9px 12px; border-bottom: 1px solid var(--rpt-border); font-size: 13px;
    vertical-align: middle;
  }
  .rpt-table tr:last-child td { border-bottom: none; }
  .rpt-ordercol { width: 44px; color: var(--rpt-muted); }
  .rpt-mono {
    font-family: "JetBrains Mono", ui-monospace, "Cascadia Mono", Menlo, monospace;
    font-size: 12px; color: var(--rpt-text-secondary);
  }
__REGRESSION_CSS__
  .rpt-chart {
    border: 1px solid var(--rpt-border); border-radius: 10px; background: var(--rpt-bg);
    margin-top: 14px;
  }
  .rpt-chart summary {
    cursor: pointer; list-style: none; display: flex; align-items: center; gap: 8px;
    padding: 10px 16px; font-size: 12px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.05em; color: var(--rpt-muted); user-select: none;
  }
  .rpt-chart summary::-webkit-details-marker { display: none; }
  .rpt-chart summary .rpt-chev { transition: transform 0.15s; font-size: 10px; }
  .rpt-chart[open] summary .rpt-chev { transform: rotate(90deg); }
  .rpt-chart-body { padding: 2px 16px 14px; }
  .rpt-gantt-head {
    display: flex; align-items: center; gap: 12px; padding: 0 6px 8px;
    border-bottom: 1px dashed var(--rpt-border); margin-bottom: 10px;
  }
  .rpt-gantt-collbl {
    flex: 0 0 44px; font-size: 11px; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.05em; color: var(--rpt-muted);
  }
  .rpt-gantt-axis {
    display: flex; flex: 1; justify-content: space-between;
    font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 11px;
    color: var(--rpt-muted);
  }
  .rpt-gantt-head .rpt-gantt-dur { flex: 0 0 48px; }
  .rpt-gantt-row {
    position: relative; display: flex; align-items: center; gap: 12px; padding: 3px 6px;
    border-radius: 6px;
  }
  .rpt-gantt-row:hover { background: var(--rpt-bg-subtle); }
  .rpt-gantt-label {
    flex: 0 0 44px; font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 12px;
    white-space: nowrap; color: var(--rpt-text-secondary);
  }
  .rpt-gantt-track {
    position: relative; flex: 1; height: 10px; border-radius: 5px;
    background: var(--rpt-bg-subtle); border: 1px solid var(--rpt-border);
  }
  .rpt-gantt-row:hover .rpt-gantt-track { background: var(--rpt-bg); }
  .rpt-gantt-fill { position: absolute; top: 0; bottom: 0; border-radius: 5px; }
  .rpt-gantt-fill-passed { background: var(--rpt-success-dot); opacity: 0.75; }
  .rpt-gantt-fill-failed { background: var(--rpt-error); opacity: 0.8; }
  .rpt-gantt-fill-warning { background: var(--rpt-warn); opacity: 0.75; }
  .rpt-gantt-fill-skipped { background: var(--rpt-muted); opacity: 0.5; }
  .rpt-gantt-fill-stopped { background: var(--rpt-warn); opacity: 0.6; }
  .rpt-gantt-dur {
    flex: 0 0 48px; text-align: right;
    font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 11px;
    color: var(--rpt-muted);
  }
  .rpt-gantt-tip {
    display: none; position: absolute; bottom: calc(100% + 2px); left: 6px;
    background: var(--rpt-tip-bg); color: var(--rpt-tip-text); padding: 2px 10px;
    border-radius: 6px; font-size: 12px; font-weight: 600; white-space: nowrap;
    z-index: 10; pointer-events: none; box-shadow: 0 4px 14px rgba(0,0,0,0.25);
  }
  .rpt-gantt-row:hover .rpt-gantt-tip { display: block; }

  .rpt-errorcard {
    border: 1px solid var(--rpt-border); border-left: 3px solid var(--rpt-error);
    border-radius: 10px; padding: 14px 16px; margin-bottom: 12px; background: var(--rpt-bg);
  }
  .rpt-errorhead { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .rpt-lvl {
    font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 11px;
    font-weight: 700; padding: 1px 7px; border-radius: 5px;
  }
__ERROR_BADGE_CSS__
  .rpt-errorpath { font-weight: 600; color: var(--rpt-text-secondary); font-size: 13px; }
  .rpt-errortime {
    margin-left: auto; color: var(--rpt-muted); font-size: 12px;
    font-family: "JetBrains Mono", ui-monospace, monospace;
  }
  .rpt-errormsg { margin: 8px 0 0; font-size: 14px; font-weight: 600; color: var(--rpt-error); }
  .rpt-empty {
    border: 1px dashed var(--rpt-border-strong); border-radius: 10px; padding: 14px 16px;
    color: var(--rpt-muted); font-size: 13px;
  }

  .rpt-logctl {
    display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 500;
    color: var(--rpt-muted); text-transform: none; letter-spacing: normal;
  }
  .rpt-logctl select {
    font: inherit; font-weight: 600; color: var(--rpt-text-secondary);
    background: var(--rpt-bg); border: 1px solid var(--rpt-border-strong);
    border-radius: 8px; padding: 3px 8px;
  }
  .rpt-cols { position: relative; }
  .rpt-cols summary {
    list-style: none; cursor: pointer; font: inherit; font-weight: 600;
    color: var(--rpt-text-secondary); background: var(--rpt-bg);
    border: 1px solid var(--rpt-border-strong); border-radius: 8px; padding: 3px 8px;
    user-select: none;
  }
  .rpt-cols summary::-webkit-details-marker { display: none; }
  .rpt-cols-menu {
    position: absolute; right: 0; top: calc(100% + 4px); background: var(--rpt-bg);
    border: 1px solid var(--rpt-border); border-radius: 8px; padding: 8px 10px;
    display: flex; flex-direction: column; gap: 6px; z-index: 20;
    box-shadow: 0 4px 14px rgba(0,0,0,0.15); min-width: 110px;
  }
  .rpt-cols-menu label {
    display: flex; align-items: center; gap: 6px; cursor: pointer;
    color: var(--rpt-text-secondary);
  }
  .rpt-logwrap {
    border: 1px solid var(--rpt-border); border-radius: 10px; background: var(--rpt-bg);
    overflow-x: auto;
  }
  .rpt-log {
    width: 100%; border-collapse: collapse;
    font-family: "JetBrains Mono", ui-monospace, "Cascadia Mono", Menlo, monospace;
    font-size: 12px; line-height: 1.7;
  }
  .rpt-log th {
    text-align: left; font-family: "Plus Jakarta Sans", system-ui, sans-serif;
    font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--rpt-muted); background: var(--rpt-bg-subtle); padding: 6px 12px;
    border-bottom: 1px solid var(--rpt-border);
  }
  .rpt-log td { padding: 2px 12px; vertical-align: top; }
  .rpt-col-ts { white-space: nowrap; }
  td.rpt-col-ts { opacity: 0.6; }
  .rpt-col-lvl { white-space: nowrap; }
  td.rpt-col-lvl { font-weight: 700; }
  .rpt-col-src { max-width: 30ch; overflow-wrap: break-word; }
  td.rpt-col-src { opacity: 0.7; }
  .rpt-col-msg { width: 100%; white-space: pre-wrap; word-break: break-word; }
  .rpt-log.rpt-hide-ts .rpt-col-ts, .rpt-log.rpt-hide-lvl .rpt-col-lvl,
  .rpt-log.rpt-hide-src .rpt-col-src { display: none; }
  .rpt-row-DEBUG { color: var(--rpt-debug); }
  .rpt-row-INFO { color: var(--rpt-info); }
  .rpt-row-WARN { color: var(--rpt-warn); }
  .rpt-row-ERROR { color: var(--rpt-error); }
  .rpt-row-FATAL { color: var(--rpt-fatal); background: var(--rpt-error-bg); }
  .rpt-row-banner { color: var(--rpt-text-secondary); font-weight: 700; }
  .rpt-row[hidden] { display: none; }

  .rpt-footer {
    margin-top: 40px; padding-top: 14px; border-top: 1px solid var(--rpt-border);
    color: var(--rpt-muted); font-size: 12px;
  }
"""

_SCRIPT = """<script>
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.documentElement.classList.add('dark');
  }
  document.getElementById('rpt-theme').addEventListener('click', function () {
    document.documentElement.classList.toggle('dark');
  });
  document.querySelectorAll('.rpt-cols input[data-col]').forEach(function (cb) {
    cb.addEventListener('change', function () {
      document.getElementById('rpt-logtable')
        .classList.toggle('rpt-hide-' + cb.dataset.col, !cb.checked);
    });
  });
  (function () {
    var order = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];
    var sel = document.getElementById('rpt-level');
    var rows = document.querySelectorAll('#rpt-logbody .rpt-row');
    var count = document.getElementById('rpt-logcount');
    sel.addEventListener('change', function () {
      var min = order.indexOf(sel.value);
      var visible = 0;
      rows.forEach(function (r) {
        var show = order.indexOf(r.dataset.level) >= min;
        r.hidden = !show;
        if (show) visible++;
      });
      count.textContent = visible + (visible === 1 ? ' entry' : ' entries');
    });
  })();
</script>"""


def render_report_html(report: dict[str, Any]) -> str:
    """Render the canonical report model as a standalone HTML document."""
    identity = _document_identity(report)
    entity_type = str(identity["entity_type"])
    is_test_doc = entity_type == "test"
    timeline = report.get("timeline") or {}
    runs: list[dict[str, Any]] = timeline.get("runs") or []
    blocks: list[dict[str, Any]] = timeline.get("blocks") or []
    errors: list[dict[str, Any]] = report.get("errors") or []
    logs: list[dict[str, Any]] = report.get("logs") or []

    rows = _normalize_rows(_listed_blocks(blocks) if is_test_doc else runs, is_test_doc)
    css = _build_css(entity_type, card_columns=6 if is_test_doc else 7, has_errors=bool(errors))
    title = escape(f"WAVE Execution Report - {identity['name']}")

    parts = [
        "<!DOCTYPE html>",
        '<html lang="en">',
        "<head>",
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        f"<title>{title}</title>",
        f"<style>{css}</style>",
        "</head>",
        "<body>",
        '<div class="rpt-page">',
        _header(identity, entity_type),
        _cards_section(report, blocks, is_test_doc),
        _timeline_section(entity_type, rows, is_test_doc),
        _errors_section(identity, entity_type, errors),
        _logs_section(logs),
        '<div class="rpt-footer"><span>WAVE Execution Report</span></div>',
        "</div>",
        _SCRIPT,
        "</body>",
        "</html>",
    ]
    return "\n".join(parts)


def _document_identity(report: dict[str, Any]) -> dict[str, Any]:
    session = report.get("session")
    if session is not None:
        return {
            "entity_type": "test",
            "name": session.get("test_name") or "",
            "id_label": "Session ID",
            "id_value": session.get("session_id") or "",
            "environment": session.get("environment_id"),
            "triggered_by": None,
            "status": session.get("status"),
            "started_at": session.get("started_at"),
            "ended_at": None,
            "duration": None,
        }
    execution = report.get("execution") or {}
    return {
        "entity_type": execution.get("entity_type") or "test",
        "name": execution.get("name") or "",
        "id_label": "Execution ID",
        "id_value": execution.get("id") or "",
        "environment": execution.get("environment"),
        "triggered_by": execution.get("triggered_by"),
        "status": execution.get("status"),
        "started_at": execution.get("started_at"),
        "ended_at": execution.get("ended_at"),
        "duration": execution.get("duration"),
    }


def _build_css(entity_type: str, card_columns: int, has_errors: bool) -> str:
    meta = _ENTITY_META.get(entity_type, _ENTITY_META["test"])
    css = _BASE_CSS.replace("__CARD_COLUMNS__", str(card_columns))
    css = css.replace("__ENTITY_COLOR__", meta["color"])
    css = css.replace("__REGRESSION_CSS__", _REGRESSION_CSS if entity_type == "regression" else "")
    return css.replace("__ERROR_BADGE_CSS__", _ERROR_BADGE_CSS if has_errors else "")


def _header(identity: dict[str, Any], entity_type: str) -> str:
    meta = _ENTITY_META.get(entity_type, _ENTITY_META["test"])
    return (
        '<div class="rpt-header">\n'
        '<div class="rpt-brandrow">\n'
        '<div class="rpt-brand">'
        '<span class="rpt-wordmark">WAVE</span>'
        '<span class="rpt-doctype">Execution Report</span>'
        "</div>\n"
        '<div class="rpt-brandright">'
        f"{_status_span(identity['status'])}"
        '<button class="rpt-themebtn" id="rpt-theme" aria-label="Toggle theme" '
        f'title="Toggle theme">{_ICON_MOON}{_ICON_SUN}</button>'
        "</div>\n"
        "</div>\n"
        '<div class="rpt-titlerow">\n'
        '<div class="rpt-titlegroup">'
        f'<span class="rpt-entityicon">{meta["icon"]}</span>'
        f'<h1 class="rpt-title">{escape(str(identity["name"]))}</h1>'
        "</div>\n"
        f'<span class="rpt-entitychip">{meta["chip"]}</span>\n'
        "</div>\n"
        f"{_meta_grid(identity)}\n"
        "</div>"
    )


def _meta_grid(identity: dict[str, Any]) -> str:
    cells = [
        ("Environment", escape(str(identity.get("environment") or "-")), ""),
        ("Triggered by", escape(str(identity.get("triggered_by") or "-")), ""),
        ("Started", _fmt_stamp(identity.get("started_at")), ""),
        ("Duration", _fmt_duration(identity.get("duration")), ""),
        (str(identity["id_label"]), escape(str(identity["id_value"])), ' class="rpt-mono"'),
        ("Ended", _fmt_stamp(identity.get("ended_at")), ""),
    ]
    rows = "\n".join(
        f"<div><dt>{label}</dt><dd{dd_attr}>{value}</dd></div>" for label, value, dd_attr in cells
    )
    return f'<dl class="rpt-meta">\n{rows}\n</dl>'


def _block_status(block: dict[str, Any]) -> str:
    return str(block.get("status") or "")


def _listed_blocks(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Steps with a recorded outcome, renumbered over the rows on show."""
    listed = [block for block in blocks if _block_status(block) in _RECORDED_BLOCK_STATUSES]
    return [{**block, "order": order} for order, block in enumerate(listed, start=1)]


def _cards_section(report: dict[str, Any], blocks: list[dict[str, Any]], is_test_doc: bool) -> str:
    if is_test_doc:
        heading = "Block Results"
        statuses = [_block_status(block) for block in blocks]
        tiles = [
            (label, sum(1 for status in statuses if status in owned), kind)
            for label, kind, owned in _BLOCK_TILES
        ]
        items = [("Total", sum(count for _, count, _ in tiles), "total"), *tiles]
    else:
        heading = "Test Results"
        counts = (report.get("summary") or {}).get("counts") or {}
        items = [
            ("Tests", counts.get("total", 0), "total"),
            ("Passed", counts.get("passed", 0), "passed"),
            ("Failed", counts.get("failed", 0), "failed"),
            ("Skipped", counts.get("skipped", 0), "muted"),
            ("Stopped", counts.get("stopped", 0), "muted"),
            ("Excluded", counts.get("excluded", 0), "muted"),
            ("Pending", counts.get("pending", 0), "muted"),
        ]
    cards = "\n".join(_card(label, count, kind) for label, count, kind in items)
    return (
        '<div class="rpt-section">\n'
        f'<h2 class="rpt-h2">{heading}</h2>\n'
        f'<div class="rpt-cards">\n{cards}\n</div>\n'
        "</div>"
    )


def _card(label: str, count: int, kind: str) -> str:
    if kind in ("passed", "failed", "warn") and count == 0:
        kind = "muted"
    return (
        f'<div class="rpt-card rpt-card-{kind}">'
        f'<div class="rpt-num">{count}</div>'
        f'<div class="rpt-lbl">{label}</div></div>'
    )


def _normalize_rows(rows: list[dict[str, Any]], is_test_doc: bool) -> list[dict[str, Any]]:
    normalized = []
    for row in rows:
        name = row.get("block_path") if is_test_doc else row.get("test_name")
        normalized.append(
            {
                "order": row.get("order"),
                "name": str(name or ""),
                "status": str(row.get("status") or "pending"),
                "started_at": row.get("started_at"),
                "ended_at": row.get("ended_at"),
                "duration": row.get("duration"),
                "suite_id": row.get("suite_id"),
                "suite_name": str(row.get("suite_name") or ""),
            }
        )
    return normalized


def _timeline_section(entity_type: str, rows: list[dict[str, Any]], is_test_doc: bool) -> str:
    label_title = "Block" if is_test_doc else "Test"
    if entity_type == "regression":
        groups = [
            (key[1], list(group))
            for key, group in groupby(rows, key=lambda r: (r["suite_id"], r["suite_name"]))
        ]
        table = _grouped_table(label_title, groups)
    else:
        groups = [(None, rows)]
        table = _flat_table(label_title, rows)
    return (
        '<div class="rpt-section">\n'
        '<h2 class="rpt-h2">Timeline</h2>\n'
        f"{table}\n"
        f"{_chart(label_title, groups, total_rows=len(rows))}\n"
        "</div>"
    )


def _table_header(label_title: str) -> str:
    return (
        f'<tr><th class="rpt-ordercol">#</th><th>{label_title}</th>'
        "<th>Status</th><th>Started</th><th>Duration</th></tr>"
    )


def _table_row(row: dict[str, Any]) -> str:
    return (
        "<tr>"
        f'<td class="rpt-ordercol rpt-mono">{row["order"]}</td>'
        f"<td>{escape(row['name'])}</td>"
        f"<td>{_status_span(row['status'])}</td>"
        f'<td class="rpt-mono">{_fmt_clock(row["started_at"])}</td>'
        f'<td class="rpt-mono">{_fmt_duration(row["duration"])}</td>'
        "</tr>"
    )


def _flat_table(label_title: str, rows: list[dict[str, Any]]) -> str:
    body = "\n".join(_table_row(row) for row in rows)
    return (
        '<table class="rpt-table">\n'
        f"<thead>\n{_table_header(label_title)}\n</thead>\n"
        f"<tbody>\n{body}\n</tbody>\n"
        "</table>"
    )


def _grouped_table(label_title: str, groups: list[tuple[str | None, list[dict[str, Any]]]]) -> str:
    chunks = []
    for suite_name, group_rows in groups:
        chunks.append(
            f'<tr class="rpt-suite-row"><td colspan="5">{escape(suite_name or "")}</td></tr>'
        )
        chunks.append(_table_header(label_title))
        chunks.extend(_table_row(row) for row in group_rows)
    body = "\n".join(chunks)
    return f'<table class="rpt-table">\n<tbody>\n{body}\n</tbody>\n</table>'


def _chart(
    label_title: str,
    groups: list[tuple[str | None, list[dict[str, Any]]]],
    total_rows: int,
) -> str:
    open_attr = " open" if total_rows <= CHART_COLLAPSE_THRESHOLD else ""
    chunks = []
    for suite_name, rows in groups:
        if suite_name is not None:
            chunks.append(f'<div class="rpt-gantt-suite">{escape(suite_name)}</div>')
        window = _time_window(rows)
        chunks.append(_gantt_head(label_title, window))
        chunks.extend(_gantt_row(row, window) for row in rows)
    body = "\n".join(chunks)
    return (
        f'<details class="rpt-chart"{open_attr}>\n'
        '<summary><span class="rpt-chev">&#9654;</span>Timeline Chart</summary>\n'
        f'<div class="rpt-chart-body">\n{body}\n</div>\n'
        "</details>"
    )


def _time_window(rows: list[dict[str, Any]]) -> tuple[datetime, datetime] | None:
    starts = [ts for ts in (_parse_ts(row.get("started_at")) for row in rows) if ts is not None]
    ends = [ts for ts in (_parse_ts(row.get("ended_at")) for row in rows) if ts is not None]
    if not starts or not ends:
        return None
    return min(starts), max(ends)


def _gantt_head(label_title: str, window: tuple[datetime, datetime] | None) -> str:
    axis_start = _fmt_clock_dt(window[0]) if window else ""
    axis_end = _fmt_clock_dt(window[1]) if window else ""
    return (
        '<div class="rpt-gantt-head">'
        f'<span class="rpt-gantt-collbl">{label_title}</span>'
        f'<span class="rpt-gantt-axis"><span>{axis_start}</span><span>{axis_end}</span></span>'
        '<span class="rpt-gantt-dur"></span></div>'
    )


def _gantt_row(row: dict[str, Any], window: tuple[datetime, datetime] | None) -> str:
    fill = _gantt_fill(row, window)
    return (
        '<div class="rpt-gantt-row">'
        f'<span class="rpt-gantt-tip">{row["order"]} &middot; {escape(row["name"])}</span>'
        f'<span class="rpt-gantt-label">{row["order"]}</span>'
        f'<span class="rpt-gantt-track">{fill}</span>'
        f'<span class="rpt-gantt-dur">{_fmt_duration(row["duration"])}</span>'
        "</div>"
    )


def _gantt_fill(row: dict[str, Any], window: tuple[datetime, datetime] | None) -> str:
    start = _parse_ts(row.get("started_at"))
    end = _parse_ts(row.get("ended_at"))
    if window is None or start is None or end is None:
        return ""
    span = (window[1] - window[0]).total_seconds()
    if span <= 0:
        left, width = 0.0, 100.0
    else:
        left = max((start - window[0]).total_seconds() / span * 100.0, 0.0)
        width = max((end - start).total_seconds() / span * 100.0, 0.5)
        width = min(width, 100.0 - left)
    status = escape(row["status"].lower())
    return (
        f'<span class="rpt-gantt-fill rpt-gantt-fill-{status}" '
        f'style="left:{left:.1f}%;width:{width:.1f}%"></span>'
    )


def _errors_section(
    identity: dict[str, Any], entity_type: str, errors: list[dict[str, Any]]
) -> str:
    count_text = f"{len(errors)} {'error' if len(errors) == 1 else 'errors'}"
    if errors:
        body = "\n".join(_error_card(identity, entity_type, error) for error in errors)
    else:
        body = '<div class="rpt-empty">No errors.</div>'
    return (
        '<div class="rpt-section">\n'
        f'<h2 class="rpt-h2">Errors <span class="rpt-logctl">{count_text}</span></h2>\n'
        f"{body}\n"
        "</div>"
    )


def _error_card(identity: dict[str, Any], entity_type: str, error: dict[str, Any]) -> str:
    level = str(error.get("level") or "ERROR")
    return (
        '<div class="rpt-errorcard">\n'
        '<div class="rpt-errorhead">'
        f'<span class="rpt-lvl rpt-lvl-{escape(level.lower())}">{escape(level)}</span>'
        f'<span class="rpt-errorpath">{_error_path(identity, entity_type, error)}</span>'
        f'<span class="rpt-errortime">{_fmt_clock(error.get("timestamp"))}</span>'
        "</div>\n"
        f'<div class="rpt-errormsg">{escape(str(error.get("message") or ""))}</div>\n'
        "</div>"
    )


def _error_path(identity: dict[str, Any], entity_type: str, error: dict[str, Any]) -> str:
    segments: list[Any] = []
    if entity_type == "regression":
        segments.append(error.get("suite_name"))
    if entity_type in ("regression", "suite"):
        segments.append(error.get("test_name"))
    segments.append(error.get("block_path"))
    parts = [escape(str(segment)) for segment in segments if segment]
    if not parts:
        return escape(str(identity["name"]))
    return " / ".join(parts)


def _logs_section(logs: list[dict[str, Any]]) -> str:
    count_text = f"{len(logs)} {'entry' if len(logs) == 1 else 'entries'}"
    options = "\n".join(
        f"<option{' selected' if level == _LOG_LEVELS[0] else ''}>{level}</option>"
        for level in _LOG_LEVELS
    )
    rows = "\n".join(_log_row(entry) for entry in logs)
    return (
        '<div class="rpt-section">\n'
        '<h2 class="rpt-h2">Logs\n'
        '<span class="rpt-logctl">\n'
        '<label for="rpt-level">Level:</label>\n'
        f'<select id="rpt-level">\n{options}\n</select>\n'
        '<details class="rpt-cols">\n'
        "<summary>Columns</summary>\n"
        '<div class="rpt-cols-menu">\n'
        '<label><input type="checkbox" checked data-col="ts"> Time</label>\n'
        '<label><input type="checkbox" checked data-col="lvl"> Level</label>\n'
        '<label><input type="checkbox" checked data-col="src"> Source</label>\n'
        "</div>\n"
        "</details>\n"
        f'<span id="rpt-logcount">{count_text}</span>\n'
        "</span>\n"
        "</h2>\n"
        '<div class="rpt-logwrap">\n'
        '<table class="rpt-log" id="rpt-logtable">\n'
        "<thead>\n"
        '<tr><th class="rpt-col-ts">Time</th><th class="rpt-col-lvl">Level</th>'
        '<th class="rpt-col-src">Source</th><th class="rpt-col-msg">Message</th></tr>\n'
        "</thead>\n"
        f'<tbody id="rpt-logbody">\n{rows}\n</tbody>\n'
        "</table>\n"
        "</div>\n"
        "</div>"
    )


def _log_row(entry: dict[str, Any]) -> str:
    level = str(entry.get("level") or "")
    variant = str(entry.get("variant") or "")
    row_class = "rpt-row-banner" if variant.endswith("-banner") else f"rpt-row-{escape(level)}"
    return (
        f'<tr class="rpt-row {row_class}" data-level="{escape(level)}">'
        f'<td class="rpt-col-ts">{_fmt_clock(entry.get("timestamp"))}</td>'
        f'<td class="rpt-col-lvl">{escape(level)}</td>'
        f'<td class="rpt-col-src">{escape(str(entry.get("source") or ""))}</td>'
        f'<td class="rpt-col-msg">{escape(str(entry.get("message") or ""))}</td>'
        "</tr>"
    )


def _status_span(status: Any) -> str:
    text = str(status or "unknown")
    return (
        f'<span class="rpt-status rpt-status-{escape(text.lower())}">'
        f'<span class="rpt-dot"></span>{escape(text.capitalize())}</span>'
    )


def _parse_ts(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _fmt_clock(value: Any) -> str:
    parsed = _parse_ts(value)
    if parsed is None:
        return "-"
    return _fmt_clock_dt(parsed)


def _fmt_clock_dt(value: datetime) -> str:
    return value.strftime("%H:%M:%S.") + f"{value.microsecond // 1000:03d}"


def _fmt_stamp(value: Any) -> str:
    parsed = _parse_ts(value)
    if parsed is None:
        return "-"
    return parsed.strftime("%Y-%m-%d %H:%M:%S UTC")


def _fmt_duration(value: Any) -> str:
    if value is None:
        return "-"
    return f"{round(float(value), 1):g}s"
