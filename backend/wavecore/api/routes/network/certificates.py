"""Settings > Network > Certificates endpoints (REQ-4.5.16)."""

from typing import Any

from fastapi import APIRouter, Request
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from starlette.datastructures import UploadFile

from wavecore.api.exceptions import ValidationException
from wavecore.api.services.network import certificates

router = APIRouter(prefix="/network/certificates", tags=["Network"])

_CONTENT_TYPE_MESSAGE = "Send the text as JSON or the file as multipart/form-data"


class BuiltinSummary(BaseModel):
    label: str
    count: int


class HostStoreSummary(BaseModel):
    path: str | None = None
    count: int
    last_changed: str | None = None


class CertificateSettings(BaseModel):
    public_source: str
    builtin: BuiltinSummary
    host_store: HostStoreSummary


class CertificateRow(BaseModel):
    id: str
    name: str
    organization: str
    type: str
    expires: str


class CertificatesView(BaseModel):
    settings: CertificateSettings
    additional: list[CertificateRow]


class CertificateDetail(BaseModel):
    id: str
    name: str
    subject: str
    issuer: str
    type: str
    path_length: int | None = None
    valid_from: str
    valid_to: str
    status: str
    days_to_expiry: int
    sha256_fingerprint: str
    serial_number: str
    key: str
    signature_algorithm: str
    key_usage: list[str]
    subject_key_id: str | None = None
    authority_key_id: str | None = None
    pem: str


class ParsedCertificate(BaseModel):
    id: str
    name: str
    type: str
    expires: str
    expired: bool
    pem: str
    detail: CertificateDetail


class CertificateParseError(BaseModel):
    index: int | None = None
    message: str


class CertificateParseResponse(BaseModel):
    certificates: list[ParsedCertificate]
    errors: list[CertificateParseError]


class BuiltinCertificatesResponse(BaseModel):
    certificates: list[CertificateRow]


class CertificatesChangeRequest(BaseModel):
    """One Save of the page; the source is checked by the service for its exact message."""

    model_config = ConfigDict(extra="ignore")

    public_source: Any = None
    add: list[str] = Field(default_factory=list)
    remove: list[str] = Field(default_factory=list)


class CertificateTextRequest(BaseModel):
    text: str


@router.get("")
def get_certificates() -> CertificatesView:
    """The public source, both source summaries and the saved Additional Certificates."""
    return CertificatesView.model_validate(certificates.get_view())


@router.patch("")
def update_certificates(body: CertificatesChangeRequest) -> CertificatesView:
    """Write the page's staged source change, removals and additions in one change set."""
    view = certificates.apply_changes(body.public_source, body.add, body.remove)
    return CertificatesView.model_validate(view)


async def _parse_request(request: Request) -> dict[str, Any]:
    content_type = request.headers.get("content-type", "")
    if content_type.startswith("application/json"):
        try:
            body = CertificateTextRequest.model_validate_json(await request.body())
        except ValidationError as exc:
            raise RequestValidationError(exc.errors()) from exc
        return certificates.parse_text(body.text)
    if content_type.startswith("multipart/form-data"):
        form = await request.form()
        upload = form.get("file")
        if not isinstance(upload, UploadFile):
            missing = {"type": "missing", "loc": ("body", "file"), "msg": "Field required"}
            raise RequestValidationError([missing])
        return certificates.parse_file(upload.filename or "file", await upload.read())
    raise ValidationException(_CONTENT_TYPE_MESSAGE)


@router.post("/parse")
async def parse_certificates(request: Request) -> CertificateParseResponse:
    """Preview pasted text (JSON) or one chosen file (multipart); writes nothing."""
    return CertificateParseResponse.model_validate(await _parse_request(request))


@router.get("/builtin")
def get_builtin_certificates() -> BuiltinCertificatesResponse:
    """Every authority in WAVE's built-in list."""
    return BuiltinCertificatesResponse(
        certificates=[CertificateRow.model_validate(row) for row in certificates.builtin_rows()]
    )


@router.get("/{certificate_id}")
def get_certificate(certificate_id: str) -> CertificateDetail:
    """A saved Additional Certificate's detail, else a built-in authority's."""
    return CertificateDetail.model_validate(certificates.certificate_detail(certificate_id))
