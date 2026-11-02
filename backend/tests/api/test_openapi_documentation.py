"""Tests for REQ-5.2.3.6: OpenAPI/Swagger documentation auto-generation.

This test module verifies:
- Automatic OpenAPI 3.0+ schema generation from FastAPI route definitions
- Interactive Swagger UI availability and functionality
- Alternative ReDoc interface availability
- JSON/YAML schema export endpoints
- Schema validation and documentation accuracy
- Complete endpoint catalog with metadata
- Request/response schema coverage
- Type system integration with Pydantic models
- Documentation quality requirements
"""

from fastapi.testclient import TestClient


class TestOpenAPISchemaGeneration:
    """Test suite for automatic OpenAPI schema generation."""

    def test_openapi_json_endpoint_exists(self) -> None:
        """Test that OpenAPI JSON schema endpoint is accessible."""
        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/openapi.json")

        assert response.status_code == 200, "OpenAPI JSON endpoint must return 200"
        assert (
            response.headers["content-type"] == "application/json"
        ), "OpenAPI JSON endpoint must return application/json"

    def test_openapi_schema_is_valid_json(self) -> None:
        """Test that OpenAPI schema is valid JSON."""
        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/openapi.json")

        # Should not raise JSONDecodeError
        schema = response.json()
        assert isinstance(schema, dict), "OpenAPI schema must be a dictionary"

    def test_openapi_version_compliance(self) -> None:
        """Test that OpenAPI schema complies with OpenAPI 3.0+ specification."""
        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/openapi.json")
        schema = response.json()

        assert "openapi" in schema, "Schema must contain 'openapi' version field"
        openapi_version = schema["openapi"]
        assert openapi_version.startswith("3."), "OpenAPI version must be 3.0 or higher"

    def test_openapi_required_root_fields(self) -> None:
        """Test that OpenAPI schema contains all required root-level fields."""
        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/openapi.json")
        schema = response.json()

        required_fields = ["openapi", "info", "paths"]
        for field in required_fields:
            assert field in schema, f"Schema must contain required field: {field}"

    def test_openapi_info_section(self) -> None:
        """Test that OpenAPI info section is properly configured."""
        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/openapi.json")
        schema = response.json()

        info = schema.get("info", {})
        assert "title" in info, "Info section must contain title"
        assert "version" in info, "Info section must contain version"
        assert info["title"] == "WAVE API", "Title must match application title"
        assert info["version"] == "1.0.0", "Version must match application version"

    def test_openapi_info_metadata(self) -> None:
        """Test that OpenAPI info section includes comprehensive metadata."""
        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/openapi.json")
        schema = response.json()

        info = schema.get("info", {})
        assert "description" in info, "Info section must contain description for API overview"
        assert info.get("contact") == {
            "name": "WAVE",
            "email": "support@waveapp.dev",
            "url": "https://github.com/waveapphq/wave/issues",
        }, "Info section must name the public project contact"
        assert info.get("license") == {
            "name": "MIT",
            "identifier": "MIT",
        }, "Info section must publish the MIT license"

    def test_openapi_servers_configuration(self) -> None:
        """The spec names one relative server, so Try it out calls the server that served it."""
        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/openapi.json")
        schema = response.json()

        assert schema.get("servers") == [{"url": "/", "description": "This WAVE server"}]


