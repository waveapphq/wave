"""Periodic backup schedule: the config file's backup.schedule section, cron and the loop."""

import asyncio
import contextlib
import copy
import logging
import os
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any, Final

from croniter import croniter

from wavecore.api.config import get_config
from wavecore.api.config.instance_settings import (
    MAX_BACKUPS_MIN,
    SECTION_DEFAULTS,
    whole_number_fault,
)
from wavecore.api.config.write_back import ConfigWriteError
from wavecore.api.exceptions import ValidationException
from wavecore.api.services import storage_paths
from wavecore.api.services.backup._helpers import BACKUP_ENTITY_TYPES, _validate_entity_types
from wavecore.api.services.backup.service import _validate_backup_options, create_backup
from wavecore.api.services.shared import parse_secrets_mode
from wavecore.core.number_rule import MAX_INTEGER_DIGITS
from wavecore.plugins._file_paths import plain_path

logger = logging.getLogger(__name__)

_SECTION: Final[str] = "backup.schedule"
_DEFAULTS: Final[dict[str, Any]] = SECTION_DEFAULTS["backup"]["schedule"]
# A Save writes these; the run record belongs to the scheduler.
_SETTINGS: Final[tuple[str, ...]] = tuple(
    key for key in _DEFAULTS if not key.startswith("last_run")
)


def _describe_cron(expr: str) -> str:
    """Generate a simple human-readable description of a cron expression."""
    parts = expr.strip().split()
    if len(parts) != 5:
        return expr

    minute, hour, dom, month, dow = parts

    day_names = {
        "0": "Sunday",
        "1": "Monday",
        "2": "Tuesday",
        "3": "Wednesday",
        "4": "Thursday",
        "5": "Friday",
        "6": "Saturday",
        "7": "Sunday",
    }

    if minute == "0" and hour != "*" and dom == "*" and month == "*" and dow == "*":
        return f"Every day at {hour.zfill(2)}:00"
    if minute != "*" and hour != "*" and dom == "*" and month == "*" and dow == "*":
        return f"Every day at {hour.zfill(2)}:{minute.zfill(2)}"
    if minute == "0" and hour != "*" and dom == "*" and month == "*" and dow != "*":
        day = day_names.get(dow, dow)
        return f"Every {day} at {hour.zfill(2)}:00"
    if minute.startswith("*/"):
        interval = minute[2:]
        return f"Every {interval} minutes"
    if hour.startswith("*/"):
        interval = hour[2:]
        return f"Every {interval} hours"

    return f"Cron: {expr}"


def _compute_next_run(cron_expr: str) -> str | None:
    """Compute the next run ISO timestamp for a cron expression."""
    try:
        cron = croniter(cron_expr, datetime.now(UTC))
        next_run = datetime.fromtimestamp(cron.get_next(), tz=UTC)
        return next_run.isoformat()
    except (ValueError, KeyError):
        return None


def _enrich_schedule_with_computed_fields(data: dict[str, Any]) -> None:
    """Add cron_description and next_run to schedule data in-place."""
    if data["enabled"] and data["cron"]:
        data["cron_description"] = _describe_cron(data["cron"])
        data["next_run"] = _compute_next_run(data["cron"])
    else:
        data["cron_description"] = ""
        data["next_run"] = None


def _entity_types(stored: list[str] | None) -> list[str]:
    """The stored entity types; null means every backup entity type."""
    return sorted(BACKUP_ENTITY_TYPES) if stored is None else list(stored)


def resolve_save_directory(value: str) -> Path:
    """The save folder as a path; ~ and a relative value start at the WAVE account's home."""
    return plain_path(os.path.expanduser(value))


def _check_outside_data_folder(folder: Path) -> None:
    """Refuse the data folder and anything under it (REQ-4.7.20)."""
    data_folder = storage_paths.get_base_path()
    if folder.resolve().is_relative_to(data_folder.resolve()):
        raise ValidationException(f"Save directory must be outside the data folder: {data_folder}")


def _validate_schedule_config(config: dict[str, Any]) -> None:
    """Validate the values an enabled schedule would run with."""
    cron_expr = config["cron"]
    if not cron_expr:
        raise ValidationException("Cron expression is required")

    if config["entity_types"] is not None:
        _validate_entity_types(config["entity_types"])

    max_backups = config["max_backups"]
    if max_backups is None:
        raise ValidationException("Max backups is required")
    fault = whole_number_fault(max_backups, MAX_BACKUPS_MIN)
    if fault == "integer-cap":
        raise ValidationException(f"Max backups allows at most {MAX_INTEGER_DIGITS} digits")
    if fault:
        raise ValidationException("Max backups must be a positive integer")

    save_directory = config["save_directory"]
    if not save_directory:
        raise ValidationException("Save directory is required")

    try:
        croniter(cron_expr)
    except (ValueError, KeyError):
        raise ValidationException(f"Invalid cron expression: '{cron_expr}'") from None

    _check_outside_data_folder(resolve_save_directory(save_directory))
    _validate_backup_options(
        config["format"], config["compression_method"], config["compression_level"]
    )


def _stored_schedule() -> dict[str, Any]:
    """The schedule in force: one value per known key."""
    return get_config().section(_SECTION)


