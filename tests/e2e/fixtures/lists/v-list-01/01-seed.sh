#!/bin/bash
# V-LIST-01: Seeds populated tests list with various status states
# Creates 30 tests (>25 for pagination) with Passed, Failed, and Never Run statuses
set -e
source "$(dirname "$0")/../../../scripts/lib.sh"

_admin_on
trap _admin_off EXIT

# Reset existing data
_reset

# Create suites with UUIDs for grouping
_add_suite "d1e2f3a4-b5c6-7890-abcd-111111111111" "Healthchecks"
_add_suite "d2e3f4a5-b6c7-8901-bcde-222222222222" "TLS Validation"
_add_suite "d3e4f5a6-b7c8-9012-cdef-333333333333" "Data Integrity"
_add_suite "d4e5f6a7-b8c9-0123-defa-444444444444" "K8s Resilience"
_add_suite "d5e6f7a8-b9c0-1234-efab-555555555555" "Network Security"
_add_suite "d6e7f8a9-b0c1-2345-fabc-666666666666" "Identity"
_add_suite "d7e8f9a0-b1c2-3456-abcd-777777777777" "Performance"

# Create 30 tests with UUIDs, various statuses, and tags
# Status: passed, failed, or empty for never_run
# Page 1 tests (1-25)
_add_test "aaaa0001-0001-0001-0001-000000000001" "API Health Check - 200 Response" "Healthchecks" '["api","health","smoke"]' "passed"
_add_test "aaaa0002-0002-0002-0002-000000000002" "TLS Certificate Validation" "TLS Validation" '["tls","security","regression"]' "passed"
_add_test "aaaa0003-0003-0003-0003-000000000003" "OpenSearch Index Rotation" "Data Integrity" '["opensearch","data"]' "failed"
_add_test "aaaa0004-0004-0004-0004-000000000004" "Kubernetes Pod Restart Recovery" "K8s Resilience" '["k8s","resilience","smoke"]' "passed"
_add_test "aaaa0005-0005-0005-0005-000000000005" "Database Connection Pool Test" "" '["database","regression"]' ""
_add_test "aaaa0006-0006-0006-0006-000000000006" "SSH Tunnel Authentication" "Network Security" '["ssh","security"]' "passed"
_add_test "aaaa0007-0007-0007-0007-000000000007" "LDAP Group Sync Validation" "Identity" '["ldap","identity","smoke"]' "passed"
_add_test "aaaa0008-0008-0008-0008-000000000008" "Redis Cache Invalidation" "Performance" '["redis","performance"]' "passed"
_add_test "aaaa0009-0009-0009-0009-000000000009" "Message Queue Consumer Lag" "Performance" '["mq","performance","regression"]' "failed"
_add_test "aaaa0010-0010-0010-0010-000000000010" "GraphQL Schema Validation" "Data Integrity" '["graphql","api","smoke"]' "passed"
_add_test "aaaa0011-0011-0011-0011-000000000011" "JWT Token Expiry Check" "Identity" '["jwt","security","smoke"]' "passed"
_add_test "aaaa0012-0012-0012-0012-000000000012" "Load Balancer Health" "Network Security" '["lb","health","smoke"]' "passed"
_add_test "aaaa0013-0013-0013-0013-000000000013" "DNS Resolution Test" "" '["dns","network"]' ""
_add_test "aaaa0014-0014-0014-0014-000000000014" "Prometheus Metrics Endpoint" "Healthchecks" '["prometheus","monitoring"]' "passed"
_add_test "aaaa0015-0015-0015-0015-000000000015" "Grafana Dashboard Load" "Healthchecks" '["grafana","monitoring"]' "passed"
_add_test "aaaa0016-0016-0016-0016-000000000016" "Elasticsearch Cluster Health" "Data Integrity" '["elasticsearch","data"]' "failed"
_add_test "aaaa0017-0017-0017-0017-000000000017" "MongoDB Replica Set Status" "Data Integrity" '["mongodb","database"]' "failed"
_add_test "aaaa0018-0018-0018-0018-000000000018" "Kafka Topic Replication" "Performance" '["kafka","mq"]' "passed"
_add_test "aaaa0019-0019-0019-0019-000000000019" "RabbitMQ Queue Depth" "Performance" '["rabbitmq","mq"]' "failed"
_add_test "aaaa0020-0020-0020-0020-000000000020" "Vault Secret Access" "Identity" '["vault","security"]' "passed"
_add_test "aaaa0021-0021-0021-0021-000000000021" "OAuth2 Token Refresh" "" '["oauth","security","regression"]' ""
_add_test "aaaa0022-0022-0022-0022-000000000022" "S3 Bucket Connectivity" "Data Integrity" '["s3","storage"]' "passed"
_add_test "aaaa0023-0023-0023-0023-000000000023" "CloudWatch Alarm Status" "Healthchecks" '["cloudwatch","monitoring"]' ""
_add_test "aaaa0024-0024-0024-0024-000000000024" "Kubernetes Ingress Rules" "K8s Resilience" '["k8s","ingress"]' "passed"
_add_test "aaaa0025-0025-0025-0025-000000000025" "Helm Chart Validation" "K8s Resilience" '["k8s","helm"]' "passed"