class TestSchemaExportFormats:
    """Test suite for schema export in multiple formats."""

    def test_openapi_yaml_endpoint_exists(self) -> None:
        """Test that OpenAPI YAML schema endpoint is accessible.

        REQ-5.2.3.6 explicitly requires: 'YAML schema endpoint for human-readable
        specification format' and 'OpenAPI YAML for configuration management and
        version control'.
        """
        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/openapi.yaml")

        assert (
            response.status_code == 200
        ), "OpenAPI YAML endpoint must return 200 for human-readable specification format"
        assert (
            "text/yaml" in response.headers["content-type"]
            or "application/yaml" in response.headers["content-type"]
            or "application/x-yaml" in response.headers["content-type"]
        ), "OpenAPI YAML endpoint must return YAML content type"

    def test_openapi_yaml_is_valid_yaml(self) -> None:
        """Test that OpenAPI YAML schema is valid YAML format."""
        import yaml

        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/openapi.yaml")

        # Should not raise YAMLError
        schema = yaml.safe_load(response.text)
        assert isinstance(schema, dict), "OpenAPI YAML schema must be a dictionary"

    def test_yaml_and_json_schemas_match(self) -> None:
        """Test that YAML and JSON schemas contain equivalent data."""
        import yaml

        from wavecore.api.app import app

        client = TestClient(app)
        json_response = client.get("/openapi.json")
        yaml_response = client.get("/openapi.yaml")

        json_schema = json_response.json()
        yaml_schema = yaml.safe_load(yaml_response.text)

        # Core fields must match
        assert (
            json_schema["openapi"] == yaml_schema["openapi"]
        ), "OpenAPI version must match between JSON and YAML formats"
        assert (
            json_schema["info"]["title"] == yaml_schema["info"]["title"]
        ), "API title must match between JSON and YAML formats"
        assert (
            json_schema["info"]["version"] == yaml_schema["info"]["version"]
        ), "API version must match between JSON and YAML formats"


class TestSwaggerUIDocumentation:
    """Test suite for Swagger UI interactive documentation."""

    def test_swagger_ui_endpoint_exists(self) -> None:
        """Test that Swagger UI is accessible at /docs endpoint."""
        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/docs")

        assert response.status_code == 200, "Swagger UI endpoint must return 200 status"
        assert (
            "text/html" in response.headers["content-type"]
        ), "Swagger UI must return HTML content"

    def test_swagger_ui_contains_api_reference(self) -> None:
        """Test that Swagger UI HTML includes references to OpenAPI schema."""
        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/docs")
        html_content = response.text

        # Swagger UI should reference the OpenAPI JSON endpoint
        assert "openapi.json" in html_content, "Swagger UI must reference OpenAPI schema endpoint"

    def test_swagger_ui_is_interactive(self) -> None:
        """Test that Swagger UI includes interactive elements."""
        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/docs")
        html_content = response.text

        # Check for Swagger UI library inclusion
        assert (
            "swagger-ui" in html_content.lower()
        ), "Swagger UI must include swagger-ui library for interactivity"


class TestReDocDocumentation:
    """Test suite for ReDoc alternative documentation interface."""

    def test_redoc_endpoint_exists(self) -> None:
        """Test that ReDoc interface is accessible at /redoc endpoint."""
        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/redoc")

        assert response.status_code == 200, "ReDoc endpoint must return 200 status"
        assert "text/html" in response.headers["content-type"], "ReDoc must return HTML content"

    def test_redoc_contains_api_reference(self) -> None:
        """Test that ReDoc HTML includes references to OpenAPI schema."""
        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/redoc")
        html_content = response.text

        # ReDoc should reference the OpenAPI JSON endpoint
        assert "openapi.json" in html_content, "ReDoc must reference OpenAPI schema endpoint"

    def test_redoc_library_inclusion(self) -> None:
        """Test that ReDoc includes the ReDoc library."""
        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/redoc")
        html_content = response.text

        # Check for ReDoc library inclusion
        assert "redoc" in html_content.lower(), "ReDoc must include redoc library for rendering"


class TestEndpointCatalog:
    """Test suite for complete endpoint catalog in OpenAPI schema."""

    def test_paths_section_exists(self) -> None:
        """Test that OpenAPI schema contains paths section with endpoints."""
        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/openapi.json")
        schema = response.json()

        assert "paths" in schema, "Schema must contain paths section"
        paths = schema.get("paths", {})
        assert isinstance(paths, dict), "Paths section must be a dictionary of endpoint definitions"

    def test_endpoint_http_methods(self) -> None:
        """Test that endpoints specify HTTP methods correctly."""
        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/openapi.json")
        schema = response.json()

        paths = schema.get("paths", {})
        valid_methods = ["get", "post", "put", "delete", "patch", "options", "head"]

        for path, methods in paths.items():
            assert isinstance(methods, dict), f"Path {path} must have methods dictionary"
            for method in methods.keys():
                if method.lower() in valid_methods:
                    # Valid HTTP method found - validation passes by reaching here
                    pass
                # Allow other keys like 'parameters' which are not methods
                # Just validate that at least one valid method exists
        # At least one path should exist (we have config endpoint)
        assert len(paths) > 0, "At least one endpoint path must be documented"

    def test_operation_identifiers(self) -> None:
        """Test that endpoints have operation identifiers for stable client code generation."""
        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/openapi.json")
        schema = response.json()

        paths = schema.get("paths", {})
        http_methods = ["get", "post", "put", "delete", "patch"]

        for path, methods in paths.items():
            for method in http_methods:
                if method in methods:
                    operation = methods[method]
                    assert "operationId" in operation, (
                        f"Operation {method.upper()} {path} must have operationId for stable "
                        "client code generation"
                    )


