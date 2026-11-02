"""GET/PUT /admin/secret-masking - the runtime per-surface secret-reveal flags."""

from datetime import UTC, datetime

from fastapi import APIRouter
from pydantic import BaseModel

import wavecore.core.secrets.masking_settings as masking_settings

router = APIRouter(prefix="/admin", tags=["Admin"])

_TZ_UTC_SUFFIX = "+00:00"


class SecretMaskingRequest(BaseModel):
    """Partial update of the reveal flags (omitted fields stay unchanged)."""

    run_output: bool | None = None
    test_variables: bool | None = None
    shared_variables: bool | None = None
    credential_inputs: bool | None = None


class SecretMaskingResponse(BaseModel):
    """Current reveal-flag state with a response timestamp."""

    run_output: bool
    test_variables: bool
    shared_variables: bool
    credential_inputs: bool
    timestamp: str


def _current_response() -> SecretMaskingResponse:
    flags = masking_settings.get_reveal_settings()
    timestamp = datetime.now(UTC).isoformat().replace(_TZ_UTC_SUFFIX, "Z")
    return SecretMaskingResponse(timestamp=timestamp, **flags)


@router.get("/secret-masking")
async def get_secret_masking() -> SecretMaskingResponse:
    """Return the current system-wide secret-reveal flags."""
    return _current_response()


@router.put("/secret-masking")
async def set_secret_masking(body: SecretMaskingRequest) -> SecretMaskingResponse:
    """Set any subset of the system-wide secret-reveal flags."""
    masking_settings.set_reveal_settings(
        run_output=body.run_output,
        test_variables=body.test_variables,
        shared_variables=body.shared_variables,
        credential_inputs=body.credential_inputs,
    )
    return _current_response()
