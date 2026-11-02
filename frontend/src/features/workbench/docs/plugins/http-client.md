---
id: http-client
description: Send HTTP/HTTPS requests and capture responses
versions:
  - version: "1.0.0"
    releaseDate: "2026-09-06"
    changelog:
      - "Initial release with full HTTP client support"
      - "Response File Path: the full save target as artifact:// or an absolute or relative path where the block runs, chosen with Browse; empty keeps the automatic name and location"
      - "Methods: GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS"
      - "Key-value header editor with string-only values"
      - "Conditional body field visibility based on HTTP method"
      - "Query parameters support with key-value editor"
      - "Configurable timeout in seconds"
      - "Retry with exponential backoff (Retry Count, Retry Delay, Backoff Factor)"
      - "Configurable Retryable Codes for automatic retry"
      - "SSL certificate verification with custom CA Certificate support"
      - "Redirect control (Allow Redirects, Max Redirects)"
      - "Full output set: Status Code, Body, Headers, Content Type, Response Time, Final URL"
---

The HTTP Client plugin sends HTTP/HTTPS requests to remote endpoints and captures the response for use in workflow variables.

**Use Cases:**
- Test REST API endpoints with configurable methods, headers, and body
- Validate HTTP response status codes and response bodies
- Chain API calls using expression evaluation for dynamic URLs
- Send DELETE requests with body payloads (RFC 9110 compliant)
- Monitor endpoint health with retry and timeout controls

**Behavior:**
- Supports all standard HTTP methods (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS)
- Headers are configured as key-value pairs with string values
- Request body is available for POST, PUT, PATCH, and DELETE methods
- Query parameters are appended to the URL as ?key=value&key2=value2
- Retry uses exponential backoff (e.g. Retry Delay=1s, Backoff Factor=2: waits 1s, 2s, 4s, 8s)
- SSL verification can be disabled for self-signed certificates
- Follows redirects by default with configurable hop limit
- Proxy has two choices. WAVE setting, the default, follows Settings > Network > Proxy. Off connects directly, whatever that setting says. On a remote host the block uses that host's own proxy settings, and the Proxy row is disabled and says so
- A file sent with its content type on Auto gets the type from the file's extension in WAVE's own file-type table, so the same file is sent with the same type from every WAVE host. An extension the table does not know is sent as application/octet-stream. A content type you choose yourself always overrides it

**Parameters:**
- **URL**: Target URL (use expression mode for dynamic values)
- **Method**: HTTP method (default: GET)
- **Headers**: Request headers as key-value pairs
- **Body**: Request body (visible for POST/PUT/PATCH/DELETE only)
- **Query Params**: URL query parameters as key-value pairs
- **Timeout**: Request timeout in seconds (default: 30)
- **Retry Count**: Number of retry attempts on failure (default: 0)
- **Retry Delay**: Initial delay between retries in seconds (default: 1)
- **Backoff Factor**: Exponential backoff multiplier (default: 2)
- **Retryable Codes**: HTTP status codes that trigger retry (default: 502, 503, 504)
- **File Path**: Where the download is saved when Response is File: artifact:// or an absolute or relative path where the block runs; empty keeps the automatic name and location
- **Verify Server Certificate**: Verify the server certificate against CA Certificate when it is set, otherwise against the certificates WAVE trusts (Settings > Network > Certificates) (default: true)
- **CA Certificate**: Custom CA certificate (file path, variable reference, or PEM string); when set, it is the only certificate this block trusts
- **Allow Redirects**: Follow HTTP 3xx redirects (default: true)
- **Max Redirects**: Maximum redirect hops (default: 10)
- **Proxy**: WAVE setting follows Settings > Network > Proxy; Off connects directly (default: WAVE setting)

**Outputs:**
- **Status Code**: HTTP response status code (e.g., 200, 404, 500)
- **Body**: Response body as string (JSON, HTML, XML, or plain text)
- **Headers**: Response headers as key-value map
- **Content Type**: Response Content-Type header (e.g., application/json)
- **Response Time**: Request duration in seconds
- **Final URL**: Final URL after following redirects