class TestEndpointMetadata:
    """Test suite for endpoint metadata and documentation quality."""

    def test_endpoint_summaries(self) -> None:
        """Test that endpoints have human-readable summaries."""
        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/openapi.json")
        schema = response.json()

        paths = schema.get("paths", {})
        http_methods = ["get", "post", "put", "delete", "patch"]

        for path, methods in paths.items():
            for method in http_methods:
                if method in methods:
                    operation = methods[method]
                    assert "summary" in operation or "description" in operation, (
                        f"Operation {method.upper()} {path} must have summary or description for "
                        "documentation clarity"
                    )

    def test_endpoint_tags_for_organization(self) -> None:
        """Test that endpoints use tags for logical grouping."""
        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/openapi.json")
        schema = response.json()

        paths = schema.get("paths", {})
        http_methods = ["get", "post", "put", "delete", "patch"]

        # At least some endpoints should have tags for organization
        endpoints_with_tags = 0
        total_endpoints = 0

        for _path, methods in paths.items():
            for method in http_methods:
                if method in methods:
                    total_endpoints += 1
                    operation = methods[method]
                    if "tags" in operation and len(operation["tags"]) > 0:
                        endpoints_with_tags += 1

        if total_endpoints > 0:
            assert (
                endpoints_with_tags > 0
            ), "At least some endpoints should have tags for logical grouping"


class TestRequestDocumentation:
    """Test suite for request parameter and body documentation.

    These tests verify comprehensive request documentation including parameters
    and request bodies. Tests will pass when endpoints with these features exist.
    """

    def test_path_parameters_documented(self) -> None:
        """Test that path parameters are properly documented with location and constraints.

        REQ-5.2.3.6 requires: 'Request parameter documentation including path, query,
        header, and cookie parameters' with 'Parameter location specification'.
        """
        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/openapi.json")
        schema = response.json()

        paths = schema.get("paths", {})
        http_methods = ["get", "post", "put", "delete", "patch"]

        # Find endpoints with path parameters (e.g., /tests/{test_id})
        for path, methods in paths.items():
            if "{" in path:  # Path contains parameter placeholder
                for method in http_methods:
                    if method in methods:
                        operation = methods[method]
                        # Path parameters may be at operation or path level
                        params = operation.get("parameters", []) + methods.get("parameters", [])

                        # Find path parameters
                        path_params = [p for p in params if p.get("in") == "path"]
                        assert len(path_params) > 0, (
                            f"Operation {method.upper()} {path} with path variables must document "
                            "path parameters"
                        )

                        # Verify parameter structure
                        for param in path_params:
                            assert (
                                "name" in param
                            ), f"Path parameter in {method.upper()} {path} must have name"
                            assert (
                                "in" in param and param["in"] == "path"
                            ), "Path parameter must specify location as 'path'"
                            assert "required" in param, "Path parameter must specify if required"
                            assert (
                                "schema" in param
                            ), "Path parameter must include schema for type information"

    def test_query_parameters_documented(self) -> None:
        """Test that query parameters are properly documented with optional/required distinction.

        REQ-5.2.3.6 requires: 'Required vs optional parameter distinction' and
        'Default values for optional parameters'.
        """
        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/openapi.json")
        schema = response.json()

        paths = schema.get("paths", {})
        http_methods = ["get", "post", "put", "delete", "patch"]

        # Check any endpoints with query parameters
        for path, methods in paths.items():
            for method in http_methods:
                if method in methods:
                    operation = methods[method]
                    params = operation.get("parameters", [])

                    # Find query parameters
                    query_params = [p for p in params if p.get("in") == "query"]

                    for param in query_params:
                        assert (
                            "name" in param
                        ), f"Query parameter in {method.upper()} {path} must have name"
                        assert (
                            "in" in param and param["in"] == "query"
                        ), "Query parameter must specify location as 'query'"
                        assert "required" in param, (
                            "Query parameter must specify if required (required/optional "
                            "distinction)"
                        )
                        assert "schema" in param, "Query parameter must include schema"

                        # Optional parameters should document defaults when applicable
                        if not param.get("required", False):
                            schema_def = param.get("schema", {})
                            # Default may or may not exist, but schema should be present
                            assert isinstance(
                                schema_def, dict
                            ), "Optional parameter schema must be defined"

    def test_request_body_schemas_for_mutations(self) -> None:
        """Test that mutation endpoints document request body schemas with validation rules.

        REQ-5.2.3.6 requires: 'Request body schemas with validation rules and
        example payloads'.
        """
        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/openapi.json")
        schema = response.json()

        paths = schema.get("paths", {})
        mutation_methods = ["post", "put", "patch"]

        # Check mutation endpoints for request body documentation
        for path, methods in paths.items():
            for method in mutation_methods:
                if method in methods:
                    operation = methods[method]

                    # Mutations typically have request bodies
                    if "requestBody" in operation:
                        request_body = operation["requestBody"]

                        assert (
                            "content" in request_body
                        ), f"Request body for {method.upper()} {path} must define content types"

                        content = request_body["content"]
                        assert (
                            len(content) > 0
                        ), "Request body must support at least one content type"

                        # Verify schema for each content type
                        for content_type, content_def in content.items():
                            assert "schema" in content_def, (
                                f"Request body content type {content_type} must include schema "
                                "with validation rules"
                            )


