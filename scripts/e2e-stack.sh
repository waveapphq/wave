#!/bin/bash
# WAVE E2E real-service stack controller (test-only).
#
# Owns the compose-orchestrated real-service stack (real sshd + interpreters, a
# nested jump host, a stdout-banner host, a broken-interpreter host, HTTP
# targets, a TLS matrix, forward proxies, two kwok Kubernetes API clusters, a
# path-prefix gateway in front of the published one, a Kubernetes API
# fault-injection stub, raw TCP/UDP echo targets, PostgreSQL, MariaDB, Oracle and
# SQL Server databases, an OpenSearch node, a path-prefix gateway in front of
# it and an OCI registry) that the functional E2E suite runs against. Wraps
# docker-compose talking to the rootless podman API socket and hides two podman
# 3.4.x quirks:
#   1. The stack network is pre-created via `podman network create` and its CNI
#      conflist cniVersion is patched 1.0.0 -> 0.4.0 (podman writes a version its
#      own firewall plugin rejects); compose.yaml declares the network external.
#   2. Service images are built with `podman build` (compose only references them
#      by tag) so nothing depends on compose build over the socket.
#
# Usage:
#   scripts/e2e-stack.sh build              # build service images
#   scripts/e2e-stack.sh up [--wait] [svc]  # start all (or listed) services
#   scripts/e2e-stack.sh run                # foreground (Playwright webServer): up + block + teardown on exit
#   scripts/e2e-stack.sh down               # stop + remove containers/volumes
#   scripts/e2e-stack.sh status             # compose ps
#
# CI brings the stack up before shards and tears it down on exit (see
# ci-playwright-local.sh). Local single-test runs bring up only what they need;
# `up` on a running stack is a no-op.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVICES_DIR="$PROJECT_ROOT/tests/e2e/services"
COMPOSE_FILE="$SERVICES_DIR/compose.yaml"

PROJECT="wave-e2e"
NET="wave-e2e-net"
SSHD_IMAGE="localhost/wave-e2e-sshd:latest"
HTTP_IMAGE="localhost/wave-e2e-http-target:latest"
TLS_LAB_IMAGE="localhost/wave-e2e-tls-lab:latest"
PROXY_IMAGE="localhost/wave-e2e-http-proxy:latest"
KWOK_IMAGE="localhost/wave-e2e-kwok:latest"
K8S_STUB_IMAGE="localhost/wave-e2e-k8s-stub:latest"
K8S_GATEWAY_IMAGE="localhost/wave-e2e-k8s-gateway:latest"
NETCAT_IMAGE="localhost/wave-e2e-netcat-target:latest"
POSTGRES_IMAGE="localhost/wave-e2e-postgres:latest"
MARIADB_IMAGE="localhost/wave-e2e-mariadb:latest"
ORACLE_IMAGE="localhost/wave-e2e-oracle:latest"
MSSQL_IMAGE="localhost/wave-e2e-mssql:latest"
OPENSEARCH_IMAGE="localhost/wave-e2e-opensearch:latest"
OPENSEARCH_GATEWAY_IMAGE="localhost/wave-e2e-opensearch-gateway:latest"
OCI_REGISTRY_IMAGE="localhost/wave-e2e-oci-registry:latest"

# All compose services. Container names are wave-e2e-<service> (set in compose.yaml).
# Every sshd variant (sshd-no-sftp, sshd-no-fwd, nested-sshd, sshd-banner,
# sshd-badpy) reuses SSHD_IMAGE and picks a config with its command; http-echo
# reuses HTTP_IMAGE; http-proxy-auth reuses PROXY_IMAGE; kwok-internal reuses
# KWOK_IMAGE; netcat-echo reuses NETCAT_IMAGE. So no variant adds a build here -
# only a name below.
ALL_SERVICES=(sshd sshd-no-sftp sshd-no-fwd sshd-banner sshd-badpy nested-sshd http-target http-echo tls-lab http-proxy http-proxy-auth kwok kwok-internal k8s-gateway k8s-stub netcat-target netcat-echo postgres mariadb oracle mssql opensearch opensearch-gateway oci-registry)

