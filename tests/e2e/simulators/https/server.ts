/**
 * HTTPS Simulator for E2E Testing
 *
 * Two servers in one process:
 * - HTTPS server on HTTPS_SIMULATOR_PORT (default 9443) - serves JSON with self-signed cert
 * - HTTP health server on HTTPS_HEALTH_PORT (default 9444) - Playwright webServer health check
 *
 * Endpoints (HTTPS):
 *   GET  /health              -> {"status":"healthy","protocol":"https","timestamp":"..."}
 *   *    /echo                -> echoes method, path, query params, headers, body
 *   GET  /delay/:seconds      -> responds after N seconds (for timeout testing)
 *   GET  /status/:code        -> responds with the given HTTP status code
 *   *    /retry               -> returns 502 first N times (via ?fail_count=N), then 200
 *   GET  /redirect/:count     -> redirects N times via 302, then returns 200
 *   GET  /redirect-to?url=... -> single redirect to the given URL
 *   GET  /cookie?value=...    -> responds with a Set-Cookie credential header
 *   GET  /secret-payload      -> secret in the JSON body + a non-catalog custom header
 *
 * Health (HTTP):
 *   GET  /health -> {"status":"healthy","port":<https_port>}
 */

import https from 'node:https'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const HTTPS_PORT = parseInt(process.env.HTTPS_SIMULATOR_PORT || '9443', 10)
const HEALTH_PORT = parseInt(process.env.HTTPS_HEALTH_PORT || '9444', 10)

const certsDir = path.join(__dirname, 'certs')
const tlsOptions = {
  key: fs.readFileSync(path.join(certsDir, 'server.key')),
  cert: fs.readFileSync(path.join(certsDir, 'server.crt')),
  ca: fs.readFileSync(path.join(certsDir, 'ca.pem')),
}

// Per-key retry counters: /retry?key=foo&fail_count=3 -> fail 3 times, then succeed
const retryCounters = new Map<string, number>()

// Per-key timeout armed flags: /timeout/arm?key=foo arms it, /timeout?key=foo triggers
// First call after arm -> delays (client times out, retries), second call -> instant
const timeoutArmed = new Map<string, boolean>()

function jsonResponse(res: http.ServerResponse, statusCode: number, body: unknown) {
  const json = JSON.stringify(body)
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json).toString(),
  })
  res.end(json)
}

function collectBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
  })
}

