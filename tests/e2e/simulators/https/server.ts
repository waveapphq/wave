/** HTTPS simulator for E2E tests, plus an HTTP health server for compose. */

import https from 'node:https'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const HTTPS_PORT = parseInt(process.env.HTTPS_SIMULATOR_PORT || '9443', 10)
const HEALTH_PORT = parseInt(process.env.HTTPS_HEALTH_PORT || '9444', 10)
const SELF_ORIGIN = `https://localhost:${HTTPS_PORT}`

const certsDir = path.join(__dirname, 'certs')
const tlsOptions = {
  key: fs.readFileSync(path.join(certsDir, 'server.key')),
  cert: fs.readFileSync(path.join(certsDir, 'server.crt')),
  ca: fs.readFileSync(path.join(certsDir, 'ca.pem')),
}

// Per-key retry counters: /retry?key=foo&fail_count=3 -> fail 3 times, then succeed
const retryCounters = new Map<string, number>()

// Per-key timeout flag: the first /timeout call after an arm delays, the retry returns at once.
const timeoutArmed = new Map<string, boolean>()

function jsonResponse(res: http.ServerResponse, statusCode: number, body: unknown) {
  const json = JSON.stringify(body)
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json).toString(),
  })
  res.end(json)
}

/** True when `target` is a path on this simulator: one leading slash, no backslash. */
function isLocalUrl(target: string): boolean {
  if (!target.startsWith('/') || target.startsWith('//') || target.includes('\\')) return false
  try {
    return new URL(target, SELF_ORIGIN).origin === SELF_ORIGIN
  } catch {
    return false
  }
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
  const url = new URL(req.url || '/', SELF_ORIGIN)
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

  // --- /retry: fail_status (default 502) fail_count times per key, then 200 ---
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

  // --- /retry/reset: clears all retry counters ---
  if (url.pathname === '/retry/reset') {
    retryCounters.clear()
    return jsonResponse(res, 200, { message: 'Retry counters reset' })
  }

  // --- /timeout/arm?key=<key>: the next /timeout call with this key delays ---
  if (url.pathname === '/timeout/arm') {
    const key = url.searchParams.get('key') || 'default'
    timeoutArmed.set(key, true)
    return jsonResponse(res, 200, { message: 'Timeout armed', key })
  }

  // --- /timeout: delays once when armed, then disarms so the retry is instant ---
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

  // --- /redirect/:count: count 302 redirects, then 200 ---
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

  // --- /cookie?value=<cookie-value>: a Set-Cookie credential header that must mask in all output ---
  if (url.pathname === '/cookie') {
    // Server-side default: the request URL is logged before the response registers the credential.
    const value = url.searchParams.get('value') || 'wave-c00kie-s3cr3t-4417'
    const json = JSON.stringify({ message: 'cookie issued' })
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(json).toString(),
      'Set-Cookie': `wave_session=${value}; Path=/; HttpOnly`,
    })
    return res.end(json)
  }

  // --- /secret-payload?token=<body-value>&session=<header-value>: secrets only outputSecretFields can mask ---
  if (url.pathname === '/secret-payload') {
    // Server-side defaults, as for /cookie.
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

  // --- /redirect-to?url=<path>: one 302 redirect to a path on this simulator ---
  if (url.pathname === '/redirect-to') {
    const target = url.searchParams.get('url')
    if (!target) {
      return jsonResponse(res, 400, { error: 'Missing url parameter' })
    }
    if (!isLocalUrl(target)) {
      return jsonResponse(res, 400, { error: 'url must be a path on this simulator, such as /health' })
    }
    // A './' path can never name another host, which is what CodeQL needs to see.
    res.writeHead(302, { Location: `./${target.slice(1)}` })
    return res.end()
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

// Start HTTP health check server (for the compose health check)
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