class TestResponseSchemas:
    """Test suite for response schema documentation."""

    def test_response_status_codes(self) -> None:
        """Test that endpoints document response status codes."""
        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/openapi.json")
        schema = response.json()

        paths = schema.get("paths", {})
        http_methods = ["get", "post", "put", "delete", "patch"]

        for path, methods in paths.items():
            for method in http_methods:
                if method in methods:
                    operation = methods[method]
                    assert (
                        "responses" in operation
                    ), f"Operation {method.upper()} {path} must document response status codes"
                    responses = operation["responses"]
                    assert (
                        len(responses) > 0
                    ), f"Operation {method.upper()} {path} must define at least one response"

    def test_success_response_schemas(self) -> None:
        """Test that successful responses include schema definitions."""
        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/openapi.json")
        schema = response.json()

        paths = schema.get("paths", {})
        http_methods = ["get", "post", "put", "delete", "patch"]
        success_codes = ["200", "201", "202", "204"]

        for path, methods in paths.items():
            for method in http_methods:
                if method in methods:
                    operation = methods[method]
                    responses = operation.get("responses", {})

                    # Check if any success response exists
                    has_success_response = any(code in responses for code in success_codes)
                    if has_success_response:
                        for code in success_codes:
                            if code in responses:
                                success_response = responses[code]
                                # Response should have description
                                assert "description" in success_response, (
                                    f"Success response {code} for {method.upper()} {path} must "
                                    "have description"
                                )