// HTTPS request handler
async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url || '/', `https://localhost:${HTTPS_PORT}`)
  const method = (req.method || 'GET').toUpperCase()

  // --- /health ---
  if (url.pathname === '/health') {
    return jsonResponse(res, 200, {
      status: 'healthy',
      protocol: 'https',
      timestamp: new Date().toISOString(),
    })
  }

  // --- /echo (all methods; bodies collected regardless of method) ---
  if (url.pathname === '/echo') {
    const body = await collectBody(req)
    const queryParams: Record<string, string> = {}
    url.searchParams.forEach((v, k) => { queryParams[k] = v })

    return jsonResponse(res, 200, {
      method,
      path: url.pathname,
      query_params: queryParams,
      ...(body !== '' && { body }),
      headers: req.headers,
    })
  }

  // --- /delay/:seconds ---
  const delayMatch = url.pathname.match(/^\/delay\/(\d+(?:\.\d+)?)$/)
  if (delayMatch) {
    const seconds = parseFloat(delayMatch[1])
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
    return jsonResponse(res, 200, {
      delayed_by: seconds,
      message: `Responded after ${seconds}s delay`,
    })
  }

  // --- /status/:code ---
  const statusMatch = url.pathname.match(/^\/status\/(\d{3})$/)
  if (statusMatch) {
    const code = parseInt(statusMatch[1], 10)
    return jsonResponse(res, code, {
      requested_status: code,
      message: `Responded with status ${code}`,
    })
  }

  // --- /retry?key=<key>&fail_count=<n>&fail_status=<code> ---
  // Returns fail_status (default 502) for the first fail_count requests per key, then 200
  if (url.pathname === '/retry') {
    const key = url.searchParams.get('key') || 'default'
    const failCount = parseInt(url.searchParams.get('fail_count') || '2', 10)
    const failStatus = parseInt(url.searchParams.get('fail_status') || '502', 10)
    const current = retryCounters.get(key) || 0
    retryCounters.set(key, current + 1)

    if (current < failCount) {
      return jsonResponse(res, failStatus, {
        attempt: current + 1,
        fail_count: failCount,
        message: `Simulated failure ${current + 1}/${failCount}`,
      })
    }
    // Reset counter for next test run
    retryCounters.delete(key)
    return jsonResponse(res, 200, {
      attempt: current + 1,
      fail_count: failCount,
      message: 'Success after retries',
    })
  }

  // --- /retry/reset ---
  // Clears all retry counters (call between test runs)
  if (url.pathname === '/retry/reset') {
    retryCounters.clear()
    return jsonResponse(res, 200, { message: 'Retry counters reset' })
  }

  // --- /timeout/arm?key=<key> ---
  // Arms the timeout for the given key. Next call to /timeout with this key will delay.
  if (url.pathname === '/timeout/arm') {
    const key = url.searchParams.get('key') || 'default'
    timeoutArmed.set(key, true)
    return jsonResponse(res, 200, { message: 'Timeout armed', key })
  }

  // --- /timeout?key=<key>&delay=<seconds> ---
  // If armed: delays for `delay` seconds (client is expected to time out, then retry).
  // The flag is disarmed immediately so the retry call returns instantly.
  if (url.pathname === '/timeout') {
    const key = url.searchParams.get('key') || 'default'
    const delay = parseFloat(url.searchParams.get('delay') || '10')

    if (timeoutArmed.get(key)) {
      timeoutArmed.set(key, false) // Disarm so retry is fast
      await new Promise(resolve => setTimeout(resolve, delay * 1000))
      // Client likely disconnected already; only respond if still writable
      if (!res.writableEnded) {
        return jsonResponse(res, 200, { message: 'Delayed response', delayed_by: delay })
      }
      return
    }
    // Not armed: respond immediately
    return jsonResponse(res, 200, { message: 'Timeout test passed', key })
  }

  // --- /redirect/:count ---
  // Redirects count times via 302, then returns 200
  const redirectMatch = url.pathname.match(/^\/redirect\/(\d+)$/)
  if (redirectMatch) {
    const remaining = parseInt(redirectMatch[1], 10)
    if (remaining > 0) {
      res.writeHead(302, { Location: `/redirect/${remaining - 1}` })
      return res.end()
    }
    return jsonResponse(res, 200, {
      message: 'Redirect chain complete',
      final: true,
    })
  }

  // --- /cookie?value=<cookie-value> ---
  // Responds with a Set-Cookie credential header (secret-masking E2E: the
  // HTTP plugin registers response credential-header values with the run
  // registry, so the cookie value must mask in all downstream output).
  if (url.pathname === '/cookie') {
    // Default is deliberately server-side so the credential never appears in
    // the request URL (which is logged before the response registers it).
    const value = url.searchParams.get('value') || 'wave-c00kie-s3cr3t-4417'
    const json = JSON.stringify({ message: 'cookie issued' })
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(json).toString(),
      'Set-Cookie': `wave_session=${value}; Path=/; HttpOnly`,
    })
    return res.end(json)
  }

  // --- /secret-payload?token=<body-value>&session=<header-value> ---
  // Plants a secret in BOTH the JSON body and a custom response header. The
  // body is plain content and X-Custom-Session is deliberately NOT a
  // credential-catalog header, so only the block's outputSecretFields marking
  // (not the plugin's structural catalog) can mask them - the exact surfaces
  // the secret-aware I/O logging must protect.
  if (url.pathname === '/secret-payload') {
    // Defaults are server-side so the secrets never ride the request URL
    // (logged before the response registers them) - same as /cookie.
    const token = url.searchParams.get('token') || 'cnr6-body-a1b2c3d4-epsilon-real-bytes'
    const session = url.searchParams.get('session') || 'cnr6-hdr-a1b2c3d4-zeta-real-bytes'
    const json = JSON.stringify({ token })
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(json).toString(),
      'X-Custom-Session': session,
    })
    return res.end(json)
  }

  // --- /redirect-to?url=<target> ---
  // Single 302 redirect to the target URL
  if (url.pathname === '/redirect-to') {
    const target = url.searchParams.get('url')
    if (target) {
      res.writeHead(302, { Location: target })
      return res.end()
    }
    return jsonResponse(res, 400, { error: 'Missing url parameter' })
  }

  // Default catch-all
  return jsonResponse(res, 200, {
    message: 'HTTPS simulator',
    path: url.pathname,
  })
}

// Start HTTPS server
const httpsServer = https.createServer(tlsOptions, (req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error('[HTTPS Simulator] Error:', err)
    jsonResponse(res, 500, { error: 'Internal server error' })
  })
})

httpsServer.listen(HTTPS_PORT, () => {
  console.log(`[HTTPS Simulator] Listening on https://localhost:${HTTPS_PORT}`)
})

// Start HTTP health check server (for Playwright webServer readiness)
const healthServer = http.createServer((_req, res) => {
  jsonResponse(res, 200, { status: 'healthy', port: HTTPS_PORT })
})

healthServer.listen(HEALTH_PORT, () => {
  console.log(`[HTTPS Simulator] Health check on http://localhost:${HEALTH_PORT}/health`)
})

// Graceful shutdown
function shutdown() {
  console.log('[HTTPS Simulator] Shutting down...')
  httpsServer.close()
  healthServer.close()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