DOCKER_HOST_SOCK="unix://${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/podman/podman.sock"
export DOCKER_HOST="$DOCKER_HOST_SOCK"

# ---------------------------------------------------------------------------
# docker-compose binary discovery (static v2 binary over the podman socket).
# ---------------------------------------------------------------------------
if command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_BIN="$(command -v docker-compose)"
elif [ -x "$HOME/.local/bin/docker-compose" ]; then
  COMPOSE_BIN="$HOME/.local/bin/docker-compose"
else
  echo "❌ docker-compose not found (expected in PATH or ~/.local/bin)." >&2
  echo "   Install the docker-compose v2 static binary to ~/.local/bin/docker-compose (github.com/docker/compose releases)." >&2
  exit 1
fi

compose() { "$COMPOSE_BIN" -p "$PROJECT" -f "$COMPOSE_FILE" "$@"; }

# ---------------------------------------------------------------------------
# Network: pre-create + cniVersion patch (quirk 1).
# ---------------------------------------------------------------------------
ensure_net() {
  if ! podman network exists "$NET" 2>/dev/null; then
    podman network create "$NET" >/dev/null
  fi
  local conflist="$HOME/.config/cni/net.d/${NET}.conflist"
  if [ -f "$conflist" ] && grep -q '"cniVersion": "1.0.0"' "$conflist"; then
    sed -i 's/"cniVersion": "1.0.0"/"cniVersion": "0.4.0"/' "$conflist"
  fi
}

# ---------------------------------------------------------------------------
# Images: build with podman (quirk 2). `build` forces; ensure_images is lazy.
# ---------------------------------------------------------------------------
build_images() {
  echo "🔨 Building $SSHD_IMAGE ..."
  podman build -q -t "$SSHD_IMAGE" "$SERVICES_DIR/sshd" >/dev/null
  echo "🔨 Building $HTTP_IMAGE ..."
  podman build -q -t "$HTTP_IMAGE" -f "$SERVICES_DIR/http-target/Containerfile" "$PROJECT_ROOT/tests/e2e" >/dev/null
  echo "🔨 Building $TLS_LAB_IMAGE ..."
  podman build -q -t "$TLS_LAB_IMAGE" -f "$SERVICES_DIR/tls-lab/Containerfile" "$PROJECT_ROOT/tests/e2e" >/dev/null
  echo "🔨 Building $PROXY_IMAGE ..."
  podman build -q -t "$PROXY_IMAGE" "$SERVICES_DIR/http-proxy" >/dev/null
  echo "🔨 Building $KWOK_IMAGE ..."
  podman build -q -t "$KWOK_IMAGE" "$SERVICES_DIR/kwok" >/dev/null
  echo "🔨 Building $K8S_STUB_IMAGE ..."
  podman build -q -t "$K8S_STUB_IMAGE" "$SERVICES_DIR/k8s-stub" >/dev/null
  echo "🔨 Building $K8S_GATEWAY_IMAGE ..."
  podman build -q -t "$K8S_GATEWAY_IMAGE" -f "$SERVICES_DIR/k8s-gateway/Containerfile" "$PROJECT_ROOT/tests/e2e" >/dev/null
  echo "🔨 Building $NETCAT_IMAGE ..."
  podman build -q -t "$NETCAT_IMAGE" "$SERVICES_DIR/netcat-target" >/dev/null
  echo "🔨 Building $POSTGRES_IMAGE ..."
  podman build -q -t "$POSTGRES_IMAGE" -f "$SERVICES_DIR/postgres/Containerfile" "$PROJECT_ROOT/tests/e2e" >/dev/null
  echo "🔨 Building $MARIADB_IMAGE ..."
  podman build -q -t "$MARIADB_IMAGE" -f "$SERVICES_DIR/mariadb/Containerfile" "$PROJECT_ROOT/tests/e2e" >/dev/null
  echo "🔨 Building $ORACLE_IMAGE ..."
  podman build -q -t "$ORACLE_IMAGE" "$SERVICES_DIR/oracle" >/dev/null
  echo "🔨 Building $MSSQL_IMAGE ..."
  podman build -q -t "$MSSQL_IMAGE" -f "$SERVICES_DIR/mssql/Containerfile" "$PROJECT_ROOT/tests/e2e" >/dev/null
  echo "🔨 Building $OPENSEARCH_IMAGE ..."
  podman build -q -t "$OPENSEARCH_IMAGE" -f "$SERVICES_DIR/opensearch/Containerfile" "$PROJECT_ROOT/tests/e2e" >/dev/null
  echo "🔨 Building $OPENSEARCH_GATEWAY_IMAGE ..."
  podman build -q -t "$OPENSEARCH_GATEWAY_IMAGE" -f "$SERVICES_DIR/opensearch-gateway/Containerfile" "$PROJECT_ROOT/tests/e2e" >/dev/null
  echo "🔨 Building $OCI_REGISTRY_IMAGE ..."
  podman build -q -t "$OCI_REGISTRY_IMAGE" -f "$SERVICES_DIR/oci-registry/Containerfile" "$PROJECT_ROOT/tests/e2e" >/dev/null
  echo "✅ Images built."
}