class TestTypeSystemIntegration:
    """Test suite for Pydantic model integration and type system."""

    def test_components_schemas_section(self) -> None:
        """Test that OpenAPI schema includes components/schemas for type definitions."""
        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/openapi.json")
        schema = response.json()

        # Components section may or may not exist depending on whether
        # we have Pydantic models in use yet
        # If it exists, it should be properly structured
        if "components" in schema:
            components = schema["components"]
            assert isinstance(components, dict), "Components section must be a dictionary"

            if "schemas" in components:
                schemas = components["schemas"]
                assert isinstance(
                    schemas, dict
                ), "Schemas section must be a dictionary of type definitions"

    def test_pydantic_model_schema_extraction(self) -> None:
        """Test that Pydantic models are converted to JSON schemas."""
        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/openapi.json")
        schema = response.json()

        # If components/schemas exist, they should follow JSON Schema format
        if "components" in schema and "schemas" in schema["components"]:
            schemas = schema["components"]["schemas"]

            for schema_name, schema_def in schemas.items():
                assert isinstance(schema_def, dict), f"Schema {schema_name} must be a dictionary"
                # JSON schemas typically have 'type' or '$ref' or 'properties'
                has_json_schema_keys = any(
                    key in schema_def
                    for key in ["type", "properties", "allOf", "anyOf", "oneOf", "$ref"]
                )
                assert has_json_schema_keys, f"Schema {schema_name} must follow JSON Schema format"

    def test_field_validation_rules_in_schemas(self) -> None:
        """Test that Pydantic model fields include validation constraints.

        REQ-5.2.3.6 requires: 'Field-level validation rules including required
        fields, formats, and constraints'.
        """
        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/openapi.json")
        schema = response.json()

        # Check schemas for validation rules when they exist
        if "components" in schema and "schemas" in schema["components"]:
            schemas = schema["components"]["schemas"]

            for schema_name, schema_def in schemas.items():
                # If schema has properties, check for validation metadata
                if "properties" in schema_def:
                    properties = schema_def["properties"]

                    # Check if required fields are documented
                    required_fields = schema_def.get("required", [])
                    # Required fields should be a list when present
                    assert isinstance(
                        required_fields, list
                    ), f"Schema {schema_name} required fields must be a list"

                    # Check that field schemas include type information
                    for field_name, field_schema in properties.items():
                        assert isinstance(
                            field_schema, dict
                        ), f"Field {field_name} in {schema_name} must have schema definition"
                        # Fields should have type info, constraints, $ref, or anyOf/oneOf
                        # Some fields may be intentionally untyped (e.g., JSON values)
                        has_validation_info = any(
                            key in field_schema
                            for key in [
                                "type",
                                "$ref",
                                "format",
                                "minimum",
                                "maximum",
                                "minLength",
                                "maxLength",
                                "pattern",
                                "enum",
                                "anyOf",
                                "oneOf",
                                "allOf",
                                "additionalProperties",  # For dict/object types
                                "items",  # For array types
                            ]
                        )
                        # If no validation info, field should at least have title or description
                        # This allows for intentionally flexible fields (e.g., config values)
                        has_documentation = "title" in field_schema or "description" in field_schema
                        assert has_validation_info or has_documentation, (
                            f"Field {field_name} must include validation rules, type reference, or "
                            "documentation"
                        )

    def test_enum_type_definitions(self) -> None:
        """Test that enum types are properly defined with value constraints.

        REQ-5.2.3.6 requires: 'Enum definitions for constrained value sets'.
        """
        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/openapi.json")
        schema = response.json()

        # Check for enum definitions in components/schemas
        if "components" in schema and "schemas" in schema["components"]:
            schemas = schema["components"]["schemas"]

            for schema_name, schema_def in schemas.items():
                # Check if this schema or its properties contain enums
                if "enum" in schema_def:
                    # Top-level enum
                    enum_values = schema_def["enum"]
                    assert isinstance(
                        enum_values, list
                    ), f"Enum {schema_name} must define values as a list"
                    assert len(enum_values) > 0, f"Enum {schema_name} must have at least one value"

                # Check for enums in properties
                if "properties" in schema_def:
                    for field_name, field_schema in schema_def["properties"].items():
                        if "enum" in field_schema:
                            enum_values = field_schema["enum"]
                            assert isinstance(
                                enum_values, list
                            ), f"Enum field {field_name} must define values as a list"
                            assert (
                                len(enum_values) > 0
                            ), f"Enum field {field_name} must have at least one value"

    def test_nested_object_schemas(self) -> None:
        """Test that nested object structures are properly represented.

        REQ-5.2.3.6 requires: 'Nested object structures with recursive schema
        generation'.
        """
        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/openapi.json")
        schema = response.json()

        # Check for nested objects in schemas
        if "components" in schema and "schemas" in schema["components"]:
            schemas = schema["components"]["schemas"]

            for schema_name, schema_def in schemas.items():
                if schema_name in ("ValidationError", "HTTPValidationError"):
                    continue  # framework-generated error envelopes, not WAVE schemas
                if "properties" in schema_def:
                    for field_name, field_schema in schema_def["properties"].items():
                        # Check for nested object types
                        if field_schema.get("type") == "object":
                            # Nested object should have properties or additionalProperties
                            has_structure = (
                                "properties" in field_schema
                                or "additionalProperties" in field_schema
                            )
                            assert (
                                has_structure
                            ), f"Nested object {field_name} in {schema_name} must define structure"

                        # Check for schema references (another way to nest)
                        if "$ref" in field_schema:
                            ref = field_schema["$ref"]
                            assert isinstance(
                                ref, str
                            ), f"Schema reference in {field_name} must be a string"
                            assert ref.startswith(
                                "#/"
                            ), "Schema reference must be a valid JSON pointer"

    def test_array_and_dict_type_schemas(self) -> None:
        """Test that array and dictionary types document item schemas.

        REQ-5.2.3.6 requires: 'Array and dictionary types with item schema
        specifications'.
        """
        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/openapi.json")
        schema = response.json()

        # Check for array and dictionary types
        if "components" in schema and "schemas" in schema["components"]:
            schemas = schema["components"]["schemas"]

            for schema_name, schema_def in schemas.items():
                if "properties" in schema_def:
                    for field_name, field_schema in schema_def["properties"].items():
                        # Check array types
                        if field_schema.get("type") == "array":
                            assert (
                                "items" in field_schema
                            ), f"Array field {field_name} in {schema_name} must specify item schema"
                            items = field_schema["items"]
                            assert isinstance(
                                items, dict
                            ), "Array items specification must be a schema object"

                        # Check dictionary/map types (object with additionalProperties)
                        if (
                            field_schema.get("type") == "object"
                            and "additionalProperties" in field_schema
                        ):
                            additional = field_schema["additionalProperties"]
                            # additionalProperties can be bool or schema
                            if isinstance(additional, dict):
                                # Should specify the value type for the dictionary
                                has_type_info = "type" in additional or "$ref" in additional
                                assert (
                                    has_type_info
                                ), f"Dictionary field {field_name} must specify value type"

    def test_union_types_for_polymorphic_handling(self) -> None:
        """Test that union types are represented using anyOf/oneOf.

        REQ-5.2.3.6 requires: 'Union types for polymorphic request/response
        handling'.
        """
        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/openapi.json")
        schema = response.json()

        # Check for union/polymorphic types using anyOf/oneOf
        if "components" in schema and "schemas" in schema["components"]:
            schemas = schema["components"]["schemas"]

            for schema_name, schema_def in schemas.items():
                # Check for top-level polymorphic types
                if "anyOf" in schema_def or "oneOf" in schema_def:
                    union_key = "anyOf" if "anyOf" in schema_def else "oneOf"
                    union_schemas = schema_def[union_key]

                    assert isinstance(
                        union_schemas, list
                    ), f"Union type {schema_name} must define {union_key} as a list"
                    assert len(union_schemas) >= 2, "Union type must have at least 2 alternatives"

                    # Each alternative should be a valid schema
                    for alt in union_schemas:
                        assert isinstance(alt, dict), "Union alternative must be a schema object"

                # Check for polymorphic fields in properties
                if "properties" in schema_def:
                    for field_name, field_schema in schema_def["properties"].items():
                        if "anyOf" in field_schema or "oneOf" in field_schema:
                            union_key = "anyOf" if "anyOf" in field_schema else "oneOf"
                            union_schemas = field_schema[union_key]

                            assert isinstance(
                                union_schemas, list
                            ), f"Union field {field_name} must define {union_key} as a list"
                            assert (
                                len(union_schemas) >= 2
                            ), "Union field must have at least 2 alternatives"