def _schedule_on_the_page() -> dict[str, Any]:
    """The stored schedule as the page holds it: while the switch is off every setting the
    page hides is at its default (REQ-4.7.16); the run record is as stored."""
    schedule = _stored_schedule()
    if not schedule["enabled"]:
        schedule.update({key: copy.deepcopy(_DEFAULTS[key]) for key in _SETTINGS})
    return schedule


def get_schedule() -> dict[str, Any]:
    """The schedule in force, with its entity types resolved and its computed fields."""
    schedule = _schedule_on_the_page()
    schedule["entity_types"] = _entity_types(schedule["entity_types"])
    last_run = schedule["last_run"]
    if isinstance(last_run, date):
        # A time written by hand without quotes loads as a date or a datetime.
        schedule["last_run"] = last_run.isoformat()
    _enrich_schedule_with_computed_fields(schedule)
    return schedule


def update_schedule(config: dict[str, Any]) -> dict[str, Any]:
    """Save the schedule: on checks the merged values first; off keeps none of the settings
    the page hides (REQ-4.7.16), only the run record."""
    wanted: dict[str, Any] = {key: copy.deepcopy(_DEFAULTS[key]) for key in _SETTINGS}
    if config.get("enabled", False):
        requested = {key: config[key] for key in _SETTINGS if key in config}
        wanted = {**_schedule_on_the_page(), **requested, "enabled": True}
        _validate_schedule_config(wanted)
        wanted["secrets"] = parse_secrets_mode(wanted["secrets"])
    get_config().save_changed(_SECTION, wanted)
    return get_schedule()


# ---------------------------------------------------------------------------
# Periodic Backup Background Task
# ---------------------------------------------------------------------------

_scheduler_task: asyncio.Task[None] | None = None


def _execute_scheduled_backup(schedule_data: dict[str, Any]) -> None:
    """Execute a single scheduled backup and enforce retention."""
    schedule = {**_DEFAULTS, **schedule_data}
    save_dir = resolve_save_directory(schedule["save_directory"])
    _check_outside_data_folder(save_dir)
    save_dir.mkdir(parents=True, exist_ok=True)

    zip_bytes, filename = create_backup(
        entity_types=_entity_types(schedule["entity_types"]),
        fmt=schedule["format"],
        compression_method=schedule["compression_method"],
        compression_level=schedule["compression_level"],
        secrets=schedule["secrets"],
    )

    out_path = save_dir / filename
    out_path.write_bytes(zip_bytes)
    logger.info("Periodic backup saved: %s", out_path)

    existing = sorted(save_dir.glob("wave-backup-*.zip"), key=lambda p: p.name)
    while len(existing) > schedule["max_backups"]:
        oldest = existing.pop(0)
        oldest.unlink()
        logger.info("Retention: deleted old backup %s", oldest.name)


def _update_schedule_status(status_value: str, last_run: str | None = None) -> None:
    """Record a run in the config file; a refused record never stops the scheduler."""
    record: dict[str, Any] = {f"{_SECTION}.last_run_status": status_value}
    if last_run:
        record[f"{_SECTION}.last_run"] = last_run
    try:
        get_config().save(record, user="scheduler")
    except ConfigWriteError as error:
        logger.warning("Periodic backup result not recorded: %s", error)


async def _scheduler_loop() -> None:
    """Background loop: sleep until next cron tick, run backup, repeat."""
    logger.info("Periodic backup scheduler started")
    try:
        while True:
            schedule_data = get_schedule()
            if not schedule_data.get("enabled") or not schedule_data.get("cron"):
                logger.info("Periodic backup disabled, scheduler exiting")
                return

            cron_expr = schedule_data["cron"]
            now = datetime.now(UTC)
            try:
                cron = croniter(cron_expr, now)
                next_ts = cron.get_next(float)
            except (ValueError, KeyError):
                logger.error("Invalid cron expression '%s', scheduler exiting", cron_expr)
                return

            next_dt = datetime.fromtimestamp(next_ts, tz=UTC)
            wait_seconds = (next_dt - now).total_seconds()
            logger.info(
                "Next periodic backup at %s (in %.0f seconds)",
                next_dt.isoformat(),
                wait_seconds,
            )

            if wait_seconds > 0:
                await asyncio.sleep(wait_seconds)

            schedule_data = get_schedule()
            if not schedule_data.get("enabled"):
                logger.info("Schedule disabled during wait, scheduler exiting")
                return

            run_time = datetime.now(UTC).isoformat()
            try:
                _execute_scheduled_backup(schedule_data)
                _update_schedule_status("success", run_time)
                logger.info("Periodic backup completed successfully")
            except Exception:
                logger.exception("Periodic backup failed")
                _update_schedule_status("failed", run_time)

    except asyncio.CancelledError:
        logger.info("Periodic backup scheduler canceled")
        raise


async def start_scheduler() -> None:
    """Start the periodic backup scheduler if enabled."""
    global _scheduler_task
    await stop_scheduler()

    schedule_data = get_schedule()
    if schedule_data.get("enabled") and schedule_data.get("cron"):
        _scheduler_task = asyncio.create_task(_scheduler_loop())
        logger.info("Periodic backup scheduler task created")
    else:
        logger.info("No active periodic backup schedule")


async def stop_scheduler() -> None:
    """Stop the periodic backup scheduler if running."""
    global _scheduler_task
    if _scheduler_task is not None and not _scheduler_task.done():
        _scheduler_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await _scheduler_task
        logger.info("Periodic backup scheduler stopped")
    _scheduler_task = None