# Page 2 tests (26-30) - to enable pagination
_add_test "aaaa0026-0026-0026-0026-000000000026" "Container Image Scan" "Network Security" '["security","container"]' "failed"
_add_test "aaaa0027-0027-0027-0027-000000000027" "Network Policy Enforcement" "Network Security" '["k8s","security","network"]' "failed"
_add_test "aaaa0028-0028-0028-0028-000000000028" "Service Mesh Health" "K8s Resilience" '["istio","k8s"]' "passed"
_add_test "aaaa0029-0029-0029-0029-000000000029" "Cert Manager Renewal" "TLS Validation" '["tls","k8s"]' "passed"
_add_test "aaaa0030-0030-0030-0030-000000000030" "PVC Storage Expansion" "" '["k8s","storage"]' ""

# Create executions to set test statuses (using proper UUIDs)
# Passed tests (18 passed)
_add_exec "f0f00001-0001-0001-0001-000000000001" "aaaa0001-0001-0001-0001-000000000001" "passed" 100 "$(_ts)" 1 1 "test"
_add_exec "f0f00002-0002-0002-0002-000000000002" "aaaa0002-0002-0002-0002-000000000002" "passed" 100 "$(_ts)" 1 1 "test"
_add_exec "f0f00004-0004-0004-0004-000000000004" "aaaa0004-0004-0004-0004-000000000004" "passed" 100 "$(_ts)" 1 1 "test"
_add_exec "f0f00006-0006-0006-0006-000000000006" "aaaa0006-0006-0006-0006-000000000006" "passed" 100 "$(_ts)" 1 1 "test"
_add_exec "f0f00007-0007-0007-0007-000000000007" "aaaa0007-0007-0007-0007-000000000007" "passed" 100 "$(_ts)" 1 1 "test"
_add_exec "f0f00008-0008-0008-0008-000000000008" "aaaa0008-0008-0008-0008-000000000008" "passed" 100 "$(_ts)" 1 1 "test"
_add_exec "f0f00010-0010-0010-0010-000000000010" "aaaa0010-0010-0010-0010-000000000010" "passed" 100 "$(_ts)" 1 1 "test"
_add_exec "f0f00011-0011-0011-0011-000000000011" "aaaa0011-0011-0011-0011-000000000011" "passed" 100 "$(_ts)" 1 1 "test"
_add_exec "f0f00012-0012-0012-0012-000000000012" "aaaa0012-0012-0012-0012-000000000012" "passed" 100 "$(_ts)" 1 1 "test"
_add_exec "f0f00014-0014-0014-0014-000000000014" "aaaa0014-0014-0014-0014-000000000014" "passed" 100 "$(_ts)" 1 1 "test"
_add_exec "f0f00015-0015-0015-0015-000000000015" "aaaa0015-0015-0015-0015-000000000015" "passed" 100 "$(_ts)" 1 1 "test"
_add_exec "f0f00018-0018-0018-0018-000000000018" "aaaa0018-0018-0018-0018-000000000018" "passed" 100 "$(_ts)" 1 1 "test"
_add_exec "f0f00020-0020-0020-0020-000000000020" "aaaa0020-0020-0020-0020-000000000020" "passed" 100 "$(_ts)" 1 1 "test"
_add_exec "f0f00022-0022-0022-0022-000000000022" "aaaa0022-0022-0022-0022-000000000022" "passed" 100 "$(_ts)" 1 1 "test"
_add_exec "f0f00024-0024-0024-0024-000000000024" "aaaa0024-0024-0024-0024-000000000024" "passed" 100 "$(_ts)" 1 1 "test"
_add_exec "f0f00025-0025-0025-0025-000000000025" "aaaa0025-0025-0025-0025-000000000025" "passed" 100 "$(_ts)" 1 1 "test"
_add_exec "f0f00028-0028-0028-0028-000000000028" "aaaa0028-0028-0028-0028-000000000028" "passed" 100 "$(_ts)" 1 1 "test"
_add_exec "f0f00029-0029-0029-0029-000000000029" "aaaa0029-0029-0029-0029-000000000029" "passed" 100 "$(_ts)" 1 1 "test"

# Failed tests (7 failed)
_add_exec "f0f00003-0003-0003-0003-000000000003" "aaaa0003-0003-0003-0003-000000000003" "failed" 100 "$(_ts)" 1 1 "test"
_add_exec "f0f00009-0009-0009-0009-000000000009" "aaaa0009-0009-0009-0009-000000000009" "failed" 100 "$(_ts)" 1 1 "test"
_add_exec "f0f00016-0016-0016-0016-000000000016" "aaaa0016-0016-0016-0016-000000000016" "failed" 100 "$(_ts)" 1 1 "test"
_add_exec "f0f00017-0017-0017-0017-000000000017" "aaaa0017-0017-0017-0017-000000000017" "failed" 100 "$(_ts)" 1 1 "test"
_add_exec "f0f00019-0019-0019-0019-000000000019" "aaaa0019-0019-0019-0019-000000000019" "failed" 100 "$(_ts)" 1 1 "test"
_add_exec "f0f00026-0026-0026-0026-000000000026" "aaaa0026-0026-0026-0026-000000000026" "failed" 100 "$(_ts)" 1 1 "test"
_add_exec "f0f00027-0027-0027-0027-000000000027" "aaaa0027-0027-0027-0027-000000000027" "failed" 100 "$(_ts)" 1 1 "test"

# Never run tests: 5, 13, 21, 23, 30 (5 never run - no executions created)
# Unassigned tests: 5, 13, 21, 30 (4 tests with no suite)

echo "V-LIST-01 seeded: 30 tests, 7 suites, 25 executions (18 passed, 7 failed, 5 never run, 4 unassigned)"