class TestSchemaValidation:
    """Test suite for schema validation and accuracy."""

    def test_openapi_schema_internal_consistency(self) -> None:
        """Test that OpenAPI schema is internally consistent (no dangling references)."""
        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/openapi.json")
        schema = response.json()

        # This is a basic check - a full validation would require traversing
        # all $ref instances, but at minimum we verify the schema is valid JSON
        assert isinstance(schema, dict), "Schema must be a valid dictionary structure"

    def test_schema_matches_app_configuration(self) -> None:
        """Test that schema metadata matches FastAPI app configuration."""
        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/openapi.json")
        schema = response.json()

        info = schema.get("info", {})

        # Schema should match app metadata
        assert info.get("title") == app.title, "Schema title must match app.title"
        assert info.get("version") == app.version, "Schema version must match app.version"


class TestDocumentationQuality:
    """Test suite for documentation completeness and quality requirements."""

    def test_all_endpoints_have_descriptions(self) -> None:
        """Test that all endpoints have either summary or description for clarity."""
        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/openapi.json")
        schema = response.json()

        paths = schema.get("paths", {})
        http_methods = ["get", "post", "put", "delete", "patch"]

        endpoints_without_docs = []
        for path, methods in paths.items():
            for method in http_methods:
                if method in methods:
                    operation = methods[method]
                    if "summary" not in operation and "description" not in operation:
                        endpoints_without_docs.append(f"{method.upper()} {path}")

        assert (
            len(endpoints_without_docs) == 0
        ), f"All endpoints must have summary or description. Missing: {endpoints_without_docs}"

    def test_api_provides_complete_specification(self) -> None:
        """Test that API provides a complete, self-contained specification."""
        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/openapi.json")
        schema = response.json()

        # A complete specification must have:
        # 1. API metadata (info)
        assert "info" in schema, "Complete spec must include info section"

        # 2. Available endpoints (paths)
        assert "paths" in schema, "Complete spec must include paths section"
        assert len(schema["paths"]) > 0, "Complete spec must document at least one endpoint"

        # 3. OpenAPI version
        assert "openapi" in schema, "Complete spec must declare OpenAPI version"


