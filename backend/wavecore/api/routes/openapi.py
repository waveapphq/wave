"""OpenAPI documentation endpoints.

This module implements REQ-5.2.3.6: OpenAPI/Swagger documentation auto-generation.

Provides:
- YAML schema export endpoint for human-readable specification format
- Schema export for configuration management and version control
"""

import yaml
from fastapi import APIRouter, Response

router = APIRouter()


@router.get("/openapi.yaml", include_in_schema=False)
async def get_openapi_yaml() -> Response:
    """Export OpenAPI schema in YAML format.

    REQ-5.2.3.6 requires: 'YAML schema endpoint for human-readable specification
    format' and 'OpenAPI YAML for configuration management and version control'.

    Returns:
        Response: OpenAPI schema in YAML format with appropriate content type.
    """
    from wavecore.api.app import app

    # Get the OpenAPI schema from FastAPI
    openapi_schema = app.openapi()

    # Convert to YAML format
    yaml_content = yaml.dump(openapi_schema, default_flow_style=False, sort_keys=False)

    # Return with appropriate YAML content type
    return Response(content=yaml_content, media_type="text/yaml")