ensure_images() {
  if ! podman image exists "$SSHD_IMAGE" || ! podman image exists "$HTTP_IMAGE" \
    || ! podman image exists "$TLS_LAB_IMAGE" || ! podman image exists "$PROXY_IMAGE" \
    || ! podman image exists "$KWOK_IMAGE" || ! podman image exists "$K8S_STUB_IMAGE" \
    || ! podman image exists "$K8S_GATEWAY_IMAGE" || ! podman image exists "$NETCAT_IMAGE" \
    || ! podman image exists "$POSTGRES_IMAGE" || ! podman image exists "$MARIADB_IMAGE" \
    || ! podman image exists "$ORACLE_IMAGE" || ! podman image exists "$MSSQL_IMAGE" \
    || ! podman image exists "$OPENSEARCH_IMAGE" || ! podman image exists "$OPENSEARCH_GATEWAY_IMAGE" \
    || ! podman image exists "$OCI_REGISTRY_IMAGE"; then
    build_images
  fi
}

# ---------------------------------------------------------------------------
# Health: run each container's own healthcheck on demand until it passes.
# ---------------------------------------------------------------------------
wait_health() {
  local svc="$1" container="wave-e2e-$1" deadline=$(( SECONDS + 90 ))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if podman healthcheck run "$container" >/dev/null 2>&1; then
      echo "  ✅ $svc healthy"
      return 0
    fi
    sleep 1
  done
  echo "  ❌ $svc did not become healthy in 90s" >&2
  podman logs --tail 30 "$container" 2>&1 | sed 's/^/     /' || true
  return 1
}

wait_all() {
  local svcs=("$@")
  [ "${#svcs[@]}" -eq 0 ] && svcs=("${ALL_SERVICES[@]}")
  local svc
  for svc in "${svcs[@]}"; do wait_health "$svc"; done
}

# ---------------------------------------------------------------------------
# Commands.
# ---------------------------------------------------------------------------
cmd_up() {
  local wait=0 svcs=()
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --wait) wait=1 ;;
      *) svcs+=("$1") ;;
    esac
    shift
  done
  ensure_net
  ensure_images
  compose up -d "${svcs[@]}"
  if [ "$wait" -eq 1 ]; then wait_all "${svcs[@]}"; fi
}

cmd_run() {
  ensure_net
  ensure_images
  compose up -d
  wait_all
  trap 'compose down -v >/dev/null 2>&1 || true' EXIT INT TERM
  echo "✅ wave-e2e stack ready (foreground; signal to tear down)."
  # Block until signaled; `sleep & wait` lets the trap fire promptly.
  while :; do sleep 3600 & wait $! || break; done
}

cmd_down() { compose down -v >/dev/null 2>&1 || true; echo "🧹 wave-e2e stack down."; }
cmd_status() { compose ps; }

case "${1:-}" in
  build) build_images ;;
  up) shift; cmd_up "$@" ;;
  run) cmd_run ;;
  down) cmd_down ;;
  status) cmd_status ;;
  *)
    echo "Usage: $0 {build|up [--wait] [svc...]|run|down|status}" >&2
    exit 2
    ;;
esac