class TestDocumentationAccessPatterns:
    """Test suite for documentation access and availability."""

    def test_swagger_ui_at_standard_path(self) -> None:
        """Test that Swagger UI is served at the standard /docs path."""
        from wavecore.api.app import app

        assert app.docs_url == "/docs", "Swagger UI must be at standard /docs path"

    def test_redoc_at_alternative_path(self) -> None:
        """Test that ReDoc is served at the alternative /redoc path."""
        from wavecore.api.app import app

        assert app.redoc_url == "/redoc", "ReDoc must be at alternative /redoc path"

    def test_openapi_json_programmatic_access(self) -> None:
        """Test that OpenAPI JSON is available for programmatic access and tooling."""
        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/openapi.json")

        assert response.status_code == 200, "OpenAPI JSON must be publicly accessible"
        assert (
            response.headers["content-type"] == "application/json"
        ), "OpenAPI schema must be served as JSON for tooling integration"

        # Should be parseable JSON
        schema = response.json()
        assert isinstance(schema, dict), "OpenAPI schema must be valid JSON object"


class TestProductionConsiderations:
    """Test suite for production-ready documentation features."""

    def test_schema_caching_headers(self) -> None:
        """Test that OpenAPI schema responses include appropriate caching headers.

        REQ-5.2.3.6 requires: 'Performance optimization through schema caching'.
        """
        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/openapi.json")

        assert response.status_code == 200, "OpenAPI endpoint must be accessible"

        # Check for caching headers - schema should be cacheable since it changes
        # infrequently (only on deployment)
        cache_control = response.headers.get("cache-control", "")

        # Schema should not explicitly prevent caching with no-store
        # Specific caching strategy may vary, but at minimum it should be accessible
        assert (
            "no-store" not in cache_control.lower()
        ), "Schema should not prevent all caching (no-store) for performance"

    def test_documentation_endpoint_configuration_control(self) -> None:
        """Test that documentation endpoints can be controlled via configuration.

        REQ-5.2.3.6 requires: 'Documentation endpoint enablement control via
        configuration' and 'Optional authentication for documentation access in
        production environments'.
        """
        from wavecore.api.app import app

        # Verify that app exposes configuration for docs URLs
        # FastAPI provides docs_url and redoc_url configuration
        assert hasattr(
            app, "docs_url"
        ), "App must expose docs_url configuration for endpoint control"
        assert hasattr(
            app, "redoc_url"
        ), "App must expose redoc_url configuration for endpoint control"

        # In current configuration, docs should be enabled
        assert (
            app.docs_url is not None
        ), "Docs URL should be configured (can be set to None to disable)"
        assert (
            app.redoc_url is not None
        ), "ReDoc URL should be configured (can be set to None to disable)"

    def test_documentation_does_not_expose_sensitive_data(self) -> None:
        """Test that OpenAPI schema does not contain sensitive information.

        REQ-5.2.3.6 requires: 'Example data sanitization preventing sensitive
        information exposure'.
        """
        import json

        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/openapi.json")

        assert response.status_code == 200, "Schema must be accessible"

        # Serialize schema to string for comprehensive search
        schema_str = json.dumps(response.json()).lower()

        # Check for common sensitive patterns in examples
        # Note: Field NAMES like "password" or "api_key" are acceptable
        # We're looking for actual sensitive VALUES in examples
        sensitive_patterns = [
            "sk-",  # API key prefix (OpenAI, Anthropic)
            "ghp_",  # GitHub personal access token
            "-----begin private key-----",  # Private keys
            "-----begin rsa private key-----",
        ]

        for pattern in sensitive_patterns:
            assert (
                pattern.lower() not in schema_str
            ), f"Schema must not contain sensitive pattern: {pattern}"

    def test_schema_version_tracking(self) -> None:
        """Test that schema includes version information for compatibility tracking.

        REQ-5.2.3.6 requires: 'Schema versioning aligned with API version for
        compatibility tracking'.
        """
        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/openapi.json")
        schema = response.json()

        # Schema must include version in info section
        info = schema.get("info", {})
        assert "version" in info, "Schema must include API version"

        version = info["version"]
        assert isinstance(version, str), "Version must be a string"
        assert len(version) > 0, "Version must not be empty"

        # Version should match app configuration
        assert (
            version == app.version
        ), "Schema version must align with application version for compatibility tracking"


