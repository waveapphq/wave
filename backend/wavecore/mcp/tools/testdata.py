"""Test Data write tools: a test's own files through the Test Data service.

Three outcomes stay apart: an unknown test reference raises through
resolve_test, an argument error raises ValidationException, and a refusal
from the service comes back as a finding with its message verbatim
(REQ-5.2.7.9).
"""

import base64
import binascii
from typing import Any

from wavecore.api.exceptions import ValidationException, WaveException
from wavecore.api.services.tests import testdata_service
from wavecore.mcp.tools._findings import _service_finding
from wavecore.mcp.tools.discover import resolve_test

_EXACTLY_ONE_CONTENT = "Provide exactly one of content or content_base64"
_INVALID_BASE64 = "content_base64 is not valid base64"


def _target_id(test_ref: str) -> str:
    return str(resolve_test(test_ref).get("id"))


def _decode_content(content: str | None, content_base64: str | None) -> bytes:
    if content is not None and content_base64 is None:
        return content.encode("utf-8")
    if content_base64 is not None and content is None:
        try:
            return base64.b64decode(content_base64, validate=True)
        except binascii.Error as exc:
            raise ValidationException(_INVALID_BASE64) from exc
    raise ValidationException(_EXACTLY_ONE_CONTENT)


def _refusal(key: str, exc: WaveException) -> dict[str, Any]:
    return {key: False, "findings": [_service_finding(exc)]}


def write_testdata(
    test_ref: str,
    path: str,
    content: str | None = None,
    content_base64: str | None = None,
    replace: bool = False,
) -> dict[str, Any]:
    """Store one file at a relative path in the test's Test Data (text or base64)."""
    payload = _decode_content(content, content_base64)
    test_id = _target_id(test_ref)
    folder, _, name = path.rpartition("/")
    try:
        stored = testdata_service.store_bytes(test_id, folder, name, payload, replace=replace)
    except WaveException as exc:
        return _refusal("written", exc)
    return {"written": True, "path": stored["path"], "size_bytes": stored["size_bytes"]}


def create_testdata_folder(test_ref: str, path: str) -> dict[str, Any]:
    """Create one folder under an existing parent in the test's Test Data."""
    test_id = _target_id(test_ref)
    try:
        testdata_service.create_folder(test_id, path)
    except WaveException as exc:
        return _refusal("created", exc)
    return {"created": True}


def rename_testdata(test_ref: str, path: str, new_path: str) -> dict[str, Any]:
    """Rename or move an entry within the test's Test Data."""
    test_id = _target_id(test_ref)
    try:
        renamed = testdata_service.rename_entry(test_id, path, new_path)
    except WaveException as exc:
        return _refusal("renamed", exc)
    return {"renamed": True, "path": renamed}


def delete_testdata(test_ref: str, path: str) -> dict[str, Any]:
    """Remove a file, or a folder with everything inside it, from the test's Test Data."""
    test_id = _target_id(test_ref)
    try:
        testdata_service.delete_entry(test_id, path)
    except WaveException as exc:
        return _refusal("deleted", exc)
    return {"deleted": True}