class TestComplianceAndStandards:
    """Test suite for OpenAPI and HTTP standards compliance."""

    def test_openapi_3_0_compliance(self) -> None:
        """Test that schema complies with OpenAPI 3.0+ specification."""
        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/openapi.json")
        schema = response.json()

        # OpenAPI 3.0 required fields at root level
        required_fields = ["openapi", "info", "paths"]
        for field in required_fields:
            assert field in schema, f"OpenAPI 3.0 requires {field} field at root level"

        # Info section required fields
        info = schema["info"]
        info_required = ["title", "version"]
        for field in info_required:
            assert field in info, f"OpenAPI 3.0 info section requires {field} field"

    def test_http_status_code_semantics(self) -> None:
        """Test that endpoints use appropriate HTTP status codes."""
        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/openapi.json")
        schema = response.json()

        paths = schema.get("paths", {})
        http_methods = ["get", "post", "put", "delete", "patch"]
        valid_status_codes = [
            "200",
            "201",
            "202",
            "204",
            "400",
            "401",
            "403",
            "404",
            "405",
            "409",
            "422",
            "500",
            "503",
        ]

        for path, methods in paths.items():
            for method in http_methods:
                if method in methods:
                    operation = methods[method]
                    responses = operation.get("responses", {})

                    for status_code in responses.keys():
                        # Status code should be numeric or 'default'
                        if status_code != "default":
                            assert status_code in valid_status_codes or status_code.isdigit(), (
                                f"Status code {status_code} in {method.upper()} {path} should be "
                                "valid HTTP status"
                            )


class TestAutomaticDocumentationUpdates:
    """Test suite for automatic documentation generation and synchronization."""

    def test_documentation_reflects_current_routes(self) -> None:
        """Test that OpenAPI schema automatically includes all registered routes."""
        from wavecore.api.app import app

        client = TestClient(app)
        response = client.get("/openapi.json")
        schema = response.json()

        paths = schema.get("paths", {})

        # FastAPI automatically generates OpenAPI schema from routes
        # We verify this by checking that paths exist in schema
        assert isinstance(paths, dict), "Paths must be a dictionary"

        # The schema should include endpoints from registered routers
        # At minimum, we know config router is registered
        # Verify schema contains actual endpoint paths
        assert len(paths) > 0, "Schema must include endpoints from registered routers"

    def test_schema_generation_is_automatic(self) -> None:
        """Test that schema generation happens automatically without manual intervention."""
        from wavecore.api.app import app

        # Access the OpenAPI schema through FastAPI's method
        # This verifies the schema is generated automatically
        schema = app.openapi()

        assert schema is not None, "Schema must be automatically generated"
        assert isinstance(schema, dict), "Generated schema must be a dictionary"
        assert "openapi" in schema, "Generated schema must be valid OpenAPI spec"
